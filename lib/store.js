import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, DB_FILE, UPLOADS_DIR } from './paths.js';
import { httpError } from './errors.js';

export const STATUSES = ['watching', 'bought', 'listed', 'sold', 'passed'];

export const DEFAULT_SETTINGS = {
  marketplaceFeePercent: 0,
  paymentFeePercent: 3.3,
  defaultOutboundShipping: 0,
  targetRoiPercent: 75
};

const TEXT_FIELDS = { title: 140, brand: 80, category: 80, size: 40, condition: 40, source: 60, sourceUrl: 500, notes: 4000 };
const MONEY_FIELDS = ['purchasePrice', 'inboundShipping', 'repairCost', 'targetPrice', 'outboundShipping', 'soldPrice'];
const PERCENT_FIELDS = ['marketplaceFeePercent', 'paymentFeePercent'];
const DATE_FIELDS = ['boughtAt', 'listedAt', 'soldAt'];
const IMAGE_PATTERN = /^data:image\/(jpeg|jpg|png|webp|gif);base64,([a-z0-9+/=\s]+)$/i;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

// The whole database is small (images live on disk), so it is cached in memory and
// every write goes through a single queue. That keeps reads instant and stops two
// quick edits from overwriting each other.
let db = null;
let loading = null;
let queue = Promise.resolve();

function cleanNumber(value, min = 0, max = 10_000_000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function cleanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanAi(ai) {
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return null;
  const json = JSON.stringify(ai);
  return json.length > 20_000 ? null : JSON.parse(json);
}

function sanitizeItemFields(input) {
  const out = {};
  for (const [key, max] of Object.entries(TEXT_FIELDS)) if (key in input) out[key] = cleanText(input[key], max);
  for (const key of MONEY_FIELDS) if (key in input) out[key] = cleanNumber(input[key]);
  for (const key of PERCENT_FIELDS) if (key in input) out[key] = cleanNumber(input[key], 0, 100);
  for (const key of DATE_FIELDS) if (key in input) out[key] = cleanDate(input[key]);
  if ('ai' in input) out.ai = cleanAi(input.ai);
  if ('status' in input) {
    if (!STATUSES.includes(input.status)) throw httpError(400, `Unknown status "${input.status}"`);
    out.status = input.status;
  }
  if (out.sourceUrl && !/^https?:\/\//i.test(out.sourceUrl)) {
    throw httpError(400, 'Source URL must start with http:// or https://');
  }
  return out;
}

function stampStatus(item, previousStatus, now) {
  if (item.status === previousStatus) return;
  const key = `${item.status}At`;
  if (DATE_FIELDS.includes(key) && !item[key]) item[key] = now;
}

async function storeImage(id, dataUrl) {
  const match = IMAGE_PATTERN.exec(dataUrl);
  if (!match) throw httpError(400, 'Unsupported image format. Use JPG, PNG, WEBP or GIF.');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) throw httpError(413, 'Image is too large');
  const type = match[1].toLowerCase();
  const name = `${id}-${Date.now().toString(36)}.${type === 'jpeg' ? 'jpg' : type}`;
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOADS_DIR, name), buffer);
  return `/uploads/${name}`;
}

async function removeImage(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
  await fs.rm(path.join(UPLOADS_DIR, path.basename(url)), { force: true });
}

