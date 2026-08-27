// Starter UI 前端 — i18n + Tauri invoke (with mock fallback)
// 3 tabs: items / timeline / settings

import { t, setLang, getLang, initLang, applyI18n } from './i18n.js';

// ===== Tauri invoke (with browser mock fallback) =====
function getTauri() { return typeof window !== 'undefined' ? window.__TAURI__ : undefined; }
function isTauriReady() {
  const tt = getTauri();
  return !!(tt && tt.core && typeof tt.core.invoke === 'function');
}
async function waitForTauri(timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isTauriReady()) return true;
    await new Promise((r) => setTimeout(r, 30));
  }
  return false;
}

const MOCK = {
  list_items: () => [
    { id: 'fp_1', name: 'OneDrive', vendor: 'Microsoft', source: 'HKCU_Run', risk: 'normal', enabled: 1, delay_ms: 0, priority: 2 },
    { id: 'fp_2', name: 'Steam', vendor: 'Valve', source: 'StartupFolder', risk: 'recommend_off', enabled: 1, delay_ms: 30000, priority: 1 },
    { id: 'fp_3', name: 'Microsoft Defender', vendor: 'Microsoft', source: 'HKLM_Run', risk: 'critical', enabled: 1, delay_ms: 0, priority: 2 },
    { id: 'fp_4', name: 'Clash for Windows', vendor: 'Clash', source: 'HKCU_Run', risk: 'recommend_off', enabled: 1, delay_ms: 60000, priority: 0 },
    { id: 'fp_5', name: 'DeepSeek', vendor: 'DeepSeek', source: 'HKCU_Run', risk: 'normal', enabled: 0, delay_ms: 0, priority: 2 },
    { id: 'fp_6', name: 'Discord', vendor: 'Discord', source: 'HKCU_Run', risk: 'recommend_off', enabled: 1, delay_ms: 10000, priority: 1 },
  ],
  daemon_status: () => ({ base_url: 'http://127.0.0.1:7820', has_token: false }),
  timeline: () => Array.from({ length: 20 }, (_, i) => ({
    run_id: 'r-mock', item_id: `fp_${i + 1}`, status: i % 5 === 4 ? 'failed' : 'started',
    t: Date.now() - (20 - i) * 800, detail: `prio=${i % 3}`,
  })),
  io_status: async () => ({ idle_pct: 87.3, queue_len: 0.2, at: Date.now(), ok: true }),
  service_status: async () => ({ installed: false, running: false, state: 'NOT_INSTALLED' }),
  doctor: () => ({ ok: true, itemCount: 6, enabledCount: 4, config: { concurrent_max: 4, io_queue_threshold: 2, io_busy_threshold_pct: 80 } }),
  scan_items: () => ({ total: 6, inserted: 0, updated: 0 }),
  enable_item: () => ({ ok: true }),
  disable_item: () => ({ ok: true }),
  set_delay: () => ({ ok: true }),
  set_priority: () => ({ ok: true }),
  show_item: () => ({ name: 'mock detail', enabled: 1, delay_ms: 0, priority: 2 }),
  schedule_run: () => ({ total: 6, paused_count: 0, started: ['fp_1', 'fp_2', 'fp_3'], failed: [], run_id: 'r-mock', dry_run: true }),
};

async function invoke(method, params) {
  if (isTauriReady()) {
    try {
      return await getTauri().core.invoke(method, params ?? {});
    } catch (e) {
      console.error('[starter-ui] invoke', method, 'err:', e);
      throw e;
    }
  }
  return Promise.resolve(MOCK[method] ? MOCK[method]() : null);
}
async function listen(event, handler) {
  if (isTauriReady()) {
    return await getTauri().event.listen(event, handler);
  }
  return () => {};
}

// ===== DOM =====
const $ = (s) => document.querySelector(s);
const itemsEl = $('#items');
const meta = $('#meta');
const empty = $('#empty');
const searchInput = $('#search');
const toast = $('#toast');
const tabs = document.querySelectorAll('.tab');
const pages = document.querySelectorAll('.page');
const langSelect = $('#lang-select');

let all = [];
let currentTab = 'items';

function showToast(msg, ms = 2500) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), ms);
}

function riskBadge(r) {
  if (r === 'critical') return `<span class="badge critical">${t('items.risk.critical')}</span>`;
  if (r === 'recommend_off') return `<span class="badge recommend">${t('items.risk.recommend_off')}</span>`;
  return `<span class="badge normal">${t('items.risk.normal')}</span>`;
}

function switchTab(name) {
  currentTab = name;
  tabs.forEach((tb) => tb.classList.toggle('active', tb.dataset.tab === name));
  pages.forEach((p) => p.classList.toggle('active', p.dataset.page === name));
  if (name === 'timeline') refreshTimeline();
  if (name === 'settings') refreshSettings();
}
tabs.forEach((tb) => tb.addEventListener('click', () => switchTab(tb.dataset.tab)));

