import { $, esc, shortDate, timeAgo, compressImage, compsUrl, itemQuery, copyText, listingText } from '../util.js';
import { calc, num } from '../econ.js';
import { state, findItem, updateItem, deleteItem, reanalyzeItem } from '../data.js';
import { icon, toast, busy, confirmDialog, statusDot } from '../ui.js';
import { itemEconHtml, aiReportHtml } from '../report.js';

const STATUSES = ['watching', 'bought', 'listed', 'sold', 'passed'];
const CONDITIONS = ['', 'New with tags', 'Like new', 'Excellent', 'Good', 'Fair', 'Needs repair'];
const NUMBER_FIELDS = ['purchasePrice', 'inboundShipping', 'repairCost', 'targetPrice', 'outboundShipping', 'soldPrice', 'marketplaceFeePercent', 'paymentFeePercent'];

const drawer = { id: null, snapshot: '', pendingImage: '', returnFocus: null, onClose: null };
const el = () => $('#drawer');

const input = (name, label, value, attrs = '') => `<label>${label}<input name="${name}" value="${esc(value ?? '')}" ${attrs}></label>`;
const moneyField = (name, label, value) => `<label>${label}<span class="money-input"><input name="${name}" type="number" min="0" step="0.01" inputmode="decimal" value="${num(value) || ''}" placeholder="0"></span></label>`;
const pctField = (name, label, value) => `<label>${label}<span class="unit-input" data-unit="%"><input name="${name}" type="number" min="0" max="100" step="0.1" inputmode="decimal" value="${num(value)}"></span></label>`;

function dateValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readDrawerForm() {
  const form = $('#drawerForm');
  if (!form) return {};
  const data = Object.fromEntries(new FormData(form).entries());
  for (const key of NUMBER_FIELDS) if (key in data) data[key] = num(data[key]);
  data.soldAt = data.soldAt ? new Date(`${data.soldAt}T12:00:00`).toISOString() : null;
  return data;
}

const isDirty = () => Boolean(drawer.pendingImage) || JSON.stringify(readDrawerForm()) !== drawer.snapshot;

function draftItem() {
  const item = findItem(drawer.id);
  return { ...item, ...readDrawerForm(), image: drawer.pendingImage || item?.image };
}

function refreshLive() {
  const item = draftItem();
  $('#drawerEcon').innerHTML = itemEconHtml(calc(item, state.settings));
  $('#soldFields').hidden = item.status !== 'sold';
  const dirty = isDirty();
  $('#drawerSave').disabled = !dirty;
  $('#dirtyFlag').hidden = !dirty;
}

function aiSectionHtml(item) {
  const c = calc(item, state.settings);
  if (!item.ai) {
    return `<div class="empty">${icon('spark')}<strong>No AI report yet</strong>Run an analysis to score this item and draft listing copy.
      <button class="btn btn-primary btn-sm" type="button" data-action="reanalyze" style="margin-top:10px">${icon('spark')}Run analysis</button></div>`;
  }
  return `${aiReportHtml(item.ai, c, 'drawer')}
    <div class="form-actions">
      <button class="btn btn-ghost btn-sm" type="button" data-action="copy-listing">${icon('copy')}Copy listing</button>
      <button class="btn btn-ghost btn-sm" type="button" data-action="reanalyze">${icon('refresh')}Re-run analysis</button>
      <span class="hint">Analyzed ${esc(timeAgo(item.ai.analyzedAt || item.updatedAt))}</span>
    </div>`;
}

