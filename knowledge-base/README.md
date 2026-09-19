# GoldBank Knowledge Base

Twenty-one pages from https://goldbank.co.uk, committed as source data. Each
file is `{ "markdown": string, "metadata": { sourceURL, title, statusCode, ... } }`.
Run `npm run seed` to build the derived index under `./data/` (gitignored).

## Two batches

**Legal and FAQ (10 files, `*_faqs.json` and `*_legal_*.json`)** — scraped with
[Firecrawl](https://www.firecrawl.dev/) in September 2026: the FAQ page plus
nine legal pages (terms of service, privacy policy, cookies policy, delivery
options, returns policy, returns and exchanges, disclaimer, modern slavery
statement, terms and conditions).

**Informational (11 files)** — contact, our-delivery-options, our-trade-services,
sell, gold-account, and the six guide pages (vat-on-bullion, zakat,
what-determines-the-price-of-gold, why-buy-goldarticle,
history-of-the-gold-sovereign, cash-for-gold-companies). Fetched over plain HTTP
and converted with `turndown` by `npm run scrape`, which rewrites this set in
place; `metadata.scraper` records the provenance per file. Re-run it to refresh
them, then `npm run seed -- --force`.

The two batches differ only in how the markdown was produced. Both carry the
same envelope, and `lib/loaders/scraped-json.ts` reads them identically.

## What is deliberately absent

- **Product, brand and collection pages** (~1,400 of the ~1,600 URLs in the
  sitemap). They quote live prices that move daily and nothing in this pipeline
  refreshes an indexed document, so the bot would cite a stale figure as current
  fact with a citation to back it up.
- **`/insights/`**, 106 long-form marketing articles.
- **`bronze-account` and `silver-account`**, which are `gold-account` with a
  different hero — 96–98% identical line for line, and all three carry the full
  tier ladder. Indexing them together triplicates every membership fact.
- **`sell-now`**, a client-rendered valuation widget whose entire static body
  sits inside an `aria-hidden` container.
- **`about` and `supplier`**, listed in the sitemap but answering 404.

## Known shape

Only `faqs.json` and the scraped informational pages carry real markdown
heading structure. The nine legal pages contain exactly one `#` heading and
express their section titles as unmarked Title-Case paragraphs — see
`lib/pipeline/headings.ts`.

`goldbank.co.uk_legal_returns-and-exchanges.json` was scraped as an HTTP 404
stub and is refused at parse time rather than indexed, which is why the shipped
index is **20 documents / 196 chunks** from 21 files.