// ===== Items =====
function renderItems(list) {
  itemsEl.innerHTML = '';
  if (list.length === 0) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  for (const it of list) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${it.id}"><strong>${it.name}</strong><br><small style="color:var(--muted)">${it.vendor ?? ''}</small></td>
      <td><small>${it.source}</small></td>
      <td>${riskBadge(it.risk)}</td>
      <td>${it.enabled ? `<span class="badge on">${t('items.state.on')}</span>` : `<span class="badge off">${t('items.state.off')}</span>`}</td>
      <td><input type="number" min="0" max="86400000" value="${it.delay_ms}" data-id="${it.id}" class="delay-input" /></td>
      <td>
        <select data-id="${it.id}" class="prio-input">
          ${[0, 1, 2, 3, 4, 5].map((p) => `<option value="${p}" ${p === it.priority ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </td>
      <td class="row-actions">
        ${it.enabled
          ? `<button class="danger" data-act="disable" data-id="${it.id}">${t('buttons.disable')}</button>`
          : `<button class="primary" data-act="enable" data-id="${it.id}">${t('buttons.enable')}</button>`}
        <button data-act="show" data-id="${it.id}">${t('buttons.detail')}</button>
      </td>`;
    itemsEl.appendChild(tr);
  }
}

async function refreshItems() {
  meta.textContent = t('items.loading');
  try {
    const list = await invoke('list_items', { filter: { search: searchInput.value } });
    all = list;
    meta.textContent = t('items.meta.count', { n: list.length });
    renderItems(list);
  } catch (e) {
    meta.textContent = t('items.meta.error', { msg: e });
  }
}

async function rescan() {
  $('#btn-scan').disabled = true;
  meta.textContent = t('items.meta.scanning');
  try {
    const r = await invoke('scan_items');
    showToast(t('items.toast.scanned', { total: r.total, inserted: r.inserted, updated: r.updated }));
    await refreshItems();
  } catch (e) {
    showToast(t('items.toast.scanFailed', { msg: e }));
  } finally {
    $('#btn-scan').disabled = false;
  }
}

itemsEl.addEventListener('click', async (e) => {
  const tgt = e.target;
  const act = tgt.dataset.act;
  if (!act) return;
  const id = tgt.dataset.id;
  try {
    if (act === 'enable') { await invoke('enable_item', { id }); showToast(t('items.toast.enabled')); }
    if (act === 'disable') { await invoke('disable_item', { id }); showToast(t('items.toast.disabled')); }
    if (act === 'show') {
      const r = await invoke('show_item', { id });
      alert(JSON.stringify(r, null, 2));
    }
    await refreshItems();
  } catch (err) {
    showToast(t('items.toast.error', { msg: err }));
  }
});

itemsEl.addEventListener('change', async (e) => {
  const tgt = e.target;
  const id = tgt.dataset.id;
  if (!id) return;
  try {
    if (tgt.classList.contains('delay-input')) {
      await invoke('set_delay', { id, delayMs: Number(tgt.value) });
      showToast(t('items.toast.delayUpdated'));
    } else if (tgt.classList.contains('prio-input')) {
      await invoke('set_priority', { id, priority: Number(tgt.value) });
      showToast(t('items.toast.priorityUpdated'));
    }
  } catch (err) {
    showToast(t('items.toast.error', { msg: err }));
  }
});

$('#btn-scan').addEventListener('click', rescan);
searchInput.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase();
  renderItems(q ? all.filter((i) => i.name.toLowerCase().includes(q)) : all);
});

// ===== Timeline =====
async function refreshTimeline() {
  const listEl = $('#timeline-list');
  const svgEl = $('#timeline-svg');
  listEl.innerHTML = `<li>${t('timeline.loading')}</li>`;
  svgEl.innerHTML = '';
  try {
    const events = await invoke('timeline', { limit: 50 });
    if (events.length === 0) {
      listEl.innerHTML = `<li>${t('timeline.empty')}</li>`;
      return;
    }
    drawGantt(events);
    listEl.innerHTML = events.slice(-20).reverse()
      .map((e) => `<li><code>${new Date(e.t).toLocaleTimeString()}</code> <code>${e.status}</code> <code>${e.item_id.slice(0, 14)}</code>${e.detail ? ` <small style="color:var(--muted)">${e.detail}</small>` : ''}</li>`)
      .join('');
  } catch (e) {
    listEl.innerHTML = `<li>${t('items.meta.error', { msg: e })}</li>`;
  }
}

