import OpenAI from 'openai';
import { resolveAiConfig } from './config.js';
import { httpError } from './errors.js';

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
const MAX_RESULTS = 12;
const SEARCH_TIMEOUT_MS = 90_000;

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
        required: ['title', 'url', 'source', 'price', 'currency', 'shipping', 'condition', 'matchScore', 'why'],
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          source: { type: 'string' },
          price: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          currency: { type: 'string' },
          shipping: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          condition: { type: 'string' },
          matchScore: { type: 'number' },
          why: { type: 'string' }
        }
      }
    }
  }
};

const clients = new Map();
function clientFor(apiKey) {
  if (!clients.has(apiKey)) {
    clients.clear();
    clients.set(apiKey, new OpenAI({ apiKey, timeout: SEARCH_TIMEOUT_MS, maxRetries: 1 }));
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
    out.push({
      title: cleanText(raw.title, 180) || 'Untitled listing',
      url,
      source: sourceForUrl(url, cleanText(raw.source, 60)),
      price: nullableMoney(raw.price),
      currency: cleanText(raw.currency, 12) || 'USD',
      shipping: nullableMoney(raw.shipping),
      condition: cleanText(raw.condition, 120),
      matchScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 50,
      why: cleanText(raw.why, 500)
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out.sort((a, b) => b.matchScore - a.matchScore);
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

function searchPrompt(prompt) {
  return `You are the sourcing agent inside a resale/flipping app. Search the live web for CURRENT public item listings that match the user's request.

User request: ${prompt}

Search across the allowed marketplaces, not just one site. Prefer direct item/listing URLs over category, search, home, editorial, help, or profile pages. Return a diverse set of the strongest matches from multiple sites when possible.

Rules:
- Never invent a listing, URL, price, shipping charge, condition, or seller detail.
- price is the current asking/item price only; shipping is separate. Use null when a number is not visible in the search evidence.
- matchScore means how closely the CURRENT listing matches the user's prompt, not guaranteed profitability.
- why should be one short factual reason this item may be worth opening.
- Do not claim an item is profitable unless the evidence actually establishes both cost and resale value.
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
      search_context_size: 'medium',
      filters: { allowed_domains: HUNT_DOMAINS }
    }],
    tool_choice: 'required',
    include: ['web_search_call.action.sources'],
    input: searchPrompt(prompt),
    text: { format: { type: 'json_schema', name: 'flip_hunt_results', schema: huntSchema, strict: true } }
  });
}

export async function huntItems(value) {
  const prompt = normalizeHuntPrompt(value);
  const config = await resolveAiConfig();
  if (!config.openaiApiKey) throw httpError(400, 'Add an OpenAI API key in Settings before using AI Hunt.');

  const client = clientFor(config.openaiApiKey);
  const models = fallbackModels(config);
  let lastError;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    try {
      const response = await runSearch(client, model, prompt);
      const parsed = JSON.parse(response.output_text || '{}');
      const items = normalizeItems(parsed.items);
      return {
        engine: 'openai-web-search',
        model,
        prompt,
        interpretedRequest: cleanText(parsed.interpretedRequest, 500) || prompt,
        summary: cleanText(parsed.summary, 1000) || (items.length ? `Found ${items.length} current listings.` : 'No strong current matches found.'),
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

  if (lastError?.status === 401) throw httpError(401, 'The OpenAI API key was rejected. Check it in Settings.');
  if (lastError?.status === 429) throw httpError(429, 'OpenAI rate limit or quota reached.');
  throw httpError(502, `AI Hunt could not search the web: ${lastError?.message || 'unknown OpenAI error'}`);
}
