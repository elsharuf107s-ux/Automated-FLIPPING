import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { resolveAiConfig } from './config.js';
import { httpError } from './errors.js';
import {
  mergeBuyerInterest,
  normalizeBuyerInterest,
  normalizeGenericOpportunity,
  opportunityScore,
  publicInterestFromText
} from './demand.js';

export const HUNT_SOURCES = [
  { name: 'eBay', domain: 'ebay.com' },
  { name: 'Depop', domain: 'depop.com' },
  { name: 'Poshmark', domain: 'poshmark.com' },
  { name: 'Mercari', domain: 'mercari.com' },
  { name: 'ShopGoodwill', domain: 'shopgoodwill.com' },
  { name: 'Grailed', domain: 'grailed.com' },
  { name: 'OfferUp', domain: 'offerup.com' },
  { name: 'Facebook Marketplace', domain: 'facebook.com' },
  { name: 'Etsy', domain: 'etsy.com' },
  { name: 'Walmart', domain: 'walmart.com' }
];

const HUNT_DOMAINS = HUNT_SOURCES.map((source) => source.domain);
const MAX_RESULTS = 10;
const SEARCH_TIMEOUT_MS = 55_000;
const JOB_TTL_MS = 15 * 60_000;
const PREVIEW_TIMEOUT_MS = 5_000;
const PREVIEW_HTML_LIMIT = 450_000;
const PREVIEW_ITEM_LIMIT = 8;
const PREVIEW_CONCURRENCY = 4;

const nullableCount = { anyOf: [{ type: 'number' }, { type: 'null' }] };

const huntSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'interpretedRequest', 'items'],
  properties: {
    summary: { type: 'string' },
    interpretedRequest: { type: 'string' },
    items: {
      type: 'array',
      maxItems: MAX_RESULTS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title', 'url', 'source', 'price', 'currency', 'shipping', 'condition', 'matchScore', 'why',
          'buyerInterest', 'genericOpportunity'
        ],
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          source: { type: 'string' },
          price: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          currency: { type: 'string' },
          shipping: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          condition: { type: 'string' },
          matchScore: { type: 'number' },
          why: { type: 'string' },
          buyerInterest: {
            type: 'object',
            additionalProperties: false,
            required: ['offers', 'bids', 'watchers', 'likes', 'carts', 'evidence'],
            properties: {
              offers: nullableCount,
              bids: nullableCount,
              watchers: nullableCount,
              likes: nullableCount,
              carts: nullableCount,
              evidence: { type: 'array', maxItems: 6, items: { type: 'string' } }
            }
          },
          genericOpportunity: {
            type: 'object',
            additionalProperties: false,
            required: ['isGeneric', 'reason'],
            properties: {
              isGeneric: { type: 'boolean' },
              reason: { type: 'string' }
            }
          }
        }
      }
    }
  }
};

const clients = new Map();
const jobs = new Map();

const MIDDLEMAN_POLICIES = {
  eBay: {
    status: 'blocked-retail-arbitrage',
    label: 'Not supplier-ready',
    note: 'Do not list first and then buy this retail/marketplace item to ship to your buyer. eBay only allows zero-inventory fulfillment when you already own the stock or have an agreement with a wholesale supplier.'
  },
  Depop: {
    status: 'blocked',
    label: 'No catalog dropshipping',
    note: 'Ordinary catalog dropshipping is not allowed, and supplier/stock photos are not allowed for those listings.'
  },
  Mercari: {
    status: 'blocked',
    label: 'Possession required',
    note: 'Mercari prohibits items not in your possession, third-party shipping, stock photos, and photos you do not own.'
  },
  Etsy: {
    status: 'blocked-retail-resale',
    label: 'Not for ordinary resale',
    note: 'Ordinary ready-made dropshipping/reselling is not allowed. Production partners are for your own original designs or limited permitted categories.'
  }
};

function clientFor(apiKey) {
  if (!clients.has(apiKey)) {
    clients.clear();
    clients.set(apiKey, new OpenAI({ apiKey, timeout: SEARCH_TIMEOUT_MS, maxRetries: 0 }));
  }
  return clients.get(apiKey);
}

