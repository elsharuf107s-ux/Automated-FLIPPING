import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyzeItem, testConnection } from './lib/ai.js';
import { searchListings, getListing, testEbay } from './lib/ebay.js';
import { analyzeListing } from './lib/finder.js';
import { publicAiConfig, saveAiConfig, validateAiPatch } from './lib/config.js';
import { scrapeProduct, mergeScrapedItem } from './lib/scraper.js';
import { UPLOADS_DIR } from './lib/paths.js';
import { httpError } from './lib/errors.js';
import {
  listItems, getItem, createItem, updateItem, deleteItem, getSettings, saveSettings, imageAsDataUrl,
  listSearches, createSearch, deleteSearch
} from './lib/store.js';
import { calc } from './public/js/econ.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

export const app = express();

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR, { immutable: true, maxAge: '365d', fallthrough: false }));

app.get('/api/health', async (_req, res) => {
  const ai = await publicAiConfig();
  res.json({ ok: true, app: 'Automated Flipping', version: pkg.version, aiProvider: ai.provider, aiConfigured: ai.configured, ai });
});

app.get('/api/items', async (_req, res) => {
  res.json(await listItems());
});

app.get('/api/items/:id', async (req, res) => {
  const item = await getItem(req.params.id);
  if (!item) throw httpError(404, 'Item not found');
  res.json(item);
});

app.post('/api/items', async (req, res) => {
  res.status(201).json(await createItem(req.body || {}));
});

app.patch('/api/items/:id', async (req, res) => {
  const item = await updateItem(req.params.id, req.body || {});
  if (!item) throw httpError(404, 'Item not found');
  res.json(item);
});

app.delete('/api/items/:id', async (req, res) => {
  if (!(await deleteItem(req.params.id))) throw httpError(404, 'Item not found');
  res.status(204).end();
});

app.post('/api/items/:id/analyze', async (req, res) => {
  const item = await getItem(req.params.id);
  if (!item) throw httpError(404, 'Item not found');
  let enriched = { ...item, image: await imageAsDataUrl(item.image) };
  let scrape = null;
  if (item.sourceUrl) {
    try {
      scrape = await scrapeProduct(item.sourceUrl);
      enriched = mergeScrapedItem(enriched, scrape);
    } catch (error) {
      enriched.notes = [enriched.notes, `Web scrape warning: ${error.message}`].filter(Boolean).join('\n\n').slice(0, 4000);
    }
  }
  const ai = await analyzeItem(enriched);
  if (scrape) ai.webScrape = { engine: scrape.engine, model: scrape.model, scrapedAt: scrape.scrapedAt, product: scrape.product };
  res.json(await updateItem(item.id, { ai }));
});

app.post('/api/scrape', async (req, res) => {
  const url = String(req.body?.url || req.body?.sourceUrl || '').trim();
  if (!url) throw httpError(400, 'Provide a product/listing URL.');
  res.json(await scrapeProduct(url));
});

app.post('/api/analyze', async (req, res) => {
  let item = req.body || {};
  let scrape = null;

  if (item.sourceUrl) {
    try {
      scrape = await scrapeProduct(item.sourceUrl);
      item = mergeScrapedItem(item, scrape);
    } catch (error) {
      const hasManualInput = item.title || item.brand || item.category || item.image;
      if (!hasManualInput) throw error;
      item = { ...item, notes: [item.notes, `Web scrape warning: ${error.message}`].filter(Boolean).join('\n\n').slice(0, 4000) };
    }
  }

  if (!item.title && !item.brand && !item.category && !item.image) {
    throw httpError(400, 'Add a title, brand, category, photo, or Source URL first.');
  }

  const analysis = await analyzeItem({ ...item, image: await imageAsDataUrl(item.image) });
  if (scrape) {
    analysis.webScrape = {
      engine: scrape.engine,
      model: scrape.model,
      scrapedAt: scrape.scrapedAt,
      sourceUrl: scrape.sourceUrl,
      product: scrape.product
    };
  }
  res.json(analysis);
});

app.get('/api/settings', async (_req, res) => {
  res.json(await getSettings());
});

