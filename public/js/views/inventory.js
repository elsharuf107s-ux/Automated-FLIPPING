import { $, esc, money, signedMoney, pct, debounce, timeAgo } from '../util.js';
import { calc } from '../econ.js';
import { state, updateItem, findItem } from '../data.js';
import { icon, toast, thumb, decisionBadge } from '../ui.js';

const STATUSES = ['watching', 'bought', 'listed', 'sold', 'passed'];
const PREFS_KEY = 'fliplab-inventory-prefs';

const view = { filter: 'all', query: '', sort: 'updated' };
try { Object.assign(view, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'), { query: '' }); } catch {}

const savePrefs = () => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ filter: view.filter, sort: view.sort })); } catch {}
};

const SORTERS = {
  updated: (a, b) => new Date(b.item.updatedAt) - new Date(a.item.updatedAt),
  score: (a, b) => (b.item.ai?.score ?? -1) - (a.item.ai?.score ?? -1),
  profit: (a, b) => b.c.profit - a.c.profit,
  roi: (a, b) => (b.c.roi ?? -Infinity) - (a.c.roi ?? -Infinity),
  cost: (a, b) => b.c.landed - a.c.landed,
  title: (a, b) => (a.item.title || '').localeCompare(b.item.title || '')
};

function matches(item, query) {
  if (!query) return true;
  const haystack = [item.title, item.brand, item.category, item.size, item.condition, item.source, item.notes, item.ai?.suggestedTitle]
    .join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
}

function rowHtml({ item, c }) {
  const meta = [item.brand, item.size, item.condition].filter(Boolean).join(' · ') || item.source || '';
  const profitCls = c.hasPrice ? (c.profit > 0 ? 'pos' : c.profit < 0 ? 'neg' : '') : 'muted';
  return `<tr data-id="${esc(item.id)}" tabindex="0">
    <td class="cell-item"><div class="inv-item">${thumb(item)}<div><b>${esc(item.title || item.brand || 'Untitled item')}</b><span>${esc(meta)}${meta ? ' · ' : ''}${esc(timeAgo(item.updatedAt))}</span></div></div></td>
    <td><select class="status-select" data-status-select aria-label="Status">${STATUSES.map((s) => `<option value="${s}" ${item.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
    <td class="r" data-label="Cost">${money(c.landed)}</td>
    <td class="r" data-label="${c.sold ? 'Sold' : 'Target'}">${c.hasPrice ? money(c.salePrice) : '—'}</td>
    <td class="r ${profitCls}" data-label="Profit">${c.hasPrice ? signedMoney(c.profit) : '—'}</td>
    <td class="r ${profitCls}" data-label="ROI">${c.hasPrice ? pct(c.roi) : '—'}</td>
    <td data-label="">${item.ai ? `${decisionBadge(item.ai.decision)} <span class="score-num">${Math.round(item.ai.score)}</span>` : '<span class="muted">—</span>'}</td>
    <td class="cell-chev">${icon('chevron', 'chev')}</td>
  </tr>`;
}

export function renderInventory() {
  const settings = state.settings;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const item of state.items) counts[item.status] = (counts[item.status] || 0) + 1;

  $('#statusChips').innerHTML = [['all', state.items.length], ...STATUSES.map((s) => [s, counts[s]])]
    .map(([key, count]) => `<button class="chip" type="button" role="tab" data-filter="${key}" ${key !== 'all' ? `data-status="${key}"` : ''} aria-selected="${view.filter === key}">${key === 'all' ? 'All' : key} <em>${count}</em></button>`)
    .join('');
  $('#invSort').value = view.sort;

  const rows = state.items
    .filter((item) => (view.filter === 'all' || item.status === view.filter) && matches(item, view.query))
    .map((item) => ({ item, c: calc(item, settings) }))
    .sort(SORTERS[view.sort] || SORTERS.updated);

  const landed = rows.reduce((sum, r) => sum + r.c.landed, 0);
  const profit = rows.reduce((sum, r) => sum + (r.c.hasPrice ? r.c.profit : 0), 0);
  $('#invSummary').innerHTML = rows.length
    ? `<span><b>${rows.length}</b> item${rows.length === 1 ? '' : 's'}</span><span>Cost <b>${money(landed)}</b></span><span>${view.filter === 'sold' ? 'Realized' : 'Profit'} <b class="${profit >= 0 ? 'pos' : 'neg'}">${signedMoney(profit)}</b></span>`
    : '';
  $('#invSummary').hidden = !rows.length;

  const list = $('#inventoryList');
  if (!state.items.length) {
    list.innerHTML = `<div class="empty">${icon('box')}<strong>Your inventory is empty</strong>Scan an item and save it to start your pipeline.<a class="btn btn-primary btn-sm" href="#/scanner" style="margin-top:10px">${icon('plus')}New scan</a></div>`;
    return;
  }
  if (!rows.length) {
    list.innerHTML = `<div class="empty">${icon('search')}<strong>No matches</strong>Try another search or status filter.</div>`;
    return;
  }
  list.innerHTML = `<table class="inv-table">
    <thead><tr><th>Item</th><th>Status</th><th class="r">Cost</th><th class="r">Price</th><th class="r">Profit</th><th class="r">ROI</th><th>AI</th><th></th></tr></thead>
    <tbody>${rows.map(rowHtml).join('')}</tbody>
  </table>`;
}

async function changeStatus(id, status) {
  const item = findItem(id);
  if (!item || item.status === status) return;
  const previous = item.status;
  try {
    await updateItem(id, { status }, { optimistic: true });
    toast(status === 'sold' ? 'Marked sold — add the sale price' : `Moved to ${status}`, {
      type: 'success',
      action: status === 'sold'
        ? { label: 'Add price', onClick: () => { location.hash = `#/inventory/${id}`; } }
        : { label: 'Undo', onClick: () => updateItem(id, { status: previous }, { optimistic: true }).catch((e) => toast(e.message, { type: 'error' })) }
    });
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

export function initInventory(rerender) {
  $('#statusChips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    view.filter = chip.dataset.filter;
    savePrefs();
    rerender();
  });
  $('#invSearch').addEventListener('input', debounce((event) => {
    view.query = event.target.value.trim();
    rerender();
  }, 120));
  $('#invSort').addEventListener('change', (event) => {
    view.sort = event.target.value;
    savePrefs();
    rerender();
  });
  const list = $('#inventoryList');
  list.addEventListener('change', (event) => {
    const select = event.target.closest('[data-status-select]');
    if (select) changeStatus(select.closest('tr').dataset.id, select.value);
  });
  list.addEventListener('click', (event) => {
    if (event.target.closest('select')) return;
    const row = event.target.closest('tr[data-id]');
    if (row) location.hash = `#/inventory/${row.dataset.id}`;
  });
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.target.closest('select')) return;
    const row = event.target.closest('tr[data-id]');
    if (row) location.hash = `#/inventory/${row.dataset.id}`;
  });
}

export function focusInventorySearch() {
  const input = $('#invSearch');
  input.focus();
  input.select();
}
