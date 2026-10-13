import { esc, money, signedMoney, pct } from './util.js';
import { calc } from './econ.js';
import { icon, decisionBadge, scoreRing, copyButton } from './ui.js';

const cell = (label, value, cls = '') => `<div class="econ-cell"><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
const profitClass = (value) => (value > 0 ? 'pos' : value < 0 ? 'neg' : '');

export function scanEconHtml(c, settings) {
  const ready = c.target > 0;
  return [
    cell('Landed cost', money(c.landed)),
    cell('Fees', ready ? money(c.fees) : '—'),
    cell('Profit', ready ? signedMoney(c.profit) : '—', ready ? profitClass(c.profit) : ''),
    cell('ROI', ready ? pct(c.roi) : '—', ready ? profitClass(c.profit) : ''),
    cell('Break-even', c.breakEven ? money(c.breakEven) : '—'),
    cell(`Max buy · ${Math.round(Number(settings.targetRoiPercent) || 0)}% ROI`, c.maxBuy != null ? money(c.maxBuy) : '—')
  ].join('');
}

export function itemEconHtml(c) {
  return [
    cell('Landed cost', money(c.landed)),
    cell(c.sold ? 'Sold for' : 'Target price', c.hasPrice ? money(c.salePrice) : '—'),
    cell(c.sold ? 'Realized profit' : 'Projected profit', c.hasPrice ? signedMoney(c.profit) : '—', c.hasPrice ? profitClass(c.profit) : ''),
    c.sold && c.daysToSell != null
      ? cell('Days to sell', String(c.daysToSell))
      : cell('ROI', c.hasPrice ? pct(c.roi) : '—', c.hasPrice ? profitClass(c.profit) : '')
  ].join('');
}

const MODE_LABEL = {
  openai: 'OpenAI',
  ollama: 'Ollama',
  demo: 'Demo scorer',
  'demo-fallback': 'Demo fallback'
};

export function aiReportHtml(ai, c, prefix) {
  const keywords = Array.isArray(ai.keywords) ? ai.keywords : [];
  const checks = Array.isArray(ai.checks) ? ai.checks : [];
  const source = [MODE_LABEL[ai.mode] || ai.mode, ai.model].filter(Boolean).join(' · ');
  return `
    <div class="score-head">
      ${scoreRing(ai.score, { decision: ai.decision })}
      <div class="decision">
        ${decisionBadge(ai.decision)}
        <h3>${esc({ BUY: 'Worth buying', WATCH: 'Keep watching', PASS: 'Pass on this one' }[ai.decision] || 'Review')}</h3>
        <div class="meta"><span class="badge">${esc(ai.demand || '?')} demand</span><span class="badge">${esc(ai.risk || '?')} risk</span></div>
        <p>${esc(source)} · ${Math.round((Number(ai.confidence) || 0) * 100)}% confidence</p>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat"><span>Est. sale range</span><strong>${money(ai.estimatedSaleLow)} – ${money(ai.estimatedSaleHigh)}</strong></div>
      <div class="stat"><span>AI max buy</span><strong>${money(ai.maxBuyPrice)}</strong></div>
      <div class="stat"><span>Profit at target</span><strong class="${profitClass(c.profit)}">${c.hasPrice ? signedMoney(c.profit) : '—'}</strong></div>
      <div class="stat"><span>ROI</span><strong class="${profitClass(c.profit)}">${c.hasPrice ? pct(c.roi) : '—'}</strong></div>
    </div>
    ${ai.warning ? `<div class="copy-box warn"><h4>${icon('alert')} AI fallback used</h4><p>${esc(ai.warning)} Showing local demo scoring instead.</p></div>` : ''}
    ${ai.rationale ? `<div class="copy-box"><h4>Why</h4><p>${esc(ai.rationale)}</p></div>` : ''}
    ${ai.depop ? '' : `<div class="copy-box"><h4>Listing title ${copyButton(`${prefix}Title`)}</h4><p id="${prefix}Title">${esc(ai.suggestedTitle || '')}</p></div>
    <div class="copy-box"><h4>Description ${copyButton(`${prefix}Description`)}</h4><p id="${prefix}Description">${esc(ai.suggestedDescription || '')}</p>
      ${keywords.length ? `<div class="tags">${keywords.map((k) => `<span class="tag">${esc(k)}</span>`).join('')}</div>` : ''}
    </div>`}
    ${checks.length ? `<div class="copy-box"><h4>Verify before buying or listing</h4><ul class="checks">${checks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}`;
}