function render(item) {
  const c = calc(item, state.settings);
  drawer.pendingImage = '';
  el().innerHTML = `
    <div class="drawer-head">
      <button class="drawer-photo" type="button" data-action="photo" aria-label="Change photo">${item.image ? `<img src="${esc(item.image)}" alt="">` : icon('camera')}</button>
      <input type="file" accept="image/*" id="drawerImage" hidden>
      <div>
        <h2 id="drawerTitle">${esc(item.title || item.brand || 'Untitled item')}</h2>
        <div class="meta">${statusDot(item.status)}<span>Added ${esc(shortDate(item.createdAt))}</span><span class="dirty-dot" id="dirtyFlag" title="Unsaved changes" hidden></span></div>
      </div>
      <button class="icon-btn plain" type="button" data-action="close" aria-label="Close">${icon('x')}</button>
    </div>
    <div class="drawer-body">
      <section><div class="econ-strip" id="drawerEcon">${itemEconHtml(c)}</div></section>
      <form id="drawerForm" autocomplete="off">
        <section>
          <h4>Status</h4>
          <div class="form-grid">
            <label>Pipeline status<select name="status">${STATUSES.map((s) => `<option value="${s}" ${item.status === s ? 'selected' : ''}>${s[0].toUpperCase()}${s.slice(1)}</option>`).join('')}</select></label>
            <div></div>
          </div>
          <div class="form-grid" id="soldFields" style="margin-top:14px" ${item.status === 'sold' ? '' : 'hidden'}>
            ${moneyField('soldPrice', 'Sold price', item.soldPrice)}
            <label>Sold date<input name="soldAt" type="date" value="${dateValue(item.soldAt)}"></label>
          </div>
        </section>
        <section>
          <h4>Details</h4>
          <div class="form-grid">
            <div class="wide">${input('title', 'Title', item.title, 'maxlength="140"')}</div>
            ${input('brand', 'Brand', item.brand, 'maxlength="80"')}
            ${input('category', 'Category', item.category, 'maxlength="80" list="categoryList"')}
            ${input('size', 'Size', item.size, 'maxlength="40"')}
            <label>Condition<select name="condition">${CONDITIONS.map((x) => `<option value="${esc(x)}" ${item.condition === x ? 'selected' : ''}>${x || 'Not set'}</option>`).join('')}</select></label>
            ${input('source', 'Source', item.source, 'maxlength="60"')}
            ${input('sourceUrl', 'Source URL', item.sourceUrl, 'type="url" maxlength="500" placeholder="https://…"')}
          </div>
        </section>
        <section>
          <h4>Costs &amp; fees</h4>
          <div class="form-grid cols-3">
            ${moneyField('purchasePrice', 'Item cost', item.purchasePrice)}
            ${moneyField('inboundShipping', 'Inbound ship', item.inboundShipping)}
            ${moneyField('repairCost', 'Cleaning / repair', item.repairCost)}
            ${moneyField('targetPrice', 'Target price', item.targetPrice)}
            ${moneyField('outboundShipping', 'Outbound ship', item.outboundShipping)}
            <div></div>
            ${pctField('marketplaceFeePercent', 'Marketplace fee', item.marketplaceFeePercent ?? state.settings.marketplaceFeePercent)}
            ${pctField('paymentFeePercent', 'Payment fee', item.paymentFeePercent ?? state.settings.paymentFeePercent)}
          </div>
        </section>
        <section>
          <h4>Notes</h4>
          <textarea name="notes" rows="4" maxlength="4000" aria-label="Notes" placeholder="Condition, measurements, flaws…">${esc(item.notes || '')}</textarea>
        </section>
      </form>
      <section id="drawerAi"><h4>AI report</h4>${aiSectionHtml(item)}</section>
    </div>
    <div class="drawer-foot">
      <button class="btn btn-danger btn-sm" type="button" data-action="delete">${icon('trash')}<span>Delete</span></button>
      ${/^https?:\/\//i.test(item.sourceUrl || '') ? `<a class="btn btn-ghost btn-sm" href="${esc(item.sourceUrl)}" target="_blank" rel="noopener">${icon('external')}<span>Source</span></a>` : ''}
      <a class="btn btn-ghost btn-sm" href="${esc(compsUrl('ebay', itemQuery(item)))}" target="_blank" rel="noopener" title="eBay sold listings">${icon('search')}<span>Comps</span></a>
      <span class="spacer"></span>
      <button class="btn btn-primary" type="button" id="drawerSave" data-action="save" disabled>Save changes</button>
    </div>`;
  drawer.snapshot = JSON.stringify(readDrawerForm());
}

async function save() {
  const form = $('#drawerForm');
  if (!form.reportValidity()) return false;
  const btn = $('#drawerSave');
  busy(btn, true);
  try {
    const patch = readDrawerForm();
    if (drawer.pendingImage) patch.image = drawer.pendingImage;
    const item = await updateItem(drawer.id, patch);
    render(item);
    refreshLive();
    toast('Changes saved', { type: 'success' });
    return true;
  } catch (error) {
    toast(error.message, { type: 'error' });
    busy(btn, false);
    return false;
  }
}

