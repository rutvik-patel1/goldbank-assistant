# GoldBank RAG Chatbot — Design

**Date:** 2026-09-10
**Status:** Approved for planning
**Purpose:** Showcase build — an end-to-end RAG system over the GoldBank knowledge base, optimized for depth and legibility of the pipeline rather than production hardening.

---

## 1. Goal

A single Next.js application that carries a document from upload through parsing,
structure-aware chunking, LLM enrichment, embedding, retrieval, and grounded
generation with deep-linked citations.

The corpus is a Firecrawl scrape of `goldbank.co.uk` — a UK gold-bullion dealer.
Ten JSON documents, each `{ markdown, metadata }`, ~87 KB total: one FAQ page and
nine legal pages (terms of service, privacy policy, cookies, delivery options,
returns, returns and exchanges, disclaimer, modern slavery statement, terms and
conditions).

### Corpus findings that drive the design

These were measured, not assumed:

| Finding | Consequence |
|---|---|
| 9 of 10 documents contain exactly **one** markdown heading (the `#` title) | An off-the-shelf markdown splitter would treat the 28 KB privacy policy as one blob and cut it at arbitrary offsets. Heading recovery is mandatory, not decorative. |
| Legal section titles appear as **unmarked Title-Case paragraphs** (`Acceptable Use`, `Which Country's Laws Apply to a Dispute`) | Structure must be reconstructed before splitting. |
| Every legal page opens with a **TOC anchor list** whose link texts are the authoritative section names, carrying real URL anchors | High-confidence heading recovery *and* deep-linkable citations. |
| `faqs.json` is dense Q&A with questions as bare paragraphs ending in `?`, under `h3` category headings | Warrants a dedicated Q&A splitter producing atomic question+answer chunks. |
| ~30 markdown table rows across cookies-policy, privacy-policy, delivery-options | Tables must never be split mid-row. |
| Trailing boilerplate (`reCAPTCHA`, `protected by reCAPTCHA`), duplicated title lines | Normalization pass required before chunking. |

---

## 2. Decisions

| Area | Decision |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript), Node runtime on all route handlers |
| Orchestration | LangChain.js 1.x (`langchain`, `@langchain/core`, `@langchain/google-genai`, `@langchain/community`) |
| Generation & enrichment | Google Gemini `gemini-3.1-flash-lite` |
| Embeddings | Google `gemini-embedding-001`, truncated to **768 dimensions** via `outputDimensionality` |
| Vector store | LanceDB (`@lancedb/lancedb`) at `./data/lancedb`, behind a swappable `VectorStore` port |
| Fallback store | Plain JSON index (`./data/index.json`, in-memory cosine scan), selected by `VECTOR_STORE=json` |
| Document registry | `./data/documents.json` manifest |
| Chat history | Server-side JSON at `./data/chats/<id>.json`, shareable by URL |
| Retrieval | Single dense path — no hybrid search, no reranker |
| Follow-ups | One condense-question Gemini call, skipped on the first turn |
| Styling | Tailwind v4, no component library |
| Automated tests | **None** (explicit scope decision). Verification is via `check-models`, `seed`, and `smoke` scripts. |

### Rejected alternatives

- **Separate Python FastAPI ingestion service** — better parsers (`unstructured`, `pymupdf`), but two runtimes and a shared data contract. Contradicts the "keep the architecture simple" constraint.
- **Hybrid search (BM25 + RRF) and LLM reranking** — the largest available accuracy gain, cut deliberately to hold the architecture simple. The corpus is small and enrichment covers much of the same ground.
- **Postgres/pgvector or Qdrant** — cut in favour of a zero-infrastructure, file-based store so `git clone && npm i && npm run seed` is the whole setup.
- **A full eval harness and glass-box inspector** — reduced to one collapsible "how this answer was built" strip in the chat UI.

---

## 3. Architecture

