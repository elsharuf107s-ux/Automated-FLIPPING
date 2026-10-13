import { esc, money, signedMoney, pct } from './util.js';
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
    <div class="copy-box"><h4>Listing title ${copyButton(`${prefix}Title`)}</h4><p id="${prefix}Title">${esc(ai.suggestedTitle || '')}</p></div>
    <div class="copy-box"><h4>Description ${copyButton(`${prefix}Description`)}</h4><p id="${prefix}Description">${esc(ai.suggestedDescription || '')}</p>
      ${keywords.length ? `<div class="tags">${keywords.map((k) => `<span class="tag">${esc(k)}</span>`).join('')}</div>` : ''}
    </div>
    ${checks.length ? `<div class="copy-box"><h4>Verify before buying or listing</h4><ul class="checks">${checks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}`;
}
