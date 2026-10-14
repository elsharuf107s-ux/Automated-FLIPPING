import { $, esc, compressImage, copyText, listingText } from '../util.js';
import { calc, num } from '../econ.js';
import { state, api } from '../data.js';
import { icon, toast, busy } from '../ui.js';
import { scanEconHtml, aiReportHtml, depopHtml, depopText } from '../report.js';

const DRAFT_KEY = 'fliplab-scan-draft';
const MONEY_FIELDS = ['purchasePrice', 'inboundShipping', 'repairCost', 'targetPrice', 'outboundShipping'];
const LOADING_STEPS = [
  'Opening the source page…',
  'Checking buyer activity…',
  'Extracting clothing details…',
  'Reading the photo…',
  'Estimating price and margin…',
  'Building the Depop form pack…'
];

const scan = { image: '', analysis: null, loadingTimer: null };
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
  $('#scanEcon').innerHTML = scanEconHtml(calc(readForm(), state.settings), state.settings);
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
    <h4>${icon('trend')} Buyer activity</h4>
    <div class="chips" style="margin:8px 0 10px">
      ${text ? `<span class="badge ${cls}">${esc(text)}</span>` : '<span class="badge">No public activity count exposed</span>'}
      ${generic.isGeneric ? `<span class="badge watch">${icon('search')} Generic gem</span>` : ''}
    </div>
    ${evidence.length ? `<p><b>Evidence:</b> ${esc(evidence.join(' · '))}</p>` : ''}
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
    <h3>Your ready-to-post Depop pack appears here</h3>
    <p>Choose a supplier match from Hunt and FlipLab fills this automatically. You can also paste a clothing URL or add a photo manually.</p>
    <ul class="result-features">
      <li>${icon('check')}Full Depop form fields</li>
      <li>${icon('check')}Listing description + search tags</li>
      <li>${icon('check')}Price targets + margin math</li>
      <li>${icon('check')}Buyer-demand evidence when public</li>
      <li>${icon('check')}One copy button for the finished listing</li>
    </ul>
  </div>`;
}

function loadingHtml() {
  return `<div class="loading-msg"><span class="pulse"></span><span id="loadingStep">${LOADING_STEPS[0]}</span></div>
    <div class="skeleton">
      <div class="skel" style="height:72px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div class="skel" style="height:58px"></div><div class="skel" style="height:58px"></div></div>
      <div class="skel" style="height:100px"></div><div class="skel" style="height:160px"></div>
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
  const c = calc(readForm(), state.settings);
  $('#resultPanel').innerHTML = `${aiReportHtml(ai, c, 'scan')}
    ${scrapedSignalHtml(ai)}
    ${depopHtml(ai.depop, 'scan')}
    <div class="result-actions">
      <button class="btn btn-primary" type="button" id="copyListing">${icon('copy')}<span>Copy Depop listing</span></button>
      <button class="btn btn-ghost" type="button" id="nextItem">${icon('refresh')}<span>Next item</span></button>
    </div>`;
}

async function analyze(event) {
  event?.preventDefault();
  const f = form();
  if (!f.reportValidity()) return;
  const item = readForm();
  if (!item.title && !item.brand && !item.category && !item.image && !item.sourceUrl) {
    toast('Choose an item from Hunt or add clothing details first.', { type: 'error' });
    return;
  }
  const btn = $('#analyzeBtn');
  busy(btn, true);
  startLoading();
  try {
    const analysis = await api('/api/analyze', { body: item });
    const scraped = applyScrapedProduct(analysis.webScrape);
    scan.analysis = analysis;
    if (!item.targetPrice && analysis.estimatedSaleHigh) {
      f.elements.targetPrice.value = Math.round((num(analysis.estimatedSaleLow) + num(analysis.estimatedSaleHigh)) / 2);
      renderScanEcon();
      saveDraft();
    }
    renderResult();
    toast(analysis.warning ? 'AI fallback used — review before posting' : scraped ? 'Source checked + Depop pack ready' : 'Depop pack ready', {
      type: analysis.warning ? 'info' : 'success'
    });
  } catch (error) {
    $('#resultPanel').innerHTML = `<div class="result-empty"><div class="spark">${icon('alert')}</div><h3>Could not build the pack</h3><p>${esc(error.message)}</p></div>`;
    toast(error.message, { type: 'error' });
  } finally {
    stopLoading();
    busy(btn, false);
  }
}

function reset() {
  form().reset();
  setImage('');
  scan.analysis = null;
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
  form().elements.outboundShipping.value = state.settings.defaultOutboundShipping || '';
  $('#resultPanel').innerHTML = placeholderHtml();
  renderScanEcon();
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
    takeFile([...event.dataTransfer.files].find((file) => file.type.startsWith('image/')));
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
    if (target.id === 'nextItem') reset();
    if (target.id === 'copyListing' && scan.analysis) {
      const text = scan.analysis.depop ? depopText(scan.analysis.depop) : listingText(scan.analysis);
      if (await copyText(text)) toast('Depop listing copied', { type: 'success' });
    }
  });
}

export function applyScannerDefaults() {
  const ship = form().elements.outboundShipping;
  if (!ship.value && num(state.settings.defaultOutboundShipping)) ship.value = state.settings.defaultOutboundShipping;
  renderScanEcon();
}
