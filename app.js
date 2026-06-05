import {
  RECORD_TYPES,
  calculateAssetSummary,
  buildAssetAnalytics,
  calculatePortfolioSummary,
  calculateYearSummary,
  formatCurrency,
  formatPercent,
  money,
  moveAssetWithinStatus,
  normalizeAssetOrder,
  recordsUntilYear,
  sortAssetsForDisplay,
} from './finance.js';
import { getBrowserPublicSyncConfig, normalizeEmail, resolveSyncSettings } from './sync-config.js';

const STORAGE_KEY = 'zuanmi-record-state-v2';
const OWNER_KEY = 'zuanmi-record-owner-v1';
const TROY_OUNCE_GRAMS = 31.1034768;
const today = new Date().toISOString().slice(0, 10);
const publicSyncConfig = getBrowserPublicSyncConfig();
const ASSET_CATEGORY_OPTIONS = {
  cashflow: [
    { value: 'business', label: '业务/实体投资' },
    { value: 'other', label: '其他实体资产' },
  ],
  investment: [
    { value: 'stock', label: '股票账户' },
    { value: 'gold', label: '黄金账户' },
    { value: 'crypto', label: 'Crypto' },
    { value: 'fund', label: '基金账户' },
  ],
  cash: [
    { value: 'cash', label: '现金/工资/存款' },
  ],
};

const defaultState = {
  settings: {
    selectedYear: 2026,
    targets: { 2026: 400000 },
    goldPricePerGram: 0,
    goldPriceSource: '',
    goldPriceUpdatedAt: '',
    initialized: false,
    sync: { supabaseUrl: '', anonKey: '', email: '' },
  },
  assets: [],
  records: [],
};

const demoState = {
  settings: {
    ...structuredClone(defaultState.settings),
    selectedYear: 2026,
    targets: { 2026: 400000, 2027: 500000 },
    initialized: true,
  },
  assets: [
    { id: 'demo-business', name: '示例业务投资', category: 'business', currency: 'CNY', status: 'active', note: '演示：业务项目可记录投入、分红和回款' },
    { id: 'demo-stock', name: '示例股票账户', category: 'stock', currency: 'CNY', status: 'active', note: '演示：股票不自动算浮亏，只统计手动记录' },
    { id: 'demo-gold', name: '示例黄金', category: 'gold', currency: 'CNY', status: 'active', note: '演示：黄金可按克数和金价估值' },
    { id: 'demo-side-income', name: '示例副业收入', category: 'cash', currency: 'CNY', status: 'active', note: '演示：工资/副业/现金流也可以记录' },
    { id: 'demo-archived', name: '示例已归档项目', category: 'business', currency: 'CNY', status: 'archived', note: '演示：归档后保留历史，不默认展示在首页' },
  ],
  records: [
    { id: 'demo-r-1', assetId: 'demo-business', type: 'capital_in', amount: 30000, date: '2026-01-05', note: '演示业务本金' },
    { id: 'demo-r-2', assetId: 'demo-business', type: 'dividend', amount: 2400, date: '2026-04-12', note: '演示分红' },
    { id: 'demo-r-3', assetId: 'demo-stock', type: 'capital_in', amount: 50000, date: '2025-08-01', note: '演示股票本金' },
    { id: 'demo-r-4', assetId: 'demo-stock', type: 'realized_profit', amount: 3600, date: '2026-03-20', note: '演示已实现盈利' },
    { id: 'demo-r-5', assetId: 'demo-stock', type: 'realized_loss', amount: 900, date: '2026-06-08', note: '演示已实现亏损' },
    { id: 'demo-r-6', assetId: 'demo-gold', type: 'gold_buy', amount: 4200, quantity: 4, date: '2026-01-18', note: '演示黄金买入' },
    { id: 'demo-r-7', assetId: 'demo-gold', type: 'gold_buy', amount: 3300, quantity: 3, date: '2026-03-02', note: '演示黄金买入' },
    { id: 'demo-r-8', assetId: 'demo-side-income', type: 'realized_profit', amount: 1800, date: '2026-02-28', note: '演示副业收入' },
    { id: 'demo-r-9', assetId: 'demo-side-income', type: 'realized_profit', amount: 2200, date: '2026-04-30', note: '演示副业收入' },
    { id: 'demo-r-10', assetId: 'demo-archived', type: 'capital_in', amount: 8000, date: '2025-10-01', note: '演示已归档项目本金' },
    { id: 'demo-r-11', assetId: 'demo-archived', type: 'realized_loss', amount: 1200, date: '2026-01-22', note: '演示归档项目亏损' },
  ],
};

let state = loadState();
let currentView = 'dashboard';
let supabaseClient = null;
let currentSession = null;
let autoCloudDownloadUserId = null;
let reorderAssetId = null;
let longPressTimer = null;
let passwordResetMode = false;
let authMode = 'signin';

const elements = {
  appShell: document.querySelector('#appShell'),
  authGate: document.querySelector('#authGate'),
  authEmailInput: document.querySelector('#authEmailInput'),
  authPasswordInput: document.querySelector('#authPasswordInput'),
  authPasswordConfirmInput: document.querySelector('#authPasswordConfirmInput'),
  authSignInButton: document.querySelector('#authSignInButton'),
  authSignUpButton: document.querySelector('#authSignUpButton'),
  authModeToggle: document.querySelector('#authModeToggle'),
  authModeButtons: document.querySelectorAll('[data-auth-mode]'),
  authConfirmField: document.querySelector('#authConfirmField'),
  authTitle: document.querySelector('#authTitle'),
  authSubtitle: document.querySelector('#authSubtitle'),
  authModeHint: document.querySelector('#authModeHint'),
  authForgotPasswordButton: document.querySelector('#authForgotPasswordButton'),
  yearStrip: document.querySelector('#yearStrip'),
  tabs: document.querySelectorAll('.tab-button'),
  views: {
    dashboard: document.querySelector('#dashboardView'),
    assets: document.querySelector('#assetsView'),
    year: document.querySelector('#yearView'),
    records: document.querySelector('#recordsView'),
    sync: document.querySelector('#syncView'),
  },
  recordDialog: document.querySelector('#recordDialog'),
  recordForm: document.querySelector('#recordForm'),
  yearDialog: document.querySelector('#yearDialog'),
  yearForm: document.querySelector('#yearForm'),
  assetDialog: document.querySelector('#assetDialog'),
  assetForm: document.querySelector('#assetForm'),
  assetDetailDialog: document.querySelector('#assetDetailDialog'),
  assetDetail: document.querySelector('#assetDetail'),
  importDialog: document.querySelector('#importDialog'),
  importForm: document.querySelector('#importForm'),
  onboardingDialog: document.querySelector('#onboardingDialog'),
  onboardingForm: document.querySelector('#onboardingForm'),
  toast: document.querySelector('#toast'),
};

init();

