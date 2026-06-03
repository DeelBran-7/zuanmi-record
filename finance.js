export const RECORD_TYPES = {
  capital_in: { label: '投入本金', sign: 1 },
  capital_out: { label: '取出/回款', sign: -1 },
  realized_profit: { label: '已实现盈利', sign: 1 },
  realized_loss: { label: '已实现亏损', sign: -1 },
  dividend: { label: '分红/利息', sign: 1 },
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
  const capitalIn = money(sumByTypes(assetRecords, ['capital_in', 'gold_buy']));
  const capitalOut = money(sumByTypes(assetRecords, ['capital_out']));
  const realizedProfit = money(sumByTypes(assetRecords, ['realized_profit', 'dividend']));
  const realizedLoss = money(sumByTypes(assetRecords, ['realized_loss', 'fee']));
  const latestValuation = findLatestAmount(assetRecords, 'valuation');
  const gold = asset.category === 'gold' ? getGoldSummary(asset, records, options) : null;

  let currentValue;
  let floatingProfit = null;

  if (asset.category === 'gold') {
    currentValue = gold.currentValue;
    floatingProfit = gold.floatingProfit;
  } else if (latestValuation !== null) {
    currentValue = money(latestValuation);
  } else {
    currentValue = money(capitalIn - capitalOut + realizedProfit - realizedLoss);
    if (asset.category === 'business') {
      currentValue = money(capitalIn - capitalOut);
    }
  }

  return {
    assetId: asset.id,
    name: asset.name,
    category: asset.category,
    currency: asset.currency || 'CNY',
    status: asset.status || 'active',
    principal: money(capitalIn - capitalOut),
    capitalIn,
    capitalOut,
    realizedProfit,
    realizedLoss,
    netRealized: money(realizedProfit - realizedLoss),
    currentValue,
    floatingProfit,
    recordCount: assetRecords.length,
    gold,
  };
}

export function calculatePortfolioSummary(assets, records, options = {}) {
  const activeAssets = assets.filter((asset) => asset.status !== 'archived' || options.includeArchived);
  const assetSummaries = activeAssets.map((asset) => calculateAssetSummary(asset, records, options));
  const totalAssets = money(assetSummaries.reduce((sum, asset) => sum + cnyAmount(asset.currentValue, asset.currency), 0));
  const principal = money(assetSummaries.reduce((sum, asset) => sum + cnyAmount(asset.principal, asset.currency), 0));
  const realizedProfit = money(assetSummaries.reduce((sum, asset) => sum + cnyAmount(asset.netRealized, asset.currency), 0));
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
    realizedProfit,
    goldFloatingProfit,
    trueProfit: money(realizedProfit + goldFloatingProfit),
    targetProgress: target > 0 ? money((totalAssets / target) * 100) : 0,
    targetRemaining: target > 0 ? money(Math.max(target - totalAssets, 0)) : 0,
    assets: assetSummaries,
  };
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
      realizedProfit: monthActivity.realizedProfit,
      trueProfit: money(monthActivity.realizedProfit + monthCumulative.goldFloatingProfit),
      assets: monthCumulative.totalAssets,
    };
  });

  return {
    ...portfolio,
    netContribution: activity.principal,
    realizedProfit: activity.realizedProfit,
    trueProfit: money(activity.realizedProfit + portfolio.goldFloatingProfit),
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
