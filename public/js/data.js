// Client-side state + API calls. Views subscribe and re-render on change.

export const state = {
  items: [],
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

// Batch several changes in the same tick into one render.
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

const byUpdated = (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt);

function upsert(item) {
  const index = state.items.findIndex((entry) => entry.id === item.id);
  if (index === -1) state.items.unshift(item);
  else state.items[index] = item;
  state.items.sort(byUpdated);
  emit();
  return item;
}

export const findItem = (id) => state.items.find((item) => item.id === id);

export async function loadItems() {
  state.items = (await api('/api/items')).sort(byUpdated);
  emit();
}

export async function loadSettings() {
  state.settings = await api('/api/settings');
  emit();
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

export const createItem = async (payload) => upsert(await api('/api/items', { body: payload }));

export async function updateItem(id, patch, { optimistic = false } = {}) {
  const previous = findItem(id);
  if (optimistic && previous) upsert({ ...previous, ...patch, updatedAt: new Date().toISOString() });
  try {
    return upsert(await api(`/api/items/${id}`, { method: 'PATCH', body: patch }));
  } catch (error) {
    if (optimistic && previous) upsert(previous);
    throw error;
  }
}

export const reanalyzeItem = async (id) => upsert(await api(`/api/items/${id}/analyze`, { method: 'POST' }));

export async function deleteItem(id) {
  await api(`/api/items/${id}`, { method: 'DELETE' });
  state.items = state.items.filter((item) => item.id !== id);
  emit();
}
