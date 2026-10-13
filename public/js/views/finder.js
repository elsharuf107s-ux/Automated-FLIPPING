import { $, esc, money, signedMoney, compsUrl } from '../util.js';
import { calc } from '../econ.js';
import { state, api, createItem } from '../data.js';
import { icon, toast, busy, decisionBadge, scoreRing, confirmDialog } from '../ui.js';
import { aiReportHtml, depopHtml, pricingHtml } from '../report.js';

const CACHE_KEY = 'fliplab-finder';
const BULK_LIMIT = 10;
const BULK_CONCURRENCY = 2;
const EXAMPLES = ['carhartt detroit jacket', 'patagonia synchilla', 'levis 550 baggy', 'nike acg', 'vintage harley davidson tee'];

const finder = {
  search: null,
  result: null,
  analyses: new Map(),
  details: new Map(),
  running: new Set(),
  saved: [],
  bulk: null,
  reportId: null,
  returnFocus: null
};

/* ---------- persistence (survives refresh, not a new tab) ---------- */
try {
  const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
  if (cached) {
    finder.search = cached.search;
    finder.result = cached.result;
    finder.analyses = new Map(cached.analyses || []);
  }
} catch {}

function persist() {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      search: finder.search,
      result: finder.result,
      analyses: [...finder.analyses].slice(-60)
    }));
  } catch {}
}

/* ---------- helpers ---------- */
const listingById = (id) => finder.result?.listings.find((l) => l.id === id);
const inventoryItem = (id) => state.items.find((item) => item.externalId === id);
const isAuctionOnly = (l) => l.buyingOptions.includes('AUCTION') && !l.buyingOptions.includes('FIXED_PRICE');

function endsIn(iso) {
  if (!iso) return '';
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'ended';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}d left`;
  return h ? `${h}h ${m}m left` : `${m}m left`;
}

function shippingText(l) {
  if (l.shipping == null) return 'shipping varies';
  return l.shipping === 0 ? 'free shipping' : `+ ${money(l.shipping)} ship`;
}

function profitAtList(record) {
  const depop = record.analysis.depop;
  return calc({ ...record.item, targetPrice: depop?.listPrice || record.item.targetPrice }, state.settings).profit;
}

/* ---------- results ---------- */
function cardHtml(l) {
  const record = finder.analyses.get(l.id);
  const running = finder.running.has(l.id);
  const saved = inventoryItem(l.id);
  const badge = l.belowMarketPct != null && l.belowMarketPct >= 5
    ? `<span class="deal-badge">${l.belowMarketPct}% below typical</span>`
    : l.belowMarketPct != null && l.belowMarketPct <= -15 ? '<span class="deal-badge over">above typical</span>' : '';
  const meta = [
    l.condition,
    isAuctionOnly(l) ? `${l.bidCount ?? 0} bid${l.bidCount === 1 ? '' : 's'} · ${endsIn(l.endsAt)}` : 'Buy It Now',
    l.seller?.feedbackPercentage != null ? `${l.seller.feedbackPercentage}% seller` : ''
  ].filter(Boolean).join(' · ');

  let ai = '';
  if (running) {
    ai = '<div class="deal-ai"><span class="pulse"></span><span>Analyzing…</span></div>';
  } else if (record) {
    const a = record.analysis;
    const profit = profitAtList(record);
    ai = `<div class="deal-ai">${scoreRing(a.score, { size: 44, stroke: 5, decision: a.decision, small: true })}
      <div>${decisionBadge(a.decision)}<span>List ${money(a.depop?.listPrice)} · <b class="${profit >= 0 ? 'pos' : 'neg'}">${signedMoney(profit)}</b></span></div></div>`;
  }

  return `<article class="deal-card${record ? ` scored ${esc(record.analysis.decision.toLowerCase())}` : ''}" data-id="${esc(l.id)}">
    <button class="deal-photo" type="button" data-action="open" aria-label="Open ${esc(l.title)}">
      ${l.image ? `<img src="${esc(l.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : icon('image')}
      ${badge}
      ${l.images.length > 1 ? `<span class="photo-count">${icon('camera')}${l.images.length}</span>` : ''}
    </button>
    <div class="deal-body">
      <h3><button type="button" data-action="open">${esc(l.title)}</button></h3>
      <div class="deal-price"><strong>${money(l.price)}</strong><span>${esc(shippingText(l))}</span></div>
      <div class="deal-meta">${esc(meta)}</div>
      ${ai}
      <div class="deal-actions">
        ${record
          ? `<button class="btn btn-primary btn-sm" type="button" data-action="open">${icon('tag')}<span>Depop listing</span></button>`
          : `<button class="btn btn-ghost btn-sm" type="button" data-action="analyze" ${running ? 'disabled' : ''}>${icon('spark')}<span>Analyze</span></button>`}
        ${saved ? `<a class="btn btn-ghost btn-sm" href="#/inventory/${esc(saved.id)}" title="Already in your inventory">${icon('check')}<span>Saved</span></a>` : ''}
        <a class="icon-btn" href="${esc(l.url)}" target="_blank" rel="noopener" title="Open on eBay" aria-label="Open on eBay">${icon('external')}</a>
      </div>
    </div>
  </article>`;
}

