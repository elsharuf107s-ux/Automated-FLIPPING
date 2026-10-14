# FlipLab

FlipLab is a focused AI clothing workflow:

```text
Prompt
  ↓
Find clothing with demand / generic-gem potential
  ↓
Compare cheaper AliExpress / DHgate / Temu supplier matches
  ↓
Build a ready-to-post Depop form pack
  ↓
You review, copy, and post
```

The app intentionally has only three tools:

- **Hunt** — searches resale-market clothing, public demand signals, generic/poorly titled opportunities, and cheaper supplier matches.
- **Ready to Post** — turns the selected clothing candidate into pricing, margin math, and a complete Depop listing pack.
- **Settings** — OpenAI key/model, Depop economics, and theme.

Legacy Dashboard, Inventory, Sources, saved searches, and the eBay developer-key finder were removed so the app stays fast and centered on the workflow above.

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

Temu is treated as search-only metadata rather than directly crawled by the app.

## Ready to Post

Selecting **Build listing from supplier** loads the supplier cost/details into the Ready to Post window and automatically creates:

- Depop description and hashtags
- category, brand, condition, colors, size, quantity/SKU helpers
- source/era/style/material suggestions
- price targets and offer floor
- shipping/package guidance
- margin and ROI math
- buyer-demand evidence when public

The final marketplace post remains human-controlled.

## Commands

```bash
npm start          # port 3000
npm run dev        # watch mode
npm run check      # syntax check
npm test           # unit/API tests
npm run setup:scraper
```

## Core code

```text
server.js
lib/
  ai.js            AI analysis + Depop pack
  config.js        OpenAI config
  demand.js        public buyer-intent signals
  hunt.js          resale discovery job
  scraper.js       rendered listing extraction
  settings.js      small economics settings store
  suppliers.js     clothing supplier matching
public/
  app.js            three-window app shell
  js/views/hunt.js
  js/views/scanner.js
  js/views/settings.js
```
