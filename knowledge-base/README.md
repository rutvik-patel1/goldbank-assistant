# GoldBank Knowledge Base

Ten pages scraped from https://goldbank.co.uk with [Firecrawl](https://www.firecrawl.dev/)
(September 2026).
Each file is `{ "markdown": string, "metadata": { sourceURL, title, statusCode, ... } }`.

One FAQ page plus nine legal pages: terms of service, privacy policy, cookies
policy, delivery options, returns policy, returns and exchanges, disclaimer,
modern slavery statement, terms and conditions.

This directory is committed source data. Run `npm run seed` to build the
derived index under `./data/` (gitignored).

Note: only `faqs.json` contains real markdown heading structure. The nine legal
pages carry exactly one `#` heading and express their section titles as
unmarked Title-Case paragraphs — see `lib/pipeline/headings.ts`.
