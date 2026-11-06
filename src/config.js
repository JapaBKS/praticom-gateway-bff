// Toda a configuração vem de variáveis de ambiente (veja .env.example).
const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:5173'];

export function loadConfig(env = process.env) {
  const origins = (env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  return {
    port: Number(env.PORT) || 5000,
    marketServiceUrl: env.MARKET_SERVICE_URL || 'http://localhost:5001',
    financeServiceUrl: env.FINANCE_SERVICE_URL || 'http://localhost:5002',
    internalApiKey: env.INTERNAL_API_KEY || '',
    corsOrigins: origins.length ? origins : DEFAULT_ORIGINS,
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE) || 300
  };
}