```
gb-chatbot/
├─ app/
│  ├─ page.tsx                      chat
│  ├─ c/[id]/page.tsx               shared conversation (read-only)
│  ├─ knowledge/page.tsx            upload + document library
│  └─ api/
│     ├─ ingest/route.ts            POST multipart → SSE progress
│     ├─ documents/route.ts         GET list · DELETE doc + vectors
│     ├─ chats/route.ts             POST create · GET list
│     ├─ chats/[id]/route.ts        GET one session
│     └─ chat/route.ts              POST {chatId, messages} → streamed answer + citations
├─ lib/
│  ├─ config.ts                     every tunable, one place
│  ├─ gemini.ts                     client construction, startup key check
│  ├─ loaders/                      pdf · docx · txt · md · html · scraped-json · zip
│  ├─ pipeline/
│  │  ├─ parse.ts                   any file → { markdown, metadata } + normalization
│  │  ├─ headings.ts                promoteHeadings(): TOC + Title-Case recovery
│  │  ├─ chunk.ts                   qa · section · table-guard splitters
│  │  ├─ enrich.ts                  per-chunk LLM enrichment + disk cache
│  │  └─ embed.ts                   batched embeddings, backoff, concurrency limit
│  ├─ store/
│  │  ├─ types.ts                   VectorStore port
│  │  ├─ lancedb.ts                 default adapter
│  │  ├─ json.ts                    fallback adapter
│  │  └─ index.ts                   adapter selection from config
│  ├─ manifest.ts                   documents.json read/write under a mutex
│  ├─ chats.ts                      chat session persistence
│  └─ rag/
│     ├─ condense.ts                conversation → standalone query
│     ├─ retrieve.ts                embed · search · gate · sibling expansion
│     ├─ context.ts                 dedupe · order · token budget · numbering
│     └─ answer.ts                  prompt · stream · citation extraction & validation
├─ knowledge-base/
│  ├─ goldbank/*.json               the 10 extracted documents — COMMITTED
│  └─ README.md                     provenance
├─ data/                            gitignored — lancedb/ · documents.json · chats/ · uploads/ · enrichment-cache/
└─ scripts/
   ├─ check-models.ts               ListModels; verify configured model IDs
   ├─ seed.ts                       headless ingest, defaults to knowledge-base/goldbank
   └─ smoke.ts                      three golden questions, assert expected sources cited
```

### The `VectorStore` port

Every consumer talks to this interface and nothing else. Switching stores is an
environment-variable change, not a refactor.

```ts
export interface VectorStore {
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  search(vector: number[], k: number, filter?: { documentId?: string }): Promise<ScoredChunk[]>;
  deleteByDocument(documentId: string): Promise<void>;
  count(): Promise<number>;
  dimensions(): Promise<number | null>;
}
```

`dimensions()` exists to support the startup assertion in §6.

### Data model

`Chunk` is the unit that is embedded and cited:

| Field | Purpose |
|---|---|
| `id`, `documentId`, `ordinal` | identity and original ordering |
| `text` | verbatim passage — what the model sees, what the UI highlights |
| `embedding` | `number[768]` |
| `headingPath` | breadcrumb, e.g. `["Terms of Service", "Acceptable Use"]` |
| `anchor` | URL fragment recovered from the TOC, e.g. `tos-acceptable-use` |
| `kind` | `"qa"` \| `"clause"` \| `"table"` \| `"prose"` |
| `question` | for `qa` chunks, the literal question text |
| `partIndex`, `partCount` | set when a section was split; drives sibling expansion |
| `summary`, `hypotheticalQuestions`, `keywords` | enrichment output |
| `sourceUrl`, `sourceTitle` | citation targets |

`Document` (in `documents.json`): `id`, `filename`, `sourceUrl`, `title`,
`contentHash`, `status` (`parsing` | `chunking` | `enriching` | `embedding` |
`ready` | `failed`), `chunkCount`, `error`, `createdAt`, `updatedAt`.

---

## 4. Ingestion

`POST /api/ingest` accepts `multipart/form-data`, writes each file to
`./data/uploads/<docId>-<name>`, and streams Server-Sent Events:

```
event: status  {"documentId":"…","stage":"parsing"}
event: status  {"documentId":"…","stage":"chunking","chunks":37}
event: status  {"documentId":"…","stage":"enriching","done":12,"total":37}
event: status  {"documentId":"…","stage":"embedding","done":20,"total":37}
event: done    {"documentId":"…","chunks":37,"ms":24310}
event: error   {"documentId":"…","message":"Encrypted PDF — password required"}
```

Every stage transition also writes through to `documents.json`, so a disconnected
browser does not lose the record.

