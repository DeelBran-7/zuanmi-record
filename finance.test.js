import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAssetSummary,
  calculatePortfolioSummary,
  calculateYearSummary,
  getGoldSummary,
  moveAssetWithinStatus,
  sortAssetsForDisplay,
} from './finance.js';

const assets = [
  { id: 'stock', name: '示例股票', category: 'stock', currency: 'CNY', status: 'active' },
  { id: 'gold', name: '示例黄金', category: 'gold', currency: 'CNY', status: 'active' },
  { id: 'business', name: '示例业务', category: 'business', currency: 'CNY', status: 'active' },
];

const records = [
  { id: 'r1', assetId: 'stock', type: 'capital_in', amount: 90000, date: '2026-07-01' },
  { id: 'r2', assetId: 'stock', type: 'realized_profit', amount: 30000, date: '2026-08-01' },
  { id: 'r3', assetId: 'gold', type: 'gold_buy', amount: 2042.46, quantity: 2, date: '2026-01-11' },
  { id: 'r4', assetId: 'gold', type: 'gold_buy', amount: 3080.7, quantity: 3, date: '2026-01-13' },
  { id: 'r5', assetId: 'business', type: 'capital_in', amount: 100000, date: '2026-01-05' },
  { id: 'r6', assetId: 'business', type: 'dividend', amount: 10000, date: '2026-04-01' },
  { id: 'r7', assetId: 'business', type: 'note', note: '分红已结算', date: '2026-04-02' },
];

test('stock assets do not calculate automatic floating profit', () => {
  const summary = calculateAssetSummary(assets[0], records, { goldPricePerGram: 1200 });

  assert.equal(summary.principal, 90000);
  assert.equal(summary.realizedProfit, 30000);
  assert.equal(summary.floatingProfit, null);
  assert.equal(summary.currentValue, 120000);
});

test('gold assets calculate grams, cost, average buy price, and floating profit', () => {
  const summary = calculateAssetSummary(assets[1], records, { goldPricePerGram: 1200 });
  const gold = getGoldSummary(assets[1], records, { goldPricePerGram: 1200 });

  assert.equal(gold.grams, 5);
  assert.equal(gold.cost, 5123.16);
  assert.equal(gold.currentValue, 6000);
  assert.equal(gold.floatingProfit, 876.84);
  assert.equal(Math.round(gold.averageBuyPrice * 100) / 100, 1024.63);
  assert.equal(summary.floatingProfit, 876.84);
});

test('portfolio summary keeps realized profit separate from gold floating profit', () => {
  const summary = calculatePortfolioSummary(assets, records, {
    year: 2026,
    target: 400000,
    goldPricePerGram: 1200,
  });

  assert.equal(summary.totalAssets, 236000);
  assert.equal(summary.principal, 195123.16);
  assert.equal(summary.grossRevenue, 40000);
  assert.equal(summary.realizedProfit, 40000);
  assert.equal(summary.goldFloatingProfit, 876.84);
  assert.equal(summary.targetProgress, 59);
});

test('year summary separates net contribution from real yearly profit', () => {
  const summary = calculateYearSummary(assets, records, {
    year: 2026,
    target: 400000,
    goldPricePerGram: 1200,
  });

  assert.equal(summary.netContribution, 195123.16);
  assert.equal(summary.realizedProfit, 40000);
  assert.equal(summary.trueProfit, 40876.84);
  assert.equal(summary.months.length, 12);
  assert.equal(summary.months[0].netContribution, 105123.16);
  assert.equal(summary.months[3].realizedProfit, 10000);
});

test('year summary carries forward prior assets without counting them as yearly contribution', () => {
  const carriedRecords = [
    { id: 'old', assetId: 'stock', type: 'capital_in', amount: 90000, date: '2025-07-01' },
    { id: 'new', assetId: 'stock', type: 'realized_profit', amount: 1000, date: '2026-02-01' },
  ];
  const summary = calculateYearSummary([assets[0]], carriedRecords, {
    year: 2026,
    target: 400000,
    goldPricePerGram: 0,
  });

  assert.equal(summary.totalAssets, 91000);
  assert.equal(summary.netContribution, 0);
  assert.equal(summary.realizedProfit, 1000);
  assert.equal(summary.months[1].assets, 91000);
});

