import fs from 'node:fs/promises';
import { AI_CONFIG_FILE, DATA_DIR } from './paths.js';
import { httpError } from './errors.js';

export const PROVIDERS = ['openai', 'ollama', 'demo'];

const DEFAULTS = {
  provider: 'openai',
  openaiApiKey: '',
  openaiModel: 'gpt-6-luna',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5vl:3b',
  ebayClientId: '',
  ebayClientSecret: '',
  ebayMarketplace: 'EBAY_US'
};

const ENV_NAMES = {
  provider: 'AI_PROVIDER',
  openaiApiKey: 'OPENAI_API_KEY',
  openaiModel: 'OPENAI_MODEL',
  ollamaBaseUrl: 'OLLAMA_BASE_URL',
  ollamaModel: 'OLLAMA_MODEL',
  ebayClientId: 'EBAY_CLIENT_ID',
  ebayClientSecret: 'EBAY_CLIENT_SECRET',
  ebayMarketplace: 'EBAY_MARKETPLACE_ID'
};

// Values saved from the Settings screen (AI provider + eBay keys) live in
// data/ai-config.json (mode 600, git-ignored).
// A saved value wins over the matching environment variable; clearing it falls back to the env.
let saved = null;
let queue = Promise.resolve();

async function loadSaved() {
  if (saved) return saved;
  try {
    const parsed = JSON.parse(await fs.readFile(AI_CONFIG_FILE, 'utf8'));
    saved = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    saved = {};
  }
  return saved;
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'none') return 'demo';
  return PROVIDERS.includes(provider) ? provider : 'openai';
}

export function maskKey(key) {
  if (!key) return '';
  if (key.length <= 12) return '••••';
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

export async function resolveAiConfig(overrides = {}) {
  const app = await loadSaved();
  const config = {};
  const sources = {};
  for (const [key, envName] of Object.entries(ENV_NAMES)) {
    const override = typeof overrides[key] === 'string' ? overrides[key].trim() : '';
    const appValue = typeof app[key] === 'string' ? app[key].trim() : '';
    const envValue = (process.env[envName] || '').trim();
    if (override) [config[key], sources[key]] = [override, 'draft'];
    else if (appValue) [config[key], sources[key]] = [appValue, 'app'];
    else if (envValue) [config[key], sources[key]] = [envValue, 'env'];
    else [config[key], sources[key]] = [DEFAULTS[key], DEFAULTS[key] ? 'default' : null];
  }
  config.provider = normalizeProvider(config.provider);
  config.ollamaBaseUrl = config.ollamaBaseUrl.replace(/\/+$/, '');
  return { ...config, sources };
}

export async function publicAiConfig() {
  const config = await resolveAiConfig();
  const configured = config.provider === 'ollama' || (config.provider === 'openai' && Boolean(config.openaiApiKey));
  return {
    provider: config.provider,
    configured,
    model: config.provider === 'ollama' ? config.ollamaModel : config.provider === 'openai' ? config.openaiModel : 'local scorer',
    openai: {
      keySet: Boolean(config.openaiApiKey),
      keyPreview: maskKey(config.openaiApiKey),
      model: config.openaiModel
    },
    ollama: {
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel
    },
    ebay: {
      configured: Boolean(config.ebayClientId && config.ebayClientSecret),
      clientIdPreview: maskKey(config.ebayClientId),
      secretSet: Boolean(config.ebayClientSecret),
      marketplace: config.ebayMarketplace
    },
    sources: config.sources
  };
}

function cleanModel(value) {
  const model = String(value ?? '').trim();
  if (model.length > 120 || /\s/.test(model)) throw httpError(400, 'Model names cannot contain spaces.');
  return model;
}

export function validateAiPatch(patch = {}) {
  const next = {};
  if ('provider' in patch) {
    const provider = String(patch.provider ?? '').trim().toLowerCase();
    if (provider && !PROVIDERS.includes(provider)) throw httpError(400, `Unknown AI provider "${provider}"`);
    next.provider = provider;
  }
  if ('openaiApiKey' in patch) {
    const key = String(patch.openaiApiKey ?? '').trim();
    if (key && (key.length < 20 || key.length > 400 || /\s/.test(key))) {
      throw httpError(400, 'That does not look like a valid OpenAI API key.');
    }
    next.openaiApiKey = key;
  }
  for (const key of ['ebayClientId', 'ebayClientSecret']) {
    if (!(key in patch)) continue;
    const value = String(patch[key] ?? '').trim();
    if (value && !/^[\w.:-]{8,200}$/.test(value)) {
      throw httpError(400, `That does not look like a valid eBay ${key === 'ebayClientId' ? 'Client ID (App ID)' : 'Client Secret (Cert ID)'}.`);
    }
    next[key] = value;
  }
  if ('ebayMarketplace' in patch) {
    const marketplace = String(patch.ebayMarketplace ?? '').trim().toUpperCase();
    if (marketplace && !/^EBAY_[A-Z]{2,3}$/.test(marketplace)) throw httpError(400, 'Marketplace looks like EBAY_US, EBAY_GB, EBAY_DE…');
    next.ebayMarketplace = marketplace;
  }
  if ('openaiModel' in patch) next.openaiModel = cleanModel(patch.openaiModel);
  if ('ollamaModel' in patch) next.ollamaModel = cleanModel(patch.ollamaModel);
  if ('ollamaBaseUrl' in patch) {
    const url = String(patch.ollamaBaseUrl ?? '').trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\/\S+$/i.test(url)) throw httpError(400, 'Ollama URL must start with http:// or https://');
    next.ollamaBaseUrl = url;
  }
  return next;
}

export function saveAiConfig(patch = {}) {
  const run = queue.then(async () => {
    const next = { ...(await loadSaved()), ...validateAiPatch(patch) };
    // An empty value means "use the environment variable or default" again.
    for (const key of Object.keys(next)) if (!next[key] || !(key in ENV_NAMES)) delete next[key];
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${AI_CONFIG_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await fs.rename(tmp, AI_CONFIG_FILE);
    await fs.chmod(AI_CONFIG_FILE, 0o600).catch(() => {});
    saved = next;
    return publicAiConfig();
  });
  queue = run.catch(() => {});
  return run;
}
