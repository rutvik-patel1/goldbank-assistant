# GoldBank RAG Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an end-to-end RAG chatbot over the GoldBank knowledge base that carries a document from upload through parsing, structure-aware chunking, LLM enrichment, embedding, retrieval, and grounded generation with deep-linked citations.

**Architecture:** A single Next.js 16 App Router application. All server work happens in Node-runtime route handlers. LangChain.js talks to Google Gemini for generation, query condensation, chunk enrichment, and embeddings. Chunks and vectors live in LanceDB on disk behind a swappable `VectorStore` port; a plain-JSON adapter is the escape hatch. Document registry and chat sessions are JSON files under `./data/`.

**Tech Stack:** Next.js 16.3.x, React 19, TypeScript, Tailwind CSS v4, LangChain.js 1.x (`langchain`, `@langchain/core`, `@langchain/google-genai`), `@lancedb/lancedb` 0.38.x, Google Gemini (`gemini-3.1-flash-lite`, `gemini-embedding-001`), `pdf-parse`, `mammoth`, `turndown`, `unzipper`, `p-limit`, `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-10-goldbank-rag-chatbot-design.md`

## Global Constraints

- **No automated test suite.** This is an explicit scope decision by the project owner. Do not add Vitest, Jest, Playwright, or any test runner. Every task ends with a manual verification step that runs a script and compares against stated expected output.
- **Node ≥ 20.9.0** (Next.js 16 engine requirement). The dev machine runs Node 20.19.1.
- **Every route handler must declare `export const runtime = 'nodejs'`.** LanceDB and the file parsers use native modules; the Edge runtime will fail at import time.
- **Generation, condensation, and enrichment model:** `gemini-3.1-flash-lite`. Never hardcode this string outside `lib/config.ts`.
- **Embedding model:** `gemini-embedding-001` at **768 dimensions**. Both the ingest path and the query path must use the identical model and dimensionality; a mismatch is a silent retrieval failure.
- **`lib/config.ts` is the only place tunables are defined.** No magic numbers or model names elsewhere.
- **Everything under `./data/` is derived output and gitignored.** `knowledge-base/goldbank/*.json` is committed source data.
- **Only `lib/store/index.ts` and `lib/store/*.ts` may import `@lancedb/lancedb`.** All other code depends on the `VectorStore` interface from `lib/store/types.ts`.
- **Answer-time context contains verbatim chunk text only.** Enrichment output (summaries, hypothetical questions) is embedded but must never be shown to the generation model as if it were source material.
- **Next.js 16 dynamic route params are async:** type them `{ params: Promise<{ id: string }> }` and `await params`.
- **The corpus holds 10 files but only 9 indexable documents.**
  `goldbank.co.uk_legal_returns-and-exchanges.json` was scraped as HTTP 404 and its body is a
  "404 - Page not found" stub. `loadScrapedJson` refuses any document with `statusCode >= 400`, so
  it is never indexed. Expect 9 ready documents everywhere, and treat its refusal as correct
  behaviour rather than a bug to fix.
- **Commit after every task** using the message given in that task's final step.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/config.ts` | Every tunable: model names, dimensions, `k`, thresholds, token budget, size limits, boilerplate patterns |
| `lib/gemini.ts` | Constructs the chat model and embeddings client; asserts the API key exists; truncate-and-normalize helper |
| `lib/types.ts` | `ParsedDoc`, `Chunk`, `EmbeddedChunk`, `ScoredChunk`, `DocumentRecord`, `Citation`, `ChatSession` |
| `lib/store/types.ts` | The `VectorStore` port — the single seam other code depends on |
| `lib/store/lancedb.ts` | Default adapter: LanceDB table at `./data/lancedb` |
| `lib/store/json.ts` | Fallback adapter: `./data/index.json` + in-memory cosine scan |
| `lib/store/index.ts` | Adapter selection from `config.VECTOR_STORE`; caches the instance |
| `lib/loaders/*.ts` | One file per input format, each returning `ParsedDoc` |
| `lib/pipeline/parse.ts` | Dispatch by extension; run normalization |
| `lib/pipeline/headings.ts` | `promoteHeadings()` — TOC-anchor and Title-Case recovery |
| `lib/pipeline/chunk.ts` | Q&A / section / table-guard / prose splitters |
| `lib/pipeline/enrich.ts` | Per-chunk LLM enrichment with disk cache |
| `lib/pipeline/embed.ts` | Batched embedding with concurrency limit and backoff |
| `lib/pipeline/ingest.ts` | Orchestrates parse → headings → chunk → enrich → embed → upsert, emitting progress |
| `lib/manifest.ts` | `documents.json` read/write behind a serialized queue |
| `lib/chats.ts` | Chat session persistence under `./data/chats/` |
| `lib/rag/condense.ts` | Conversation → standalone query |
| `lib/rag/retrieve.ts` | Embed query, search, relevance gate, sibling expansion |
| `lib/rag/context.ts` | Dedupe, order, token budget, numbered context blocks |
| `lib/rag/answer.ts` | System prompt, streaming generation, citation extraction and validation |
| `app/api/*/route.ts` | HTTP surface only — thin wrappers over `lib/` |
| `app/page.tsx`, `app/knowledge/page.tsx`, `app/c/[id]/page.tsx` | The three UI routes |
| `components/*.tsx` | Presentational pieces: message list, citation chip, pipeline strip, upload zone, document row |
| `scripts/check-models.ts` | Verify configured Gemini model IDs against the live ListModels response |
| `scripts/verify-*.ts` | Per-task verification harnesses run against real corpus fixtures |
| `scripts/seed.ts` | Headless ingest of the committed corpus |
| `scripts/smoke.ts` | Three golden questions end-to-end |

---

## Task 1: Scaffold, config, committed corpus, and model verification

Nothing else can be trusted until we know the configured model IDs actually exist. This task ends by proving they do.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `.env.example`, `.gitignore` (update)
- Create: `app/layout.tsx`, `app/globals.css`, `app/page.tsx` (placeholder)
- Create: `lib/config.ts`, `lib/types.ts`, `lib/gemini.ts`
- Create: `knowledge-base/goldbank/*.json` (copied from the extracted zip), `knowledge-base/README.md`
- Create: `scripts/check-models.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `config` object; `getChatModel()`, `getEmbeddings()`, `embedTexts()`, `embedQuery()`; all types in `lib/types.ts`.

- [ ] **Step 1: Scaffold the Next.js app**

```bash
cd /home/bacancy/goldbank/gb-chatbot
npx --yes create-next-app@16.3.4 . \
  --typescript --tailwind --app --eslint \
  --no-src-dir --import-alias "@/*" --use-npm --yes
```

If `create-next-app` refuses because the directory is not empty, it is safe to proceed — it preserves `docs/`, `.git/`, and `knowledge-base/`. If it hard-fails, create `package.json` manually with these dependencies and run `npm install`.

- [ ] **Step 2: Install the project dependencies**

```bash
npm install langchain@^1.5.11 @langchain/core@^1.2.10 @langchain/google-genai@^2.3.1 \
  @lancedb/lancedb@^0.38.0 \
  pdf-parse mammoth turndown unzipper p-limit gpt-tokenizer nanoid
npm install --save-dev tsx @types/turndown @types/unzipper
```

- [ ] **Step 3: Add npm scripts**

Merge into `package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "check-models": "tsx scripts/check-models.ts",
    "seed": "tsx scripts/seed.ts",
    "smoke": "tsx scripts/smoke.ts",
    "verify:parse": "tsx scripts/verify-parse.ts",
    "verify:headings": "tsx scripts/verify-headings.ts",
    "verify:chunk": "tsx scripts/verify-chunk.ts",
    "verify:store": "tsx scripts/verify-store.ts",
    "verify:retrieve": "tsx scripts/verify-retrieve.ts"
  }
}
```

- [ ] **Step 4: Copy the knowledge base into the repo**

```bash
mkdir -p knowledge-base/goldbank
cd /tmp && rm -rf kbtmp && mkdir kbtmp
unzip -q /home/bacancy/Downloads/bdcdbd9c-8a16-4399-9f65-e56026c44dcf.zip -d kbtmp
find kbtmp -name '*.json' -exec cp {} /home/bacancy/goldbank/gb-chatbot/knowledge-base/goldbank/ \;
cd /home/bacancy/goldbank/gb-chatbot
ls -1 knowledge-base/goldbank | wc -l   # expect: 10
```

- [ ] **Step 5: Write `knowledge-base/README.md`**

```markdown
# GoldBank Knowledge Base

Ten pages scraped from https://goldbank.co.uk with Firecrawl (September 2026).
Each file is `{ "markdown": string, "metadata": { sourceURL, title, statusCode, ... } }`.

One FAQ page plus nine legal pages: terms of service, privacy policy, cookies
policy, delivery options, returns policy, returns and exchanges, disclaimer,
modern slavery statement, terms and conditions.

This directory is committed source data. Run `npm run seed` to build the
derived index under `./data/` (gitignored).

Note: only `faqs.json` contains real markdown heading structure. The nine legal
pages carry exactly one `#` heading and express their section titles as
unmarked Title-Case paragraphs — see `lib/pipeline/headings.ts`.
```

- [ ] **Step 6: Write `lib/config.ts`**

```ts
function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  // Models
  CHAT_MODEL: process.env.GEMINI_CHAT_MODEL ?? 'gemini-3.1-flash-lite',
  EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
  EMBEDDING_DIMENSIONS: int('EMBEDDING_DIMENSIONS', 768),

  // Store
  VECTOR_STORE: (process.env.VECTOR_STORE ?? 'lancedb') as 'lancedb' | 'json',
  DATA_DIR: process.env.DATA_DIR ?? './data',

  // Chunking
  MAX_CHUNK_TOKENS: int('MAX_CHUNK_TOKENS', 450),
  CHUNK_OVERLAP_RATIO: 0.15,
  MAX_QUESTION_CHARS: 140,
  MAX_HEADING_CHARS: 90,
  HEADING_CAPS_RATIO: 0.6,
  MAX_SENTENCE_HEADING_CHARS: 70,
  MAX_SENTENCE_HEADING_WORDS: 10,

  // Enrichment
  ENRICHMENT: (process.env.ENRICHMENT ?? 'on') as 'on' | 'off',
  ENRICH_CONCURRENCY: int('ENRICH_CONCURRENCY', 4),

  // Embedding
  EMBED_BATCH_SIZE: int('EMBED_BATCH_SIZE', 64),
  EMBED_CONCURRENCY: int('EMBED_CONCURRENCY', 2),
  EMBED_MAX_RETRIES: int('EMBED_MAX_RETRIES', 5),

  // Retrieval
  TOP_K: int('TOP_K', 8),
  MIN_SCORE: Number(process.env.MIN_SCORE ?? 0.55),
  CONTEXT_TOKEN_BUDGET: int('CONTEXT_TOKEN_BUDGET', 6000),

  // Upload
  MAX_UPLOAD_BYTES: int('MAX_UPLOAD_BYTES', 20 * 1024 * 1024),
  SUPPORTED_EXTENSIONS: ['.json', '.zip', '.pdf', '.docx', '.md', '.txt', '.html', '.htm'] as string[],

  // Normalization: lines/blocks stripped from scraped markdown
  BOILERPLATE_PATTERNS: [
    /^reCAPTCHA$/i,
    /^Recaptcha requires verification\.?$/i,
    /^protected by \*\*reCAPTCHA\*\*$/i,
    /^Privacy\s+-\s+Terms$/i,
    /^Skip to (main )?content$/i,
    /^Accept( all)? cookies$/i,
    /^Manage cookies$/i,
  ] as RegExp[],
} as const;

export const paths = {
  data: config.DATA_DIR,
  lancedb: `${config.DATA_DIR}/lancedb`,
  jsonIndex: `${config.DATA_DIR}/index.json`,
  manifest: `${config.DATA_DIR}/documents.json`,
  chats: `${config.DATA_DIR}/chats`,
  uploads: `${config.DATA_DIR}/uploads`,
  enrichCache: `${config.DATA_DIR}/enrichment-cache`,
  corpus: 'knowledge-base/goldbank',
};
```

- [ ] **Step 7: Write `lib/types.ts`**

```ts
export type ChunkKind = 'qa' | 'clause' | 'prose' | 'table';

export interface ParsedDoc {
  markdown: string;
  metadata: {
    title: string;
    sourceUrl?: string;
    filename: string;
    contentType?: string;
    pageCount?: number;
    [k: string]: unknown;
  };
}

export interface Enrichment {
  summary: string;
  hypotheticalQuestions: string[];
  keywords: string[];
}

export interface Chunk {
  id: string;
  documentId: string;
  ordinal: number;
  text: string;
  kind: ChunkKind;
  headingPath: string[];
  anchor?: string;
  question?: string;
  partIndex?: number;
  partCount?: number;
  sourceUrl?: string;
  sourceTitle: string;
  charStart: number;
  charEnd: number;
  enrichment?: Enrichment;
}

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

export interface ScoredChunk extends Chunk {
  score: number;
}

export type DocumentStatus =
  | 'parsing' | 'chunking' | 'enriching' | 'embedding' | 'ready' | 'failed';