export function normalizeHuntPrompt(value) {
  const prompt = String(value || '').replace(/\s+/g, ' ').trim();
  if (prompt.length < 3) throw httpError(400, 'Tell AI Hunt what you want to find.');
  if (prompt.length > 1200) throw httpError(400, 'Keep the hunt prompt under 1,200 characters.');
  return prompt;
}

function domainMatches(hostname, domain) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  return host === domain || host.endsWith(`.${domain}`);
}

export function isAllowedHuntUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return HUNT_DOMAINS.some((domain) => domainMatches(url.hostname, domain));
  } catch {
    return false;
  }
}

function sourceForUrl(value, fallback = '') {
  try {
    const hostname = new URL(value).hostname;
    return HUNT_SOURCES.find((source) => domainMatches(hostname, source.domain))?.name || fallback;
  } catch {
    return fallback;
  }
}

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function nullableMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

export function middlemanPolicyForSource(source) {
  const name = cleanText(source, 80);
  return MIDDLEMAN_POLICIES[name] || {
    status: 'review',
    label: 'Check seller rules',
    note: 'Treat this as a normal sourcing listing unless you have a supplier agreement and permission to reuse media. Do not assume zero-inventory resale is allowed.'
  };
}

function normalizeItems(items) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    if (!isAllowedHuntUrl(raw?.url)) continue;
    let url;
    try {
      const parsed = new URL(raw.url);
      parsed.hash = '';
      url = parsed.href;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const score = Number(raw.matchScore);
    const matchScore = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 50;
    const source = sourceForUrl(url, cleanText(raw.source, 60));
    const buyerInterest = normalizeBuyerInterest(raw.buyerInterest);
    const genericOpportunity = normalizeGenericOpportunity(raw.genericOpportunity);
    out.push({
      title: cleanText(raw.title, 180) || 'Untitled listing',
      url,
      source,
      price: nullableMoney(raw.price),
      currency: cleanText(raw.currency, 12) || 'USD',
      shipping: nullableMoney(raw.shipping),
      condition: cleanText(raw.condition, 120),
      matchScore,
      opportunityScore: opportunityScore(matchScore, buyerInterest, genericOpportunity),
      why: cleanText(raw.why, 500),
      buyerInterest,
      genericOpportunity,
      previewImages: [],
      imageUsage: 'reference-only',
      middleman: middlemanPolicyForSource(source)
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out.sort((a, b) => b.opportunityScore - a.opportunityScore || b.matchScore - a.matchScore);
}

function normalizeCitation(raw) {
  const url = raw?.url || raw?.url_citation?.url;
  if (!isAllowedHuntUrl(url)) return null;
  return {
    url,
    title: cleanText(raw?.title || raw?.url_citation?.title || sourceForUrl(url), 180)
  };
}

function collectCitations(response) {
  const seen = new Set();
  const out = [];
  const add = (raw) => {
    const citation = normalizeCitation(raw);
    if (!citation || seen.has(citation.url)) return;
    seen.add(citation.url);
    out.push(citation);
  };

  for (const item of response?.output || []) {
    if (item?.type === 'web_search_call') {
      for (const source of item.action?.sources || []) add(source);
    }
    if (item?.type === 'message') {
      for (const content of item.content || []) {
        for (const annotation of content.annotations || []) {
          if (annotation?.type === 'url_citation') add(annotation);
        }
      }
    }
  }
  return out.slice(0, 30);
}

function decodeHtmlAttr(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2f;|&#47;/gi, '/')
    .replace(/\\\//g, '/');
}

function parseTagAttributes(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*(["'])(.*?)\2/gs)) {
    attrs[String(match[1]).toLowerCase()] = decodeHtmlAttr(match[3]);
  }
  return attrs;
}

function extractPreviewImages(html, pageUrl) {
  const images = [];
  const seen = new Set();
  const add = (value) => {
    if (!value || images.length >= 4) return;
    try {
      const url = new URL(decodeHtmlAttr(value), pageUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      const href = url.href;
      if (!seen.has(href)) {
        seen.add(href);
        images.push(href);
      }
    } catch {}
  };

  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = parseTagAttributes(tag);
    const key = String(attrs.property || attrs.name || '').toLowerCase();
    if (['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'].includes(key)) add(attrs.content);
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attrs = parseTagAttributes(tag);
    if (String(attrs.rel || '').toLowerCase() === 'image_src') add(attrs.href);
  }
  for (const match of html.matchAll(/"image"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|\[\s*"([^"\\]*(?:\\.[^"\\]*)*)")/gi)) {
    add(match[1] || match[2]);
    if (images.length >= 4) break;
  }
  return images;
}

async function readLimitedHtml(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = '';
  try {
    while (total < PREVIEW_HTML_LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      const slice = value.byteLength + total > PREVIEW_HTML_LIMIT
        ? value.subarray(0, PREVIEW_HTML_LIMIT - total)
        : value;
      total += slice.byteLength;
      html += decoder.decode(slice, { stream: true });
    }
    html += decoder.decode();
  } finally {
    reader.cancel().catch(() => {});
  }
  return html;
}

async function fetchListingPreview(value) {
  let current = String(value || '');
  for (let redirect = 0; redirect < 3; redirect += 1) {
    if (!isAllowedHuntUrl(current)) return { images: [], buyerInterest: normalizeBuyerInterest() };
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36 FlipLab/1.0'
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return { images: [], buyerInterest: normalizeBuyerInterest() };
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) return { images: [], buyerInterest: normalizeBuyerInterest() };
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) {
      return { images: [], buyerInterest: normalizeBuyerInterest() };
    }
    const html = await readLimitedHtml(response);
    return {
      images: extractPreviewImages(html, current),
      buyerInterest: publicInterestFromText(html)
    };
  }
  return { images: [], buyerInterest: normalizeBuyerInterest() };
}

async function enrichListingPreviews(items) {
  const result = items.map((item) => ({ ...item }));
  const queue = result.slice(0, PREVIEW_ITEM_LIMIT);
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        const preview = await fetchListingPreview(item.url);
        item.previewImages = preview.images;
        item.buyerInterest = mergeBuyerInterest(item.buyerInterest, preview.buyerInterest);
        item.opportunityScore = opportunityScore(item.matchScore, item.buyerInterest, item.genericOpportunity);
      } catch {
        item.previewImages = [];
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PREVIEW_CONCURRENCY, queue.length || 1) }, () => worker()));
  return result.sort((a, b) => b.opportunityScore - a.opportunityScore || b.matchScore - a.matchScore);
}

