const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const state = { items: [], settings: {}, image: '', analysis: null, draft: null };

const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(n || 0));
const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;

async function api(url, options = {}) {
  const res = await fetch(url, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).error || message; } catch {}
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function calc(item) {
  const landed = num(item.purchasePrice) + num(item.inboundShipping) + num(item.repairCost);
  const target = num(item.targetPrice);
  const fees = target * ((num(item.marketplaceFeePercent ?? state.settings.marketplaceFeePercent) + num(item.paymentFeePercent ?? state.settings.paymentFeePercent)) / 100);
  const profit = target - landed - num(item.outboundShipping) - fees;
  const roi = landed > 0 ? (profit / landed) * 100 : 0;
  return { landed, target, fees, profit, roi };
}

function formData() {
  const raw = Object.fromEntries(new FormData($('#scanForm')).entries());
  for (const key of ['purchasePrice','inboundShipping','repairCost','targetPrice','outboundShipping']) raw[key] = num(raw[key]);
  raw.marketplaceFeePercent = num(state.settings.marketplaceFeePercent);
  raw.paymentFeePercent = num(state.settings.paymentFeePercent);
  raw.image = state.image;
  return raw;
}

function go(view) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $$('.nav-item').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  $(`#view-${view}`).classList.add('active');
  $('#pageTitle').textContent = ({ dashboard:'Dashboard', scanner:'AI Scanner', inventory:'Inventory', sources:'Sources', settings:'Settings' })[view] || 'FlipLab';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1000;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', .78));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderDashboard() {
  const rows = state.items;
  const capital = rows.filter(x => ['bought','listed'].includes(x.status)).reduce((sum, x) => sum + calc(x).landed, 0);
  const projected = rows.filter(x => ['bought','listed','watching'].includes(x.status)).reduce((sum, x) => sum + Math.max(0, calc(x).profit), 0);
  const scored = rows.filter(x => x.ai?.score != null);
  const avgScore = scored.length ? Math.round(scored.reduce((sum, x) => sum + num(x.ai.score), 0) / scored.length) : null;
  $('#mItems').textContent = rows.length;
  $('#mCapital').textContent = money(capital);
  $('#mProfit').textContent = money(projected);
  $('#mScore').textContent = avgScore ?? '—';
  $('#heroScore').textContent = scored[0]?.ai?.score ?? '—';

  const recent = $('#recentItems');
  if (!rows.length) {
    recent.className = 'empty-state';
    recent.textContent = 'No items yet. Scan one and start your pipeline.';
    return;
  }
  recent.className = 'recent-list';
  recent.innerHTML = rows.slice(0, 5).map(item => {
    const c = calc(item);
    return `<div class="recent-row"><div><b>${esc(item.title || item.brand || 'Untitled item')}</b><span>${esc(item.status)} · ${money(c.landed)} landed</span></div><span>${item.ai?.decision || '—'}</span><strong>${item.ai?.score ?? '—'}</strong></div>`;
  }).join('');
}

function renderInventory() {
  const filter = $('#statusFilter').value;
  const rows = state.items.filter(item => filter === 'all' || item.status === filter);
  const wrap = $('#inventoryTable');
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty-state">Nothing in this view yet.</div>';
    return;
  }
  wrap.innerHTML = `<table class="inventory-table"><thead><tr><th>Item</th><th>Status</th><th>Cost</th><th>Target</th><th>Profit</th><th>ROI</th><th>Score</th><th></th></tr></thead><tbody>${rows.map(item => {
    const c = calc(item);
    const image = item.image ? `<img class="thumb" src="${item.image}" alt="">` : `<div class="thumb blank">✦</div>`;
    return `<tr data-id="${item.id}"><td><div class="item-name">${image}<div><b>${esc(item.title || 'Untitled')}</b><span>${esc([item.brand,item.size].filter(Boolean).join(' · ') || item.source || '')}</span></div></div></td><td><select class="status-select" data-status>${['watching','bought','listed','sold','passed'].map(s => `<option ${item.status===s?'selected':''}>${s}</option>`).join('')}</select></td><td>${money(c.landed)}</td><td>${money(c.target)}</td><td>${money(c.profit)}</td><td>${Math.round(c.roi)}%</td><td><span class="score-chip">${item.ai?.score ?? '—'}</span></td><td class="row-actions"><button data-delete title="Delete">×</button></td></tr>`;
  }).join('')}</tbody></table>`;

  $$('[data-status]', wrap).forEach(select => select.addEventListener('change', async e => {
    const id = e.target.closest('tr').dataset.id;
    await api(`/api/items/${id}`, { method:'PATCH', body: JSON.stringify({ status: e.target.value }) });
    await refreshItems();
    toast('Status updated');
  }));
  $$('[data-delete]', wrap).forEach(btn => btn.addEventListener('click', async e => {
    const id = e.target.closest('tr').dataset.id;
    if (!confirm('Delete this item from FlipLab?')) return;
    await api(`/api/items/${id}`, { method:'DELETE' });
    await refreshItems();
    toast('Item deleted');
  }));
}

