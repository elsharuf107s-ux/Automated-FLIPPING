# FlipLab Browser Agent v1

## What it is

FlipLab runs its search, OpenAI reasoning, supplier ranking and Depop-pack generation in GitHub Codespaces. The Browser Agent adds a small **local Playwright bridge** on the Chromebook so FlipLab can verify supplier pages using a real local browser session.

```text
GitHub Codespace (brain)
  ├─ Hunt + supplier matching
  ├─ Browser task queue
  ├─ OpenAI supplier verifier
  └─ Ready to Post
          ▲
          │ private GitHub CLI port-forward
          │
Chromebook Linux (hands)
  └─ Playwright Browser Bridge
      └─ local Chromium / optional CDP browser
```

The bridge uses an outbound/private tunnel. You do **not** need to make the FlipLab Codespaces port public.

## Safety boundary

Browser Agent v1 is intentionally narrow.

Allowed:

- open an eligible AliExpress or DHgate supplier URL;
- wait for the page to render;
- read visible page text;
- read JSON-LD/product structured data;
- inspect select options and visible button labels for size/color clues;
- collect visible product-image URLs;
- send that observation back to FlipLab for structured AI extraction.

Not allowed by the v1 bridge:

- Depop browser control;
- Temu browser crawling (Temu stays search-only in FlipLab);
- checkout or purchasing;
- adding items to cart;
- sending seller messages;
- posting/publishing listings;
- deleting/cancelling anything;
- bypassing CAPTCHA, bot checks, login gates or access controls.

The bridge code contains its own URL allowlist in addition to the server-side policy. A redirect is checked again before data is returned.

## Chromebook setup

### 1. GitHub CLI

Use the Chromebook Linux terminal and authenticate once:

```bash
gh auth login
```

Confirm that your Codespace is visible:

```bash
gh codespace list
```

### 2. Keep the Codespace app private

Start FlipLab in the Codespace as usual:

```bash
npm install
npm start
```

Keep forwarded port 3000 set to **Private**.

### 3. Forward Codespace port 3000 to the Chromebook

On the Chromebook Linux terminal:

```bash
gh codespace ports forward 3000:3000 -R elsharuf107s-ux/Automated-FLIPPING
```

If GitHub asks you to select a Codespace, choose the one running FlipLab. Leave this command running. It creates a local `127.0.0.1:3000` path to the private Codespace.

If local port 3000 is already in use, choose another local port:

```bash
gh codespace ports forward 3000:3300 -R elsharuf107s-ux/Automated-FLIPPING
```

Then start the bridge with:

```bash
npm run agent:local -- --server http://127.0.0.1:3300
```

### 4. Install the local bridge

In another Chromebook Linux terminal:

```bash
git clone https://github.com/elsharuf107s-ux/Automated-FLIPPING.git
cd Automated-FLIPPING
npm install
npx playwright install chromium
```

Start it:

```bash
npm run agent:local
```

By default the bridge launches a visible persistent Chromium profile at:

```text
~/.fliplab/browser-profile
```

That profile is separate from your normal Chrome profile. You can sign in to supported supplier sites in that browser if needed, and the session can persist between runs.

## Optional existing-browser mode

If a Chromium-based browser is already running with a Chrome DevTools Protocol endpoint that the Linux environment can reach, use:

```bash
npm run agent:local -- --cdp http://127.0.0.1:9222
```

This attaches to the browser context instead of launching FlipLab's persistent Playwright profile.

ChromeOS's main browser is not always directly reachable from the Linux container through CDP, so the dedicated Playwright profile is the recommended v1 path.

A future adapter can use Microsoft's Playwright MCP browser-extension transport for tighter integration with an existing Chrome profile. The task queue and verification APIs are separated from the local browser driver so that adapter can be added without changing Hunt or Ready to Post.

## What happens during a Hunt

When Browser Agent is online and **Auto-verify the top 3 supplier matches** is enabled:

1. Hunt finishes its web search and supplier matching.
2. FlipLab selects up to three eligible AliExpress/DHgate best matches.
3. `/api/agent/verify` creates read-only tasks.
4. The local bridge claims one task at a time.
5. Playwright opens the supplier URL locally.
6. The bridge captures page facts and posts them back.
7. Codespace OpenAI converts the untrusted webpage observation into strict structured fields.
8. The Hunt card updates with verified values.
9. Ready to Post uses verified price/shipping/details when available.

The page observation is explicitly treated as **untrusted data** in the OpenAI prompt. Instructions or prompt-injection text found inside a webpage are ignored.

## Verified fields

The verifier can return:

```text
title
price
currency
shipping
total landed product+shipping amount when known
sizes
colors
material
stock state / stock text
delivery estimate
seller/store name
confidence
evidence
warnings
product-image URLs
```

Unknown fields remain null/empty rather than being guessed.

## Task states

```text
queued
  ↓
running       local Playwright bridge owns the task
  ↓
processing    Codespace AI structures the browser observation
  ↓
completed
```

A task can also become `failed`. Running tasks have a short lease; if the local bridge disappears during a task, FlipLab can requeue it after the lease expires instead of leaving it permanently stuck.

## CLI options

Default:

```bash
npm run agent:local
```

Different local forwarded port:

```bash
npm run agent:local -- --server http://127.0.0.1:3300
```

Headless local Chromium:

```bash
npm run agent:local -- --headless
```

Custom persistent browser profile:

```bash
npm run agent:local -- --profile ~/.fliplab/my-profile
```

Existing Chromium via CDP:

```bash
npm run agent:local -- --cdp http://127.0.0.1:9222
```

## Troubleshooting

### Browser Agent says offline

Make sure all three pieces are running:

```text
Codespace: npm start
Chromebook terminal 1: gh codespace ports forward ...
Chromebook terminal 2: npm run agent:local
```

The Browser Agent window should switch to **Local browser connected** within a few seconds.

### Chromium executable missing

Run locally:

```bash
npx playwright install chromium
```

### Supplier page shows CAPTCHA or human verification

The bridge records a warning and stops short of bypassing it. Complete the site's normal verification manually in the local browser if appropriate, then retry the verification task.

### Supplier page requires login

Use the visible persistent Browser Agent Chromium window to sign in manually. The profile persists under `~/.fliplab/browser-profile`.

### Temu verification button is unavailable

That is intentional. FlipLab keeps Temu as search-only metadata and does not send Temu URLs to the local bridge.

### Depop is blocked

Also intentional. The Browser Agent is not a Depop posting bot. Ready to Post still prepares the fields for you to copy into Depop manually.