export interface DocumentRecord {
  id: string;
  filename: string;
  title: string;
  sourceUrl?: string;
  contentHash: string;
  status: DocumentStatus;
  chunkCount: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Citation {
  n: number;
  chunkId: string;
  documentTitle: string;
  headingPath: string[];
  sourceUrl?: string;
  anchor?: string;
  snippet: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  debug?: {
    condensedQuery?: string;
    retrieved?: { chunkId: string; score: number; headingPath: string[] }[];
    ms?: number;
  };
}

export interface ChatSession {
  id: string;
  title: string;
  turns: ChatTurn[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 8: Write `lib/gemini.ts`**

The truncate-and-normalize helper matters: `gemini-embedding-001` natively returns 3072 dimensions and supports `outputDimensionality` truncation, but if the parameter is ignored by the installed LangChain version we must not silently store 3072-dim vectors. This helper enforces the configured dimensionality either way, and re-normalizes after truncation as Google's guidance requires.

```ts
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { config } from './config';

export function requireApiKey(): string {
  const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      'Missing GEMINI_API_KEY. Create .env.local with GEMINI_API_KEY=<key from https://aistudio.google.com/apikey>',
    );
  }
  return key;
}

let chat: ChatGoogleGenerativeAI | null = null;
export function getChatModel(temperature = 0.1): ChatGoogleGenerativeAI {
  if (!chat) {
    chat = new ChatGoogleGenerativeAI({
      model: config.CHAT_MODEL,
      apiKey: requireApiKey(),
      temperature,
      maxRetries: 3,
    });
  }
  return chat;
}

let embeddings: GoogleGenerativeAIEmbeddings | null = null;
export function getEmbeddings(): GoogleGenerativeAIEmbeddings {
  if (!embeddings) {
    embeddings = new GoogleGenerativeAIEmbeddings({
      model: config.EMBEDDING_MODEL,
      apiKey: requireApiKey(),
      // Honored by @langchain/google-genai >= 2.x; enforced defensively below regardless.
      ...({ outputDimensionality: config.EMBEDDING_DIMENSIONS } as Record<string, unknown>),
    });
  }
  return embeddings;
}

/** Truncate to the configured dimensionality and L2-normalize. */
export function conform(vector: number[]): number[] {
  const d = config.EMBEDDING_DIMENSIONS;
  if (vector.length < d) {
    throw new Error(
      `Embedding model returned ${vector.length} dims, fewer than the configured ${d}. ` +
      `Lower EMBEDDING_DIMENSIONS or change EMBEDDING_MODEL.`,
    );
  }
  const v = vector.length === d ? vector : vector.slice(0, d);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  return norm > 0 ? v.map((x) => x / norm) : v;
}

/** Unwrap a LangChain message's content, which is a string or an array of parts. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : '',
      )
      .join('');
  }
  return '';
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const raw = await getEmbeddings().embedDocuments(texts);
  return raw.map(conform);
}

export async function embedQuery(text: string): Promise<number[]> {
  return conform(await getEmbeddings().embedQuery(text));
}
```

- [ ] **Step 9: Write `.env.example` and update `.gitignore`**

`.env.example`:

```
# Get a key at https://aistudio.google.com/apikey
GEMINI_API_KEY=

# Optional overrides
# GEMINI_CHAT_MODEL=gemini-3.1-flash-lite
# GEMINI_EMBEDDING_MODEL=gemini-embedding-001
# EMBEDDING_DIMENSIONS=768
# VECTOR_STORE=lancedb   # or: json
# ENRICHMENT=on          # or: off
```

Ensure `.gitignore` contains:

```
data/
node_modules/
.next/
.env*.local
```

- [ ] **Step 10: Write `scripts/check-models.ts`**

```ts
import { config } from '../lib/config';
import { requireApiKey } from '../lib/gemini';

async function main() {
  const key = requireApiKey();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`,
  );
  if (!res.ok) {
    throw new Error(`ListModels failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    models?: { name: string; supportedGenerationMethods?: string[] }[];
  };
  const names = (body.models ?? []).map((m) => m.name.replace(/^models\//, ''));

  let ok = true;
  for (const [label, wanted] of [
    ['chat', config.CHAT_MODEL],
    ['embedding', config.EMBEDDING_MODEL],
  ] as const) {
    if (names.includes(wanted)) {
      console.log(`OK    ${label}: ${wanted}`);
    } else {
      ok = false;
      const near = names.filter((n) => n.includes(wanted.split('-')[1] ?? '')).slice(0, 12);
      console.error(`FAIL  ${label}: "${wanted}" not available.`);
      console.error(`      candidates: ${near.join(', ') || names.slice(0, 20).join(', ')}`);
    }
  }

  // Confirm the embedding endpoint really returns the configured dimensionality.
  const { embedQuery } = await import('../lib/gemini');
  const v = await embedQuery('gold bullion delivery');
  console.log(`OK    embedding dimensions after conform(): ${v.length}`);

  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

- [ ] **Step 11: Verify — this is the gate for the whole project**

```bash
cp .env.example .env.local
# put your real key in .env.local, then:
npx tsx --env-file=.env.local scripts/check-models.ts
```

Expected output:

```
OK    chat: gemini-3.1-flash-lite
OK    embedding: gemini-embedding-001
OK    embedding dimensions after conform(): 768
```

If a model line reports `FAIL`, **stop and set the correct ID** in `.env.local` (`GEMINI_CHAT_MODEL=` / `GEMINI_EMBEDDING_MODEL=`) from the printed candidate list, then re-run. Do not continue to Task 2 with a failing model check.

Also confirm the app boots:

```bash
npm run dev   # then GET http://localhost:3000 → default page renders; Ctrl-C
```

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js app, config, types, Gemini client, committed corpus"
```

---

## Task 2: The `VectorStore` port and both adapters

**Files:**
- Create: `lib/store/types.ts`, `lib/store/lancedb.ts`, `lib/store/json.ts`, `lib/store/index.ts`
- Create: `scripts/verify-store.ts`

**Interfaces:**
- Consumes: `Chunk`, `EmbeddedChunk`, `ScoredChunk` from `lib/types.ts`; `config`, `paths` from `lib/config.ts`.
- Produces: `getStore(): Promise<VectorStore>` and the `VectorStore` interface with `upsert`, `search`, `deleteByDocument`, `count`, `dimensions`.

- [ ] **Step 1: Write `lib/store/types.ts`**

```ts
import type { EmbeddedChunk, ScoredChunk } from '../types';

export interface SearchFilter {
  documentId?: string;
}

export interface VectorStore {
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  search(vector: number[], k: number, filter?: SearchFilter): Promise<ScoredChunk[]>;
  /** Fetch specific chunks by id — used for sibling expansion. */
  getByIds(ids: string[]): Promise<EmbeddedChunk[]>;
  /** Fetch a contiguous ordinal range within one document — used for sibling expansion. */
  getByOrdinalRange(documentId: string, from: number, to: number): Promise<EmbeddedChunk[]>;
  deleteByDocument(documentId: string): Promise<void>;
  count(): Promise<number>;
  /** Dimensionality of stored vectors, or null when the store is empty. */
  dimensions(): Promise<number | null>;
}
```

- [ ] **Step 2: Write the row codec shared by both adapters**

Complex fields (`headingPath`, `keywords`, `hypotheticalQuestions`) are serialized to a single JSON string column. This deliberately avoids Arrow nested-list schema inference in LanceDB, which is the most common source of `upsert` failures when a field is sometimes absent.

Add to `lib/store/types.ts`:

```ts
import type { Chunk } from '../types';

export interface StoreRow {
  id: string;
  documentId: string;
  ordinal: number;
  vector: number[];
  text: string;
  kind: string;
  sourceTitle: string;
  sourceUrl: string;   // '' when absent — LanceDB dislikes nullable inference
  anchor: string;      // ''
  question: string;    // ''
  partIndex: number;   // -1 when not a split part
  partCount: number;   // -1
  charStart: number;
  charEnd: number;
  metaJson: string;    // { headingPath, enrichment }
}

export function toRow(c: EmbeddedChunk): StoreRow {
  return {
    id: c.id,
    documentId: c.documentId,
    ordinal: c.ordinal,
    vector: c.embedding,
    text: c.text,
    kind: c.kind,
    sourceTitle: c.sourceTitle,
    sourceUrl: c.sourceUrl ?? '',
    anchor: c.anchor ?? '',
    question: c.question ?? '',
    partIndex: c.partIndex ?? -1,
    partCount: c.partCount ?? -1,
    charStart: c.charStart,
    charEnd: c.charEnd,
    metaJson: JSON.stringify({ headingPath: c.headingPath, enrichment: c.enrichment ?? null }),
  };
}

export function fromRow(r: StoreRow): EmbeddedChunk {
  const meta = JSON.parse(r.metaJson) as {
    headingPath: string[];
    enrichment: Chunk['enrichment'] | null;
  };
  return {
    id: r.id,
    documentId: r.documentId,
    ordinal: r.ordinal,
    embedding: Array.from(r.vector),
    text: r.text,
    kind: r.kind as Chunk['kind'],
    sourceTitle: r.sourceTitle,
    sourceUrl: r.sourceUrl || undefined,
    anchor: r.anchor || undefined,
    question: r.question || undefined,
    partIndex: r.partIndex >= 0 ? r.partIndex : undefined,
    partCount: r.partCount >= 0 ? r.partCount : undefined,
    charStart: r.charStart,
    charEnd: r.charEnd,
    headingPath: meta.headingPath,
    enrichment: meta.enrichment ?? undefined,
  };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}
```

- [ ] **Step 3: Write `lib/store/lancedb.ts`**

```ts
import * as lancedb from '@lancedb/lancedb';
import { mkdir } from 'node:fs/promises';
import { config, paths } from '../config';
import type { EmbeddedChunk, ScoredChunk } from '../types';
import { fromRow, toRow, type SearchFilter, type StoreRow, type VectorStore } from './types';

const TABLE = 'chunks';

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

export async function createLanceStore(): Promise<VectorStore> {
  await mkdir(paths.lancedb, { recursive: true });
  const db = await lancedb.connect(paths.lancedb);

  async function table() {
    const names = await db.tableNames();
    return names.includes(TABLE) ? db.openTable(TABLE) : null;
  }

  return {
    async upsert(chunks: EmbeddedChunk[]) {
      if (chunks.length === 0) return;
      const rows = chunks.map(toRow);
      const t = await table();
      if (t) {
        // Replace any pre-existing rows with these ids, then append.
        const ids = rows.map((r) => `'${esc(r.id)}'`).join(',');
        await t.delete(`id IN (${ids})`);
        await t.add(rows);
      } else {
        await db.createTable(TABLE, rows);
      }
    },

    async search(vector, k, filter?: SearchFilter) {
      const t = await table();
      if (!t) return [];
      let q = t.search(vector).distanceType('cosine').limit(k);
      if (filter?.documentId) q = q.where(`documentId = '${esc(filter.documentId)}'`);
      const rows = (await q.toArray()) as (StoreRow & { _distance: number })[];
      return rows.map<ScoredChunk>((r) => ({
        ...fromRow(r),
        score: 1 - r._distance, // cosine distance → similarity
      }));
    },

    async getByIds(ids) {
      const t = await table();
      if (!t || ids.length === 0) return [];
      const list = ids.map((i) => `'${esc(i)}'`).join(',');
      const rows = (await t.query().where(`id IN (${list})`).toArray()) as StoreRow[];
      return rows.map(fromRow);
    },

    async getByOrdinalRange(documentId, from, to) {
      const t = await table();
      if (!t) return [];
      const rows = (await t
        .query()
        .where(`documentId = '${esc(documentId)}' AND ordinal >= ${from} AND ordinal <= ${to}`)
        .toArray()) as StoreRow[];
      return rows.map(fromRow).sort((a, b) => a.ordinal - b.ordinal);
    },

    async deleteByDocument(documentId) {
      const t = await table();
      if (!t) return;
      await t.delete(`documentId = '${esc(documentId)}'`);
    },

    async count() {
      const t = await table();
      return t ? t.countRows() : 0;
    },

    async dimensions() {
      const t = await table();
      if (!t) return null;
      const rows = (await t.query().limit(1).toArray()) as StoreRow[];
      return rows.length ? Array.from(rows[0].vector).length : null;
    },
  };
}
```

If `distanceType('cosine')` is not a method on the installed version, the alternative is `t.search(vector).select([...]).limit(k)` with the default L2 metric — since `conform()` L2-normalizes every vector, L2 distance and cosine distance are monotonically equivalent, and `score = 1 - d²/2`. Apply that variant if and only if the call throws.

- [ ] **Step 4: Write `lib/store/json.ts`**

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from '../config';
import type { EmbeddedChunk, ScoredChunk } from '../types';
import { cosine, type SearchFilter, type VectorStore } from './types';

export async function createJsonStore(): Promise<VectorStore> {
  let rows: EmbeddedChunk[] = [];
  try {
    rows = JSON.parse(await readFile(paths.jsonIndex, 'utf8')) as EmbeddedChunk[];
  } catch {
    rows = [];
  }

  async function flush() {
    await mkdir(dirname(paths.jsonIndex), { recursive: true });
    await writeFile(paths.jsonIndex, JSON.stringify(rows));
  }

  return {
    async upsert(chunks) {
      const incoming = new Set(chunks.map((c) => c.id));
      rows = rows.filter((r) => !incoming.has(r.id)).concat(chunks);
      await flush();
    },

    async search(vector, k, filter?: SearchFilter) {
      const pool = filter?.documentId
        ? rows.filter((r) => r.documentId === filter.documentId)
        : rows;
      return pool
        .map<ScoredChunk>((r) => ({ ...r, score: cosine(vector, r.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },

    async getByIds(ids) {
      const set = new Set(ids);
      return rows.filter((r) => set.has(r.id));
    },

    async getByOrdinalRange(documentId, from, to) {
      return rows
        .filter((r) => r.documentId === documentId && r.ordinal >= from && r.ordinal <= to)
        .sort((a, b) => a.ordinal - b.ordinal);
    },

    async deleteByDocument(documentId) {
      rows = rows.filter((r) => r.documentId !== documentId);
      await flush();
    },

    async count() {
      return rows.length;
    },

    async dimensions() {
      return rows.length ? rows[0].embedding.length : null;
    },
  };
}
```

- [ ] **Step 5: Write `lib/store/index.ts`**

```ts
import { config } from '../config';
import { createJsonStore } from './json';
import { createLanceStore } from './lancedb';
import type { VectorStore } from './types';

let instance: Promise<VectorStore> | null = null;

export function getStore(): Promise<VectorStore> {
  if (!instance) {
    instance = config.VECTOR_STORE === 'json' ? createJsonStore() : createLanceStore();
  }
  return instance;
}

/** Fail loudly on the classic silent RAG bug: index built at a different dimensionality. */
export async function assertDimensions(): Promise<void> {
  const store = await getStore();
  const actual = await store.dimensions();
  if (actual !== null && actual !== config.EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Index was built with ${actual}-dim vectors but EMBEDDING_DIMENSIONS is ` +
      `${config.EMBEDDING_DIMENSIONS}. Delete ./data and re-run "npm run seed".`,
    );
  }
}

export type { VectorStore } from './types';
```

- [ ] **Step 6: Write `scripts/verify-store.ts`**

This is the contract check that proves the escape hatch is real — it runs the same assertions against both adapters.

```ts
// Redirect DATA_DIR BEFORE importing lib/config: `paths` is computed at module
// evaluation time, so a later assignment would be inert and this harness would
// write its fixtures into the real ./data and clobber the seeded index.
process.env.DATA_DIR = './data/verify';

import { rm } from 'node:fs/promises';
import type { EmbeddedChunk } from '../lib/types';
import type { VectorStore } from '../lib/store/types';

const { config } = await import('../lib/config');
const { createJsonStore } = await import('../lib/store/json');
const { createLanceStore } = await import('../lib/store/lancedb');

const D = config.EMBEDDING_DIMENSIONS;

function vec(seed: number): number[] {
  const v = Array.from({ length: D }, (_, i) => Math.sin(seed * (i + 1)));
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
}

function chunk(i: number, documentId: string): EmbeddedChunk {
  return {
    id: `c${i}`, documentId, ordinal: i, text: `text ${i}`, kind: 'clause',
    headingPath: ['Doc', `Section ${i}`], sourceTitle: 'Doc',
    charStart: 0, charEnd: 6, embedding: vec(i + 1),
    partIndex: i === 2 ? 0 : undefined, partCount: i === 2 ? 2 : undefined,
  };
}

async function contract(name: string, store: VectorStore) {
  const a = [chunk(1, 'docA'), chunk(2, 'docA'), chunk(3, 'docB')];
  await store.upsert(a);

  const assert = (cond: boolean, msg: string) => {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}: ${msg}`);
    if (!cond) process.exitCode = 1;
  };

  assert((await store.count()) === 3, 'count === 3 after upsert');
  assert((await store.dimensions()) === D, `dimensions === ${D}`);

  const hits = await store.search(vec(2), 3);
  assert(hits[0].id === 'c1', 'nearest neighbour of vec(2) is c1');
  assert(hits[0].score > 0.99, `top score ~1.0 (got ${hits[0].score.toFixed(4)})`);
  assert(hits[0].headingPath[1] === 'Section 1', 'headingPath survives round-trip');

  const filtered = await store.search(vec(4), 5, { documentId: 'docB' });
  assert(filtered.length === 1 && filtered[0].documentId === 'docB', 'documentId filter works');

  const range = await store.getByOrdinalRange('docA', 1, 2);
  assert(range.length === 2 && range[0].ordinal === 1, 'ordinal range returns 2 sorted rows');

  const byId = await store.getByIds(['c3']);
  assert(byId.length === 1 && byId[0].partIndex === undefined, 'getByIds + optional field round-trip');

  await store.upsert([{ ...chunk(1, 'docA'), text: 'updated' }]);
  assert((await store.count()) === 3, 'upsert of existing id replaces, does not duplicate');
  assert((await store.getByIds(['c1']))[0].text === 'updated', 'upsert overwrites text');

  await store.deleteByDocument('docA');
  assert((await store.count()) === 1, 'deleteByDocument removed both docA rows');
}

async function main() {
  if (config.DATA_DIR !== './data/verify') {
    throw new Error(`refusing to run: DATA_DIR is "${config.DATA_DIR}", expected ./data/verify`);
  }
  await rm('./data/verify', { recursive: true, force: true });
  await contract('json   ', await createJsonStore());
  await contract('lancedb', await createLanceStore());
  await rm('./data/verify', { recursive: true, force: true });
  console.log(process.exitCode ? '\nCONTRACT FAILED' : '\nBoth adapters satisfy the contract.');
}

main();
```

- [ ] **Step 7: Verify**

```bash
npx tsx --env-file=.env.local scripts/verify-store.ts
```

Expected: every line begins `OK`, ending with `Both adapters satisfy the contract.` and exit code 0.

If the `lancedb` rows fail on `upsert`, the cause is almost always Arrow schema inference — confirm `toRow` emits no `undefined` or `null` values for any column.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: VectorStore port with LanceDB and JSON adapters"
```

---

## Task 3: Loaders, parsing, and normalization

**Files:**
- Create: `lib/loaders/scraped-json.ts`, `lib/loaders/pdf.ts`, `lib/loaders/docx.ts`, `lib/loaders/html.ts`, `lib/loaders/text.ts`, `lib/loaders/zip.ts`
- Create: `lib/pipeline/normalize.ts`, `lib/pipeline/parse.ts`
- Create: `scripts/verify-parse.ts`

**Interfaces:**
- Consumes: `ParsedDoc` from `lib/types.ts`; `config` from `lib/config.ts`.
- Produces: `parseFile(buffer: Buffer, filename: string): Promise<ParsedDoc[]>` — returns an array because a `.zip` expands to many documents. Also `normalizeMarkdown(md: string): string` and `contentHash(md: string): string`.

- [ ] **Step 1: Write `lib/loaders/scraped-json.ts`**

```ts
import type { ParsedDoc } from '../../lib/types';

interface Scraped {
  markdown?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export function loadScrapedJson(buf: Buffer, filename: string): ParsedDoc {
  const raw = JSON.parse(buf.toString('utf8')) as Scraped;
  const markdown = raw.markdown ?? raw.content;
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    throw new Error(`${filename}: JSON has no "markdown" string field`);
  }
  const meta = raw.metadata ?? {};
  const status = meta.statusCode;
  if (typeof status === 'number' && status >= 400) {
    throw new Error(`${filename}: scrape recorded HTTP ${status}; refusing to index an error page`);
  }
  return {
    markdown,
    metadata: {
      title: String(meta.title ?? filename).replace(/\s*\|\s*Gold Bank\s*$/i, '').trim(),
      sourceUrl: (meta.sourceURL ?? meta.url) as string | undefined,
      filename,
      contentType: 'application/json',
    },
  };
}
```

- [ ] **Step 2: Write `lib/loaders/pdf.ts`**

The installed `pdf-parse@2.4.5` exports a **`PDFParse` class**, not a function — there is no `default` or `pdf` export, so a v1-style import cannot work. Verified working shape: `new PDFParse({ data: Uint8Array }).getText()` resolves `{ pages, text, total }`, with `getInfo()` for document metadata and `destroy()` to release resources.

```ts
import type { ParsedDoc } from '../../lib/types';

/**
 * pdf-parse v2 exposes a class, not a function: `new PDFParse({data}).getText()`
 * resolves to `{ pages, text, total }`. It also injects `-- n of m --` page
 * separators into `text`, which must be stripped before the text is measured or
 * indexed, or an image-only PDF's separator noise would pass the emptiness guard.
 */
const PAGE_SEPARATOR = /^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm;

export async function loadPdf(buf: Buffer, filename: string): Promise<ParsedDoc> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });

  try {
    const result = await parser.getText();
    const text = result.text.replace(PAGE_SEPARATOR, '').replace(/\n{3,}/g, '\n\n').trim();
    const pageCount = result.total ?? result.pages?.length ?? 0;

    if (text.length < 40) {
      throw new Error(
        `${filename}: no extractable text (${text.length} chars across ${pageCount} pages). ` +
        `This is likely a scanned/image-only PDF; OCR is out of scope.`,
      );
    }

    let title = filename.replace(/\.pdf$/i, '');
    try {
      const info = await parser.getInfo();
      const t = (info as { info?: { Title?: unknown } }).info?.Title;
      if (typeof t === 'string' && t.trim()) title = t.trim();
    } catch {
      // Metadata is optional; the filename is a fine title.
    }

    return {
      markdown: `# ${title}\n\n${text}`,
      metadata: { title, filename, contentType: 'application/pdf', pageCount },
    };
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.startsWith(`${filename}:`)) throw e; // our own guard, already formatted
    if (/password|encrypt/i.test(msg)) {
      throw new Error(`${filename}: encrypted PDF — password required`);
    }
    throw new Error(`${filename}: could not parse PDF — ${msg}`);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
```

- [ ] **Step 3: Write `lib/loaders/docx.ts` and `lib/loaders/html.ts`**

```ts
// lib/loaders/docx.ts
import mammoth from 'mammoth';
import type { ParsedDoc } from '../../lib/types';
import { htmlToMarkdown } from './html';

export async function loadDocx(buf: Buffer, filename: string): Promise<ParsedDoc> {
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  const title = filename.replace(/\.docx$/i, '');
  const md = htmlToMarkdown(html);
  return {
    markdown: md.startsWith('#') ? md : `# ${title}\n\n${md}`,
    metadata: { title, filename, contentType: 'docx' },
  };
}
```

```ts
// lib/loaders/html.ts
import TurndownService from 'turndown';
import type { ParsedDoc } from '../../lib/types';

let td: TurndownService | null = null;
function service(): TurndownService {
  if (!td) {
    td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    td.remove(['script', 'style', 'noscript']);
  }
  return td;
}

export function htmlToMarkdown(html: string): string {
  return service().turndown(html);
}

export function loadHtml(buf: Buffer, filename: string): ParsedDoc {
  const html = buf.toString('utf8');
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || filename;
  const md = htmlToMarkdown(html);
  return {
    markdown: md.startsWith('#') ? md : `# ${title}\n\n${md}`,
    metadata: { title, filename, contentType: 'text/html' },
  };
}
```

- [ ] **Step 4: Write `lib/loaders/text.ts` and `lib/loaders/zip.ts`**

```ts
// lib/loaders/text.ts
import type { ParsedDoc } from '../../lib/types';

export function loadText(buf: Buffer, filename: string): ParsedDoc {
  const body = buf.toString('utf8');
  const isMd = /\.md$/i.test(filename);
  const title = filename.replace(/\.(md|txt)$/i, '');
  const h1 = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return {
    markdown: isMd && h1 ? body : `# ${title}\n\n${body}`,
    metadata: { title: h1 ?? title, filename, contentType: isMd ? 'text/markdown' : 'text/plain' },
  };
}
```

```ts
// lib/loaders/zip.ts
import unzipper from 'unzipper';
import type { ParsedDoc } from '../../lib/types';

/** Expand a zip in memory. Returns [filename, buffer] for each regular file. */
export async function expandZip(buf: Buffer): Promise<[string, Buffer][]> {
  const dir = await unzipper.Open.buffer(buf);
  const out: [string, Buffer][] = [];
  for (const file of dir.files) {
    if (file.type !== 'File') continue;
    const base = file.path.split('/').pop() ?? file.path;
    if (base.startsWith('.') || base.startsWith('__MACOSX')) continue;
    out.push([base, await file.buffer()]);
  }
  return out;
}
```

- [ ] **Step 5: Write `lib/pipeline/normalize.ts`**

This is where the measured corpus artifacts get cleaned. Each transformation exists because it was observed in the real files.

```ts
import { createHash } from 'node:crypto';
import { config } from '../config';

export function contentHash(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

/** Strip the leading table-of-contents anchor list, returning it separately. */
export function splitLeadingTocList(markdown: string): { toc: string[]; rest: string } {
  const lines = markdown.split('\n');
  const toc: string[] = [];
  const kept: string[] = [];
  let inLeadingRegion = true;

  for (const line of lines) {
    const m = /^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*$/.exec(line);
    if (inLeadingRegion && m) {
      toc.push(`${m[1]}\t${m[2]}`);
      continue;
    }
    // The leading region ends at the first heading that follows any harvested links.
    if (toc.length > 0 && /^#{1,6}\s/.test(line)) inLeadingRegion = false;
    kept.push(line);
  }
  return { toc, rest: kept.join('\n') };
}

export function normalizeMarkdown(markdown: string): string {
  let md = markdown.replace(/\r\n?/g, '\n');

  // Drop boilerplate lines (reCAPTCHA notices, cookie banners, skip links).
  md = md
    .split('\n')
    .filter((line) => !config.BOILERPLATE_PATTERNS.some((re) => re.test(line.trim())))
    .join('\n');

  // Remove a leading "## Title" that merely repeats the "# Title" beneath it,
  // which every scraped GoldBank page contains.
  const dup = /^\s*##\s+(.+)\n+#\s+(.+)$/m.exec(md);
  if (dup) {
    const a = dup[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    const b = dup[2].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (a && (b.includes(a) || a.includes(b))) {
      md = md.replace(/^\s*##\s+.+\n+(?=#\s)/m, '');
    }
  }

  // Collapse runs of blank lines and trim trailing whitespace per line.
  md = md.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
  md = md.replace(/\n{3,}/g, '\n\n').trim();

  // Guarantee the document starts at h1.
  if (!/^#\s/.test(md)) {
    const firstHeading = /^(#{2,6})\s+(.+)$/m.exec(md);
    if (firstHeading) md = md.replace(/^#{2,6}(\s+)/m, '#$1');
  }
  return md;
}
```

- [ ] **Step 6: Write `lib/pipeline/parse.ts`**

```ts
import { extname } from 'node:path';
import { config } from '../config';
import type { ParsedDoc } from '../types';
import { loadScrapedJson } from '../loaders/scraped-json';
import { loadPdf } from '../loaders/pdf';
import { loadDocx } from '../loaders/docx';
import { loadHtml } from '../loaders/html';
import { loadText } from '../loaders/text';
import { expandZip } from '../loaders/zip';
import { normalizeMarkdown } from './normalize';

async function loadOne(buf: Buffer, filename: string): Promise<ParsedDoc> {
  switch (extname(filename).toLowerCase()) {
    case '.json': return loadScrapedJson(buf, filename);
    case '.pdf':  return loadPdf(buf, filename);
    case '.docx': return loadDocx(buf, filename);
    case '.html':
    case '.htm':  return loadHtml(buf, filename);
    case '.md':
    case '.txt':  return loadText(buf, filename);
    default:
      throw new Error(
        `${filename}: unsupported format. Supported: ${config.SUPPORTED_EXTENSIONS.join(', ')}`,
      );
  }
}

/** Parse one uploaded file into one or more normalized documents. */
export async function parseFile(buf: Buffer, filename: string): Promise<ParsedDoc[]> {
  if (extname(filename).toLowerCase() === '.zip') {
    const members = await expandZip(buf);
    const docs: ParsedDoc[] = [];
    const errors: string[] = [];
    for (const [name, memberBuf] of members) {
      if (!config.SUPPORTED_EXTENSIONS.includes(extname(name).toLowerCase())) continue;
      if (extname(name).toLowerCase() === '.zip') continue; // no nested zips
      try {
        docs.push(await loadOne(memberBuf, name));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (docs.length === 0) {
      throw new Error(
        `${filename}: no supported documents found in archive` +
        (errors.length ? ` (${errors.length} failed: ${errors[0]})` : ''),
      );
    }
    return docs.map((d) => ({ ...d, markdown: normalizeMarkdown(d.markdown) }));
  }

  const doc = await loadOne(buf, filename);
  return [{ ...doc, markdown: normalizeMarkdown(doc.markdown) }];
}
```

- [ ] **Step 7: Write `scripts/verify-parse.ts`**

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from '../lib/config';
import { parseFile } from '../lib/pipeline/parse';

async function main() {
  const files = (await readdir(paths.corpus)).filter((f) => f.endsWith('.json')).sort();
  console.log(`corpus files: ${files.length}\n`);
  let refused = 0;
  for (const f of files) {
    let doc;
    try {
      [doc] = await parseFile(await readFile(join(paths.corpus, f)), f);
    } catch (e) {
      // One corpus page (returns-and-exchanges) was scraped as HTTP 404 and its
      // body is a "404 - Page not found" stub. Refusing it is correct behaviour,
      // not a failure: indexing it would answer policy questions from an error page.
      refused++;
      console.log(`${f.padEnd(46)} REFUSED — ${(e as Error).message}`);
      continue;
    }
    // Test for the trailing artifact BLOCK (a standalone line), not any mention:
    // the cookies-policy table legitimately documents two "Google reCAPTCHA"
    // cookies in its rows, and those must not read as boilerplate.
    const hasRecaptcha = doc.markdown
      .split('\n')
      .some((l) => /^(reCAPTCHA|Recaptcha requires verification\.?|protected by \*\*reCAPTCHA\*\*)$/i.test(l.trim()));
    const startsH1 = /^#\s/.test(doc.markdown);
    const blankRuns = /\n{3,}/.test(doc.markdown);
    console.log(
      `${f.padEnd(46)} len=${String(doc.markdown.length).padStart(6)} ` +
      `h1=${startsH1 ? 'y' : 'N'} recaptcha=${hasRecaptcha ? 'PRESENT' : 'clean'} ` +
      `blankruns=${blankRuns ? 'PRESENT' : 'clean'} url=${doc.metadata.sourceUrl ? 'y' : 'N'}`,
    );
  }
  if (refused !== 1) {
    console.log(`\nFAIL expected exactly 1 refused document (the 404 page), got ${refused}`);
    process.exitCode = 1;
  }

  // Zip path: the original archive must expand to 10 documents.
  const zip = '/home/bacancy/Downloads/bdcdbd9c-8a16-4399-9f65-e56026c44dcf.zip';
  try {
    const docs = await parseFile(await readFile(zip), 'kb.zip');
    console.log(`\nzip expansion: ${docs.length} documents (expect 9)`);
  } catch (e) {
    console.log(`\nzip expansion skipped: ${(e as Error).message}`);
  }
}

main();
```

- [ ] **Step 8: Verify**

```bash
npx tsx scripts/verify-parse.ts
```

The corpus exercises only the JSON path, so the other loaders must be proven separately against
real fixtures built under `./data/` (gitignored) and deleted afterward. The PDF path in particular
must be executed, not assumed — generate a small valid PDF and confirm `loadPdf` returns its text
and a `pageCount`.

Expected: **9** parsed lines, every one showing `h1=y`, `recaptcha=clean`, `blankruns=clean`,
`url=y` — note `recaptcha` tests for the trailing artifact *block*, so the cookies-policy table's
two legitimate "Google reCAPTCHA" cookie rows correctly do not trip it; plus exactly one `REFUSED`
line for
`goldbank.co.uk_legal_returns-and-exchanges.json`, whose message names HTTP 404. That page was
scraped as a 404 stub, so refusing it is the correct behaviour — indexing it would let the bot
answer returns questions from an error page. The zip line reads
`zip expansion: 9 documents (expect 9)`. Any `recaptcha=PRESENT` means a boilerplate pattern needs
adjusting in `config.BOILERPLATE_PATTERNS`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: format loaders, markdown normalization, parse dispatch"
```

---

## Task 4: Heading recovery

This is the task the corpus survey exists to justify. Nine of ten documents have no usable heading structure, so everything downstream depends on reconstructing it here.

**Files:**
- Create: `lib/pipeline/headings.ts`
- Create: `scripts/verify-headings.ts`

**Interfaces:**
- Consumes: `splitLeadingTocList` from `lib/pipeline/normalize.ts`; `config`.
- Produces: `promoteHeadings(markdown: string): { markdown: string; anchors: Record<string, string>; promoted: string[] }` — `anchors` maps a normalized heading title to its URL fragment; `promoted` lists the titles that were promoted, for verification output.

- [ ] **Step 1: Write `lib/pipeline/headings.ts`**

```ts
import { config } from '../config';
import { splitLeadingTocList } from './normalize';

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor',
  'of', 'on', 'or', 'the', 'to', 'up', 'via', 'with', 'is', 'are', 'be',
]);

/**
 * A numbered section title, e.g. `1\. Important information and who we are`.
 * The privacy policy numbers its eight top-level sections this way and carries
 * NO table-of-contents list, so this deterministic signal is the only reliable
 * way to recover its structure. The optional backslash is markdown's escape of
 * the period, which the scrape preserves.
 */
const NUMBERED_HEADING = /^(\d+)\\?\.\s+(.+)$/;

/**
 * A label/value line, e.g. `Postal address: 215 The Broadway, Southall, UB1 1NB`
 * or `Telephone number: 02035001111`. These are predominantly capitalized (proper
 * nouns, postcodes) and so pass a Title-Case test, but they are contact data, not
 * section titles. The corpus contains four of them in the privacy policy alone.
 */
const LABEL_LINE = /^[^:]{1,40}:\s*\S/;

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function anchorOf(url: string): string | undefined {
  const i = url.indexOf('#');
  return i >= 0 ? url.slice(i + 1) : undefined;
}

/**
 * True when a standalone line looks like a section title rendered as body text:
 * short, unpunctuated, and predominantly Title Case.
 */
export function isNumberedHeading(line: string): boolean {
  return NUMBERED_HEADING.test(line.trim());
}

/** Shape rules that disqualify a line from being any kind of heading. */
function passesBaseExclusions(t: string): boolean {
  if (t.length === 0 || t.length > config.MAX_HEADING_CHARS) return false;
  if (/^#{1,6}\s/.test(t)) return false;              // already a heading
  // List item — but a numbered heading (`1\. Title`) looks like one, so exempt it.
  if (/^\s*([-*+]|\d+[.)])\s/.test(t) && !NUMBERED_HEADING.test(t)) return false;
  if (/^[|>]/.test(t)) return false;                  // table row or blockquote
  // Terminal punctuation — but a numbered heading may legitimately be phrased as
  // a question ("3\. How is your personal data collected?"), so exempt it here too.
  // The exemption is deliberately limited to NUMBERED headings: FAQ questions also
  // end in "?" and must stay body text, because the Q&A splitter pairs each one
  // with its answer inside a section rather than treating it as a section title.
  if (/[.:;!?]$/.test(t) && !NUMBERED_HEADING.test(t)) return false;
  if (/^\*\*.*\*\*$/.test(t)) return false;           // fully bold = emphasis, not a heading
  if (/^\[.*\]\(.*\)$/.test(t)) return false;         // bare link
  if (/\]\(/.test(t)) return false;                   // contains an inline link
  if (LABEL_LINE.test(t)) return false;               // `Postal address: …` is contact data

  const letters = t.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 3) return false;
  const upperRatio = letters.replace(/[^A-Z]/g, '').length / letters.length;
  if (upperRatio > 0.9) return false;                 // SHOUTED emphasis, not a heading
  return true;
}

/** Predominantly Title Case, e.g. `Acceptable Use`, `We May Make Changes to Our Site`. */
function isTitleCaseHeading(t: string): boolean {
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 14) return false;
  const significant = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  if (significant.length === 0) return false;
  const capitalized = significant.filter((w) => /^[A-Z]/.test(w)).length;
  return capitalized / significant.length >= config.HEADING_CAPS_RATIO;
}

/**
 * Sentence case, e.g. `Purpose of this privacy policy`, `Your legal rights`.
 * The privacy policy writes its subheadings this way, so a Title-Case-only test
 * recovers 6 of its ~26 sections and leaves a 28 KB document nearly structureless.
 * Kept tight — short, few words, and comma-free — so body sentences (which end in
 * terminal punctuation and are caught above anyway) cannot slip through.
 */
function isSentenceCaseHeading(t: string): boolean {
  const words = t.split(/\s+/).filter(Boolean);
  return (
    t.length <= config.MAX_SENTENCE_HEADING_CHARS &&
    words.length <= config.MAX_SENTENCE_HEADING_WORDS &&
    /^[A-Z]/.test(t) &&
    !t.includes(',')
  );
}

/**
 * True when a standalone line looks like a section title rendered as body text.
 * Three accepting signals, any of which suffices: numbered, Title Case, or
 * sentence case. All share one set of disqualifying shape rules.
 */
export function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (!passesBaseExclusions(t)) return false;
  return NUMBERED_HEADING.test(t) || isTitleCaseHeading(t) || isSentenceCaseHeading(t);
}

/**
 * Reconstruct document structure for pages whose section titles are unmarked
 * paragraphs. Two signals: the leading TOC anchor list (authoritative, and it
 * yields real URL fragments for deep-linked citations) and a Title-Case
 * heuristic for sections the TOC omits.
 */
export function promoteHeadings(markdown: string): {
  markdown: string;
  anchors: Record<string, string>;
  promoted: string[];
} {
  const { toc, rest } = splitLeadingTocList(markdown);

  const tocAnchors: Record<string, string> = {};
  const tocTitles = new Set<string>();
  for (const entry of toc) {
    const [text, url] = entry.split('\t');
    const key = normalizeTitle(text);
    if (!key) continue;
    tocTitles.add(key);
    const a = anchorOf(url ?? '');
    if (a) tocAnchors[key] = a;
  }

  const lines = rest.split('\n');
  const out: string[] = [];
  const anchors: Record<string, string> = {};
  const promoted: string[] = [];
  let inFence = false;
  let sawNumberedSection = false;

  const nextNonBlank = (from: number): string | null => {
    for (let j = from; j < lines.length; j++) {
      if (lines[j].trim() !== '') return lines[j];
    }
    return null;
  };
  const prevIsBlankOrStart = (i: number): boolean =>
    i === 0 || lines[i - 1].trim() === '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) inFence = !inFence;

    if (inFence || !prevIsBlankOrStart(i) || line.trim() === '') {
      out.push(line);
      continue;
    }

    const key = normalizeTitle(line);
    const inToc = key.length > 0 && tocTitles.has(key);
    const heuristic = looksLikeHeading(line);

    // A heading must be followed by content, and that content must not itself
    // be a heading (two consecutive headings means we misread one of them).
    const following = nextNonBlank(i + 1);
    const followedByContent = following !== null && !/^#{1,6}\s/.test(following.trim());

    if ((inToc || heuristic) && followedByContent) {
      // Unescape markdown's `1\.` numbering: headingPath feeds citation
      // breadcrumbs in the UI, where a literal backslash would show through.
      const title = line
        .trim()
        .replace(/^\*\*|\*\*$/g, '')
        .replace(/^(\d+)\\\.(\s)/, '$1.$2');
      // Once a document has shown numbered top-level sections (the privacy
      // policy's `1\.`…`8\.`), later unnumbered titles are their subsections —
      // nesting them yields breadcrumbs like
      // `Privacy Policy › 4. How we use your personal data › Promotional offers from us`
      // instead of 26 flat siblings. Documents without numbering stay flat at h2.
      const numbered = isNumberedHeading(title);
      if (numbered) sawNumberedSection = true;
      const level = !numbered && sawNumberedSection ? '###' : '##';
      out.push(`${level} ${title}`);
      promoted.push(title);
      if (tocAnchors[key]) anchors[normalizeTitle(title)] = tocAnchors[key];
      continue;
    }

    out.push(line);
  }

  // Existing real headings also deserve their TOC anchor, when one matches.
  for (const line of out) {
    const m = /^#{1,6}\s+(.+)$/.exec(line);
    if (!m) continue;
    const key = normalizeTitle(m[1]);
    if (tocAnchors[key] && !anchors[key]) anchors[key] = tocAnchors[key];
  }

  return { markdown: out.join('\n').replace(/\n{3,}/g, '\n\n'), anchors, promoted };
}
```

- [ ] **Step 2: Write `scripts/verify-headings.ts`**

The assertions name the exact sections observed in the real files, so a regression in the heuristic shows up as a named failure rather than a changed number.

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from '../lib/config';
import { parseFile } from '../lib/pipeline/parse';
import { normalizeTitle, promoteHeadings } from '../lib/pipeline/headings';

const EXPECTED: Record<string, string[]> = {
  'goldbank.co.uk_legal_terms-of-service.json': [
    'Acceptable Use',
    'We May Make Changes to These Terms',
    'By Using Our Site You Accept These Terms',
    "Which Country's Laws Apply to a Dispute",
  ],
  'goldbank.co.uk_legal_privacy-policy.json': [],
};

async function main() {
  const files = (await readdir(paths.corpus)).filter((f) => f.endsWith('.json')).sort();
  let failed = false;

  for (const f of files) {
    const [doc] = await parseFile(await readFile(join(paths.corpus, f)), f);
    const { markdown, anchors, promoted } = promoteHeadings(doc.markdown);
    const headings = [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)];
    console.log(
      `${f.padEnd(46)} promoted=${String(promoted.length).padStart(3)} ` +
      `headings=${String(headings.length).padStart(3)} anchors=${String(Object.keys(anchors).length).padStart(3)}`,
    );

    for (const want of EXPECTED[f] ?? []) {
      const got = promoted.some((p) => normalizeTitle(p) === normalizeTitle(want));
      if (!got) {
        failed = true;
        console.log(`  FAIL expected section not recovered: "${want}"`);
      }
    }
    if (f in EXPECTED) {
      const sample = promoted.slice(0, 8).map((p) => `"${p}"`).join(', ');
      console.log(`  promoted sample: ${sample}`);
      const anchorSample = Object.entries(anchors).slice(0, 3)
        .map(([k, v]) => `${k} -> #${v}`).join(' | ');
      console.log(`  anchor sample:   ${anchorSample || '(none)'}`);
    }
  }

  console.log(failed ? '\nHEADING RECOVERY FAILED' : '\nAll expected sections recovered.');
  if (failed) process.exit(1);
}

main();
```

- [ ] **Step 3: Verify**

```bash
npx tsx scripts/verify-headings.ts
```

Expected:
- `terms-of-service` promotes roughly 20–30 sections, with all four named sections recovered and no `FAIL` lines.
- `privacy-policy` promotes roughly **26** sections. It carries NO table-of-contents list, so the
  heuristic is its only signal; its eight top-level sections are numbered (`1\.`…`8\.`) and its
  subsections are sentence case. Anything under 20 means a signal regressed. Its four label lines
  (`Postal address: …`, `Email address: …`, `Full name of legal entity: …`, `Telephone number: …`)
  must NOT appear in `promoted`.
- `anchors` is non-zero for the legal pages, and the anchor sample shows fragments like `tos-acceptable-use`.
- `faqs.json` shows a low `promoted` count — it already has real headings, and over-promotion there would be a bug.

Ends with `All expected sections recovered.`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: heading recovery via TOC anchors and Title-Case heuristic"
```

---

## Task 5: Structure-aware chunking

**Files:**
- Create: `lib/tokens.ts`, `lib/pipeline/chunk.ts`
- Create: `scripts/verify-chunk.ts`

**Interfaces:**
- Consumes: `promoteHeadings`, `normalizeTitle`; `ParsedDoc`, `Chunk`; `config`.
- Produces: `chunkDocument(doc: ParsedDoc, documentId: string): Chunk[]` and `countTokens(text: string): number`.

- [ ] **Step 1: Write `lib/tokens.ts`**

```ts
import { encode } from 'gpt-tokenizer';

/**
 * Token count used only for budgeting. This is a GPT tokenizer, not Gemini's,
 * so treat it as a consistent proxy rather than an exact count.
 */
export function countTokens(text: string): number {
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}
```

- [ ] **Step 2: Write the section walker in `lib/pipeline/chunk.ts`**

```ts
import { nanoid } from 'nanoid';
import { config } from '../config';
import { countTokens } from '../tokens';
import type { Chunk, ChunkKind, ParsedDoc } from '../types';
import { normalizeTitle, promoteHeadings } from './headings';

interface Section {
  headingPath: string[];
  body: string;
  charStart: number;
}

/** Split promoted markdown into sections, tracking the heading stack. */
function toSections(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let buf: string[] = [];
  let charStart = 0;
  let cursor = 0;

  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) {
      sections.push({ headingPath: stack.map((s) => s.title), body, charStart });
    }
    buf = [];
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+)$/.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: m[2].trim() });
      charStart = cursor + line.length + 1;
    } else {
      buf.push(line);
    }
    cursor += line.length + 1;
  }
  flush();
  return sections;
}

function paragraphs(body: string): string[] {
  return body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

function isQuestion(p: string): boolean {
  return (
    p.endsWith('?') &&
    p.length <= config.MAX_QUESTION_CHARS &&
    !p.includes('\n') &&
    !/^\s*([-*+]|\d+[.)])\s/.test(p)
  );
}

function isTableBlock(p: string): boolean {
  return /^\|/m.test(p) && p.split('\n').filter((l) => l.trim().startsWith('|')).length >= 2;
}
```

- [ ] **Step 3: Add the three splitters to `lib/pipeline/chunk.ts`**

```ts
interface Draft {
  text: string;
  kind: ChunkKind;
  headingPath: string[];
  question?: string;
  partIndex?: number;
  partCount?: number;
}

/** FAQ pages: one atomic chunk per question, absorbing its full answer. */
function splitQA(section: Section): Draft[] {
  const ps = paragraphs(section.body);
  const drafts: Draft[] = [];
  let current: { q: string; answer: string[] } | null = null;
  const preamble: string[] = [];

  for (const p of ps) {
    if (isQuestion(p)) {
      if (current) drafts.push(qaDraft(section, current));
      current = { q: p, answer: [] };
    } else if (current) {
      current.answer.push(p);
    } else {
      preamble.push(p);
    }
  }
  if (current) drafts.push(qaDraft(section, current));

  if (preamble.length) {
    drafts.unshift({
      text: preamble.join('\n\n'),
      kind: 'prose',
      headingPath: section.headingPath,
    });
  }
  return drafts;
}

function qaDraft(section: Section, c: { q: string; answer: string[] }): Draft {
  return {
    text: `${c.q}\n\n${c.answer.join('\n\n')}`.trim(),
    kind: 'qa',
    headingPath: section.headingPath,
    question: c.q,
  };
}

/** Tables stay whole, carrying the preceding paragraph as caption context. */
function splitWithTableGuard(section: Section): Draft[] {
  const ps = paragraphs(section.body);
  const drafts: Draft[] = [];
  let run: string[] = [];

  const flushRun = () => {
    if (run.length) {
      drafts.push(...packParagraphs(section, run, 'clause'));
      run = [];
    }
  };

  for (let i = 0; i < ps.length; i++) {
    if (isTableBlock(ps[i])) {
      const caption = run.length ? run[run.length - 1] : '';
      if (run.length) run = run.slice(0, -1);
      flushRun();
      drafts.push({
        text: [caption, ps[i]].filter(Boolean).join('\n\n'),
        kind: 'table',
        headingPath: section.headingPath,
      });
    } else {
      run.push(ps[i]);
    }
  }
  flushRun();
  return drafts;
}

/** Pack paragraphs into token-bounded chunks, splitting only at paragraph edges. */
function packParagraphs(section: Section, ps: string[], kind: ChunkKind): Draft[] {
  const max = config.MAX_CHUNK_TOKENS;
  const groups: string[][] = [];
  let cur: string[] = [];
  let curTokens = 0;

  for (const p of ps) {
    const t = countTokens(p);
    if (cur.length && curTokens + t > max) {
      groups.push(cur);
      // Overlap: carry the trailing paragraph forward for continuity.
      const overlapBudget = Math.floor(max * config.CHUNK_OVERLAP_RATIO);
      const last = cur[cur.length - 1];
      cur = countTokens(last) <= overlapBudget ? [last] : [];
      curTokens = cur.reduce((s, x) => s + countTokens(x), 0);
    }
    cur.push(p);
    curTokens += t;
  }
  if (cur.length) groups.push(cur);

  if (groups.length === 1) {
    return [{ text: groups[0].join('\n\n'), kind, headingPath: section.headingPath }];
  }
  return groups.map((g, i) => ({
    text: g.join('\n\n'),
    kind,
    headingPath: section.headingPath,
    partIndex: i,
    partCount: groups.length,
  }));
}
```

- [ ] **Step 4: Add the orchestrator to `lib/pipeline/chunk.ts`**

```ts
export function chunkDocument(doc: ParsedDoc, documentId: string): Chunk[] {
  const { markdown, anchors } = promoteHeadings(doc.markdown);
  const sections = toSections(markdown);
  const title = String(doc.metadata.title);
  const chunks: Chunk[] = [];
  let ordinal = 0;

  for (const section of sections) {
    const ps = paragraphs(section.body);
    const questionCount = ps.filter(isQuestion).length;

    let drafts: Draft[];
    if (questionCount >= 2) {
      drafts = splitQA(section);
    } else if (ps.some(isTableBlock)) {
      drafts = splitWithTableGuard(section);
    } else {
      drafts = packParagraphs(section, ps, 'clause');
    }

    for (const d of drafts) {
      if (countTokens(d.text) < 12) continue; // drop scraps
      const leafTitle = d.headingPath[d.headingPath.length - 1] ?? title;
      chunks.push({
        id: `${documentId}:${ordinal}:${nanoid(6)}`,
        documentId,
        ordinal: ordinal++,
        text: d.text,
        kind: d.kind,
        headingPath: [title, ...d.headingPath.filter((h) => h !== title)],
        anchor: anchors[normalizeTitle(leafTitle)],
        question: d.question,
        partIndex: d.partIndex,
        partCount: d.partCount,
        sourceUrl: doc.metadata.sourceUrl,
        sourceTitle: title,
        charStart: section.charStart,
        charEnd: section.charStart + d.text.length,
      });
    }
  }
  return chunks;
}

/** Text actually sent to the embedding model: breadcrumb + enrichment + verbatim. */
export function embeddingText(chunk: Chunk): string {
  const parts = [chunk.headingPath.join(' › ')];
  if (chunk.enrichment) {
    if (chunk.enrichment.hypotheticalQuestions.length) {
      parts.push(chunk.enrichment.hypotheticalQuestions.join(' '));
    }
    if (chunk.enrichment.summary) parts.push(chunk.enrichment.summary);
    if (chunk.enrichment.keywords.length) parts.push(chunk.enrichment.keywords.join(', '));
  }
  parts.push(chunk.text);
  return parts.join('\n\n');
}
```

- [ ] **Step 5: Write `scripts/verify-chunk.ts`**

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from '../lib/config';
import { parseFile } from '../lib/pipeline/parse';
import { chunkDocument } from '../lib/pipeline/chunk';
import { countTokens } from '../lib/tokens';
import type { Chunk } from '../lib/types';

function tableIntact(c: Chunk): boolean {
  const rows = c.text.split('\n').filter((l) => l.trim().startsWith('|'));
  if (rows.length === 0) return true;
  // A split table shows as a chunk that begins or ends mid-table.
  const firstIsRow = c.text.trim().split('\n')[0].trim().startsWith('|');
  return !(firstIsRow && rows.length === 1);
}

async function main() {
  const files = (await readdir(paths.corpus)).filter((f) => f.endsWith('.json')).sort();
  let failed = false;
  let total = 0;

  for (const f of files) {
    const [doc] = await parseFile(await readFile(join(paths.corpus, f)), f);
    const chunks = chunkDocument(doc, f.replace(/\.json$/, ''));
    total += chunks.length;

    const byKind = chunks.reduce<Record<string, number>>((acc, c) => {
      acc[c.kind] = (acc[c.kind] ?? 0) + 1;
      return acc;
    }, {});
    const maxTok = Math.max(0, ...chunks.map((c) => countTokens(c.text)));
    console.log(
      `${f.padEnd(46)} chunks=${String(chunks.length).padStart(3)} ` +
      `maxTok=${String(maxTok).padStart(4)} ${JSON.stringify(byKind)}`,
    );

    for (const c of chunks) {
      if (!tableIntact(c)) {
        failed = true;
        console.log(`  FAIL table split across chunk boundary: ${c.id}`);
      }
      if (c.headingPath.length === 0) {
        failed = true;
        console.log(`  FAIL empty headingPath: ${c.id}`);
      }
    }

    if (f.endsWith('faqs.json')) {
      const qa = chunks.filter((c) => c.kind === 'qa');
      if (qa.length < 15) {
        failed = true;
        console.log(`  FAIL expected >=15 qa chunks in faqs, got ${qa.length}`);
      }
      const points = qa.find((c) => /how does the points system work/i.test(c.question ?? ''));
      if (!points) {
        failed = true;
        console.log('  FAIL "How does the points system work?" is not its own qa chunk');
      } else {
        const oneQuestion = (points.text.match(/\?/g) ?? []).length <= 2;
        console.log(`  points chunk: ${points.text.length} chars, single-question=${oneQuestion}`);
        if (!/1 point for every £1/i.test(points.text)) {
          failed = true;
          console.log('  FAIL points chunk does not contain its own answer');
        }
      }
    }
  }

  console.log(`\ntotal chunks: ${total}`);
  console.log(failed ? 'CHUNKING FAILED' : 'Chunking assertions passed.');
  if (failed) process.exit(1);
}

main();
```

- [ ] **Step 6: Verify**

```bash
npx tsx scripts/verify-chunk.ts
```

Expected:
- `faqs.json` yields mostly `qa` chunks, at least 15 of them, and the points-system question is one chunk carrying its own answer.
- Legal pages yield mostly `clause` chunks; `cookies-policy`, `privacy-policy`, and `delivery-options` each show at least one `table` chunk.
- `maxTok` never greatly exceeds `MAX_CHUNK_TOKENS` (450) — a table chunk may legitimately exceed it, since tables are never split.
- Total across the corpus lands roughly in the 150–350 range.
- No `FAIL` lines; ends with `Chunking assertions passed.`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: structure-aware chunking with QA, section, and table-guard splitters"
```

---

## Task 6: LLM enrichment with disk cache

**Files:**
- Create: `lib/pipeline/enrich.ts`
- Create: `scripts/verify-enrich.ts`
- Modify: `package.json` (add `verify:enrich` script)

**Interfaces:**
- Consumes: `getChatModel` from `lib/gemini.ts`; `Chunk`, `Enrichment`; `config`, `paths`.
- Produces: `enrichChunks(chunks: Chunk[], onProgress?: (done: number, total: number) => void): Promise<Chunk[]>` — returns the same chunks with `enrichment` populated. Never throws for a single-chunk failure; that chunk simply keeps `enrichment: undefined`.

- [ ] **Step 1: Write `lib/pipeline/enrich.ts`**

```ts
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { config, paths } from '../config';
import { getChatModel, textOf } from '../gemini';
import type { Chunk, Enrichment } from '../types';

const PROMPT = `You are indexing a passage from a UK gold bullion dealer's website so that customer questions can find it.

Return ONLY a JSON object, no markdown fence, with exactly these keys:
{
  "summary": "one plain-language sentence describing what this passage tells a customer",
  "hypotheticalQuestions": ["2-4 questions a customer would ask that THIS passage answers, in plain everyday wording, not legal wording"],
  "keywords": ["3-8 specific terms: amounts, timeframes, product names, policy terms"]
}

Rules:
- Write the questions the way a real customer types them, not the way the passage is written.
- Do not invent facts that are absent from the passage.
- If the passage is boilerplate with no customer-relevant content, return empty arrays and a one-line summary.

Section: {{HEADING}}

Passage:
"""
{{TEXT}}
"""`;

function cacheKey(chunk: Chunk): string {
  return createHash('sha256')
    .update(`${config.CHAT_MODEL}\n${chunk.headingPath.join('>')}\n${chunk.text}`)
    .digest('hex');
}

async function readCache(key: string): Promise<Enrichment | null> {
  try {
    return JSON.parse(await readFile(join(paths.enrichCache, `${key}.json`), 'utf8')) as Enrichment;
  } catch {
    return null;
  }
}

async function writeCache(key: string, value: Enrichment): Promise<void> {
  await mkdir(paths.enrichCache, { recursive: true });
  await writeFile(join(paths.enrichCache, `${key}.json`), JSON.stringify(value));
}

function parseEnrichment(raw: string): Enrichment {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('no JSON object in model output');
  const obj = JSON.parse(cleaned.slice(start, end + 1)) as Partial<Enrichment>;
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    hypotheticalQuestions: Array.isArray(obj.hypotheticalQuestions)
      ? obj.hypotheticalQuestions.filter((q): q is string => typeof q === 'string').slice(0, 4)
      : [],
    keywords: Array.isArray(obj.keywords)
      ? obj.keywords.filter((k): k is string => typeof k === 'string').slice(0, 8)
      : [],
  };
}

async function enrichOne(chunk: Chunk): Promise<Enrichment | undefined> {
  const key = cacheKey(chunk);
  const cached = await readCache(key);
  if (cached) return cached;

  const prompt = PROMPT
    .replace('{{HEADING}}', chunk.headingPath.join(' › '))
    .replace('{{TEXT}}', chunk.text.slice(0, 6000));

  try {
    const res = await getChatModel(0).invoke(prompt);
    const text = textOf(res.content);
    const parsed = parseEnrichment(text);
    await writeCache(key, parsed);
    return parsed;
  } catch (e) {
    console.warn(`enrichment failed for ${chunk.id}: ${(e as Error).message}`);
    return undefined;
  }
}

export async function enrichChunks(
  chunks: Chunk[],
  onProgress?: (done: number, total: number) => void,
): Promise<Chunk[]> {
  if (config.ENRICHMENT === 'off') return chunks;

  const limit = pLimit(config.ENRICH_CONCURRENCY);
  let done = 0;
  return Promise.all(
    chunks.map((chunk) =>
      limit(async () => {
        const enrichment = await enrichOne(chunk);
        onProgress?.(++done, chunks.length);
        return enrichment ? { ...chunk, enrichment } : chunk;
      }),
    ),
  );
}
```

- [ ] **Step 2: Write `scripts/verify-enrich.ts`**

Enrichment is the one paid stage, so this harness runs it over a **single document** rather than the whole corpus.

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from '../lib/config';
import { parseFile } from '../lib/pipeline/parse';
import { chunkDocument, embeddingText } from '../lib/pipeline/chunk';
import { enrichChunks } from '../lib/pipeline/enrich';

async function main() {
  const f = 'goldbank.co.uk_legal_returns-policy.json';
  const [doc] = await parseFile(await readFile(join(paths.corpus, f)), f);
  const chunks = chunkDocument(doc, 'returns-policy').slice(0, 4);

  const t0 = Date.now();
  const enriched = await enrichChunks(chunks, (d, t) => process.stdout.write(`\r${d}/${t}`));
  console.log(`\nenriched ${enriched.length} chunks in ${Date.now() - t0}ms`);

  for (const c of enriched) {
    console.log(`\n--- ${c.headingPath.join(' › ')} [${c.kind}]`);
    console.log(`summary:   ${c.enrichment?.summary ?? '(none)'}`);
    console.log(`questions: ${(c.enrichment?.hypotheticalQuestions ?? []).join(' | ')}`);
    console.log(`keywords:  ${(c.enrichment?.keywords ?? []).join(', ')}`);
  }

  console.log(`\nembeddingText() sample (first 400 chars):\n${embeddingText(enriched[0]).slice(0, 400)}`);

  const t1 = Date.now();
  await enrichChunks(chunks);
  console.log(`\ncache re-run took ${Date.now() - t1}ms (expect < 100ms)`);
}

main();
```

- [ ] **Step 3: Verify**

```bash
npx tsx --env-file=.env.local scripts/verify-enrich.ts
```

Expected: four chunks enriched; every `summary` is a real sentence about returns; `questions` are plainly worded (e.g. "Can I return a gold coin I bought?") rather than restatements of the clause; the `embeddingText()` sample begins with the breadcrumb, then questions, then the verbatim passage. The cache re-run must complete in well under 100ms — that proves the cache key is stable and re-ingestion is free.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: per-chunk LLM enrichment with content-hash disk cache"
```

---

## Task 7: Embedding, manifest, ingest orchestration, and seed

**Files:**
- Create: `lib/pipeline/embed.ts`, `lib/manifest.ts`, `lib/pipeline/ingest.ts`
- Create: `scripts/seed.ts`

**Interfaces:**
- Consumes: `embedTexts` from `lib/gemini.ts`; `getStore`, `assertDimensions`; `parseFile`, `chunkDocument`, `embeddingText`, `enrichChunks`, `contentHash`.
- Produces:
  - `embedChunks(chunks: Chunk[], onProgress?): Promise<EmbeddedChunk[]>`
  - `listDocuments(): Promise<DocumentRecord[]>`, `upsertDocument(rec: DocumentRecord)`, `patchDocument(id, patch: Partial<DocumentRecord>)`, `removeDocument(id)`, `findByHash(hash)`, `findBySourceUrl(url)`
  - `ingestBuffer(buf: Buffer, filename: string, emit: (e: IngestEvent) => void): Promise<IngestResult[]>`
  - `type IngestEvent = { type: 'status'; documentId: string; stage: DocumentStatus; done?: number; total?: number; chunks?: number } | { type: 'done'; documentId: string; chunks: number; ms: number } | { type: 'error'; documentId: string; message: string } | { type: 'skipped'; documentId: string; reason: string }`

- [ ] **Step 1: Write `lib/pipeline/embed.ts`**

```ts
import pLimit from 'p-limit';
import { config } from '../config';
import { embedTexts } from '../gemini';
import type { Chunk, EmbeddedChunk } from '../types';
import { embeddingText } from './chunk';

function isRateLimit(e: unknown): boolean {
  const msg = (e as Error)?.message ?? '';
  return /429|rate|quota|RESOURCE_EXHAUSTED/i.test(msg);
}

async function embedBatchWithRetry(texts: string[]): Promise<number[][]> {
  let attempt = 0;
  for (;;) {
    try {
      return await embedTexts(texts);
    } catch (e) {
      attempt++;
      if (attempt > config.EMBED_MAX_RETRIES || !isRateLimit(e)) {
        throw new Error(`embedding failed after ${attempt} attempt(s): ${(e as Error).message}`);
      }
      const wait = Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export async function embedChunks(
  chunks: Chunk[],
  onProgress?: (done: number, total: number) => void,
): Promise<EmbeddedChunk[]> {
  const batches: Chunk[][] = [];
  for (let i = 0; i < chunks.length; i += config.EMBED_BATCH_SIZE) {
    batches.push(chunks.slice(i, i + config.EMBED_BATCH_SIZE));
  }

  const limit = pLimit(config.EMBED_CONCURRENCY);
  let done = 0;
  const results = await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        const vectors = await embedBatchWithRetry(batch.map(embeddingText));
        if (vectors.length !== batch.length) {
          throw new Error(`embedding returned ${vectors.length} vectors for ${batch.length} chunks`);
        }
        done += batch.length;
        onProgress?.(done, chunks.length);
        return batch.map<EmbeddedChunk>((c, i) => ({ ...c, embedding: vectors[i] }));
      }),
    ),
  );
  return results.flat();
}
```

- [ ] **Step 2: Write `lib/manifest.ts`**

Writes are serialized through a promise chain so two concurrent uploads cannot clobber each other's status updates.

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from './config';
import type { DocumentRecord } from './types';

let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

async function read(): Promise<DocumentRecord[]> {
  try {
    return JSON.parse(await readFile(paths.manifest, 'utf8')) as DocumentRecord[];
  } catch {
    return [];
  }
}

async function write(records: DocumentRecord[]): Promise<void> {
  await mkdir(dirname(paths.manifest), { recursive: true });
  await writeFile(paths.manifest, JSON.stringify(records, null, 2));
}

export function listDocuments(): Promise<DocumentRecord[]> {
  return serialize(read);
}

export function upsertDocument(rec: DocumentRecord): Promise<void> {
  return serialize(async () => {
    const all = await read();
    const i = all.findIndex((r) => r.id === rec.id);
    if (i >= 0) all[i] = rec;
    else all.push(rec);
    await write(all);
  });
}

export function patchDocument(id: string, patch: Partial<DocumentRecord>): Promise<void> {
  return serialize(async () => {
    const all = await read();
    const i = all.findIndex((r) => r.id === id);
    if (i < 0) return;
    all[i] = { ...all[i], ...patch, updatedAt: new Date().toISOString() };
    await write(all);
  });
}

export function removeDocument(id: string): Promise<void> {
  return serialize(async () => {
    await write((await read()).filter((r) => r.id !== id));
  });
}

export function findByHash(hash: string): Promise<DocumentRecord | undefined> {
  return serialize(async () => (await read()).find((r) => r.contentHash === hash));
}

export function findBySourceUrl(url: string): Promise<DocumentRecord | undefined> {
  return serialize(async () => (await read()).find((r) => r.sourceUrl === url));
}
```

- [ ] **Step 3: Write `lib/pipeline/ingest.ts`**

```ts
import { nanoid } from 'nanoid';
import type { DocumentRecord, DocumentStatus, ParsedDoc } from '../types';
import { getStore } from '../store';
import {
  findByHash, findBySourceUrl, patchDocument, removeDocument, upsertDocument,
} from '../manifest';
import { chunkDocument } from './chunk';
import { embedChunks } from './embed';
import { enrichChunks } from './enrich';
import { contentHash } from './normalize';
import { parseFile } from './parse';

export type IngestEvent =
  | { type: 'status'; documentId: string; stage: DocumentStatus; done?: number; total?: number; chunks?: number }
  | { type: 'done'; documentId: string; chunks: number; ms: number }
  | { type: 'error'; documentId: string; message: string }
  | { type: 'skipped'; documentId: string; reason: string };

export interface IngestResult {
  documentId: string;
  chunks: number;
  skipped?: string;
  error?: string;
}

async function ingestDoc(
  doc: ParsedDoc,
  emit: (e: IngestEvent) => void,
): Promise<IngestResult> {
  const started = Date.now();
  const hash = contentHash(doc.markdown);
  const title = String(doc.metadata.title);
  const filename = String(doc.metadata.filename);

  const identical = await findByHash(hash);
  if (identical && identical.status === 'ready') {
    emit({ type: 'skipped', documentId: identical.id, reason: 'already indexed (identical content)' });
    return { documentId: identical.id, chunks: identical.chunkCount, skipped: 'already indexed' };
  }

  // A changed document with the same source URL replaces the old version outright.
  const store = await getStore();
  if (doc.metadata.sourceUrl) {
    const prior = await findBySourceUrl(doc.metadata.sourceUrl);
    if (prior) {
      await store.deleteByDocument(prior.id);
      await removeDocument(prior.id);
    }
  }

  const documentId = nanoid(10);
  const now = new Date().toISOString();
  const record: DocumentRecord = {
    id: documentId, filename, title,
    sourceUrl: doc.metadata.sourceUrl, contentHash: hash,
    status: 'parsing', chunkCount: 0, createdAt: now, updatedAt: now,
  };
  await upsertDocument(record);

  try {
    emit({ type: 'status', documentId, stage: 'chunking' });
    await patchDocument(documentId, { status: 'chunking' });
    const chunks = chunkDocument(doc, documentId);
    if (chunks.length === 0) throw new Error('document produced no chunks after parsing');
    emit({ type: 'status', documentId, stage: 'chunking', chunks: chunks.length });

    emit({ type: 'status', documentId, stage: 'enriching', done: 0, total: chunks.length });
    await patchDocument(documentId, { status: 'enriching', chunkCount: chunks.length });
    const enriched = await enrichChunks(chunks, (done, total) =>
      emit({ type: 'status', documentId, stage: 'enriching', done, total }),
    );

    emit({ type: 'status', documentId, stage: 'embedding', done: 0, total: chunks.length });
    await patchDocument(documentId, { status: 'embedding' });
    const embedded = await embedChunks(enriched, (done, total) =>
      emit({ type: 'status', documentId, stage: 'embedding', done, total }),
    );

    await store.upsert(embedded);
    await patchDocument(documentId, { status: 'ready', chunkCount: embedded.length, error: undefined });
    const ms = Date.now() - started;
    emit({ type: 'done', documentId, chunks: embedded.length, ms });
    return { documentId, chunks: embedded.length };
  } catch (e) {
    const message = (e as Error).message;
    await patchDocument(documentId, { status: 'failed', error: message });
    await store.deleteByDocument(documentId); // never leave a half-indexed document
    emit({ type: 'error', documentId, message });
    return { documentId, chunks: 0, error: message };
  }
}

export async function ingestBuffer(
  buf: Buffer,
  filename: string,
  emit: (e: IngestEvent) => void,
): Promise<IngestResult[]> {
  let docs: ParsedDoc[];
  try {
    docs = await parseFile(buf, filename);
  } catch (e) {
    const message = (e as Error).message;
    emit({ type: 'error', documentId: filename, message });
    return [{ documentId: filename, chunks: 0, error: message }];
  }

  const results: IngestResult[] = [];
  for (const doc of docs) {
    results.push(await ingestDoc(doc, emit));
  }
  return results;
}
```

- [ ] **Step 4: Write `scripts/seed.ts`**

```ts
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config, paths } from '../lib/config';
import { assertDimensions, getStore } from '../lib/store';
import { listDocuments } from '../lib/manifest';
import { ingestBuffer, type IngestEvent } from '../lib/pipeline/ingest';

async function filesToIngest(target: string): Promise<[string, Buffer][]> {
  const s = await stat(target);
  if (s.isFile()) return [[target.split('/').pop()!, await readFile(target)]];
  const names = (await readdir(target)).filter((n) =>
    config.SUPPORTED_EXTENSIONS.some((e) => n.toLowerCase().endsWith(e)),
  );
  return Promise.all(names.sort().map(async (n) => [n, await readFile(join(target, n))] as [string, Buffer]));
}

async function main() {
  const target = process.argv[2] ?? paths.corpus;
  console.log(`seeding from: ${target}`);
  console.log(`store: ${config.VECTOR_STORE}  model: ${config.CHAT_MODEL}  ` +
              `embeddings: ${config.EMBEDDING_MODEL}@${config.EMBEDDING_DIMENSIONS}  ` +
              `enrichment: ${config.ENRICHMENT}`);
  await assertDimensions();

  const files = await filesToIngest(target);
  console.log(`${files.length} file(s)\n`);

  let ok = 0, failed = 0, skipped = 0, refusedCount = 0;
  for (const [name, buf] of files) {
    const emit = (e: IngestEvent) => {
      if (e.type === 'status' && e.done !== undefined) {
        process.stdout.write(`\r  ${name}: ${e.stage} ${e.done}/${e.total}   `);
      } else if (e.type === 'status') {
        process.stdout.write(`\r  ${name}: ${e.stage}${e.chunks ? ` (${e.chunks} chunks)` : ''}   `);
      } else if (e.type === 'done') {
        console.log(`\r  ${name}: ready — ${e.chunks} chunks in ${(e.ms / 1000).toFixed(1)}s`);
      } else if (e.type === 'skipped') {
        console.log(`\r  ${name}: skipped — ${e.reason}`);
      } else {
        console.log(`\r  ${name}: FAILED — ${e.message}`);
      }
    };
    for (const r of await ingestBuffer(buf, name, emit)) {
      // A page the loaders deliberately reject (e.g. a scraped 404) is refused
      // input, not a broken pipeline — it must not fail the seed run.
      if (r.error && /error page|HTTP 4\d\d/i.test(r.error)) refusedCount++;
      else if (r.error) failed++;
      else if (r.skipped) skipped++;
      else ok++;
    }
  }

  const store = await getStore();
  const docs = await listDocuments();
  console.log(`\nindexed ${ok} document(s), skipped ${skipped}, refused ${refusedCount}, failed ${failed}`);
  console.log(`manifest: ${docs.length} record(s), ${docs.filter((d) => d.status === 'ready').length} ready`);
  console.log(`vectors in store: ${await store.count()}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

- [ ] **Step 5: Verify**

```bash
rm -rf data
npx tsx --env-file=.env.local scripts/seed.ts
```

Expected: **nine** `ready` lines plus one `FAILED` line for the returns-and-exchanges 404 stub,
then a summary reading `indexed 9 document(s), skipped 0, refused 1, failed 0`, a manifest of 9
records all ready, and a vector count matching the total from Task 5's verification. Exit code must
be 0 — a refused source page is not a seed failure. First run takes a couple of minutes
(enrichment); note the elapsed time.

Then confirm idempotency and the cache:

```bash
npx tsx --env-file=.env.local scripts/seed.ts
```

Expected: **nine** `skipped — already indexed (identical content)` lines,
`indexed 0 document(s), skipped 9, refused 1, failed 0`, and the same vector count. This run should
take seconds.

Also confirm the escape hatch end-to-end:

```bash
rm -rf data && VECTOR_STORE=json npx tsx --env-file=.env.local scripts/seed.ts
ls -la data/index.json    # exists
rm -rf data && npx tsx --env-file=.env.local scripts/seed.ts   # back to lancedb
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: batched embedding, document manifest, ingest orchestration, seed script"
```

---

## Task 8: Ingest and documents HTTP routes

**Files:**
- Create: `app/api/ingest/route.ts`, `app/api/documents/route.ts`, `app/api/documents/[id]/route.ts`
- Create: `lib/sse.ts`

**Interfaces:**
- Consumes: `ingestBuffer`, `IngestEvent`; `listDocuments`, `removeDocument`; `getStore`; `config`.
- Produces: HTTP contract — `POST /api/ingest` (multipart, SSE response), `GET /api/documents` → `{ documents: DocumentRecord[]; vectorCount: number }`, `DELETE /api/documents/[id]` → `{ ok: true }`, `GET /api/documents?documentId=x` → `{ chunks: Chunk[] }` for the library's expandable chunk view.

- [ ] **Step 1: Write `lib/sse.ts`**

```ts
export function sseStream<T>(
  run: (emit: (event: string, data: T) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: T) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await run(emit);
      } catch (e) {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ message: (e as Error).message })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

- [ ] **Step 2: Write `app/api/ingest/route.ts`**

```ts
import { extname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, paths } from '@/lib/config';
import { sseStream } from '@/lib/sse';
import { assertDimensions } from '@/lib/store';
import { ingestBuffer, type IngestEvent } from '@/lib/pipeline/ingest';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return Response.json({ error: 'No files provided under the "files" field.' }, { status: 400 });
  }

  for (const file of files) {
    if (file.size > config.MAX_UPLOAD_BYTES) {
      return Response.json(
        { error: `${file.name} is ${(file.size / 1e6).toFixed(1)}MB; the limit is ${(config.MAX_UPLOAD_BYTES / 1e6).toFixed(0)}MB.` },
        { status: 413 },
      );
    }
    if (!config.SUPPORTED_EXTENSIONS.includes(extname(file.name).toLowerCase())) {
      return Response.json(
        { error: `${file.name}: unsupported format. Supported: ${config.SUPPORTED_EXTENSIONS.join(', ')}` },
        { status: 415 },
      );
    }
  }

  return sseStream<IngestEvent | { message: string }>(async (emit) => {
    await assertDimensions();
    await mkdir(paths.uploads, { recursive: true });

    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(join(paths.uploads, `${Date.now()}-${file.name}`), buf);
      emit('status', { type: 'status', documentId: file.name, stage: 'parsing' } as IngestEvent);
      await ingestBuffer(buf, file.name, (e) => emit(e.type, e));
    }
  });
}
```

- [ ] **Step 3: Write `app/api/documents/route.ts`**

```ts
import { listDocuments } from '@/lib/manifest';
import { getStore } from '@/lib/store';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const documentId = new URL(req.url).searchParams.get('documentId');
  const store = await getStore();

  if (documentId) {
    // Chunks for one document, ordered — powers the expandable library view.
    const chunks = await store.getByOrdinalRange(documentId, 0, Number.MAX_SAFE_INTEGER);
    return Response.json({
      chunks: chunks.map(({ embedding: _embedding, ...rest }) => rest),
    });
  }

  return Response.json({
    documents: (await listDocuments()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    vectorCount: await store.count(),
  });
}
```

- [ ] **Step 4: Write `app/api/documents/[id]/route.ts`**

```ts
import { removeDocument } from '@/lib/manifest';
import { getStore } from '@/lib/store';

export const runtime = 'nodejs';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const store = await getStore();
  await store.deleteByDocument(id);
  await removeDocument(id);
  return Response.json({ ok: true });
}
```

- [ ] **Step 5: Verify**

```bash
npm run dev
```

In a second terminal:

```bash
# Listing reflects the seeded corpus
curl -s localhost:3000/api/documents | head -c 400
# expect: {"documents":[...10 records, status "ready"...],"vectorCount":<N>}

# Chunk view for one document
DOC=$(curl -s localhost:3000/api/documents | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).documents[0].id))')
curl -s "localhost:3000/api/documents?documentId=$DOC" | head -c 300
# expect: {"chunks":[{"id":...,"headingPath":[...],"kind":"..."}...]} with no "embedding" field

# Upload streams SSE stages
curl -N -s -F "files=@knowledge-base/goldbank/goldbank.co.uk_faqs.json" localhost:3000/api/ingest
# expect: event: status (parsing) ... then event: skipped (already indexed)

# Rejections
curl -s -F "files=@package.json" localhost:3000/api/ingest
# expect: HTTP 415 with the supported-formats list

# Deletion removes vectors and the record
curl -s -X DELETE "localhost:3000/api/documents/$DOC"    # {"ok":true}
curl -s localhost:3000/api/documents | head -c 200        # 9 documents, lower vectorCount
npx tsx --env-file=.env.local scripts/seed.ts             # re-add the deleted document
```

Confirm the SSE upload of a genuinely new document streams `enriching` and `embedding` progress by copying a corpus file to a new name first:

```bash
sed 's/Frequently Asked Questions/Frequently Asked Questions (copy)/' \
  knowledge-base/goldbank/goldbank.co.uk_faqs.json > /tmp/faq-copy.json
curl -N -s -F "files=@/tmp/faq-copy.json" localhost:3000/api/ingest
# expect: chunking → enriching 1/N…N/N → embedding → done
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: ingest SSE route and documents API"
```

---

## Task 9: Retrieval — condense, search, gate, sibling expansion, context

**Files:**
- Create: `lib/rag/condense.ts`, `lib/rag/retrieve.ts`, `lib/rag/context.ts`
- Create: `scripts/verify-retrieve.ts`

**Interfaces:**
- Consumes: `getChatModel`, `embedQuery`; `getStore`, `assertDimensions`; `countTokens`; `ScoredChunk`, `ChatTurn`, `Citation`; `config`.
- Produces:
  - `condenseQuery(turns: ChatTurn[], question: string): Promise<string>`
  - `retrieve(query: string): Promise<{ chunks: ScoredChunk[]; gated: boolean; topScore: number }>`
  - `buildContext(chunks: ScoredChunk[]): { context: string; citations: Citation[] }`

- [ ] **Step 1: Write `lib/rag/condense.ts`**

```ts
import { getChatModel, textOf } from '../gemini';
import type { ChatTurn } from '../types';

const PROMPT = `Rewrite the user's latest message as a single standalone search query for a knowledge base about Gold Bank, a UK gold bullion dealer.

Rules:
- Resolve pronouns and references using the conversation.
- Keep the user's own vocabulary; do not answer the question.
- Output ONLY the query, one line, no quotes, no preamble.

Conversation:
{{HISTORY}}

Latest message: {{QUESTION}}

Standalone query:`;

/** Returns the question unchanged on the first turn — no call, no cost. */
export async function condenseQuery(turns: ChatTurn[], question: string): Promise<string> {
  const history = turns.filter((t) => t.content.trim() !== '');
  if (history.length === 0) return question;

  const rendered = history
    .slice(-6)
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content.slice(0, 500)}`)
    .join('\n');

  try {
    const res = await getChatModel(0).invoke(
      PROMPT.replace('{{HISTORY}}', rendered).replace('{{QUESTION}}', question),
    );
    const text = textOf(res.content);
    const line = text.trim().split('\n')[0].replace(/^["']|["']$/g, '').trim();
    return line.length >= 3 ? line : question;
  } catch {
    return question; // condensation is an optimisation, never a hard dependency
  }
}
```

- [ ] **Step 2: Write `lib/rag/retrieve.ts`**

```ts
import { config } from '../config';
import { embedQuery } from '../gemini';
import { assertDimensions, getStore } from '../store';
import type { ScoredChunk } from '../types';

export interface RetrievalResult {
  chunks: ScoredChunk[];
  gated: boolean;
  topScore: number;
}

/**
 * Reunite chunks that were split from one oversized section. A clause cut in
 * two mid-obligation must reach the model whole.
 */
async function expandSiblings(hits: ScoredChunk[]): Promise<ScoredChunk[]> {
  const store = await getStore();
  const byId = new Map(hits.map((c) => [c.id, c]));

  for (const hit of hits) {
    if (hit.partIndex === undefined || hit.partCount === undefined) continue;
    const span = hit.partCount;
    const from = Math.max(0, hit.ordinal - hit.partIndex);
    const siblings = await store.getByOrdinalRange(hit.documentId, from, from + span - 1);
    for (const s of siblings) {
      if (byId.has(s.id)) continue;
      // Siblings inherit a slightly discounted score so ordering stays sensible.
      byId.set(s.id, { ...s, score: hit.score * 0.95 });
    }
  }
  return [...byId.values()];
}

export async function retrieve(query: string): Promise<RetrievalResult> {
  await assertDimensions();
  const store = await getStore();

  const vector = await embedQuery(query);
  const hits = await store.search(vector, config.TOP_K);

  const topScore = hits.length ? hits[0].score : 0;
  if (hits.length === 0 || topScore < config.MIN_SCORE) {
    return { chunks: [], gated: true, topScore };
  }

  const expanded = await expandSiblings(hits);
  return { chunks: expanded, gated: false, topScore };
}
```

- [ ] **Step 3: Write `lib/rag/context.ts`**

```ts
import { config } from '../config';
import { countTokens } from '../tokens';
import type { Citation, ScoredChunk } from '../types';

/**
 * Order retrieved chunks the way a reader would meet them — grouped by
 * document, then by original position — and number them for citation.
 * Answer-time context is verbatim chunk text only; enrichment never appears.
 */
export function buildContext(chunks: ScoredChunk[]): { context: string; citations: Citation[] } {
  const seen = new Set<string>();
  const unique = chunks.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));

  // Keep the strongest chunks when the budget binds, but present them in
  // document order so the model reads coherent passages.
  const ranked = [...unique].sort((a, b) => b.score - a.score);
  const kept: ScoredChunk[] = [];
  let tokens = 0;
  for (const c of ranked) {
    const t = countTokens(c.text) + 40; // header allowance
    if (tokens + t > config.CONTEXT_TOKEN_BUDGET && kept.length > 0) continue;
    kept.push(c);
    tokens += t;
  }

  kept.sort((a, b) =>
    a.documentId === b.documentId
      ? a.ordinal - b.ordinal
      : a.sourceTitle.localeCompare(b.sourceTitle),
  );

  const citations: Citation[] = [];
  const blocks: string[] = [];

  kept.forEach((c, i) => {
    const n = i + 1;
    const url = c.sourceUrl
      ? c.anchor ? `${c.sourceUrl}#${c.anchor}` : c.sourceUrl
      : undefined;
    const header = `[${n}] ${c.headingPath.join(' › ')}${url ? `  (${url})` : ''}`;
    blocks.push(`${header}\n${c.text}`);
    citations.push({
      n,
      chunkId: c.id,
      documentTitle: c.sourceTitle,
      headingPath: c.headingPath,
      sourceUrl: c.sourceUrl,
      anchor: c.anchor,
      snippet: c.text.slice(0, 400),
    });
  });

  return { context: blocks.join('\n\n---\n\n'), citations };
}
```

- [ ] **Step 4: Write `scripts/verify-retrieve.ts`**

```ts
import { condenseQuery } from '../lib/rag/condense';
import { retrieve } from '../lib/rag/retrieve';
import { buildContext } from '../lib/rag/context';
import { config } from '../lib/config';
import type { ChatTurn } from '../lib/types';

const CASES: { q: string; expectDoc: RegExp }[] = [
  { q: 'How do I earn points when I sell gold to you?', expectDoc: /FAQ/i },
  { q: 'Do you deliver outside the UK?',                expectDoc: /FAQ|Delivery/i },
  { q: 'What happens if I cancel my order?',            expectDoc: /FAQ|Terms|Returns/i },
  { q: 'Can I get my money back on a purchase?',        expectDoc: /Returns|Terms|FAQ/i },
  { q: 'What cookies does the site set?',               expectDoc: /Cookie/i },
];

async function main() {
  let failed = false;

  for (const c of CASES) {
    const { chunks, gated, topScore } = await retrieve(c.q);
    const { context, citations } = buildContext(chunks);
    const docs = [...new Set(citations.map((x) => x.documentTitle))];
    const hit = docs.some((d) => c.expectDoc.test(d));

    console.log(`\nQ: ${c.q}`);
    console.log(`   top=${topScore.toFixed(3)} gated=${gated} chunks=${chunks.length} ` +
                `contextTokens≈${Math.round(context.length / 4)}`);
    console.log(`   docs: ${docs.join(' | ')}`);
    console.log(`   [1] ${citations[0]?.headingPath.join(' › ') ?? '(none)'}` +
                `${citations[0]?.anchor ? ` #${citations[0].anchor}` : ''}`);
    if (gated || !hit) {
      failed = true;
      console.log(`   FAIL expected a document matching ${c.expectDoc}`);
    }
  }

  // The gate must fire on something genuinely absent from the corpus.
  const off = await retrieve('What is the airspeed velocity of an unladen swallow?');
  console.log(`\noff-topic: top=${off.topScore.toFixed(3)} gated=${off.gated} ` +
              `(MIN_SCORE=${config.MIN_SCORE})`);
  if (!off.gated) {
    console.log('   NOTE gate did not fire — consider raising MIN_SCORE');
  }

  // Condensation must resolve a pronoun-only follow-up.
  const turns: ChatTurn[] = [
    { role: 'user', content: 'How long does delivery take?' },
    { role: 'assistant', content: 'Standard delivery takes 2-5 working days.' },
  ];
  const condensed = await condenseQuery(turns, 'and what about outside the UK?');
  console.log(`\ncondensed: "${condensed}"`);
  if (!/uk|deliver|ship/i.test(condensed)) {
    failed = true;
    console.log('   FAIL condensed query lost the delivery subject');
  }

  console.log(failed ? '\nRETRIEVAL FAILED' : '\nRetrieval assertions passed.');
  if (failed) process.exit(1);
}

main();
```

- [ ] **Step 5: Verify**

```bash
npx tsx --env-file=.env.local scripts/verify-retrieve.ts
```

Expected: all five cases retrieve from a plausible document with `gated=false` and `top` above `MIN_SCORE`; citation `[1]` shows a real breadcrumb, and legal-page hits show an `#anchor`. The off-topic query should report `gated=true` — if it does not, raise `MIN_SCORE` in `.env.local` until it does and record the value. The condensed follow-up must mention delivery and the UK.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: query condensation, retrieval with relevance gate and sibling expansion"
```

---

## Task 10: Answer generation, chat persistence, chat API

**Files:**
- Create: `lib/rag/answer.ts`, `lib/chats.ts`
- Create: `app/api/chat/route.ts`, `app/api/chats/route.ts`, `app/api/chats/[id]/route.ts`

**Interfaces:**
- Consumes: `getChatModel`; `condenseQuery`, `retrieve`, `buildContext`; `Citation`, `ChatSession`, `ChatTurn`.
- Produces:
  - `streamAnswer(question, context, citations): AsyncGenerator<string>` plus `validateCitations(answer, citations): { answer: string; used: Citation[] }`
  - `createChat()`, `getChat(id)`, `listChats()`, `appendTurn(id, turn)`
  - `POST /api/chat` → SSE with `event: meta` (condensed query + retrieved debug), `event: token`, `event: citations`, `event: done`

- [ ] **Step 1: Write `lib/rag/answer.ts`**

```ts
import { getChatModel, textOf } from '../gemini';
import type { Citation } from '../types';

export const SYSTEM_PROMPT = `You are the Gold Bank assistant. Gold Bank is a UK gold bullion dealer. You answer customer questions using ONLY the numbered context passages supplied below.

How to answer:
- Ground every factual statement in the context. Cite the passage with its number in square brackets, like [1] or [2][3], immediately after the statement it supports.
- Quote exact figures, fees, and timeframes from the context rather than paraphrasing them loosely.
- If the context answers part of the question, answer that part and then say plainly which part you do not have information about.
- If the context does not answer the question at all, say so and suggest what the customer could ask instead. Never fill the gap from general knowledge.
- Be concise and direct. Use short paragraphs, and a bulleted list when the context itself is a list.

Hard limits:
- Never give investment, tax, or legal advice, and never predict gold prices. If asked, say that Gold Bank cannot advise on this and point to the relevant policy in the context if there is one.
- Never invent policies, prices, phone numbers, or timeframes.
- Never mention "context", "passages", or "the documents" — speak as Gold Bank's assistant.`;

export function buildUserPrompt(question: string, context: string): string {
  return `Context passages:\n\n${context}\n\n---\n\nCustomer question: ${question}`;
}

export async function* streamAnswer(question: string, context: string): AsyncGenerator<string> {
  const model = getChatModel(0.1);
  const stream = await model.stream([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(question, context) },
  ]);
  for await (const chunk of stream) {
    const text = textOf(chunk.content);
    if (text) yield text;
  }
}

export const REFUSAL =
  "I don't have anything about that in the Gold Bank knowledge base. I can help with " +
  'membership points, payment options, delivery and shipping, order cancellations, ' +
  'returns, and our privacy and cookie policies.';

/**
 * Strip citation markers that point at passages we never supplied, and report
 * which citations the answer actually used so the UI shows no dead chips.
 */
export function validateCitations(
  answer: string,
  citations: Citation[],
): { answer: string; used: Citation[] } {
  const valid = new Set(citations.map((c) => c.n));
  const usedNumbers = new Set<number>();

  const cleaned = answer.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (match, group: string) => {
    const nums = group.split(',').map((s) => Number(s.trim())).filter((n) => valid.has(n));
    nums.forEach((n) => usedNumbers.add(n));
    return nums.length ? nums.map((n) => `[${n}]`).join('') : '';
  });

