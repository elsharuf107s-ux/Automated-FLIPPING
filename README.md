# FlipLab — Automated Flipping

A Codespaces-ready AI-assisted reseller operating system for sourcing, flip scoring, inventory tracking, unit economics, and listing preparation.

## What it does

- Drag/drop, paste, or click to add an item photo (compressed in the browser) and add basic sourcing details.
- Analyze the item with OpenAI vision, local Ollama/Qwen2.5-VL, or the built-in demo scorer.
- Get a **BUY / WATCH / PASS** decision, 0–100 flip score, estimated resale range, max buy price, demand/risk notes, and verification checklist.
- See landed cost, fees, profit, ROI, break-even price and max buy price update live as you type.
- Generate a listing title, description, and keywords — copy each with one click.
- Save items to a local inventory/watchlist and move them through `watching → bought → listed → sold`.
- Open any item to edit every field, change its photo, record the actual sale price and date, or re-run the AI.
- Search, filter and sort inventory; export it to CSV.
- Dashboard with realized profit by month, pipeline by status, and top watchlist opportunities.
- **Manage the AI provider and API key inside the app** (Settings) — no restart needed.
- Dark and light themes, works on phones, keyboard shortcuts.
- Run as a browser dashboard on **port 3000** in GitHub Codespaces.

> Marketplace safety: FlipLab does not scrape Depop or bot-post to it. Use AI for analysis and listing preparation, then verify real sold comps and publish manually unless you have an approved official marketplace API integration.

## Run in GitHub Codespaces

1. Open this repository on GitHub.
2. Click **Code → Codespaces → Create codespace on main**.
3. The devcontainer runs `npm install` automatically.
4. The server auto-starts on **port 3000** and Codespaces should open the forwarded **FlipLab Dashboard** preview.
5. If you need to restart it manually:

```bash
npm run dev
```

Then open the **Ports** tab and open port `3000`.

## Add OpenAI AI analysis

Never put an API key in the repository.

### Option A — in the app (easiest)

1. Open **Settings** in the sidebar.
2. Choose **OpenAI**, paste your key into **OpenAI API key**, and optionally change the model.
3. Click **Test connection** to check the key and model without spending tokens, then **Save AI settings**.

The key is saved on the server in `data/ai-config.json` with owner-only file permissions. The `data/` folder is git-ignored, and the API only ever returns a masked preview (`sk-…abcd`) — the full key never goes back to the browser. Paste a new key to replace it, or click **Remove saved key** to delete it.

> FlipLab has no login. Anyone who can open the app can change its settings, so keep the Codespaces port **private** (the default) and don't expose the server publicly.

### Option B — environment variable / Codespaces secret

In GitHub, open **Settings → Codespaces → Secrets → New secret** and add:

```text
OPENAI_API_KEY=your_key_here
```

A key saved in the app takes priority over the environment variable; removing it in the app falls back to the environment variable.

Optional environment variables (each can also be changed in the app):

```text
AI_PROVIDER=openai
OPENAI_MODEL=gpt-6-luna
PORT=3000
```

The server uses the OpenAI Responses API with structured JSON output and can send the compressed item photo as an image input. If the key is missing or the API call fails, FlipLab automatically falls back to its local demo scorer and shows why, instead of breaking the UI.

## Open-source / local AI option

FlipLab also supports Ollama so the AI layer can be run with an open model. Pick **Ollama** in **Settings** and set the server URL and model there, or set:

```text
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5vl:3b
```

Then install/run Ollama inside an environment with enough RAM and pull a compatible vision model. A small Codespace may be slow for vision inference, so hosted OpenAI is usually the smoother Codespaces experience.

## Unit economics

FlipLab computes:

```text
landed cost = purchase price + inbound shipping + cleaning/repair
fees = target sale price × (marketplace fee % + payment processing %) / 100
projected profit = target sale price - landed cost - outbound shipping - fees
ROI = projected profit / landed cost × 100
break-even price = (landed cost + outbound shipping) / (1 - fee %)
max buy = highest item cost that still hits your target ROI at the target price
```

When an item is marked **sold** and has a sold price, profit uses the sold price instead of the target, and counts toward realized profit on the dashboard.

Change default assumptions (fees, default shipping, target ROI) in **Settings**.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Search inventory |
| `N` | New scan |
| `Ctrl/⌘ + Enter` | Analyze (in the scanner) |
| `Ctrl/⌘ + S` | Save item (in the item panel) |
| `Esc` | Close the item panel |

## Workflow

```text
SOURCE
  ↓
PHOTO + ITEM DATA
  ↓
AI SCAN
  ↓
BUY / WATCH / PASS
  ↓
VERIFY CONDITION + REAL SOLD COMPS
  ↓
SAVE TO INVENTORY
  ↓
AI LISTING COPY
  ↓
MANUAL MARKETPLACE PUBLISH
  ↓
TRACK LISTED / SOLD
```

## Project structure

```text
Automated-FLIPPING/
├── .devcontainer/devcontainer.json   # Codespaces + port 3000
├── .github/workflows/ci.yml          # syntax checks, tests, smoke test
├── lib/
│   ├── ai.js                         # OpenAI, Ollama, fallback scorer, connection test
│   ├── config.js                     # AI provider + API key settings (app → env → default)
│   ├── store.js                      # JSON persistence, write queue, photo files
│   ├── paths.js                      # data directory locations
│   └── errors.js
├── public/
│   ├── index.html                    # app shell + icon sprite
│   ├── styles.css                    # responsive dark/light design system
│   ├── app.js                        # router, theme, shortcuts, startup
│   └── js/
│       ├── econ.js                   # unit economics (shared with the server)
│       ├── data.js                   # client state + API calls
│       ├── ui.js / report.js / util.js
│       └── views/                    # dashboard, scanner, inventory, drawer, settings, sources
├── scripts/check.js                  # syntax check for every JS file
├── test/                             # node:test suites (store, config, API)
├── server.js                         # Express API
├── .env.example
└── package.json
```

## Data

Everything FlipLab saves lives in the git-ignored `data/` folder, created automatically on first run:

- `data/db.json` — inventory and default economics
- `data/uploads/` — item photos (older inline photos are migrated here automatically)
- `data/ai-config.json` — AI provider settings and any API key saved in the app

Set `FLIPLAB_DATA_DIR` to store it somewhere else. In a Codespace that data stays in the Codespace filesystem, but it is intentionally not treated as a cloud database. Use **Export CSV** (Inventory or Settings) for a backup. For a production multi-device version, the next upgrade should be PostgreSQL/Supabase.

## Useful commands

```bash
npm install
npm run dev     # restart on file changes
npm run check   # syntax-check every JS file
npm test        # store, config and API tests
npm start
```

## Current boundaries

FlipLab intentionally does **not** claim that its AI estimates are verified sold comps. Before spending money, check actual sold/completed listings, shipping cost, condition, measurements, and authenticity. The AI is a decision-support layer, not a guarantee of resale value.