function searchPrompt(prompt) {
  return `You are the sourcing agent inside a resale/flipping app. Search the live web for CURRENT public item listings that match the user's request.

User request: ${prompt}

Search across the allowed marketplaces, not just one site. Prefer direct item/listing URLs over category, search, home, editorial, help, or profile pages. Return a diverse set of the strongest matches from multiple sites when possible.

Run TWO discovery lanes on every hunt:
1. MOMENTUM: look for listings where the public page/search evidence explicitly shows buyer intent such as a count of offers, bids, watchers, likes, carts/bags, or similar activity.
2. GENERIC GEMS: also search broad/generic wording, common misspellings, abbreviations, missing brand/model names, and poorly described listings that still match the user's requested category/style. If the user names a brand, also try category/material/silhouette terms without relying only on that brand name.

Rules:
- Never invent a listing, URL, price, shipping charge, condition, seller detail, offer count, bid count, watcher count, like count, or cart count.
- buyerInterest counts MUST be null unless the public search/page evidence explicitly states the number. A button saying "Make Offer", "Offers accepted", or "Send offer" is NOT evidence that anybody has already made an offer.
- buyerInterest.evidence should contain only short exact factual phrases supported by the search/page evidence, such as "7 bids" or "12 watchers". Leave it empty when nothing public is visible.
- genericOpportunity.isGeneric should be true only when the listing itself is vague, poorly titled, misspelled, missing a useful brand/model, or otherwise under-described relative to the likely item. reason should say what is generic about it without inventing identity or authenticity.
- price is the current asking/item price only; shipping is separate. Use null when a number is not visible in the search evidence.
- matchScore means how closely the CURRENT listing matches the user's prompt, not guaranteed profitability.
- why should be one short factual reason this item may be worth opening; mention verified buyer activity or the generic-listing angle when applicable.
- Do not claim an item is profitable or likely to sell solely because it has engagement. Buyer-interest signals increase confidence in demand but do not guarantee a sale.
- If the user mentions a budget, brand, size, category, condition, style, margin, location, or other constraint, prioritize it.
- Only include URLs from the marketplaces made available by the web-search tool.
- Return only the structured result requested by the response schema.`;
}

