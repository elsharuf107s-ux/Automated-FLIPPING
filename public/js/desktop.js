import { clampWindowRect, defaultDesktopLayout, sanitizeDesktopLayout } from './window-layout.js';

const STORE_KEY = 'fliplab-desktop-layout-v2';
const VIEW_META = {
  dashboard: { title: 'Dashboard', icon: 'home' },
  finder: { title: 'AI Hunt', icon: 'target' },
  scanner: { title: 'AI Scanner', icon: 'spark' },
  inventory: { title: 'Inventory', icon: 'box' },
  sources: { title: 'Sources', icon: 'compass' },
  settings: { title: 'Settings', icon: 'sliders' }
};

let workspace = null;
let taskbar = null;
let layout = {};
let focusHandler = () => {};
let zCounter = 30;
let saveTimer = null;
const records = new Map();

const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;

async function ensureDesktopStyles() {
  const existing = document.querySelector('link[data-desktop-styles]');
  if (existing) {
    if (existing.sheet) return;
    await new Promise((resolve) => existing.addEventListener('load', resolve, { once: true }));
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/desktop.css';
  link.dataset.desktopStyles = 'true';
  document.head.appendChild(link);
  await new Promise((resolve) => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
  });
}

function bounds() {
  return {
    width: Math.max(360, workspace?.clientWidth || innerWidth - 78),
    height: Math.max(260, workspace?.clientHeight || innerHeight - 52)
  };
}

function readStoredLayout() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function saveLayoutSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(layout)); } catch {}
  }, 120);
}

function setRect(record, rect) {
  const safe = clampWindowRect(rect, bounds());
  record.node.style.left = `${safe.left}px`;
  record.node.style.top = `${safe.top}px`;
  record.node.style.width = `${safe.width}px`;
  record.node.style.height = `${safe.height}px`;
  layout[record.view] = { ...layout[record.view], ...safe };
}

function applyRecord(record) {
  const state = layout[record.view];
  record.node.classList.toggle('is-minimized', Boolean(state.minimized));
  record.node.classList.toggle('is-maximized', Boolean(state.maximized));
  record.task.classList.toggle('is-minimized', Boolean(state.minimized));
  record.task.setAttribute('aria-pressed', state.minimized ? 'false' : 'true');
  if (state.maximized) {
    record.node.style.left = '0px';
    record.node.style.top = '0px';
    record.node.style.width = '100%';
    record.node.style.height = '100%';
  } else {
    setRect(record, state);
  }
}

function syncFocusUi(view) {
  for (const record of records.values()) {
    const active = record.view === view && !layout[record.view].minimized;
    record.node.classList.toggle('is-focused', active);
    record.task.classList.toggle('is-active', active);
  }
}

function highestVisible(exceptView = '') {
  return [...records.values()]
    .filter((record) => record.view !== exceptView && !layout[record.view].minimized)
    .sort((a, b) => Number(b.node.style.zIndex || 0) - Number(a.node.style.zIndex || 0))[0];
}

export function focusDesktopWindow(view, { restore = true } = {}) {
  const record = records.get(view);
  if (!record) return false;
  if (restore && layout[view].minimized) {
    layout[view].minimized = false;
    record.node.classList.remove('is-minimized');
    record.task.classList.remove('is-minimized');
  }
  if (layout[view].minimized) return false;
  zCounter += 1;
  record.node.style.zIndex = String(zCounter);
  syncFocusUi(view);
  focusHandler(view);
  saveLayoutSoon();
  return true;
}

export function openDesktopWindow(view) {
  return focusDesktopWindow(view, { restore: true });
}

export function minimizeDesktopWindow(view) {
  const record = records.get(view);
  if (!record) return;
  layout[view].minimized = true;
  record.node.classList.add('is-minimized');
  record.task.classList.add('is-minimized');
  record.task.setAttribute('aria-pressed', 'false');
  if (record.node.classList.contains('is-focused')) {
    record.node.classList.remove('is-focused');
    record.task.classList.remove('is-active');
    const next = highestVisible(view);
    if (next) focusDesktopWindow(next.view, { restore: false });
  }
  saveLayoutSoon();
}

export function toggleMaximizeDesktopWindow(view) {
  const record = records.get(view);
  if (!record) return;
  layout[view].maximized = !layout[view].maximized;
  applyRecord(record);
  focusDesktopWindow(view);
  saveLayoutSoon();
}

function readCurrentRect(record) {
  const nodeRect = record.node.getBoundingClientRect();
  const deskRect = workspace.getBoundingClientRect();
  return clampWindowRect({
    left: nodeRect.left - deskRect.left,
    top: nodeRect.top - deskRect.top,
    width: nodeRect.width,
    height: nodeRect.height
  }, bounds());
}

function bindDrag(record, titlebar) {
  titlebar.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button') || layout[record.view].maximized) return;
    event.preventDefault();
    focusDesktopWindow(record.view);
    const start = readCurrentRect(record);
    const startX = event.clientX;
    const startY = event.clientY;
    titlebar.setPointerCapture?.(event.pointerId);
    record.node.classList.add('is-dragging');

    const move = (moveEvent) => {
      const next = clampWindowRect({
        ...start,
        left: start.left + (moveEvent.clientX - startX),
        top: start.top + (moveEvent.clientY - startY)
      }, bounds());
      record.node.style.left = `${next.left}px`;
      record.node.style.top = `${next.top}px`;
    };
    const up = () => {
      titlebar.removeEventListener('pointermove', move);
      titlebar.removeEventListener('pointerup', up);
      titlebar.removeEventListener('pointercancel', up);
      record.node.classList.remove('is-dragging');
      layout[record.view] = { ...layout[record.view], ...readCurrentRect(record) };
      saveLayoutSoon();
    };
    titlebar.addEventListener('pointermove', move);
    titlebar.addEventListener('pointerup', up);
    titlebar.addEventListener('pointercancel', up);
  });

  titlebar.addEventListener('dblclick', (event) => {
    if (!event.target.closest('button')) toggleMaximizeDesktopWindow(record.view);
  });
}

