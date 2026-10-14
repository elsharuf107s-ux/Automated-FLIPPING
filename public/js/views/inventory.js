import { $, esc, money } from '../util.js';
import { api } from '../data.js';
import { icon, toast } from '../ui.js';

const STORE_KEY = 'fliplab-scout-inventory-v1';
let inventory = [];
let pollTimer = null;
let started = false;
const announcedTasks = new Set();

function readStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(inventory.slice(0, 120))); } catch {}
}

function keyFor(taskId, match) {
  return `${taskId}:${String(match?.url || match?.title || '').trim()}`;
}

function normalizeItem(task, match, rank) {
  return {
    id: keyFor(task.id, match),
    scoutTaskId: task.id,
    rank,
    goal: task.goal || '',
    addedAt: task.completedAt || task.updatedAt || new Date().toISOString(),
    source: String(match.source || 'Supplier'),
    title: String(match.title || 'Supplier clothing candidate'),
    url: String(match.url || ''),
    image: String(match.image || ''),
    price: match.price ?? null,
    shipping: match.shipping ?? null,
    landedCost: match.landedCost ?? null,
    matchScore: Number(match.matchScore) || 0,
    opportunityScore: Number(match.opportunityScore) || Number(match.matchScore) || 0,
    why: String(match.why || ''),
    whyLikely: String(match.whyLikely || match.why || ''),
    listingAngle: String(match.listingAngle || ''),
    suggestedListPrice: match.suggestedListPrice ?? null,
    sizes: Array.isArray(match.sizes) ? match.sizes : [],
    colors: Array.isArray(match.colors) ? match.colors : [],
    material: match.material || null,
    stock: match.stock || null,
    delivery: match.delivery || null
  };
}

function ingestScoutTask(task) {
  if (task?.type !== 'scout_suppliers' || task.status !== 'completed' || !Array.isArray(task.result?.bestMatches)) return 0;
  let changed = 0;
  const byId = new Map(inventory.map((item) => [item.id, item]));
  task.result.bestMatches.slice(0, 10).forEach((match, index) => {
    if (!match?.url && !match?.title) return;
    const item = normalizeItem(task, match, index + 1);
    const previous = byId.get(item.id);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(item)) {
      byId.set(item.id, item);
      changed += previous ? 0 : 1;
    }
  });
  inventory = [...byId.values()]
    .sort((a, b) => (b.opportunityScore - a.opportunityScore) || String(b.addedAt).localeCompare(String(a.addedAt)))
    .slice(0, 120);
  saveStore();
  renderInventory();
  if (!announcedTasks.has(task.id)) {
    announcedTasks.add(task.id);
    const count = task.result.bestMatches.slice(0, 10).length;
    if (count) toast(`Browser Scout added ${count} ranked item${count === 1 ? '' : 's'} to Inventory`, { type: 'success', duration: 2200 });
  }
  return changed;
}

function scoreClass(score) {
  return Number(score) >= 80 ? 'buy' : Number(score) >= 60 ? 'watch' : '';
}

