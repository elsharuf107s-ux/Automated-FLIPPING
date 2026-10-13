# AI Hunt

AI Hunt turns natural-language sourcing requests into current listing links across multiple marketplaces using the OpenAI Responses API `web_search` tool.

## Use it

1. Add an OpenAI API key in **Settings**.
2. Open **Deal Finder**.
3. Type a normal request, for example:

   `Find vintage Nike jackets under $40 in good condition that look easy to resell.`

4. Click **Hunt everywhere**.
5. Open any result, or click **Scrape + analyze** to send the exact listing into the AI Scanner.

No eBay developer key is required for AI Hunt. The eBay API finder remains available as an optional advanced eBay-only workflow.

## Default marketplaces

AI Hunt currently limits OpenAI web search to:

- eBay
- Depop
- Poshmark
- Mercari
- ShopGoodwill
- Grailed
- OfferUp
- Facebook Marketplace
- Etsy
- Walmart

This list is defined in `lib/hunt.js` and can be changed without changing the UI.

## Flow

```text
natural-language prompt
        ↓
OpenAI Responses API + web_search
        ↓
current direct listing URLs
        ↓
user picks a result
        ↓
Playwright + llm-scraper opens that listing
        ↓
FlipLab AI Scanner scores the flip
```

AI Hunt's `matchScore` only measures how closely a search result matches the sourcing prompt. It is not a guaranteed profit score. The full BUY / WATCH / PASS analysis happens only after **Scrape + analyze**.

## Search model

AI Hunt first tries `OPENAI_SEARCH_MODEL` when that environment variable is set, then the model configured in FlipLab Settings, then a current search-capable fallback model. The OpenAI API key is reused from the existing FlipLab AI settings and is never sent to the browser.