function makeTaskButton(view, meta) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'desktop-task';
  button.dataset.desktopTask = view;
  button.innerHTML = `${icon(meta.icon)}<span>${meta.title}</span>`;
  button.title = `${meta.title} window`;
  button.addEventListener('click', () => {
    const record = records.get(view);
    if (!record) return;
    if (layout[view].minimized) {
      focusDesktopWindow(view);
      return;
    }
    if (record.node.classList.contains('is-focused')) minimizeDesktopWindow(view);
    else focusDesktopWindow(view);
  });
  return button;
}

function makeWindow(view, section, meta) {
  const node = document.createElement('article');
  node.className = 'desktop-window';
  node.dataset.desktopWindow = view;
  node.setAttribute('aria-label', `${meta.title} window`);

  const titlebar = document.createElement('header');
  titlebar.className = 'desktop-titlebar';
  titlebar.innerHTML = `
    <div class="desktop-window-title">${icon(meta.icon)}<strong>${meta.title}</strong></div>
    <div class="desktop-window-controls">
      <button type="button" data-window-action="minimize" aria-label="Minimize ${meta.title}" title="Minimize">—</button>
      <button type="button" data-window-action="maximize" aria-label="Maximize ${meta.title}" title="Maximize">□</button>
    </div>`;

  const body = document.createElement('div');
  body.className = 'desktop-window-body';
  body.appendChild(section);
  node.append(titlebar, body);
  workspace.appendChild(node);

  const task = makeTaskButton(view, meta);
  taskbar.querySelector('.desktop-task-list').appendChild(task);
  const record = { view, node, task, titlebar, body };
  records.set(view, record);

  titlebar.querySelector('[data-window-action="minimize"]').addEventListener('click', () => minimizeDesktopWindow(view));
  titlebar.querySelector('[data-window-action="maximize"]').addEventListener('click', () => toggleMaximizeDesktopWindow(view));
  node.addEventListener('pointerdown', () => focusDesktopWindow(view, { restore: false }), { capture: true });
  node.addEventListener('pointerup', () => {
    if (layout[view].maximized || layout[view].minimized) return;
    const rect = readCurrentRect(record);
    if (Math.abs(rect.width - layout[view].width) > 1 || Math.abs(rect.height - layout[view].height) > 1) {
      layout[view] = { ...layout[view], ...rect };
      saveLayoutSoon();
    }
  });
  bindDrag(record, titlebar);
  return record;
}

function makeTaskbar() {
  const bar = document.createElement('div');
  bar.className = 'desktop-taskbar';
  bar.innerHTML = `
    <button type="button" class="desktop-home" id="desktopReset" title="Reset window layout">${icon('bolt')}<span>FlipLab</span></button>
    <div class="desktop-task-list" aria-label="Open tools"></div>
    <div class="desktop-taskbar-hint">drag · resize · minimize</div>`;
  document.body.appendChild(bar);
  bar.querySelector('#desktopReset').addEventListener('click', resetDesktopLayout);
  return bar;
}

function launcherTitles() {
  document.querySelectorAll('.nav-item[data-view]').forEach((link) => {
    const meta = VIEW_META[link.dataset.view];
    if (meta) link.title = `Open ${meta.title}`;
  });
}

function bindResize() {
  let timer = null;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const next = sanitizeDesktopLayout(layout, bounds().width, bounds().height);
      for (const [view, record] of records) {
        layout[view] = { ...layout[view], ...next[view] };
        applyRecord(record);
      }
      saveLayoutSoon();
    }, 120);
  });
}

export function resetDesktopLayout() {
  const b = bounds();
  layout = defaultDesktopLayout(b.width, b.height);
  for (const record of records.values()) applyRecord(record);
  focusDesktopWindow('finder');
  saveLayoutSoon();
}

export function isDesktopMode() {
  return Boolean(workspace);
}

export async function initDesktop({ onFocus } = {}) {
  await ensureDesktopStyles();
  focusHandler = typeof onFocus === 'function' ? onFocus : () => {};
  document.body.classList.add('desktop-mode');

  const main = document.querySelector('.main');
  const views = [...main.querySelectorAll(':scope > .view')];
  workspace = document.createElement('div');
  workspace.className = 'desktop-workspace';
  workspace.id = 'desktopWorkspace';
  main.appendChild(workspace);
  taskbar = makeTaskbar();

  const b = bounds();
  layout = sanitizeDesktopLayout(readStoredLayout() || defaultDesktopLayout(b.width, b.height), b.width, b.height);
  for (const section of views) {
    const view = section.id.replace(/^view-/, '');
    const meta = VIEW_META[view];
    if (!meta) continue;
    const record = makeWindow(view, section, meta);
    applyRecord(record);
  }

  launcherTitles();
  bindResize();
  const preferred = !layout.finder?.minimized ? 'finder' : [...records.keys()].find((view) => !layout[view].minimized) || 'finder';
  focusDesktopWindow(preferred);
  return { open: openDesktopWindow, focus: focusDesktopWindow, minimize: minimizeDesktopWindow, reset: resetDesktopLayout };
}
