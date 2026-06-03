import {
  RECORD_TYPES,
  calculateAssetSummary,
  calculatePortfolioSummary,
  calculateYearSummary,
  formatCurrency,
  formatPercent,
  recordsUntilYear,
} from './finance.js';
import { getBrowserPublicSyncConfig, normalizeEmail, resolveSyncSettings } from './sync-config.js';

const STORAGE_KEY = 'zuanmi-record-state-v2';
const TROY_OUNCE_GRAMS = 31.1034768;
const today = new Date().toISOString().slice(0, 10);
const publicSyncConfig = getBrowserPublicSyncConfig();

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

const elements = {
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
  elements.tabs.forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  elements.recordForm.addEventListener('submit', handleRecordSubmit);
  elements.assetForm.addEventListener('submit', handleAssetSubmit);
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
  initSupabaseClient();
  render();
  if (!state.settings.initialized) {
    elements.onboardingDialog.showModal();
  }
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
  return {
    settings: { ...settings, sync: resolveSyncSettings(settings.sync, publicSyncConfig) },
    assets: Array.isArray(input.assets) ? input.assets : [],
    records: Array.isArray(input.records) ? input.records : [],
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  renderYearStrip();
  renderDashboard();
  renderAssets();
  renderYear();
  renderRecords();
  renderSync();
  populateRecordForm();
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
            <span>${state.settings.selectedYear} 总资产</span>
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

        <section class="insight-strip" aria-label="数据口径">
          <span>股票按手动记录</span>
          <span>黄金可实时估值</span>
          <span>每个人独立数据</span>
        </section>

        <div class="metric-grid">
          ${metric('年度净投入', formatCurrency(yearSummary.netContribution))}
          ${metric('已实现盈亏', signedCurrency(summary.realizedProfit), summary.realizedProfit >= 0 ? 'profit' : 'loss')}
          ${metric('黄金浮盈', summary.goldFloatingProfit ? signedCurrency(summary.goldFloatingProfit) : '待金价', summary.goldFloatingProfit >= 0 ? 'profit' : 'loss')}
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
  const summaries = state.assets.map((asset) => calculateAssetSummary(asset, state.records, {
    goldPricePerGram: state.settings.goldPricePerGram,
  }));
  elements.views.assets.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>资产管理</h2>
          <p class="small-muted">新增资产、暂停、归档和恢复。归档不会删除历史。</p>
        </div>
        <button class="primary-button" data-action="new-asset">新增资产</button>
      </div>
      <div class="asset-list">
        ${summaries.map(renderAssetCard).join('')}
      </div>
    </section>
  `;
  bindCommonActions(elements.views.assets);
}

function renderYear() {
  const summary = getYear();
  elements.views.year.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>${state.settings.selectedYear} 年度复盘</h2>
          <p class="small-muted">总资产增长不等于赚了多少钱，这里分开看净投入和真实盈亏。</p>
        </div>
      </div>
      <div class="metric-grid">
        ${metric('年内资产', formatCurrency(summary.totalAssets))}
        ${metric('年度净投入', formatCurrency(summary.netContribution))}
        ${metric('年度真实盈亏', signedCurrency(summary.trueProfit), summary.trueProfit >= 0 ? 'profit' : 'loss')}
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
  return `
    <button class="asset-card" data-action="asset-detail" data-asset-id="${assetSummary.assetId}">
      <div>
        <strong>${escapeHtml(assetSummary.name)}</strong>
        <div class="asset-meta">${categoryLabel(asset.category)} · ${asset.currency} · <span class="status-pill ${pillClass}">${statusLabel(asset.status)}</span></div>
        <div class="asset-meta">${escapeHtml(asset.note || '')}</div>
      </div>
      <div class="asset-values">
        <strong>${formatCurrency(assetSummary.currentValue, asset.currency)}</strong>
        <div class="asset-meta">本金 ${formatCurrency(assetSummary.principal, asset.currency)}</div>
        <div class="${assetSummary.netRealized >= 0 ? 'profit' : 'loss'}">${signedCurrency(assetSummary.netRealized, asset.currency)}</div>
      </div>
    </button>
  `;
}

function renderRecordRow(record) {
  const asset = state.assets.find((item) => item.id === record.assetId);
  const type = RECORD_TYPES[record.type]?.label || record.type;
  const amount = record.type === 'note' ? escapeHtml(record.note || '') : signedByType(record, asset?.currency);
  return `
    <div class="record-row">
      <div>
        <strong>${escapeHtml(asset?.name || '未知资产')}</strong>
        <div class="record-meta">${record.date}</div>
      </div>
      <div>${type}</div>
      <div>${amount}</div>
      <button class="ghost-button" data-action="delete-record" data-record-id="${record.id}">删除</button>
    </div>
  `;
}

function renderMonthRow(month) {
  return `
    <div class="month-row">
      <strong>${month.month}月</strong>
      <span>投入 ${formatCurrency(month.netContribution)}</span>
      <span class="${month.trueProfit >= 0 ? 'profit' : 'loss'}">盈亏 ${signedCurrency(month.trueProfit)}</span>
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
  const goldHtml = summary.gold ? `
    <section class="panel">
      <h3>黄金估值</h3>
      <div class="detail-grid">
        ${metric('持有克数', `${summary.gold.grams}g`)}
        ${metric('总成本', formatCurrency(summary.gold.cost))}
        ${metric('平均买入', `${Math.round(summary.gold.averageBuyPrice * 100) / 100}/g`)}
        ${metric('黄金浮盈', summary.gold.floatingProfit === null ? '待金价' : signedCurrency(summary.gold.floatingProfit), summary.gold.floatingProfit >= 0 ? 'profit' : 'loss')}
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
        <span>当前价值</span>
        <span>${asset.note ? escapeHtml(asset.note) : '可持续记录'}</span>
      </div>
      <div class="hero-number">${formatCurrency(summary.currentValue, asset.currency)}</div>
      <div class="hero-meta">
        <span>本金 ${formatCurrency(summary.principal, asset.currency)}</span>
        <span>已实现 ${signedCurrency(summary.netRealized, asset.currency)}</span>
      </div>
    </article>
    <div class="metric-grid">
      ${metric('投入本金', formatCurrency(summary.capitalIn, asset.currency))}
      ${metric('回款/取出', formatCurrency(summary.capitalOut, asset.currency))}
      ${metric('ROI', summary.principal ? formatPercent((summary.netRealized / summary.principal) * 100) : '0%')}
    </div>
    ${goldHtml}
    <section class="panel">
      <div class="panel-header">
        <h3>记录明细</h3>
        <div class="button-row">
          <button class="ghost-button" data-action="toggle-archive" data-asset-id="${asset.id}">${asset.status === 'archived' ? '恢复' : '归档'}</button>
          <button class="primary-button" data-action="new-record-for-asset" data-asset-id="${asset.id}">新增记录</button>
        </div>
      </div>
      <div class="record-list">${records.map(renderRecordRow).join('') || empty('这个资产还没有记录')}</div>
    </section>
  `;
  bindCommonActions(elements.assetDetail);
  elements.assetDetailDialog.showModal();
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
  state.assets.push({
    id: `asset-${Date.now()}`,
    name: form.get('name').trim(),
    category: form.get('category'),
    currency: form.get('currency'),
    status: form.get('status'),
    note: form.get('note').trim(),
  });
  saveState();
  elements.assetDialog.close();
  toast('已新增资产');
  render();
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
      assets: imported.assets,
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
  state = structuredClone(demoState);
  saveState();
  elements.onboardingDialog.close();
  toast('已载入演示模板');
  render();
}

function bindCommonActions(root) {
  root.querySelectorAll('[data-action]').forEach((element) => {
    element.addEventListener('click', () => {
      const action = element.dataset.action;
      if (action === 'new-record') openRecordDialog();
      if (action === 'new-record-for-asset') openRecordDialog(element.dataset.assetId);
      if (action === 'new-asset') elements.assetDialog.showModal();
      if (action === 'asset-detail') renderAssetDetail(element.dataset.assetId);
      if (action === 'year-view') switchView('year');
      if (action === 'records-view') switchView('records');
      if (action === 'delete-record') deleteRecord(element.dataset.recordId);
      if (action === 'toggle-archive') toggleArchive(element.dataset.assetId);
      if (action === 'close-detail') elements.assetDetailDialog.close();
      if (action === 'save-settings') saveSettings();
      if (action === 'fetch-gold') fetchGoldPrice();
      if (action === 'send-email-otp') sendEmailOtp();
      if (action === 'verify-email-otp') verifyEmailOtp();
      if (action === 'sync-upload') uploadCloudState();
      if (action === 'sync-download') downloadCloudState();
      if (action === 'sign-out') signOutCloud();
      if (action === 'export') exportState();
      if (action === 'import') elements.importDialog.showModal();
      if (action === 'demo') loadDemoData();
      if (action === 'reset') resetState();
    });
  });
}

function switchView(view) {
  currentView = view;
  elements.tabs.forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  Object.entries(elements.views).forEach(([name, element]) => element.classList.toggle('active', name === view));
}

function deleteRecord(recordId) {
  state.records = state.records.filter((record) => record.id !== recordId);
  saveState();
  toast('已删除记录');
  render();
}

function toggleArchive(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  asset.status = asset.status === 'archived' ? 'active' : 'archived';
  saveState();
  elements.assetDetailDialog.close();
  toast(asset.status === 'archived' ? '资产已归档' : '资产已恢复');
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
    auth: { persistSession: true, autoRefreshToken: true },
  });
  supabaseClient.auth.getSession().then(({ data }) => {
    currentSession = data.session;
    renderSync();
  }).catch(() => {});
  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentSession = session;
    window.setTimeout(() => renderSync(), 0);
  });
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
      <div class="button-row">
        <button class="primary-button" data-action="sync-upload">上传本机账本</button>
        <button class="ghost-button" data-action="sync-download">拉取云端账本</button>
        <button class="ghost-button" data-action="sign-out">退出登录</button>
      </div>
    `;
  }
  return `
    <div class="settings-grid">
      <label>邮箱<input id="emailOtpInput" type="email" value="${escapeAttr(getSyncSettings().email || '')}" placeholder="you@example.com"></label>
      <label>验证码<input id="otpInput" inputmode="numeric" placeholder="邮件中的 6 位验证码"></label>
    </div>
    <div class="button-row">
      <button class="primary-button" data-action="send-email-otp">发送登录邮件</button>
      <button class="ghost-button" data-action="verify-email-otp">输入验证码登录</button>
    </div>
  `;
}

function cloudStatusText(configured, signedIn) {
  if (!configured) return '需要先配置 Supabase 项目。';
  if (signedIn) return '已登录。上传会覆盖云端账本；拉取会覆盖本机账本，操作前可先导出备份。';
  return '收到邮件后可以输入 6 位验证码；如果邮件里是登录链接，点击后回到本页也会保持登录。';
}

function getSyncSettings() {
  return resolveSyncSettings(state.settings.sync, publicSyncConfig);
}

async function sendEmailOtp() {
  if (!supabaseClient) return toast('请先保存 Supabase 配置');
  const email = normalizeEmail(document.querySelector('#emailOtpInput')?.value);
  if (!email) return toast('请输入邮箱');
  try {
    state.settings.sync.email = email;
    saveState();
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.href.split('#')[0],
      },
    });
    if (error) throw error;
    toast('登录邮件已发送');
  } catch (error) {
    toast(`发送失败：${error.message || '检查邮箱 Auth 配置'}`);
  }
}

async function verifyEmailOtp() {
  if (!supabaseClient) return toast('请先保存 Supabase 配置');
  const email = normalizeEmail(document.querySelector('#emailOtpInput')?.value);
  const token = document.querySelector('#otpInput')?.value.trim();
  if (!email || !token) return toast('请输入邮箱和验证码');
  try {
    const { data, error } = await supabaseClient.auth.verifyOtp({ email, token, type: 'magiclink' });
    if (error) throw error;
    state.settings.sync.email = email;
    saveState();
    currentSession = data.session;
    toast('登录成功');
    render();
  } catch (error) {
    toast(`验证失败：${error.message || '验证码或链接不正确'}`);
  }
}

async function uploadCloudState() {
  const user = await requireCloudUser();
  if (!user) return;
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
  try {
    const { data, error } = await supabaseClient
      .from('app_states')
      .select('payload, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data?.payload) return toast('云端还没有账本');
    const sync = structuredClone(state.settings.sync);
    state = normalizeState(data.payload);
    state.settings.sync = sync;
    state.settings.initialized = true;
    saveState();
    toast('已拉取云端账本');
    render();
  } catch (error) {
    toast(`拉取失败：${error.message || '检查表结构/RLS'}`);
  }
}

async function signOutCloud() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  currentSession = null;
  toast('已退出登录');
  renderSync();
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
  const rawYear = window.prompt('输入要新增的年份', String(nextYear));
  if (!rawYear) return;
  const year = Number(rawYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    toast('年份格式不对');
    return;
  }
  const rawTarget = window.prompt(`${year} 年目标金额`, String(state.settings.targets[state.settings.selectedYear] || 400000));
  state.settings.targets[year] = Number(rawTarget) || 0;
  state.settings.selectedYear = year;
  saveState();
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
  return calculatePortfolioSummary(state.assets, recordsUntilYear(state.records, state.settings.selectedYear), {
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
    cash: '现金/收入',
    other: '其他',
  }[category] || category;
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
    navigator.serviceWorker.register('./sw.js?v=8').then((registration) => {
      registration.update().catch(() => {});
    }).catch(() => {});
  }
}