  return {
    answer: cleaned.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:])/g, '$1').trim(),
    used: citations.filter((c) => usedNumbers.has(c.n)),
  };
}
```

- [ ] **Step 2: Write `lib/chats.ts`**

```ts
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { paths } from './config';
import type { ChatSession, ChatTurn } from './types';

function file(id: string): string {
  return join(paths.chats, `${id}.json`);
}

export async function createChat(): Promise<ChatSession> {
  await mkdir(paths.chats, { recursive: true });
  const now = new Date().toISOString();
  const session: ChatSession = { id: nanoid(10), title: 'New conversation', turns: [], createdAt: now, updatedAt: now };
  await writeFile(file(session.id), JSON.stringify(session, null, 2));
  return session;
}

export async function getChat(id: string): Promise<ChatSession | null> {
  try {
    return JSON.parse(await readFile(file(id), 'utf8')) as ChatSession;
  } catch {
    return null;
  }
}

export async function listChats(): Promise<ChatSession[]> {
  try {
    const names = (await readdir(paths.chats)).filter((n) => n.endsWith('.json'));
    const all = await Promise.all(names.map((n) => getChat(n.replace(/\.json$/, ''))));
    return all
      .filter((c): c is ChatSession => c !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export async function appendTurn(id: string, turn: ChatTurn): Promise<ChatSession | null> {
  const session = await getChat(id);
  if (!session) return null;
  session.turns.push(turn);
  session.updatedAt = new Date().toISOString();
  if (session.turns.length === 1 && turn.role === 'user') {
    session.title = turn.content.slice(0, 70);
  }
  await mkdir(paths.chats, { recursive: true });
  await writeFile(file(id), JSON.stringify(session, null, 2));
  return session;
}
```

- [ ] **Step 3: Write `app/api/chat/route.ts`**

```ts
import { sseStream } from '@/lib/sse';
import { appendTurn, getChat } from '@/lib/chats';
import { condenseQuery } from '@/lib/rag/condense';
import { retrieve } from '@/lib/rag/retrieve';
import { buildContext } from '@/lib/rag/context';
import { REFUSAL, streamAnswer, validateCitations } from '@/lib/rag/answer';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface Body {
  chatId?: string;
  question: string;
}

export async function POST(req: Request): Promise<Response> {
  const { chatId, question } = (await req.json()) as Body;
  if (!question || question.trim() === '') {
    return Response.json({ error: 'question is required' }, { status: 400 });
  }

  const session = chatId ? await getChat(chatId) : null;
  const priorTurns = session?.turns ?? [];

  return sseStream<unknown>(async (emit) => {
    const started = Date.now();

    if (session) await appendTurn(session.id, { role: 'user', content: question });

    const condensed = await condenseQuery(priorTurns, question);
    const { chunks, gated, topScore } = await retrieve(condensed);
    const { context, citations } = buildContext(chunks);

    emit('meta', {
      condensedQuery: condensed,
      topScore,
      gated,
      retrieved: chunks
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((c) => ({
          chunkId: c.id, score: c.score, kind: c.kind,
          headingPath: c.headingPath, snippet: c.text.slice(0, 160),
        })),
    });

    if (gated) {
      emit('token', { text: REFUSAL });
      emit('citations', { citations: [] });
      emit('done', { ms: Date.now() - started });
      if (session) {
        await appendTurn(session.id, {
          role: 'assistant', content: REFUSAL, citations: [],
          debug: { condensedQuery: condensed, retrieved: [], ms: Date.now() - started },
        });
      }
      return;
    }

    let raw = '';
    for await (const token of streamAnswer(question, context)) {
      raw += token;
      emit('token', { text: token });
    }

    const { answer, used } = validateCitations(raw, citations);
    emit('citations', { citations: used });
    emit('done', { ms: Date.now() - started, corrected: answer !== raw.trim() });

    if (session) {
      await appendTurn(session.id, {
        role: 'assistant',
        content: answer,
        citations: used,
        debug: {
          condensedQuery: condensed,
          retrieved: chunks.map((c) => ({ chunkId: c.id, score: c.score, headingPath: c.headingPath })),
          ms: Date.now() - started,
        },
      });
    }
  });
}
```

Note: `emit('token', …)` sends the raw stream so the user sees text appear immediately; the validated answer is what gets persisted. When validation removes a marker the client replaces its accumulated text on `citations`/`done` — Task 11 handles that.

- [ ] **Step 4: Write the chat session routes**

```ts
// app/api/chats/route.ts
import { createChat, listChats } from '@/lib/chats';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return Response.json({ chats: (await listChats()).map(({ id, title, updatedAt }) => ({ id, title, updatedAt })) });
}

export async function POST(): Promise<Response> {
  return Response.json({ chat: await createChat() });
}
```

```ts
// app/api/chats/[id]/route.ts
import { getChat } from '@/lib/chats';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const chat = await getChat(id);
  if (!chat) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ chat });
}
```

- [ ] **Step 5: Verify**

```bash
npm run dev
```

```bash
# Create a session, ask a question, watch the SSE events
CHAT=$(curl -s -X POST localhost:3000/api/chats | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).chat.id))')