function init() {
  document.querySelector('#quickRecordButton').addEventListener('click', openRecordDialog);
  document.querySelector('#exportButton').addEventListener('click', exportState);
  elements.authSignInButton?.addEventListener('click', signInWithPassword);
  elements.authSignUpButton?.addEventListener('click', signUpWithPassword);
  elements.authModeToggle?.addEventListener('click', () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin'));
  elements.authModeButtons.forEach((button) => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
  elements.authForgotPasswordButton?.addEventListener('click', requestPasswordReset);
  elements.tabs.forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  elements.recordForm.addEventListener('submit', handleRecordSubmit);
  elements.yearForm.addEventListener('submit', handleYearSubmit);
  elements.assetForm.addEventListener('submit', handleAssetSubmit);
  elements.assetForm.elements.assetClassHint?.addEventListener('change', syncAssetCategoryOptions);
  elements.importForm.addEventListener('submit', handleImportSubmit);
  elements.onboardingForm.addEventListener('submit', handleOnboardingSubmit);
  document.addEventListener('click', (event) => {
    if (event.target.matches('[data-close-dialog]')) {
      event.target.closest('dialog')?.close();
    }
    if (event.target.matches('[data-action="load-demo"]')) {
      loadDemoData();
    }
  });
  registerServiceWorker();
  setAuthMode('signin');
  initSupabaseClient();
  render();
  showOnboardingIfNeeded();
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(defaultState);
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return structuredClone(defaultState);
  }
}

function normalizeState(input) {
  const settings = { ...structuredClone(defaultState.settings), ...(input.settings || {}) };
  const records = Array.isArray(input.records) ? normalizeRecords(input.records) : [];
  return {
    settings: { ...settings, sync: resolveSyncSettings(settings.sync, publicSyncConfig) },
    assets: Array.isArray(input.assets) ? normalizeAssetOrder(input.assets) : [],
    records,
  };
}

function normalizeRecords(records) {
  return records.map((record) => {
    if (
      record.id === 'rec-gold-13'
      && record.assetId === 'asset-gold'
      && record.type === 'gold_buy'
      && Number(record.quantity) === 2
      && Number(record.amount) === 981
    ) {
      return { ...record, amount: 1981.59, note: '黄金买入 2g，按工行截图校准' };
    }
    return record;
  });
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  updateAuthGate();
  if (requiresLogin()) return;
  renderYearStrip();
  renderDashboard();
  renderAssets();
  renderYear();
  renderRecords();
  renderSync();
  populateRecordForm();
  applyCurrentView();
}

function renderYearStrip() {
  const years = getKnownYears();
  elements.yearStrip.innerHTML = years.map((year) => `
    <button class="chip ${year === state.settings.selectedYear ? 'active' : ''}" data-year="${year}">${year}</button>
  `).join('') + '<button class="chip" data-action="add-year">+ 年份</button>';
  elements.yearStrip.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.action === 'add-year') {
        addYear();
        return;
      }
      state.settings.selectedYear = Number(button.dataset.year);
      saveState();
      render();
    });
  });
}

function renderDashboard() {
  const summary = getPortfolio();
  const yearSummary = getYear();
  const recentRecords = getSortedRecords().slice(0, 6);
  const activeAssets = summary.assets.filter((asset) => asset.status !== 'archived');

  elements.views.dashboard.innerHTML = `
    <div class="dashboard-grid">
      <section>
        <article class="hero-card">
          <div class="hero-top">
            <span>${state.settings.selectedYear} 目前资产</span>
            <span>目标 ${formatCurrency(summary.target)}</span>
          </div>
          <div class="hero-number">${formatCurrency(summary.totalAssets)}</div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${Math.min(summary.targetProgress, 100)}%"></div>
          </div>
          <div class="hero-meta">
            <span>还差 ${formatCurrency(summary.targetRemaining)}</span>
            <span>${formatPercent(summary.targetProgress)}</span>
          </div>
        </article>

        <div class="metric-grid">
          ${metric('总营收', formatCurrency(summary.grossRevenue))}
          ${metric('已花掉', formatCurrency(summary.spent), summary.spent > 0 ? 'loss' : '')}
          ${metric('投资盈亏', signedCurrency(summary.investmentProfit), summary.investmentProfit >= 0 ? 'profit' : 'loss')}
        </div>

        <section class="panel compact-panel">
          <div class="panel-header">
            <div>
              <h3>实时金价</h3>
              <p class="small-muted">${goldPriceStatus()}</p>
            </div>
            <button class="ghost-button" data-action="fetch-gold">更新金价</button>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <h2>${state.settings.selectedYear} 年度回看</h2>
            <button class="ghost-button" data-action="year-view">查看详情</button>
          </div>
          <div class="month-list">
            ${yearSummary.months.filter((month) => month.netContribution || month.realizedProfit || month.assets).slice(0, 5).map(renderMonthRow).join('') || empty('这一年还没有记录')}
          </div>
        </section>
      </section>

      <aside>
        <section class="panel">
          <div class="panel-header">
            <h2>资产项目</h2>
            <button class="ghost-button" data-action="new-asset">新增</button>
          </div>
          <div class="asset-list">
            ${activeAssets.map(renderAssetCard).join('') || empty('还没有资产项目，点“新增”创建你的第一项资产')}
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <h2>最近记录</h2>
            <button class="ghost-button" data-action="records-view">全部</button>
          </div>
          <div class="record-list">
            ${recentRecords.map(renderRecordRow).join('') || empty('还没有记录，点“记一笔”开始')}
          </div>
        </section>
      </aside>
    </div>
  `;

  bindCommonActions(elements.views.dashboard);
}

function renderAssets() {
  const orderedAssets = sortAssetsForDisplay(state.assets);
  const summaries = orderedAssets.map((asset) => calculateAssetSummary(asset, state.records, {
    goldPricePerGram: state.settings.goldPricePerGram,
  }));
  const activeSummaries = summaries.filter((asset) => asset.status !== 'archived');
  const cashflowSummaries = activeSummaries.filter((asset) => asset.assetClass === 'cashflow');
  const investmentSummaries = activeSummaries.filter((asset) => asset.assetClass === 'investment');
  const cashSummaries = activeSummaries.filter((asset) => asset.assetClass === 'cash');
  const archivedSummaries = summaries.filter((asset) => asset.status === 'archived');
  elements.views.assets.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>资产管理</h2>
          <p class="small-muted">资产按业务逻辑分组。长按资产可调整顺序，归档只代表项目结束。</p>
        </div>
        <button class="primary-button" data-action="new-asset">新增资产</button>
      </div>
      ${renderAssetGroup('实体 / 现金流资产', '分红、工资、汇率差和业务回款会进入总营收或现金流。', cashflowSummaries, '还没有实体或现金流资产')}
      ${renderAssetGroup('投资账户资产', '股票、黄金、基金、Crypto 的账户内收益进入投资盈亏，不混入总营收。', investmentSummaries, '还没有投资账户资产')}
      ${renderAssetGroup('当前存款 / 收入账户', '工资、存款和备用金归在这里，用来承接实体项目留下来的钱。', cashSummaries, '还没有当前存款或收入账户')}
    </section>
    <section class="panel archive-panel">
      <div class="panel-header">
        <div>
          <h2>归档资产</h2>
          <p class="small-muted">已经结束或暂时不看的资产会在这里，点进去可以恢复。</p>
        </div>
      </div>
      <div class="asset-list">
        ${archivedSummaries.map(renderAssetCard).join('') || empty('还没有归档资产')}
      </div>
    </section>
  `;
  bindCommonActions(elements.views.assets);
}

function renderAssetGroup(title, description, summaries, emptyText) {
  return `
    <div class="asset-group">
      <div class="asset-group-header">
        <div>
          <h3>${title}</h3>
          <p class="small-muted">${description}</p>
        </div>
        <span class="asset-count">${summaries.length}</span>
      </div>
      <div class="asset-list">
        ${summaries.map(renderAssetCard).join('') || empty(emptyText)}
      </div>
    </div>
  `;
}

function renderYear() {
  const summary = getYear();
  elements.views.year.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>${state.settings.selectedYear} 年度复盘</h2>
          <p class="small-muted">这里把目前资产、总营收、消费和净投入分开看。</p>
        </div>
      </div>
      <div class="metric-grid">
        ${metric('目前资产', formatCurrency(summary.totalAssets))}
        ${metric('总营收', formatCurrency(summary.grossRevenue))}
        ${metric('已花掉', formatCurrency(summary.spent), summary.spent > 0 ? 'loss' : '')}
        ${metric('投资盈亏', signedCurrency(summary.investmentProfit), summary.investmentProfit >= 0 ? 'profit' : 'loss')}
        ${metric('年度净投入', formatCurrency(summary.netContribution))}
        ${metric('净增长', signedCurrency(summary.trueProfit), summary.trueProfit >= 0 ? 'profit' : 'loss')}
      </div>
      <div class="month-list">
        ${summary.months.map(renderMonthRow).join('')}
      </div>
    </section>
  `;
}

