import { $, esc, money } from '../util.js';
import { api } from '../data.js';
import { icon, toast } from '../ui.js';

const AUTO_KEY = 'fliplab-agent-auto-verify';
const verified = new Map();
const queuedByUrl = new Map();
let latestStatus = { bridge: null, counts: {}, tasks: [] };
let pendingScoutGoal = '';
let autoQueueNote = '';
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
    <span class="field-note">Start <code>npm run agent:local</code> to let FlipLab surf supplier sites on this Chromebook.</span>`;
}

function scoutResultHtml(result) {
  if (!result) return '';
  const matches = (result.bestMatches || []).slice(0, 3);
  return `<div style="display:grid;gap:7px;margin-top:8px">
    ${result.summary ? `<p class="field-note">${esc(result.summary)}</p>` : ''}
    ${matches.map((match) => `<div class="copy-box" style="padding:9px">
      <div style="display:flex;gap:8px;align-items:center;justify-content:space-between">
        <strong>${esc(match.source || 'Supplier')} · ${esc(match.title || 'Product')}</strong>
        <span class="badge buy">${Math.round(Number(match.matchScore) || 0)}% match</span>
      </div>
      <p class="field-note" style="margin-top:5px">${esc([
        match.price != null ? `Price ${money(match.price)}` : '',
        match.shipping != null ? `Ship ${money(match.shipping)}` : '',
        match.landedCost != null ? `Landed ${money(match.landedCost)}` : '',
        match.why || ''
      ].filter(Boolean).join(' · '))}</p>
      ${match.url ? `<a class="btn btn-ghost btn-sm" style="margin-top:7px" href="${esc(match.url)}" target="_blank" rel="noopener">${icon('external')}<span>Open product</span></a>` : ''}
    </div>`).join('')}
  </div>`;
}

function taskSummary(task) {
  if (task.type === 'scout_suppliers') {
    if (task.status === 'queued') return `Waiting to surf: ${task.goal || ''}`;
    if (task.status === 'running') return `Browser is surfing AliExpress / DHgate for: ${task.goal || ''}`;
    if (task.status === 'processing') return 'Browser finished surfing; AI is ranking what it found.';
    return task.result?.summary || '';
  }
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
  const status = task.status === 'processing' ? 'AI ranking' : task.status;
  const scout = task.type === 'scout_suppliers';
  const title = scout ? 'Browser Scout' : task.source || 'Supplier verification';
  const sub = scout ? task.goal : task.supplier?.title || task.url || '';
  const detail = task.error?.message || taskSummary(task) || (task.status === 'queued' ? 'Waiting for the local browser' : '');
  return `<div class="panel" style="padding:12px;margin:0">
    <div class="panel-head" style="margin-bottom:6px">
      <div><strong>${esc(title)}</strong><p class="field-note">${esc(sub || '')}</p></div>
      <span class="badge ${cls}">${esc(status)}</span>
    </div>
    ${detail ? `<p class="field-note">${esc(detail)}</p>` : ''}
    ${scout && task.status === 'completed' ? scoutResultHtml(task.result) : ''}
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
    : `<div class="empty">${icon('plug')}<strong>No browser missions yet</strong>Give Browser Scout a goal or run a Hunt with auto-surf enabled.</div>`;
  const auto = $('#agentAutoVerify');
  if (auto) auto.checked = autoPref();
  const autoStatus = $('#agentAutoStatus');
  if (autoStatus) autoStatus.textContent = autoQueueNote;
}

export async function queueBrowserScout(goal, { silent = false } = {}) {
  const cleanGoal = String(goal || '').trim();
  if (cleanGoal.length < 3) throw new Error('Tell Browser Scout what you want it to find.');
  const task = await api('/api/agent/scout', { body: { goal: cleanGoal } });
  latestStatus.tasks = [task, ...(latestStatus.tasks || []).filter((entry) => entry.id !== task.id)].slice(0, 30);
  renderAgent();
  if (!silent) toast(isBrowserAgentConnected() ? 'Browser Scout mission queued' : 'Mission queued — start the local Browser Agent', { type: 'info' });
  return task;
}

function huntScoutGoal(items = []) {
  const candidates = (Array.isArray(items) ? items : []).filter((item) => item?.title).slice(0, 4);
  if (!candidates.length) return '';
  const lines = candidates.map((item, index) => `${index + 1}. ${item.title}${item.price != null ? ` — reference ask ${money(item.price)}` : ''}`);
  return `Surf AliExpress and DHgate and find cheaper lawful clothing supplier options for these Hunt opportunities. Match the garment/style attributes, not counterfeit branding. Prefer strong visual/style matches, low landed cost, useful size/color availability, and products that appear in stock.\n${lines.join('\n')}`;
}