function itemHtml(item) {
  const facts = [
    item.landedCost != null ? `Landed ${money(item.landedCost)}` : item.price != null ? `Price ${money(item.price)}` : '',
    item.suggestedListPrice != null ? `List around ${money(item.suggestedListPrice)}` : '',
    item.sizes.length ? `Sizes ${item.sizes.slice(0, 5).join(', ')}` : '',
    item.colors.length ? `Colors ${item.colors.slice(0, 4).join(', ')}` : '',
    item.material || '',
    item.stock || '',
    item.delivery || ''
  ].filter(Boolean);
  const image = item.image
    ? `<a class="deal-photo" href="${esc(item.url)}" target="_blank" rel="noopener"><img src="${esc(item.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="deal-badge">#${item.rank}</span></a>`
    : `<a class="deal-photo" href="${esc(item.url)}" target="_blank" rel="noopener">${icon('image')}<span class="deal-badge">#${item.rank}</span></a>`;
  return `<article class="deal-card" data-inventory-id="${esc(item.id)}">
    ${image}
    <div class="deal-body" style="min-height:100%">
      <div class="panel-head" style="margin-bottom:8px">
        <div><p class="eyebrow">${esc(item.source)} · Scout shortlist</p></div>
        <span class="badge ${scoreClass(item.opportunityScore)}">${Math.round(item.opportunityScore)}% opportunity</span>
      </div>
      <h3>${esc(item.title)}</h3>
      <div class="chips" style="margin-top:8px">
        <span class="badge">${Math.round(item.matchScore)}% goal match</span>
        ${facts.slice(0, 3).map((fact) => `<span class="badge">${esc(fact)}</span>`).join('')}
      </div>
      ${facts.length > 3 ? `<p class="field-note" style="margin-top:8px">${esc(facts.slice(3).join(' · '))}</p>` : ''}
      <div class="copy-box" style="margin-top:10px">
        <h4>${icon('trend')} Why this is likely</h4>
        <p style="margin-top:6px">${esc(item.whyLikely || 'Browser Scout ranked this among the strongest products it inspected for the mission.')}</p>
        ${item.listingAngle ? `<p class="field-note" style="margin-top:7px"><b>Listing angle:</b> ${esc(item.listingAngle)}</p>` : ''}
        ${item.why && item.why !== item.whyLikely ? `<p class="field-note" style="margin-top:7px"><b>Match:</b> ${esc(item.why)}</p>` : ''}
      </div>
      <p class="photo-note">${icon('info')}<span>Supplier image is research/reference material. Only use images in a listing when you have the right to use them.</span></p>
      <div class="deal-actions" style="margin-top:auto;padding-top:12px">
        <button class="btn btn-primary btn-sm" type="button" data-inventory-action="ready">${icon('spark')}<span>Build Ready to Post</span></button>
        ${item.url ? `<a class="btn btn-ghost btn-sm" href="${esc(item.url)}" target="_blank" rel="noopener">${icon('external')}<span>Open supplier</span></a>` : ''}
        <button class="btn btn-ghost btn-sm" type="button" data-inventory-action="remove">${icon('trash')}<span>Remove</span></button>
      </div>
    </div>
  </article>`;
}

function renderInventory() {
  const meta = $('#inventoryMeta');
  const list = $('#inventoryList');
  if (!meta || !list) return;
  const high = inventory.filter((item) => item.opportunityScore >= 80).length;
  meta.innerHTML = `<b>${inventory.length}</b> ranked candidates · <b>${high}</b> high-confidence opportunities · automatically filled by Browser Scout`;
  list.innerHTML = inventory.length
    ? `<div class="deal-grid">${inventory.map(itemHtml).join('')}</div>`
    : `<div class="empty">${icon('wallet')}<strong>No Scout Inventory yet</strong>Finish a Browser Scout mission. Its strongest inspected products will appear here automatically with a reason and a Ready to Post button.</div>`;
}

function openScanner() {
  const launcher = document.querySelector('.nav-item[data-view="scanner"]');
  if (launcher) launcher.click();
  else location.hash = '#/scanner';
}