function renderRecords() {
  elements.views.records.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>记录明细</h2>
          <p class="small-muted">所有汇总数字都来自这里。</p>
        </div>
        <button class="primary-button" data-action="new-record">记一笔</button>
      </div>
      <div class="record-list">
        ${getSortedRecords().map(renderRecordRow).join('') || empty('还没有记录')}
      </div>
    </section>
  `;
  bindCommonActions(elements.views.records);
}

function renderSync() {
  const sync = getSyncSettings();
  const configured = Boolean(sync.supabaseUrl && sync.anonKey);
  const signedIn = Boolean(currentSession?.user);
  const technicalFields = sync.usesPublicConfig ? `
        <div class="sync-ready">
          <strong>云同步已接入</strong>
          <span>你和朋友只需要用自己的邮箱登录，账本会自动按账号分开。</span>
        </div>
      ` : `
        <label>Supabase URL<input id="supabaseUrl" value="${escapeAttr(sync.supabaseUrl)}" placeholder="https://xxxx.supabase.co"></label>
        <label>Anon Key<input id="anonKey" value="${escapeAttr(sync.anonKey)}" placeholder="ey..."></label>
        <label>登录邮箱<input id="syncEmail" value="${escapeAttr(sync.email)}" placeholder="you@example.com"></label>
      `;
  elements.views.sync.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>同步与备份</h2>
          <p class="small-muted">本地可用；接入云同步后可用邮箱登录并多设备同步。</p>
        </div>
      </div>
      <div class="settings-grid">
        ${technicalFields}
        <label>当前金价 / 克<input id="goldPrice" type="number" step="0.01" value="${state.settings.goldPricePerGram || ''}" placeholder="例如 980"></label>
        <label>当前年份目标<input id="yearTarget" type="number" step="1" value="${getTarget() || ''}" placeholder="例如 400000"></label>
      </div>
      <p class="small-muted">${goldPriceStatus()}</p>
      <div class="panel cloud-panel">
        <div class="panel-header">
          <div>
            <h3>邮箱登录同步</h3>
            <p class="small-muted">${cloudStatusText(configured, signedIn)}</p>
          </div>
        </div>
        ${renderCloudAuth(configured, signedIn)}
      </div>
      <div class="button-row">
        <button class="primary-button" data-action="save-settings">保存设置</button>
        <button class="ghost-button" data-action="fetch-gold">实时更新金价</button>
        <button class="ghost-button" data-action="export">导出 JSON</button>
        <button class="ghost-button" data-action="import">导入 JSON</button>
        <button class="ghost-button" data-action="demo">载入演示模板</button>
        <button class="ghost-button" data-action="reset">清空账本</button>
      </div>
    </section>
  `;
  bindCommonActions(elements.views.sync);
}

function renderAssetCard(assetSummary) {
  const asset = state.assets.find((item) => item.id === assetSummary.assetId) || assetSummary;
  const pillClass = asset.status === 'archived' ? 'archived' : asset.status === 'paused' ? 'paused' : '';
  const isReordering = reorderAssetId === assetSummary.assetId;
  const performanceLabel = assetSummary.assetClass === 'investment' ? '账户盈亏' : assetSummary.assetClass === 'cash' ? '现金增减' : '现金流';
  const performanceValue = assetSummary.assetClass === 'investment' ? assetSummary.investmentProfit : assetSummary.retainedRevenue;
  return `
    <article class="asset-card ${isReordering ? 'reordering' : ''}" data-action="asset-detail" data-asset-id="${assetSummary.assetId}" tabindex="0" role="button" aria-label="${escapeAttr(assetSummary.name)} 详情">
      <div class="asset-identity">
        <span class="asset-icon ${asset.category}">${categoryIcon(asset.category)}</span>
        <div>
          <strong>${escapeHtml(assetSummary.name)}</strong>
          <div class="asset-meta">${categoryLabel(asset.category)} · ${asset.currency} · <span class="status-pill ${pillClass}">${statusLabel(asset.status)}</span></div>
        </div>
      </div>
      <div class="asset-note">
        <div class="asset-meta">${escapeHtml(asset.note || '')}</div>
        <div class="asset-meta reorder-hint">${isReordering ? '排序模式' : '长按调整顺序'}</div>
      </div>
      <div class="asset-values">
        <strong>${formatCurrency(assetSummary.currentValue, asset.currency)}</strong>
        <div class="asset-meta">本金 ${formatCurrency(assetSummary.principal, asset.currency)}</div>
        <div class="${performanceValue >= 0 ? 'profit' : 'loss'}">${performanceLabel} ${signedCurrency(performanceValue, asset.currency)}</div>
      </div>
      ${isReordering ? `
        <div class="reorder-controls">
          <button class="ghost-button" data-action="move-asset-up" data-asset-id="${assetSummary.assetId}">上移</button>
          <button class="ghost-button" data-action="move-asset-down" data-asset-id="${assetSummary.assetId}">下移</button>
          <button class="primary-button" data-action="finish-reorder">完成</button>
        </div>
      ` : ''}
    </article>
  `;
}

function renderRecordRow(record) {
  const asset = state.assets.find((item) => item.id === record.assetId);
  const type = RECORD_TYPES[record.type]?.label || record.type;
  const amount = record.type === 'note' ? escapeHtml(record.note || '') : signedByType(record, asset?.currency);
  const tone = recordTone(record.type);
  return `
    <div class="record-row">
      <div>
        <strong>${escapeHtml(asset?.name || '未知资产')}</strong>
        <div class="record-meta">${record.date}</div>
      </div>
      <div><span class="record-type-chip">${type}</span></div>
      <div class="record-amount ${tone}">${amount}</div>
      <button class="ghost-button" data-action="delete-record" data-record-id="${record.id}">删除</button>
    </div>
  `;
}

function renderMonthRow(month) {
  return `
    <div class="month-row">
      <strong>${month.month}月</strong>
      <span>投入 ${formatCurrency(month.netContribution)}</span>
      <span>营收 ${formatCurrency(month.grossRevenue)}</span>
      <span class="${month.spent > 0 ? 'loss' : ''}">花掉 ${formatCurrency(month.spent)}</span>
      <span>资产 ${formatCurrency(month.assets)}</span>
    </div>
  `;
}