curl -N -s -X POST localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d "{\"chatId\":\"$CHAT\",\"question\":\"How does the points system work?\"}"
```

Expected: `event: meta` first (with `condensedQuery` equal to the question, since this is turn one, and a `retrieved` array), then a run of `event: token`, then `event: citations` naming the FAQ page, then `event: done`. The assembled answer must state "1 point for every £1" and carry a `[n]` marker.

```bash
# Follow-up exercises condensation
curl -N -s -X POST localhost:3000/api/chat -H 'content-type: application/json' \
  -d "{\"chatId\":\"$CHAT\",\"question\":\"and if I sell instead?\"}"
# expect: meta.condensedQuery mentions points and selling, not just "if I sell instead"

# Refusal path
curl -N -s -X POST localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"question":"Should I buy gold or bitcoin right now?"}'
# expect: either the gate fires (meta.gated=true → REFUSAL) or the answer declines to advise

# Persistence
curl -s "localhost:3000/api/chats/$CHAT" | head -c 300
# expect: 4 turns (2 user, 2 assistant) with citations and debug recorded
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: grounded answer generation, citation validation, chat persistence and API"
```

---

## Task 11: Chat UI

**Files:**
- Create: `app/globals.css` (replace), `app/layout.tsx` (replace), `app/page.tsx` (replace)
- Create: `components/ChatPanel.tsx`, `components/MessageBubble.tsx`, `components/CitationChip.tsx`, `components/PipelineStrip.tsx`, `lib/useChatStream.ts`

**Interfaces:**
- Consumes: `POST /api/chat` SSE contract; `POST /api/chats`; `Citation`, `ChatTurn`.
- Produces: `useChatStream()` hook returning `{ turns, pending, send, meta, error }`.

- [ ] **Step 1: Write `app/globals.css`**

```css
@import "tailwindcss";

