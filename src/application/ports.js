// Porta de saída: como o BFF fala com um microsserviço. O adaptador HTTP (ServiceClient) implementa esta classe.
export class ServiceClientPort {
  // Retorna { status, data }. Lança UpstreamError se o serviço estiver inacessível.
  async request(_method, _path, _options) {
    throw new Error('request() não implementado pelo adaptador.');
  }
}