function refreshCard(id) {
  const card = document.querySelector(`.deal-card[data-id="${CSS.escape(id)}"]`);
  const listing = listingById(id);
  if (card && listing) card.outerHTML = cardHtml(listing);
}

function emptyHtml() {
  return `<div class="empty finder-empty">${icon('target')}<strong>Search eBay for underpriced flips</strong>
    FlipLab compares every result with the typical asking price, then the AI prices it and writes your Depop listing.
    <div class="chips example-chips">${EXAMPLES.map((q) => `<button class="chip" type="button" data-example="${esc(q)}">${esc(q)}</button>`).join('')}</div>
  </div>`;
}

function metaHtml() {
  const { result } = finder;
  const m = result.market;
  const typical = m.median
    ? `Typical asking price <b>${money(m.median)}</b> <span class="muted">(middle half ${money(m.low)}–${money(m.high)}, from ${m.count} listings incl. shipping)</span>`
    : '<span class="muted">Not enough listings to work out a typical price for this search.</span>';
  const pending = result.listings.filter((l) => !finder.analyses.has(l.id)).length;
  const bulkLabel = finder.bulk ? `Analyzing ${finder.bulk.done}/${finder.bulk.total}…` : `Analyze top ${Math.min(BULK_LIMIT, pending)}`;
  return `<div><b>${result.listings.length}</b> listings for “${esc(result.search.query)}” · ${typical}</div>
    ${pending ? `<button class="btn btn-ghost btn-sm" type="button" id="bulkAnalyze" ${finder.bulk ? 'disabled' : ''}>${icon('spark')}<span>${bulkLabel}</span></button>` : ''}`;
}

export function renderFinder() {
  const ebayReady = Boolean(state.ai?.ebay?.configured);
  $('#finderSetup').hidden = ebayReady;
  renderSaved();
  const meta = $('#finderMeta');
  const results = $('#finderResults');
  if (!finder.result) {
    meta.hidden = true;
    results.innerHTML = ebayReady ? emptyHtml() : '';
    return;
  }
  meta.hidden = false;
  meta.innerHTML = metaHtml();
  results.innerHTML = finder.result.listings.length
    ? `<div class="deal-grid">${finder.result.listings.map(cardHtml).join('')}</div>`
    : `<div class="empty">${icon('search')}<strong>No listings found</strong>Try fewer words, a wider price range, or “Any” condition.</div>`;
}

function renderSaved() {
  $('#savedSearches').innerHTML = finder.saved.map((s) => `<span class="chip saved-chip">
      <button type="button" data-run-saved="${esc(s.id)}" title="${esc(s.query)}">${icon('bookmark')}${esc(s.name)}</button>
      <button type="button" class="chip-x" data-delete-saved="${esc(s.id)}" aria-label="Delete saved search ${esc(s.name)}">${icon('x')}</button>
    </span>`).join('');
}

/* ---------- actions ---------- */
function readSearchForm() {
  const form = $('#finderForm');
  const data = Object.fromEntries(new FormData(form).entries());
  return { ...data, minPrice: Number(data.minPrice) || 0, maxPrice: Number(data.maxPrice) || 0 };
}

