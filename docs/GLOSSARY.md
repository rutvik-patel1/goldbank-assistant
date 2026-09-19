# Glossary

Every term of art used in [Architecture](./ARCHITECTURE.md): the concepts, the
pipeline keywords, the retrieval machinery, and every configuration variable
with the value it defaults to and what it actually controls.

---

## Core concepts

### RAG
**Retrieval-Augmented Generation.** Answering with a language model that is
handed relevant source passages at question time, instead of relying on what it
memorised in training. The model's job shrinks to reading and summarising what
it was given, with a citation per claim — which is what makes answers
checkable, current with the corpus, and capable of "I don't know". The whole
app is one RAG loop: an offline half that builds the index, an online half that
retrieves and answers.

### Grounding
Requiring every factual claim to come from a supplied passage, and treating
anything else as a failure. Enforced at four points here: the
[relevance gate](#relevance-gate), the system prompt's citation rules, that
prompt's hard limits (no investment/tax/legal advice, no price predictions, no
invented policies or timeframes), and [citation validation](#validate-citations).

### Hallucination
Fluent, confident output that no source supports. It is indistinguishable from
correct text by style alone, which is why the defences are structural rather
than stylistic — a refusal below `MIN_SCORE`, verbatim-only context, and
stripped citation markers.

### Corpus
The fixed body of documents the assistant may answer from — here, ten pages
scraped from goldbank.co.uk and committed under `knowledge-base/goldbank/`. One
is a 404 stub refused at parse time, so the indexed corpus is **9 documents /
111 chunks**. It is a boundary as much as a collection: outside it, the correct
answer is a refusal.

### Scraping
Capturing web pages as clean structured text plus provenance, rather than raw
HTML. [Firecrawl](https://www.firecrawl.dev/) returns per-page JSON with a
`markdown` body and `metadata` carrying `sourceURL`, `title` and `statusCode`.
Consequences: no DOM parsing; `sourceURL` is both the citation target and the
identity key on re-ingest; `statusCode >= 400` lets a loader refuse an error
page instead of indexing "404 Not Found" as policy.

---

## Pipeline keywords

The seven stages `lib/pipeline/ingest.ts` runs per document, in order.

### Parse
Dispatch on file extension to one loader per format, expand zips, produce a
`ParsedDoc` (markdown + metadata). Titles come from each page's own `h1`, not
the scraped `<title>` — six of nine pages share one site-wide title, which
would have made every citation from them look identical.
*Code:* `lib/pipeline/parse.ts`, `lib/loaders/*`

### Normalize
Make markdown uniform before anything reads structure from it: CRLF → LF,
collapse blank-line runs, strip boilerplate (reCAPTCHA notices, cookie banners,
skip links), remove a leading `## Title` that repeats the `# Title` below it,
guarantee an `h1`, and harvest the leading table-of-contents link list
separately — bounded to `MAX_TOC_SCAN_LINES` so an uploaded file that is *just*
links doesn't lose every line to the rule.
*Code:* `lib/pipeline/normalize.ts`

### Recover structure
Rebuild the heading tree when the source never marked one up. Nine of the ten
pages contain exactly one markdown heading; their section titles are unmarked
Title-Case paragraphs, so a stock splitter sees one 28 KB blob. Three signals:
**TOC anchors** (authoritative, and they yield real URL fragments for deep
links), **numbered sections** (`1.`…`10.` in the privacy policy, which has no
TOC), and a **Title-/sentence-case heuristic** with structural vetoes — table
rows, blockquotes, bare links, list items, shouted emphasis, `Label: value`
contact lines. Recovers 27 sections (11 `h2` + 16 `h3`) in the privacy policy.
*Code:* `lib/pipeline/headings.ts`

### Heading path
The chain of headings above a passage — `Terms of Service › Cancellation ›
Your right to cancel`. Cheap context: it tells the embedder what a passage is
about beyond its own words, tells the model where a quote came from, and gives
a citation something readable to show. Its first element is the document title.

### Chunk
Cut a document into retrievable units — small enough to be a precise hit, large
enough to stand alone. Too small and a clause loses the sentence that qualifies
it; too large and one vector represents several ideas, matching everything
weakly. Chunking dispatches on *content shape*, not character count. Sections
over `MAX_CHUNK_TOKENS` split into parts with 15% overlap, each recording
`partIndex`/`partCount` — the hooks [sibling expansion](#sibling-expansion)
uses. Every chunk carries its [heading path](#heading-path), `ordinal`,
`sourceUrl` and (when the TOC supplied one) an anchor.
*Code:* `lib/pipeline/chunk.ts`

### Chunk kinds
The four shapes a chunk can have: `qa` (one FAQ question with its answer, kept
atomic — the FAQ page yields 16, including one-word answers a
minimum-length filter would have deleted), `clause` (a recovered section of
legal text), `prose` (ordinary body text), `table` (never cut mid-row).

### Embed
Turn each chunk's text into a vector, in batches of `EMBED_BATCH_SIZE` with
retry-on-rate-limit. The embedded text is the [heading path](#heading-path)
followed by the verbatim passage. Two failure modes are explicit:
a model returning fewer dims than configured errors instead of storing a short
vector, and the client library's habit of swallowing a per-batch 429 and
substituting empty vectors is re-raised as the rate limit it is — otherwise a
transient failure would silently, permanently degrade the index.
*Code:* `lib/pipeline/embed.ts`, `lib/gemini.ts`

### Store
[Upsert](#upsert) the embedded chunks through the [`VectorStore`](#vector-store)
port. Failure semantics live one level up: identical content is skipped, changed
content replaces its prior version outright, and a failed stage deletes the
document's vectors *before* marking it failed, so nothing is left half-indexed.
*Code:* `lib/store/*`, `lib/pipeline/ingest.ts`

### Content hash
A SHA-256 fingerprint of the *normalized* markdown, so cosmetic differences —
line endings, a stripped cookie banner — don't register as a change. A document
whose hash matches an existing `ready` record is skipped unless the seed runs
with `--force`. This is what makes re-seeding an unchanged corpus free.

### Manifest
The record of *what* is indexed, separate from the vectors: id, filename,
title, source URL, content hash, status (`parsing` → `chunking` → `embedding` →
`ready`, or `failed`), chunk count, timestamps, error. A single JSON file at `data/documents.json`; all reads and writes go
through a serialized queue so concurrent ingests can't lose a record.
*Code:* `lib/manifest.ts`

---

## Retrieval & generation

The seven steps of one `POST /api/chat`.

### Condense
Rewrite a follow-up into a standalone query, because retrieval has no memory —
"Can I return it?" embedded alone is nearly meaningless. The LLM gets the last
`CONDENSE_HISTORY_TURNS` turns and resolves references while keeping the user's
vocabulary. The first turn returns the question unchanged (no call, no cost)
and any failure falls back to the raw question: an optimisation, never a hard
dependency. Note the split — the *condensed* query is searched, the *original*
question is what the answering model sees.
*Code:* `lib/rag/condense.ts`

### Top-k
How many nearest candidates a search returns. A precision/recall dial: small
`k` misses the answering passage, large `k` pads the prompt with weak matches.
`TOP_K` is a floor rather than a ceiling here — [sibling
expansion](#sibling-expansion) can add more, and the
[context budget](#context-budget) is the real limit. It says nothing about
quality; eight results always come back, however poor.

### Relevance gate
The minimum score a result must clear before the system answers at all. Ask a
bullion dealer's knowledge base about the weather and top-k still returns the
eight least-irrelevant passages in the corpus — and a model handed those will
assemble something confident and wrong out of real sentences. Below
`MIN_SCORE`, retrieval returns nothing, the route sends a fixed refusal, and
the model is never called.
*Code:* `lib/rag/retrieve.ts`

### Sibling expansion
Reunite the parts of a section that chunking had to split. Retrieval might
match only "You may cancel your order within 14 days…" while the qualifier —
"…unless the item was made to order" — sits in the part that scored just below
the cut. Both are verbatim source text, so answering from the first alone
produces a wrong answer with a real citation attached. A hit carrying
`partIndex`/`partCount` pulls its whole contiguous run by ordinal range;
siblings get a `SIBLING_SCORE_DISCOUNT` so they rank just under the chunk that
pulled them in.

### Assemble context
Turn scored chunks into the numbered prompt block: dedupe by id; sort by score
and keep chunks until the [context budget](#context-budget) binds; re-sort the
survivors into *reading* order (by document, then original position) so the
model meets coherent passages rather than a ranked list; number them `[1]`,
`[2]`, … with a matching [citation](#citation-and-deep-links) each. Context is
verbatim chunk text only.
*Code:* `lib/rag/context.ts`

### Context budget
The token ceiling on what may be pasted into the prompt —
`CONTEXT_TOKEN_BUDGET`, plus a 40-token allowance per passage header. Filling a
model's whole window is rarely optimal: cost and latency rise, and a genuinely
relevant passage competes for attention with filler.

### Generate
Stream the answer at [`CHAT_TEMPERATURE`](#temperature). The system prompt
requires inline `[n]` citations and exact figures, forbids filling gaps from
general knowledge, rules out investment/tax/legal advice and price predictions,
and forbids mentioning "context" or "passages" — it speaks as Gold Bank's
assistant.
*Code:* `lib/rag/answer.ts`

### Validate citations
Strip markers pointing at passages that were never supplied, and report which
were actually used, so no chip in the UI is dead. Only one- and two-digit
groups count as markers: this corpus quotes statutes by year, and "the
Financial Services Regulations 2004" must keep its `[2004]`. The corrected text
is sent as its own SSE event, because the client already rendered the raw
stream — otherwise a hallucinated `[7]` would show as a live chip and silently
vanish when the conversation was reopened.

### Citation and deep links
The `[1]` marker and the passage behind it: document title,
[heading path](#heading-path), source URL, anchor and a stored snippet
(`CITATION_SNIPPET_CHARS`). Deep links are limited by the source — only *Terms
of Service* publishes in-page anchors on goldbank.co.uk (23 of its 26 chunks
carry one); other citations link to the page, and a citation without an anchor
simply omits it. Nothing is fabricated.

---

## Storage & machinery

### Embedding (vector)
A list of numbers representing text's meaning, positioned so related texts land
near each other. Once text is a vector, "find passages about cancelling an
order" becomes arithmetic — embed the question the same way and take the
nearest neighbours. This is why a question can find a passage sharing none of
its words, provided both were embedded by the same model.

### Dimensions
How many numbers per vector, and the rule that every vector in one index must
agree. A 768-dim vector cannot be compared with a 1536-dim one, and a store
that allows the mix returns confident nonsense. Model output is truncated to
`EMBEDDING_DIMENSIONS` and L2-normalized (rescaled to unit length), which is
what lets cosine be computed as a dot product. `assertDimensions()` compares
stored width to configured width before every ingest and query and throws with
both numbers and the fix — the classic silent RAG bug, made loud.
*Code:* `conform()` in `lib/gemini.ts`, `lib/store/index.ts`

### Cosine similarity
A score from -1 to 1 for how closely two vectors point the same way — in
practice, how related two texts are. Direction rather than distance is what
matters: a long passage and a short question on the same topic have very
different vector lengths but nearly the same orientation. Near **1** means
"about the same thing". The JSON adapter computes cosine directly; LanceDB
returns cosine *distance* and the adapter converts it (`score = 1 - distance`)
so both agree.

### Vector store
A database whose primary operation is "give me the rows nearest this vector",
plus the ordinary insert / fetch-by-id / delete-by-document. Two adapters:
**LanceDB** (default — embedded, file-backed, native bindings, real ANN search)
and a **JSON index** (a plain file scanned in memory — inspectable, zero native
deps, fine at this corpus size). They are separate files: switching
`VECTOR_STORE` corrupts nothing, but the index seeded into one is invisible to
the other.

### Port and adapter
An interface describing *what* a dependency must do (the port) with
interchangeable implementations behind it (the adapters). `VectorStore`
(`lib/store/types.ts`) is the port; LanceDB and the JSON index are the
adapters, selected in `getStore()`. No pipeline or retrieval module imports
either engine directly, and `npm run verify:store` runs one contract test
against both.

### Upsert
Insert if absent, replace if present — one operation. Re-running an ingest must
be safe: insert-only would double every chunk, and each duplicate would be
independently retrievable and citable. Applies to chunks (`store.upsert`) and
to manifest records (`upsertDocument`).

### Token
The unit a model actually counts — roughly a word-piece, about four characters
of English. Every size limit here is expressed in tokens. `lib/tokens.ts`
counts with `gpt-tokenizer`, which is a GPT tokenizer rather than Gemini's, so
it is deliberately a *consistent proxy* used for budgeting only, never billing;
it falls back to `characters / 4` if encoding throws.

### Temperature
How much randomness the model is allowed when picking its next token. For an
assistant quoting policy, variety is a liability. Answers stream at
`CHAT_TEMPERATURE` (0.1); condensation always runs at exactly 0.
Chat clients are cached *keyed by temperature* — a single shared instance
served whichever temperature was requested first, making the setting a dead
tunable and letting ingest's 0 leak into every answer.

### SSE
**Server-Sent Events** — a one-way stream from server to browser over a plain
HTTP response. No protocol upgrade, no polling; the client only listens. One
helper (`lib/sse.ts`) backs both streaming routes. `/api/chat` emits `meta`
(condensed query, top score, whether the gate fired, every retrieved chunk) →
many `token` → `answer` (corrected) → `citations` → `done`; `/api/ingest` emits
per-stage `status`, then `done`, `error` or `skipped`. When a client
disconnects, `emit()` goes quiet but server-side work continues — if the
disconnect threw, ingest would catch it as a pipeline failure and delete the
vectors of a document that had already finished.

---

## Configuration variables

Defined in `lib/config.ts`, overridden from `.env.local`. Only `GEMINI_API_KEY`
is required.

### Credentials

| Variable | Default | What it controls |
|---|---|---|
| `GEMINI_API_KEY` | — | Required. `GOOGLE_API_KEY` is accepted as an alias. |

### Models

| Variable | Default | What it controls |
|---|---|---|
| `GEMINI_CHAT_MODEL` | `gemini-3.1-flash-lite` | [Generate](#generate) and [condense](#condense). |
| `CHAT_TEMPERATURE` | `0.1` | [Temperature](#temperature) for answers only; condense always uses 0. |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Which model produces [vectors](#embedding-vector). Changing it invalidates the index. |
| `EMBEDDING_DIMENSIONS` | `768` | [Dimensions](#dimensions) each vector is truncated to, then re-normalized. Changing it invalidates the index. |

### Store

| Variable | Default | What it controls |
|---|---|---|
| `VECTOR_STORE` | `lancedb` | Which [adapter](#vector-store) is used; `json` swaps in a plain-file index. |
| `DATA_DIR` | `./data` | Root for the index, [manifest](#manifest), chats and uploads. |

### Chunking

| Variable | Default | What it controls |
|---|---|---|
| `MAX_CHUNK_TOKENS` | `450` | Sections above this split into overlapping parts ([chunk](#chunk)). |
| `MAX_TOC_SCAN_LINES` | `60` | How far into a document the leading TOC list is harvested ([normalize](#normalize)). |

### Embedding

| Variable | Default | What it controls |
|---|---|---|
| `EMBED_BATCH_SIZE` | `64` | Chunks per embedding request. |
| `EMBED_CONCURRENCY` | `2` | Batches in flight. |
| `EMBED_MAX_RETRIES` | `5` | Rate-limit retries, exponential backoff. |

### Retrieval

| Variable | Default | What it controls |
|---|---|---|
| `TOP_K` | `8` | Candidates retrieved per query ([top-k](#top-k)). |
| `MIN_SCORE` | `0.55` | The [relevance gate](#relevance-gate): below this, refuse instead of guessing. |
| `CONTEXT_TOKEN_BUDGET` | `6000` | The [context budget](#context-budget) for assembled passages. |
| `SIBLING_SCORE_DISCOUNT` | `0.95` | Score multiplier for chunks added by [sibling expansion](#sibling-expansion). |
| `CONDENSE_HISTORY_TURNS` | `6` | Turns of history fed to [condense](#condense). |
| `CITATION_SNIPPET_CHARS` | `400` | Preview length stored with each [citation](#citation-and-deep-links). |

### Upload

| Variable | Default | What it controls |
|---|---|---|
| `MAX_UPLOAD_BYTES` | `20971520` (20 MB) | Per-file limit, enforced before parsing. |

### In-code constants

Not environment-overridable — tuned against the real corpus.

| Constant | Value | What it controls |
|---|---|---|
| `CHUNK_OVERLAP_RATIO` | `0.15` | Overlap between the parts of a split section. |
| `MIN_CHUNK_TOKENS` | `12` | Floor below which a fragment is not a chunk. |
| `MAX_QUESTION_CHARS` | `140` | Longest paragraph still treated as an FAQ question. |
| `MAX_HEADING_CHARS` / `MAX_HEADING_WORDS` | `90` / `14` | Size vetoes in [structure recovery](#recover-structure). |
| `MIN_HEADING_LETTERS` | `3` | Too few letters to be a heading. |
| `MAX_HEADING_UPPER_RATIO` | `0.9` | Rejects SHOUTED emphasis as a heading. |
| `HEADING_CAPS_RATIO` | `0.6` | How Title-Case a line must be to qualify. |
| `MAX_SENTENCE_HEADING_CHARS` / `_WORDS` | `70` / `10` | Tighter bounds for sentence-case candidates. |
| `SUPPORTED_EXTENSIONS` | `.json .zip .pdf .docx .md .txt .html .htm` | What [parse](#parse) accepts. |
| `BOILERPLATE_PATTERNS` | reCAPTCHA, cookie banners, skip links | Lines stripped during [normalize](#normalize). |

### What invalidates what

**A document** is skipped on re-seed while its [content hash](#content-hash) is
unchanged, so changing title derivation,
[structure recovery](#recover-structure) or [chunking](#chunk) only takes effect
under `npm run seed -- --force`.

**The index** is invalidated by `GEMINI_EMBEDDING_MODEL` or
`EMBEDDING_DIMENSIONS`: delete `./data` and re-seed. The app refuses a
mismatched index rather than failing silently.

**Tuning.** `MIN_SCORE` is the most consequential knob — too low and the bot
answers out-of-scope questions, too high and it refuses ones the corpus
answers. 0.55 was calibrated when chunks were embedded with LLM-generated
paraphrases alongside the passage; embedding the verbatim passage alone shifts
scores down, so re-check it against real questions.
