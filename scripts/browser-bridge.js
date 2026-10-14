#!/usr/bin/env node
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const VERSION = '1.0.0';
const args = process.argv.slice(2);

function arg(name, fallback = '') {
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
}

const has = (name) => args.includes(name);
const server = String(arg('--server', process.env.FLIPLAB_SERVER || 'http://127.0.0.1:3000')).replace(/\/+$/, '');
const cdpUrl = arg('--cdp', process.env.FLIPLAB_CDP_URL || '');
const profileDir = path.resolve(arg('--profile', process.env.FLIPLAB_BROWSER_PROFILE || path.join(os.homedir(), '.fliplab', 'browser-profile')));
const bridgeId = arg('--bridge-id', process.env.FLIPLAB_BRIDGE_ID || `chromebook-${crypto.randomUUID().slice(0, 8)}`);
const headless = has('--headless');

const allowedHosts = ['aliexpress.com', 'aliexpress.us', 'dhgate.com'];
const blockedHosts = ['depop.com', 'temu.com'];
let stopping = false;
let browser = null;
let context = null;
let ownsContext = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hostMatches(hostname, base) {
  return hostname === base || hostname.endsWith(`.${base}`);
}

function assertAllowedUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid supplier URL'); }
  if (url.protocol !== 'https:') throw new Error('Only HTTPS supplier pages are allowed');
  const host = url.hostname.toLowerCase();
  if (blockedHosts.some((base) => hostMatches(host, base))) {
    throw new Error(hostMatches(host, 'depop.com') ? 'Depop browser control is disabled.' : 'Temu stays search-only in FlipLab.');
  }
  if (!allowedHosts.some((base) => hostMatches(host, base))) {
    throw new Error('Browser Agent v1 only verifies AliExpress and DHgate pages.');
  }
  return url;
}