### Parsing dispatch

Keyed by extension, every branch returning `ParsedDoc { markdown, metadata }`:

| Input | Handler | Notes |
|---|---|---|
| `.json` | scraped-json loader | Reads `{markdown, metadata}` directly; lifts `sourceURL`, `title`, `statusCode`. No conversion needed. |
| `.zip` | `unzipper` | Expands in memory, recurses through this same table. The KB zip ingests as one drop. |
| `.pdf` | `pdf-parse` | Per-page text, page numbers retained for citations. No text extracted → explicit error. |
| `.docx` | `mammoth` | → HTML → markdown, preserving heading levels. |
| `.md` / `.txt` | passthrough | Plain text gets a synthetic `# <filename>`. |
| `.html` | `turndown` | → markdown. |

### Normalization

`parse.ts` finishes with: collapse 3+ newlines; strip boilerplate matched against a
configurable pattern list (`reCAPTCHA`, `protected by reCAPTCHA`, cookie banners,
nav crumbs); drop title lines duplicated by the `h1`; normalize heading depth so
the tree starts at `h1`.

### Deduplication

SHA-256 of normalized markdown. Identical re-upload is a no-op with an "already
indexed" notice. A changed file with the same `sourceUrl` replaces the previous
version — `deleteByDocument` then re-ingest — so refreshing never orphans chunks.

### Seeding

`npm run seed` runs the identical pipeline headlessly, defaulting to
`knowledge-base/goldbank`. Idempotent by content hash.

---

## 5. Chunking & enrichment

### 5a. Heading recovery — `promoteHeadings()`

Runs before any splitting. Two independent signals:

**TOC anchors.** Harvest link texts from the leading anchor list, normalize
(lowercase, strip trailing punctuation). Any later paragraph matching one is
promoted to `##` and inherits the real URL anchor.

**Title-Case heuristic**, for sections absent from the TOC. Promote a standalone
paragraph when it is ≤ 90 chars, has no terminal period, is not a list item or
link, has ≥ 60% of words capitalized, and is followed by a sentence paragraph.

Both signals emit real markdown, so everything downstream assumes a clean tree.

### 5b. Splitters

**Q&A** (`kind: "qa"`) — a paragraph ending in `?`, under ~140 chars, followed by a
non-question paragraph opens a chunk; the chunk absorbs following paragraphs until
the next question. One atomic, self-contained chunk per question.

**Section** (`kind: "clause"`) — one chunk per recovered `##`. Over budget, it splits
at paragraph boundaries with ~15% overlap; each piece keeps the full `headingPath`
and a `partIndex`/`partCount`.

**Table guard** — a markdown table is never cut mid-row; the chunk carries the table
plus its preceding paragraph as caption context.

**Prose fallback** (`kind: "prose"`) — recursive character splitting for anything the
above do not claim. Table chunks carry `kind: "table"` so the library UI can
label them distinctly.

Chunks are prefixed with their breadcrumb at embedding time
(`Terms of Service › Acceptable Use\n\n<text>`) so the vector encodes location.
`text` remains verbatim for display and citation.

### 5c. Enrichment

One `gemini-3.1-flash-lite` call per chunk returning structured JSON:

```ts
{ summary: string, hypotheticalQuestions: string[], keywords: string[] }
```

Rationale: the corpus is legalese and users ask plain questions. *"Can I get my
money back?"* barely overlaps a clause about statutory cancellation rights under
the Financial Services Regulations 2004, but overlaps strongly with a generated
hypothetical question. **Embedded text** = breadcrumb + hypothetical questions +
summary + verbatim text. **Text shown to the model at answer time** = verbatim only.
Retrieval gets the paraphrase; generation gets the source of truth.

Bounded cost: ~110 chunks (measured), one cheap call each, cached at
`./data/enrichment-cache/<contentHash>.json`. Re-ingestion is free.
`ENRICHMENT=off` skips the stage.

### 5d. Embedding

`gemini-embedding-001` at 768 dims, batched ~64 texts per request, `p-limit`
concurrency control, exponential backoff on 429. A failed batch marks the document
`failed` with the reason rather than leaving it half-indexed.

---

## 6. Retrieval & generation

