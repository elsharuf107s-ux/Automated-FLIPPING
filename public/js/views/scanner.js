import { $, esc, compressImage, compsUrl, itemQuery, copyText, listingText } from '../util.js';
import { calc, num } from '../econ.js';
import { state, api, createItem } from '../data.js';
import { icon, toast, busy } from '../ui.js';
import { scanEconHtml, aiReportHtml, depopHtml, depopText } from '../report.js';

const DRAFT_KEY = 'fliplab-scan-draft';
const MONEY_FIELDS = ['purchasePrice', 'inboundShipping', 'repairCost', 'targetPrice', 'outboundShipping'];
const LOADING_STEPS = ['Opening the source page…', 'Checking buyer activity…', 'Extracting product details…', 'Reading the photo…', 'Weighing brand and condition…', 'Estimating the resale range…', 'Running the unit economics…', 'Drafting listing copy…'];

const scan = { image: '', analysis: null, savedId: null, loadingTimer: null };
const form = () => $('#scanForm');

function readForm() {
  const raw = Object.fromEntries(new FormData(form()).entries());
  for (const key of MONEY_FIELDS) raw[key] = num(raw[key]);
  raw.marketplaceFeePercent = num(state.settings.marketplaceFeePercent);
  raw.paymentFeePercent = num(state.settings.paymentFeePercent);
  raw.image = scan.image;
  return raw;
}

function saveDraft() {
  try {
    const { image, marketplaceFeePercent, paymentFeePercent, ...fields } = readForm();
    localStorage.setItem(DRAFT_KEY, JSON.stringify(fields));
  } catch {}
}

function restoreDraft() {
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch {}
  if (!draft) return;
  for (const [key, value] of Object.entries(draft)) {
    const field = form().elements[key];
    if (field && value !== 0 && value !== '') field.value = value;
  }
}

export function renderScanEcon() {
  const item = readForm();
  $('#scanEcon').innerHTML = scanEconHtml(calc(item, state.settings), state.settings);
}

function setImage(dataUrl) {
  scan.image = dataUrl;
  $('#imagePreview').src = dataUrl || '';
  $('#dropzone').classList.toggle('has-image', Boolean(dataUrl));
  if (!dataUrl) $('#imageInput').value = '';
}