@theme {
  --color-ink: #14110d;
  --color-surface: #faf8f4;
  --color-panel: #ffffff;
  --color-line: #e6e0d6;
  --color-muted: #6d6659;
  --color-gold: #a8791f;
  --color-gold-soft: #f4ead4;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

@media (prefers-color-scheme: dark) {
  @theme {
    --color-ink: #f2ece2;
    --color-surface: #14120f;
    --color-panel: #1c1a16;
    --color-line: #302c25;
    --color-muted: #a09786;
    --color-gold: #d9ab4e;
    --color-gold-soft: #2a2317;
  }
}

html, body {
  background: var(--color-surface);
  color: var(--color-ink);
  font-family: var(--font-sans);
}

.prose-answer p { margin-block: 0.6rem; line-height: 1.65; }
.prose-answer ul { margin-block: 0.6rem; padding-inline-start: 1.2rem; list-style: disc; }
.prose-answer li { margin-block: 0.2rem; }
```

- [ ] **Step 2: Write `app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gold Bank Assistant',
  description: 'RAG chatbot over the Gold Bank knowledge base',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-tight">Gold Bank</span>
              <span className="text-sm text-muted">Assistant</span>
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="hover:text-gold">Chat</Link>
              <Link href="/knowledge" className="hover:text-gold">Knowledge base</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-5 py-6">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Write `lib/useChatStream.ts`**

```ts
'use client';

import { useCallback, useRef, useState } from 'react';
import type { Citation } from './types';

export interface RetrievedDebug {
  chunkId: string;
  score: number;
  kind: string;
  headingPath: string[];
  snippet: string;
}

export interface Meta {
  condensedQuery: string;
  topScore: number;
  gated: boolean;
  retrieved: RetrievedDebug[];
  ms?: number;
}

export interface UiTurn {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  meta?: Meta;
  streaming?: boolean;
}

/** Parse an SSE body incrementally. */
async function readSse(
  res: Response,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = /^event:\s*(.+)$/m.exec(raw)?.[1]?.trim();
      const dataLine = /^data:\s*(.*)$/m.exec(raw)?.[1];
      if (!event || dataLine === undefined) continue;
      try {
        onEvent(event, JSON.parse(dataLine));
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

export function useChatStream(initialTurns: UiTurn[] = []) {
  const [turns, setTurns] = useState<UiTurn[]>(initialTurns);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatId = useRef<string | null>(null);

  const send = useCallback(async (question: string) => {
    if (!question.trim() || pending) return;
    setError(null);
    setPending(true);

    setTurns((t) => [
      ...t,
      { role: 'user', content: question },
      { role: 'assistant', content: '', streaming: true },
    ]);

    const patchLast = (patch: Partial<UiTurn>) =>
      setTurns((t) => {
        const next = [...t];
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });

    try {
      if (!chatId.current) {
        const created = await fetch('/api/chats', { method: 'POST' });
        chatId.current = ((await created.json()) as { chat: { id: string } }).chat.id;
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: chatId.current, question }),
      });
      if (!res.ok || !res.body) throw new Error(`request failed: ${res.status}`);

      let accumulated = '';
      await readSse(res, (event, data) => {
        if (event === 'meta') {
          patchLast({ meta: data as Meta });
        } else if (event === 'token') {
          accumulated += (data as { text: string }).text;
          patchLast({ content: accumulated });
        } else if (event === 'citations') {
          patchLast({ citations: (data as { citations: Citation[] }).citations });
        } else if (event === 'done') {
          patchLast({ streaming: false });
        } else if (event === 'error') {
          throw new Error((data as { message: string }).message);
        }
      });
      patchLast({ streaming: false });
    } catch (e) {
      setError((e as Error).message);
      patchLast({ streaming: false });
    } finally {
      setPending(false);
    }
  }, [pending]);

  return { turns, pending, error, send, chatId: chatId.current };
}
```

- [ ] **Step 4: Write `components/CitationChip.tsx`**

```tsx
'use client';

import { useState } from 'react';
import type { Citation } from '@/lib/types';

export function CitationChip({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);
  const href = citation.sourceUrl
    ? citation.anchor ? `${citation.sourceUrl}#${citation.anchor}` : citation.sourceUrl
    : undefined;

  return (
    <div className="rounded-lg border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-gold-soft"
      >
        <span className="mt-0.5 shrink-0 rounded bg-gold-soft px-1.5 text-xs font-semibold text-gold">
          {citation.n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{citation.documentTitle}</span>
          <span className="block truncate text-xs text-muted">
            {citation.headingPath.slice(1).join(' › ') || citation.headingPath[0]}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-line px-3 py-2 text-sm">
          <p className="whitespace-pre-wrap text-muted">{citation.snippet}…</p>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-block text-xs font-medium text-gold underline"
            >
              Read this section on goldbank.co.uk →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write `components/PipelineStrip.tsx`**

```tsx
import type { Meta } from '@/lib/useChatStream';

export function PipelineStrip({ meta }: { meta: Meta }) {
  return (
    <details className="mt-3 rounded-lg border border-line bg-panel text-sm">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted">
        How this answer was built — {meta.retrieved.length} passages, top score{' '}
        {meta.topScore.toFixed(3)}
        {meta.ms ? ` · ${meta.ms}ms` : ''}
        {meta.gated ? ' · below threshold, generation skipped' : ''}
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Search query
          </div>
          <div className="mt-1">{meta.condensedQuery}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Retrieved passages
          </div>
          <ol className="mt-1 space-y-1">
            {meta.retrieved.map((r) => (
              <li key={r.chunkId} className="flex gap-2 text-xs">
                <span className="w-12 shrink-0 font-mono text-gold">{r.score.toFixed(3)}</span>
                <span className="w-14 shrink-0 text-muted">{r.kind}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.headingPath.join(' › ')}</span>
                  <span className="block truncate text-muted">{r.snippet}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </details>
  );
}
```

- [ ] **Step 6: Write `components/MessageBubble.tsx`**

The answer text carries `[n]` markers; render them as superscript links to the citation list rather than leaving raw brackets in prose.

```tsx
import { CitationChip } from './CitationChip';
import { PipelineStrip } from './PipelineStrip';
import type { UiTurn } from '@/lib/useChatStream';

function renderWithMarkers(text: string) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    if (!m) return <span key={i}>{part}</span>;
    return (
      <sup key={i} className="mx-0.5 rounded bg-gold-soft px-1 text-[0.7em] font-semibold text-gold">
        {m[1]}
      </sup>
    );
  });
}

export function MessageBubble({ turn }: { turn: UiTurn }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-gold-soft px-4 py-2.5">
          {turn.content}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="prose-answer max-w-none">
        {turn.content
          ? turn.content.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{renderWithMarkers(para)}</p>
            ))
          : turn.streaming && <span className="text-muted">Searching the knowledge base…</span>}
        {turn.streaming && turn.content && (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-gold align-middle" />
        )}
      </div>

      {turn.citations && turn.citations.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Sources</div>
          {turn.citations.map((c) => (
            <CitationChip key={c.chunkId} citation={c} />
          ))}
        </div>
      )}

      {turn.meta && <PipelineStrip meta={turn.meta} />}
    </div>
  );
}
```

- [ ] **Step 7: Write `components/ChatPanel.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageBubble } from './MessageBubble';
import { useChatStream, type UiTurn } from '@/lib/useChatStream';

const SEEDS = [
  'How does the points system work?',
  'Do you deliver outside the UK?',
  'What happens if I cancel my order?',
  'Do I need ID to open an account?',
];

export function ChatPanel({ initialTurns = [], readOnly = false }: { initialTurns?: UiTurn[]; readOnly?: boolean }) {
  const { turns, pending, error, send } = useChatStream(initialTurns);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const submit = (text: string) => {
    setDraft('');
    void send(text);
  };

  return (
    <div className="space-y-6">
      {turns.length === 0 && !readOnly && (
        <div className="rounded-2xl border border-line bg-panel p-6">
          <h1 className="text-xl font-semibold">Ask about buying, selling, and shipping gold</h1>
          <p className="mt-1 text-sm text-muted">
            Answers come only from Gold Bank&apos;s published FAQs and policies, with a link to the
            exact section every time.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {SEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-gold hover:bg-gold-soft"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {turns.map((t, i) => (
          <MessageBubble key={i} turn={t} />
        ))}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="rounded-lg border border-line bg-panel px-3 py-2 text-sm text-gold">
          {error}
        </div>
      )}

      {!readOnly && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
          className="sticky bottom-4 flex gap-2 rounded-xl border border-line bg-panel p-2 shadow-sm"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about delivery, payments, returns, points…"
            className="min-w-0 flex-1 bg-transparent px-2 py-2 outline-none"
            disabled={pending}
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-surface disabled:opacity-40"
          >
            {pending ? 'Thinking…' : 'Ask'}
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Write `app/page.tsx`**

```tsx
import { ChatPanel } from '@/components/ChatPanel';

export default function Home() {
  return <ChatPanel />;
}
```

- [ ] **Step 9: Verify**

```bash
npm run dev   # open http://localhost:3000
```

Check each of these by hand:
1. The empty state shows four seed questions; clicking "How does the points system work?" streams an answer mentioning "1 point for every £1".
2. Superscript citation markers appear inline, and a **Sources** list appears beneath the answer.
3. Expanding a source shows the verbatim snippet and a "Read this section on goldbank.co.uk" link. For a legal-page citation the link ends in `#…` — click it and confirm the browser lands on that section.
4. "How this answer was built" expands to show the search query, and a scored list of retrieved passages with `kind` labels.
5. Ask "and what about outside the UK?" as a follow-up; the strip's search query must be a full standalone question, not the fragment you typed.
6. Ask "Should I buy gold now?" — the answer must decline to advise rather than speculate.
7. Ask "Who won the 1998 World Cup?" — expect the refusal text and `below threshold, generation skipped` in the strip.
8. Resize to a narrow viewport: the layout stays single-column with no horizontal scrolling.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: chat UI with streaming answers, citation chips, and pipeline strip"
```

---

## Task 12: Knowledge base UI — upload and document library

This page is where the ingestion pipeline becomes visible. Without it, the best engineering in the project is invisible to anyone watching a demo.

**Files:**
- Create: `app/knowledge/page.tsx`, `components/UploadZone.tsx`, `components/DocumentRow.tsx`, `lib/useIngest.ts`

**Interfaces:**
- Consumes: `POST /api/ingest` SSE contract; `GET /api/documents`; `GET /api/documents?documentId=`; `DELETE /api/documents/[id]`; `DocumentRecord`, `Chunk`.
- Produces: `useIngest()` returning `{ upload, progress, busy, error }` where `progress` is a `Record<string, StageProgress>` keyed by filename or documentId.

- [ ] **Step 1: Write `lib/useIngest.ts`**

```ts
'use client';

import { useCallback, useState } from 'react';

export interface StageProgress {
  label: string;
  stage: string;
  done?: number;
  total?: number;
  chunks?: number;
  error?: string;
  skipped?: string;
  finishedMs?: number;
}

export function useIngest(onFinished: () => void) {
  const [progress, setProgress] = useState<Record<string, StageProgress>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setProgress(
      Object.fromEntries(files.map((f) => [f.name, { label: f.name, stage: 'queued' }])),
    );

    const form = new FormData();
    files.forEach((f) => form.append('files', f));

    try {
      const res = await fetch('/api/ingest', { method: 'POST', body: form });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `upload failed: ${res.status}`);
      }
      if (!res.body) throw new Error('no response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let current = files[0]?.name ?? 'document';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const event = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim();
          const dataLine = /^data:\s*(.*)$/m.exec(frame)?.[1];
          if (!event || dataLine === undefined) continue;

          const data = JSON.parse(dataLine) as {
            documentId?: string; stage?: string; done?: number; total?: number;
            chunks?: number; message?: string; reason?: string; ms?: number;
          };
          // The server keys events by documentId once a record exists; before
          // that it keys by filename. Track whichever arrives.
          const key = data.documentId ?? current;
          current = key;

          setProgress((p) => {
            const prev = p[key] ?? { label: key, stage: 'queued' };
            if (event === 'status') {
              return { ...p, [key]: { ...prev, stage: data.stage ?? prev.stage, done: data.done, total: data.total, chunks: data.chunks ?? prev.chunks } };
            }
            if (event === 'done') {
              return { ...p, [key]: { ...prev, stage: 'ready', chunks: data.chunks, finishedMs: data.ms } };
            }
            if (event === 'skipped') {
              return { ...p, [key]: { ...prev, stage: 'skipped', skipped: data.reason } };
            }
            if (event === 'error') {
              return { ...p, [key]: { ...prev, stage: 'failed', error: data.message } };
            }
            return p;
          });
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onFinished();
    }
  }, [onFinished]);

  return { upload, progress, busy, error };
}
```

- [ ] **Step 2: Write `components/UploadZone.tsx`**

```tsx
'use client';