export async function imageAsDataUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  if (url.startsWith('data:image/')) return url;
  if (!url.startsWith('/uploads/')) return '';
  const name = path.basename(url.split('?')[0]);
  try {
    const buffer = await fs.readFile(path.join(UPLOADS_DIR, name));
    const ext = path.extname(name).slice(1);
    return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buffer.toString('base64')}`;
  } catch {
    return '';
  }
}

async function persist(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, DB_FILE);
}

async function readFromDisk() {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { data: { items: [], settings: { ...DEFAULT_SETTINGS } }, dirty: true };
    if (!(error instanceof SyntaxError)) throw error;
    // Never silently throw away a damaged database: keep a copy next to it.
    const backup = `${DB_FILE}.corrupt-${Date.now()}`;
    await fs.copyFile(DB_FILE, backup);
    console.warn(`Could not parse ${DB_FILE}. A copy was saved to ${backup}; starting with an empty inventory.`);
    return { data: { items: [], settings: { ...DEFAULT_SETTINGS } }, dirty: true };
  }

  const data = {
    items: Array.isArray(raw.items) ? raw.items : [],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) }
  };
  let dirty = false;
  // Older versions stored photos inline as base64, which made every inventory load
  // ship megabytes of JSON. Move them to files once.
  for (const item of data.items) {
    if (typeof item.image === 'string' && item.image.startsWith('data:image/')) {
      try { item.image = await storeImage(item.id, item.image); } catch { item.image = ''; }
      dirty = true;
    }
  }
  return { data, dirty };
}

async function load() {
  if (db) return db;
  loading ??= readFromDisk()
    .then(async ({ data, dirty }) => {
      if (dirty) await persist(data);
      db = data;
      return db;
    })
    .finally(() => { loading = null; });
  return loading;
}

function mutate(change) {
  const run = queue.then(async () => {
    const draft = structuredClone(await load());
    const result = await change(draft);
    await persist(draft);
    db = draft;
    return result === undefined ? undefined : structuredClone(result);
  });
  queue = run.catch(() => {});
  return run;
}

export async function listItems() {
  const data = await load();
  return structuredClone(data.items).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function getItem(id) {
  const item = (await load()).items.find((entry) => entry.id === id);
  return item ? structuredClone(item) : null;
}

export function createItem(input = {}) {
  return mutate(async (data) => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const item = {
      id,
      status: 'watching',
      source: 'manual',
      title: '',
      brand: '',
      category: '',
      size: '',
      condition: '',
      sourceUrl: '',
      image: '',
      purchasePrice: 0,
      inboundShipping: 0,
      repairCost: 0,
      targetPrice: 0,
      outboundShipping: data.settings.defaultOutboundShipping,
      marketplaceFeePercent: data.settings.marketplaceFeePercent,
      paymentFeePercent: data.settings.paymentFeePercent,
      soldPrice: 0,
      boughtAt: null,
      listedAt: null,
      soldAt: null,
      notes: '',
      ai: null,
      ...sanitizeItemFields(input),
      createdAt: now,
      updatedAt: now
    };
    stampStatus(item, null, now);
    if (typeof input.image === 'string' && input.image.startsWith('data:image/')) {
      item.image = await storeImage(id, input.image);
    }
    data.items.unshift(item);
    return item;
  });
}

export async function updateItem(id, patch = {}) {
  let replacedImage = null;
  const item = await mutate(async (data) => {
    const target = data.items.find((entry) => entry.id === id);
    if (!target) return null;
    const now = new Date().toISOString();
    const previousStatus = target.status;
    Object.assign(target, sanitizeItemFields(patch), { updatedAt: now });
    stampStatus(target, previousStatus, now);
    if ('image' in patch) {
      if (typeof patch.image === 'string' && patch.image.startsWith('data:image/')) {
        replacedImage = target.image;
        target.image = await storeImage(id, patch.image);
      } else if (!patch.image) {
        replacedImage = target.image;
        target.image = '';
      }
    }
    return target;
  });
  if (replacedImage) await removeImage(replacedImage);
  return item;
}

export async function deleteItem(id) {
  let image = null;
  const deleted = await mutate(async (data) => {
    const index = data.items.findIndex((entry) => entry.id === id);
    if (index === -1) return false;
    image = data.items[index].image;
    data.items.splice(index, 1);
    return true;
  });
  if (deleted && image) await removeImage(image);
  return deleted;
}

export async function getSettings() {
  return structuredClone((await load()).settings);
}

export function saveSettings(patch = {}) {
  return mutate(async (data) => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!(key in patch)) continue;
      const max = key.endsWith('Percent') && key !== 'targetRoiPercent' ? 100 : 10_000;
      data.settings[key] = cleanNumber(patch[key], 0, max);
    }
    return data.settings;
  });
}
