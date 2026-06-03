import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAssetSummary,
  calculatePortfolioSummary,
  calculateYearSummary,
  getGoldSummary,
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

  assert.equal(summary.totalAssets, 226000);
  assert.equal(summary.principal, 195123.16);
  assert.equal(summary.realizedProfit, 40000);
  assert.equal(summary.goldFloatingProfit, 876.84);
  assert.equal(summary.targetProgress, 56.5);
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
