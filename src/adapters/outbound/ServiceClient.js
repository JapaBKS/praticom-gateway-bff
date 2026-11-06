import { UpstreamError } from '../../application/errors.js';
import { ServiceClientPort } from '../../application/ports.js';

// Adaptador de saída HTTP para um microsserviço. Injeta a chave interna e o id de correlação.
export class ServiceClient extends ServiceClientPort {
  constructor({ name, baseUrl, internalApiKey = '', timeoutMs = 8000, fetchImpl = fetch }) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.internalApiKey = internalApiKey;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async request(method, path, { query, body, correlationId } = {}) {
    const search = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.internalApiKey) headers['x-internal-key'] = this.internalApiKey;
    if (correlationId) headers['x-correlation-id'] = correlationId;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}${search}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { error: text.slice(0, 200) };
        }
      }
      return { status: response.status, data };
    } catch (error) {
      const timedOut = error.name === 'TimeoutError';
      throw new UpstreamError(
        `Microsserviço ${this.name} ${timedOut ? 'não respondeu a tempo' : 'indisponível'}.`,
        timedOut ? 504 : 502
      );
    }
  }
}