app.patch('/api/settings', async (req, res) => {
  res.json(await saveSettings(req.body || {}));
});

app.get('/api/ai-config', async (_req, res) => {
  res.json(await publicAiConfig());
});

app.patch('/api/ai-config', async (req, res) => {
  res.json(await saveAiConfig(req.body || {}));
});

app.post('/api/ai-config/test', async (req, res) => {
  const draft = validateAiPatch(req.body || {});
  res.json(req.body?.target === 'ebay' ? await testEbay(draft) : await testConnection(draft));
});

app.post('/api/finder/search', async (req, res) => {
  res.json(await searchListings(req.body || {}));
});

app.get('/api/finder/listings/:id', async (req, res) => {
  res.json(await getListing(req.params.id));
});

app.post('/api/finder/analyze', async (req, res) => {
  const { id, market } = req.body || {};
  res.json(await analyzeListing(id, { median: Number(market?.median) || null }));
});

app.get('/api/finder/searches', async (_req, res) => {
  res.json(await listSearches());
});

app.post('/api/finder/searches', async (req, res) => {
  res.status(201).json(await createSearch(req.body || {}));
});

app.delete('/api/finder/searches/:id', async (req, res) => {
  if (!(await deleteSearch(req.params.id))) throw httpError(404, 'Saved search not found');
  res.status(204).end();
});

const CSV_COLUMNS = [
  'title', 'brand', 'category', 'size', 'condition', 'status', 'source', 'sourceUrl',
  'purchasePrice', 'inboundShipping', 'repairCost', 'landedCost', 'targetPrice', 'soldPrice',
  'outboundShipping', 'fees', 'profit', 'roiPercent', 'aiScore', 'aiDecision',
  'createdAt', 'boughtAt', 'listedAt', 'soldAt', 'notes'
];

function csvCell(value) {
  if (value == null) return '';
  if (typeof value === 'number') return String(Math.round(value * 100) / 100);
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

app.get('/api/export.csv', async (_req, res) => {
  const [items, settings] = await Promise.all([listItems(), getSettings()]);
  const rows = items.map((item) => {
    const c = calc(item, settings);
    const row = {
      ...item,
      landedCost: c.landed,
      fees: c.fees,
      profit: c.profit,
      roiPercent: c.roi,
      aiScore: item.ai?.score ?? null,
      aiDecision: item.ai?.decision ?? null
    };
    return CSV_COLUMNS.map((column) => csvCell(row[column])).join(',');
  });
  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="fliplab-inventory-${stamp}.csv"`);
  res.send(`﻿${[CSV_COLUMNS.join(','), ...rows].join('\r\n')}\r\n`);
});

app.get('/api/source-guides', (_req, res) => {
  res.json([
    { name: 'ShopGoodwill', url: 'https://shopgoodwill.com/', note: 'Auction inventory. Check shipping before bidding.', kind: 'Auctions' },
    { name: 'eBay', url: 'https://www.ebay.com/', note: 'Use sold/completed filters manually to verify comps.', kind: 'Comps + sourcing' },
    { name: 'Facebook Marketplace', url: 'https://www.facebook.com/marketplace/', note: 'Strong for local bundles and pickup deals.', kind: 'Local' },
    { name: 'Depop', url: 'https://www.depop.com/', note: 'Use for manual comp research and final listing. This app does not scrape or bot-post to Depop.', kind: 'Listing' }
  ]);
});

app.use('/api', () => {
  throw httpError(404, 'Not found');
});

app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  const status = error.status || error.statusCode || 500;
  if (status >= 500) console.error(error);
  let message = error.message || 'Unexpected server error';
  if (error.type === 'entity.too.large') message = 'That upload is too large.';
  if (error.type === 'entity.parse.failed') message = 'The request body was not valid JSON.';
  res.status(status).json({ error: message });
});

export function start(port = Number(process.env.PORT || 3000), host = '0.0.0.0') {
  const server = app.listen(port, host, () => {
    console.log(`Automated Flipping running on http://${host}:${server.address().port}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  start();
}
