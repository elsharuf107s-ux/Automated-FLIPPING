import { $, esc, money } from '../util.js';
import { api } from '../data.js';
import { icon, toast } from '../ui.js';

const AUTO_KEY = 'fliplab-agent-auto-verify';
const verified = new Map();
const queuedByUrl = new Map();
let latestStatus = { bridge: null, counts: {}, tasks: [] };
let pollTimer = null;
let started = false;

function autoPref() {
  try { return localStorage.getItem(AUTO_KEY) !== 'off'; } catch { return true; }
}

export function agentAutoVerifyEnabled() {
  return autoPref();
}

export function isBrowserAgentConnected() {
  return Boolean(latestStatus.bridge?.connected);
}

export function getSupplierVerification(url) {
  return verified.get(String(url || '')) || null;
}

function saveVerification(task) {
  if (!task?.result || !task?.url) return;
  const previous = verified.get(task.url);
  verified.set(task.url, task.result);
  queuedByUrl.delete(task.url);
  if (!previous || previous.verifiedAt !== task.result.verifiedAt) {
    window.dispatchEvent(new CustomEvent('fliplab:agent-verified', {
      detail: { url: task.url, result: task.result, task }
    }));
  }
}

function bridgeStatusHtml() {
  const bridge = latestStatus.bridge;
  if (bridge?.connected) {
    return `<span class="status-chip ok">${icon('check')}Local browser connected</span>
      <span class="field-note">${esc(bridge.mode || 'Playwright')} · last seen ${esc(new Date(bridge.lastSeen).toLocaleTimeString())}</span>`;
  }
  return `<span class="status-chip warn">${icon('alert')}Local browser offline</span>
    <span class="field-note">Start the Chromebook bridge to let FlipLab verify supplier pages.</span>`;
}

function taskSummary(task) {
  const result = task.result;
  if (!result) return '';
  const facts = [
    result.price != null ? `price ${money(result.price)}` : '',
    result.shipping != null ? `ship ${money(result.shipping)}` : '',
    result.sizes?.length ? `${result.sizes.length} sizes` : '',
    result.inStock === true ? 'in stock' : result.inStock === false ? 'out of stock' : ''
  ].filter(Boolean);
  return facts.join(' · ');
}

function taskHtml(task) {
  const cls = task.status === 'completed' ? 'buy' : task.status === 'failed' ? 'over' : task.status === 'running' || task.status === 'processing' ? 'watch' : '';
  const status = task.status === 'processing' ? 'AI structuring' : task.status;
  const detail = task.error?.message || taskSummary(task) || (task.status === 'queued' ? 'Waiting for the local bridge' : '');
  return `<div class="panel" style="padding:12px;margin:0">
    <div class="panel-head" style="margin-bottom:6px">
      <div><strong>${esc(task.source || 'Supplier')}</strong><p class="field-note">${esc(task.supplier?.title || task.url || '')}</p></div>
      <span class="badge ${cls}">${esc(status)}</span>
    </div>
    ${detail ? `<p class="field-note">${esc(detail)}</p>` : ''}
  </div>`;
}

function renderAgent() {
  const statusBox = $('#agentConnection');
  const tasks = $('#agentTasks');
  if (!statusBox || !tasks) return;
  statusBox.innerHTML = bridgeStatusHtml();
  const recent = latestStatus.tasks || [];
  tasks.innerHTML = recent.length
    ? recent.map(taskHtml).join('')
    : `<div class="empty">${icon('plug')}<strong>No browser tasks yet</strong>Run a Hunt and FlipLab can verify the best supplier matches automatically.</div>`;
  const auto = $('#agentAutoVerify');
  if (auto) auto.checked = autoPref();
}

async function refreshStatus() {
  try {
    latestStatus = await api('/api/agent/status');
    for (const task of latestStatus.tasks || []) {
      if (task.status === 'completed') saveVerification(task);
      if (task.status === 'failed' && task.url) queuedByUrl.delete(task.url);
    }
    renderAgent();
  } catch {}
}

function startPolling() {
  clearInterval(pollTimer);
  refreshStatus();
  pollTimer = setInterval(refreshStatus, 2000);
}

export async function queueSupplierVerification(supplier, reference = {}, { silent = false } = {}) {
  const url = String(supplier?.url || '');
  if (!url) throw new Error('Supplier URL is missing.');
  if (supplier.searchOnly || /(^|\.)temu\.com$/i.test(new URL(url).hostname)) {
    throw new Error('Temu stays search-only and is not opened by the local browser agent.');
  }
  const cached = getSupplierVerification(url);
  if (cached) return { status: 'completed', result: cached, url };
  if (queuedByUrl.has(url)) return queuedByUrl.get(url);

  const task = await api('/api/agent/verify', { body: { supplier, reference } });
  queuedByUrl.set(url, task);
  latestStatus.tasks = [task, ...(latestStatus.tasks || []).filter((entry) => entry.id !== task.id)].slice(0, 20);
  renderAgent();
  if (!silent) {
    toast(isBrowserAgentConnected() ? 'Supplier verification queued in your local browser' : 'Queued — start the Browser Agent bridge', { type: 'info' });
  }
  return task;
}