async function queuePendingScout() {
  if (!pendingScoutGoal || !agentAutoVerifyEnabled() || !isBrowserAgentConnected()) return { queued: 0 };
  const goal = pendingScoutGoal;
  pendingScoutGoal = '';
  try {
    await queueBrowserScout(goal, { silent: true });
    autoQueueNote = 'Browser Scout is now surfing AliExpress and DHgate for the latest Hunt.';
    toast('Browser Scout started surfing supplier sites', { type: 'info', duration: 1800 });
    renderAgent();
    return { queued: 1 };
  } catch (error) {
    autoQueueNote = `Could not queue Browser Scout: ${error.message}`;
    renderAgent();
    return { queued: 0 };
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
    if (triggerAuto && isBrowserAgentConnected() && pendingScoutGoal) await queuePendingScout();
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
  latestStatus.tasks = [task, ...(latestStatus.tasks || []).filter((entry) => entry.id !== task.id)].slice(0, 30);
  renderAgent();
  if (!silent) toast(isBrowserAgentConnected() ? 'Supplier verification queued in your local browser' : 'Queued — start the Browser Agent bridge', { type: 'info' });
  return task;
}

// Kept under the original exported name so Hunt does not need another integration layer.
// v2 changes the behavior from "verify URLs search already found" to "make the local
// browser actively surf supplier sites and find products itself."
export async function autoVerifySuppliers(items = []) {
  pendingScoutGoal = huntScoutGoal(items);
  if (!pendingScoutGoal) {
    autoQueueNote = 'Latest Hunt did not produce enough product information for a supplier mission.';
    renderAgent();
    return { queued: 0, reason: 'no-goal' };
  }
  if (!agentAutoVerifyEnabled()) {
    autoQueueNote = 'Automatic Browser Scout after Hunt is turned off.';
    renderAgent();
    return { queued: 0, reason: 'disabled' };
  }
  await refreshStatus({ triggerAuto: false });
  if (!isBrowserAgentConnected()) {
    autoQueueNote = 'Latest Hunt is waiting for your local Browser Agent. It will start surfing when the bridge connects.';
    renderAgent();
    return { queued: 0, reason: 'waiting-for-bridge' };
  }
  return queuePendingScout();
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
  section.dataset.eyebrow = 'Local Playwright web worker';
  section.innerHTML = `
    <div style="display:grid;gap:14px;padding-bottom:10px">
      <article class="panel">
        <div class="panel-head">
          <div><p class="eyebrow">Browser Scout</p><h3>Tell the browser what to go find</h3></div>
          <div id="agentConnection" style="display:grid;justify-items:end;gap:5px"></div>
        </div>
        <p class="field-note">This is active browser research: Playwright opens supplier sites on your Chromebook, types searches, scrolls results, opens promising product pages, collects what it sees, then FlipLab AI ranks the products. It stays read-only: no buying, messaging, Depop control, or CAPTCHA bypass.</p>
        <form id="agentMissionForm" style="display:grid;gap:10px;margin-top:14px">
          <textarea id="agentMission" rows="3" maxlength="900" required minlength="3" placeholder="Find oversized washed black hoodies under $15 landed, sizes M-XXL, preferably cotton blend"></textarea>
          <div class="form-actions split">
            <span class="field-note small">Currently surfs AliExpress + DHgate. More research sites can be added after this loop is reliable.</span>
            <button class="btn btn-primary" id="agentMissionGo" type="submit">${icon('search')}<span>Send browser surfing</span></button>
          </div>
        </form>
      </article>

      <article class="panel">
        <div class="panel-head"><div><p class="eyebrow">Hunt integration</p><h3>Automatic supplier surfing</h3></div></div>
        <label style="display:flex;align-items:center;gap:10px">
          <input id="agentAutoVerify" type="checkbox" ${autoPref() ? 'checked' : ''}>
          <span><strong>After each Hunt, make the local browser search suppliers itself</strong><br><small class="field-note">Hunt chooses opportunities; Browser Scout performs the supplier-site research.</small></span>
        </label>
        <p class="field-note" id="agentAutoStatus" style="margin-top:10px"></p>
      </article>

      <article class="panel">
        <div class="panel-head"><div><p class="eyebrow">Local setup</p><h3>Run beside FlipLab</h3></div></div>
        <div class="copy-box" style="margin-top:10px">
          <pre id="agentRunCommand" style="white-space:pre-wrap">npm install\nnpx playwright install chromium\nnpm run agent:local</pre>
          <button class="btn btn-ghost btn-sm" type="button" data-copy="agentRunCommand">${icon('copy')}<span>Copy</span></button>
        </div>
      </article>

      <div>
        <div class="panel-head"><div><p class="eyebrow">Activity</p><h3>Browser missions</h3></div></div>
        <div id="agentTasks" style="display:grid;gap:8px"></div>
      </div>
    </div>`;
  document.querySelector('.main')?.appendChild(section);
}

export function initAgent() {
  if (started) return;
  started = true;
  injectAgentShell();

  $('#agentMissionForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const goal = $('#agentMission')?.value?.trim();
    const button = $('#agentMissionGo');
    if (!goal) return;
    if (button) button.disabled = true;
    try {
      await queueBrowserScout(goal);
      $('#agentMission').value = '';
    } catch (error) {
      toast(error.message, { type: 'error' });
    } finally {
      if (button) button.disabled = false;
    }
  });

  $('#agentAutoVerify')?.addEventListener('change', (event) => {
    try { localStorage.setItem(AUTO_KEY, event.target.checked ? 'on' : 'off'); } catch {}
    if (event.target.checked) {
      autoQueueNote = pendingScoutGoal ? 'Automatic supplier surfing enabled; checking the latest Hunt…' : 'Automatic supplier surfing enabled.';
      refreshStatus().catch(() => {});
    } else {
      autoQueueNote = 'Automatic Browser Scout after Hunt is turned off.';
    }
    renderAgent();
    toast(event.target.checked ? 'Automatic Browser Scout enabled' : 'Automatic Browser Scout disabled', { type: 'info', duration: 1500 });
  });

  startPolling();
}
