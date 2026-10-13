import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeItem } from './lib/ai.js';
import { listItems, createItem, updateItem, deleteItem, getSettings, saveSettings } from './lib/store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(express.json({ limit: '7mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'Automated Flipping',
    port,
    aiProvider: process.env.AI_PROVIDER || 'openai',
    aiConfigured: Boolean(process.env.OPENAI_API_KEY) || (process.env.AI_PROVIDER || '').toLowerCase() === 'ollama'
  });
});

app.get('/api/items', async (_req, res, next) => {
  try { res.json(await listItems()); } catch (error) { next(error); }
});

app.post('/api/items', async (req, res, next) => {
  try { res.status(201).json(await createItem(req.body || {})); } catch (error) { next(error); }
});

app.patch('/api/items/:id', async (req, res, next) => {
  try {
    const item = await updateItem(req.params.id, req.body || {});
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (error) { next(error); }
});

app.delete('/api/items/:id', async (req, res, next) => {
  try {
    const deleted = await deleteItem(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Item not found' });
    res.status(204).end();
  } catch (error) { next(error); }
});

app.post('/api/analyze', async (req, res, next) => {
  try {
    const item = req.body || {};
    if (!item.title && !item.brand && !item.category && !item.image) {
      return res.status(400).json({ error: 'Add a title, brand, category, or photo first.' });
    }
    const analysis = await analyzeItem(item);
    res.json(analysis);
  } catch (error) { next(error); }
});

app.get('/api/settings', async (_req, res, next) => {
  try { res.json(await getSettings()); } catch (error) { next(error); }
});

app.patch('/api/settings', async (req, res, next) => {
  try { res.json(await saveSettings(req.body || {})); } catch (error) { next(error); }
});

app.get('/api/source-guides', (_req, res) => {
  res.json([
    { name: 'ShopGoodwill', url: 'https://shopgoodwill.com/', note: 'Auction inventory. Check shipping before bidding.' },
    { name: 'eBay', url: 'https://www.ebay.com/', note: 'Use sold/completed filters manually to verify comps.' },
    { name: 'Facebook Marketplace', url: 'https://www.facebook.com/marketplace/', note: 'Strong for local bundles and pickup deals.' },
    { name: 'Depop', url: 'https://www.depop.com/', note: 'Use for manual comp research and final listing. This app does not scrape or bot-post to Depop.' }
  ]);
});

app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Unexpected server error' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Automated Flipping running on http://0.0.0.0:${port}`);
});
