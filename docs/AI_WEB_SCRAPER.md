# AI web scraper

FlipLab now uses [`llm-scraper`](https://github.com/mishushakov/llm-scraper) + Playwright for structured product/listing extraction.

## How it works

1. Add your OpenAI API key in **Settings → OpenAI** (or set `OPENAI_API_KEY`).
2. Paste a public `http(s)` product/listing URL into **AI Scanner → Source URL**.
3. Click **Analyze flip**.
4. FlipLab opens the page in headless Chromium, extracts structured product data through your configured OpenAI model, backfills useful scanner fields, then sends the enriched item through the existing flip-analysis pipeline.

The same saved OpenAI key powers both scraping and flip analysis. No second API key is required.

## API

### Scrape only

```http
POST /api/scrape
Content-Type: application/json

{"url":"https://example.com/product"}
```

Returns the extracted product payload plus scraper/model metadata.

### Scrape + analyze

`POST /api/analyze` automatically scrapes first whenever `sourceUrl` is present. If the page cannot be scraped but you supplied other item details, FlipLab continues with those details and includes a scrape warning in the analysis context.

## Codespaces

The devcontainer runs:

```bash
npm install && npm run setup:scraper
```

`setup:scraper` installs the Playwright Chromium browser and Linux dependencies.

## Security guardrails

The scraper only accepts public `http(s)` URLs. It blocks loopback, link-local, private RFC1918 ranges, local hostnames, private IPv6 ranges, embedded URL credentials, and non-web schemes. Network requests made by the browser pass through the same guard before they are allowed.

Marketplace rules still apply. Use scraping only where you are allowed to access and process the page, and keep purchasing/publishing human-controlled unless you have an approved official integration.
