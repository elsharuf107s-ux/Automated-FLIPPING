import OpenAI from 'openai';
import { resolveAiConfig } from './config.js';

const OPENAI_TIMEOUT_MS = 90_000;
const OLLAMA_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 15_000;

const trendSignals = [
  'outerwear and utility jackets',
  'baggy and relaxed denim',
  'Y2K occasionwear',
  'workwear',
  'technical outdoor clothing',
  '90s and 2000s sportswear',
  'whimsigoth and romantic vintage'
];

export const DEPOP_CONDITIONS = ['Brand new', 'Like new', 'Used - Excellent', 'Used - Good', 'Used - Fair'];

const depopSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'hashtags', 'category', 'brand', 'size', 'condition', 'colors', 'styleTags', 'material',
    'listPrice', 'minOfferPrice', 'measurements', 'photoTips'],
  properties: {
    description: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    category: { type: 'string' },
    brand: { type: 'string' },
    size: { type: 'string' },
    condition: { type: 'string', enum: DEPOP_CONDITIONS },
    colors: { type: 'array', items: { type: 'string' } },
    styleTags: { type: 'array', items: { type: 'string' } },
    material: { type: 'string' },
    listPrice: { type: 'number' },
    minOfferPrice: { type: 'number' },
    measurements: { type: 'array', items: { type: 'string' } },
    photoTips: { type: 'array', items: { type: 'string' } }
  }
};

const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'decision', 'demand', 'risk', 'estimatedSaleLow', 'estimatedSaleHigh', 'maxBuyPrice',
    'suggestedTitle', 'suggestedDescription', 'keywords', 'rationale', 'checks', 'confidence', 'depop'],
  properties: {
    score: { type: 'number', description: 'Flip score 0-100' },
    decision: { type: 'string', enum: ['BUY', 'WATCH', 'PASS'] },
    demand: { type: 'string', enum: ['high', 'medium', 'low'] },
    risk: { type: 'string', enum: ['high', 'medium', 'low'] },
    estimatedSaleLow: { type: 'number' },
    estimatedSaleHigh: { type: 'number' },
    maxBuyPrice: { type: 'number' },
    suggestedTitle: { type: 'string' },
    suggestedDescription: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
    checks: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', description: '0-1' },
    depop: depopSchema
  }
};