function fillSearchForm(search) {
  const form = $('#finderForm');
  for (const key of ['query', 'condition', 'format', 'sort']) if (search[key] != null) form.elements[key].value = search[key];
  form.elements.minPrice.value = search.minPrice || '';
  form.elements.maxPrice.value = search.maxPrice || '';
}

async function runSearch(search) {
  if (!state.ai?.ebay?.configured) {
    toast('Add your eBay keys in Settings first.', { type: 'error', action: { label: 'Settings', onClick: () => { location.hash = '#/settings'; } } });
    return;
  }
  const btn = $('#finderGo');
  busy(btn, true);
  $('#finderResults').innerHTML = `<div class="deal-grid">${'<div class="deal-card skel-card"><div class="skel" style="aspect-ratio:1"></div><div style="padding:14px;display:grid;gap:8px"><div class="skel" style="height:14px"></div><div class="skel" style="height:14px;width:60%"></div><div class="skel" style="height:20px;width:40%"></div></div></div>'.repeat(8)}</div>`;
  try {
    finder.result = await api('/api/finder/search', { body: search });
    finder.search = finder.result.search;
    persist();
    renderFinder();
  } catch (error) {
    toast(error.message, { type: 'error' });
    renderFinder();
  } finally {
    busy(btn, false);
  }
}

