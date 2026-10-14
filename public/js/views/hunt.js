import { $, esc, money } from '../util.js';
import { api } from '../data.js';
import { icon, toast, busy } from '../ui.js';
import {
  autoVerifySuppliers,
  getSupplierVerification,
  isBrowserAgentConnected,
  queueSupplierVerification
} from './agent.js';

const EXAMPLES = [
  'Find vintage Nike or Adidas jackets under $40 with public buyer interest like bids, watchers, likes, or offers',
  'Find generic or badly titled work jackets under $40 that might be undervalued',
  'Find hoodies and sweatshirts under $30 with visible buyer activity plus generic listings people may miss',
  'Find Y2K clothing under $30 with strong public demand signals or vague titles'
];
const POLL_INTERVAL_MS = 1250;
const HUNT_DEADLINE_MS = 140_000;

const hunt = { result: null, prompt: '', runVersion: 0 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function injectHuntUi() {
  if ($('#huntForm')) return;
  const view = $('#view-finder');
  const wrapper = document.createElement('div');
  wrapper.id = 'huntWorkspace';
  wrapper.innerHTML = `
    <form class="panel finder-form" id="huntForm" autocomplete="off" style="margin-bottom:18px">
      <div class="panel-head">
        <div><p class="eyebrow">AI Hunt · demand + supplier compare + local verification</p><h3>Tell FlipLab what clothing to find</h3></div>
        <span class="status-chip ok">agent-ready hunt</span>
      </div>
      <label style="display:grid;gap:8px">
        <span class="field-note">Write it normally. FlipLab finds clothing with buyer activity or weak/generic listings, checks AliExpress, DHgate and Temu for cheaper matches, then the optional local Browser Agent can verify the strongest AliExpress/DHgate pages.</span>
        <textarea id="huntPrompt" name="prompt" rows="3" maxlength="1200" required minlength="3" placeholder="Find me work jackets under $40 with buyer activity, then find cheaper supplier versions…" style="width:100%;resize:vertical;min-height:92px"></textarea>
      </label>
      <div class="chips example-chips" id="huntExamples">
        ${EXAMPLES.map((example) => `<button class="chip" type="button" data-hunt-example="${esc(example)}">${esc(example)}</button>`).join('')}
      </div>
      <div class="form-actions split">
        <span class="field-note small">Clothing only. Supplier matches are labeled Exact candidate / Similar / Generic and never inherit a brand just because they look alike. Local verification is read-only and never controls Depop.</span>
        <button class="btn btn-primary btn-lg" type="submit" id="huntGo">${icon('spark')}<span>Hunt clothing</span></button>
      </div>
    </form>
    <div class="finder-meta" id="huntMeta" hidden></div>
    <div id="huntResults"></div>
    <div class="panel guardrail" style="margin:18px 0">
      ${icon('info')}<div><strong>Search first, verify second</strong><p>Search results are leads, not final truth. When the local Browser Agent is connected, FlipLab can open AliExpress/DHgate pages on your Chromebook and re-check visible price, shipping, sizes, colors, material, stock and delivery. Temu remains search-only.</p></div>
    </div>`;
  view.appendChild(wrapper);
}

function priceText(item) {
  if (item.price == null) return 'Price not visible';
  const base = item.currency && item.currency !== 'USD' ? `${item.currency} ${item.price}` : money(item.price);
  if (item.shipping == null) return base;
  return `${base} · ${item.shipping === 0 ? 'free shipping' : `+ ${money(item.shipping)} ship`}`;
}

function middlemanBadge(item) {
  const policy = item.middleman || {};
  const blocked = String(policy.status || '').startsWith('blocked');
  return `<span class="deal-badge${blocked ? ' over' : ''}" title="${esc(policy.note || '')}">${esc(policy.label || 'Check seller rules')}</span>`;
}

function buyerInterestText(item) {
  const d = item.buyerInterest || {};
  const parts = [
    ['offers', 'offer'],
    ['bids', 'bid'],
    ['watchers', 'watcher'],
    ['likes', 'like'],
    ['carts', 'cart/bag']
  ].flatMap(([key, label]) => {
    const value = Number(d[key]);
    return Number.isFinite(value) && value > 0 ? [`${value} ${label}${value === 1 ? '' : 's'}`] : [];
  });
  return parts.join(' · ');
}

function signalHtml(item) {
  const d = item.buyerInterest || {};
  const text = buyerInterestText(item);
  const generic = item.genericOpportunity || {};
  const demandClass = d.strength === 'hot' ? 'buy' : d.strength === 'warm' ? 'watch' : '';
  return `<div class="chips" style="margin-top:8px">
    ${d.hasPublicSignal ? `<span class="badge ${demandClass}">${icon('trend')} ${esc(d.strength === 'hot' ? 'Hot demand' : d.strength === 'warm' ? 'Buyer activity' : 'Light activity')}</span>` : '<span class="badge">Demand unknown</span>'}
    ${text ? `<span class="badge">${esc(text)}</span>` : ''}
    ${generic.isGeneric ? `<span class="badge watch">${icon('search')} Generic gem</span>` : ''}
  </div>
  ${generic.isGeneric && generic.reason ? `<p class="field-note" style="margin-top:7px"><b>Generic angle:</b> ${esc(generic.reason)}</p>` : ''}
  ${d.evidence?.length ? `<p class="field-note" style="margin-top:7px"><b>Public activity evidence:</b> ${esc(d.evidence.slice(0, 3).join(' · '))}</p>` : ''}`;
}

function supplierPriceText(supplier) {
  if (supplier.price == null) return 'Supplier price not visible';
  const base = supplier.currency && supplier.currency !== 'USD' ? `${supplier.currency} ${supplier.price}` : money(supplier.price);
  if (supplier.shipping == null) return base;
  return `${base} · ${supplier.shipping === 0 ? 'free shipping' : `+ ${money(supplier.shipping)} ship`}`;
}

function supplierMatchLabel(supplier) {
  if (supplier.matchType === 'exact') return 'Exact candidate';
  if (supplier.matchType === 'generic') return 'Generic alternative';
  return 'Similar match';
}

function verificationHtml(verification) {
  if (!verification) return '';
  const facts = [
    verification.price != null ? `Price ${money(verification.price)}` : '',
    verification.shipping != null ? `Shipping ${money(verification.shipping)}` : '',
    verification.sizes?.length ? `Sizes ${verification.sizes.slice(0, 6).join(', ')}` : '',
    verification.colors?.length ? `Colors ${verification.colors.slice(0, 4).join(', ')}` : '',
    verification.material ? verification.material : '',
    verification.delivery ? verification.delivery : '',
    verification.inStock === true ? 'In stock' : verification.inStock === false ? 'Out of stock' : ''
  ].filter(Boolean);
  const evidence = Array.isArray(verification.evidence) ? verification.evidence.slice(0, 3) : [];
  return `<div class="copy-box" style="margin-top:10px">
    <h4>${icon('check')} Verified by your local browser</h4>
    <div class="chips" style="margin-top:7px"><span class="badge buy">${Math.round((Number(verification.confidence) || 0) * 100)}% confidence</span>${facts.slice(0, 3).map((fact) => `<span class="badge">${esc(fact)}</span>`).join('')}</div>
    ${facts.length > 3 ? `<p class="field-note" style="margin-top:7px">${esc(facts.slice(3).join(' · '))}</p>` : ''}
    ${evidence.length ? `<p class="field-note" style="margin-top:7px"><b>Evidence:</b> ${esc(evidence.join(' · '))}</p>` : ''}
    ${verification.warnings?.length ? `<p class="field-note" style="margin-top:7px"><b>Check:</b> ${esc(verification.warnings.slice(0, 2).join(' · '))}</p>` : ''}
  </div>`;
}

function supplierHtml(item) {
  const supplier = item.bestSupplier;
  if (!supplier) {
    return `<div class="panel" style="margin-top:12px;padding:12px"><div class="field-note"><b>No cheaper supplier match found yet.</b> The resale candidate still works normally.</div></div>`;
  }

  const verification = supplier.verification || getSupplierVerification(supplier.url);
  if (verification && !supplier.verification) supplier.verification = verification;
  const savings = Number(supplier.savings);
  const savingsText = Number.isFinite(savings) && savings > 0
    ? `${money(savings)} cheaper${Number.isFinite(Number(supplier.savingsPercent)) ? ` · ${supplier.savingsPercent}% less` : ''}`
    : 'Cheaper supplier candidate';
  const differences = Array.isArray(supplier.differences) && supplier.differences.length
    ? supplier.differences.slice(0, 3).join(' · ')
    : '';
  const brandNote = supplier.brandSafety === 'list-as-generic'
    ? 'Keep this supplier item generic/unbranded unless you separately verify brand rights and authenticity.'
    : 'Supplier page names the same brand; authenticity still needs separate verification.';
  const verifyButton = supplier.searchOnly
    ? `<span class="badge">Temu · search-only</span>`
    : verification
      ? `<span class="badge buy">${icon('check')} Locally verified</span>`
      : `<button class="btn btn-ghost btn-sm" type="button" data-hunt-action="verify" data-supplier-index="0">${icon('plug')}<span>${supplier.browserTaskId ? 'Verification queued' : isBrowserAgentConnected() ? 'Verify in local browser' : 'Queue browser verification'}</span></button>`;

  return `<div class="panel" style="margin-top:12px;padding:12px" data-supplier-box>
    <div class="panel-head" style="margin-bottom:8px">
      <div><p class="eyebrow">Cheaper supplier found</p><strong>${esc(supplier.source)} · ${esc(supplierMatchLabel(supplier))}</strong></div>
      <span class="badge buy">${esc(String(supplier.matchConfidence))}% match</span>
    </div>
    <div class="deal-price"><strong>${esc(supplierPriceText(supplier))}</strong> <span class="muted">· ${esc(savingsText)}</span></div>
    <p class="seller-text" style="margin-top:7px">${esc(supplier.why || 'Cheaper clothing supplier candidate.')}</p>
    ${differences ? `<p class="field-note"><b>Differences:</b> ${esc(differences)}</p>` : ''}
    <p class="field-note"><b>Garment:</b> ${esc([supplier.garmentType, supplier.color, supplier.material, supplier.sizeRange].filter(Boolean).join(' · ') || 'Details not fully visible')}</p>
    <p class="field-note"><b>Brand safety:</b> ${esc(brandNote)}</p>
    ${supplier.searchOnly ? '<p class="field-note"><b>Search-only source:</b> FlipLab uses public search metadata for this Temu result and will not open Temu with the browser agent.</p>' : ''}
    ${verificationHtml(verification)}
    <div class="deal-actions" style="padding-top:10px">
      <button class="btn btn-primary btn-sm" type="button" data-hunt-action="supplier" data-supplier-index="0">${icon('spark')}<span>Build ready-to-post pack</span></button>
      ${verifyButton}
      <a class="btn btn-ghost btn-sm" href="${esc(supplier.url)}" target="_blank" rel="noopener">${icon('external')}<span>Open supplier</span></a>
    </div>
  </div>`;
}

function cardHtml(item, index) {
  const meta = [
    item.source,
    item.condition,
    `${item.matchScore}% prompt match`,
    Number.isFinite(Number(item.opportunityScore)) ? `${item.opportunityScore}% hunt score` : ''
  ].filter(Boolean).join(' · ');
  const preview = item.previewImages?.[0];
  const count = item.previewImages?.length || 0;
  return `<article class="deal-card" data-hunt-index="${index}">
    <a class="deal-photo" href="${esc(item.url)}" target="_blank" rel="noopener" aria-label="Open ${esc(item.title)}">
      ${preview ? `<img src="${esc(preview)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : icon('image')}
      <span class="deal-badge">${esc(item.source)}</span>
      ${count > 1 ? `<span class="photo-count">${icon('camera')}${count}</span>` : ''}
    </a>
    <div class="deal-body" style="min-height:100%">
      <div class="deal-meta">${middlemanBadge(item)}</div>
      <h3 style="margin-top:8px"><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
      <div class="deal-price"><strong>${esc(priceText(item))}</strong></div>
      <div class="deal-meta">${esc(meta)}</div>
      ${signalHtml(item)}
      <p class="seller-text" style="margin-top:10px">${esc(item.why || 'Matches your hunt prompt.')}</p>
      ${preview ? `<p class="photo-note">${icon('info')}<span>Original listing image preview · reference only unless you own the rights or have permission to reuse it.</span></p>` : '<p class="field-note small">No source image was exposed in search metadata.</p>'}
      ${supplierHtml(item)}
      <p class="field-note small" style="margin-top:10px"><b>${esc(item.middleman?.label || 'Check seller rules')}:</b> ${esc(item.middleman?.note || 'Verify the selling channel and supplier agreement before using a zero-inventory workflow.')}</p>
      <div class="deal-actions" style="margin-top:auto;padding-top:14px">
        <button class="btn btn-ghost btn-sm" type="button" data-hunt-action="analyze">${icon('spark')}<span>Analyze reference listing</span></button>
        <a class="btn btn-ghost btn-sm" href="${esc(item.url)}" target="_blank" rel="noopener">${icon('external')}<span>Open reference</span></a>
      </div>
    </div>
  </article>`;
}

function renderHunt() {
  const meta = $('#huntMeta');
  const results = $('#huntResults');
  if (!hunt.result) {
    meta.hidden = true;
    results.innerHTML = '';
    return;
  }

  const r = hunt.result;
  meta.hidden = false;
  const pictured = r.items.filter((item) => item.previewImages?.length).length;
  const active = r.demandSummary?.active ?? r.items.filter((item) => item.buyerInterest?.hasPublicSignal).length;
  const generic = r.demandSummary?.generic ?? r.items.filter((item) => item.genericOpportunity?.isGeneric).length;
  const supplierMatched = r.supplierSummary?.matchedItems ?? r.items.filter((item) => item.bestSupplier).length;
  const verifiedCount = r.items.filter((item) => item.bestSupplier && (item.bestSupplier.verification || getSupplierVerification(item.bestSupplier.url))).length;
  meta.innerHTML = `<div><b>${r.items.length}</b> clothing matches · <b>${active}</b> with buyer activity · <b>${generic}</b> generic gems · <b>${supplierMatched}</b> cheaper supplier matches · <b>${verifiedCount}</b> locally verified · <b>${pictured}</b> with images <span class="muted">(${esc(r.model)})</span>${r.supplierWarning ? ` <span class="muted">· supplier search partial</span>` : ''}</div>`;

  if (!r.items.length) {
    results.innerHTML = `<div class="empty finder-empty">${icon('search')}<strong>No strong clothing listings found</strong>Try a broader budget, fewer brand restrictions, or a more common garment.</div>`;
    return;
  }

  const citations = (r.citations || []).slice(0, 12);
  results.innerHTML = `
    <div class="deal-grid">${r.items.map(cardHtml).join('')}</div>
    ${citations.length ? `<div class="panel" style="margin-top:16px"><div class="panel-head"><div><p class="eyebrow">Web sources</p><h3>Search evidence</h3></div></div><div class="chips">${citations.map((source) => `<a class="chip" href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.title || source.url)}</a>`).join('')}</div></div>` : ''}`;
}

function loadingHtml() {
  return `<div class="deal-grid">${Array.from({ length: 6 }, () => '<div class="deal-card skel-card"><div class="skel" style="aspect-ratio:1"></div><div style="padding:18px;display:grid;gap:12px"><div class="skel" style="height:12px;width:30%"></div><div class="skel" style="height:18px"></div><div class="skel" style="height:18px;width:55%"></div><div class="skel" style="height:54px"></div></div></div>').join('')}</div>`;
}

async function pollHunt(jobId, version) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < HUNT_DEADLINE_MS) {
    if (version !== hunt.runVersion) return null;
    const job = await api(`/api/hunt/${encodeURIComponent(jobId)}`);
    if (job.status === 'completed') return job.result;
    if (job.status === 'failed') throw new Error(job.error?.message || 'AI Hunt failed.');

    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const meta = $('#huntMeta');
    meta.hidden = false;
    meta.innerHTML = `<div><span class="pulse"></span> Finding clothing → checking demand → comparing AliExpress / DHgate / Temu… <span class="muted">${seconds}s</span></div>`;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('AI Hunt is taking longer than expected. Try a more specific clothing prompt.');
}

async function runHunt(prompt) {
  const button = $('#huntGo');
  const version = ++hunt.runVersion;
  busy(button, true);
  hunt.result = null;
  $('#huntMeta').hidden = true;
  $('#huntResults').innerHTML = loadingHtml();
  try {
    const job = await api('/api/hunt', { body: { prompt } });
    const result = await pollHunt(job.id, version);
    if (!result || version !== hunt.runVersion) return;
    hunt.result = result;
    hunt.prompt = prompt;
    renderHunt();
    autoVerifySuppliers(hunt.result.items).catch(() => {});
    toast(hunt.result.items.length ? `Found ${hunt.result.items.length} clothing matches` : 'No strong clothing matches found', { type: hunt.result.items.length ? 'success' : 'info' });
  } catch (error) {
    if (version !== hunt.runVersion) return;
    hunt.result = null;
    $('#huntMeta').hidden = true;
    $('#huntResults').innerHTML = `<div class="empty finder-empty">${icon('alert')}<strong>AI Hunt failed</strong>${esc(error.message)}</div>`;
    toast(error.message, { type: 'error' });
  } finally {
    if (version === hunt.runVersion) busy(button, false);
  }
}

function focusScanner() {
  const scannerLauncher = document.querySelector('.nav-item[data-view="scanner"]');
  if (scannerLauncher) scannerLauncher.click();
  else location.hash = '#/scanner';
}

function sendToScanner(item) {
  const form = $('#scanForm');
  if (!form) return;
  form.elements.sourceUrl.value = item.url;
  if (item.title) form.elements.title.value = item.title;
  if (item.price != null) form.elements.purchasePrice.value = item.price;
  const interest = buyerInterestText(item);
  form.elements.notes.value = [
    `Found by AI Hunt: ${item.why || 'Matched the sourcing prompt.'}`,
    `Prompt: ${hunt.prompt}`,
    interest ? `Public buyer activity: ${interest}` : '',
    item.genericOpportunity?.isGeneric ? `Generic opportunity: ${item.genericOpportunity.reason || 'Listing is under-described.'}` : '',
    item.middleman?.note ? `Middleman check: ${item.middleman.note}` : ''
  ].filter(Boolean).join('\n');
  form.dispatchEvent(new Event('input', { bubbles: true }));
  focusScanner();
  toast('Opening the reference listing in Ready to Post…', { type: 'info', duration: 1800 });
  setTimeout(() => $('#analyzeBtn')?.click(), 120);
}

function sendSupplierToScanner(item, supplier) {
  const form = $('#scanForm');
  if (!form || !supplier) return;
  const verified = supplier.verification || getSupplierVerification(supplier.url);
  const verifiedPrice = verified?.price ?? supplier.price;
  const verifiedShipping = verified?.shipping ?? supplier.shipping;

  // The supplier URL stays in notes instead of Source URL so Ready to Post does not
  // trigger a second cloud scrape after the Chromebook browser already verified it.
  form.elements.sourceUrl.value = '';
  form.elements.title.value = verified?.title || supplier.title || supplier.garmentType || item.title || '';
  if (form.elements.brand) form.elements.brand.value = '';
  if (form.elements.category) form.elements.category.value = supplier.garmentType || 'Clothing';
  if (form.elements.size && verified?.sizes?.length) form.elements.size.value = verified.sizes.join(', ').slice(0, 40);
  if (form.elements.purchasePrice && verifiedPrice != null) form.elements.purchasePrice.value = verifiedPrice;
  if (form.elements.inboundShipping && verifiedShipping != null) form.elements.inboundShipping.value = verifiedShipping;
  if (form.elements.targetPrice && item.price != null) form.elements.targetPrice.value = item.price;
  if (form.elements.source) form.elements.source.value = supplier.source || 'Supplier';

  form.elements.notes.value = [
    `Supplier clothing match: ${supplier.url}`,
    `Supplier: ${supplier.source}`,
    `Match: ${supplierMatchLabel(supplier)} (${supplier.matchConfidence}% confidence)`,
    supplier.why ? `Why it matches: ${supplier.why}` : '',
    verified ? `Local browser verification: ${Math.round((Number(verified.confidence) || 0) * 100)}% confidence` : 'Local browser verification: not completed yet',
    verified?.price != null ? `Verified price: ${money(verified.price)}` : '',
    verified?.shipping != null ? `Verified shipping: ${money(verified.shipping)}` : '',
    verified?.sizes?.length ? `Verified sizes: ${verified.sizes.join(', ')}` : supplier.sizeRange ? `Search size range: ${supplier.sizeRange}` : '',
    verified?.colors?.length ? `Verified colors: ${verified.colors.join(', ')}` : supplier.color ? `Search color: ${supplier.color}` : '',
    verified?.material ? `Verified material: ${verified.material}` : supplier.material ? `Search material: ${supplier.material}` : '',
    verified?.stockText ? `Stock: ${verified.stockText}` : verified?.inStock === true ? 'Stock: in stock' : verified?.inStock === false ? 'Stock: out of stock' : '',
    verified?.delivery ? `Delivery: ${verified.delivery}` : '',
    verified?.evidence?.length ? `Verification evidence: ${verified.evidence.join('; ')}` : '',
    verified?.warnings?.length ? `Verification warnings: ${verified.warnings.join('; ')}` : '',
    supplier.differences?.length ? `Differences: ${supplier.differences.join('; ')}` : '',
    supplier.savings != null ? `Search-estimated savings vs reference listing: ${money(supplier.savings)}` : '',
    `Reference resale-market listing: ${item.url}`,
    item.price != null ? `Reference asking price: ${money(item.price)}` : '',
    supplier.brandSafety === 'list-as-generic'
      ? 'Brand rule: treat this supplier garment as generic/unbranded. Do not copy the reference listing brand or trademark.'
      : 'Brand rule: supplier names the same brand, but authenticity and resale rights still require separate verification.',
    supplier.searchOnly ? 'Temu result was discovered from public search metadata; FlipLab did not directly crawl Temu.' : ''
  ].filter(Boolean).join('\n');

  form.dispatchEvent(new Event('input', { bubbles: true }));
  focusScanner();
  toast(verified ? 'Verified supplier loaded into Ready to Post' : 'Supplier loaded into Ready to Post', { type: 'success', duration: 1800 });
  setTimeout(() => $('#analyzeBtn')?.click(), 120);
}

async function verifySupplier(item, supplier) {
  try {
    const task = await queueSupplierVerification(supplier, item);
    supplier.browserTaskId = task.id;
    renderHunt();
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

export function initHunt() {
  injectHuntUi();
  $('#huntForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    runHunt($('#huntPrompt').value.trim());
  });

  $('#huntExamples').addEventListener('click', (event) => {
    const example = event.target.closest('[data-hunt-example]');
    if (!example) return;
    $('#huntPrompt').value = example.dataset.huntExample;
    runHunt(example.dataset.huntExample);
  });

  $('#huntResults').addEventListener('click', (event) => {
    const button = event.target.closest('[data-hunt-action]');
    const card = event.target.closest('[data-hunt-index]');
    if (!button || !card || !hunt.result) return;
    const item = hunt.result.items[Number(card.dataset.huntIndex)];
    if (!item) return;

    if (button.dataset.huntAction === 'analyze') sendToScanner(item);
    const supplier = item.supplierMatches?.[Number(button.dataset.supplierIndex || 0)];
    if (button.dataset.huntAction === 'supplier' && supplier) sendSupplierToScanner(item, supplier);
    if (button.dataset.huntAction === 'verify' && supplier) verifySupplier(item, supplier);
  });

  window.addEventListener('fliplab:agent-verified', (event) => {
    if (!hunt.result) return;
    for (const item of hunt.result.items) {
      for (const supplier of item.supplierMatches || []) {
        if (supplier.url === event.detail?.url) supplier.verification = event.detail.result;
      }
      if (item.bestSupplier?.url === event.detail?.url) item.bestSupplier.verification = event.detail.result;
    }
    renderHunt();
    toast('Local supplier verification finished', { type: 'success', duration: 1800 });
  });
}
