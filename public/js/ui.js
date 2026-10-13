import { $, esc } from './util.js';

export const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function toast(message, { type = 'info', action, duration = 2800 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const glyph = type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info';
  el.innerHTML = `${icon(glyph)}<span>${esc(message)}</span>`;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { action.onClick(); dismiss(); });
    el.append(btn);
  }
  const host = $('#toasts');
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  let timer = setTimeout(dismiss, type === 'error' ? Math.max(duration, 5000) : duration);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 1500); });
  function dismiss() {
    clearTimeout(timer);
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  }
}

export function confirmDialog({ title, body = '', confirmLabel = 'Confirm', danger = true }) {
  const modal = $('#confirmModal');
  $('#confirmTitle').textContent = title;
  $('#confirmBody').textContent = body;
  const ok = $('#confirmOk');
  ok.textContent = confirmLabel;
  ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  modal.returnValue = '';
  modal.showModal();
  ok.focus();
  return new Promise((resolve) => {
    modal.addEventListener('close', () => resolve(modal.returnValue === 'ok'), { once: true });
  });
}

export function busy(button, on) {
  if (!button) return;
  button.disabled = on;
  button.classList.toggle('is-busy', on);
  button.setAttribute('aria-busy', String(on));
}

const DECISION_ICON = { BUY: 'check', WATCH: 'gauge', PASS: 'x' };

export function decisionBadge(decision) {
  if (!decision) return '<span class="badge">Not scored</span>';
  const d = String(decision).toUpperCase();
  return `<span class="badge ${d.toLowerCase()}">${icon(DECISION_ICON[d] || 'gauge')}${esc(d)}</span>`;
}

export function decisionColor(decision) {
  return { BUY: 'var(--good)', WATCH: 'var(--warn)', PASS: 'var(--bad)' }[decision] || 'var(--accent)';
}

export function scoreRing(score, { size = 96, stroke = 8, decision, small = false } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, Number(score) || 0));
  const offset = c * (1 - value / 100);
  return `<div class="score-ring${small ? ' sm' : ''}" style="--ring:${decisionColor(decision)}" role="img" aria-label="Flip score ${value} out of 100">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${offset}"/>
    </svg>
    <strong>${score == null ? '—' : Math.round(value)}</strong><small>/ 100</small>
  </div>`;
}

export function thumb(item, cls = 'thumb') {
  return item.image
    ? `<img class="${cls}" src="${esc(item.image)}" alt="" loading="lazy" decoding="async">`
    : `<div class="${cls} blank">${icon('image')}</div>`;
}

export const statusDot = (status) => `<span class="status-dot" data-status="${esc(status)}">${esc(status)}</span>`;

export function copyButton(target, label = 'Copy') {
  return `<button class="copy-btn" type="button" data-copy="${esc(target)}">${icon('copy')}<span>${label}</span></button>`;
}