function renderAssetDetail(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  const summary = calculateAssetSummary(asset, state.records, {
    goldPricePerGram: state.settings.goldPricePerGram,
  });
  const records = state.records.filter((record) => record.assetId === assetId).sort((a, b) => new Date(b.date) - new Date(a.date));
  const insightHtml = renderAssetInsights(asset, summary, records);
  const goldHtml = summary.gold ? `
    <section class="panel">
      <h3>黄金估值</h3>
      <div class="detail-grid">
        ${metric('持有克数', `${summary.gold.grams}g`)}
        ${metric('市价/克', summary.gold.currentPrice ? `${summary.gold.currentPrice}/g` : '待金价')}
        ${metric('总成本', formatCurrency(summary.gold.cost))}
        ${metric('平均买入', `${Math.round(summary.gold.averageBuyPrice * 100) / 100}/g`)}
        ${metric('黄金浮盈', summary.gold.floatingProfit === null ? '待金价' : signedCurrency(summary.gold.floatingProfit), summary.gold.floatingProfit >= 0 ? 'profit' : 'loss')}
        ${metric('盈亏比', summary.gold.floatingProfit === null || !summary.gold.cost ? '待金价' : formatPercent((summary.gold.floatingProfit / summary.gold.cost) * 100), summary.gold.floatingProfit >= 0 ? 'profit' : 'loss')}
      </div>
    </section>
  ` : '';

  elements.assetDetail.innerHTML = `
    <div class="modal-header">
      <div>
        <p class="eyebrow">资产详情</p>
        <h2>${escapeHtml(asset.name)}</h2>
        <p class="small-muted">${categoryLabel(asset.category)} · ${asset.currency} · ${statusLabel(asset.status)}</p>
      </div>
      <button class="icon-button" data-action="close-detail" aria-label="关闭">×</button>
    </div>
    <article class="hero-card">
      <div class="hero-top">
        <span>目前价值</span>
        <span>${asset.note ? escapeHtml(asset.note) : '可持续记录'}</span>
      </div>
      <div class="hero-number">${formatCurrency(summary.currentValue, asset.currency)}</div>
      <div class="hero-meta">
        <span>本金 ${formatCurrency(summary.principal, asset.currency)}</span>
        <span>${summary.assetClass === 'investment' ? '账户盈亏' : '现金流'} ${signedCurrency(summary.assetClass === 'investment' ? summary.investmentProfit : summary.retainedRevenue, asset.currency)}</span>
      </div>
    </article>
    <div class="metric-grid">
      ${metric('投入本金', formatCurrency(summary.capitalIn, asset.currency))}
      ${metric('回款/取出', formatCurrency(summary.capitalOut, asset.currency))}
      ${metric(summary.assetClass === 'investment' ? '账户内收益' : '总营收', formatCurrency(summary.grossRevenue, asset.currency))}
      ${metric('已花掉', formatCurrency(summary.spent, asset.currency), summary.spent > 0 ? 'loss' : '')}
      ${metric(summary.assetClass === 'investment' ? '账户收益率' : '现金流率', summary.principal ? formatPercent(((summary.assetClass === 'investment' ? summary.investmentProfit : summary.retainedRevenue) / summary.principal) * 100) : '0%')}
    </div>
    ${insightHtml}
    ${goldHtml}
    <section class="panel">
      <div class="panel-header">
        <h3>记录明细</h3>
        <div class="button-row detail-actions">
          <button class="ghost-button" data-action="toggle-archive" data-asset-id="${asset.id}">${asset.status === 'archived' ? '恢复' : '归档'}</button>
          <button class="ghost-button danger-button" data-action="delete-asset" data-asset-id="${asset.id}">删除资产</button>
          <button class="primary-button" data-action="new-record-for-asset" data-asset-id="${asset.id}">新增记录</button>
        </div>
      </div>
      <div class="record-list">${records.map(renderRecordRow).join('') || empty('这个资产还没有记录')}</div>
    </section>
  `;
  bindCommonActions(elements.assetDetail);
  elements.assetDetailDialog.showModal();
}

function renderAssetInsights(asset, summary, records) {
  const analytics = buildAssetAnalytics(records);
  const profitLabel = summary.assetClass === 'investment' ? '账户净变化' : '现金流净变化';
  return `
    <section class="panel asset-insight-panel">
      <div class="panel-header">
        <div>
          <h3>收入分析</h3>
          <p class="small-muted">先看汇总和趋势，再按需翻下面的原始明细。</p>
        </div>
        <span class="asset-count">${records.length}</span>
      </div>
      <div class="insight-grid">
        ${metric(profitLabel, signedCurrency(analytics.total.net, asset.currency), analytics.total.net >= 0 ? 'profit' : 'loss')}
        ${metric(summary.assetClass === 'investment' ? '账户内收入' : '累计收入', formatCurrency(analytics.total.income, asset.currency))}
        ${metric('累计支出/亏损', formatCurrency(analytics.total.loss + analytics.total.expense, asset.currency), analytics.total.loss + analytics.total.expense > 0 ? 'loss' : '')}
        ${metric('记录跨度', analytics.dateRange)}
      </div>
      <div class="analysis-layout">
        <div class="analysis-card trend-card">
          <div class="analysis-card-header">
            <strong>按月累计趋势</strong>
            <span>${analytics.months.length ? `${analytics.months.length} 个月` : '暂无数据'}</span>
          </div>
          ${renderTrendChart(analytics.months, asset.currency)}
        </div>
        <div class="analysis-card">
          <div class="analysis-card-header">
            <strong>类型占比</strong>
            <span>${analytics.typeTotals.length} 类</span>
          </div>
          ${renderTypeBreakdown(analytics.typeTotals, asset.currency)}
        </div>
      </div>
      <div class="analysis-layout lower">
        <div class="analysis-card">
          <div class="analysis-card-header">
            <strong>近 12 个月</strong>
            <span>月度汇总</span>
          </div>
          ${renderMonthlyBreakdown(analytics.months.slice(-12), asset.currency)}
        </div>
        <div class="analysis-card">
          <div class="analysis-card-header">
            <strong>年度汇总</strong>
            <span>${analytics.years.length} 年</span>
          </div>
          ${renderYearBreakdown(analytics.years, asset.currency)}
        </div>
      </div>
    </section>
  `;
}

