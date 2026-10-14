import { $, esc, money } from '../util.js';
import { api } from '../data.js';
import { icon, toast } from '../ui.js';
import { hasEligibleVerificationSupplier, selectVerificationCandidates } from '../agent-queue.js';

const AUTO_KEY = 'fliplab-agent-auto-verify';
const verified = new Map();
const queuedByUrl = new Map();
let latestStatus = { bridge: null, counts: {}, tasks: [] };
let pendingAutoItems = [];
let autoQueueNote = '';
let autoQueueRunning = false;
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
    : `<div class="empty">${icon('plug')}<strong>No browser tasks yet</strong>Run a Hunt and FlipLab can verify eligible AliExpress/DHgate matches automatically.</div>`;
  const auto = $('#agentAutoVerify');
  if (auto) auto.checked = autoPref();
  const autoStatus = $('#agentAutoStatus');
  if (autoStatus) autoStatus.textContent = autoQueueNote;
}

function doneUrl(url) {
  return Boolean(getSupplierVerification(url) || queuedByUrl.has(url));
}

async function queuePendingAuto() {
  if (autoQueueRunning || !agentAutoVerifyEnabled() || !isBrowserAgentConnected() || !pendingAutoItems.length) return { queued: 0 };
  autoQueueRunning = true;
  try {
    const candidates = selectVerificationCandidates(pendingAutoItems, { limit: 3, isDone: doneUrl });
    if (!candidates.length) {
      if (!hasEligibleVerificationSupplier(pendingAutoItems)) {
        autoQueueNote = 'Latest Hunt has no browser-verifiable AliExpress/DHgate match. Temu results stay search-only.';
      } else {
        autoQueueNote = 'Eligible supplier matches from the latest Hunt are already queued or verified.';
      }
      pendingAutoItems = [];
      renderAgent();
      return { queued: 0 };
    }

    let queued = 0;
    for (const candidate of candidates) {
      try {
        const task = await queueSupplierVerification(candidate.supplier, candidate.reference, { silent: true });
        if (task?.id) candidate.supplier.browserTaskId = task.id;
        queued += 1;
      } catch {}
    }

    autoQueueNote = queued
      ? `Queued ${queued} strongest browser-verifiable supplier match${queued === 1 ? '' : 'es'} from the latest Hunt.`
      : 'No supplier verification could be queued from the latest Hunt.';
    renderAgent();
    if (queued) toast(`Browser Agent queued ${queued} supplier verification${queued === 1 ? '' : 's'}`, { type: 'info', duration: 1800 });
    return { queued };
  } finally {
    autoQueueRunning = false;
  }
}

async function refreshStatus({ triggerAuto = true } = {}) {
  try {
    latestStatus = await api('/api/agent/status');
    for (const task of latestStatus.tasks || []) {
      if (task.status === 'completed') saveVerification(task);
      if (task.status === 'failed' && task.url) queuedByUrl.delete(task.url);
      if (task.url && ['queued', 'running', 'processing'].includes(task.status)) queuedByUrl.set(task.url, task);
    }
    renderAgent();
    if (triggerAuto && isBrowserAgentConnected() && pendingAutoItems.length) await queuePendingAuto();
    return latestStatus;
  } catch {
    return latestStatus;
  }
}

function startPolling() {
  clearInterval(pollTimer);
  refreshStatus();
  pollTimer = setInterval(() => refreshStatus(), 2000);
}

export async function queueSupplierVerification(supplier, reference = {}, { silent = false } = {}) {
  const url = String(supplier?.url || '');
  if (!url) throw new Error('Supplier URL is missing.');
  let host = '';
  try { host = new URL(url).hostname; } catch { throw new Error('Supplier URL is invalid.'); }
  if (supplier.searchOnly || /(^|\.)temu\.com$/i.test(host)) {
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
  pendingAutoItems = Array.isArray(items) ? items : [];
  if (!agentAutoVerifyEnabled()) {
    autoQueueNote = 'Automatic supplier verification is turned off.';
    renderAgent();
    return { queued: 0, reason: 'disabled' };
  }

  // Refresh once here instead of trusting the last 2-second poll. This removes the
  // race where a Hunt finishes just after the local bridge connects.
  await refreshStatus({ triggerAuto: false });
  if (!isBrowserAgentConnected()) {
    autoQueueNote = 'Latest Hunt is waiting for the local Browser Agent to connect; it will queue automatically when the bridge appears.';
    renderAgent();
    return { queued: 0, reason: 'waiting-for-bridge' };
  }
  return queuePendingAuto();
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
          <span><strong>Auto-verify the top 3 supplier matches after each Hunt</strong><br><small class="field-note">FlipLab checks all Hunt supplier matches and chooses the strongest eligible AliExpress/DHgate pages.</small></span>
        </label>
        <p class="field-note" id="agentAutoStatus" style="margin-top:10px"></p>
      </article>

      <article class="panel">
        <div class="panel-head"><div><p class="eyebrow">Local setup</p><h3>Run beside FlipLab</h3></div></div>
        <p class="field-note">If FlipLab itself is running locally on this Chromebook, just run the local agent command below in a second terminal. If FlipLab is running in Codespaces, use the private GitHub CLI port-forward first.</p>
        <div class="copy-box" style="margin-top:12px">
          <h4>Local FlipLab</h4>
          <pre id="agentRunCommand" style="white-space:pre-wrap">npm install\nnpx playwright install chromium\nnpm run agent:local</pre>
          <button class="btn btn-ghost btn-sm" type="button" data-copy="agentRunCommand">${icon('copy')}<span>Copy</span></button>
        </div>
        <div class="copy-box" style="margin-top:10px">
          <h4>Codespaces only · private tunnel</h4>
          <pre id="agentForwardCommand" style="white-space:pre-wrap">gh codespace ports forward 3000:3000 -R elsharuf107s-ux/Automated-FLIPPING</pre>
          <button class="btn btn-ghost btn-sm" type="button" data-copy="agentForwardCommand">${icon('copy')}<span>Copy</span></button>
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
    if (event.target.checked) {
      autoQueueNote = pendingAutoItems.length ? 'Automatic verification enabled; checking the latest Hunt…' : 'Automatic verification enabled.';
      refreshStatus().catch(() => {});
    } else {
      autoQueueNote = 'Automatic supplier verification is turned off.';
    }
    renderAgent();
    toast(event.target.checked ? 'Automatic supplier verification enabled' : 'Automatic supplier verification disabled', { type: 'info', duration: 1500 });
  });
  startPolling();
}