function fallbackModels(config) {
  return [...new Set([
    process.env.OPENAI_SEARCH_MODEL,
    config.openaiModel,
    'gpt-5.5'
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function canTryAnotherModel(error) {
  if (![400, 404].includes(Number(error?.status))) return false;
  return /model|web[_ -]?search|tool|unsupported|not found|does not support/i.test(String(error?.message || ''));
}

async function runSearch(client, model, prompt) {
  return client.responses.create({
    model,
    tools: [{
      type: 'web_search',
      search_context_size: 'low',
      filters: { allowed_domains: HUNT_DOMAINS }
    }],
    tool_choice: 'required',
    include: ['web_search_call.action.sources'],
    input: searchPrompt(prompt),
    max_output_tokens: 3800,
    text: { format: { type: 'json_schema', name: 'flip_hunt_results', schema: huntSchema, strict: true } }
  });
}

function huntError(error) {
  if (error?.status === 401) return httpError(401, 'The OpenAI API key was rejected. Check it in Settings.');
  if (error?.status === 429) return httpError(429, 'OpenAI rate limit or quota reached.');
  if (error?.name === 'APIConnectionTimeoutError' || error?.name === 'TimeoutError') {
    return httpError(504, 'OpenAI web search took too long. Try a more specific hunt prompt.');
  }
  return httpError(502, `AI Hunt could not search the web: ${error?.message || 'unknown OpenAI error'}`);
}

async function executeHunt(prompt, config) {
  if (!config.openaiApiKey) throw httpError(400, 'Add an OpenAI API key in Settings before using AI Hunt.');

  const client = clientFor(config.openaiApiKey);
  const models = fallbackModels(config);
  let lastError;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    try {
      const response = await runSearch(client, model, prompt);
      const parsed = JSON.parse(response.output_text || '{}');
      const normalized = normalizeItems(parsed.items);
      const items = await enrichListingPreviews(normalized);
      const active = items.filter((item) => item.buyerInterest?.hasPublicSignal).length;
      const generic = items.filter((item) => item.genericOpportunity?.isGeneric).length;
      return {
        engine: 'openai-web-search',
        model,
        prompt,
        interpretedRequest: cleanText(parsed.interpretedRequest, 500) || prompt,
        summary: cleanText(parsed.summary, 1000) || (items.length ? `Found ${items.length} current listings.` : 'No strong current matches found.'),
        demandSummary: { active, generic },
        searchedSources: HUNT_SOURCES,
        citations: collectCitations(response),
        items,
        searchedAt: new Date().toISOString()
      };
    } catch (error) {
      lastError = error;
      if (index === models.length - 1 || !canTryAnotherModel(error)) break;
    }
  }

  throw huntError(lastError);
}

export async function huntItems(value) {
  const prompt = normalizeHuntPrompt(value);
  const config = await resolveAiConfig();
  return executeHunt(prompt, config);
}

function pruneJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (new Date(job.updatedAt).getTime() < cutoff) jobs.delete(id);
  }
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    prompt: job.prompt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {})
  };
}

export async function startHuntJob(value) {
  const prompt = normalizeHuntPrompt(value);
  const config = await resolveAiConfig();
  if (!config.openaiApiKey) throw httpError(400, 'Add an OpenAI API key in Settings before using AI Hunt.');

  pruneJobs();
  const now = new Date().toISOString();
  const job = {
    id: randomUUID(),
    status: 'running',
    prompt,
    createdAt: now,
    updatedAt: now,
    result: null,
    error: null
  };
  jobs.set(job.id, job);

  queueMicrotask(() => {
    executeHunt(prompt, config).then((result) => {
      job.status = 'completed';
      job.result = result;
      job.updatedAt = new Date().toISOString();
    }).catch((error) => {
      const normalized = error?.status ? error : huntError(error);
      job.status = 'failed';
      job.error = { status: normalized.status || 500, message: normalized.message || 'AI Hunt failed.' };
      job.updatedAt = new Date().toISOString();
    });
  });

  return publicJob(job);
}

export function getHuntJob(id) {
  pruneJobs();
  const job = jobs.get(String(id || ''));
  return job ? publicJob(job) : null;
}
