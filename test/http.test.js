import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/adapters/inbound/http/createApp.js';
import { ServiceClient } from '../src/adapters/outbound/ServiceClient.js';
import { BffService } from '../src/application/BffService.js';
import { UpstreamError } from '../src/application/errors.js';

const logger = { error() {}, warn() {}, log() {} };

// Cliente falso: guarda as chamadas e responde conforme a tabela de rotas.
function fakeClient(routes) {
  const calls = [];
  return {
    calls,
    async request(method, path, options = {}) {
      calls.push({ method, path, ...options });
      const handler = routes[`${method} ${path}`];
      if (!handler) return { status: 404, data: { error: 'não encontrado' } };
      return typeof handler === 'function' ? handler(options) : handler;
    }
  };
}

const down = () => { throw new UpstreamError('Microsserviço Financeiro indisponível.', 502); };

async function startServer({ market, finance, corsOrigins = ['http://localhost:3000'] }) {
  const app = createApp({
    bffService: new BffService({ marketClient: market, financeClient: finance }),
    marketClient: market,
    financeClient: finance,
    corsOrigins,
    logger
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, payload, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  };
  return { call, close: () => new Promise((resolve) => server.close(resolve)) };
}

const summaryPayload = { income: { paid: 0, pending: 0, overdue: 100 }, expense: { paid: 0, pending: 0, overdue: 0 }, currentBalance: 0, default_amount: 100, overdue_count: 1, delinquencyByUnit: [{ unit_id: 2, total_debt: 100 }] };

test('repassa CRUD do Mercadinho ao microsserviço (proxy) com a correlação', async () => {
  const market = fakeClient({
    'GET /products': { status: 200, data: [{ id: 1, name: 'Água' }] },
    'POST /products': ({ body }) => ({ status: 201, data: { id: 2, ...body } }),
    'PATCH /products/2': ({ body }) => ({ status: 200, data: { id: 2, ...body } }),
    'DELETE /products/2': { status: 200, data: { message: 'ok' } }
  });
  const api = await startServer({ market, finance: fakeClient({}) });
  try {
    assert.equal((await api.call('GET', '/api/market/products?category=Bebidas')).body[0].name, 'Água');
    assert.deepEqual(market.calls[0].query, { category: 'Bebidas' });

    const created = await api.call('POST', '/api/market/products', { name: 'Doce', price: 3 });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'Doce');

    assert.equal((await api.call('PATCH', '/api/market/products/2', { price: 4 })).body.price, 4);
    assert.equal((await api.call('DELETE', '/api/market/products/2')).status, 200);

    const traced = await api.call('GET', '/api/market/products', undefined, { 'x-correlation-id': 'abc-123' });
    assert.equal(traced.headers.get('x-correlation-id'), 'abc-123');
    assert.equal(market.calls.at(-1).correlationId, 'abc-123');
    assert.equal(traced.headers.get('x-gateway-processed-by'), 'praticom-gateway-bff');
    assert.ok(traced.headers.get('x-gateway-execution-time-ms'));
  } finally {
    await api.close();
  }
});

test('só expõe as rotas permitidas dos microsserviços', async () => {
  const market = fakeClient({ 'GET /health': { status: 200, data: {} } });
  const api = await startServer({ market, finance: fakeClient({}) });
  try {
    assert.equal((await api.call('GET', '/api/market/health')).status, 404);
    assert.equal((await api.call('GET', '/api/market/internal/events')).status, 404);
    assert.equal((await api.call('GET', '/api/financial/internal/events')).status, 404);
    assert.equal(market.calls.length, 0);
  } finally {
    await api.close();
  }
});

test('repassa erros do microsserviço (400/404) ao frontend', async () => {
  const finance = fakeClient({
    'POST /transactions': { status: 400, data: { error: 'Tipo de lançamento inválido.' } },
    'PATCH /transactions/9/pay': { status: 404, data: { error: 'Lançamento não encontrado.' } }
  });
  const api = await startServer({ market: fakeClient({}), finance });
  try {
    const bad = await api.call('POST', '/api/financial/transactions', {});
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'Tipo de lançamento inválido.');
    assert.equal((await api.call('PATCH', '/api/financial/transactions/9/pay')).status, 404);
  } finally {
    await api.close();
  }
});

test('lançamentos chegam enriquecidos com bloco e unidade; resumo com taxa de inadimplência', async () => {
  const finance = fakeClient({
    'GET /transactions': { status: 200, data: [{ id: 1, unit_id: 2, description: 'Taxa' }] },
    'GET /summary': { status: 200, data: summaryPayload }
  });
  const api = await startServer({ market: fakeClient({}), finance });
  try {
    const list = await api.call('GET', '/api/financial/transactions');
    assert.equal(list.body[0].block, 'Bloco A');
    assert.equal(list.body[0].unit_number, '102');

    const summary = await api.call('GET', '/api/financial/summary');
    assert.deepEqual(summary.body.delinquencyByUnit, [{ block: 'Bloco A', unit_number: '102', total_debt: 100 }]);
    assert.equal(summary.body.default_rate, 16.7);
  } finally {
    await api.close();
  }
});

