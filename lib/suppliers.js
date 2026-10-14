export const SUPPLIER_SOURCES = [
  { name: 'AliExpress', domains: ['aliexpress.com', 'aliexpress.us'] },
  { name: 'DHgate', domains: ['dhgate.com'] },
  { name: 'Temu', domains: ['temu.com'], searchOnly: true }
];

export const SUPPLIER_DOMAINS = SUPPLIER_SOURCES.flatMap((source) => source.domains);
export const MAX_SUPPLIER_TARGETS = 5;
export const MAX_SUPPLIER_MATCHES = 10;

const nullableMoney = { anyOf: [{ type: 'number' }, { type: 'null' }] };

export const supplierSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'matches'],
  properties: {
    summary: { type: 'string' },
    matches: {
      type: 'array',
      maxItems: MAX_SUPPLIER_MATCHES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'targetUrl', 'title', 'url', 'source', 'price', 'currency', 'shipping',
          'matchType', 'matchConfidence', 'why', 'differences', 'garmentType',
          'color', 'material', 'sizeRange', 'brandStatus'
        ],
        properties: {
          targetUrl: { type: 'string' },
          title: { type: 'string' },
          url: { type: 'string' },
          source: { type: 'string' },
          price: nullableMoney,
          currency: { type: 'string' },
          shipping: nullableMoney,
          matchType: { type: 'string', enum: ['exact', 'similar', 'generic'] },
          matchConfidence: { type: 'number' },
          why: { type: 'string' },
          differences: { type: 'array', maxItems: 6, items: { type: 'string' } },
          garmentType: { type: 'string' },
          color: { type: 'string' },
          material: { type: 'string' },
          sizeRange: { type: 'string' },
          brandStatus: { type: 'string', enum: ['unbranded', 'same-brand-explicit', 'unknown'] }
        }
      }
    }
  }
};

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function money(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

function domainMatches(hostname, domain) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  return host === domain || host.endsWith(`.${domain}`);
}

export function supplierSourceForUrl(value) {
  try {
    const hostname = new URL(value).hostname;
    return SUPPLIER_SOURCES.find((source) => source.domains.some((domain) => domainMatches(hostname, domain)))?.name || '';
  } catch {
    return '';
  }
}

export function isAllowedSupplierUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return Boolean(supplierSourceForUrl(url.href));
  } catch {
    return false;
  }
}

export function supplierSearchOnly(source) {
  return SUPPLIER_SOURCES.find((entry) => entry.name === source)?.searchOnly === true;
}

function targetCost(target) {
  const price = money(target?.price);
  if (price === null) return null;
  return Math.round((price + (money(target?.shipping) || 0)) * 100) / 100;
}

function supplierCost(match) {
  const price = money(match?.price);
  if (price === null) return null;
  return Math.round((price + (money(match?.shipping) || 0)) * 100) / 100;
}