export async function autoVerifySuppliers(items = []) {
  if (!agentAutoVerifyEnabled() || !isBrowserAgentConnected()) return;
  const candidates = [];
  for (const item of items) {
    const supplier = item?.bestSupplier;
    if (!supplier || supplier.searchOnly || getSupplierVerification(supplier.url) || queuedByUrl.has(supplier.url)) continue;
    candidates.push({ supplier, reference: item });
    if (candidates.length >= 3) break;
  }
  for (const candidate of candidates) {
    try { await queueSupplierVerification(candidate.supplier, candidate.reference, { silent: true }); } catch {}
  }
  if (candidates.length) toast(`Browser Agent queued ${candidates.length} supplier verification${candidates.length === 1 ? '' : 's'}`, { type: 'info', duration: 1800 });
}

function injectAgentShell() {
  if ($('#view-agent')) return;
  const nav = document.querySelector('.nav');
  const settings = nav?.querySelector('[data-view="settings"]');
  const link = document.createElement('a');
  link.className = 'nav-item';
  link.href = '#/agent';
  link.dataset.view = 'agent';
  link.innerHTML = `${icon('plug')}<span>Browser Agent</span>`;
  if (settings) nav.insertBefore(link, settings);
  else nav?.appendChild(link);

  const section = document.createElement('section');
  section.className = 'view';
  section.id = 'view-agent';
  section.dataset.title = 'Browser Agent';
  section.dataset.eyebrow = 'Local Playwright verification';
  section.innerHTML = `
    <div style="display:grid;gap:14px;padding-bottom:10px">
      <article class="panel">
        <div class="panel-head">
          <div><p class="eyebrow">Chromebook bridge</p><h3>Give FlipLab local browser hands</h3></div>
          <div id="agentConnection" style="display:grid;justify-items:end;gap:5px"></div>
        </div>
        <p class="field-note">The bridge opens supplier pages in a local Playwright browser and sends visible product facts back to FlipLab. It does not control Depop, buy products, send messages, publish listings, or bypass CAPTCHAs.</p>
        <label style="display:flex;align-items:center;gap:10px;margin-top:14px">
          <input id="agentAutoVerify" type="checkbox" ${autoPref() ? 'checked' : ''}>
          <span><strong>Auto-verify the top 3 supplier matches after each Hunt</strong><br><small class="field-note">Only runs while the local bridge is connected.</small></span>
        </label>
      </article>

      <article class="panel">
        <div class="panel-head"><div><p class="eyebrow">One-time local setup</p><h3>Private Codespaces tunnel</h3></div></div>
        <p class="field-note">Run these from the Chromebook Linux terminal. The GitHub CLI tunnel keeps port 3000 private; do not make the Codespaces port public.</p>
        <div class="copy-box" style="margin-top:12px">
          <h4>1 · Forward the private Codespace port</h4>
          <pre id="agentForwardCommand" style="white-space:pre-wrap">gh codespace ports forward 3000:3000 -R elsharuf107s-ux/Automated-FLIPPING</pre>
          <button class="btn btn-ghost btn-sm" type="button" data-copy="agentForwardCommand">${icon('copy')}<span>Copy</span></button>
        </div>
        <div class="copy-box" style="margin-top:10px">
          <h4>2 · In a local clone of FlipLab</h4>
          <pre id="agentRunCommand" style="white-space:pre-wrap">npm install\nnpx playwright install chromium\nnpm run agent:local</pre>
          <button class="btn btn-ghost btn-sm" type="button" data-copy="agentRunCommand">${icon('copy')}<span>Copy</span></button>
        </div>
        <p class="field-note" style="margin-top:10px">Optional existing-Chrome mode: <code>npm run agent:local -- --cdp http://127.0.0.1:9222</code> after starting a Chromium-based browser with remote debugging enabled.</p>
      </article>

      <div>
        <div class="panel-head"><div><p class="eyebrow">Activity</p><h3>Agent tasks</h3></div></div>
        <div id="agentTasks" style="display:grid;gap:8px"></div>
      </div>
    </div>`;
  document.querySelector('.main')?.appendChild(section);
}

export function initAgent() {
  if (started) return;
  started = true;
  injectAgentShell();
  $('#agentAutoVerify')?.addEventListener('change', (event) => {
    try { localStorage.setItem(AUTO_KEY, event.target.checked ? 'on' : 'off'); } catch {}
    toast(event.target.checked ? 'Automatic supplier verification enabled' : 'Automatic supplier verification disabled', { type: 'info', duration: 1500 });
  });
  startPolling();
}
