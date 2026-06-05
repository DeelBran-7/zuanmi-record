export const RECORD_TYPES = {
  capital_in: { label: '投入本金', sign: 1 },
  capital_out: { label: '取出/回款', sign: -1 },
  realized_profit: { label: '已实现盈利', sign: 1 },
  realized_loss: { label: '已实现亏损', sign: -1 },
  dividend: { label: '分红/利息', sign: 1 },
  expense: { label: '花掉/消费', sign: -1 },
  fee: { label: '手续费/成本', sign: -1 },
  gold_buy: { label: '黄金买入', sign: 1 },
  valuation: { label: '当前估值', sign: 0 },
  note: { label: '备注', sign: 0 },
};

export function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function recordsForAsset(assetId, records) {
  return records.filter((record) => record.assetId === assetId);
}

export function recordsForYear(records, year) {
  return records.filter((record) => new Date(record.date).getFullYear() === Number(year));
}

export function recordsUntilYear(records, year) {
  const end = new Date(`${Number(year)}-12-31T23:59:59`);
  return records.filter((record) => new Date(record.date) <= end);
}

export function getGoldSummary(asset, records, options = {}) {
  const assetRecords = recordsForAsset(asset.id, records);
  const buys = assetRecords.filter((record) => record.type === 'gold_buy');
  const grams = money(buys.reduce((sum, record) => sum + (Number(record.quantity) || 0), 0));
  const cost = money(buys.reduce((sum, record) => sum + (Number(record.amount) || 0), 0));
  const currentPrice = Number(options.goldPricePerGram) || 0;
  const currentValue = currentPrice > 0 ? money(grams * currentPrice) : cost;
  const floatingProfit = currentPrice > 0 ? money(currentValue - cost) : null;

  return {
    grams,
    cost,
    averageBuyPrice: grams > 0 ? cost / grams : 0,
    currentPrice,
    currentValue,
    floatingProfit,
  };
}

export function calculateAssetSummary(asset, records, options = {}) {
  const assetRecords = recordsForAsset(asset.id, records);
  const isInvestment = isInvestmentAsset(asset);
  const isCash = isCashAsset(asset);
  const capitalIn = money(sumByTypes(assetRecords, ['capital_in', 'gold_buy']));
  const capitalOut = money(sumByTypes(assetRecords, ['capital_out']));
  const grossRevenue = money(sumByTypes(assetRecords, ['realized_profit', 'dividend']));
  const realizedLoss = money(sumByTypes(assetRecords, ['realized_loss', 'fee']));
  const spent = money(sumByTypes(assetRecords, ['expense']));
  const latestValuation = findLatestAmount(assetRecords, 'valuation');
  const gold = asset.category === 'gold' ? getGoldSummary(asset, records, options) : null;

  let currentValue;
  let floatingProfit = null;
  let accountValue = null;

  if (asset.category === 'gold') {
    accountValue = gold.currentValue;
    currentValue = money(accountValue - spent);
    floatingProfit = gold.floatingProfit;
  } else if (latestValuation !== null) {
    accountValue = money(latestValuation);
    currentValue = isInvestment ? money(accountValue - spent) : accountValue;
  } else if (isInvestment || isCash) {
    accountValue = money(capitalIn - capitalOut + grossRevenue - realizedLoss);
    currentValue = money(accountValue - spent);
  } else {
    accountValue = money(capitalIn - capitalOut - realizedLoss);
    currentValue = accountValue;
  }

  const settledCash = isCash ? 0 : money(capitalOut + (isInvestment ? 0 : grossRevenue) - (isInvestment ? 0 : spent));
  const investmentProfit = isInvestment ? money((accountValue || 0) + capitalOut - capitalIn) : 0;
  const assetClass = isInvestment ? 'investment' : isCash ? 'cash' : 'cashflow';

  return {
    assetId: asset.id,
    name: asset.name,
    category: asset.category,
    assetClass,
    currency: asset.currency || 'CNY',
    status: asset.status || 'active',
    principal: money(capitalIn - capitalOut),
    capitalIn,
    capitalOut,
    grossRevenue,
    realizedProfit: grossRevenue,
    realizedLoss,
    spent,
    netRealized: money(grossRevenue - realizedLoss),
    retainedRevenue: money(grossRevenue - realizedLoss - spent),
    settledCash,
    investmentProfit,
    currentValue,
    floatingProfit,
    recordCount: assetRecords.length,
    gold,
  };
}