export function depopText(depop) {
  const tags = (depop.hashtags || []).map((tag) => `#${tag}`).join(' ');
  return [depop.description, tags].filter(Boolean).join('\n\n');
}

// Everything to type into Depop's listing form, in the order the form asks for it.
export function depopHtml(depop, prefix) {
  if (!depop) return '';
  const row = (label, value, copyId) => (value
    ? `<div class="dp-row"><span>${label}</span><strong${copyId ? ` id="${prefix}${copyId}"` : ''}>${esc(value)}</strong>${copyId ? copyButton(`${prefix}${copyId}`) : ''}</div>`
    : '');
  const tags = (depop.hashtags || []).map((tag) => `#${tag}`).join(' ');
  return `<section class="depop-pack">
    <div class="depop-head">
      <div><p class="eyebrow">Depop listing</p><h3>Ready to paste</h3></div>
      <button class="btn btn-primary btn-sm" type="button" data-copy="${prefix}DepopAll">${icon('copy')}<span>Copy description + tags</span></button>
    </div>
    <pre id="${prefix}DepopAll" hidden>${esc(depopText(depop))}</pre>
    <div class="copy-box"><h4>Description ${copyButton(`${prefix}DepopDesc`)}</h4><p id="${prefix}DepopDesc">${esc(depop.description)}</p></div>
    <div class="dp-list">
      ${row('Price (USD)', depop.listPrice ? String(depop.listPrice) : '', 'DepopPrice')}
      ${row('Accept offers from', depop.minOfferPrice ? money(depop.minOfferPrice) : '')}
      ${row('Category', depop.category)}
      ${row('Brand', depop.brand, 'DepopBrand')}
      ${row('Size', depop.size)}
      ${row('Condition', depop.condition)}
      ${row('Colour', (depop.colors || []).join(', '))}
      ${row('Style', (depop.styleTags || []).join(', '))}
      ${row('Material', depop.material)}
      ${row('Hashtags', tags, 'DepopTags')}
    </div>
    ${(depop.measurements || []).length || (depop.photoTips || []).length ? `<div class="dp-tips">
      ${(depop.measurements || []).length ? `<div><h4>Measure</h4><ul>${depop.measurements.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
      ${(depop.photoTips || []).length ? `<div><h4>Photos to take</h4><ul>${depop.photoTips.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
    </div>` : ''}
  </section>`;
}

// Buy → list → profit summary for a sourced listing.
export function pricingHtml(item, depop, settings) {
  if (!depop?.listPrice) return '';
  const atList = calc({ ...item, targetPrice: depop.listPrice }, settings);
  const atOffer = calc({ ...item, targetPrice: depop.minOfferPrice || depop.listPrice }, settings);
  const buy = (Number(item.purchasePrice) || 0) + (Number(item.inboundShipping) || 0);
  const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  return `<div class="pricing">
    <div><span>Buy on eBay for</span><strong>${money(buy)}</strong><small>${money(item.purchasePrice)} + ${money(item.inboundShipping)} shipping</small></div>
    <div><span>List on Depop at</span><strong>${money(depop.listPrice)}</strong><small>accept offers from ${money(depop.minOfferPrice)}</small></div>
    <div><span>Your profit</span><strong class="${cls(atList.profit)}">${signedMoney(atList.profit)}</strong><small>${signedMoney(atOffer.profit)} at lowest offer · after fees + shipping</small></div>
  </div>`;
}
