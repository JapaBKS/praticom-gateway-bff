// Funções puras de agregação/enriquecimento: juntam dados de microsserviços diferentes.

const round1 = (n) => Math.round(n * 10) / 10;

export const indexBy = (list, key = 'id') => new Map(list.map((item) => [item[key], item]));

export function enrichTransaction(tx, unitsById) {
  const unit = unitsById.get(tx.unit_id);
  return { ...tx, block: unit?.block ?? null, unit_number: unit?.number ?? null };
}

// Junta a venda (Mongo) com o lançamento financeiro (Azure SQL) que o Service Bus gerou para ela.
export function enrichSale(sale, { unitsById, residentsById, transactionsBySourceRef = new Map() }) {
  const unit = unitsById.get(sale.unit_id);
  const entry = transactionsBySourceRef.get(`market-sale-${sale.id}`);
  return {
    ...sale,
    block: unit?.block ?? null,
    unit_number: unit?.number ?? null,
    resident_name: residentsById.get(sale.resident_id)?.name ?? null,
    financial_entry: entry
      ? { id: entry.id, status: entry.status, due_date: entry.due_date, amount: entry.amount }
      : null
  };
}

export function enrichSummary(summary, { unitsById, totalUnits }) {
  const delinquencyByUnit = (summary.delinquencyByUnit ?? []).map((row) => {
    const unit = unitsById.get(row.unit_id);
    return { block: unit?.block ?? '—', unit_number: unit?.number ?? String(row.unit_id), total_debt: row.total_debt };
  });
  return {
    ...summary,
    delinquencyByUnit,
    default_rate: totalUnits > 0 ? round1(((summary.overdue_count ?? 0) / totalUnits) * 100) : 0
  };
}

// Dashboard numa única resposta. Se um microsserviço falhar, a parte dele vem null e entra em "warnings".
export function buildDashboard({ summary, products, sales, transactions, totalUnits, warnings = [] }) {
  const lowStock = (products ?? []).filter((p) => (p.stock_quantity ?? 0) <= (p.min_stock ?? 5));
  const pendingCondoBills = (transactions ?? []).filter(
    (tx) => tx.category === 'Mercadinho' && tx.status !== 'PAID'
  );
  const overdueCount = summary?.overdue_count ?? 0;

  return {
    metrics: {
      pendingDeliveries: null,
      activeAccess: null,
      activeVisitors: null,
      balance: summary ? summary.currentBalance : null,
      overdueAmount: summary ? summary.default_amount : null,
      overdueCount: summary ? overdueCount : null,
      defaultRate: summary ? (totalUnits > 0 ? round1((overdueCount / totalUnits) * 100) : 0) : null,
      todayReservations: null,
      lowStockItems: products ? lowStock.length : null
    },
    recentAccess: [],
    recentDeliveries: [],
    urgentAnnouncements: [],
    upcomingReservations: [],
    market: products
      ? { productsCount: products.length, lowStock, recentSales: (sales ?? []).slice(0, 5) }
      : null,
    finance: summary ? { ...summary, pendingCondoBills } : null,
    warnings
  };
}