export function calculatePortfolioSummary(assets, records, options = {}) {
  const assetSummaries = assets.map((asset) => calculateAssetSummary(asset, records, options));
  const settledCash = money(assetSummaries.reduce((sum, asset) => sum + cnyAmount(asset.settledCash, asset.currency), 0));
  const totalAssets = money(assetSummaries.reduce((sum, asset) => sum + cnyAmount(asset.currentValue, asset.currency), settledCash));
  const principal = money(assetSummaries.reduce((sum, asset) => sum + cnyAmount(asset.principal, asset.currency), 0));
  const cashFlowAssets = assetSummaries.filter((asset) => asset.assetClass !== 'investment');
  const investmentAssets = assetSummaries.filter((asset) => asset.assetClass === 'investment');
  const grossRevenue = money(cashFlowAssets.reduce((sum, asset) => sum + cnyAmount(asset.grossRevenue, asset.currency), 0));
  const cashFlowProfit = money(cashFlowAssets.reduce((sum, asset) => sum + cnyAmount(asset.netRealized, asset.currency), 0));
  const realizedProfit = money(assetSummaries.reduce((sum, asset) => sum + cnyAmount(asset.netRealized, asset.currency), 0));
  const spent = money(assetSummaries.reduce((sum, asset) => sum + cnyAmount(asset.spent, asset.currency), 0));
  const investmentProfit = money(investmentAssets.reduce((sum, asset) => sum + cnyAmount(asset.investmentProfit, asset.currency), 0));
  const goldFloatingProfit = money(assetSummaries.reduce((sum, asset) => {
    if (asset.category !== 'gold' || asset.floatingProfit === null) return sum;
    return sum + cnyAmount(asset.floatingProfit, asset.currency);
  }, 0));
  const target = Number(options.target) || 0;

  return {
    year: options.year,
    target,
    totalAssets,
    principal,
    grossRevenue,
    cashFlowProfit,
    realizedProfit,
    spent,
    settledCash,
    investmentProfit,
    goldFloatingProfit,
    trueProfit: money(cashFlowProfit - spent + investmentProfit),
    targetProgress: target > 0 ? money((totalAssets / target) * 100) : 0,
    targetRemaining: target > 0 ? money(Math.max(target - totalAssets, 0)) : 0,
    assets: assetSummaries,
  };
}

export function sortAssetsForDisplay(assets) {
  return [...assets].sort((a, b) => {
    const statusRankA = a.status === 'archived' ? 1 : 0;
    const statusRankB = b.status === 'archived' ? 1 : 0;
    if (statusRankA !== statusRankB) return statusRankA - statusRankB;
    const orderA = Number.isFinite(Number(a.displayOrder)) ? Number(a.displayOrder) : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(Number(b.displayOrder)) ? Number(b.displayOrder) : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
  });
}

export function normalizeAssetOrder(assets) {
  return sortAssetsForDisplay(assets).map((asset, index) => ({ ...asset, displayOrder: index }));
}

export function moveAssetWithinStatus(assets, assetId, direction) {
  const normalized = normalizeAssetOrder(assets);
  const target = normalized.find((asset) => asset.id === assetId);
  if (!target) return normalized;
  const groupStatus = target.status === 'archived' ? 'archived' : 'active';
  const group = normalized.filter((asset) => (asset.status === 'archived' ? 'archived' : 'active') === groupStatus);
  const currentIndex = group.findIndex((asset) => asset.id === assetId);
  const nextIndex = currentIndex + Math.sign(direction);
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= group.length) return normalized;
  [group[currentIndex], group[nextIndex]] = [group[nextIndex], group[currentIndex]];
  const reordered = normalized.map((asset) => {
    const replacement = group.shift();
    return (asset.status === 'archived' ? 'archived' : 'active') === groupStatus ? replacement : asset;
  });
  return reordered.map((asset, index) => ({ ...asset, displayOrder: index }));
}

export function calculateYearSummary(assets, records, options = {}) {
  const year = Number(options.year);
  const yearRecords = recordsForYear(records, year);
  const cumulativeRecords = recordsUntilYear(records, year);
  const portfolio = calculatePortfolioSummary(assets, cumulativeRecords, options);
  const activity = calculatePortfolioSummary(assets, yearRecords, options);
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const monthRecords = yearRecords.filter((record) => new Date(record.date).getMonth() === index);
    const monthEnd = new Date(year, index + 1, 0, 23, 59, 59);
    const cumulativeMonthRecords = records.filter((record) => new Date(record.date) <= monthEnd);
    const monthActivity = calculatePortfolioSummary(assets, monthRecords, { ...options, includeArchived: true });
    const monthCumulative = calculatePortfolioSummary(assets, cumulativeMonthRecords, { ...options, includeArchived: true });
    return {
      month,
      netContribution: monthActivity.principal,
      grossRevenue: monthActivity.grossRevenue,
      realizedProfit: monthActivity.realizedProfit,
      spent: monthActivity.spent,
      trueProfit: money(monthActivity.realizedProfit - monthActivity.spent + monthCumulative.goldFloatingProfit),
      assets: monthCumulative.totalAssets,
    };
  });

  return {
    ...portfolio,
    netContribution: activity.principal,
    grossRevenue: activity.grossRevenue,
    realizedProfit: activity.realizedProfit,
    spent: activity.spent,
    trueProfit: money(activity.realizedProfit - activity.spent + portfolio.goldFloatingProfit),
    months,
  };
}

export function formatCurrency(value, currency = 'CNY') {
  const amount = Number(value) || 0;
  const sign = amount < 0 ? '-' : '';
  const absolute = Math.abs(amount);
  const prefix = currency === 'EUR' ? '€' : '¥';
  return `${sign}${prefix}${absolute.toLocaleString('zh-CN', {
    minimumFractionDigits: absolute % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(value) {
  return `${money(value).toLocaleString('zh-CN')}%`;
}

function sumByTypes(records, types) {
  return records
    .filter((record) => types.includes(record.type))
    .reduce((sum, record) => sum + (Number(record.amount) || 0), 0);
}

function findLatestAmount(records, type) {
  const matches = records
    .filter((record) => record.type === type && record.amount !== undefined)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return matches.length ? Number(matches[0].amount) : null;
}

function cnyAmount(value, currency) {
  if (currency === 'EUR') return Number(value) * 8;
  return Number(value) || 0;
}

function isInvestmentAsset(asset) {
  return ['stock', 'gold', 'crypto', 'fund'].includes(asset.category);
}

function isCashAsset(asset) {
  return asset.category === 'cash';
}
