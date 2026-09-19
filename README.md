# Gold Bank Assistant - RAG chatbot

A Next.js application that takes a document from upload to a grounded, cited
answer: parsing → structure recovery → chunking → embedding → retrieval →
generation.

Built over Gold Bank's published FAQs and legal policies (a UK gold bullion
dealer). The corpus ships with the repo, so a clone is a working demo.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 |
| Language | TypeScript 5, Node ≥ 22 |
| Styling | Tailwind CSS 4 |
| LLM & embeddings | Google Gemini via LangChain 1.x (`@langchain/google-genai`) |
| Vector store | LanceDB (`@lancedb/lancedb` + Apache Arrow), with a plain-JSON index as a drop-in alternative |
| Document loaders | `pdf-parse`, `mammoth` (DOCX), `turndown` (HTML), `unzipper` (ZIP) |
| Scraping | [Firecrawl](https://www.firecrawl.dev/) — structured markdown per page, run offline |

No database, no queue, no auth: everything derived lives under `./data` and is
rebuildable from the committed corpus with one command.

## Setup

```bash
npm install
cp .env.example .env.local     # add your key from https://aistudio.google.com/apikey
npm run check-models           # confirm the configured Gemini models exist
npm run seed                   # ingest the bundled corpus
npm run dev                    # http://localhost:3000
```

`check-models`, `seed`, and `smoke` all load `.env.local` themselves — each is
wired up with `tsx --env-file-if-exists=.env.local` in `package.json` — so the sequence
above works exactly as written; there is no separate env-loading step to add.
`serverExternalPackages` (for `@lancedb/lancedb` and `unzipper`) and
`apache-arrow` are already committed, so `npm install` alone is enough for a
fresh clone.

## Documentation

| Document | What's in it |
|---|---|
| [Architecture](./docs/ARCHITECTURE.md) | Data sources and scraping, every ingestion stage, retrieval and generation, the full configuration table, the module map and HTTP surface |
| [Glossary](./docs/GLOSSARY.md) | Every term of art — [RAG](./docs/GLOSSARY.md#rag), the pipeline keywords ([chunk](./docs/GLOSSARY.md#chunk), [embed](./docs/GLOSSARY.md#embedding-vector)…), the retrieval machinery, and [every config variable](./docs/GLOSSARY.md#configuration-variables) |
| [Decisions](./docs/DECISIONS.md) | The choices taken during the build, in the order they were made |

## Data sources

The bundled corpus is ten pages scraped from
[goldbank.co.uk](https://goldbank.co.uk) with
[Firecrawl](https://www.firecrawl.dev/) — one FAQ page plus nine legal pages.
Firecrawl returns clean, structured markdown per page rather than raw HTML,
along with the source URL and HTTP status, which is what makes deep-linked
citations and the refusal of error pages possible.

One of the ten is an HTTP 404 stub — the live site removed that page after the
scrape — and is refused at parse time rather than indexed as content. The
shipped index is **9 documents / 111 chunks**.

The same pipeline backs the upload zone at `/knowledge`, which accepts `.json`,
`.zip`, `.pdf`, `.docx`, `.md`, `.txt`, `.html` and `.htm`. Full detail in
[Architecture](./docs/ARCHITECTURE.md#data-sources).

## How it works

Ingest, offline: [parse](./docs/GLOSSARY.md#parse) → [normalize](./docs/GLOSSARY.md#normalize) →
[recover headings](./docs/GLOSSARY.md#heading-path) →
[chunk](./docs/GLOSSARY.md#chunk) →
[embed](./docs/GLOSSARY.md#embedding-vector) →
[store](./docs/GLOSSARY.md#vector-store). Query, per message:
[condense](./docs/GLOSSARY.md#condense) → embed →
[search](./docs/GLOSSARY.md#cosine-similarity) →
[relevance gate](./docs/GLOSSARY.md#relevance-gate) →
[sibling expansion](./docs/GLOSSARY.md#sibling-expansion) →
[assemble context](./docs/GLOSSARY.md#assemble-context) →
[generate](./docs/GLOSSARY.md#generate) →
[validate citations](./docs/GLOSSARY.md#validate-citations).

Both flows, stage by stage, are in [Architecture](./docs/ARCHITECTURE.md); each
term above links to its entry in the [Glossary](./docs/GLOSSARY.md).

Below `MIN_SCORE` the bot refuses rather than guessing, and citations that
point at passages never supplied are stripped from the answer before it is
saved — so no chip in the UI is dead and no claim is unsourced.

**Deep links are limited by the source.** Only *Terms of Service* publishes
in-page anchors on goldbank.co.uk, so only its citations deep-link to an exact
section (23 of its 26 chunks carry one). Citations from the other eight
documents link to the page. Nothing is fabricated — a citation without an
anchor simply omits it.

## Configuration

Everything lives in `lib/config.ts`, overridable by environment variable. The
knobs you are most likely to touch:

| Variable | Default | Effect |
|---|---|---|
| `GEMINI_CHAT_MODEL` | `gemini-3.1-flash-lite` | Generation and condensation |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Vectors |
| `EMBEDDING_DIMENSIONS` | `768` | Truncated and re-normalized |
| `VECTOR_STORE` | `lancedb` | `json` swaps in a plain-file index |
| `TOP_K` | `8` | Candidates retrieved |
| `MIN_SCORE` | `0.55` | Below this, the bot refuses instead of guessing |

The full table — chunking, embedding, retrieval and upload limits — plus the
rules for what invalidates the index, is in
[Architecture](./docs/ARCHITECTURE.md#configuration).

## Verification

There is no automated test suite; this is a deliberate scope decision. Manual
harnesses cover each pipeline stage:

```bash
npm run check-models      # models exist and embeddings return 768 dims
npm run verify:parse      # normalization over the real corpus
npm run verify:headings   # named sections recovered from the legal pages
npm run verify:chunk      # chunk kinds, token bounds, tables intact
npm run verify:store      # both VectorStore adapters satisfy one contract
npm run verify:retrieve   # five queries retrieve the right documents
npm run smoke             # three golden questions, end to end
```
