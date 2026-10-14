# FlipLab

FlipLab is a focused AI clothing workflow:

```text
Prompt
  ↓
Find clothing with demand / generic-gem potential
  ↓
Compare cheaper AliExpress / DHgate / Temu supplier matches
  ↓
Local Browser Agent verifies the strongest supplier pages
  ↓
Build a ready-to-post Depop form pack
  ↓
You review, copy, and post
```

The app has four focused tools:

- **Hunt** — searches resale-market clothing, public demand signals, generic/poorly titled opportunities, and cheaper supplier matches.
- **Ready to Post** — turns a selected clothing candidate into pricing, margin math, and a complete Depop listing pack.
- **Browser Agent** — optional local Playwright bridge that verifies visible supplier facts from your Chromebook browser.
- **Settings** — OpenAI key/model, Depop economics, and theme.

Legacy Dashboard, Inventory, Sources, saved searches, and the eBay developer-key finder stay removed so the app remains centered on Hunt → verify → build listing.

## Run in Codespaces

```bash
npm install
npm run setup:scraper
npm start
```

Open forwarded port **3000** and keep it **Private**. FlipLab does not include user authentication.

Existing Codespaces that already installed Chromium normally only need:

```bash
git pull
npm install
npm start
```

## OpenAI

Set your key either in **Settings** or as an environment/Codespaces secret:

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-6-luna
```

A key saved in the app is written to `data/ai-config.json`, which is git-ignored and written with owner-only permissions where supported. The browser only receives a masked preview.

## Hunt behavior

Hunt is clothing-only. It searches supported resale marketplaces for:

- explicit public buyer activity such as bids, watchers, likes, carts/bags, or offer counts when actually exposed;
- generic, misspelled, weak, or under-described clothing listings;
- cheaper clothing matches on AliExpress, DHgate, and Temu.

Supplier matches are labeled **Exact candidate**, **Similar**, or **Generic**. FlipLab does not transfer a brand from a reference listing onto an unverified supplier item and excludes replica/counterfeit sourcing instructions.

Temu is treated as search-only metadata rather than directly crawled by the app or local Browser Agent.

## Local Browser Agent

The Browser Agent is optional. The Codespace remains the AI brain while a local Playwright process on the Chromebook opens supported supplier pages and sends visible page facts back to FlipLab.

The v1 bridge is deliberately read-only. It can navigate to AliExpress and DHgate supplier URLs and capture page text, product structured data, variant controls, images, stock/delivery clues and other visible facts. It does **not** control Depop, buy/checkout, send messages, publish, log in for you, or bypass CAPTCHAs/access controls.

On the Chromebook Linux terminal, authenticate GitHub CLI and forward the private Codespace port:

```bash
gh auth login
gh codespace ports forward 3000:3000 -R elsharuf107s-ux/Automated-FLIPPING
```

Keep that terminal running. In a second terminal, use a local clone of this repository:

```bash
git clone https://github.com/elsharuf107s-ux/Automated-FLIPPING.git
cd Automated-FLIPPING
npm install
npx playwright install chromium
npm run agent:local
```

The bridge opens a persistent local Chromium profile under `~/.fliplab/browser-profile`, so supplier login state can persist between runs when the site allows it.

Optional CDP mode can attach to an existing Chromium instance when that browser exposes a remote-debugging endpoint:

```bash
npm run agent:local -- --cdp http://127.0.0.1:9222
```

The default Playwright profile is the most reliable v1 setup on Chromebook Linux. Existing-browser/CDP availability depends on how Chrome/Chromium is installed. See [`docs/BROWSER_AGENT.md`](docs/BROWSER_AGENT.md) for the architecture and troubleshooting details.

When the bridge is connected, Hunt automatically queues the top three eligible supplier matches for verification. A verified supplier card can replace search-snippet estimates with visible page facts before **Build ready-to-post pack** is used.

## Ready to Post

Selecting **Build ready-to-post pack** loads supplier details into the Ready to Post window and automatically creates:

- Depop description and hashtags
- category, brand, condition, colors, size, quantity/SKU helpers
- source/era/style/material suggestions
- price targets and offer floor
- shipping/package guidance
- margin and ROI math
- buyer-demand evidence when public
- locally verified supplier facts when available

The final marketplace post remains human-controlled.

## Commands

```bash
npm start                    # Codespace app on port 3000
npm run dev                  # watch mode
npm run agent:local          # Chromebook/local Playwright bridge
npm run check                # syntax check
npm test                     # unit/API tests
npm run setup:scraper        # install Chromium in Codespaces
```

## Core code

```text
server.js
lib/
  ai.js             AI analysis + Depop pack
  browser-agent.js  browser task queue + AI supplier verification
  config.js         OpenAI config
  demand.js         public buyer-intent signals
  hunt.js           resale discovery job
  scraper.js        rendered listing extraction
  settings.js       small economics settings store
  suppliers.js      clothing supplier matching
scripts/
  browser-bridge.js local Playwright bridge
public/
  app.js
  js/views/agent.js
  js/views/hunt.js
  js/views/scanner.js
  js/views/settings.js
```
