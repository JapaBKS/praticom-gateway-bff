import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { UpstreamError, UpstreamHttpError } from '../../../application/errors.js';
import { openApiDocument } from './openapi.js';

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

// Só estes caminhos de cada microsserviço são expostos pelo gateway (rotas internas e de saúde ficam de fora).
const MARKET_ROUTES = /^\/(products(\/\d+(\/stock)?)?|checkout|sales)$/;
const FINANCE_ROUTES = /^\/(transactions(\/\d+(\/pay)?)?|summary)$/;

export function createApp({
  bffService,
  marketClient,
  financeClient,
  corsOrigins = [],
  rateLimitPerMinute = 300,
  logger = console
}) {
  const app = express();
  app.disable('x-powered-by');

  // Cabeçalhos de rastreio: id de correlação (repassado aos microsserviços) e tempo de execução.
  app.use((req, res, next) => {
    req.correlationId = req.get('x-correlation-id') || randomUUID();
    const start = process.hrtime.bigint();
    const writeHead = res.writeHead;
    res.writeHead = function patched(...args) {
      res.setHeader('X-Gateway-Execution-Time-Ms', (Number(process.hrtime.bigint() - start) / 1e6).toFixed(1));
      return writeHead.apply(this, args);
    };
    res.setHeader('X-Correlation-Id', req.correlationId);
    res.setHeader('X-Gateway-Processed-By', 'praticom-gateway-bff');
    next();
  });

  // Segurança de perímetro: cabeçalhos HTTP seguros, CORS com lista de origens e limite de requisições.
  // O Swagger UI usa scripts/estilos inline, por isso a CSP do helmet fica desligada.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: corsOrigins.includes('*') ? '*' : corsOrigins,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Condominium-Id', 'X-Correlation-Id'],
      exposedHeaders: ['X-Correlation-Id', 'X-Gateway-Processed-By', 'X-Gateway-Execution-Time-Ms']
    })
  );
  app.use(rateLimit({
    windowMs: 60_000,
    limit: rateLimitPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Tente novamente em instantes.' }
  }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.get('/', (_req, res) => res.redirect('/docs'));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'praticom-gateway-bff' }));

  // ---- Respostas agregadas (BFF) ----
  app.get('/api/bff/status', wrap(async (_req, res) => {
    res.json({ ...(await bffService.status()), cors: { allowedOrigins: corsOrigins }, rateLimitPerMinute });
  }));
  app.get(['/api/bff/dashboard', '/api/dashboard'], wrap(async (_req, res) => {
    res.json(await bffService.dashboard());
  }));
  app.get(['/api/bff/sales', '/api/market/sales'], wrap(async (_req, res) => {
    res.json(await bffService.listSales());
  }));
  app.get('/api/financial/transactions', wrap(async (req, res) => {
    res.json(await bffService.listTransactions(req.query));
  }));
  app.get('/api/financial/summary', wrap(async (_req, res) => {
    res.json(await bffService.summary());
  }));

  // ---- Dados de referência (condomínio, unidades, moradores) ----
  app.get('/api/condominiums', (_req, res) => res.json(bffService.condominiums()));
  app.get('/api/condominiums/active/modules', (_req, res) => res.json(bffService.activeModules()));
  app.get('/api/units', (_req, res) => res.json(bffService.units()));
  app.get('/api/residents', (_req, res) => res.json(bffService.residents()));

  // ---- Roteamento (proxy) para os microsserviços ----
  const proxy = (client, allowed) => [
    (req, res, next) => (allowed.test(req.path) ? next() : res.status(404).json({ error: 'Rota não encontrada.' })),
    wrap(async (req, res) => {
      const hasBody = !['GET', 'HEAD', 'DELETE'].includes(req.method);
      const { status, data } = await client.request(req.method, req.path, {
        query: req.query,
        body: hasBody ? req.body : undefined,
        correlationId: req.correlationId
      });
      res.status(status).json(data ?? {});
    })
  ];
  app.use('/api/market', ...proxy(marketClient, MARKET_ROUTES));
  app.use('/api/financial', ...proxy(financeClient, FINANCE_ROUTES));

  app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    if (error instanceof UpstreamHttpError) {
      return res.status(error.status).json(error.body ?? { error: error.message });
    }
    if (error instanceof UpstreamError) {
      return res.status(error.status).json({ error: error.message });
    }
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({ error: 'JSON inválido.' });
    }
    logger.error(error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  });

  return app;
}