import { useRef, useState } from 'react';
import type { StageProgress } from '@/lib/useIngest';

const STAGES = ['parsing', 'chunking', 'enriching', 'embedding', 'ready'];

function StageBar({ p }: { p: StageProgress }) {
  if (p.stage === 'failed') {
    return <span className="text-sm text-gold">failed — {p.error}</span>;
  }
  if (p.stage === 'skipped') {
    return <span className="text-sm text-muted">skipped — {p.skipped}</span>;
  }

  const idx = STAGES.indexOf(p.stage);
  const inner = p.total ? Math.round((100 * (p.done ?? 0)) / p.total) : 0;

  return (
    <div className="flex items-center gap-2 text-xs">
      {STAGES.map((s, i) => (
        <span
          key={s}
          className={
            i < idx ? 'text-muted' : i === idx ? 'font-semibold text-gold' : 'text-line'
          }
        >
          {s}
          {i === idx && p.total ? ` ${p.done}/${p.total} (${inner}%)` : ''}
        </span>
      ))}
      {p.stage === 'ready' && p.chunks !== undefined && (
        <span className="text-muted">
          · {p.chunks} chunks{p.finishedMs ? ` in ${(p.finishedMs / 1000).toFixed(1)}s` : ''}
        </span>
      )}
    </div>
  );
}