async function requestJson(url, options = {}) {
  const response = await fetch(`${server}${url}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(options.timeout || 20_000)
  });
  if (!response.ok) {
    let message = `FlipLab returned ${response.status}`;
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

const post = (url, body, timeout) => requestJson(url, { method: 'POST', body: JSON.stringify(body), timeout });

async function connectBrowser() {
  if (cdpUrl) {
    browser = await chromium.connectOverCDP(cdpUrl);
    context = browser.contexts()[0];
    if (!context) throw new Error('The CDP browser did not expose a browser context.');
    console.log(`[FlipLab Agent] Connected to existing Chromium via CDP: ${cdpUrl}`);
    return 'cdp';
  }

  context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: null,
    args: ['--disable-dev-shm-usage']
  });
  ownsContext = true;
  console.log(`[FlipLab Agent] Opened local Chromium with persistent profile: ${profileDir}`);
  return headless ? 'playwright-headless' : 'playwright-headed';
}

async function heartbeat(mode) {
  return post('/api/agent/bridge/heartbeat', { bridgeId, mode, version: VERSION }, 10_000);
}

async function parseJsonLd(page) {
  const raw = await page.locator('script[type="application/ld+json"]').allTextContents().catch(() => []);
  const out = [];
  for (const text of raw.slice(0, 20)) {
    try { out.push(JSON.parse(text)); } catch {}
  }
  return out;
}

async function collectObservation(page, requestedUrl) {
  await page.waitForTimeout(1200);
  await page.waitForLoadState('networkidle', { timeout: 4500 }).catch(() => {});

  const finalUrl = page.url();
  assertAllowedUrl(finalUrl);

  const title = await page.title().catch(() => '');
  const description = await page.locator('meta[name="description"]').getAttribute('content').catch(() => '') || '';
  const visibleText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
  const jsonLd = await parseJsonLd(page);
  const controls = await page.evaluate(() => {
    const text = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const selects = [...document.querySelectorAll('select')].slice(0, 40).map((el) => ({
      kind: 'select',
      label: text(el.getAttribute('aria-label') || el.name || el.id || el.closest('label')?.textContent),
      options: [...el.options].map((option) => text(option.textContent)).filter(Boolean).slice(0, 40)
    }));
    const buttons = [...document.querySelectorAll('button,[role="button"]')].slice(0, 80).map((el) => ({
      kind: 'button',
      label: text(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent),
      options: []
    })).filter((entry) => entry.label);
    return [...selects, ...buttons].slice(0, 120);
  }).catch(() => []);

  const images = await page.evaluate(() => [...document.images]
    .filter((img) => img.currentSrc || img.src)
    .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight))
    .slice(0, 20)
    .map((img) => ({ src: img.currentSrc || img.src, alt: img.alt || '' })))
    .catch(() => []);

  const warnings = [];
  const lower = visibleText.toLowerCase();
  if (/captcha|verify you are human|security verification|unusual traffic/.test(lower)) warnings.push('The supplier page displayed a bot/human verification challenge. FlipLab did not bypass it.');
  if (/sign in|log in|login/.test(lower) && visibleText.length < 5000) warnings.push('The page may require a signed-in supplier account before full details are visible.');
  if (requestedUrl !== finalUrl) warnings.push('The supplier page redirected before capture.');

  return {
    finalUrl,
    title,
    description,
    visibleText: visibleText.slice(0, 80_000),
    jsonLd,
    controls,
    images,
    warnings,
    capturedAt: new Date().toISOString()
  };
}

async function verifySupplier(task) {
  const url = String(task.payload?.url || task.url || '');
  assertAllowedUrl(url);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(45_000);

  try {
    console.log(`[FlipLab Agent] Verifying ${task.source}: ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    } catch (error) {
      if (!page.url() || page.url() === 'about:blank') throw error;
      console.warn(`[FlipLab Agent] Navigation warning: ${error.message}`);
    }
    const observation = await collectObservation(page, url);
    await post(`/api/agent/tasks/${encodeURIComponent(task.id)}/complete`, {
      bridgeId,
      claimToken: task.claimToken,
      observation
    }, 20_000);
    console.log(`[FlipLab Agent] Captured ${task.source}; FlipLab AI is structuring the result.`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function failTask(task, error) {
  console.error(`[FlipLab Agent] Task failed: ${error.message}`);
  try {
    await post(`/api/agent/tasks/${encodeURIComponent(task.id)}/fail`, {
      bridgeId,
      claimToken: task.claimToken,
      error: error.message
    }, 10_000);
  } catch (reportError) {
    console.error(`[FlipLab Agent] Could not report failure: ${reportError.message}`);
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\n[FlipLab Agent] Stopping…');
  if (ownsContext) await context?.close().catch(() => {});
  // In CDP mode we are attached to someone else's browser. Let process exit
  // without sending Browser.close so the user's existing Chrome/Chromium stays open.
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  console.log(`[FlipLab Agent] Server: ${server}`);
  console.log('[FlipLab Agent] Policy: supplier verification only · no purchases · no messages · no Depop control · no CAPTCHA bypass');
  const mode = await connectBrowser();
  await heartbeat(mode);
  console.log(`[FlipLab Agent] Connected as ${bridgeId}. Waiting for tasks…`);

  let lastHeartbeat = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastHeartbeat > 5000) {
        await heartbeat(mode);
        lastHeartbeat = Date.now();
      }
      const task = await post('/api/agent/bridge/claim', { bridgeId, mode, version: VERSION }, 10_000);
      if (!task) {
        await sleep(900);
        continue;
      }
      if (task.type !== 'verify_supplier') throw new Error(`Unsupported task type: ${task.type}`);
      try { await verifySupplier(task); } catch (error) { await failTask(task, error); }
    } catch (error) {
      console.error(`[FlipLab Agent] ${error.message}`);
      await sleep(2500);
    }
  }
}

main().catch((error) => {
  console.error(`[FlipLab Agent] Fatal: ${error.stack || error.message}`);
  process.exit(1);
});