function drawGantt(events) {
  const svg = $('#timeline-svg');
  const W = 800, H = Math.max(180, 24 + events.length * 16);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const t0 = events[0]?.t ?? Date.now();
  const tEnd = events[events.length - 1]?.t ?? t0 + 1000;
  const span = Math.max(1, tEnd - t0);
  let ax = `<line x1="80" y1="20" x2="80" y2="${H - 10}" stroke="currentColor" stroke-width="0.5" />`;
  ax += `<line x1="80" y1="${H - 10}" x2="${W - 10}" y2="${H - 10}" stroke="currentColor" stroke-width="0.5" />`;
  for (let i = 0; i <= 5; i++) {
    const x = 80 + ((W - 90) * i) / 5;
    const label = `+${(((span * i) / 5) / 1000).toFixed(1)}s`;
    ax += `<line x1="${x}" y1="${H - 10}" x2="${x}" y2="${H - 7}" stroke="currentColor" stroke-width="0.5" />`;
    ax += `<text x="${x}" y="${H - 1}" text-anchor="middle" font-size="9" fill="currentColor">${label}</text>`;
  }
  let bars = '';
  events.forEach((e, i) => {
    const y = 24 + i * 16;
    const x = 80 + ((W - 90) * (e.t - t0)) / span;
    const color = e.status === 'started' || e.status === 'simulated'
      ? 'var(--ok)' : e.status === 'failed' ? 'var(--danger)' : 'var(--primary)';
    bars += `<text x="78" y="${y + 9}" text-anchor="end" font-size="9" fill="currentColor">${e.item_id.slice(0, 12)}</text>`;
    bars += `<rect x="${x}" y="${y - 2}" width="6" height="12" fill="${color}" rx="2" />`;
  });
  svg.innerHTML = ax + bars;
}

$('#btn-refresh-timeline')?.addEventListener('click', refreshTimeline);

// ===== Settings =====
async function refreshSettings() {
  const $io = $('#io-status');
  const $svc = $('#service-status');
  $io.textContent = t('common.loading');
  $svc.textContent = t('common.loading');
  try {
    const io = await invoke('io_status');
    $io.textContent = `idle=${io.idle_pct.toFixed(1)}%  queue=${io.queue_len}  ${io.ok ? 'OK' : 'err: ' + io.error}`;
  } catch (e) { $io.textContent = t('items.meta.error', { msg: e }); }
  try {
    const svc = await invoke('service_status');
    $svc.textContent = `installed=${svc.installed}  running=${svc.running}  state=${svc.state}${svc.pid ? '  pid=' + svc.pid : ''}`;
  } catch (e) { $svc.textContent = t('items.meta.error', { msg: e }); }
  try {
    const d = await invoke('doctor');
    $('#doctor-status').textContent = `items=${d.itemCount}  enabled=${d.enabledCount}  ${JSON.stringify(d.config)}`;
  } catch (e) { $('#doctor-status').textContent = t('items.meta.error', { msg: e }); }
}

$('#btn-refresh-settings')?.addEventListener('click', refreshSettings);
$('#btn-dry-run')?.addEventListener('click', async () => {
  showToast(t('items.meta.scanning'));
  try {
    const r = await invoke('schedule_run', { simulatedMs: 3000 });
    showToast(t('items.toast.dryRun', { total: r.total, started: r.started.length, failed: r.failed.length }));
    switchTab('timeline');
  } catch (e) { showToast(t('items.toast.error', { msg: e })); }
});

// ===== Lang switch =====
function applyLang(code) {
  setLang(code);
  applyI18n();
  if (currentTab === 'items') renderItems(all);
  if (currentTab === 'settings') refreshSettings();
  document.documentElement.setAttribute('lang', code);
}
langSelect.addEventListener('change', () => applyLang(langSelect.value));

// ===== Listen tray events =====
listen('tray-scan', () => { rescan(); });
listen('tray-timeline', () => { switchTab('timeline'); });
listen('tray-io', async () => { switchTab('settings'); await refreshSettings(); });

// ===== Window controls (无边框标题栏) =====
function setupWindowControls() {
  const tt = getTauri();
  if (!tt || !tt.window || !tt.window.getCurrentWindow) return;
  const win = tt.window.getCurrentWindow();
  const $ = (id) => document.getElementById(id);
  $('win-min')?.addEventListener('click', () => win.minimize());
  $('win-max')?.addEventListener('click', async () => {
    try {
      const max = await win.isMaximized();
      if (max) await win.unmaximize(); else await win.maximize();
    } catch { /* ignore */ }
  });
  $('win-close')?.addEventListener('click', () => win.close());
  // 双击标题栏最大化/还原
  document.getElementById('titlebar')?.addEventListener('dblclick', async (e) => {
    if (e.target.closest('.win-controls')) return;
    try {
      const max = await win.isMaximized();
      if (max) await win.unmaximize(); else await win.maximize();
    } catch { /* ignore */ }
  });
}
setupWindowControls();

// ===== init =====
initLang();
langSelect.value = getLang();
applyI18n();

(async () => {
  const tauriReady = await waitForTauri();
  if (tauriReady) {
    const banner = document.getElementById('preview-banner');
    if (banner) banner.style.display = 'none';
  } else {
    const banner = document.getElementById('preview-banner');
    if (banner) banner.style.display = '';
    console.info('[starter-ui] running in browser preview mode');
  }
  try {
    const status = await invoke('daemon_status');
    meta.textContent = t('items.meta.daemon', {
      url: status.base_url,
      token: status.has_token ? t('items.meta.daemonTokenOK') : t('items.meta.daemonTokenMissing'),
    });
  } catch (e) {
    meta.textContent = t('items.meta.initFailed', { msg: e });
  }
  await refreshItems();
})();
