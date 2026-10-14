const SIGNAL_KEYS = ['offers', 'bids', 'watchers', 'likes', 'carts'];

function count(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(1_000_000, Math.round(parsed)) : null;
}

function cleanEvidence(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 180))
    .filter(Boolean))].slice(0, 6);
}

export function demandSignalScore(raw = {}) {
  const offers = count(raw.offers) || 0;
  const bids = count(raw.bids) || 0;
  const carts = count(raw.carts) || 0;
  const watchers = count(raw.watchers) || 0;
  const likes = count(raw.likes) || 0;
  const weighted = offers * 8 + bids * 7 + carts * 6 + watchers * 1.6 + likes * 0.8;
  if (!weighted) return 0;
  return Math.max(1, Math.min(100, Math.round(100 * (1 - Math.exp(-weighted / 42)))));
}

export function normalizeBuyerInterest(raw = {}) {
  const normalized = {};
  for (const key of SIGNAL_KEYS) normalized[key] = count(raw?.[key]);
  normalized.evidence = cleanEvidence(raw?.evidence);
  normalized.score = demandSignalScore(normalized);
  normalized.strength = normalized.score >= 70 ? 'hot' : normalized.score >= 35 ? 'warm' : normalized.score > 0 ? 'light' : 'unknown';
  normalized.hasPublicSignal = SIGNAL_KEYS.some((key) => normalized[key] !== null && normalized[key] > 0) || normalized.evidence.length > 0;
  return normalized;
}

export function mergeBuyerInterest(...values) {
  const merged = { evidence: [] };
  for (const key of SIGNAL_KEYS) {
    const counts = values.map((value) => count(value?.[key])).filter((value) => value !== null);
    merged[key] = counts.length ? Math.max(...counts) : null;
  }
  merged.evidence = cleanEvidence(values.flatMap((value) => value?.evidence || []));
  return normalizeBuyerInterest(merged);
}

export function buyerInterestText(raw = {}) {
  const value = normalizeBuyerInterest(raw);
  const labels = [
    ['offers', 'offer'],
    ['bids', 'bid'],
    ['watchers', 'watcher'],
    ['likes', 'like'],
    ['carts', 'cart/bag']
  ];
  const parts = labels.flatMap(([key, label]) => {
    const amount = value[key];
    return amount !== null && amount > 0 ? [`${amount} ${label}${amount === 1 ? '' : 's'}`] : [];
  });
  return parts.join(' · ') || (value.evidence[0] || 'No public buyer-interest count found');
}

export function normalizeGenericOpportunity(raw = {}) {
  const isGeneric = Boolean(raw?.isGeneric);
  const reason = String(raw?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  return { isGeneric, reason: isGeneric ? reason : '' };
}

export function opportunityScore(matchScore, buyerInterest = {}, genericOpportunity = {}) {
  const match = Number.isFinite(Number(matchScore)) ? Math.max(0, Math.min(100, Number(matchScore))) : 50;
  const demand = normalizeBuyerInterest(buyerInterest).score;
  const generic = normalizeGenericOpportunity(genericOpportunity).isGeneric ? 10 : 0;
  return Math.max(0, Math.min(100, Math.round(match * 0.68 + demand * 0.22 + generic)));
}

export function publicInterestFromText(value) {
  const text = String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .slice(0, 500_000);

  const patterns = {
    offers: [/(\d[\d,]*)\s+(?:active\s+)?offers?\b/i, /offers?\s*[:·-]?\s*(\d[\d,]*)\b/i],
    bids: [/(\d[\d,]*)\s+bids?\b/i, /bids?\s*[:·-]?\s*(\d[\d,]*)\b/i],
    watchers: [/(\d[\d,]*)\s+(?:people\s+)?watch(?:ers|ing)?\b/i, /watch(?:ers|ing)?\s*[:·-]?\s*(\d[\d,]*)\b/i],
    likes: [/(\d[\d,]*)\s+likes?\b/i, /likes?\s*[:·-]?\s*(\d[\d,]*)\b/i],
    carts: [/(\d[\d,]*)\s+(?:people\s+)?(?:have\s+)?(?:this\s+)?(?:in\s+)?(?:their\s+)?(?:carts?|bags?)\b/i]
  };

  const raw = { evidence: [] };
  for (const [key, candidates] of Object.entries(patterns)) {
    raw[key] = null;
    for (const pattern of candidates) {
      const match = text.match(pattern);
      if (!match) continue;
      raw[key] = count(match[1]);
      if (raw[key] !== null) raw.evidence.push(match[0].slice(0, 120));
      break;
    }
  }
  return normalizeBuyerInterest(raw);
}