function renderTrendChart(months, currency) {
  if (!months.length) return empty('还没有可分析的收入记录');
  let cumulative = 0;
  const series = months.map((month) => {
    cumulative = money(cumulative + month.net);
    return { label: month.label, value: cumulative, net: month.net };
  });
  const values = series.map((item) => item.value).concat(0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max === min ? 1 : max - min;
  const width = 360;
  const height = 132;
  const padding = 18;
  const chartPoints = series.map((item, index) => {
    const x = series.length === 1 ? width / 2 : padding + index * ((width - padding * 2) / (series.length - 1));
    const y = height - padding - ((item.value - min) / range) * (height - padding * 2);
    return { ...item, x: money(x), y: money(y) };
  });
  const points = chartPoints.map((item) => `${item.x},${item.y}`).join(' ');
  const zeroY = height - padding - ((0 - min) / range) * (height - padding * 2);
  const last = series.at(-1);
  return `
    <div class="chart-wrap">
      <svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="按月累计趋势">
        <line x1="${padding}" y1="${money(zeroY)}" x2="${width - padding}" y2="${money(zeroY)}" class="chart-zero"></line>
        <polyline points="${points}" class="chart-line"></polyline>
        ${chartPoints.map((item) => `<circle cx="${item.x}" cy="${item.y}" r="3.4" class="chart-dot"><title>${item.label} ${formatCurrency(item.value, currency)}</title></circle>`).join('')}
      </svg>
      <div class="chart-summary">
        <span>累计 ${signedCurrency(last.value, currency)}</span>
        <span>最近 ${last.label} ${signedCurrency(last.net, currency)}</span>
      </div>
    </div>
  `;
}

function renderTypeBreakdown(typeTotals, currency) {
  if (!typeTotals.length) return empty('还没有类型统计');
  const max = Math.max(...typeTotals.map((item) => item.amount), 1);
  return `
    <div class="bar-list">
      ${typeTotals.map((item) => {
        const width = Math.max((item.amount / max) * 100, item.amount > 0 ? 8 : 2);
        const tone = item.sign < 0 ? 'loss' : item.sign > 0 ? 'profit' : '';
        return `
          <div class="bar-row">
            <div class="bar-row-top">
              <span>${item.label}</span>
              <strong class="${tone}">${item.amount ? formatCurrency(item.amount, currency) : `${item.count} 条`}</strong>
            </div>
            <div class="bar-track"><span class="${tone}" style="width: ${width}%"></span></div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderMonthlyBreakdown(months, currency) {
  if (!months.length) return empty('还没有月度记录');
  return `
    <div class="summary-list">
      ${[...months].reverse().map((month) => renderFlowSummaryRow(month.label, month, currency)).join('')}
    </div>
  `;
}

function renderYearBreakdown(years, currency) {
  if (!years.length) return empty('还没有年度记录');
  return `
    <div class="summary-list">
      ${years.map((year) => renderFlowSummaryRow(`${year.label}年`, year, currency)).join('')}
    </div>
  `;
}

function renderFlowSummaryRow(label, bucket, currency) {
  const totalCost = money(bucket.loss + bucket.expense);
  return `
    <div class="flow-row">
      <div>
        <strong>${label}</strong>
        <span>${bucket.count} 条</span>
      </div>
      <div>
        <span>投入 ${formatCurrency(bucket.capitalIn, currency)}</span>
        <span>收入 ${formatCurrency(bucket.income, currency)}</span>
        <span class="${totalCost > 0 ? 'loss' : ''}">支出 ${formatCurrency(totalCost, currency)}</span>
      </div>
      <strong class="${bucket.net >= 0 ? 'profit' : 'loss'}">${signedCurrency(bucket.net, currency)}</strong>
    </div>
  `;
}

function populateRecordForm(assetId = '') {
  const assetSelect = elements.recordForm.elements.assetId;
  const typeSelect = elements.recordForm.elements.type;
  assetSelect.innerHTML = state.assets.map((asset) => `<option value="${asset.id}">${escapeHtml(asset.name)}</option>`).join('');
  typeSelect.innerHTML = Object.entries(RECORD_TYPES).map(([value, config]) => `<option value="${value}">${config.label}</option>`).join('');
  elements.recordForm.elements.date.value = today;
  if (assetId) assetSelect.value = assetId;
}

function openRecordDialog(assetId = '') {
  elements.recordForm.reset();
  populateRecordForm(assetId);
  elements.recordDialog.showModal();
}

function handleRecordSubmit(event) {
  event.preventDefault();
  const form = new FormData(elements.recordForm);
  const record = {
    id: `r-${Date.now()}`,
    assetId: form.get('assetId'),
    type: form.get('type'),
    amount: Number(form.get('amount')) || 0,
    quantity: Number(form.get('quantity')) || undefined,
    date: form.get('date'),
    note: form.get('note').trim(),
  };
  if (record.type === 'note') record.amount = 0;
  state.records.push(record);
  saveState();
  elements.recordDialog.close();
  toast('已保存记录');
  render();
}

function handleAssetSubmit(event) {
  event.preventDefault();
  const form = new FormData(elements.assetForm);
  const category = normalizeAssetCategoryByClass(form.get('assetClassHint'), form.get('category'));
  state.assets.push({
    id: `asset-${Date.now()}`,
    name: form.get('name').trim(),
    category,
    currency: form.get('currency'),
    status: form.get('status'),
    note: form.get('note').trim(),
    displayOrder: nextAssetDisplayOrder(),
  });
  state.assets = normalizeAssetOrder(state.assets);
  saveState();
  elements.assetDialog.close();
  toast('已新增资产');
  render();
}

function openAssetDialog() {
  elements.assetForm.reset();
  syncAssetCategoryOptions();
  elements.assetDialog.showModal();
}

function syncAssetCategoryOptions() {
  const assetClassHint = elements.assetForm.elements.assetClassHint?.value;
  const categorySelect = elements.assetForm.elements.category;
  if (!categorySelect) return;
  const previousCategory = categorySelect.value;
  const options = ASSET_CATEGORY_OPTIONS[assetClassHint] || ASSET_CATEGORY_OPTIONS.cashflow;
  categorySelect.innerHTML = options
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join('');
  if (options.some((option) => option.value === previousCategory)) {
    categorySelect.value = previousCategory;
  }
}

function normalizeAssetCategoryByClass(assetClassHint, category) {
  const options = ASSET_CATEGORY_OPTIONS[assetClassHint] || ASSET_CATEGORY_OPTIONS.cashflow;
  if (!options.some((option) => option.value === category)) return options[0].value;
  return category;
}

function handleImportSubmit(event) {
  event.preventDefault();
  const payload = elements.importForm.elements.payload.value;
  try {
    const imported = JSON.parse(payload);
    if (!Array.isArray(imported.assets) || !Array.isArray(imported.records)) {
      throw new Error('Invalid shape');
    }
    state = {
      settings: { ...structuredClone(defaultState.settings), ...(imported.settings || {}), initialized: true },
      assets: normalizeAssetOrder(imported.assets),
      records: imported.records,
    };
    saveState();
    elements.importDialog.close();
    toast('导入完成');
    render();
  } catch {
    toast('导入失败，请检查 JSON');
  }
}

function handleOnboardingSubmit(event) {
  event.preventDefault();
  const form = new FormData(elements.onboardingForm);
  const year = Number(form.get('year')) || new Date().getFullYear();
  const target = Number(form.get('target')) || 0;
  state = structuredClone(defaultState);
  state.settings.initialized = true;
  state.settings.selectedYear = year;
  state.settings.targets = { [year]: target };
  saveState();
  elements.onboardingDialog.close();
  toast('空账本已创建');
  render();
}

function loadDemoData() {
  state = normalizeState(demoState);
  saveState();
  elements.onboardingDialog.close();
  toast('已载入演示模板');
  render();
}

function bindCommonActions(root) {
  root.querySelectorAll('[data-action]').forEach((element) => {
    element.addEventListener('click', (event) => {
      const action = element.dataset.action;
      if (action === 'asset-detail' && event.target.closest('.reorder-controls')) return;
      if (action !== 'asset-detail') event.stopPropagation();
      if (action === 'new-record') openRecordDialog();
      if (action === 'new-record-for-asset') openRecordDialog(element.dataset.assetId);
      if (action === 'new-asset') openAssetDialog();
      if (action === 'asset-detail') renderAssetDetail(element.dataset.assetId);
      if (action === 'year-view') switchView('year');
      if (action === 'records-view') switchView('records');
      if (action === 'delete-record') deleteRecord(element.dataset.recordId);
      if (action === 'delete-asset') deleteAsset(element.dataset.assetId);
      if (action === 'toggle-archive') toggleArchive(element.dataset.assetId);
      if (action === 'move-asset-up') moveAssetOrder(element.dataset.assetId, -1);
      if (action === 'move-asset-down') moveAssetOrder(element.dataset.assetId, 1);
      if (action === 'finish-reorder') finishAssetReorder();
      if (action === 'close-detail') elements.assetDetailDialog.close();
      if (action === 'save-settings') saveSettings();
      if (action === 'fetch-gold') fetchGoldPrice();
      if (action === 'sign-in-password') signInWithPassword();
      if (action === 'sign-up-password') signUpWithPassword();
      if (action === 'forgot-password') requestPasswordReset();
      if (action === 'update-password') updatePassword();
      if (action === 'sync-upload') uploadCloudState();
      if (action === 'sync-download') downloadCloudState();
      if (action === 'sign-out') signOutCloud();
      if (action === 'export') exportState();
      if (action === 'import') elements.importDialog.showModal();
      if (action === 'demo') loadDemoData();
      if (action === 'reset') resetState();
    });
    if (element.dataset.action === 'asset-detail') {
      element.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        renderAssetDetail(element.dataset.assetId);
      });
    }
  });
  bindLongPressReorder(root);
}

