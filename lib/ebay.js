// eBay Browse API client (official API, application token — no user login needed).
// Docs: https://developer.ebay.com/api-docs/buy/browse/overview.html
import { resolveAiConfig } from './config.js';
import { httpError } from './errors.js';

const TIMEOUT_MS = 20_000;
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
const MARKET_TTL_MS = 10 * 60_000;
const CURRENCIES = { EBAY_US: 'USD', EBAY_GB: 'GBP', EBAY_CA: 'CAD', EBAY_AU: 'AUD', EBAY_DE: 'EUR', EBAY_FR: 'EUR', EBAY_IT: 'EUR', EBAY_ES: 'EUR', EBAY_IE: 'EUR', EBAY_NL: 'EUR' };
const SORTS = { newest: 'newlyListed', ending: 'endingSoonest', price: 'price' };

export const SEARCH_CONDITIONS = ['any', 'used', 'new'];
export const SEARCH_FORMATS = ['all', 'buy', 'auction'];
export const SEARCH_SORTS = ['best', 'newest', 'ending', 'price'];

let token = null;
const marketCache = new Map();

// Overridable so tests (and local mocks) never hit the real eBay API.
const apiBase = () => (process.env.EBAY_API_BASE || 'https://api.ebay.com').replace(/\/+$/, '');

async function ebayConfig(overrides) {
  const config = await resolveAiConfig(overrides);
  return {
    clientId: config.ebayClientId,
    clientSecret: config.ebayClientSecret,
    marketplace: config.ebayMarketplace || 'EBAY_US'
  };
}

async function ebayError(res, fallback) {
  try {
    const body = await res.json();
    const first = body.errors?.[0];
    return first?.longMessage || first?.message || body.error_description || fallback;
  } catch {
    return fallback;
  }
}

async function getToken(cfg, { fresh = false } = {}) {
  if (!cfg.clientId || !cfg.clientSecret) {
    throw httpError(400, 'Add your eBay Client ID and Client Secret in Settings to search eBay.');
  }
  const key = `${cfg.clientId}:${cfg.clientSecret}`;
  if (!fresh && token?.key === key && token.expiresAt > Date.now() + 60_000) return token.value;
  const res = await fetch(`${apiBase()}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(key).toString('base64')}`
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) {
    const message = await ebayError(res, `eBay sign-in failed (${res.status})`);
    throw httpError(res.status === 401 || res.status === 400 ? 400 : 502, `eBay rejected the keys: ${message}`);
  }
  const data = await res.json();
  token = { key, value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000 };
  return token.value;
}