test('vendas (Mongo) chegam com o lançamento financeiro (SQL) na mesma resposta', async () => {
  const market = fakeClient({ 'GET /sales': { status: 200, data: [{ id: 5, unit_id: 1, resident_id: 1, total_amount: 20 }] } });
  const finance = fakeClient({
    'GET /transactions': { status: 200, data: [{ id: 30, source_ref: 'market-sale-5', status: 'PENDING', due_date: '2026-12-05', amount: 20 }] }
  });
  const api = await startServer({ market, finance });
  try {
    const sales = await api.call('GET', '/api/market/sales');
    assert.equal(sales.body[0].resident_name, 'Ana Souza');
    assert.equal(sales.body[0].financial_entry.id, 30);
    assert.deepEqual(finance.calls[0].query, { category: 'Mercadinho' });
  } finally {
    await api.close();
  }
});

test('dashboard agrega os dois microsserviços numa única resposta', async () => {
  const market = fakeClient({
    'GET /products': { status: 200, data: [{ id: 1, stock_quantity: 1, min_stock: 5 }] },
    'GET /sales': { status: 200, data: [] }
  });
  const finance = fakeClient({
    'GET /summary': { status: 200, data: summaryPayload },
    'GET /transactions': { status: 200, data: [] }
  });
  const api = await startServer({ market, finance });
  try {
    const { status, body } = await api.call('GET', '/api/dashboard');
    assert.equal(status, 200);
    assert.equal(body.metrics.lowStockItems, 1);
    assert.equal(body.metrics.overdueAmount, 100);
    assert.deepEqual(body.warnings, []);
  } finally {
    await api.close();
  }
});

test('dashboard continua respondendo quando o Financeiro está fora', async () => {
  const market = fakeClient({
    'GET /products': { status: 200, data: [{ id: 1, stock_quantity: 1, min_stock: 5 }] },
    'GET /sales': { status: 200, data: [] }
  });
  const finance = fakeClient({ 'GET /summary': down, 'GET /transactions': down });
  const api = await startServer({ market, finance });
  try {
    const { status, body } = await api.call('GET', '/api/bff/dashboard');
    assert.equal(status, 200);
    assert.equal(body.metrics.balance, null);
    assert.equal(body.metrics.lowStockItems, 1);
    assert.ok(body.warnings.some((w) => w.includes('Financeiro indisponível')));
  } finally {
    await api.close();
  }
});

test('microsserviço fora do ar vira 502 no proxy', async () => {
  const finance = fakeClient({ 'POST /transactions': down });
  const api = await startServer({ market: fakeClient({}), finance });
  try {
    const response = await api.call('POST', '/api/financial/transactions', { type: 'income' });
    assert.equal(response.status, 502);
    assert.match(response.body.error, /indisponível/);
  } finally {
    await api.close();
  }
});

test('status mostra a saúde de cada microsserviço e a política de CORS', async () => {
  const market = fakeClient({ 'GET /health': { status: 200, data: {} } });
  const finance = fakeClient({ 'GET /health': down });
  const api = await startServer({ market, finance });
  try {
    const { body } = await api.call('GET', '/api/bff/status');
    assert.deepEqual(body.upstreams, { market: 'UP', finance: 'DOWN' });
    assert.deepEqual(body.cors.allowedOrigins, ['http://localhost:3000']);
  } finally {
    await api.close();
  }
});

test('dados de referência: condomínios, módulos, unidades e moradores', async () => {
  const api = await startServer({ market: fakeClient({}), finance: fakeClient({}) });
  try {
    assert.equal((await api.call('GET', '/api/condominiums')).body.length, 1);
    const modules = (await api.call('GET', '/api/condominiums/active/modules')).body;
    assert.deepEqual(modules.filter((m) => m.enabled).map((m) => m.module_key).sort(), ['dashboard', 'financial', 'market']);
    assert.equal((await api.call('GET', '/api/units')).body.length, 6);
    assert.equal((await api.call('GET', '/api/residents')).body.length, 6);
  } finally {
    await api.close();
  }
});

test('CORS só libera origens configuradas', async () => {
  const api = await startServer({ market: fakeClient({}), finance: fakeClient({}), corsOrigins: ['https://meu-front.azurestaticapps.net'] });
  try {
    const allowed = await api.call('GET', '/api/health', undefined, { Origin: 'https://meu-front.azurestaticapps.net' });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://meu-front.azurestaticapps.net');
    const blocked = await api.call('GET', '/api/health', undefined, { Origin: 'https://site-malicioso.com' });
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  } finally {
    await api.close();
  }
});

test('ServiceClient injeta a chave interna e converte falha de rede em UpstreamError', async () => {
  let seen;
  const ok = new ServiceClient({
    name: 'Teste',
    baseUrl: 'http://x/',
    internalApiKey: 'segredo',
    fetchImpl: async (url, init) => {
      seen = { url, headers: init.headers };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  });
  const result = await ok.request('GET', '/products', { query: { search: 'água' }, correlationId: 'c1' });
  assert.deepEqual(result, { status: 200, data: { ok: true } });
  assert.equal(seen.headers['x-internal-key'], 'segredo');
  assert.equal(seen.headers['x-correlation-id'], 'c1');
  assert.ok(seen.url.startsWith('http://x/products?search='));

  const broken = new ServiceClient({ name: 'Teste', baseUrl: 'http://x', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(broken.request('GET', '/products'), (error) => error instanceof UpstreamError && error.status === 502);
});
