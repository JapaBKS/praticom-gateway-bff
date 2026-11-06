const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
const obj = { type: 'object' };
const ok = (description, schema = obj) => ({ description, content: { 'application/json': { schema } } });
const list = (description) => ok(description, { type: 'array', items: obj });
const body = (schema = obj) => ({ required: true, content: { 'application/json': { schema } } });
const upstreamErrors = {
  400: { description: 'Dados inválidos (repassado do microsserviço)' },
  404: { description: 'Não encontrado (repassado do microsserviço)' },
  502: { description: 'Microsserviço indisponível' },
  504: { description: 'Microsserviço não respondeu a tempo' }
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Praticom - API Gateway & BFF',
    version: '1.0.0',
    description:
      'Ponto único de entrada do frontend. Roteia (proxy) para o microsserviço de Mercadinho (MongoDB) e para o de Financeiro (Azure SQL), aplica CORS, cabeçalhos de segurança e limite de requisições, e agrega dados dos dois serviços em uma única resposta (/api/bff/dashboard e /api/bff/sales).'
  },
  tags: [
    { name: 'BFF', description: 'Respostas agregadas de mais de um microsserviço' },
    { name: 'Mercadinho', description: 'Proxy para o microsserviço de Mercadinho (MongoDB)' },
    { name: 'Financeiro', description: 'Proxy para o microsserviço Financeiro (Azure SQL)' },
    { name: 'Referência', description: 'Condomínio, unidades e moradores (dados fixos do BFF)' }
  ],
  paths: {
    '/api/health': { get: { tags: ['BFF'], summary: 'Verifica se o gateway está no ar', responses: { 200: ok('OK') } } },
    '/api/bff/status': {
      get: { tags: ['BFF'], summary: 'Topologia: estado de cada microsserviço, CORS e limite de requisições', responses: { 200: ok('Status') } }
    },
    '/api/bff/dashboard': {
      get: {
        tags: ['BFF'],
        summary: 'Dashboard agregado: resumo financeiro (SQL) + produtos e vendas (Mongo) numa única resposta',
        description: 'Se um microsserviço falhar, a parte dele vem null e o motivo aparece em "warnings".',
        responses: { 200: ok('Dashboard') }
      }
    },
    '/api/bff/sales': {
      get: {
        tags: ['BFF'],
        summary: 'Vendas (Mongo) com o lançamento financeiro (SQL) que o Service Bus gerou para cada uma',
        responses: { 200: list('Vendas com financial_entry') }
      }
    },
    '/api/market/products': {
      get: { tags: ['Mercadinho'], summary: 'Lista produtos', parameters: [{ name: 'category', in: 'query', schema: { type: 'string' } }, { name: 'search', in: 'query', schema: { type: 'string' } }], responses: { 200: list('Produtos'), ...upstreamErrors } },
      post: { tags: ['Mercadinho'], summary: 'Cria produto', requestBody: body(), responses: { 201: ok('Criado'), ...upstreamErrors } }
    },
    '/api/market/products/{id}': {
      get: { tags: ['Mercadinho'], summary: 'Busca produto', parameters: [idParam], responses: { 200: ok('Produto'), ...upstreamErrors } },
      patch: { tags: ['Mercadinho'], summary: 'Atualiza produto', parameters: [idParam], requestBody: body(), responses: { 200: ok('Atualizado'), ...upstreamErrors } },
      delete: { tags: ['Mercadinho'], summary: 'Exclui produto', parameters: [idParam], responses: { 200: ok('Excluído'), ...upstreamErrors } }
    },
    '/api/market/products/{id}/stock': {
      patch: { tags: ['Mercadinho'], summary: 'Ajusta estoque (delta ou quantity + action)', parameters: [idParam], requestBody: body(), responses: { 200: ok('Produto'), ...upstreamErrors } }
    },
    '/api/market/checkout': {
      post: {
        tags: ['Mercadinho'],
        summary: 'Finaliza compra no PDV (condo_bill gera lançamento no Financeiro via Service Bus)',
        requestBody: body({ type: 'object', properties: { unit_id: { type: 'integer' }, resident_id: { type: 'integer' }, payment_method: { type: 'string', enum: ['pix', 'credit_card', 'condo_bill'] }, items: { type: 'array', items: { type: 'object', properties: { product_id: { type: 'integer' }, quantity: { type: 'integer' } } } } } }),
        responses: { 201: ok('Venda'), ...upstreamErrors }
      }
    },
    '/api/market/sales': { get: { tags: ['Mercadinho'], summary: 'Vendas (mesmo que /api/bff/sales)', responses: { 200: list('Vendas') } } },
    '/api/financial/transactions': {
      get: { tags: ['Financeiro'], summary: 'Lista lançamentos (com bloco e unidade)', parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'type', in: 'query', schema: { type: 'string' } }, { name: 'category', in: 'query', schema: { type: 'string' } }, { name: 'search', in: 'query', schema: { type: 'string' } }], responses: { 200: list('Lançamentos'), ...upstreamErrors } },
      post: { tags: ['Financeiro'], summary: 'Cria lançamento', requestBody: body(), responses: { 201: ok('Criado'), ...upstreamErrors } }
    },
    '/api/financial/transactions/{id}': {
      get: { tags: ['Financeiro'], summary: 'Busca lançamento', parameters: [idParam], responses: { 200: ok('Lançamento'), ...upstreamErrors } },
      patch: { tags: ['Financeiro'], summary: 'Edita lançamento não pago', parameters: [idParam], requestBody: body(), responses: { 200: ok('Atualizado'), ...upstreamErrors } },
      delete: { tags: ['Financeiro'], summary: 'Exclui lançamento não pago', parameters: [idParam], responses: { 200: ok('Excluído'), ...upstreamErrors } }
    },
    '/api/financial/transactions/{id}/pay': {
      patch: { tags: ['Financeiro'], summary: 'Dá baixa no lançamento', parameters: [idParam], responses: { 200: ok('Pago'), ...upstreamErrors } }
    },
    '/api/financial/summary': {
      get: { tags: ['Financeiro'], summary: 'Resumo financeiro com inadimplência por unidade e taxa', responses: { 200: ok('Resumo'), ...upstreamErrors } }
    },
    '/api/condominiums': { get: { tags: ['Referência'], summary: 'Condomínios (dado fixo)', responses: { 200: list('Condomínios') } } },
    '/api/condominiums/active/modules': { get: { tags: ['Referência'], summary: 'Módulos disponíveis', responses: { 200: list('Módulos') } } },
    '/api/units': { get: { tags: ['Referência'], summary: 'Unidades (dado fixo)', responses: { 200: list('Unidades') } } },
    '/api/residents': { get: { tags: ['Referência'], summary: 'Moradores (dado fixo)', responses: { 200: list('Moradores') } } }
  }
};
