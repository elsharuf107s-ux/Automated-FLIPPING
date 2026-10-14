// Minimal client-side state for the Hunt -> Ready to Post workflow.

export const state = {
  settings: {},
  ai: null,
  version: ''
};

const listeners = new Set();
let queued = false;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const fn of listeners) fn(state);
  });
}

export async function api(url, { body, method = body ? 'POST' : 'GET', ...options } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    ...options
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).error || message; } catch {}
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

export async function loadSettings() {
  state.settings = await api('/api/settings');
  emit();
  return state.settings;
}

export async function loadAi() {
  state.ai = await api('/api/ai-config');
  emit();
  return state.ai;
}

export async function saveSettings(patch) {
  state.settings = await api('/api/settings', { method: 'PATCH', body: patch });
  emit();
  return state.settings;
}

export async function saveAi(patch) {
  state.ai = await api('/api/ai-config', { method: 'PATCH', body: patch });
  emit();
  return state.ai;
}