async function ebayGet(path, params, cfg, retry = true) {
  const url = new URL(`${apiBase()}${path}`);
  for (const [name, value] of Object.entries(params || {})) if (value !== undefined && value !== '') url.searchParams.set(name, value);
  let res;
  try {
    res = await fetch(url, {
      headers: {
        authorization: `Bearer ${await getToken(cfg)}`,
        'X-EBAY-C-MARKETPLACE-ID': cfg.marketplace,
        accept: 'application/json'
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    if (error.status) throw error;
    throw httpError(502, error.name === 'TimeoutError' ? 'eBay took too long to respond.' : 'Could not reach eBay. Check the server\'s internet connection.');
  }
  if (res.status === 401 && retry) {
    token = null;
    return ebayGet(path, params, cfg, false);
  }
  if (res.status === 404) throw httpError(404, 'That eBay listing is no longer available.');
  if (!res.ok) throw httpError(502, `eBay error: ${await ebayError(res, `request failed (${res.status})`)}`);
  return res.json();
}

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const httpsUrl = (value) => (typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '');

export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeListing(raw) {
  const price = num(raw.price?.value ?? raw.currentBidPrice?.value);
  const shippingOption = raw.shippingOptions?.[0];
  const shippingValue = shippingOption?.shippingCost?.value;
  const shipping = shippingValue == null ? null : num(shippingValue);
  const images = [raw.image?.imageUrl, ...(raw.additionalImages || []).map((img) => img.imageUrl)]
    .map(httpsUrl).filter(Boolean);
  if (!images.length && raw.thumbnailImages?.[0]?.imageUrl) images.push(httpsUrl(raw.thumbnailImages[0].imageUrl));
  const categoryPath = String(raw.categoryPath || '').split('|').filter(Boolean);
  return {
    id: String(raw.itemId || ''),
    title: String(raw.title || '').trim(),
    price,
    currency: raw.price?.currency || raw.currentBidPrice?.currency || 'USD',
    shipping,
    total: Math.round((price + (shipping ?? 0)) * 100) / 100,
    image: images[0] || '',
    images: [...new Set(images)].slice(0, 12),
    url: httpsUrl(raw.itemWebUrl),
    condition: String(raw.condition || ''),
    buyingOptions: Array.isArray(raw.buyingOptions) ? raw.buyingOptions : [],
    bidCount: raw.bidCount ?? null,
    endsAt: raw.itemEndDate || null,
    seller: raw.seller ? {
      username: raw.seller.username || '',
      feedbackPercentage: raw.seller.feedbackPercentage ?? null,
      feedbackScore: raw.seller.feedbackScore ?? null
    } : null,
    location: [raw.itemLocation?.city, raw.itemLocation?.stateOrProvince, raw.itemLocation?.country].filter(Boolean).join(', '),
    category: categoryPath.at(-1) || raw.categories?.[0]?.categoryName || ''
  };
}

function findAspect(aspects, pattern) {
  const key = Object.keys(aspects).find((name) => pattern.test(name));
  return key ? aspects[key] : '';
}

function normalizeDetail(raw) {
  const base = normalizeListing(raw);
  const aspects = {};
  for (const aspect of raw.localizedAspects || []) {
    if (aspect?.name && aspect.value != null) aspects[aspect.name] = String(aspect.value);
  }
  return {
    ...base,
    aspects,
    brand: raw.brand || aspects.Brand || '',
    size: raw.size || findAspect(aspects, /^size\b/i) || '',
    color: raw.color || aspects.Color || '',
    material: raw.material || findAspect(aspects, /material/i) || '',
    department: raw.gender || aspects.Department || '',
    conditionDescription: String(raw.conditionDescription || '').trim(),
    description: htmlToText(raw.description || raw.shortDescription || '').slice(0, 2500)
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return Math.round((sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)) * 100) / 100;
}

function conditionFilter(condition) {
  if (condition === 'used') return 'conditions:{USED}';
  if (condition === 'new') return 'conditions:{NEW}';
  return null;
}

// Typical asking price for the same search without a price cap: the yardstick for "below market".
async function marketStats(query, condition, cfg) {
  const cacheKey = `${cfg.marketplace}|${query.toLowerCase()}|${condition}`;
  const cached = marketCache.get(cacheKey);
  if (cached && cached.at > Date.now() - MARKET_TTL_MS) return cached.stats;
  const filter = [conditionFilter(condition), 'buyingOptions:{FIXED_PRICE}'].filter(Boolean).join(',');
  const data = await ebayGet('/buy/browse/v1/item_summary/search', { q: query, limit: '100', filter }, cfg);
  const totals = (data.itemSummaries || []).map(normalizeListing).map((l) => l.total).filter((t) => t > 0).sort((a, b) => a - b);
  const stats = {
    count: totals.length,
    median: totals.length >= 5 ? percentile(totals, 0.5) : null,
    low: totals.length >= 5 ? percentile(totals, 0.25) : null,
    high: totals.length >= 5 ? percentile(totals, 0.75) : null
  };
  marketCache.set(cacheKey, { at: Date.now(), stats });
  return stats;
}

export function cleanSearch(input = {}) {
  const query = String(input.query ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
  if (query.length < 2) throw httpError(400, 'Type what you are looking for (at least 2 characters).');
  const minPrice = Math.max(0, num(input.minPrice));
  const maxPrice = Math.max(0, num(input.maxPrice));
  if (minPrice && maxPrice && minPrice > maxPrice) throw httpError(400, 'Min price is higher than max price.');
  return {
    query,
    minPrice,
    maxPrice,
    condition: SEARCH_CONDITIONS.includes(input.condition) ? input.condition : 'any',
    format: SEARCH_FORMATS.includes(input.format) ? input.format : 'all',
    sort: SEARCH_SORTS.includes(input.sort) ? input.sort : 'best'
  };
}

export async function searchListings(input) {
  const search = cleanSearch(input);
  const cfg = await ebayConfig();
  const currency = CURRENCIES[cfg.marketplace] || 'USD';
  const filters = [];
  if (search.minPrice || search.maxPrice) {
    const range = search.minPrice && search.maxPrice ? `${search.minPrice}..${search.maxPrice}`
      : search.maxPrice ? `..${search.maxPrice}` : `${search.minPrice}`;
    filters.push(`price:[${range}]`, `priceCurrency:${currency}`);
  }
  const condition = conditionFilter(search.condition);
  if (condition) filters.push(condition);
  filters.push(`buyingOptions:{${{ buy: 'FIXED_PRICE', auction: 'AUCTION' }[search.format] || 'FIXED_PRICE|AUCTION'}}`);
  const country = /^EBAY_[A-Z]{2}$/.test(cfg.marketplace) ? cfg.marketplace.slice(5) : '';
  if (country) filters.push(`deliveryCountry:${country}`);

  const [results, market] = await Promise.all([
    ebayGet('/buy/browse/v1/item_summary/search', {
      q: search.query,
      limit: '60',
      filter: filters.join(','),
      sort: SORTS[search.sort]
    }, cfg),
    marketStats(search.query, search.condition, cfg).catch(() => ({ count: 0, median: null, low: null, high: null }))
  ]);

  let listings = (results.itemSummaries || []).map(normalizeListing).filter((l) => l.id && l.price > 0);
  // Double-check the price window ourselves; eBay's filter is not always strict.
  listings = listings.filter((l) => (!search.minPrice || l.price >= search.minPrice) && (!search.maxPrice || l.price <= search.maxPrice));
  for (const listing of listings) {
    listing.belowMarketPct = market.median ? Math.round(((market.median - listing.total) / market.median) * 100) : null;
  }
  if (search.sort === 'best') {
    listings.sort((a, b) => (b.belowMarketPct ?? -Infinity) - (a.belowMarketPct ?? -Infinity));
  }
  return { search, market: { ...market, currency }, total: results.total ?? listings.length, listings };
}

export async function getListing(id) {
  const itemId = String(id || '').trim();
  if (!/^[\w|.-]{3,80}$/.test(itemId)) throw httpError(400, 'Invalid eBay item id');
  const cfg = await ebayConfig();
  return normalizeDetail(await ebayGet(`/buy/browse/v1/item/${encodeURIComponent(itemId)}`, {}, cfg));
}

export async function testEbay(overrides = {}) {
  const cfg = await ebayConfig(overrides);
  if (!cfg.clientId || !cfg.clientSecret) return { ok: false, message: 'Add both the Client ID and the Client Secret first.' };
  const started = Date.now();
  try {
    await getToken(cfg, { fresh: true });
    return { ok: true, latencyMs: Date.now() - started, message: `eBay accepted the keys — searching ${cfg.marketplace}.` };
  } catch (error) {
    const unreachable = error.name === 'TimeoutError' || error.cause || error instanceof TypeError;
    return { ok: false, message: unreachable ? 'Could not reach eBay. Check the server\'s internet connection.' : error.message };
  }
}
