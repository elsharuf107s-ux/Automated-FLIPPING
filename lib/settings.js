import fs from 'node:fs/promises';
import { DATA_DIR, SETTINGS_FILE } from './paths.js';

export const DEFAULT_SETTINGS = {
  marketplaceFeePercent: 0,
  paymentFeePercent: 3.3,
  defaultOutboundShipping: 0,
  targetRoiPercent: 75
};

let cached = null;
let queue = Promise.resolve();

function cleanNumber(value, min = 0, max = 10_000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(min, Math.round(number * 100) / 100));
}

async function load() {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
    cached = { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached;
}

export async function getSettings() {
  return structuredClone(await load());
}

export function saveSettings(patch = {}) {
  const run = queue.then(async () => {
    const next = { ...(await load()) };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!(key in patch)) continue;
      const max = key.endsWith('Percent') && key !== 'targetRoiPercent' ? 100 : 10_000;
      next[key] = cleanNumber(patch[key], 0, max);
    }
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${SETTINGS_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await fs.rename(tmp, SETTINGS_FILE);
    await fs.chmod(SETTINGS_FILE, 0o600).catch(() => {});
    cached = next;
    return structuredClone(next);
  });
  queue = run.catch(() => {});
  return run;
}
