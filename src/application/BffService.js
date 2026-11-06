import { UpstreamHttpError } from './errors.js';
import {
  buildDashboard,
  enrichSale,
  enrichSummary,
  enrichTransaction,
  indexBy
} from './aggregation.js';
import * as reference from './referenceData.js';

// Casos de uso do BFF: consulta os dois microsserviços e devolve tudo agregado ao frontend.
export class BffService {
  constructor({ marketClient, financeClient, referenceData = reference }) {
    this.market = marketClient;
    this.finance = financeClient;
    this.reference = referenceData;
    this.unitsById = indexBy(referenceData.units);
    this.residentsById = indexBy(referenceData.residents);
  }

  async #data(promise) {
    const { status, data } = await promise;
    if (status >= 400) {
      throw new UpstreamHttpError(status, data);
    }
    return data;
  }

  async listTransactions(query = {}) {
    const transactions = await this.#data(this.finance.request('GET', '/transactions', { query }));
    return transactions.map((tx) => enrichTransaction(tx, this.unitsById));
  }

  async summary() {
    const summary = await this.#data(this.finance.request('GET', '/summary'));
    return enrichSummary(summary, { unitsById: this.unitsById, totalUnits: this.reference.units.length });
  }

  // Vendas (Mongo) + lançamento financeiro correspondente (Azure SQL) na mesma resposta.
  async listSales() {
    const [sales, transactions] = await Promise.all([
      this.#data(this.market.request('GET', '/sales')),
      this.#data(this.finance.request('GET', '/transactions', { query: { category: 'Mercadinho' } })).catch(() => [])
    ]);
    const transactionsBySourceRef = new Map(
      transactions.filter((tx) => tx.source_ref).map((tx) => [tx.source_ref, tx])
    );
    return sales.map((sale) =>
      enrichSale(sale, { unitsById: this.unitsById, residentsById: this.residentsById, transactionsBySourceRef })
    );
  }

  async dashboard() {
    const [summaryResult, productsResult, salesResult, transactionsResult] = await Promise.allSettled([
      this.summary(),
      this.#data(this.market.request('GET', '/products')),
      this.listSales(),
      this.#data(this.finance.request('GET', '/transactions', { query: { category: 'Mercadinho' } }))
    ]);

    const warnings = [];
    const valueOf = (result, label) => {
      if (result.status === 'fulfilled') return result.value;
      warnings.push(`${label} indisponível: ${result.reason.message}`);
      return null;
    };

    const summary = valueOf(summaryResult, 'Financeiro');
    const products = valueOf(productsResult, 'Mercadinho');
    const sales = salesResult.status === 'fulfilled' ? salesResult.value : null;
    const transactions = transactionsResult.status === 'fulfilled' ? transactionsResult.value : null;

    return buildDashboard({
      summary,
      products,
      sales,
      transactions,
      totalUnits: this.reference.units.length,
      warnings
    });
  }

  async status() {
    const ping = async (client) => {
      try {
        const { status } = await client.request('GET', '/health');
        return status === 200 ? 'UP' : 'DEGRADED';
      } catch {
        return 'DOWN';
      }
    };
    const [market, finance] = await Promise.all([ping(this.market), ping(this.finance)]);
    return { service: 'praticom-gateway-bff', upstreams: { market, finance } };
  }

  condominiums() { return this.reference.condominiums; }
  activeModules() { return this.reference.modules; }
  units() { return this.reference.units; }
  residents() { return this.reference.residents; }
}
