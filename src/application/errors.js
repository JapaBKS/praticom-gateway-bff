// Falha de rede/timeout ao falar com um microsserviço.
export class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

// O microsserviço respondeu com erro (4xx/5xx): o BFF repassa o status e a mensagem.
export class UpstreamHttpError extends Error {
  constructor(status, body) {
    super(body?.error ?? `O microsserviço respondeu HTTP ${status}.`);
    this.name = 'UpstreamHttpError';
    this.status = status;
    this.body = body;
  }
}
