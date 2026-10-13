import OpenAI from 'openai';

const trendSignals = [
  'outerwear and utility jackets',
  'baggy and relaxed denim',
  'Y2K occasionwear',
  'workwear',
  'technical outdoor clothing',
  '90s and 2000s sportswear',
  'whimsigoth and romantic vintage'
];

function money(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fallbackAnalysis(item) {
  const landed = money(item.purchasePrice) + money(item.inboundShipping) + money(item.repairCost);
  const target = money(item.targetPrice) || Math.max(landed * 2.15, landed + 25);
  const low = Math.max(5, Math.round(target * 0.82));
  const high = Math.max(low + 5, Math.round(target * 1.14));
  const profit = target - landed - money(item.outboundShipping) - target * ((money(item.marketplaceFeePercent) + money(item.paymentFeePercent)) / 100);
  const roi = landed > 0 ? (profit / landed) * 100 : 0;
  const score = Math.max(20, Math.min(95, Math.round(45 + Math.min(35, roi / 3) + (item.brand ? 8 : 0) + (item.image ? 7 : 0))));

  return {
    mode: 'demo',
    score,
    decision: score >= 78 ? 'BUY' : score >= 58 ? 'WATCH' : 'PASS',
    demand: score >= 78 ? 'high' : score >= 58 ? 'medium' : 'low',
    risk: item.brand ? 'medium' : 'high',
    estimatedSaleLow: low,
    estimatedSaleHigh: high,
    maxBuyPrice: Math.max(0, Math.round((low - money(item.outboundShipping)) / 2.2)),
    suggestedTitle: [item.brand, item.title || item.category, item.size].filter(Boolean).join(' ').slice(0, 80) || 'Vintage resale item',
    suggestedDescription: `Pre-owned ${item.brand || ''} ${item.title || item.category || 'item'}. Review photos and measurements carefully. Add condition notes, measurements, material, and any flaws before publishing.`,
    keywords: [item.brand, item.category, 'vintage', 'resale'].filter(Boolean).slice(0, 8),
    rationale: 'Demo scoring uses your costs, target price, brand presence and listing completeness. Add an AI provider for visual analysis and richer recommendations.',
    checks: ['Verify condition and measurements', 'Check authenticity for branded items', 'Compare against real sold listings before buying'],
    confidence: 0.45
  };
}

function extractJson(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
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
  "suggestedTitle": string,
  "suggestedDescription": string,
  "keywords": string[],
  "rationale": string,
  "checks": string[],
  "confidence": number 0-1
}

Keep the description factual. Mention flaws only if provided or clearly visible. Never imply authenticity is guaranteed.`;
}

async function analyzeOpenAI(item) {
  if (!process.env.OPENAI_API_KEY) return fallbackAnalysis(item);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const content = [{ type: 'input_text', text: promptFor(item) }];
  if (item.image?.startsWith('data:image/')) {
    content.push({ type: 'input_image', image_url: item.image, detail: 'auto' });
  }
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-6-luna',
    input: [{ role: 'user', content }]
  });
  return { ...extractJson(response.output_text), mode: 'openai' };
}

async function analyzeOllama(item) {
  const base = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const body = {
    model: process.env.OLLAMA_MODEL || 'qwen2.5vl:3b',
    stream: false,
    format: 'json',
    messages: [{
      role: 'user',
      content: promptFor(item),
      ...(item.image?.startsWith('data:image/') ? { images: [item.image.split(',')[1]] } : {})
    }]
  };
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Ollama error ${response.status}`);
  const data = await response.json();
  return { ...extractJson(data.message?.content), mode: 'ollama' };
}

export async function analyzeItem(item) {
  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  try {
    if (provider === 'ollama') return await analyzeOllama(item);
    if (provider === 'none' || provider === 'demo') return fallbackAnalysis(item);
    return await analyzeOpenAI(item);
  } catch (error) {
    return {
      ...fallbackAnalysis(item),
      mode: 'demo-fallback',
      warning: error.message
    };
  }
}
