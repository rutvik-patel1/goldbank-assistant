# Gold Bank Assistant — an end-to-end RAG chatbot

A Next.js application that takes a document from upload to a grounded, cited
answer: parsing → structure recovery → chunking → LLM enrichment → embedding →
retrieval → generation.

Built over Gold Bank's published FAQs and legal policies (a UK gold bullion
dealer). The corpus ships with the repo, so a clone is a working demo.

## Quick start

```bash
npm install
cp .env.example .env.local     # add your key from https://aistudio.google.com/apikey
npm run check-models           # confirm the configured Gemini models exist
npm run seed                   # ingest the bundled corpus (~2 min, enrichment)
npm run dev                    # http://localhost:3000
```

`check-models`, `seed`, and `smoke` all load `.env.local` themselves — each is
wired up with `tsx --env-file=.env.local` in `package.json` — so the sequence
above works exactly as written; there is no separate env-loading step to add.
`serverExternalPackages` (for `@lancedb/lancedb` and `unzipper`) and
`apache-arrow` are already committed, so `npm install` alone is enough for a
fresh clone.

## Why this corpus needed a custom pipeline

Nine of the ten scraped pages contain exactly **one** markdown heading. Their
section titles are unmarked Title-Case paragraphs:

```
By Using Our Site You Accept These Terms      <- structurally invisible
By using our site, you confirm that you accept these terms…
```

A stock markdown splitter turns the 28 KB privacy policy into one blob cut at
arbitrary offsets. So `lib/pipeline/headings.ts` reconstructs the tree first,
using three signals: the table-of-contents anchor list each page opens with
(authoritative, and it yields real URL fragments for deep-linked citations),
numbered sections (the privacy policy numbers its top-level sections `1.`…`10.`
with no TOC at all), and a tight Title-/sentence-case heuristic for everything
else. On the privacy policy — which ships with exactly one markdown heading —
this recovers 27 sections (11 `h2` + 16 `h3`).

Chunking then dispatches on content shape — atomic question+answer chunks for
the FAQ page, section chunks for legal text, and a table guard that never cuts
a markdown table mid-row. The FAQ page yields 16 atomic question+answer
chunks, including two one-word answers ("Do you buy diamonds?" → "No.") that a
naive minimum-length filter would have deleted.

One of the ten scraped pages,
`goldbank.co.uk_legal_returns-and-exchanges.json`, is an HTTP 404 stub — the
live site removed that page after the scrape — and is refused at parse time
rather than indexed as content. The shipped index is **9 documents / 111
chunks**.

Document titles are derived from each page's own `h1`, not the scraped
`<title>` tag: six of the nine indexed pages share the site-wide scraped title
"Gold Bank - London", which would have made every citation from those pages
look identical.

## Retrieval accuracy: enrichment

The corpus is legalese; customers ask plain questions. *"Can I get my money
back?"* barely overlaps a clause about statutory cancellation rights under the
Financial Services Regulations 2004. So every chunk is enriched with an
LLM-generated summary, 2–4 hypothetical customer questions, and keywords —
all embedded alongside the passage. **Retrieval sees the paraphrase; the model
answering sees only the verbatim source.**

## Pipeline

| Stage | Module |
|---|---|
| Parse | `lib/loaders/*`, `lib/pipeline/parse.ts` |
| Normalize | `lib/pipeline/normalize.ts` |
| Recover structure | `lib/pipeline/headings.ts` |
| Chunk | `lib/pipeline/chunk.ts` |
| Enrich | `lib/pipeline/enrich.ts` (disk-cached) |
| Embed | `lib/pipeline/embed.ts` |
| Store | `lib/store/*` behind a `VectorStore` port |
| Condense | `lib/rag/condense.ts` |
| Retrieve | `lib/rag/retrieve.ts` (relevance gate + sibling expansion) |
| Assemble | `lib/rag/context.ts` |
| Generate | `lib/rag/answer.ts` |

## Configuration

Everything lives in `lib/config.ts`, overridable by environment variable.
Notable knobs:

| Variable | Default | Effect |
|---|---|---|
| `GEMINI_CHAT_MODEL` | `gemini-3.1-flash-lite` | Generation, condensation, enrichment |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Vectors |
| `EMBEDDING_DIMENSIONS` | `768` | Truncated and re-normalized |
| `VECTOR_STORE` | `lancedb` | `json` swaps in a plain-file index |
| `ENRICHMENT` | `on` | `off` skips the LLM enrichment stage |
| `TOP_K` | `8` | Candidates retrieved |
| `MIN_SCORE` | `0.55` | Below this, the bot refuses instead of guessing |

**Deep links are limited by the source.** Only *Terms of Service* publishes
in-page anchors on goldbank.co.uk, so only its citations deep-link to an exact
section (23 of its 26 chunks carry one). Citations from the other eight
documents link to the page. Nothing is fabricated — a citation without an
anchor simply omits it.

The enrichment cache key includes each chunk's heading path, whose first element is the document
title. So changing title derivation, heading recovery, or chunking invalidates the cache and forces
a full re-enrichment — roughly 111 calls, which on a free-tier key (15/min) needs two or three
`npm run seed -- --force` passes to converge. Each pass caches what succeeded, so it always
converges; the seed's coverage line tells you when you are done.

Changing `EMBEDDING_MODEL` or `EMBEDDING_DIMENSIONS` invalidates the index —
delete `./data` and re-seed. The app refuses to write a mismatched index rather
than failing silently.

## Verification

There is no automated test suite; this is a deliberate scope decision. Manual
harnesses cover each pipeline stage:

```bash
npm run check-models      # models exist and embeddings return 768 dims
npm run verify:parse      # normalization over the real corpus
npm run verify:headings   # named sections recovered from the legal pages
npm run verify:chunk      # chunk kinds, token bounds, tables intact
npm run verify:enrich     # summary/questions/keywords generated and cached (uses your API key)
npm run verify:store      # both VectorStore adapters satisfy one contract
npm run verify:retrieve   # five queries retrieve the right documents
npm run smoke             # three golden questions, end to end
```

## Deliberately out of scope

Authentication, multi-tenancy, hybrid (BM25) search and reranking, a scored
eval harness, OCR for scanned PDFs, live URL scraping, table-aware PDF
extraction, and automated tests.
