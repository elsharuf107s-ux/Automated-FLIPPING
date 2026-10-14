#!/usr/bin/env node
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const VERSION = '3.0.0';
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
    throw new Error('Browser Agent only browses approved supplier sites.');
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
  await page.waitForTimeout(900);
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});

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

const SITE = {
  AliExpress: {
    home: 'https://www.aliexpress.us/',
    isProduct: (url) => /\/item\//i.test(url.pathname) || /item\/.+\.html/i.test(url.pathname),
    fallback: (query) => `https://www.aliexpress.us/w/wholesale-${encodeURIComponent(query.trim().replace(/\s+/g, '-'))}.html`
  },
  DHgate: {
    home: 'https://www.dhgate.com/',
    isProduct: (url) => /\/product\//i.test(url.pathname),
    fallback: (query) => `https://www.dhgate.com/wholesale/search.do?searchkey=${encodeURIComponent(query)}`
  }
};

async function visibleSearchInput(page) {
  const locator = page.locator('input[type="search"], input[name*="search" i], input[placeholder*="search" i], input[aria-label*="search" i]');
  const count = Math.min(await locator.count().catch(() => 0), 12);
  for (let i = 0; i < count; i += 1) {
    const candidate = locator.nth(i);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function collectProductLinks(page, siteName, limit) {
  const config = SITE[siteName];
  const raw = await page.locator('a[href]').evaluateAll((links) => links.slice(0, 1800).map((a) => ({
    href: a.href,
    text: String(a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600)
  }))).catch(() => []);
  const seen = new Set();
  const results = [];
  for (const entry of raw) {
    if (!entry.href || seen.has(entry.href)) continue;
    let url;
    try { url = assertAllowedUrl(entry.href); } catch { continue; }
    if (!config.isProduct(url)) continue;
    seen.add(entry.href);
    results.push({ url: url.href, text: entry.text });
    if (results.length >= limit) break;
  }
  return results;
}

async function loadMoreResults(page) {
  for (let i = 0; i < 7; i += 1) {
    await page.mouse.wheel(0, 1100).catch(() => {});
    await page.waitForTimeout(450);
  }
}

async function nextResultsPage(page) {
  const before = page.url();
  const candidates = page.locator('a[aria-label*="next" i], button[aria-label*="next" i], a[title*="next" i], button[title*="next" i], a:has-text("Next"), button:has-text("Next")');
  const count = Math.min(await candidates.count().catch(() => 0), 12);
  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    const visible = await candidate.isVisible().catch(() => false);
    const disabled = await candidate.isDisabled?.().catch(() => false);
    if (!visible || disabled) continue;
    try {
      await candidate.click({ timeout: 4000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(700);
      if (page.url() !== before) {
        assertAllowedUrl(page.url());
        return true;
      }
    } catch {}
  }

  try {
    const url = new URL(before);
    const current = Number(url.searchParams.get('page') || 1);
    url.searchParams.set('page', String(current + 1));
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 35_000 });
    await page.waitForTimeout(700);
    assertAllowedUrl(page.url());
    return page.url() !== before;
  } catch {
    return false;
  }
}

async function searchSupplierSite(page, siteName, query, maxResults, maxPages) {
  const config = SITE[siteName];
  console.log(`[FlipLab Scout] ${siteName}: searching “${query}”`);
  await page.goto(config.home, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(900);

  let usedSearchBox = false;
  const input = await visibleSearchInput(page);
  if (input) {
    try {
      await input.click();
      await input.fill(query);
      await input.press('Enter');
      usedSearchBox = true;
      await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
    } catch (error) {
      console.warn(`[FlipLab Scout] ${siteName} search box failed; using search URL fallback: ${error.message}`);
    }
  }
  if (!usedSearchBox) {
    await page.goto(config.fallback(query), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  }

  const combined = new Map();
  let pagesVisited = 0;
  for (let pageIndex = 0; pageIndex < maxPages && !stopping; pageIndex += 1) {
    assertAllowedUrl(page.url());
    await loadMoreResults(page);
    const body = await page.locator('body').innerText({ timeout: 8000 }).catch(() => '');
    if (/captcha|verify you are human|security verification|unusual traffic/i.test(body)) {
      console.warn(`[FlipLab Scout] ${siteName} displayed a verification challenge; not bypassing it.`);
      break;
    }
    const links = await collectProductLinks(page, siteName, maxResults);
    for (const result of links) if (!combined.has(result.url)) combined.set(result.url, { ...result, searchPage: pageIndex + 1 });
    pagesVisited += 1;
    console.log(`[FlipLab Scout] ${siteName}: page ${pageIndex + 1} yielded ${links.length} links (${combined.size} unique)`);
    if (combined.size >= maxResults || pageIndex + 1 >= maxPages) break;
    if (!(await nextResultsPage(page))) break;
  }

  return { site: siteName, query, url: page.url(), usedSearchBox, pagesVisited, results: [...combined.values()].slice(0, maxResults) };
}

function diverseCandidates(candidateMap, maxProducts) {
  const buckets = new Map();
  for (const candidate of candidateMap.values()) {
    const key = `${candidate.source}|${candidate.query}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(candidate);
  }
  const chosen = [];
  const used = new Set();
  let round = 0;
  while (chosen.length < maxProducts) {
    let added = false;
    for (const bucket of buckets.values()) {
      const candidate = bucket[round];
      if (!candidate || used.has(candidate.url)) continue;
      chosen.push(candidate);
      used.add(candidate.url);
      added = true;
      if (chosen.length >= maxProducts) break;
    }
    if (!added) break;
    round += 1;
  }
  return chosen;
}

async function scoutSuppliers(task) {
  const plan = task.payload?.plan || {};
  const queries = Array.isArray(plan.queries) && plan.queries.length ? plan.queries.slice(0, 6) : [task.payload?.goal || task.goal];
  const sites = (task.payload?.sites || ['AliExpress', 'DHgate']).filter((site) => SITE[site]);
  const maxResults = Math.max(10, Math.min(60, Number(task.payload?.maxResultsPerSearch) || 42));
  const maxPages = Math.max(1, Math.min(3, Number(task.payload?.maxSearchPages) || 2));
  const maxProducts = Math.max(4, Math.min(16, Number(task.payload?.maxProductsToInspect) || 12));
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(45_000);

  const searches = [];
  const candidateMap = new Map();
  const products = [];
  const warnings = [];

  try {
    console.log(`[FlipLab Scout] Mission: ${task.payload?.goal || task.goal}`);
    console.log(`[FlipLab Scout] Creative queries: ${queries.join(' | ')}`);
    console.log(`[FlipLab Scout] Depth: up to ${maxPages} result pages/query · inspect up to ${maxProducts} products`);

    for (const siteName of sites) {
      for (const query of queries) {
        if (stopping) break;
        try {
          const search = await searchSupplierSite(page, siteName, query, maxResults, maxPages);
          searches.push({ site: siteName, query, url: search.url, resultCount: search.results.length, pagesVisited: search.pagesVisited, usedSearchBox: search.usedSearchBox });
          for (const result of search.results) {
            if (!candidateMap.has(result.url)) candidateMap.set(result.url, { ...result, source: siteName, query });
          }
        } catch (error) {
          warnings.push(`${siteName} search failed for “${query}”: ${error.message}`);
          console.warn(`[FlipLab Scout] ${warnings.at(-1)}`);
        }
      }
    }

    const candidates = diverseCandidates(candidateMap, maxProducts);
    console.log(`[FlipLab Scout] Inspecting ${candidates.length} diversified product pages from ${candidateMap.size} unique links…`);
    for (const [index, candidate] of candidates.entries()) {
      if (stopping) break;
      try {
        console.log(`[FlipLab Scout] Opening ${index + 1}/${candidates.length} ${candidate.source} · ${candidate.query}: ${candidate.url}`);
        await page.goto(candidate.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        const observation = await collectObservation(page, candidate.url);
        products.push({
          source: candidate.source,
          query: candidate.query,
          searchPage: candidate.searchPage || 1,
          url: observation.finalUrl || candidate.url,
          title: observation.title || candidate.text || 'Supplier product',
          searchText: candidate.text,
          observation
        });
      } catch (error) {
        warnings.push(`Could not inspect ${candidate.url}: ${error.message}`);
        console.warn(`[FlipLab Scout] ${warnings.at(-1)}`);
      }
    }

    await post(`/api/agent/scout/${encodeURIComponent(task.id)}/complete`, {
      bridgeId,
      claimToken: task.claimToken,
      report: { searches, products, warnings }
    }, 30_000);
    console.log(`[FlipLab Scout] Finished surfing. Inspected ${products.length} products; FlipLab AI is ranking inventory candidates.`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function failVerificationTask(task, error) {
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

async function failScoutTask(task, error) {
  console.error(`[FlipLab Scout] Mission failed: ${error.message}`);
  try {
    await post(`/api/agent/scout/${encodeURIComponent(task.id)}/fail`, {
      bridgeId,
      claimToken: task.claimToken,
      error: error.message
    }, 10_000);
  } catch (reportError) {
    console.error(`[FlipLab Scout] Could not report failure: ${reportError.message}`);
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\n[FlipLab Agent] Stopping…');
  if (ownsContext) await context?.close().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  console.log(`[FlipLab Agent] Server: ${server}`);
  console.log('[FlipLab Agent] Policy: read-only supplier research · no purchases · no messages · no Depop control · no CAPTCHA bypass');
  const mode = await connectBrowser();
  await heartbeat(mode);
  console.log(`[FlipLab Agent] Connected as ${bridgeId}. Waiting for missions…`);

  const heartbeatTimer = setInterval(() => heartbeat(mode).catch(() => {}), 5000);
  heartbeatTimer.unref?.();

  while (!stopping) {
    try {
      const scout = await post('/api/agent/scout/claim', { bridgeId, mode, version: VERSION }, 10_000);
      if (scout) {
        try { await scoutSuppliers(scout); } catch (error) { await failScoutTask(scout, error); }
        continue;
      }

      const task = await post('/api/agent/bridge/claim', { bridgeId, mode, version: VERSION }, 10_000);
      if (!task) {
        await sleep(900);
        continue;
      }
      if (task.type !== 'verify_supplier') throw new Error(`Unsupported task type: ${task.type}`);
      try { await verifySupplier(task); } catch (error) { await failVerificationTask(task, error); }
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