function switchView(view) {
  currentView = view;
  applyCurrentView();
}

function applyCurrentView() {
  elements.tabs.forEach((button) => button.classList.toggle('active', button.dataset.view === currentView));
  Object.entries(elements.views).forEach(([name, element]) => element.classList.toggle('active', name === currentView));
}

function deleteRecord(recordId) {
  state.records = state.records.filter((record) => record.id !== recordId);
  saveState();
  toast('已删除记录');
  render();
}

function deleteAsset(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  const recordCount = state.records.filter((record) => record.assetId === assetId).length;
  const message = `确定删除「${asset.name}」吗？这会同时删除 ${recordCount} 条记录，不能撤销。`;
  if (!window.confirm(message)) return;
  state.assets = normalizeAssetOrder(state.assets.filter((item) => item.id !== assetId));
  state.records = state.records.filter((record) => record.assetId !== assetId);
  saveState();
  elements.assetDetailDialog.close();
  toast('资产已删除');
  render();
}

function toggleArchive(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  asset.status = asset.status === 'archived' ? 'active' : 'archived';
  state.assets = normalizeAssetOrder(state.assets);
  saveState();
  elements.assetDetailDialog.close();
  toast(asset.status === 'archived' ? '资产已归档' : '资产已恢复');
  render();
}

function bindLongPressReorder(root) {
  root.querySelectorAll('.asset-card[data-asset-id]').forEach((card) => {
    const clearTimer = () => {
      if (longPressTimer) window.clearTimeout(longPressTimer);
      longPressTimer = null;
    };
    card.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      clearTimer();
      longPressTimer = window.setTimeout(() => enterAssetReorder(card.dataset.assetId), 520);
    });
    card.addEventListener('pointerup', clearTimer);
    card.addEventListener('pointerleave', clearTimer);
    card.addEventListener('pointercancel', clearTimer);
  });
}

function enterAssetReorder(assetId) {
  reorderAssetId = assetId;
  toast('排序模式：用上移/下移调整位置');
  render();
}

function finishAssetReorder() {
  reorderAssetId = null;
  render();
}

function moveAssetOrder(assetId, direction) {
  state.assets = moveAssetWithinStatus(state.assets, assetId, direction);
  reorderAssetId = assetId;
  saveState();
  render();
}

function saveSettings() {
  if (publicSyncConfig.configured) {
    state.settings.sync = getSyncSettings();
  } else {
    state.settings.sync.supabaseUrl = document.querySelector('#supabaseUrl')?.value.trim() || '';
    state.settings.sync.anonKey = document.querySelector('#anonKey')?.value.trim() || '';
    state.settings.sync.email = normalizeEmail(document.querySelector('#syncEmail')?.value || state.settings.sync.email);
  }
  state.settings.goldPricePerGram = Number(document.querySelector('#goldPrice').value) || 0;
  state.settings.targets[state.settings.selectedYear] = Number(document.querySelector('#yearTarget').value) || 0;
  saveState();
  initSupabaseClient();
  toast('设置已保存');
  render();
}

function initSupabaseClient() {
  state.settings.sync = getSyncSettings();
  const { supabaseUrl, anonKey } = state.settings.sync;
  if (!supabaseUrl || !anonKey || !window.supabase?.createClient) {
    supabaseClient = null;
    currentSession = null;
    return;
  }
  supabaseClient = window.supabase.createClient(supabaseUrl, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  supabaseClient.auth.getSession().then(({ data }) => handleCloudSession(data.session)).catch(() => {});
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      passwordResetMode = true;
      currentView = 'sync';
    }
    window.setTimeout(async () => {
      await handleCloudSession(session);
      if (event === 'PASSWORD_RECOVERY') toast('请输入新密码');
    }, 0);
  });
}

async function handleCloudSession(session) {
  currentSession = session;
  if (session?.user) {
    prepareLocalStateForCloudUser(session.user);
    await autoDownloadCloudStateIfEmpty();
  }
  render();
  showOnboardingIfNeeded();
}

function updateAuthGate() {
  const showGate = requiresLogin();
  elements.authGate.hidden = !showGate;
  elements.appShell.hidden = showGate;
  if (showGate && state.settings.sync.email && !elements.authEmailInput.value) {
    elements.authEmailInput.value = state.settings.sync.email;
  }
  if (showGate) setAuthMode(authMode);
  if (showGate) elements.onboardingDialog.close();
}

function setAuthMode(mode) {
  authMode = mode === 'signup' ? 'signup' : 'signin';
  const isSignUp = authMode === 'signup';
  elements.authModeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.authMode === authMode);
  });
  if (elements.authTitle) elements.authTitle.textContent = isSignUp ? '创建账号' : '登录账本';
  if (elements.authSubtitle) {
    elements.authSubtitle.textContent = isSignUp
      ? '用邮箱创建你的独立账本。注册成功后，这个邮箱就是你的同步账号。'
      : '输入邮箱和密码，打开你自己的云端账本。';
  }
  if (elements.authModeHint) {
    elements.authModeHint.textContent = isSignUp
      ? '不会跳去外部注册页；账号会直接创建在当前应用里。'
      : '第一次使用请切到“创建账号”，注册成功后会自动进入你的空账本。';
  }
  if (elements.authPasswordInput) {
    elements.authPasswordInput.autocomplete = isSignUp ? 'new-password' : 'current-password';
    elements.authPasswordInput.placeholder = isSignUp ? '至少 6 位，建议不要和邮箱密码相同' : '至少 6 位';
  }
  if (elements.authPasswordConfirmInput && !isSignUp) elements.authPasswordConfirmInput.value = '';
  if (elements.authConfirmField) elements.authConfirmField.hidden = !isSignUp;
  if (elements.authSignInButton) elements.authSignInButton.hidden = isSignUp;
  if (elements.authSignUpButton) elements.authSignUpButton.hidden = !isSignUp;
  if (elements.authModeToggle) elements.authModeToggle.textContent = isSignUp ? '已有账号，去登录' : '创建新账号';
  if (elements.authForgotPasswordButton) elements.authForgotPasswordButton.hidden = isSignUp;
}

