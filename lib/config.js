import fs from 'node:fs/promises';
import { AI_CONFIG_FILE, DATA_DIR } from './paths.js';
import { httpError } from './errors.js';

const DEFAULTS = {
  openaiApiKey: '',
  openaiModel: 'gpt-6-luna'
};

const ENV_NAMES = {
  openaiApiKey: 'OPENAI_API_KEY',
  openaiModel: 'OPENAI_MODEL'
};

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
  return { ...config, provider: 'openai', sources };
}

export async function publicAiConfig() {
  const config = await resolveAiConfig();
  return {
    provider: 'openai',
    configured: Boolean(config.openaiApiKey),
    model: config.openaiModel,
    openai: {
      keySet: Boolean(config.openaiApiKey),
      keyPreview: maskKey(config.openaiApiKey),
      model: config.openaiModel
    },
    sources: config.sources
  };
}

function cleanModel(value) {
  const model = String(value ?? '').trim();
  if (!model) throw httpError(400, 'Enter an OpenAI model name.');
  if (model.length > 120 || /\s/.test(model)) throw httpError(400, 'Model names cannot contain spaces.');
  return model;
}

export function validateAiPatch(patch = {}) {
  const next = {};
  if ('provider' in patch && String(patch.provider || '').trim() && String(patch.provider).trim() !== 'openai') {
    throw httpError(400, 'FlipLab uses OpenAI for Hunt and listing generation.');
  }
  if ('openaiApiKey' in patch) {
    const key = String(patch.openaiApiKey ?? '').trim();
    if (key && (key.length < 20 || key.length > 400 || /\s/.test(key))) {
      throw httpError(400, 'That does not look like a valid OpenAI API key.');
    }
    next.openaiApiKey = key;
  }
  if ('openaiModel' in patch) next.openaiModel = cleanModel(patch.openaiModel);
  return next;
}

export function saveAiConfig(patch = {}) {
  const run = queue.then(async () => {
    const next = { ...(await loadSaved()), ...validateAiPatch(patch) };
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
