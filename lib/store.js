import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const seed = {
  items: [],
  settings: {
    marketplaceFeePercent: 0,
    paymentFeePercent: 3.3,
    defaultOutboundShipping: 0,
    targetRoiPercent: 75
  }
};

async function ensureDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify(seed, null, 2));
  }
}

export async function readDb() {
  await ensureDb();
  const raw = await fs.readFile(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

export async function writeDb(db) {
  await ensureDb();
  const tmp = `${DB_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, DB_FILE);
}

export async function listItems() {
  const db = await readDb();
  return db.items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function createItem(input) {
  const db = await readDb();
  const now = new Date().toISOString();
  const item = {
    id: crypto.randomUUID(),
    status: 'watching',
    source: 'manual',
    title: '',
    brand: '',
    category: '',
    size: '',
    sourceUrl: '',
    image: '',
    purchasePrice: 0,
    inboundShipping: 0,
    repairCost: 0,
    targetPrice: 0,
    outboundShipping: 0,
    marketplaceFeePercent: db.settings.marketplaceFeePercent,
    paymentFeePercent: db.settings.paymentFeePercent,
    notes: '',
    ai: null,
    createdAt: now,
    updatedAt: now,
    ...input
  };
  db.items.unshift(item);
  await writeDb(db);
  return item;
}

export async function updateItem(id, patch) {
  const db = await readDb();
  const index = db.items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  db.items[index] = {
    ...db.items[index],
    ...patch,
    id,
    updatedAt: new Date().toISOString()
  };
  await writeDb(db);
  return db.items[index];
}

export async function deleteItem(id) {
  const db = await readDb();
  const before = db.items.length;
  db.items = db.items.filter((item) => item.id !== id);
  if (before === db.items.length) return false;
  await writeDb(db);
  return true;
}

export async function getSettings() {
  const db = await readDb();
  return db.settings;
}

export async function saveSettings(patch) {
  const db = await readDb();
  db.settings = { ...db.settings, ...patch };
  await writeDb(db);
  return db.settings;
}
