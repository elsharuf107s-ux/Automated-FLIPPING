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

const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'decision', 'demand', 'risk', 'estimatedSaleLow', 'estimatedSaleHigh', 'maxBuyPrice',
    'suggestedTitle', 'suggestedDescription', 'keywords', 'rationale', 'checks', 'confidence'],
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
    confidence: { type: 'number', description: '0-1' }
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

// Models occasionally return out-of-range numbers or loose casing. Normalise so the UI
// can always trust the shape of an analysis, whatever produced it.
export function normalizeAnalysis(raw, item = {}) {
  const low = Math.max(0, Math.round(money(raw.estimatedSaleLow)));
  const high = Math.max(low, Math.round(money(raw.estimatedSaleHigh, low)));
  let confidence = money(raw.confidence, 0.5);
  if (confidence > 1) confidence /= 100;
  return {
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
}

export function fallbackAnalysis(item) {
  const landed = money(item.purchasePrice) + money(item.inboundShipping) + money(item.repairCost);
  const target = money(item.targetPrice) || Math.max(landed * 2.15, landed + 25);
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
    suggestedTitle: [item.brand, item.title || item.category, item.size].filter(Boolean).join(' ').slice(0, 80) || 'Vintage resale item',
    suggestedDescription: `Pre-owned ${item.brand || ''} ${item.title || item.category || 'item'}${item.condition ? ` in ${item.condition.toLowerCase()} condition` : ''}. Review photos and measurements carefully. Add condition notes, measurements, material, and any flaws before publishing.`.replace(/\s+/g, ' '),
    keywords: [item.brand, item.category, 'vintage', 'resale'].filter(Boolean).slice(0, 8),
    rationale: 'Demo scoring uses your costs, target price, brand presence and listing completeness. Connect an AI provider in Settings for visual analysis and richer recommendations.',
    checks: ['Verify condition and measurements', 'Check authenticity for branded items', 'Compare against real sold listings before buying'],
    confidence: 0.45
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
  "confidence": number 0-1
}

Keep the description factual. Mention flaws only if provided or clearly visible. Never imply authenticity is guaranteed.`;
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
  if (item.image?.startsWith('data:image/')) {
    content.push({ type: 'input_image', image_url: item.image, detail: 'auto' });
  }
  const response = await openaiClient(config.openaiApiKey).responses.create({
    model: config.openaiModel,
    input: [{ role: 'user', content }],
    text: { format: { type: 'json_schema', name: 'flip_analysis', schema: analysisSchema, strict: true } }
  });
  return { ...extractJson(response.output_text), mode: 'openai', model: config.openaiModel };
}

async function analyzeOllama(item, config) {
  const body = {
    model: config.ollamaModel,
    stream: false,
    format: 'json',
    messages: [{
      role: 'user',
      content: promptFor(item),
      ...(item.image?.startsWith('data:image/') ? { images: [item.image.split(',')[1]] } : {})
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