1. **Condense** — if the session has prior turns, one `gemini-3.1-flash-lite` call
   rewrites the conversation into a standalone query. Skipped on the first turn.
   The condensed query is surfaced in the UI.
2. **Embed** the query with `gemini-embedding-001` at 768 dims. `config.ts` exports
   one dimensionality constant used by both ingest and query paths, and a startup
   assertion compares it against `store.dimensions()`. A mismatch refuses to write
   and instructs a re-seed — this is the classic silent RAG failure.
3. **Search** — `store.search(vector, k=8)`.
4. **Relevance gate** — if the top score is below `MIN_SCORE` (~0.55, tunable), skip
   generation and return a grounded refusal with suggested topics.
5. **Sibling expansion** — for surviving chunks with `partIndex != null`, pull
   adjacent parts by `documentId + ordinal`, so a section cut mid-obligation is
   stitched back before the model sees it.
6. **Context assembly** — dedupe by chunk id, order by document then `ordinal`,
   fit a ~6k token budget, label each block:

```
[1] Terms of Service › Acceptable Use  (https://goldbank.co.uk/legal/terms-of-service#tos-acceptable-use)
<verbatim text>
```

7. **Generate** — `gemini-3.1-flash-lite`, streamed from the route handler. The
   system prompt: answer only from the numbered context; cite inline with `[n]`;
   if context is partial, answer what is covered and state plainly what is not;
   never give investment, tax, or legal advice. That last constraint is a real
   liability boundary for a bullion dealer, and the corpus is full of text a model
   would otherwise over-interpret.
8. **Citations** — after the stream, emit
   `[{ n, chunkId, documentTitle, headingPath, sourceUrl, anchor, snippet }]`.
   Markers referencing numbers absent from the context are stripped, not rendered
   as broken links.

---

## 7. UI

**`/` — Chat.** Streaming answer with inline `[n]` citation chips. A chip expands to
the verbatim passage with breadcrumb and an outbound deep-link to the exact section
on goldbank.co.uk. Empty state offers four seed questions drawn from the real
corpus (points system, UK delivery, order-cancellation fee, identity checks). A
collapsed "how this answer was built" strip shows the condensed query, retrieved
chunks with scores, and latency.

**`/knowledge` — Library + upload.** Drag-and-drop; per-file rows showing stage
(`parsing → chunking → enriching → embedding → ready`) from the SSE stream, chunk
counts, and in-place errors. Expanding a document lists its chunks with `kind`
badges, breadcrumbs, and enrichment output — making it visible that the FAQ page
split into atomic Q&A pairs and the privacy policy into named sections.
Delete removes document and vectors together.

**`/c/[id]`** — read-only shared conversation.

Styling: Tailwind v4. Deep neutral ground, restrained gold accent reserved for
emphasis and citations, generous type scale. No component library.

---

## 8. Error handling

| Condition | Behavior |
|---|---|
| Missing or invalid `GEMINI_API_KEY` | Startup check with a clear message, not a runtime 500 |
| Wrong model ID | `check-models.ts` fails loudly and prints the live model list |
| Rate limit (429) | Exponential backoff, then mark document `failed` with reason preserved |
| Image-only PDF | Explicit "no extractable text" error; not indexed as empty |
| Encrypted PDF | Named error |
| Embedding-dimension mismatch vs existing index | Refuse to write; instruct re-seed |
| Zero results / all below threshold | Grounded refusal with suggested topics |
| Oversized upload | Rejected at the route against a configured size limit |
| Unsupported extension | Rejected with the list of supported formats |

## 9. Verification

No automated test suite (deliberate scope decision). Verification is manual, via:

- `npm run check-models` — confirms `gemini-3.1-flash-lite` and
  `gemini-embedding-001` exist and are callable before anything else is built on
  them.
- `npm run seed` — full pipeline over the committed corpus; reports chunk counts
  per document and per `kind`.
- `npm run smoke` — asks three golden questions and asserts each answer cites the
  expected source document.

**Known exposure:** the `VectorStore` adapter equivalence and the heading-recovery
heuristics are the two places where a regression would be hard to notice by hand.
Accepted.

## 10. Out of scope

Authentication; multi-tenancy; hybrid search and reranking; a full eval harness;
OCR for scanned PDFs; live URL scraping; table-aware PDF extraction; automated
tests.
