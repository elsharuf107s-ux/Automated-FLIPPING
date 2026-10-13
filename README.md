# FlipLab — Automated Flipping

A Codespaces-ready AI-assisted reseller operating system for sourcing, flip scoring, inventory tracking, unit economics, and listing preparation.

## What it does

- Drag/drop an item photo and add basic sourcing details.
- Analyze the item with OpenAI vision, local Ollama/Qwen2.5-VL, or the built-in demo scorer.
- Get a **BUY / WATCH / PASS** decision, 0–100 flip score, estimated resale range, max buy price, demand/risk notes, and verification checklist.
- Calculate landed cost, fees, projected profit, and ROI.
- Generate a listing title, description, and keywords.
- Save items to a local inventory/watchlist and move them through `watching → bought → listed → sold`.
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

In GitHub, open **Settings → Codespaces → Secrets → New secret** and add:

```text
OPENAI_API_KEY=your_key_here
```

Optional environment variables:

```text
AI_PROVIDER=openai
OPENAI_MODEL=gpt-6-luna
PORT=3000
```

The server uses the OpenAI Responses API and can send the compressed item photo as an image input. If the key is missing or the API call fails, FlipLab automatically falls back to its local demo scorer instead of breaking the UI.

## Open-source / local AI option

FlipLab also supports Ollama so the AI layer can be run with an open model.

Set:

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
```

Change default assumptions in **Settings**.

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
├── .github/workflows/ci.yml          # syntax checks
├── lib/
│   ├── ai.js                         # OpenAI, Ollama, fallback scorer
│   └── store.js                      # local JSON persistence
├── public/
│   ├── index.html                    # dashboard UI
│   ├── styles.css                    # responsive visual system
│   └── app.js                        # browser workflow
├── server.js                         # Express API
├── .env.example
└── package.json
```

## Data

Inventory is stored locally at `data/db.json`, created automatically on first run. In a Codespace that data stays in the Codespace filesystem, but it is intentionally not treated as a cloud database. For a production multi-device version, the next upgrade should be PostgreSQL/Supabase.

## Useful commands

```bash
npm install
npm run dev
npm run check
npm start
```

## Current boundaries

FlipLab intentionally does **not** claim that its AI estimates are verified sold comps. Before spending money, check actual sold/completed listings, shipping cost, condition, measurements, and authenticity. The AI is a decision-support layer, not a guarantee of resale value.