function requiresLogin() {
  return publicSyncConfig.configured && !currentSession?.user;
}

function showOnboardingIfNeeded() {
  if (requiresLogin()) return;
  if (!state.settings.initialized && !elements.onboardingDialog.open) {
    elements.onboardingDialog.showModal();
  }
}

function prepareLocalStateForCloudUser(user) {
  const ownerId = localStorage.getItem(OWNER_KEY);
  const hasLocalBook = state.assets.length || state.records.length;
  if ((ownerId && ownerId !== user.id) || (!ownerId && hasLocalBook)) {
    resetLocalBookForAuth(user.email);
  }
  localStorage.setItem(OWNER_KEY, user.id);
  state.settings.sync.email = normalizeEmail(user.email || state.settings.sync.email);
  saveState();
}

function resetLocalBookForAuth(email) {
  const sync = resolveSyncSettings({ ...state.settings.sync, email }, publicSyncConfig);
  state = structuredClone(defaultState);
  state.settings.sync = sync;
  saveState();
}

function renderCloudAuth(configured, signedIn) {
  if (!configured) {
    return '<div class="empty">先填写 Supabase URL 和 Anon Key，然后保存设置。</div>';
  }
  if (signedIn) {
    const email = currentSession.user.email || '已登录用户';
    return `
      <div class="cloud-user">
        <strong>${escapeHtml(email)}</strong>
        <span class="status-pill">已绑定</span>
      </div>
      ${passwordResetMode ? `
        <div class="sync-ready">
          <strong>正在重置密码</strong>
          <span>输入新密码后点击“设置新密码”，以后就用新密码登录。</span>
        </div>
      ` : ''}
      <div class="settings-grid">
        <label>新密码<input id="newPasswordInput" type="password" autocomplete="new-password" placeholder="至少 6 位"></label>
      </div>
      <div class="button-row">
        <button class="primary-button" data-action="sync-upload">上传本机账本</button>
        <button class="ghost-button" data-action="sync-download">拉取云端账本</button>
        <button class="ghost-button" data-action="update-password">${passwordResetMode ? '设置新密码' : '修改密码'}</button>
        <button class="ghost-button" data-action="sign-out">退出登录</button>
      </div>
    `;
  }
  return `
    <div class="settings-grid">
      <label>邮箱<input id="emailOtpInput" type="email" value="${escapeAttr(getSyncSettings().email || '')}" placeholder="you@example.com"></label>
      <label>密码<input id="passwordInput" type="password" autocomplete="current-password" placeholder="至少 6 位"></label>
    </div>
    <div class="button-row">
      <button class="primary-button" data-action="sign-in-password">登录</button>
      <button class="ghost-button" data-action="sign-up-password">注册</button>
      <button class="ghost-button" data-action="forgot-password">忘记密码</button>
    </div>
  `;
}

function cloudStatusText(configured, signedIn) {
  if (!configured) return '需要先配置 Supabase 项目。';
  if (signedIn) return '已登录。上传会覆盖云端账本；拉取会覆盖本机账本，操作前可先导出备份。';
  return '邮箱和密码登录。第一次使用先注册；忘记密码可以发邮件重置。';
}

function getSyncSettings() {
  return resolveSyncSettings(state.settings.sync, publicSyncConfig);
}

async function signInWithPassword() {
  if (!supabaseClient) return toast('请先保存 Supabase 配置');
  const email = readAuthEmail();
  const password = readAuthPassword();
  if (!email || !password) return toast('请输入邮箱和密码');
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    state.settings.sync.email = email;
    saveState();
    currentSession = data.session;
    if (data.session?.user) {
      prepareLocalStateForCloudUser(data.session.user);
      await autoDownloadCloudStateIfEmpty();
    }
    toast('登录成功');
    render();
    showOnboardingIfNeeded();
  } catch (error) {
    toast(`登录失败：${error.message || '检查邮箱或密码'}`);
  }
}

async function signUpWithPassword() {
  if (!supabaseClient) return toast('请先保存 Supabase 配置');
  const email = readAuthEmail();
  const password = readAuthPassword();
  if (!email || !password) return toast('请输入邮箱和密码');
  if (password.length < 6) return toast('密码至少 6 位');
  if (!elements.authConfirmField?.hidden && elements.authPasswordConfirmInput && password !== elements.authPasswordConfirmInput.value.trim()) {
    return toast('两次输入的密码不一致');
  }
  try {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) throw error;
    state.settings.sync.email = email;
    saveState();
    currentSession = data.session;
    if (data.session?.user) {
      prepareLocalStateForCloudUser(data.session.user);
      await autoDownloadCloudStateIfEmpty();
    }
    toast(data.session ? '注册成功' : '注册成功，请登录');
    render();
    showOnboardingIfNeeded();
  } catch (error) {
    toast(`注册失败：${error.message || '检查邮箱或密码'}`);
  }
}

function readAuthEmail() {
  const gateEmail = elements.authGate.hidden ? '' : elements.authEmailInput?.value;
  return normalizeEmail(gateEmail || document.querySelector('#emailOtpInput')?.value || state.settings.sync.email);
}

function readAuthPassword() {
  const gatePassword = elements.authGate.hidden ? '' : elements.authPasswordInput?.value;
  return (gatePassword || document.querySelector('#passwordInput')?.value || '').trim();
}

function writeAuthEmail(email) {
  if (elements.authEmailInput) elements.authEmailInput.value = email;
  const syncEmailInput = document.querySelector('#emailOtpInput');
  if (syncEmailInput) syncEmailInput.value = email;
}

async function updatePassword() {
  if (!supabaseClient || !currentSession?.user) return toast('请先登录');
  const password = document.querySelector('#newPasswordInput')?.value.trim();
  if (!password || password.length < 6) return toast('新密码至少 6 位');
  try {
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    document.querySelector('#newPasswordInput').value = '';
    passwordResetMode = false;
    clearPasswordResetUrl();
    toast('密码已更新');
    render();
  } catch (error) {
    toast(`修改失败：${error.message || '请稍后再试'}`);
  }
}

async function requestPasswordReset() {
  if (!supabaseClient) return toast('请先保存 Supabase 配置');
  const email = readAuthEmail();
  if (!email) return toast('请输入邮箱，再发送重置邮件');
  try {
    writeAuthEmail(email);
    state.settings.sync.email = email;
    saveState();
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: getPasswordResetRedirectUrl(),
    });
    if (error) throw error;
    toast('重置邮件已发送，请去邮箱打开链接');
  } catch (error) {
    toast(`发送失败：${error.message || '请稍后再试'}`);
  }
}

function getPasswordResetRedirectUrl() {
  return 'https://deelbran-7.github.io/zuanmi-record/';
}

function clearPasswordResetUrl() {
  if (!window.history?.replaceState || (!window.location.hash && !window.location.search)) return;
  try {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.hash = '';
    cleanUrl.search = '';
    window.history.replaceState({}, document.title, cleanUrl.toString());
  } catch {
    // URL cleanup is cosmetic; password update has already succeeded.
  }
}