async function takeFile(file) {
  if (!file) return;
  try {
    setImage(await compressImage(file));
    toast('Photo added', { type: 'success', duration: 1500 });
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

function interestText(value = {}) {
  return [
    ['offers', 'offer'],
    ['bids', 'bid'],
    ['watchers', 'watcher'],
    ['likes', 'like'],
    ['carts', 'cart/bag']
  ].flatMap(([key, label]) => {
    const amount = Number(value[key]);
    return Number.isFinite(amount) && amount > 0 ? [`${amount} ${label}${amount === 1 ? '' : 's'}`] : [];
  }).join(' · ');
}

function scrapedSignalHtml(ai) {
  const p = ai?.webScrape?.product;
  if (!p) return '';
  const interest = p.buyerInterest || {};
  const text = interestText(interest);
  const evidence = Array.isArray(interest.evidence) ? interest.evidence.filter(Boolean).slice(0, 4) : [];
  const generic = p.genericOpportunity || {};
  const strength = interest.strength || 'unknown';
  const cls = strength === 'hot' ? 'buy' : strength === 'warm' ? 'watch' : '';
  return `<div class="copy-box" style="margin-top:16px">
    <h4>${icon('trend')} Buyer activity + listing opportunity</h4>
    <div class="chips" style="margin:8px 0 10px">
      ${text ? `<span class="badge ${cls}">${esc(text)}</span>` : '<span class="badge">No public activity count exposed</span>'}
      ${Number.isFinite(Number(interest.score)) && interest.score > 0 ? `<span class="badge">Demand signal ${esc(interest.score)}/100</span>` : ''}
      ${generic.isGeneric ? `<span class="badge watch">${icon('search')} Generic gem</span>` : ''}
    </div>
    ${evidence.length ? `<p><b>Evidence:</b> ${esc(evidence.join(' · '))}</p>` : '<p class="muted">The page did not expose a verified offer/bid/watcher/like/cart count. FlipLab does not treat a Make Offer button as proof that offers already exist.</p>'}
    ${generic.isGeneric && generic.reason ? `<p style="margin-top:8px"><b>Generic angle:</b> ${esc(generic.reason)}</p>` : ''}
  </div>`;
}

function applyScrapedProduct(webScrape) {
  const p = webScrape?.product;
  if (!p) return false;
  const f = form();
  const fill = (name, value) => {
    const field = f.elements[name];
    if (field && !field.value && value !== undefined && value !== null && String(value).trim()) field.value = value;
  };
  fill('title', p.title);
  fill('brand', p.brand);
  fill('category', p.category);
  fill('size', p.size);
  if (!num(f.elements.purchasePrice.value) && Number(p.price) > 0) f.elements.purchasePrice.value = p.price;
  if (!f.elements.notes.value) {
    const activity = interestText(p.buyerInterest || {});
    f.elements.notes.value = [
      p.description,
      activity ? `Public buyer activity: ${activity}` : '',
      p.genericOpportunity?.isGeneric ? `Generic opportunity: ${p.genericOpportunity.reason || 'Under-described listing'}` : ''
    ].filter(Boolean).join('\n');
  }
  if (!scan.image && Array.isArray(p.images) && p.images[0]) setImage(p.images[0]);
  renderScanEcon();
  saveDraft();
  return true;
}

function placeholderHtml() {
  return `<div class="result-empty">
    <div class="spark">${icon('spark')}</div>
    <h3>Your flip report appears here</h3>
    <p>Add a photo, item details, or paste a product/listing URL. FlipLab can scrape the URL with your OpenAI key before scoring it.</p>
    <ul class="result-features">
      <li>${icon('check')}Verified public bids, watchers, likes, carts and offer counts when exposed</li>
      <li>${icon('check')}Generic/under-described listing detection</li>
      <li>${icon('check')}Estimated resale range and max buy price</li>
      <li>${icon('check')}Flip score with demand and risk</li>
      <li>${icon('check')}Full Depop form pack and listing copy</li>
    </ul>
  </div>`;
}

function loadingHtml() {
  return `<div class="loading-msg"><span class="pulse"></span><span id="loadingStep">${LOADING_STEPS[0]}</span></div>
    <div class="skeleton">
      <div style="display:flex;gap:16px;align-items:center"><div class="skel" style="width:96px;height:96px;border-radius:50%"></div><div style="flex:1;display:grid;gap:10px"><div class="skel" style="height:14px;width:40%"></div><div class="skel" style="height:24px;width:70%"></div><div class="skel" style="height:12px;width:55%"></div></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div class="skel" style="height:58px"></div><div class="skel" style="height:58px"></div><div class="skel" style="height:58px"></div><div class="skel" style="height:58px"></div></div>
      <div class="skel" style="height:80px"></div><div class="skel" style="height:60px"></div><div class="skel" style="height:110px"></div>
    </div>`;
}

function startLoading() {
  $('#resultPanel').innerHTML = loadingHtml();
  let step = 0;
  scan.loadingTimer = setInterval(() => {
    step = (step + 1) % LOADING_STEPS.length;
    const el = $('#loadingStep');
    if (el) el.textContent = LOADING_STEPS[step];
  }, 1600);
}

function stopLoading() {
  clearInterval(scan.loadingTimer);
}

function renderResult() {
  const ai = scan.analysis;
  const item = readForm();
  const c = calc(item, state.settings);
  const saveBtn = scan.savedId
    ? `<a class="btn btn-ghost" href="#/inventory/${esc(scan.savedId)}">${icon('check')}<span>Saved — open</span></a>`
    : `<button class="btn btn-primary" type="button" id="saveItem">${icon('plus')}<span>Save to inventory</span></button>`;
  $('#resultPanel').innerHTML = `${aiReportHtml(ai, c, 'scan')}
    ${scrapedSignalHtml(ai)}
    ${depopHtml(ai.depop, 'scan')}
    <div class="result-actions">
      <a class="btn btn-ghost" href="${esc(compsUrl('ebay', itemQuery(item) || ai.suggestedTitle))}" target="_blank" rel="noopener" title="Open eBay sold listings">${icon('external')}<span>Comps</span></a>
      <button class="btn btn-ghost" type="button" id="copyListing">${icon('copy')}<span>Copy listing</span></button>
      ${saveBtn}
    </div>`;
}

async function analyze(event) {
  event?.preventDefault();
  const f = form();
  if (!f.reportValidity()) return;
  const item = readForm();
  if (!item.title && !item.brand && !item.category && !item.image && !item.sourceUrl) {
    toast('Add a title, brand, category, photo, or Source URL first.', { type: 'error' });
    f.elements.sourceUrl?.focus();
    return;
  }
  const btn = $('#analyzeBtn');
  busy(btn, true);
  startLoading();
  if (matchMedia('(max-width: 1180px)').matches) $('#resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const analysis = await api('/api/analyze', { body: item });
    const scraped = applyScrapedProduct(analysis.webScrape);
    scan.analysis = analysis;
    scan.savedId = null;
    if (!item.targetPrice && analysis.estimatedSaleHigh) {
      f.elements.targetPrice.value = Math.round((num(analysis.estimatedSaleLow) + num(analysis.estimatedSaleHigh)) / 2);
      renderScanEcon();
      saveDraft();
    }
    renderResult();
    const label = { openai: 'AI report ready', ollama: 'Local AI report ready' }[analysis.mode] || 'Demo report ready';
    toast(analysis.warning ? 'AI unavailable — showing demo scoring' : scraped ? 'Page + buyer activity checked' : label, { type: analysis.warning ? 'info' : 'success' });
  } catch (error) {
    $('#resultPanel').innerHTML = `<div class="result-empty"><div class="spark">${icon('alert')}</div><h3>Analysis failed</h3><p>${esc(error.message)}</p></div>`;
    toast(error.message, { type: 'error' });
  } finally {
    stopLoading();
    busy(btn, false);
  }
}

async function save(btn) {
  if (!scan.analysis) return;
  busy(btn, true);
  try {
    const payload = { ...readForm(), ai: scan.analysis, status: scan.analysis.decision === 'PASS' ? 'passed' : 'watching' };
    const item = await createItem(payload);
    scan.savedId = item.id;
    renderResult();
    toast('Saved to inventory', { type: 'success', action: { label: 'Scan another', onClick: () => reset() } });
  } catch (error) {
    toast(error.message, { type: 'error' });
    busy(btn, false);
  }
}

function reset() {
  form().reset();
  setImage('');
  scan.analysis = null;
  scan.savedId = null;
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
  form().elements.outboundShipping.value = state.settings.defaultOutboundShipping || '';
  $('#resultPanel').innerHTML = placeholderHtml();
  renderScanEcon();
  form().elements.title.focus();
}

export function initScanner() {
  const f = form();
  restoreDraft();
  $('#resultPanel').innerHTML = placeholderHtml();

  f.addEventListener('submit', analyze);
  f.addEventListener('input', () => { renderScanEcon(); saveDraft(); });
  f.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) analyze(event);
  });
  $('#scanReset').addEventListener('click', reset);

  const drop = $('#dropzone');
  drop.addEventListener('click', (event) => {
    if (event.target.closest('#imageRemove')) return;
    $('#imageInput').click();
  });
  drop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      $('#imageInput').click();
    }
  });
  $('#imageInput').addEventListener('change', (event) => takeFile(event.target.files?.[0]));
  $('#imageRemove').addEventListener('click', () => setImage(''));
  ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, () => drop.classList.remove('drag')));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    takeFile([...event.dataTransfer.files].find((file) => file.type.startsWith('image/'));
  });
  document.addEventListener('paste', (event) => {
    if (!$('#view-scanner').classList.contains('active')) return;
    const file = [...(event.clipboardData?.files || [])].find((entry) => entry.type.startsWith('image/'));
    if (file) {
      event.preventDefault();
      takeFile(file);
    }
  });

  $('#resultPanel').addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.id === 'saveItem') save(target);
    if (target.id === 'copyListing' && scan.analysis) {
      const text = scan.analysis.depop ? depopText(scan.analysis.depop) : listingText(scan.analysis);
      if (await copyText(text)) toast('Listing copied', { type: 'success' });
    }
  });
}

export function applyScannerDefaults() {
  const ship = form().elements.outboundShipping;
  if (!ship.value && num(state.settings.defaultOutboundShipping)) ship.value = state.settings.defaultOutboundShipping;
  renderScanEcon();
}