function loadReadyToPost(item) {
  const form = $('#scanForm');
  if (!form) return;
  form.reset();
  form.elements.sourceUrl.value = '';
  form.elements.title.value = item.title || '';
  if (form.elements.brand) form.elements.brand.value = '';
  if (form.elements.category) form.elements.category.value = 'Clothing';
  if (form.elements.size && item.sizes.length) form.elements.size.value = item.sizes.join(', ').slice(0, 40);
  if (form.elements.source) form.elements.source.value = ['AliExpress', 'DHgate', 'Temu'].includes(item.source) ? item.source : 'manual';
  if (form.elements.purchasePrice && item.price != null) form.elements.purchasePrice.value = item.price;
  if (form.elements.inboundShipping && item.shipping != null) form.elements.inboundShipping.value = item.shipping;
  if (form.elements.targetPrice && item.suggestedListPrice != null) form.elements.targetPrice.value = item.suggestedListPrice;
  form.elements.notes.value = [
    `Browser Scout inventory candidate: ${item.url}`,
    `Opportunity score: ${Math.round(item.opportunityScore)}%`,
    `Goal match: ${Math.round(item.matchScore)}%`,
    item.goal ? `Scout mission: ${item.goal}` : '',
    item.whyLikely ? `Why this made inventory: ${item.whyLikely}` : '',
    item.listingAngle ? `Truthful listing angle: ${item.listingAngle}` : '',
    item.landedCost != null ? `Observed/estimated landed cost: ${money(item.landedCost)}` : '',
    item.sizes.length ? `Sizes: ${item.sizes.join(', ')}` : '',
    item.colors.length ? `Colors: ${item.colors.join(', ')}` : '',
    item.material ? `Material: ${item.material}` : '',
    item.stock ? `Stock: ${item.stock}` : '',
    item.delivery ? `Delivery: ${item.delivery}` : '',
    'Brand rule: keep generic/unbranded supplier clothing generic unless brand/authenticity is separately verified.',
    'Photo rule: supplier/reference images are not automatically licensed for reposting.'
  ].filter(Boolean).join('\n');
  form.dispatchEvent(new Event('input', { bubbles: true }));
  openScanner();
  toast('Scout item loaded into Ready to Post', { type: 'success', duration: 1800 });
  setTimeout(() => $('#analyzeBtn')?.click(), 150);
}

async function syncScoutInventory() {
  try {
    const status = await api('/api/agent/status');
    for (const task of status.tasks || []) ingestScoutTask(task);
  } catch {}
}

function injectInventoryShell() {
  if ($('#view-inventory')) return;
  const nav = document.querySelector('.nav');
  const scanner = nav?.querySelector('[data-view="scanner"]');
  const link = document.createElement('a');
  link.className = 'nav-item';
  link.href = '#/inventory';
  link.dataset.view = 'inventory';
  link.innerHTML = `${icon('wallet')}<span>Scout Inventory</span>`;
  if (scanner) nav.insertBefore(link, scanner);
  else nav?.appendChild(link);

  const section = document.createElement('section');
  section.className = 'view';
  section.id = 'view-inventory';
  section.dataset.title = 'Scout Inventory';
  section.dataset.eyebrow = 'Most likely Browser Scout finds';
  section.innerHTML = `
    <div style="display:grid;gap:14px;padding-bottom:10px">
      <article class="panel">
        <div class="panel-head">
          <div><p class="eyebrow">Browser Scout shortlist</p><h3>Most likely items worth turning into listings</h3></div>
          <button class="btn btn-ghost btn-sm" type="button" id="inventoryClear">${icon('trash')}<span>Clear</span></button>
        </div>
        <p class="field-note">After a Browser Scout mission finishes, FlipLab automatically saves its ranked products here. The score is based on the sourcing goal and captured supplier evidence; it is not a guarantee of sales.</p>
        <p class="field-note" id="inventoryMeta" style="margin-top:10px"></p>
      </article>
      <div id="inventoryList"></div>
    </div>`;
  document.querySelector('.main')?.appendChild(section);
}

export function initInventory() {
  if (started) return;
  started = true;
  inventory = readStore();
  injectInventoryShell();
  renderInventory();

  $('#inventoryList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-inventory-action]');
    const card = event.target.closest('[data-inventory-id]');
    if (!button || !card) return;
    const item = inventory.find((entry) => entry.id === card.dataset.inventoryId);
    if (!item) return;
    if (button.dataset.inventoryAction === 'ready') loadReadyToPost(item);
    if (button.dataset.inventoryAction === 'remove') {
      inventory = inventory.filter((entry) => entry.id !== item.id);
      saveStore();
      renderInventory();
    }
  });

  $('#inventoryClear')?.addEventListener('click', () => {
    inventory = [];
    saveStore();
    renderInventory();
    toast('Scout Inventory cleared', { type: 'info', duration: 1500 });
  });

  syncScoutInventory();
  pollTimer = setInterval(syncScoutInventory, 2500);
}