async function reanalyze(button) {
  if (isDirty() && !(await save())) return;
  busy(button, true);
  $('#drawerAi').setAttribute('aria-busy', 'true');
  try {
    const item = await reanalyzeItem(drawer.id);
    render(item);
    refreshLive();
    toast(item.ai?.warning ? 'AI unavailable — demo scoring used' : 'Analysis updated', { type: item.ai?.warning ? 'info' : 'success' });
  } catch (error) {
    toast(error.message, { type: 'error' });
    busy(button, false);
  }
}

async function remove() {
  const item = findItem(drawer.id);
  const ok = await confirmDialog({
    title: 'Delete this item?',
    body: `“${item?.title || 'Untitled item'}” and its photo will be removed from FlipLab. This can’t be undone.`,
    confirmLabel: 'Delete item'
  });
  if (!ok) return;
  try {
    await deleteItem(drawer.id);
    toast('Item deleted', { type: 'success' });
    forceClose();
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

async function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'close') requestClose();
  if (action === 'save') save();
  if (action === 'delete') remove();
  if (action === 'reanalyze') reanalyze(target);
  if (action === 'photo') $('#drawerImage').click();
  if (action === 'copy-listing') {
    const item = findItem(drawer.id);
    if (item?.ai && (await copyText(listingText(item.ai)))) toast('Listing copied', { type: 'success' });
  }
}

export const isDrawerOpen = () => !el().hidden;

export function openDrawer(id, { onClose } = {}) {
  const item = findItem(id);
  if (!item) {
    toast('That item no longer exists.', { type: 'error' });
    onClose?.();
    return;
  }
  const alreadyOpen = isDrawerOpen();
  drawer.id = id;
  drawer.onClose = onClose;
  if (!alreadyOpen) drawer.returnFocus = document.activeElement;
  render(item);
  el().hidden = false;
  el().classList.remove('closing');
  $('#drawerBackdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  if (!alreadyOpen) el().querySelector('[data-action="close"]').focus();
}

function forceClose() {
  if (!isDrawerOpen()) return;
  const node = el();
  node.classList.add('closing');
  $('#drawerBackdrop').hidden = true;
  document.body.style.overflow = '';
  const done = () => {
    node.hidden = true;
    node.classList.remove('closing');
    node.innerHTML = '';
  };
  node.addEventListener('animationend', done, { once: true });
  setTimeout(done, 260);
  drawer.id = null;
  drawer.returnFocus?.focus?.();
  const cb = drawer.onClose;
  drawer.onClose = null;
  cb?.();
}

export async function requestClose() {
  if (!isDrawerOpen()) return true;
  if (isDirty()) {
    const discard = await confirmDialog({ title: 'Discard changes?', body: 'You have unsaved edits on this item.', confirmLabel: 'Discard' });
    if (!discard) return false;
  }
  forceClose();
  return true;
}

// Keep an open, unedited drawer in sync with background changes.
export function syncDrawer() {
  if (!isDrawerOpen() || !drawer.id) return;
  const item = findItem(drawer.id);
  if (!item) { forceClose(); return; }
  if (!isDirty()) {
    const scroll = $('.drawer-body')?.scrollTop || 0;
    render(item);
    refreshLive();
    $('.drawer-body').scrollTop = scroll;
  }
}

export function initDrawer() {
  const node = el();
  node.addEventListener('click', onClick);
  node.addEventListener('input', (event) => {
    if (event.target.closest('#drawerForm')) refreshLive();
  });
  node.addEventListener('change', async (event) => {
    if (event.target.id !== 'drawerImage') return;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      drawer.pendingImage = await compressImage(file);
      $('.drawer-photo').innerHTML = `<img src="${drawer.pendingImage}" alt="">`;
      refreshLive();
    } catch (error) {
      toast(error.message, { type: 'error' });
    }
  });
  node.addEventListener('keydown', (event) => {
    if (event.key === 's' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (isDirty()) save();
    }
    if (event.key === 'Tab') {
      // Keep keyboard focus inside the open drawer.
      const focusable = [...node.querySelectorAll('button:not([disabled]), a[href], input:not([hidden]), select, textarea')].filter((x) => x.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  $('#drawerBackdrop').addEventListener('click', requestClose);
}
