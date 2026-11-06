import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, enrichSale, enrichSummary, enrichTransaction, indexBy } from '../src/application/aggregation.js';

const units = [
  { id: 1, block: 'Bloco A', number: '101' },
  { id: 2, block: 'Bloco A', number: '102' }
];
const unitsById = indexBy(units);
const residentsById = indexBy([{ id: 7, name: 'Ana Souza', unit_id: 1 }]);

test('enrichTransaction acrescenta bloco e unidade', () => {
  assert.deepEqual(enrichTransaction({ id: 1, unit_id: 2 }, unitsById), { id: 1, unit_id: 2, block: 'Bloco A', unit_number: '102' });
  assert.deepEqual(enrichTransaction({ id: 2, unit_id: null }, unitsById), { id: 2, unit_id: null, block: null, unit_number: null });
});

test('enrichSale junta venda, unidade, morador e o lançamento financeiro gerado', () => {
  const sale = { id: 10, unit_id: 1, resident_id: 7, total_amount: 20 };
  const entry = { id: 99, status: 'PENDING', due_date: '2026-12-05', amount: 20, source_ref: 'market-sale-10' };
  const result = enrichSale(sale, { unitsById, residentsById, transactionsBySourceRef: new Map([['market-sale-10', entry]]) });
  assert.equal(result.block, 'Bloco A');
  assert.equal(result.resident_name, 'Ana Souza');
  assert.deepEqual(result.financial_entry, { id: 99, status: 'PENDING', due_date: '2026-12-05', amount: 20 });

  const without = enrichSale(sale, { unitsById, residentsById });
  assert.equal(without.financial_entry, null);
});

test('enrichSummary resolve unidades e calcula a taxa de inadimplência', () => {
  const summary = { overdue_count: 1, delinquencyByUnit: [{ unit_id: 2, total_debt: 100 }] };
  const result = enrichSummary(summary, { unitsById, totalUnits: 4 });
  assert.deepEqual(result.delinquencyByUnit, [{ block: 'Bloco A', unit_number: '102', total_debt: 100 }]);
  assert.equal(result.default_rate, 25);
  assert.equal(enrichSummary({ overdue_count: 0 }, { unitsById, totalUnits: 0 }).default_rate, 0);
});

test('buildDashboard junta métricas dos dois serviços e conta estoque baixo', () => {
  const dashboard = buildDashboard({
    summary: { currentBalance: 70, default_amount: 100, overdue_count: 1 },
    products: [
      { id: 1, stock_quantity: 2, min_stock: 5 },
      { id: 2, stock_quantity: 50, min_stock: 5 }
    ],
    sales: [{ id: 1 }],
    transactions: [
      { category: 'Mercadinho', status: 'PENDING' },
      { category: 'Mercadinho', status: 'PAID' }
    ],
    totalUnits: 4
  });
  assert.equal(dashboard.metrics.balance, 70);
  assert.equal(dashboard.metrics.overdueCount, 1);
  assert.equal(dashboard.metrics.defaultRate, 25);
  assert.equal(dashboard.metrics.lowStockItems, 1);
  assert.equal(dashboard.finance.pendingCondoBills.length, 1);
  assert.equal(dashboard.market.productsCount, 2);
  assert.deepEqual(dashboard.warnings, []);
});

test('buildDashboard degrada com elegância quando um serviço está fora', () => {
  const dashboard = buildDashboard({ summary: null, products: [{ id: 1, stock_quantity: 0, min_stock: 5 }], totalUnits: 4, warnings: ['Financeiro indisponível'] });
  assert.equal(dashboard.metrics.balance, null);
  assert.equal(dashboard.metrics.lowStockItems, 1);
  assert.equal(dashboard.finance, null);
  assert.deepEqual(dashboard.warnings, ['Financeiro indisponível']);
});
