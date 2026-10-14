import { $, esc, money } from '../util.js';
import { api } from '../data.js';
import { icon, toast, busy } from '../ui.js';

const EXAMPLES = [
  'Find vintage Nike or Adidas jackets under $40 with public buyer interest like bids, watchers, likes, or offers',
  'Find generic or badly titled work jackets under $40 that might be undervalued',
  'Find men\'s sneakers under $50 with visible buyer activity plus generic listings other people may miss',
  'Find Y2K clothing under $30 with strong public demand signals or vague titles'
];
const POLL_INTERVAL_MS = 1250;
const HUNT_DEADLINE_MS = 75_000;

const hunt = { result: null, prompt: '', runVersion: 0 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function injectHuntUi() {
  if ($('#huntForm')) return;
  const view = $('#view-finder');
  const setup = $('#finderSetup');
  const wrapper = document.createElement('div');
  wrapper.id = 'huntWorkspace';
  wrapper.innerHTML = `
    <form class="panel finder-form" id="huntForm" autocomplete="off" style="margin-bottom:18px">
      <div class="panel-head">
        <div><p class="eyebrow">AI Hunt · demand + hidden-value mode</p><h3>Tell FlipLab what to find</h3></div>
        <span class="status-chip ok">2-lane search</span>
      </div>
      <label style="display:grid;gap:8px">
        <span class="field-note">Write it normally. Every hunt now checks two lanes: listings with public buyer activity and generic/poorly titled listings that could be undervalued.</span>
        <textarea id="huntPrompt" name="prompt" rows="3" maxlength="1200" required minlength="3" placeholder="Find me work jackets under $40 with watchers, likes, bids, offers, or generic titles people may overlook…" style="width:100%;resize:vertical;min-height:92px"></textarea>
      </label>
      <div class="chips example-chips" id="huntExamples">
        ${EXAMPLES.map((example) => `<button class="chip" type="button" data-hunt-example="${esc(example)}">${esc(example)}</button>`).join('')}
      </div>
      <div class="form-actions split">
        <span class="field-note small">FlipLab searches the supported marketplaces, prioritizes verified public buyer-interest signals when available, and also tries generic wording, misspellings, missing brands/models, and vague titles. Unknown activity stays unknown.</span>
        <button class="btn btn-primary btn-lg" type="submit" id="huntGo">${icon('spark')}<span>Hunt everywhere</span></button>
      </div>
    </form>
    <div class="finder-meta" id="huntMeta" hidden></div>
    <div id="huntResults"></div>
    <div class="panel guardrail" style="margin:18px 0">
      ${icon('info')}<div><strong>What “buyer activity” means</strong><p>FlipLab only counts activity the public listing/search evidence actually exposes: offers already made, bids, watchers, likes, or people with the item in a cart/bag. A <b>Make Offer</b> button by itself does not count. Engagement can strengthen demand confidence, but it does not guarantee a future sale.</p></div>
    </div>`;
  view.insertBefore(wrapper, setup);

  if (setup) {
    setup.querySelector('h3').textContent = 'Optional: connect eBay for the advanced eBay-only finder';
    setup.querySelector('p').textContent = 'AI Hunt above works with only your OpenAI key. Add eBay developer keys only if you want the older eBay API filters, market median, and bulk eBay analysis below.';
  }
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
      ${preview ? `<p class="photo-note">${icon('info')}<span>Original listing image preview · reference only unless you own the rights or have permission to reuse it.</span></p>` : '<p class="field-note small">No source image was exposed in the page metadata. Scrape + analyze may still find listing photos.</p>'}
      <p class="field-note small"><b>${esc(item.middleman?.label || 'Check seller rules')}:</b> ${esc(item.middleman?.note || 'Verify the selling channel and supplier agreement before using a zero-inventory workflow.')}</p>
      <div class="deal-actions" style="margin-top:auto;padding-top:14px">
        <button class="btn btn-primary btn-sm" type="button" data-hunt-action="analyze">${icon('spark')}<span>Scrape + analyze</span></button>
        <a class="btn btn-ghost btn-sm" href="${esc(item.url)}" target="_blank" rel="noopener">${icon('external')}<span>Open listing</span></a>
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
  meta.innerHTML = `<div><b>${r.items.length}</b> matches · <b>${active}</b> with public buyer activity · <b>${generic}</b> generic gems · <b>${pictured}</b> with images <span class="muted">(${esc(r.model)})</span></div>`;

  if (!r.items.length) {
    results.innerHTML = `<div class="empty finder-empty">${icon('search')}<strong>No strong direct listings found</strong>Try a broader budget, fewer brand restrictions, or a more common item.</div>`;
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
    meta.innerHTML = `<div><span class="pulse"></span> Searching buyer activity + generic gems + listing images… <span class="muted">${seconds}s</span></div>`;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('AI Hunt is taking longer than expected. Try a more specific prompt.');
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
    toast(hunt.result.items.length ? `Found ${hunt.result.items.length} listing matches` : 'No strong matches found', { type: hunt.result.items.length ? 'success' : 'info' });
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
  const scannerLauncher = document.querySelector('.nav-item[data-view="scanner"]');
  if (scannerLauncher) scannerLauncher.click();
  else location.hash = '#/scanner';
  toast('Opening the listing in AI Scanner…', { type: 'info', duration: 1800 });
  setTimeout(() => $('#analyzeBtn')?.click(), 120);
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
    const button = event.target.closest('[data-hunt-action="analyze"]');
    const card = event.target.closest('[data-hunt-index]');
    if (!button || !card || !hunt.result) return;
    const item = hunt.result.items[Number(card.dataset.huntIndex)];
    if (item) sendToScanner(item);
  });
}