async function uploadCloudState() {
  const user = await requireCloudUser();
  if (!user) return;
  if (!state.assets.length && !state.records.length) {
    toast('本机账本为空，已阻止覆盖云端');
    return;
  }
  try {
    const { error } = await supabaseClient
      .from('app_states')
      .upsert({
        user_id: user.id,
        payload: toCloudPayload(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    if (error) throw error;
    toast('已上传到云端');
  } catch (error) {
    toast(`上传失败：${error.message || '检查表结构/RLS'}`);
  }
}

async function downloadCloudState() {
  const user = await requireCloudUser();
  if (!user) return;
  if (!window.confirm('拉取云端账本会覆盖本机账本。建议先导出备份。继续吗？')) return;
  await loadCloudState(user, '已拉取云端账本', { silentMissing: false });
}

async function autoDownloadCloudStateIfEmpty() {
  if (!currentSession?.user || state.assets.length || state.records.length) return;
  if (autoCloudDownloadUserId === currentSession.user.id) return;
  autoCloudDownloadUserId = currentSession.user.id;
  await loadCloudState(currentSession.user, '已自动拉取云端账本', { silentMissing: true });
}

async function loadCloudState(user, successMessage, options = {}) {
  try {
    const { data, error } = await supabaseClient
      .from('app_states')
      .select('payload, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data?.payload) {
      if (!options.silentMissing) toast('云端还没有账本');
      return false;
    }
    const sync = structuredClone(state.settings.sync);
    state = normalizeState(data.payload);
    state.settings.sync = sync;
    state.settings.initialized = true;
    saveState();
    toast(successMessage);
    render();
    return true;
  } catch (error) {
    toast(`拉取失败：${error.message || '检查表结构/RLS'}`);
    return false;
  }
}

async function signOutCloud() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  currentSession = null;
  localStorage.removeItem(OWNER_KEY);
  resetLocalBookForAuth('');
  toast('已退出登录');
  render();
}

async function requireCloudUser() {
  if (!supabaseClient) {
    toast('请先保存 Supabase 配置');
    return null;
  }
  const { data, error } = await supabaseClient.auth.getUser();
  if (error || !data.user) {
    toast('请先用邮箱登录');
    return null;
  }
  return data.user;
}

function toCloudPayload() {
  const { sync, ...settings } = state.settings;
  return {
    settings: { ...settings, initialized: true },
    assets: state.assets,
    records: state.records,
  };
}

async function fetchGoldPrice() {
  toast('正在更新金价...');
  try {
    const response = await fetch('https://api.gold-api.com/price/XAU/CNY');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.price) throw new Error('Missing price');
    state.settings.goldPricePerGram = Math.round((Number(data.price) / TROY_OUNCE_GRAMS) * 100) / 100;
    state.settings.goldPriceSource = 'Gold API XAU/CNY';
    state.settings.goldPriceUpdatedAt = data.updatedAt || new Date().toISOString();
    saveState();
    toast(`金价已更新：${state.settings.goldPricePerGram}/g`);
    render();
  } catch (error) {
    toast('实时金价更新失败，可先手动填写');
  }
}

function addYear() {
  const nextYear = Math.max(...getKnownYears()) + 1;
  elements.yearForm.reset();
  elements.yearForm.elements.year.value = nextYear;
  elements.yearForm.elements.target.value = state.settings.targets[state.settings.selectedYear] || 400000;
  elements.yearDialog.showModal();
}

function handleYearSubmit(event) {
  event.preventDefault();
  const form = new FormData(elements.yearForm);
  const year = Number(form.get('year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    toast('年份格式不对');
    return;
  }
  state.settings.targets[year] = Number(form.get('target')) || 0;
  state.settings.selectedYear = year;
  saveState();
  elements.yearDialog.close();
  toast(`已新增 ${year}`);
  render();
}

function exportState() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `zuanmi-record-${today}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast('已导出 JSON 备份');
}

function resetState() {
  if (!window.confirm('确认清空当前账本？建议先导出备份。')) return;
  state = structuredClone(defaultState);
  state.settings.initialized = true;
  state.settings.selectedYear = new Date().getFullYear();
  state.settings.targets = { [state.settings.selectedYear]: 0 };
  saveState();
  toast('账本已清空');
  render();
}

function getPortfolio() {
  return calculatePortfolioSummary(sortAssetsForDisplay(state.assets), recordsUntilYear(state.records, state.settings.selectedYear), {
    year: state.settings.selectedYear,
    target: getTarget(),
    goldPricePerGram: state.settings.goldPricePerGram,
  });
}

function getYear() {
  return calculateYearSummary(state.assets, state.records, {
    year: state.settings.selectedYear,
    target: getTarget(),
    goldPricePerGram: state.settings.goldPricePerGram,
  });
}

function getTarget() {
  return Number(state.settings.targets[state.settings.selectedYear]) || 0;
}

function nextAssetDisplayOrder() {
  return state.assets.reduce((max, asset) => Math.max(max, Number(asset.displayOrder) || 0), -1) + 1;
}

function getKnownYears() {
  const years = new Set([new Date().getFullYear()]);
  state.records.forEach((record) => years.add(new Date(record.date).getFullYear()));
  Object.keys(state.settings.targets).forEach((year) => years.add(Number(year)));
  return [...years].filter(Boolean).sort((a, b) => a - b);
}

function goldPriceStatus() {
  if (!state.settings.goldPricePerGram) {
    return '黄金浮盈需要当前金价。你可以手动输入，也可以点“实时更新金价”。';
  }
  const updated = state.settings.goldPriceUpdatedAt ? new Date(state.settings.goldPriceUpdatedAt).toLocaleString('zh-CN') : '手动填写';
  const source = state.settings.goldPriceSource || '手动填写';
  return `当前金价：${state.settings.goldPricePerGram}/g · 来源：${source} · 更新时间：${updated}`;
}

function getSortedRecords() {
  return [...state.records].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function metric(label, value, className = '') {
  return `<div class="metric-card"><small>${label}</small><strong class="${className}">${value}</strong></div>`;
}

function empty(text) {
  return `<div class="empty">${text}</div>`;
}

function signedCurrency(value, currency = 'CNY') {
  const amount = Number(value) || 0;
  return `${amount >= 0 ? '+' : ''}${formatCurrency(amount, currency)}`;
}

function signedByType(record, currency = 'CNY') {
  const sign = RECORD_TYPES[record.type]?.sign || 0;
  if (sign === 0) return formatCurrency(record.amount, currency);
  const value = sign < 0 ? -Math.abs(record.amount) : Math.abs(record.amount);
  const className = value >= 0 ? 'profit' : 'loss';
  return `<strong class="${className}">${signedCurrency(value, currency)}</strong>`;
}

function categoryLabel(category) {
  return {
    business: '业务',
    stock: '股票',
    gold: '黄金',
    crypto: 'Crypto',
    fund: '基金',
    cash: '现金/收入',
    other: '其他',
  }[category] || category;
}

function categoryIcon(category) {
  return {
    business: '业',
    stock: '股',
    gold: '金',
    crypto: '币',
    fund: '基',
    cash: '现',
    other: '其',
  }[category] || '资';
}

function recordTone(type) {
  if (['realized_profit', 'dividend'].includes(type)) return 'profit';
  if (['realized_loss', 'expense', 'fee'].includes(type)) return 'loss';
  return '';
}

function statusLabel(status) {
  return {
    active: '进行中',
    paused: '暂停',
    archived: '已归档',
  }[status] || status;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  window.setTimeout(() => elements.toast.classList.remove('show'), 1800);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=31').then((registration) => {
      registration.update().catch(() => {});
    }).catch(() => {});
  }
}
