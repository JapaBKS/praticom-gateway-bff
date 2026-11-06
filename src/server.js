import { createApp } from './adapters/inbound/http/createApp.js';
import { ServiceClient } from './adapters/outbound/ServiceClient.js';
import { BffService } from './application/BffService.js';
import { loadConfig } from './config.js';

const config = loadConfig();

const marketClient = new ServiceClient({ name: 'Mercadinho', baseUrl: config.marketServiceUrl, internalApiKey: config.internalApiKey });
const financeClient = new ServiceClient({ name: 'Financeiro', baseUrl: config.financeServiceUrl, internalApiKey: config.internalApiKey });
const bffService = new BffService({ marketClient, financeClient });

const app = createApp({
  bffService,
  marketClient,
  financeClient,
  corsOrigins: config.corsOrigins,
  rateLimitPerMinute: config.rateLimitPerMinute
});

app.listen(config.port, () => {
  console.log(`gateway-bff na porta ${config.port}`);
  console.log(`Mercadinho: ${config.marketServiceUrl} | Financeiro: ${config.financeServiceUrl}`);
  console.log(`Swagger: http://localhost:${config.port}/docs`);
});
