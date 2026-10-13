import { $, esc, money, moneyShort, signedMoney, timeAgo } from '../util.js';
import { calc } from '../econ.js';
import { state } from '../data.js';
import { icon, decisionBadge, decisionColor, thumb, statusDot } from '../ui.js';

const STATUSES = ['watching', 'bought', 'listed', 'sold', 'passed'];

function kpi(iconName, label, value, sub) {
  return `<article class="kpi"><span class="kpi-label">${icon(iconName)}${label}</span><strong class="kpi-value">${value}</strong><span class="kpi-sub">${sub}</span></article>`;
}

function orbitRing(score, decision) {
  const size = 210;
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, Number(score) || 0)) / 100);
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" aria-hidden="true" style="transform:rotate(-90deg)">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line-strong)" stroke-width="2"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${decisionColor(decision)}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"/>
  </svg>`;
}

function heroHtml(items) {
  const latest = items.find((item) => item.ai?.score != null);
  if (!latest) {
    return `<a class="orbit" href="#/scanner">${orbitRing(0)}
      <div class="orbit-inner"><span>Flip score</span><strong>—</strong><small>scan your first item</small></div></a>`;
  }
  return `<a class="orbit" href="#/inventory/${esc(latest.id)}" title="Open ${esc(latest.title || 'item')}">
      ${orbitRing(latest.ai.score, latest.ai.decision)}
      <div class="orbit-inner"><span>Latest score · ${esc(latest.ai.decision || '')}</span><strong>${Math.round(latest.ai.score)}</strong><small>${esc(latest.title || latest.brand || 'Untitled item')}</small></div>
    </a>`;
}

// Realized profit per month for the last six months (by sold date).
function monthlyProfit(items) {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: 'short' }), full: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), value: 0, count: 0 });
  }
  for (const item of items) {
    if (item.status !== 'sold') continue;
    const d = new Date(item.soldAt || item.updatedAt);
    const month = months.find((m) => m.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (!month) continue;
    month.value += calc(item, state.settings).profit;
    month.count += 1;
  }
  return months;
}

function niceMax(value) {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  return steps.map((s) => s * magnitude).find((s) => s >= value) || 10 * magnitude;
}

function profitChart(months) {
  const W = 560; const H = 220; const left = 44; const right = 8; const top = 18; const bottom = 26;
  const maxPos = Math.max(0, ...months.map((m) => m.value));
  const maxNeg = Math.max(0, ...months.map((m) => -m.value));
  const scaleMax = niceMax(Math.max(maxPos, 10));
  const negMax = maxNeg > 0 ? niceMax(maxNeg) : 0;
  const plotH = H - top - bottom;
  const total = scaleMax + negMax;
  const y = (v) => top + ((scaleMax - v) / total) * plotH;
  const band = (W - left - right) / months.length;
  const barW = Math.min(24, band * 0.5);
  const ticks = [0, scaleMax / 2, scaleMax];
  if (negMax) ticks.push(-negMax);
  const best = months.reduce((a, b) => (b.value > a.value ? b : a), months[0]);
  const bars = months.map((m, i) => {
    const cx = left + band * i + band / 2;
    const y0 = y(0);
    const y1 = y(m.value);
    const h = Math.abs(y1 - y0);
    const r = Math.min(4, h);
    const x = cx - barW / 2;
    let path = '';
    if (h > 0.5) {
      path = m.value >= 0
        ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${y0} Z`
        : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 - r} V${y0} Z`;
    }
    const label = m === best && m.value > 0
      ? `<text class="bar-label" x="${cx}" y="${y1 - 7}" text-anchor="middle">${esc(moneyShort(m.value))}</text>` : '';
    return `<g class="col" data-i="${i}">
      <rect class="hit" x="${left + band * i}" y="${top}" width="${band}" height="${plotH}"/>
      ${path ? `<path class="bar${m.value < 0 ? ' neg' : ''}" d="${path}"/>` : ''}
      ${label}
      <text class="tick" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(m.label)}</text>
    </g>`;
  }).join('');
  const grid = ticks.map((t) => `<line class="${t === 0 ? 'baseline' : 'grid-line'}" x1="${left}" x2="${W - right}" y1="${y(t)}" y2="${y(t)}"/>
    <text class="tick" x="${left - 8}" y="${y(t) + 3}" text-anchor="end">${esc(moneyShort(t))}</text>`).join('');
  return `<div class="chart" id="profitChart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Realized profit by month">${grid}${bars}</svg>
    <div class="chart-tip" id="profitTip"></div>
  </div>
  <table class="sr-only"><caption>Realized profit by month</caption>${months.map((m) => `<tr><th>${esc(m.full)}</th><td>${money(m.value)}</td></tr>`).join('')}</table>`;
}

function bindChart(months) {
  const chart = $('#profitChart');
  if (!chart) return;
  const tip = $('#profitTip');
  chart.addEventListener('pointermove', (event) => {
    const col = event.target.closest('.col');
    if (!col) { tip.classList.remove('show'); return; }
    const m = months[Number(col.dataset.i)];
    const box = chart.getBoundingClientRect();
    const hit = col.querySelector('.hit').getBoundingClientRect();
    tip.innerHTML = `<b>${esc(signedMoney(m.value))}</b><span>${esc(m.full)} · ${m.count} sold</span>`;
    tip.style.left = `${hit.left - box.left + hit.width / 2}px`;
    tip.style.top = `${Math.max(30, event.clientY - box.top)}px`;
    tip.classList.add('show');
  });
  chart.addEventListener('pointerleave', () => tip.classList.remove('show'));
}

function pipelineHtml(items) {
  const groups = STATUSES.map((status) => {
    const rows = items.filter((item) => item.status === status);
    return { status, count: rows.length, value: rows.reduce((sum, item) => sum + calc(item, state.settings).landed, 0) };
  });
  const bar = groups.filter((g) => g.count).map((g) => `<span data-status="${g.status}" style="flex-grow:${g.count}" title="${g.status}: ${g.count}"></span>`).join('');
  return `<div class="pipeline-bar" role="img" aria-label="Items by status">${bar}</div>
    <ul class="legend">${groups.map((g) => `<li>${statusDot(g.status)}<span class="count">${g.count}</span><span class="value">${money(g.value)}</span></li>`).join('')}</ul>`;
}

function rowHtml(item, sideHtml) {
  const meta = [item.brand, item.size, item.status].filter(Boolean).join(' · ');
  return `<button class="item-row" type="button" data-open="${esc(item.id)}">
    ${thumb(item)}
    <span class="item-main"><b>${esc(item.title || item.brand || 'Untitled item')}</b><span>${esc(meta)} · ${esc(timeAgo(item.updatedAt))}</span></span>
    <span class="item-side">${sideHtml}</span>
  </button>`;
}

function onboardingHtml() {
  return `<article class="panel">
    <div class="panel-head"><div><p class="eyebrow">Playbook</p><h3>How the system works</h3></div><a class="link-btn" href="#/scanner">Start a scan ${icon('chevron')}</a></div>
    <ol class="steps">
      <li><b>Source</b><span>Find underpriced inventory</span></li>
      <li><b>Score</b><span>Analyze margin, demand &amp; risk</span></li>
      <li><b>Verify</b><span>Check condition and real sold comps</span></li>
      <li><b>List</b><span>Use AI-prepared copy, then publish manually</span></li>
      <li><b>Track</b><span>Record status, cost and profit</span></li>
    </ol>
  </article>`;
}

export function renderDashboard() {
  const items = state.items;
  const settings = state.settings;
  const owned = items.filter((item) => item.status === 'bought' || item.status === 'listed');
  const sold = items.filter((item) => item.status === 'sold');
  const capital = owned.reduce((sum, item) => sum + calc(item, settings).landed, 0);
  const projected = owned.reduce((sum, item) => sum + calc(item, settings).profit, 0);
  const realized = sold.reduce((sum, item) => sum + calc(item, settings).profit, 0);
  const scored = items.filter((item) => item.ai?.score != null);
  const avgScore = scored.length ? Math.round(scored.reduce((sum, item) => sum + Number(item.ai.score), 0) / scored.length) : null;
  const days = sold.map((item) => calc(item, settings).daysToSell).filter((d) => d != null);
  const avgDays = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null;
  const buySignals = items.filter((item) => item.status === 'watching' && item.ai?.decision === 'BUY').length;

  $('#heroVisual').innerHTML = heroHtml(items);
  $('#kpis').innerHTML = [
    kpi('box', 'Active inventory', String(owned.length), `${moneyShort(capital)} capital at work`),
    kpi('trend', 'Projected profit', moneyShort(projected), `on ${owned.length} unsold item${owned.length === 1 ? '' : 's'} at target`),
    kpi('wallet', 'Realized profit', moneyShort(realized), sold.length ? `${sold.length} sold${avgDays != null ? ` · ${avgDays}d avg to sell` : ''}` : 'mark items sold to track'),
    kpi('gauge', 'Average flip score', avgScore ?? '—', `${buySignals} BUY signal${buySignals === 1 ? '' : 's'} on watchlist`)
  ].join('');

  if (!items.length) {
    $('#dashBody').innerHTML = onboardingHtml();
    return;
  }

  const months = monthlyProfit(items);
  const hasSales = months.some((m) => m.count);
  const opportunities = items
    .filter((item) => item.status === 'watching' && item.ai?.score != null)
    .sort((a, b) => b.ai.score - a.ai.score)
    .slice(0, 5);

  $('#dashBody').innerHTML = `
    <div class="dash-grid">
      <article class="panel">
        <div class="panel-head"><div><p class="eyebrow">Last 6 months</p><h3>Realized profit</h3></div><span class="muted num">${money(months.reduce((s, m) => s + m.value, 0))}</span></div>
        ${hasSales ? profitChart(months) : `<div class="empty">${icon('wallet')}<strong>No sales yet</strong>Mark an item as sold — with its sale price — to see profit here.</div>`}
      </article>
      <article class="panel">
        <div class="panel-head"><div><p class="eyebrow">Pipeline</p><h3>Items by status</h3></div><a class="link-btn" href="#/inventory">View all ${icon('chevron')}</a></div>
        ${pipelineHtml(items)}
      </article>
    </div>
    <div class="dash-grid">
      <article class="panel">
        <div class="panel-head"><div><p class="eyebrow">Activity</p><h3>Recently updated</h3></div></div>
        <div class="item-list">${items.slice(0, 5).map((item) => {
          const c = calc(item, settings);
          return rowHtml(item, `<span class="muted num">${c.hasPrice ? signedMoney(c.profit) : money(c.landed)}</span><span class="score-num">${item.ai?.score ?? '—'}</span>`);
        }).join('')}</div>
      </article>
      <article class="panel">
        <div class="panel-head"><div><p class="eyebrow">Watchlist</p><h3>Top opportunities</h3></div></div>
        ${opportunities.length
          ? `<div class="item-list">${opportunities.map((item) => rowHtml(item, `${decisionBadge(item.ai.decision)}<span class="score-num">${Math.round(item.ai.score)}</span>`)).join('')}</div>`
          : `<div class="empty">${icon('spark')}<strong>Nothing on the watchlist</strong>Scored items you’re still watching show up here.</div>`}
      </article>
    </div>`;

  if (hasSales) bindChart(months);
}
