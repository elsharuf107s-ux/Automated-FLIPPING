import { $, $$, copyText } from './js/util.js';
import { state, subscribe, api, loadSettings } from './js/data.js';
import { toast } from './js/ui.js';
import { initScanner, renderScanEcon, applyScannerDefaults } from './js/views/scanner.js';
import { initSettings, fillAiForm, fillSettingsForm, renderAiStatus, syncThemeChoice } from './js/views/settings.js';
import { initHunt } from './js/views/hunt.js';
import { initAgent } from './js/views/agent.js';
import { initDesktop, openDesktopWindow, isDesktopMode } from './js/desktop.js';

const VIEWS = ['finder', 'scanner', 'agent', 'settings'];
const THEME_KEY = 'fliplab-theme';
let current = 'finder';
let ready = false;

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function themePref() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}

function applyTheme(pref) {
  const dark = pref === 'system' ? darkQuery.matches : pref !== 'light';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('meta[name="theme-color"]').content = dark ? '#0a0c0b' : '#f4f5f1';
  const toggle = $('#themeToggle');
  if (toggle) {
    toggle.innerHTML = `<svg class="i"><use href="#i-${dark ? 'sun' : 'moon'}"/></svg>`;
    toggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }
}

function setTheme(pref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch {}
  applyTheme(pref);
  syncThemeChoice(pref);
}

function activateView(view) {
  const section = $(`#view-${view}`);
  if (!section) return;
  current = view;
  $$('.nav-item').forEach((el) => {
    const active = el.dataset.view === view;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  $('#pageTitle').textContent = section.dataset.title;
  $('#pageEyebrow').textContent = section.dataset.eyebrow;
  document.title = `${section.dataset.title} · FlipLab`;
  if (view === 'scanner' && ready) renderScanEcon();
}

function show(view) {
  const safe = VIEWS.includes(view) ? view : 'finder';
  if (isDesktopMode()) {
    openDesktopWindow(safe);
    activateView(safe);
    return;
  }
  const section = $(`#view-${safe}`);
  $$('.view').forEach((el) => el.classList.toggle('active', el === section));
  activateView(safe);
}

function parseHash() {
  const match = location.hash.match(/^#\/([a-z]+)/i);
  return VIEWS.includes(match?.[1]) ? match[1] : 'finder';
}

function route() {
  show(parseHash());
}

function onStateChange() {
  renderAiStatus();
  if (ready && current === 'scanner') renderScanEcon();
}

function isTyping(target) {
  return target.closest('input, textarea, select, [contenteditable="true"]');
}

function openView(view) {
  history.replaceState(null, '', `#/${view}`);
  show(view);
}

function bindGlobal() {
  window.addEventListener('hashchange', route);
  $('#themeToggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  darkQuery.addEventListener('change', () => { if (themePref() === 'system') applyTheme('system'); });

  $$('.nav-item[data-view]').forEach((link) => link.addEventListener('click', (event) => {
    if (!isDesktopMode()) return;
    event.preventDefault();
    openView(link.dataset.view);
  }));

  $('.brand').addEventListener('click', (event) => {
    if (!isDesktopMode()) return;
    event.preventDefault();
    openView('finder');
  });

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    if (event.key.toLowerCase() === 'h') openView('finder');
    if (event.key.toLowerCase() === 'n') openView('scanner');
    if (event.key.toLowerCase() === 'a') openView('agent');
  });

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
}

async function init() {
  applyTheme(themePref());
  initAgent();
  bindGlobal();
  initScanner();
  initHunt();
  initSettings({ onThemeChange: setTheme, currentTheme: themePref() });
  subscribe(onStateChange);

  await initDesktop({ onFocus: activateView });
  route();

  try {
    const health = await api('/api/health');
    state.ai = health.ai;
    state.version = health.version;
    await loadSettings();
    ready = true;
    fillAiForm();
    fillSettingsForm();
    applyScannerDefaults();
    onStateChange();
    route();
  } catch (error) {
    $('#aiName').textContent = 'Server offline';
    $('#aiModel').textContent = 'refresh to retry';
    $('#aiDot').className = 'ai-dot bad';
    toast(`Could not reach FlipLab: ${error.message}`, { type: 'error' });
  }
}

init();