async function analyze(id) {
  if (finder.running.has(id) || finder.analyses.has(id)) return;
  finder.running.add(id);
  refreshCard(id);
  if (finder.reportId === id) renderReport();
  try {
    const record = await api('/api/finder/analyze', { body: { id, market: finder.result?.market } });
    finder.analyses.set(id, record);
    finder.details.set(id, record.listing);
    persist();
    if (record.analysis.warning) toast(`AI unavailable — demo scoring used: ${record.analysis.warning}`, { type: 'info' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  } finally {
    finder.running.delete(id);
    refreshCard(id);
    if (finder.reportId === id) renderReport();
    if (finder.result && !finder.bulk) $('#finderMeta').innerHTML = metaHtml();
  }
}

async function bulkAnalyze() {
  const queue = finder.result.listings.filter((l) => !finder.analyses.has(l.id)).slice(0, BULK_LIMIT).map((l) => l.id);
  if (!queue.length) return;
  finder.bulk = { done: 0, total: queue.length };
  $('#finderMeta').innerHTML = metaHtml();
  const worker = async () => {
    while (queue.length) {
      await analyze(queue.shift());
      finder.bulk.done += 1;
      $('#finderMeta').innerHTML = metaHtml();
    }
  };
  await Promise.all(Array.from({ length: BULK_CONCURRENCY }, worker));
  finder.bulk = null;
  $('#finderMeta').innerHTML = metaHtml();
  const buys = finder.result.listings.filter((l) => finder.analyses.get(l.id)?.analysis.decision === 'BUY').length;
  toast(`Analysis done — ${buys} BUY pick${buys === 1 ? '' : 's'}`, { type: 'success' });
}

async function saveSearch() {
  const search = readSearchForm();
  if (String(search.query || '').trim().length < 2) {
    toast('Type a search first.', { type: 'error' });
    return;
  }
  try {
    const saved = await api('/api/finder/searches', { body: { ...search, name: search.query } });
    finder.saved.push(saved);
    renderSaved();
    toast('Search saved', { type: 'success' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

async function deleteSaved(id) {
  const search = finder.saved.find((s) => s.id === id);
  if (!search || !(await confirmDialog({ title: 'Delete saved search?', body: `“${search.name}” will be removed.`, confirmLabel: 'Delete' }))) return;
  try {
    await api(`/api/finder/searches/${encodeURIComponent(id)}`, { method: 'DELETE' });
    finder.saved = finder.saved.filter((s) => s.id !== id);
    renderSaved();
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

/* ---------- report drawer ---------- */
const reportEl = () => $('#reportDrawer');
export const isReportOpen = () => !reportEl().hidden;

function galleryHtml(listing) {
  if (!listing.images?.length) return '';
  return `<section class="gallery">
    <div class="gallery-main"><img id="galleryMain" src="${esc(listing.images[0])}" alt="${esc(listing.title)}" referrerpolicy="no-referrer"></div>
    ${listing.images.length > 1 ? `<div class="gallery-thumbs">${listing.images.map((src, i) => `<button type="button" data-photo="${esc(src)}" class="${i === 0 ? 'active' : ''}" aria-label="Photo ${i + 1}"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')}</div>` : ''}
    <p class="photo-note">${icon('info')}<span>These are the seller’s photos — use them to judge the item. Depop expects photos of the item you actually have, so take your own once it arrives (see “Photos to take” below).</span></p>
  </section>`;
}

function specsHtml(listing) {
  const aspects = Object.entries(listing.aspects || {});
  return `${aspects.length ? `<section><h4>Item specifics (from eBay)</h4><dl class="specs">${aspects.slice(0, 20).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>` : ''}
    ${listing.conditionDescription ? `<section><h4>Seller’s condition notes</h4><p class="seller-text">${esc(listing.conditionDescription)}</p></section>` : ''}
    ${listing.description ? `<section><details class="seller-desc"><summary>Seller’s description</summary><p class="seller-text">${esc(listing.description)}</p></details></section>` : ''}`;
}

function renderReport() {
  const id = finder.reportId;
  if (!id) return;
  const record = finder.analyses.get(id);
  const listing = record?.listing || finder.details.get(id) || listingById(id);
  if (!listing) return;
  const saved = inventoryItem(id);
  const running = finder.running.has(id);
  const scroll = $('#reportDrawer .drawer-body')?.scrollTop || 0;
  const a = record?.analysis;
  const query = [listing.brand, listing.title].filter(Boolean).join(' ').slice(0, 80);

  reportEl().innerHTML = `
    <div class="drawer-head">
      <div>
        <h2 id="reportTitle">${esc(listing.title)}</h2>
        <div class="meta"><span><b>${money(listing.total)}</b> total</span><span>${esc(listing.condition || '')}</span>${listing.seller ? `<span>${esc(listing.seller.username)} · ${listing.seller.feedbackPercentage ?? '?'}%</span>` : ''}</div>
      </div>
      <button class="icon-btn plain" type="button" data-action="close-report" aria-label="Close">${icon('x')}</button>
    </div>
    <div class="drawer-body">
      ${galleryHtml(listing)}
      ${a ? pricingHtml(record.item, a.depop, state.settings) : ''}
      ${a
        ? `<section><h4>AI verdict</h4>${aiReportHtml(a, calc({ ...record.item, targetPrice: a.depop?.listPrice || record.item.targetPrice }, state.settings), 'report')}</section>
           ${depopHtml(a.depop, 'report')}`
        : `<section class="analyze-cta">${icon('spark')}<div><strong>Get the price and your Depop listing</strong><p>The AI looks at the photos and details, estimates what it resells for, and writes everything you need to post it.</p></div>
            <button class="btn btn-primary" type="button" data-action="analyze-report" ${running ? 'disabled' : ''}>${running ? 'Analyzing…' : 'Analyze'}</button></section>`}
      ${specsHtml(listing)}
    </div>
    <div class="drawer-foot">
      <a class="btn btn-ghost btn-sm" href="${esc(listing.url)}" target="_blank" rel="noopener">${icon('external')}<span>eBay</span></a>
      <a class="btn btn-ghost btn-sm" href="${esc(compsUrl('ebay', query))}" target="_blank" rel="noopener" title="eBay sold listings">${icon('search')}<span>Sold comps</span></a>
      <a class="btn btn-ghost btn-sm hide-sm" href="${esc(compsUrl('depop', query))}" target="_blank" rel="noopener">${icon('search')}<span>Depop</span></a>
      <span class="spacer"></span>
      ${saved
        ? `<a class="btn btn-ghost" href="#/inventory/${esc(saved.id)}" data-action="goto-item">${icon('check')}<span>In inventory</span></a>`
        : a ? `<button class="btn btn-ghost" type="button" data-action="save" data-status="watching">${icon('bookmark')}<span>Watch</span></button>
               <button class="btn btn-primary" type="button" data-action="save" data-status="bought">${icon('check')}<span>I bought it</span></button>` : ''}
    </div>`;
  const body = $('#reportDrawer .drawer-body');
  if (body) body.scrollTop = scroll;
}

async function loadDetails(id) {
  if (finder.details.has(id) || finder.analyses.has(id)) return;
  try {
    finder.details.set(id, await api(`/api/finder/listings/${encodeURIComponent(id)}`));
    if (finder.reportId === id) renderReport();
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

function openReport(id) {
  if (!listingById(id) && !finder.analyses.has(id)) return;
  if (reportEl().hidden) finder.returnFocus = document.activeElement;
  finder.reportId = id;
  renderReport();
  reportEl().hidden = false;
  reportEl().classList.remove('closing');
  $('#reportBackdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  reportEl().querySelector('[data-action="close-report"]').focus();
  loadDetails(id);
}

export function closeReport() {
  if (!isReportOpen()) return;
  const node = reportEl();
  node.classList.add('closing');
  $('#reportBackdrop').hidden = true;
  document.body.style.overflow = '';
  const done = () => {
    node.hidden = true;
    node.classList.remove('closing');
    node.innerHTML = '';
  };
  node.addEventListener('animationend', done, { once: true });
  setTimeout(done, 260);
  finder.reportId = null;
  finder.returnFocus?.focus?.();
}

async function saveListing(button, status) {
  const record = finder.analyses.get(finder.reportId);
  if (!record) return;
  busy(button, true);
  try {
    const item = await createItem({ ...record.item, ai: record.analysis, status });
    toast(status === 'bought' ? 'Added to inventory as bought' : 'Added to your watchlist', {
      type: 'success',
      action: { label: 'Open', onClick: () => { closeReport(); location.hash = `#/inventory/${item.id}`; } }
    });
    renderReport();
    refreshCard(record.listing.id);
  } catch (error) {
    toast(error.message, { type: 'error' });
    busy(button, false);
  }
}

/* ---------- wiring ---------- */
export async function loadSavedSearches() {
  try {
    finder.saved = await api('/api/finder/searches');
    renderSaved();
  } catch {}
}

export function initFinder() {
  if (finder.search) fillSearchForm(finder.search);

  $('#finderForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.target.reportValidity()) runSearch(readSearchForm());
  });
  $('#saveSearch').addEventListener('click', saveSearch);
  $('#savedSearches').addEventListener('click', (event) => {
    const run = event.target.closest('[data-run-saved]');
    const del = event.target.closest('[data-delete-saved]');
    if (del) deleteSaved(del.dataset.deleteSaved);
    else if (run) {
      const search = finder.saved.find((s) => s.id === run.dataset.runSaved);
      if (search) {
        fillSearchForm(search);
        runSearch(search);
      }
    }
  });
  $('#finderMeta').addEventListener('click', (event) => {
    if (event.target.closest('#bulkAnalyze')) bulkAnalyze();
  });
  $('#finderResults').addEventListener('click', (event) => {
    const example = event.target.closest('[data-example]');
    if (example) {
      fillSearchForm({ query: example.dataset.example });
      runSearch(readSearchForm());
      return;
    }
    const action = event.target.closest('[data-action]');
    const card = event.target.closest('.deal-card');
    if (!action || !card) return;
    if (action.dataset.action === 'open') openReport(card.dataset.id);
    if (action.dataset.action === 'analyze') analyze(card.dataset.id);
  });

  const node = reportEl();
  node.addEventListener('click', (event) => {
    const photo = event.target.closest('[data-photo]');
    if (photo) {
      $('#galleryMain').src = photo.dataset.photo;
      node.querySelectorAll('[data-photo]').forEach((b) => b.classList.toggle('active', b === photo));
      return;
    }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'close-report') closeReport();
    if (action.dataset.action === 'analyze-report') analyze(finder.reportId);
    if (action.dataset.action === 'save') saveListing(action, action.dataset.status);
    if (action.dataset.action === 'goto-item') closeReport();
  });
  $('#reportBackdrop').addEventListener('click', closeReport);
}
