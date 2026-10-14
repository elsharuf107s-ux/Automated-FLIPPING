import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyzeItem, testConnection } from './lib/ai.js';
import { publicAiConfig, saveAiConfig, validateAiPatch } from './lib/config.js';
import { scrapeProduct, mergeScrapedItem } from './lib/scraper.js';
import { startHuntJob, getHuntJob } from './lib/hunt.js';
import { getSettings, saveSettings } from './lib/settings.js';
import {
  browserAgentStatus,
  createSupplierVerificationTask,
  getBrowserAgentTask,
  heartbeatBrowserBridge,
  claimBrowserAgentTask,
  completeBrowserAgentTask,
  failBrowserAgentTask
} from './lib/browser-agent.js';
import { httpError } from './lib/errors.js';

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

app.get('/api/health', async (_req, res) => {
  const ai = await publicAiConfig();
  res.json({
    ok: true,
    app: 'FlipLab',
    version: pkg.version,
    aiProvider: 'openai',
    aiConfigured: ai.configured,
    ai,
    browserAgent: browserAgentStatus().bridge
  });
});

// AI Hunt runs as a short-lived server job so Codespaces/reverse proxies never
// have to keep one HTTP request open during web search + supplier matching.
app.post('/api/hunt', async (req, res) => {
  res.status(202).json(await startHuntJob(req.body?.prompt));
});

app.get('/api/hunt/:id', (req, res) => {
  const job = getHuntJob(req.params.id);
  if (!job) throw httpError(404, 'AI Hunt job expired or was not found. Run the hunt again.');
  res.json(job);
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
      item = {
        ...item,
        notes: [item.notes, `Web scrape warning: ${error.message}`].filter(Boolean).join('\n\n').slice(0, 4000)
      };
    }
  }

  if (!item.title && !item.brand && !item.category && !item.image) {
    throw httpError(400, 'Add a title, category, photo, or Source URL first.');
  }

  const analysis = await analyzeItem(item);
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

// Browser Agent v1 is deliberately narrow: a local Playwright process may only
// verify supplier pages. It cannot buy, message, publish, control Depop, or bypass
// access controls. The bridge normally reaches this API through a private
// `gh codespace ports forward` tunnel rather than a public Codespaces port.
app.get('/api/agent/status', (_req, res) => {
  res.json(browserAgentStatus());
});

app.post('/api/agent/verify', (req, res) => {
  res.status(202).json(createSupplierVerificationTask(req.body || {}));
});

app.get('/api/agent/tasks/:id', (req, res) => {
  const task = getBrowserAgentTask(req.params.id);
  if (!task) throw httpError(404, 'Browser Agent task expired or was not found.');
  res.json(task);
});

app.post('/api/agent/bridge/heartbeat', (req, res) => {
  res.json(heartbeatBrowserBridge(req.body || {}));
});

app.post('/api/agent/bridge/claim', (req, res) => {
  const task = claimBrowserAgentTask(req.body || {});
  if (!task) return res.status(204).end();
  res.json(task);
});

app.post('/api/agent/tasks/:id/complete', (req, res) => {
  res.status(202).json(completeBrowserAgentTask(req.params.id, req.body || {}));
});

app.post('/api/agent/tasks/:id/fail', (req, res) => {
  res.json(failBrowserAgentTask(req.params.id, req.body || {}));
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
  res.json(await testConnection(draft));
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
    console.log(`FlipLab running on http://${host}:${server.address().port}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  start();
}