export function normalizeSupplierMatches(rawMatches, targets = []) {
  const byUrl = new Map(targets.map((target) => [String(target.url || ''), target]));
  const seen = new Set();
  const normalized = [];

  for (const raw of Array.isArray(rawMatches) ? rawMatches : []) {
    const target = byUrl.get(String(raw?.targetUrl || ''));
    if (!target || !isAllowedSupplierUrl(raw?.url)) continue;

    let url;
    try {
      const parsed = new URL(raw.url);
      parsed.hash = '';
      url = parsed.href;
    } catch {
      continue;
    }

    const dedupe = `${target.url}|${url}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const source = supplierSourceForUrl(url) || cleanText(raw.source, 40);
    const matchType = ['exact', 'similar', 'generic'].includes(raw.matchType) ? raw.matchType : 'similar';
    const confidenceRaw = Number(raw.matchConfidence);
    const matchConfidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
      : 50;

    const match = {
      targetUrl: target.url,
      title: cleanText(raw.title, 180) || 'Supplier clothing listing',
      url,
      source,
      price: money(raw.price),
      currency: cleanText(raw.currency, 12) || 'USD',
      shipping: money(raw.shipping),
      matchType,
      matchConfidence,
      why: cleanText(raw.why, 500),
      differences: (Array.isArray(raw.differences) ? raw.differences : []).map((value) => cleanText(value, 120)).filter(Boolean).slice(0, 6),
      garmentType: cleanText(raw.garmentType, 80),
      color: cleanText(raw.color, 80),
      material: cleanText(raw.material, 120),
      sizeRange: cleanText(raw.sizeRange, 120),
      brandStatus: ['unbranded', 'same-brand-explicit', 'unknown'].includes(raw.brandStatus) ? raw.brandStatus : 'unknown',
      searchOnly: supplierSearchOnly(source)
    };

    const sourceCost = supplierCost(match);
    const marketCost = targetCost(target);
    match.landedCost = sourceCost;
    match.referenceCost = marketCost;
    match.savings = sourceCost !== null && marketCost !== null ? Math.round((marketCost - sourceCost) * 100) / 100 : null;
    match.savingsPercent = match.savings !== null && marketCost > 0
      ? Math.round((match.savings / marketCost) * 100)
      : null;

    // The user asked for cheaper supplier options. If both costs are known, discard matches that are not cheaper.
    if (sourceCost !== null && marketCost !== null && sourceCost >= marketCost) continue;

    // Branded resale listings should not turn an unverified supplier lookalike into a branded listing.
    match.brandSafety = raw.brandStatus === 'same-brand-explicit'
      ? 'verify-authenticity'
      : 'list-as-generic';

    normalized.push(match);
  }

  return normalized
    .sort((a, b) => {
      const typeWeight = { exact: 3, similar: 2, generic: 1 };
      const aSavings = a.savings ?? -9999;
      const bSavings = b.savings ?? -9999;
      return (typeWeight[b.matchType] - typeWeight[a.matchType]) || (b.matchConfidence - a.matchConfidence) || (bSavings - aSavings);
    })
    .slice(0, MAX_SUPPLIER_MATCHES);
}

export function attachSupplierMatches(items, matches) {
  const byTarget = new Map();
  for (const match of matches || []) {
    if (!byTarget.has(match.targetUrl)) byTarget.set(match.targetUrl, []);
    byTarget.get(match.targetUrl).push(match);
  }

  return (items || []).map((item) => {
    const supplierMatches = (byTarget.get(item.url) || []).slice(0, 3);
    return {
      ...item,
      supplierMatches,
      bestSupplier: supplierMatches[0] || null
    };
  });
}

export function supplierSearchPrompt(targets) {
  const simplified = targets.slice(0, MAX_SUPPLIER_TARGETS).map((item) => ({
    targetUrl: item.url,
    title: item.title,
    askingPrice: item.price,
    shipping: item.shipping,
    condition: item.condition,
    genericOpportunity: item.genericOpportunity,
    buyerInterest: item.buyerInterest
  }));

  return `You are the clothing supplier-match agent inside a resale sourcing app. Search ONLY AliExpress, DHgate, and Temu for CURRENT public CLOTHING listings that are cheaper alternatives to the resale-market targets below.\n\nTargets:\n${JSON.stringify(simplified, null, 2)}\n\nRules:\n- CLOTHING ONLY: jackets, hoodies, shirts, tees, sweaters, jeans, pants, shorts, skirts, dresses, coats, vests, activewear and closely related apparel. Ignore electronics, accessories, tools, home goods, shoes and unrelated products.\n- Match on garment type, silhouette/cut, visible design, color, material/fabric, size range and style. Do not rely on title keywords alone.\n- Prefer supplier listings whose item price + visible shipping is cheaper than the target listing price + shipping.\n- Return direct product URLs, not category/search/home pages.\n- matchType=exact only when the supplier listing appears to be the same lawful product/model based on explicit evidence. Use similar when the garment is close but not the same. Use generic for an unbranded/basic alternative.\n- Never turn an unbranded or lookalike supplier item into a branded product. If the target uses Nike, Carhartt, Adidas, designer names or other trademarks, search the garment attributes without copying the trademark into a generic supplier match.\n- Do not recommend replicas, counterfeit goods, fake logos, trademark knockoffs or listings whose value depends on pretending they are a brand they are not.\n- brandStatus=same-brand-explicit only when the supplier page itself explicitly and credibly identifies the same brand; otherwise use unbranded or unknown. Even then, authenticity must be verified separately.\n- Never invent a price, shipping cost, material, size range or product URL. Use null or empty strings when not visible.\n- Temu should be treated as SEARCH-ONLY metadata: do not imply the app crawled or automated Temu directly.\n- why should briefly explain the clothing match. differences should call out material, cut, color, branding, sizing or design differences that matter.\n- Return only the structured result requested by the schema.`;
}