export function UploadZone({
  onUpload,
  progress,
  busy,
  error,
}: {
  onUpload: (files: File[]) => void;
  progress: Record<string, StageProgress>;
  busy: boolean;
  error: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rows = Object.entries(progress);

  return (
    <section className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onUpload([...e.dataTransfer.files]);
        }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition ${
          dragging ? 'border-gold bg-gold-soft' : 'border-line bg-panel'
        }`}
      >
        <p className="font-medium">Drop documents here</p>
        <p className="mt-1 text-sm text-muted">
          PDF, DOCX, Markdown, plain text, HTML, scraped JSON, or a ZIP of any of those
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-4 rounded-lg border border-line px-4 py-2 text-sm hover:border-gold disabled:opacity-40"
        >
          {busy ? 'Processing…' : 'Choose files'}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.docx,.md,.txt,.html,.htm,.json,.zip"
          onChange={(e) => onUpload([...(e.target.files ?? [])])}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-line bg-panel px-3 py-2 text-sm text-gold">{error}</div>
      )}

      {rows.length > 0 && (
        <div className="space-y-2 rounded-xl border border-line bg-panel p-3">
          {rows.map(([key, p]) => (
            <div key={key}>
              <div className="truncate text-sm font-medium">{p.label}</div>
              <StageBar p={p} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Write `components/DocumentRow.tsx`**

```tsx
'use client';

import { useState } from 'react';
import type { Chunk, DocumentRecord } from '@/lib/types';

const KIND_STYLE: Record<string, string> = {
  qa: 'bg-gold-soft text-gold',
  clause: 'bg-line text-muted',
  table: 'bg-line text-muted',
  prose: 'bg-line text-muted',
};

export function DocumentRow({
  doc,
  onDeleted,
}: {
  doc: DocumentRecord;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && chunks === null) {
      setLoading(true);
      const res = await fetch(`/api/documents?documentId=${encodeURIComponent(doc.id)}`);
      setChunks(((await res.json()) as { chunks: Chunk[] }).chunks);
      setLoading(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Remove "${doc.title}" and its ${doc.chunkCount} chunks from the index?`)) return;
    await fetch(`/api/documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
    onDeleted();
  };

  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={toggle} className="min-w-0 flex-1 text-left">
          <div className="truncate font-medium">{doc.title}</div>
          <div className="truncate text-xs text-muted">
            {doc.status === 'ready' ? `${doc.chunkCount} chunks` : doc.status}
            {doc.error ? ` — ${doc.error}` : ''}
            {doc.sourceUrl ? ` · ${doc.sourceUrl}` : ` · ${doc.filename}`}
          </div>
        </button>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            doc.status === 'ready' ? 'bg-gold-soft text-gold' : 'bg-line text-muted'
          }`}
        >
          {doc.status}
        </span>
        <button type="button" onClick={remove} className="text-xs text-muted hover:text-gold">
          Remove
        </button>
      </div>

      {open && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          {loading && <div className="text-sm text-muted">Loading chunks…</div>}
          {chunks?.map((c) => (
            <div key={c.id} className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${KIND_STYLE[c.kind] ?? ''}`}>
                  {c.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">
                  {c.headingPath.join(' › ')}
                  {c.partCount ? ` · part ${(c.partIndex ?? 0) + 1}/${c.partCount}` : ''}
                  {c.anchor ? ` · #${c.anchor}` : ''}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{c.text.slice(0, 400)}
                {c.text.length > 400 ? '…' : ''}</p>
              {c.enrichment && (
                <dl className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-muted">
                  <div><dt className="inline font-semibold">Summary: </dt>
                    <dd className="inline">{c.enrichment.summary}</dd></div>
                  <div><dt className="inline font-semibold">Also answers: </dt>
                    <dd className="inline">{c.enrichment.hypotheticalQuestions.join(' · ')}</dd></div>
                  <div><dt className="inline font-semibold">Keywords: </dt>
                    <dd className="inline">{c.enrichment.keywords.join(', ')}</dd></div>
                </dl>
              )}
            </div>
          ))}
          {chunks?.length === 0 && <div className="text-sm text-muted">No chunks indexed.</div>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write `app/knowledge/page.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { DocumentRow } from '@/components/DocumentRow';
import { UploadZone } from '@/components/UploadZone';
import { useIngest } from '@/lib/useIngest';
import type { DocumentRecord } from '@/lib/types';

export default function KnowledgePage() {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [vectorCount, setVectorCount] = useState(0);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/documents');
    const body = (await res.json()) as { documents: DocumentRecord[]; vectorCount: number };
    setDocs(body.documents);
    setVectorCount(body.vectorCount);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const { upload, progress, busy, error } = useIngest(refresh);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Knowledge base</h1>
        <p className="mt-1 text-sm text-muted">
          {docs.length} document{docs.length === 1 ? '' : 's'} · {vectorCount} indexed chunks
        </p>
      </header>

      <UploadZone onUpload={upload} progress={progress} busy={busy} error={error} />

      <section className="space-y-2">
        {docs.map((d) => (
          <DocumentRow key={d.id} doc={d} onDeleted={refresh} />
        ))}
        {docs.length === 0 && (
          <p className="rounded-xl border border-line bg-panel px-4 py-6 text-center text-sm text-muted">
            Nothing indexed yet. Drop a file above, or run <code>npm run seed</code> to load the
            bundled Gold Bank corpus.
          </p>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Verify**

```bash
npm run dev   # open http://localhost:3000/knowledge
```

Check by hand:
1. The header reads `9 documents · <N> indexed chunks`, matching the seed output. (The 404 returns-and-exchanges page is correctly absent — it is refused at parse time.)
2. Expanding `Frequently Asked Questions` lists chunks with **qa** badges, each showing one question and its answer, plus enrichment (`Summary`, `Also answers`, `Keywords`).
3. Expanding `Terms of Service` shows **clause** badges with recovered breadcrumbs like `Terms of Service › Acceptable Use` and `#tos-acceptable-use` anchors — visible proof that heading recovery worked.
4. Expanding `Cookies Policy` shows at least one **table** badge whose text contains an intact markdown table.
5. Drag in a small PDF or `.md` file: stage labels advance `parsing → chunking → enriching x/y → embedding x/y → ready`, then the document appears in the list and the chunk count rises.
6. Drop the original `bdcdbd9c-….zip`: it reports 9 `skipped — already indexed` results and one refusal for the 404 page.
7. Drop an unsupported file (e.g. a `.png`): a red error names the supported formats and nothing is indexed.
8. Remove a document: it disappears, the chunk count drops, and asking a question about it in the chat no longer cites it. Then run `npm run seed` to restore.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: knowledge base UI with drag-drop ingest progress and chunk inspector"
```

---

## Task 13: Shared conversation page, smoke script, and README

**Files:**
- Create: `app/c/[id]/page.tsx`
- Create: `scripts/smoke.ts`
- Create: `README.md`
- Modify: `components/ChatPanel.tsx` (no change needed if Task 11 included `readOnly`; verify the prop exists)

**Interfaces:**
- Consumes: `getChat` from `lib/chats.ts`; `ChatPanel` with `initialTurns` and `readOnly`; `condenseQuery`, `retrieve`, `buildContext`, `streamAnswer`, `validateCitations`.
- Produces: `/c/<id>` route; `npm run smoke`.

- [ ] **Step 1: Write `app/c/[id]/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getChat } from '@/lib/chats';
import { ChatPanel } from '@/components/ChatPanel';
import type { UiTurn } from '@/lib/useChatStream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function SharedChat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chat = await getChat(id);
  if (!chat) notFound();

  const turns: UiTurn[] = chat.turns.map((t) => ({
    role: t.role,
    content: t.content,
    citations: t.citations,
    meta: t.debug
      ? {
          condensedQuery: t.debug.condensedQuery ?? '',
          topScore: t.debug.retrieved?.[0]?.score ?? 0,
          gated: (t.debug.retrieved?.length ?? 0) === 0,
          retrieved: (t.debug.retrieved ?? []).map((r) => ({
            chunkId: r.chunkId, score: r.score, kind: '', headingPath: r.headingPath, snippet: '',
          })),
          ms: t.debug.ms,
        }
      : undefined,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">{chat.title}</h1>
        <Link href="/" className="text-sm text-gold hover:underline">Start your own →</Link>
      </div>
      <p className="text-xs text-muted">
        Shared conversation · {new Date(chat.updatedAt).toLocaleString()}
      </p>
      <ChatPanel initialTurns={turns} readOnly />
    </div>
  );
}
```

- [ ] **Step 2: Write `scripts/smoke.ts`**

```ts
import { config } from '../lib/config';
import { listDocuments } from '../lib/manifest';
import { getStore } from '../lib/store';
import { retrieve } from '../lib/rag/retrieve';
import { buildContext } from '../lib/rag/context';
import { streamAnswer, validateCitations } from '../lib/rag/answer';

const GOLDEN: { q: string; expectDoc: RegExp; expectText: RegExp }[] = [
  {
    q: 'How does the points system work?',
    expectDoc: /FAQ/i,
    expectText: /1 point for every £1/i,
  },
  {
    q: 'Do you ship outside the UK?',
    expectDoc: /FAQ|Delivery/i,
    expectText: /(do not|don't|only).*(UK|mainland)/i,
  },
  {
    q: 'Is there a fee if I cancel my order?',
    expectDoc: /FAQ|Terms|Returns/i,
    expectText: /£100|cancellation fee/i,
  },
];

async function main() {
  const docs = await listDocuments();
  const store = await getStore();
  console.log(`documents: ${docs.length}  vectors: ${await store.count()}  ` +
              `store: ${config.VECTOR_STORE}\n`);
  if (docs.filter((d) => d.status === 'ready').length === 0) {
    throw new Error('index is empty — run "npm run seed" first');
  }

  let failed = 0;
  for (const c of GOLDEN) {
    const { chunks, gated } = await retrieve(c.q);
    const { context, citations } = buildContext(chunks);

    let raw = '';
    if (!gated) for await (const t of streamAnswer(c.q, context)) raw += t;
    const { answer, used } = validateCitations(raw, citations);

    const docsCited = [...new Set(used.map((u) => u.documentTitle))];
    const docOk = docsCited.some((d) => c.expectDoc.test(d));
    const textOk = c.expectText.test(answer);
    const citedOk = used.length > 0;

    console.log(`Q: ${c.q}`);
    console.log(`A: ${answer.replace(/\n+/g, ' ').slice(0, 220)}…`);
    console.log(`   cited: ${docsCited.join(' | ') || '(none)'}`);
    console.log(`   ${docOk ? 'OK  ' : 'FAIL'} cites an expected document`);
    console.log(`   ${textOk ? 'OK  ' : 'FAIL'} answer contains ${c.expectText}`);
    console.log(`   ${citedOk ? 'OK  ' : 'FAIL'} answer carries at least one citation\n`);
    if (!docOk || !textOk || !citedOk) failed++;
  }

  console.log(failed === 0 ? 'SMOKE PASSED' : `SMOKE FAILED (${failed}/${GOLDEN.length})`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

- [ ] **Step 3: Write `README.md`**

```markdown
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

## Why this corpus needed a custom pipeline

Nine of the ten scraped pages contain exactly **one** markdown heading. Their
section titles are unmarked Title-Case paragraphs:

```
By Using Our Site You Accept These Terms      <- structurally invisible
By using our site, you confirm that you accept these terms…
```

A stock markdown splitter turns the 28 KB privacy policy into one blob cut at
arbitrary offsets. So `lib/pipeline/headings.ts` reconstructs the tree first,
using two signals: the table-of-contents anchor list each page opens with
(authoritative, and it yields real URL fragments for deep-linked citations),
and a Title-Case heuristic for sections the TOC omits.

Chunking then dispatches on content shape — atomic question+answer chunks for
the FAQ page, section chunks for legal text, and a table guard that never cuts
a markdown table mid-row.

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
npm run verify:store      # both VectorStore adapters satisfy one contract
npm run verify:retrieve   # five queries retrieve the right documents
npm run smoke             # three golden questions, end to end
```

## Deliberately out of scope

Authentication, multi-tenancy, hybrid (BM25) search and reranking, a scored
eval harness, OCR for scanned PDFs, live URL scraping, table-aware PDF
extraction, and automated tests.
```

- [ ] **Step 4: Verify**

```bash
npx tsx --env-file=.env.local scripts/smoke.ts
```

Expected: three questions, each showing `OK` on all three assertions, ending with `SMOKE PASSED`.

Then the shared page:

```bash
npm run dev
# Ask a question at http://localhost:3000, then:
ls data/chats/          # note the id
# open http://localhost:3000/c/<id>
```

Expected: the conversation renders read-only with its citations and pipeline strip, there is no input box, and the "Start your own →" link returns to `/`. An unknown id renders Next's 404.

Finally, confirm the whole thing builds and a fresh clone works:

```bash
npm run build     # must complete with no type errors
rm -rf data && npm run seed && npm run smoke
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: shared conversation page, smoke script, and README"
```

---

## Execution order and dependencies

```
Task 1 (scaffold + model check)  ← gate: do not proceed if check-models fails
  ├─ Task 2 (store port)
  ├─ Task 3 (loaders + parse)
  │    └─ Task 4 (heading recovery)
  │         └─ Task 5 (chunking)
  │              └─ Task 6 (enrichment)
  │                   └─ Task 7 (embed + manifest + ingest + seed)   [needs 2]
  │                        ├─ Task 8 (ingest/documents routes)
  │                        └─ Task 9 (retrieval)
  │                             └─ Task 10 (answer + chat API)
  │                                  └─ Task 11 (chat UI)
  │                                       └─ Task 12 (knowledge UI)  [needs 8]
  │                                            └─ Task 13 (shared page, smoke, README)
```

Tasks 2 and 3 are independent of each other and can be done in either order.
Everything from Task 7 onward requires a working index, so Task 7's seed
verification is the second hard gate: do not start Task 9 until
`npm run seed` reports ten ready documents.
