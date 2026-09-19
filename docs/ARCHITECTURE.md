# Architecture

Data sources, the ingestion pipeline, retrieval, and configuration — in one
place. Every term of art below has its own page in the
[Glossary](./GLOSSARY.md); build-time choices and their rationale live in
[Decisions](./DECISIONS.md).

## Two flows, one index

```
INGEST (offline: npm run seed, or the /knowledge upload zone)

  file ──▶ parse ──▶ normalize ──▶ recover headings ──▶ chunk
                                                          │
                       store ◀── embed ◀── enrich (LLM) ◀──┘

QUERY (online: POST /api/chat, streamed over SSE)

  question + history ──▶ condense ──▶ embed query ──▶ search (top-k)
                                                          │
                                       relevance gate ◀───┘
                                          │        └── below MIN_SCORE ──▶ refuse
                                          ▼
                       sibling expansion ──▶ assemble context ──▶ generate
                                                          │
                                       validate citations ◀┘ ──▶ stream to client
```

The [vector store](./GLOSSARY.md#vector-store) sits behind a `VectorStore`
[port](./GLOSSARY.md#port-and-adapter) (`lib/store/types.ts`) with two adapters
— LanceDB (default) and a plain-JSON index — so nothing above it knows which is
in use.

## Data sources

**The [corpus](./GLOSSARY.md#corpus).** `knowledge-base/goldbank/` holds ten pages scraped from
[goldbank.co.uk](https://goldbank.co.uk) — one FAQ page plus nine legal pages.
It is committed, so `npm run seed` rebuilds the index from a fresh clone.

**[Scraping](./GLOSSARY.md#scraping): [Firecrawl](https://www.firecrawl.dev/)** (September 2026). It
crawls a site and returns clean, structured markdown per page instead of raw
HTML, with the source URL and HTTP status attached:

```json
{ "markdown": "# Frequently Asked Questions\n…",
  "metadata": { "sourceURL": "https://goldbank.co.uk/faqs",
                "title": "Gold Bank - London", "statusCode": 200 } }
```

Three consequences: the pipeline never parses a DOM for scraped pages;
`sourceURL` is both the citation target and the identity key on re-ingest, so
re-scraping replaces a page rather than producing a second citable copy; and
`statusCode >= 400` is refused at parse time. One of the ten pages is a 404
stub — the live site removed it after the scrape — so the shipped index is
**9 documents / 111 chunks**. Re-scraping is manual; the app does not crawl
live URLs.

**Uploads.** The same pipeline backs `/knowledge`, capped at 20 MB per file:

| Format | Loader | Notes |
|---|---|---|
| `.json` | `scraped-json.ts` | Firecrawl-shaped page JSON |
| `.pdf` | `pdf.ts` | `pdf-parse`; text layer only, no OCR |
| `.docx` | `docx.ts` | `mammoth` → HTML → markdown |
| `.html` / `.htm` | `html.ts` | `turndown` → markdown |
| `.md` / `.txt` | `text.ts` | passed through |
| `.zip` | `zip.ts` | expands to many documents, no nesting |

## Ingestion pipeline

`lib/pipeline/ingest.ts` runs one document through these stages, emitting a
status event per stage so the seed script and the browser show live progress.

| Stage | Module | What it does |
|---|---|---|
| [Parse](./GLOSSARY.md#parse) | `loaders/*`, `pipeline/parse.ts` | Dispatch on extension, expand zips. Titles come from each page's `h1`, not the scraped `<title>` — six of nine pages share one site-wide title. |
| [Normalize](./GLOSSARY.md#normalize) | `pipeline/normalize.ts` | Strip boilerplate and duplicated titles, collapse whitespace, guarantee an `h1`, harvest the leading TOC anchor list, hash the content ([content hash](./GLOSSARY.md#content-hash)). |
| [Recover structure](./GLOSSARY.md#recover-structure) | `pipeline/headings.ts` | Rebuild the heading tree from TOC anchors, numbered sections, and a Title-Case heuristic. |
| [Chunk](./GLOSSARY.md#chunk) | `pipeline/chunk.ts` | Dispatch on [content shape](./GLOSSARY.md#chunk-kinds): `qa`, `clause`, `prose`, `table`. Oversized sections split with 15% overlap, recording `partIndex`/`partCount`. |
| [Enrich](./GLOSSARY.md#enrich) | `pipeline/enrich.ts` | LLM summary, 2–4 hypothetical customer questions, keywords. Disk-cached; never throws on bad model output. |
| [Embed](./GLOSSARY.md#embedding-vector) | `pipeline/embed.ts` | Batched and retried; vectors truncated to [`EMBEDDING_DIMENSIONS`](./GLOSSARY.md#dimensions) and re-normalized. |
| [Store](./GLOSSARY.md#store) | `store/*` | [Upsert](./GLOSSARY.md#upsert) through the `VectorStore` port. |

**Why structure recovery exists.** Nine of the ten pages contain exactly one
markdown heading; their section titles are unmarked Title-Case paragraphs, so a
stock splitter turns the 28 KB privacy policy into one blob cut at arbitrary
offsets. The recovered tree yields 27 sections there (11 `h2` + 16 `h3`), and
TOC anchors give real URL fragments for deep-linked citations.

**Why enrichment exists.** The corpus is legalese; customers ask plain
questions. *"Can I get my money back?"* barely overlaps a clause about
statutory cancellation rights. The enrichment is embedded alongside the
passage, so **retrieval sees the paraphrase; the model answering sees only the
verbatim source.**

**Failure semantics.** Identical content is skipped; changed content replaces
the prior version outright (keyed on `sourceUrl`, else filename); a failed
stage deletes the document's vectors *before* marking it failed, so nothing is
left half-indexed; a refused input is reported as refused input, not as a
broken pipeline.

## Retrieval & generation

One `POST /api/chat`, streamed over [SSE](./GLOSSARY.md#sse).

1. **[Condense](./GLOSSARY.md#condense)** (`rag/condense.ts`) — rewrite a follow-up into a standalone
   query using the last `CONDENSE_HISTORY_TURNS` turns. First turn returns the
   question unchanged; any failure falls back to it. Never a hard dependency.
2. **Search** (`rag/retrieve.ts`) — embed the query, take the
   [`TOP_K`](./GLOSSARY.md#top-k) nearest by
   [cosine similarity](./GLOSSARY.md#cosine-similarity). `assertDimensions()` throws first if the index width disagrees with
   the configured one, instead of returning quiet nonsense.
3. **[Relevance gate](./GLOSSARY.md#relevance-gate)** — below `MIN_SCORE`, return nothing and answer with a
   fixed refusal. The alternative is a confident answer assembled from the
   eight least-irrelevant passages in the corpus.
4. **[Sibling expansion](./GLOSSARY.md#sibling-expansion)** — a hit that was one part of a split section pulls in
   its whole contiguous run, at a `SIBLING_SCORE_DISCOUNT`. A clause cut in two
   mid-obligation must reach the model whole.
5. **[Assemble context](./GLOSSARY.md#assemble-context)** (`rag/context.ts`) — dedupe, keep the strongest until
   the [`CONTEXT_TOKEN_BUDGET`](./GLOSSARY.md#context-budget) binds, then re-sort into reading order and number the
   passages. Context is verbatim chunk text only; enrichment never enters the
   prompt.
6. **[Generate](./GLOSSARY.md#generate)** (`rag/answer.ts`) — stream at
   [`CHAT_TEMPERATURE`](./GLOSSARY.md#temperature). The system
   prompt requires inline `[n]` citations and exact figures, forbids filling
   gaps from general knowledge ([grounding](./GLOSSARY.md#grounding)), and rules
   out investment/tax/legal advice and price predictions.
7. **[Validate citations](./GLOSSARY.md#validate-citations)** — strip markers pointing at passages never supplied
   and report which were actually used, so no chip in the UI is dead. Only one-
   and two-digit groups count as markers: the corpus quotes statutes by year,
   and `[2004]` must survive. The corrected text is sent as its own event, since
   the client already rendered the raw stream.

**[Deep links](./GLOSSARY.md#citation-and-deep-links) are limited by the source.** Only
*Terms of Service* publishes in-page anchors on goldbank.co.uk (23 of its 26
chunks carry one); other citations link to the page. A citation without an anchor simply omits it —
nothing is fabricated.

**[SSE](./GLOSSARY.md#sse) events:** `meta` (condensed query, top score, whether the gate fired,
every retrieved chunk) → `token`* → `answer` (corrected) → `citations` (only
those used) → `done`. `meta` is what powers the pipeline strip in the UI.

## Configuration

Everything is in `lib/config.ts`; the variables below override it from
`.env.local`. Only `GEMINI_API_KEY` is required.

| Variable | Default | Effect |
|---|---|---|
| `GEMINI_CHAT_MODEL` | `gemini-3.1-flash-lite` | Generation, condensation, enrichment |
| `CHAT_TEMPERATURE` | `0.1` | Answers only — condensation and enrichment always run at 0 |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Vectors |
| `EMBEDDING_DIMENSIONS` | `768` | Truncated from model output, then re-normalized |
| `VECTOR_STORE` | `lancedb` | `json` swaps in a plain-file index |
| `DATA_DIR` | `./data` | Root for index, manifest, chats, uploads, cache |
| `MAX_CHUNK_TOKENS` | `450` | Sections above this split into overlapping parts |
| `MAX_TOC_SCAN_LINES` | `60` | How far the leading TOC list is harvested |
| `ENRICHMENT` | `on` | `off` skips the LLM enrichment stage |
| `ENRICH_CONCURRENCY` / `ENRICH_MAX_RETRIES` / `ENRICH_MAX_CHARS` | `4` / `5` / `6000` | Enrichment throughput and passage truncation |
| `EMBED_BATCH_SIZE` / `EMBED_CONCURRENCY` / `EMBED_MAX_RETRIES` | `64` / `2` / `5` | Embedding throughput |
| `TOP_K` | `8` | Candidates retrieved |
| `MIN_SCORE` | `0.55` | Below this, the bot refuses instead of guessing |
| `CONTEXT_TOKEN_BUDGET` | `6000` | [Token](./GLOSSARY.md#token) ceiling for assembled context |
| `SIBLING_SCORE_DISCOUNT` | `0.95` | Score multiplier for expanded siblings |
| `CONDENSE_HISTORY_TURNS` | `6` | Turns fed to the condenser |
| `CITATION_SNIPPET_CHARS` | `400` | Preview stored with each citation |
| `MAX_UPLOAD_BYTES` | `20971520` | Per-file upload limit |

Chunk overlap, the heading heuristics, the supported extensions and the
boilerplate patterns are in-code constants, tuned against the real corpus.

**What invalidates what.** The enrichment cache is keyed on
`chat model + heading path + chunk text`, so changing the chat model, title
derivation, heading recovery or chunking forces a full re-enrichment — ~111
calls, which on a free-tier key (15/min) takes two or three
`npm run seed -- --force` passes to converge. Each pass caches what succeeded;
the seed's coverage line says when you are done. Changing the embedding model
or dimensions invalidates the index: delete `./data` and re-seed — the app
refuses a mismatched index rather than failing silently.

**Tuning.** `MIN_SCORE` is the most consequential knob: too low and the bot
answers out-of-scope questions, too high and it refuses ones the corpus
answers. 0.55 was set with enrichment on; with `ENRICHMENT=off` scores shift
down and the gate over-refuses. `TOP_K` is a floor, not a ceiling — sibling
expansion can add more, and `CONTEXT_TOKEN_BUDGET` is the real limit.

## Module map & HTTP surface

| Concern | Module |
|---|---|
| Loaders, parse, normalize, headings, chunk, enrich, embed | `lib/loaders/*`, `lib/pipeline/*` |
| [Vector store](./GLOSSARY.md#vector-store) port + LanceDB/JSON adapters | `lib/store/*` |
| [Document manifest](./GLOSSARY.md#manifest) | `lib/manifest.ts` |
| Condense, retrieve, context, answer | `lib/rag/*` |
| Gemini clients, dimension conforming | `lib/gemini.ts` |
| SSE helper, conversation persistence, config | `lib/sse.ts`, `lib/chats.ts`, `lib/config.ts` |

All routes run on the Node runtime — the pipeline needs the filesystem and
native LanceDB bindings.

| Route | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | Ask a question; streams the events above |
| `/api/ingest` | POST | Upload files; streams per-stage progress |
| `/api/documents`, `/api/documents/[id]` | GET, DELETE | List the corpus, drop a document and its vectors |
| `/api/chats`, `/api/chats/[id]` | GET, POST, PATCH, DELETE | Create, resume, rename, delete conversations |

Both streaming routes share `lib/sse.ts`, which keeps server-side work running
when a client disconnects — a closed tab must not delete the vectors of a
document that had already finished indexing.

## State on disk

Everything derived lives under `./data` (gitignored), rebuildable with
`npm run seed`:

```
data/
  lancedb/  index.json     vector store (whichever adapter is configured)
  documents.json           manifest: id, title, hash, status, chunk counts
  chats/                   persisted conversations
  uploads/                 files received through the upload zone
  enrichment-cache/        one JSON file per chunk
```