function money(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pick(value, allowed, fallback) {
  const normalized = String(value || '').trim();
  return allowed.find((option) => option.toLowerCase() === normalized.toLowerCase()) || fallback;
}

function strings(value, limit) {
  return (Array.isArray(value) ? value : []).map((entry) => String(entry).trim()).filter(Boolean).slice(0, limit);
}

const DEPOP_FROM_CONDITION = {
  'new with tags': 'Brand new',
  'like new': 'Like new',
  excellent: 'Used - Excellent',
  good: 'Used - Good',
  fair: 'Used - Fair',
  'needs repair': 'Used - Fair'
};

const clip = (value, max) => String(value ?? '').trim().slice(0, max);

function normalizeDepop(raw, base, item) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const listPrice = Math.max(0, Math.round(money(d.listPrice) || base.estimatedSaleHigh || 0));
  const minOffer = Math.round(money(d.minOfferPrice) || listPrice * 0.8);
  return {
    description: clip(d.description || base.suggestedDescription, 1000),
    hashtags: [...new Set(strings(d.hashtags, 10).map((tag) => tag.replace(/^#+/, '').replace(/\s+/g, '').toLowerCase()).filter(Boolean))].slice(0, 5),
    category: clip(d.category || item.category, 120),
    brand: clip(d.brand || item.brand, 80),
    size: clip(d.size || item.size, 40),
    condition: pick(d.condition, DEPOP_CONDITIONS, DEPOP_FROM_CONDITION[String(item.condition || '').toLowerCase()] || 'Used - Good'),
    colors: strings(d.colors, 2).map((c) => clip(c, 30)),
    styleTags: strings(d.styleTags, 3).map((c) => clip(c, 30)),
    material: clip(d.material, 80),
    listPrice,
    minOfferPrice: Math.max(0, Math.min(listPrice, minOffer)),
    measurements: strings(d.measurements, 6).map((c) => clip(c, 60)),
    photoTips: strings(d.photoTips, 6).map((c) => clip(c, 120))
  };
}

// Models occasionally return out-of-range numbers or loose casing. Normalise so the UI
// can always trust the shape of an analysis, whatever produced it.
export function normalizeAnalysis(raw, item = {}) {
  const low = Math.max(0, Math.round(money(raw.estimatedSaleLow)));
  const high = Math.max(low, Math.round(money(raw.estimatedSaleHigh, low)));
  let confidence = money(raw.confidence, 0.5);
  if (confidence > 1) confidence /= 100;
  const base = {
    score: Math.max(0, Math.min(100, Math.round(money(raw.score)))),
    decision: pick(raw.decision, ['BUY', 'WATCH', 'PASS'], 'WATCH'),
    demand: pick(raw.demand, ['high', 'medium', 'low'], 'medium'),
    risk: pick(raw.risk, ['high', 'medium', 'low'], 'medium'),
    estimatedSaleLow: low,
    estimatedSaleHigh: high,
    maxBuyPrice: Math.max(0, Math.round(money(raw.maxBuyPrice))),
    suggestedTitle: String(raw.suggestedTitle || item.title || '').trim().slice(0, 80),
    suggestedDescription: String(raw.suggestedDescription || '').trim().slice(0, 3000),
    keywords: strings(raw.keywords, 12),
    rationale: String(raw.rationale || '').trim().slice(0, 1500),
    checks: strings(raw.checks, 8),
    confidence: Math.max(0, Math.min(1, confidence)),
    mode: raw.mode || 'demo',
    model: raw.model || null,
    analyzedAt: new Date().toISOString(),
    ...(raw.warning ? { warning: String(raw.warning) } : {})
  };
  return { ...base, depop: normalizeDepop(raw.depop, base, item) };
}

function withBrand(item, text) {
  const value = String(text || '').trim();
  if (!item.brand || value.toLowerCase().includes(String(item.brand).toLowerCase())) return value;
  return `${item.brand} ${value}`.trim();
}

export function fallbackAnalysis(item) {
  const landed = money(item.purchasePrice) + money(item.inboundShipping) + money(item.repairCost);
  // Without a target, use the typical market price when the deal finder supplies one.
  const target = money(item.targetPrice) || money(item.marketMedian) || Math.max(landed * 2.15, landed + 25);
  const feeRate = (money(item.marketplaceFeePercent) + money(item.paymentFeePercent)) / 100;
  const low = Math.max(5, Math.round(target * 0.82));
  const high = Math.max(low + 5, Math.round(target * 1.14));
  const profit = target - landed - money(item.outboundShipping) - target * feeRate;
  const roi = landed > 0 ? (profit / landed) * 100 : 0;
  const completeness = (item.brand ? 8 : 0) + (item.image ? 7 : 0) + (item.condition ? 3 : 0);
  const score = Math.max(20, Math.min(95, Math.round(45 + Math.min(35, roi / 3) + completeness)));

  return {
    mode: 'demo',
    score,
    decision: score >= 78 ? 'BUY' : score >= 58 ? 'WATCH' : 'PASS',
    demand: score >= 78 ? 'high' : score >= 58 ? 'medium' : 'low',
    risk: item.brand ? 'medium' : 'high',
    estimatedSaleLow: low,
    estimatedSaleHigh: high,
    maxBuyPrice: Math.max(0, Math.round((low * (1 - feeRate) - money(item.outboundShipping)) / 2.2)),
    suggestedTitle: withBrand(item, item.title || item.category).slice(0, 80) || 'Vintage resale item',
    suggestedDescription: `Pre-owned ${item.brand || ''} ${item.title || item.category || 'item'}${item.condition ? ` in ${item.condition.toLowerCase()} condition` : ''}. Review photos and measurements carefully. Add condition notes, measurements, material, and any flaws before publishing.`.replace(/\s+/g, ' '),
    keywords: [item.brand, item.category, 'vintage', 'resale'].filter(Boolean).slice(0, 8),
    rationale: `Demo scoring uses your costs, ${!money(item.targetPrice) && money(item.marketMedian) ? `the typical market price ($${Math.round(money(item.marketMedian))})` : 'target price'}, brand presence and listing completeness. Connect an AI provider in Settings for photo analysis and richer recommendations.`,
    checks: ['Verify condition and measurements', 'Check authenticity for branded items', 'Compare against real sold listings before buying'],
    confidence: 0.45,
    depop: {
      description: [
        [withBrand(item, item.title || item.category), item.size && !String(item.title || '').toLowerCase().includes(`size ${item.size}`.toLowerCase()) && `— size ${item.size}`].filter(Boolean).join(' '),
        item.condition ? `Condition: ${item.condition}. See photos for details.` : 'Pre-owned. See photos for details.',
        'Measurements: pit to pit __in · length __in',
        'Fast shipping. Message me with any questions!'
      ].join('\n\n'),
      hashtags: [item.brand, item.category, 'vintage'].filter(Boolean),
      category: item.category || '',
      listPrice: high,
      minOfferPrice: Math.round(low * 0.95),
      measurements: ['Pit to pit', 'Length'],
      photoTips: ['Front, flat lay or on a hanger in daylight', 'Back', 'Brand tag and size tag close-up', 'Any flaws up close']
    }
  };
}

function extractJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI did not return JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function promptFor(item) {
  return `You are an expert secondhand clothing reseller assistant. Analyze this potential flip using ONLY the provided facts and visible image evidence. Do not claim you checked live sold comps, marketplace APIs, or current listings. Any resale price is an estimate, not a verified comp.

Current seasonal priors to consider when genuinely relevant: ${trendSignals.join(', ')}.

Item data:
${JSON.stringify({
    title: item.title,
    brand: item.brand,
    category: item.category,
    size: item.size,
    condition: item.condition,
    purchasePrice: money(item.purchasePrice),
    inboundShipping: money(item.inboundShipping),
    repairCost: money(item.repairCost),
    targetPrice: money(item.targetPrice),
    outboundShipping: money(item.outboundShipping),
    marketplaceFeePercent: money(item.marketplaceFeePercent),
    paymentFeePercent: money(item.paymentFeePercent),
    notes: item.notes,
    sourceUrl: item.sourceUrl
  }, null, 2)}

Return ONLY valid JSON matching this shape:
{
  "score": number 0-100,
  "decision": "BUY"|"WATCH"|"PASS",
  "demand": "high"|"medium"|"low",
  "risk": "high"|"medium"|"low",
  "estimatedSaleLow": number,
  "estimatedSaleHigh": number,
  "maxBuyPrice": number,
  "suggestedTitle": string (80 characters max),
  "suggestedDescription": string,
  "keywords": string[],
  "rationale": string,
  "checks": string[],
  "confidence": number 0-1,
  "depop": {
    "description": string,
    "hashtags": string[],
    "category": string,
    "brand": string,
    "size": string,
    "condition": ${DEPOP_CONDITIONS.map((c) => `"${c}"`).join('|')},
    "colors": string[],
    "styleTags": string[],
    "material": string,
    "listPrice": number,
    "minOfferPrice": number,
    "measurements": string[],
    "photoTips": string[]
  }
}

"depop" is a ready-to-paste Depop listing for reselling this item:
- description: Depop style, under 1000 characters. First line: brand + item + standout feature + size. Then short lines on condition, fit, material and era/style, then a "Measurements:" line with blanks to fill in (e.g. "Pit to pit __in · Length __in"). No hashtags in the description.
- hashtags: up to 5 lowercase search tags without "#".
- category: how Depop buyers browse, e.g. "Men > Coats & Jackets > Jackets".
- colors: up to 2. styleTags: up to 3 (e.g. Vintage, Streetwear, Y2K, Workwear, Outdoor, 90s).
- listPrice: the price to list at on Depop, leaving room for offers. minOfferPrice: the lowest offer worth accepting.
- measurements: which measurements to take for this kind of item. photoTips: 3-5 short tips on which photos to take.

Keep the descriptions factual. Mention flaws only if provided or clearly visible. Never imply authenticity is guaranteed.`;
}

// Your own photo (data URL) and/or listing photos (https URLs); a few angles help condition checks.
function modelImages(item) {
  const all = [item.image, ...(Array.isArray(item.images) ? item.images : [])]
    .filter((image) => typeof image === 'string' && (image.startsWith('data:image/') || image.startsWith('https://')));
  return [...new Set(all)].slice(0, 4);
}

const clients = new Map();
function openaiClient(apiKey, timeout = OPENAI_TIMEOUT_MS) {
  const cacheKey = `${apiKey}:${timeout}`;
  if (!clients.has(cacheKey)) {
    clients.clear(); // only ever keep the current key around
    clients.set(cacheKey, new OpenAI({ apiKey, timeout, maxRetries: 1 }));
  }
  return clients.get(cacheKey);
}

async function analyzeOpenAI(item, config) {
  if (!config.openaiApiKey) {
    return { ...fallbackAnalysis(item), warning: 'No OpenAI API key yet — add one in Settings.' };
  }
  const content = [{ type: 'input_text', text: promptFor(item) }];
  for (const image of modelImages(item)) content.push({ type: 'input_image', image_url: image, detail: 'auto' });
  const response = await openaiClient(config.openaiApiKey).responses.create({
    model: config.openaiModel,
    input: [{ role: 'user', content }],
    text: { format: { type: 'json_schema', name: 'flip_analysis', schema: analysisSchema, strict: true } }
  });
  return { ...extractJson(response.output_text), mode: 'openai', model: config.openaiModel };
}

async function base64Image(image) {
  if (image.startsWith('data:image/')) return image.split(',')[1];
  const res = await fetch(image, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Could not download the listing photo (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > 8 * 1024 * 1024) throw new Error('Listing photo is too large');
  return buffer.toString('base64');
}

async function analyzeOllama(item, config) {
  const [mainImage] = modelImages(item);
  const body = {
    model: config.ollamaModel,
    stream: false,
    format: 'json',
    messages: [{
      role: 'user',
      content: promptFor(item),
      ...(mainImage ? { images: [await base64Image(mainImage)] } : {})
    }]
  };
  const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Ollama error ${response.status}`);
  const data = await response.json();
  return { ...extractJson(data.message?.content), mode: 'ollama', model: config.ollamaModel };
}

function friendlyError(error) {
  if (error instanceof OpenAI.APIConnectionTimeoutError || error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return 'The AI provider took too long to respond.';
  }
  if (error instanceof OpenAI.APIConnectionError) return 'Could not reach OpenAI. Check the server\'s internet connection.';
  if (error?.status === 401) return 'The OpenAI API key was rejected (401). Check it in Settings.';
  if (error?.status === 404) return 'The model was not found (404). Check the model name in Settings.';
  if (error?.status === 429) return 'OpenAI rate limit or quota reached (429).';
  if (error?.cause?.code === 'ECONNREFUSED') return 'Could not reach the AI server (connection refused). Is it running?';
  return error?.message || 'Unknown AI error';
}

export async function analyzeItem(item) {
  const config = await resolveAiConfig();
  let raw;
  try {
    if (config.provider === 'ollama') raw = await analyzeOllama(item, config);
    else if (config.provider === 'demo') raw = fallbackAnalysis(item);
    else raw = await analyzeOpenAI(item, config);
  } catch (error) {
    raw = { ...fallbackAnalysis(item), mode: 'demo-fallback', warning: friendlyError(error) };
  }
  return normalizeAnalysis(raw, item);
}

// Checks credentials/reachability without spending tokens on a generation.
export async function testConnection(overrides = {}) {
  const config = await resolveAiConfig(overrides);
  const started = Date.now();
  try {
    if (config.provider === 'demo') {
      return { ok: true, provider: 'demo', message: 'Demo scorer is built in — no connection needed.' };
    }
    if (config.provider === 'ollama') {
      const response = await fetch(`${config.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`Ollama responded with ${response.status}`);
      const { models = [] } = await response.json();
      const names = models.map((model) => model.name);
      const found = names.some((name) => name === config.ollamaModel || name === `${config.ollamaModel}:latest`);
      return {
        ok: found,
        provider: 'ollama',
        latencyMs: Date.now() - started,
        message: found
          ? `Connected to Ollama — ${config.ollamaModel} is installed.`
          : `Connected to Ollama, but ${config.ollamaModel} is not pulled yet. Run: ollama pull ${config.ollamaModel}`
      };
    }
    if (!config.openaiApiKey) return { ok: false, provider: 'openai', message: 'Add an OpenAI API key first.' };
    await openaiClient(config.openaiApiKey, TEST_TIMEOUT_MS).models.retrieve(config.openaiModel);
    return {
      ok: true,
      provider: 'openai',
      latencyMs: Date.now() - started,
      message: `Key accepted — ${config.openaiModel} is available.`
    };
  } catch (error) {
    return { ok: false, provider: config.provider, message: friendlyError(error) };
  }
}
