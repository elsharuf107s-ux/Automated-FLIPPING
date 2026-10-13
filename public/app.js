import { $, $$, copyText } from './js/util.js';
import { state, subscribe, api, loadItems, loadSettings } from './js/data.js';
import { toast } from './js/ui.js';
import { renderDashboard } from './js/views/dashboard.js';
import { initScanner, renderScanEcon, applyScannerDefaults } from './js/views/scanner.js';
import { initInventory, renderInventory, focusInventorySearch } from './js/views/inventory.js';
import { initDrawer, openDrawer, requestClose, isDrawerOpen, syncDrawer } from './js/views/drawer.js';
import { initSources, loadSources } from './js/views/sources.js';
import { initSettings, fillAiForm, fillSettingsForm, renderAiStatus, syncThemeChoice } from './js/views/settings.js';
import { initFinder, renderFinder, loadSavedSearches, isReportOpen, closeReport } from './js/views/finder.js';

const VIEWS = ['dashboard', 'finder', 'scanner', 'inventory', 'sources', 'settings'];
const RENDERERS = { dashboard: renderDashboard, finder: renderFinder, inventory: renderInventory, scanner: renderScanEcon };
const THEME_KEY = 'fliplab-theme';

let current = null;
let ready = false;
const stale = new Set(VIEWS);

/* ---------- Theme ---------- */
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function themePref() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}

function applyTheme(pref) {
  const dark = pref === 'system' ? darkQuery.matches : pref !== 'light';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('meta[name="theme-color"]').content = dark ? '#0a0c0b' : '#f4f5f1';
  const toggle = $('#themeToggle');
  toggle.innerHTML = `<svg class="i"><use href="#i-${dark ? 'sun' : 'moon'}"/></svg>`;
  toggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}

function setTheme(pref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch {}
  applyTheme(pref);
  syncThemeChoice(pref);
}

/* ---------- Rendering & routing ---------- */
function render(view) {
  if (!ready && view !== 'scanner') return;
  RENDERERS[view]?.();
  stale.delete(view);
}

function show(view) {
  const changed = view !== current;
  current = view;
  const section = $(`#view-${view}`);
  $$('.view').forEach((el) => el.classList.toggle('active', el === section));
  $$('.nav-item').forEach((el) => {
    const active = el.dataset.view === view;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  $('#pageTitle').textContent = section.dataset.title;
  $('#pageEyebrow').textContent = section.dataset.eyebrow;
  document.title = `${section.dataset.title} · FlipLab`;
  if (stale.has(view)) render(view);
  if (changed) window.scrollTo(0, 0);
}

function parseHash() {
  const match = location.hash.match(/^#\/([a-z]+)(?:\/([\w-]+))?/i) || [];
  return { view: VIEWS.includes(match[1]) ? match[1] : 'dashboard', id: match[2] };
}

async function route() {
  const { view, id } = parseHash();
  if (view === 'inventory' && id) {
    show(current || 'inventory');
    if (ready) openDrawer(id, { onClose: () => history.replaceState(null, '', `#/${current}`) });
    return;
  }
  if (isDrawerOpen() && !(await requestClose())) return;
  closeReport();
  show(view);
}

function onStateChange() {
  VIEWS.forEach((view) => stale.add(view));
  if (current) render(current);
  const active = state.items.filter((item) => ['watching', 'bought', 'listed'].includes(item.status)).length;
  $('#navCount').textContent = active;
  $('#navCount').hidden = !ready || active === 0;
  renderAiStatus();
  syncDrawer();
}

/* ---------- Global interactions ---------- */
// Navigate, then run `fn` once the target view is visible (focus fails on hidden fields).
function goThen(hash, fn) {
  if (location.hash === hash) {
    fn();
    return;
  }
  window.addEventListener('hashchange', () => requestAnimationFrame(fn), { once: true });
  location.hash = hash;
}

function isTyping(target) {
  return target.closest('input, textarea, select, [contenteditable="true"]');
}

function bindGlobal() {
  window.addEventListener('hashchange', route);
  $('#themeToggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  darkQuery.addEventListener('change', () => { if (themePref() === 'system') applyTheme('system'); });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#confirmModal').open && (isDrawerOpen() || isReportOpen())) {
      event.preventDefault();
      if (isDrawerOpen()) requestClose();
      else closeReport();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || isDrawerOpen() || isReportOpen()) return;
    if (event.key === '/') {
      event.preventDefault();
      goThen('#/inventory', focusInventorySearch);
    } else if (event.key.toLowerCase() === 'n') {
      goThen('#/scanner', () => $('#scanForm [name="title"]').focus());
    }
  });

  $('#topSearchBtn').addEventListener('click', (event) => {
    event.preventDefault();
    goThen('#/inventory', focusInventorySearch);
  });

  // Rows anywhere (dashboard lists) open the item drawer.
  document.addEventListener('click', (event) => {
    const row = event.target.closest('[data-open]');
    if (row) location.hash = `#/inventory/${row.dataset.open}`;
  });

  // Any [data-copy="elementId"] button copies that element's text.
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const source = document.getElementById(button.dataset.copy);
    if (!source || !(await copyText(source.textContent))) return;
    const label = button.querySelector('span');
    if (label && !button.dataset.label) button.dataset.label = label.textContent;
    button.classList.add('done');
    if (label) label.textContent = 'Copied';
    clearTimeout(button.copyTimer);
    button.copyTimer = setTimeout(() => {
      button.classList.remove('done');
      if (label) label.textContent = button.dataset.label;
    }, 1400);
  });

  // Pick up changes made in another tab when coming back to this one.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ready) loadItems().catch(() => {});
  });
}

function showSkeletons() {
  $('#kpis').innerHTML = Array.from({ length: 4 }, () => '<div class="kpi"><div class="skel" style="height:12px;width:50%"></div><div class="skel" style="height:28px;width:60%;margin:12px 0 8px"></div><div class="skel" style="height:10px;width:70%"></div></div>').join('');
  $('#inventoryList').innerHTML = `<div style="padding:16px 20px;display:grid;gap:10px">${'<div class="skel" style="height:52px"></div>'.repeat(4)}</div>`;
}

async function init() {
  applyTheme(themePref());
  bindGlobal();
  initScanner();
  initInventory(() => render('inventory'));
  initDrawer();
  initSources();
  initFinder();
  initSettings({ onThemeChange: setTheme, currentTheme: themePref() });
  subscribe(onStateChange);
  showSkeletons();
  await route();

  try {
    const health = await api('/api/health');
    state.ai = health.ai;
    state.version = health.version;
    fillAiForm();
    await Promise.all([loadSettings(), loadItems()]);
    ready = true;
    fillSettingsForm();
    applyScannerDefaults();
    onStateChange();
    await route();
  } catch (error) {
    $('#aiName').textContent = 'Server offline';
    $('#aiModel').textContent = 'retry by refreshing';
    $('#aiDot').className = 'ai-dot bad';
    toast(`Could not reach the FlipLab server: ${error.message}`, { type: 'error' });
  }
  loadSources();
  loadSavedSearches();
}

init();