function esc(value='') {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function resultHtml(a, item) {
  const c = calc({ ...item, targetPrice: item.targetPrice || ((num(a.estimatedSaleLow)+num(a.estimatedSaleHigh))/2) });
  const checks = Array.isArray(a.checks) ? a.checks : [];
  const keywords = Array.isArray(a.keywords) ? a.keywords : [];
  const warning = a.warning ? `<div class="copy-box"><h4>AI fallback</h4><p>${esc(a.warning)} — showing local demo scoring instead.</p></div>` : '';
  return `<div class="score-row"><div class="score-badge"><strong>${Math.round(num(a.score))}</strong><span>/ 100</span></div><div class="decision"><p>${esc(a.demand || 'unknown')} demand · ${esc(a.risk || 'unknown')} risk</p><h3>${esc(a.decision || 'WATCH')}</h3><p>${esc(a.mode || 'analysis')} · ${Math.round(num(a.confidence)*100)}% confidence</p></div></div>
  <div class="result-stats"><div class="mini-stat"><span>Est. range</span><strong>${money(a.estimatedSaleLow)}–${money(a.estimatedSaleHigh)}</strong></div><div class="mini-stat"><span>Max buy</span><strong>${money(a.maxBuyPrice)}</strong></div><div class="mini-stat"><span>Projected ROI</span><strong>${Math.round(c.roi)}%</strong></div></div>
  <div class="copy-box"><h4>Why</h4><p>${esc(a.rationale || '')}</p></div>
  <div class="copy-box"><h4>Listing title</h4><p id="copyTitle">${esc(a.suggestedTitle || item.title || '')}</p></div>
  <div class="copy-box"><h4>Description</h4><p id="copyDescription">${esc(a.suggestedDescription || '')}</p><div class="tag-row">${keywords.map(k => `<span class="tag">${esc(k)}</span>`).join('')}</div></div>
  <div class="copy-box"><h4>Verify before buying/listing</h4><ul class="checks">${checks.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>${warning}
  <div class="result-actions"><button class="secondary" id="copyListing">Copy listing</button><button class="primary" id="saveItem">Save to inventory</button></div>`;
}

async function handleAnalyze(event) {
  event.preventDefault();
  const item = formData();
  state.draft = item;
  const btn = $('#analyzeBtn');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Analyzing…';
  try {
    const analysis = await api('/api/analyze', { method:'POST', body: JSON.stringify(item) });
    state.analysis = analysis;
    if (!item.targetPrice && analysis.estimatedSaleLow && analysis.estimatedSaleHigh) {
      item.targetPrice = Math.round((num(analysis.estimatedSaleLow) + num(analysis.estimatedSaleHigh)) / 2);
      state.draft.targetPrice = item.targetPrice;
      $('#scanForm [name="targetPrice"]').value = item.targetPrice;
    }
    $('#resultPanel').innerHTML = resultHtml(analysis, state.draft);
    $('#copyListing').addEventListener('click', () => {
      const text = `${analysis.suggestedTitle}\n\n${analysis.suggestedDescription}\n\n${(analysis.keywords || []).map(x => '#'+String(x).replace(/\s+/g,'')).join(' ')}`;
      navigator.clipboard.writeText(text);
      toast('Listing copied');
    });
    $('#saveItem').addEventListener('click', saveCurrentItem);
    toast(analysis.mode === 'openai' ? 'AI report ready' : analysis.mode === 'ollama' ? 'Local AI report ready' : 'Demo report ready');
  } catch (error) {
    toast(error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function saveCurrentItem() {
  if (!state.draft) return;
  const payload = { ...state.draft, ai: state.analysis, status: state.analysis?.decision === 'PASS' ? 'passed' : 'watching' };
  await api('/api/items', { method:'POST', body: JSON.stringify(payload) });
  await refreshItems();
  toast('Saved to inventory');
}

async function refreshItems() {
  state.items = await api('/api/items');
  renderDashboard();
  renderInventory();
}

async function loadSources() {
  const sources = await api('/api/source-guides');
  $('#sourceGrid').innerHTML = sources.map(s => `<article class="source-card"><div><h3>${esc(s.name)}</h3><p>${esc(s.note)}</p></div><a href="${s.url}" target="_blank" rel="noopener">Open ↗</a></article>`).join('');
}

async function loadSettings() {
  state.settings = await api('/api/settings');
  const form = $('#settingsForm');
  Object.entries(state.settings).forEach(([key,val]) => { if (form.elements[key]) form.elements[key].value = val; });
}

function bind() {
  $$('.nav-item').forEach(btn => btn.addEventListener('click', () => go(btn.dataset.view)));
  $$('[data-go]').forEach(btn => btn.addEventListener('click', () => go(btn.dataset.go)));
  $('#scanForm').addEventListener('submit', handleAnalyze);
  $('#statusFilter').addEventListener('change', renderInventory);
  $('#settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    Object.keys(data).forEach(k => data[k] = num(data[k]));
    state.settings = await api('/api/settings', { method:'PATCH', body: JSON.stringify(data) });
    toast('Settings saved');
  });
  $('#dropzone').addEventListener('click', () => $('#imageInput').click());
  $('#imageInput').addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    state.image = await compressImage(file);
    $('#imagePreview').src = state.image;
    $('#dropzone').classList.add('has-image');
  });
  ['dragenter','dragover'].forEach(type => $('#dropzone').addEventListener(type, e => { e.preventDefault(); }));
  $('#dropzone').addEventListener('drop', async e => {
    e.preventDefault();
    const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
    if (!file) return;
    state.image = await compressImage(file);
    $('#imagePreview').src = state.image;
    $('#dropzone').classList.add('has-image');
  });
}

async function init() {
  bind();
  try {
    const health = await api('/api/health');
    $('#healthDot').classList.add('online');
    $('#healthText').textContent = health.aiConfigured ? `Online · ${health.aiProvider} AI` : 'Online · demo AI';
    await Promise.all([loadSettings(), loadSources(), refreshItems()]);
    const ship = $('#scanForm [name="outboundShipping"]');
    if (!num(ship.value)) ship.value = state.settings.defaultOutboundShipping || 0;
  } catch (error) {
    $('#healthText').textContent = 'Connection issue';
    toast(error.message);
  }
}

init();