test('asset display order keeps active and archived assets in separate ordered groups', () => {
  const orderedAssets = sortAssetsForDisplay([
    { id: 'archived-old', status: 'archived', displayOrder: 1 },
    { id: 'active-later', status: 'active', displayOrder: 20 },
    { id: 'active-first', status: 'active', displayOrder: 10 },
    { id: 'archived-new', status: 'archived', displayOrder: 2 },
  ]);

  assert.deepEqual(orderedAssets.map((asset) => asset.id), [
    'active-first',
    'active-later',
    'archived-old',
    'archived-new',
  ]);
});

test('moving an asset only reorders assets in the same status group', () => {
  const moved = moveAssetWithinStatus([
    { id: 'a', status: 'active', displayOrder: 0 },
    { id: 'b', status: 'active', displayOrder: 1 },
    { id: 'c', status: 'archived', displayOrder: 2 },
  ], 'b', -1);

  assert.deepEqual(moved.map((asset) => asset.id), ['b', 'a', 'c']);
  assert.deepEqual(moved.map((asset) => asset.displayOrder), [0, 1, 2]);
});

test('archived assets still count toward current assets', () => {
  const summary = calculatePortfolioSummary([
    { id: 'done', name: '结束项目', category: 'business', currency: 'CNY', status: 'archived' },
  ], [
    { id: 'done-capital', assetId: 'done', type: 'capital_in', amount: 100000, date: '2026-01-01' },
  ], { year: 2026, target: 400000, goldPricePerGram: 0 });

  assert.equal(summary.totalAssets, 100000);
  assert.equal(summary.assets.length, 1);
});

test('spending revenue reduces current assets but not gross revenue', () => {
  const summary = calculatePortfolioSummary([
    { id: 'business', name: '业务', category: 'business', currency: 'CNY', status: 'active' },
  ], [
    { id: 'capital', assetId: 'business', type: 'capital_in', amount: 100000, date: '2026-01-01' },
    { id: 'dividend', assetId: 'business', type: 'dividend', amount: 10000, date: '2026-03-01' },
    { id: 'spent', assetId: 'business', type: 'expense', amount: 3000, date: '2026-03-02' },
  ], { year: 2026, target: 400000, goldPricePerGram: 0 });

  assert.equal(summary.totalAssets, 107000);
  assert.equal(summary.grossRevenue, 10000);
  assert.equal(summary.spent, 3000);
  assert.equal(summary.trueProfit, 7000);
});

test('year summary separates gross revenue, spending, and retained profit', () => {
  const summary = calculateYearSummary([
    { id: 'business', name: '业务', category: 'business', currency: 'CNY', status: 'active' },
  ], [
    { id: 'capital', assetId: 'business', type: 'capital_in', amount: 100000, date: '2026-01-01' },
    { id: 'dividend', assetId: 'business', type: 'dividend', amount: 10000, date: '2026-03-01' },
    { id: 'spent', assetId: 'business', type: 'expense', amount: 3000, date: '2026-03-02' },
  ], { year: 2026, target: 400000, goldPricePerGram: 0 });

  assert.equal(summary.grossRevenue, 10000);
  assert.equal(summary.spent, 3000);
  assert.equal(summary.trueProfit, 7000);
  assert.equal(summary.months[2].grossRevenue, 10000);
  assert.equal(summary.months[2].spent, 3000);
});

test('spending is deducted from gold and valuation based current assets', () => {
  const summary = calculatePortfolioSummary([
    { id: 'gold', name: '黄金', category: 'gold', currency: 'CNY', status: 'active' },
    { id: 'valuation', name: '估值项目', category: 'business', currency: 'CNY', status: 'active' },
  ], [
    { id: 'gold-buy', assetId: 'gold', type: 'gold_buy', amount: 2000, quantity: 2, date: '2026-01-01' },
    { id: 'gold-spent', assetId: 'gold', type: 'expense', amount: 100, date: '2026-01-02' },
    { id: 'valuation-now', assetId: 'valuation', type: 'valuation', amount: 5000, date: '2026-01-03' },
    { id: 'valuation-spent', assetId: 'valuation', type: 'expense', amount: 300, date: '2026-01-04' },
  ], { year: 2026, target: 400000, goldPricePerGram: 1000 });

  assert.equal(summary.assets.find((asset) => asset.assetId === 'gold').currentValue, 1900);
  assert.equal(summary.assets.find((asset) => asset.assetId === 'valuation').currentValue, 4700);
  assert.equal(summary.spent, 400);
  assert.equal(summary.totalAssets, 6600);
});
