# Decisions taken during the build

Twenty-eight judgement calls were made while executing
`docs/superpowers/plans/2026-09-10-goldbank-rag-chatbot.md`. Each is recorded with what
it costs if it turns out wrong, so any of them can be revisited without archaeology.

**The pattern worth knowing:** almost every defect found during the build was in the
*plan*, not in its implementation. The plan was written from a survey of the corpus;
contact with the actual data disproved several of its assumptions. Where that happened,
the plan, the spec and this file were corrected rather than left to drift.

## Corpus reality vs. the original plan

| The plan assumed | The data actually shows |
|---|---|
| 10 indexable documents | **9** — `returns-and-exchanges` was scraped as an HTTP 404 stub and is deliberately refused |
| Scraped `<title>` identifies a document | **Six of nine** report the site-wide "Gold Bank - London"; titles now come from each page's `h1` |
| Every legal page has a TOC anchor list | **Only Terms of Service** publishes in-page anchors (23 of its 26 chunks); the rest cite the page |
| Two heading signals (TOC + Title Case) | **Three** — numbered sections carry the privacy policy, which Title Case alone recovered 6 of 27 sections from |
| ~150–350 chunks | **111** — the corpus is 15,384 tokens; chunks average 141 |

## Decisions, in the order they were made

1. **Feature branch in the working directory, not a separate worktree.** *If wrong:* nothing material; a worktree can be added later.
2. **"No automated tests" passed verbatim to every reviewer** rather than pre-judging their findings. *If wrong:* a reviewer raises test coverage and it gets adjudicated.
3. **Deferred the model-ID gate** until an API key existed, rather than blocking. *If wrong:* only `lib/config.ts` changes; Tasks 1–5 unaffected. (Both IDs were later confirmed real.)
4. **Kept LanceDB 0.38 on Node 20** despite its `engines: >=22`, after probing the full API. Added the missing `apache-arrow` peer. *If wrong:* the JSON adapter is a proven fallback via `VECTOR_STORE=json`.
5. **Kept the 404 stub committed** rather than deleting it — a pipeline that visibly refuses bad input is better evidence than one that never meets any. *If wrong:* re-scrape that one URL; no code change.
6. **Adopted pdf-parse v2's class API** instead of pinning to the unmaintained v1 my plan was written against. *If wrong:* one file behind the `ParsedDoc` interface.
7. **Scoped the reCAPTCHA check to artifact lines**, since the cookies policy legitimately documents reCAPTCHA cookies in a table. *If wrong:* none; the stricter check still catches the real artifact.
8. **Added numbered + sentence-case heading signals** rather than lowering the caps-ratio threshold, which would have promoted body sentences. Prototyped against all 9 documents first: privacy policy 6 → 26 sections. *If wrong:* over-promotion fragments chunks; signals are independently removable.
9. **Exempted numbered headings from the terminal-punctuation rule** (`3. How is your personal data collected?` was being dropped). Deliberately *not* widened to all question-shaped lines — FAQ questions must stay body text or the Q&A splitter has nothing to pair. *If wrong:* bounded to numbered lines.
10. **Restructured the exclusion rules into structural vs. style**, so the numbered exemption applies consistently and cannot be half-forgotten by the next person adding a rule. *If wrong:* a bold-and-numbered non-heading gets promoted.
11. **Unescaped `1\.` in titles, moved three thresholds to config, made anchors first-write-wins.** *If wrong:* cosmetic.
12. **Exempted Q&A pairs from the scrap filter.** "Do you buy diamonds?" / "No." is 7 tokens and was being deleted — the bot would have claimed no knowledge of a question GoldBank answers plainly. *If wrong:* a malformed pair survives as a tiny chunk.
13. **Corrected the chunk-count expectation to ~110** (measured) and instructed against over-splitting to hit my invented target. *If wrong:* none; the number is measured.
14. **Moved the enrichment truncation bound into config** and made `parseEnrichment` throw-safe at the function level rather than relying on its caller. *If wrong:* none.
15. **Made embedding rate limits retryable.** The client library swallows 429s and returns *empty vectors*, which surfaced as a bogus dimension mismatch, so retries never fired and two chunks were permanently embedded without enrichment. Added detection, a shared `isRateLimit`, enrichment retries, coverage reporting, and `seed --force`. *If wrong:* `--force` re-embeds unnecessarily; cache-backed and cheap.
16. **Rejected an implementer's claim** that the `isRateLimit` regex matched "generate" — tested 7 message shapes; it does not. *If wrong:* none; behaviour measured.
17. **Accepted free-tier rate limits as an operating characteristic.** A cold seed may need a second `--force` pass; it now fails *closed* and says so. *If wrong:* an operator runs seed twice.
18. **Recorded `serverExternalPackages` in the plan** and fixed my own wrong 415 test fixture (`.json` is a supported extension). *If wrong:* none.
19. **Derived document titles from `h1`.** Six documents shared one scraped title, which would have made citations indistinguishable. *If wrong:* a document whose `h1` is worse than its `<title>` gets a poorer name; one line to change.
20. **Corrected my own stale test expectations** after the title change, rather than reverting the fix. *If wrong:* none.
21. **Declined a reviewer finding:** rejecting a bare "Gold Bank" title is intentional — the URL slug is more informative than the brand name. *If wrong:* none observable.
22. **Added `documentId` as the context sort's final tie-break**, removing a correctness dependency on titles being unique. *If wrong:* none.
23. **Ruled the one-document anchor coverage is not a defect** — measured the raw corpus; only Terms of Service publishes fragments. Documented the limit. *If wrong:* none; behaviour measured.
24. **Narrowed the citation regex to 1–2 digits** so a bracketed year (`[2004]`, plausible in a corpus citing the Financial Services Regulations 2004) is never silently deleted from a correct answer. Also serialized chat writes. *If wrong:* a citation index above 99 goes unrecognised — impossible at `TOP_K=8`.
25. **Dropped an unused hook return** that violated `react-hooks/refs`, rather than suppressing the rule. *(Later revisited — see 28.)*
26. **Fixed the ingest progress reducer**, which created two rows per upload — one orphaned under the filename, one labelled with a raw internal id. *If wrong:* a zip's later documents share the archive's label.
27. **Split `/knowledge` into a server shell + client component** rather than silencing `react-hooks/set-state-in-effect`. Removes the effect, drops an HTTP hop, and renders true counts pre-hydration. *If wrong:* one extra file; standard Next.js shape.
28. **Amended the "no magic numbers" constraint** to define what a tunable actually is, after it was flagged in three separate tasks. Promoted the genuinely behavioural constants to config. *If wrong:* an operator edits code rather than env for a formatting constant.

## Found by the whole-branch review, and fixed

Three of these were invisible to per-task review because they live *between* tasks:

- **Unauthenticated arbitrary file write** via the multipart upload filename. The same bug class had already been closed on the read side (`lib/chats.ts`); the write side four files away had not.
- **A browser disconnect destroyed a completed document** — `enqueue` threw after abort, ingest read it as a pipeline failure, and deleted the vectors of a document that had finished embedding.
- **Validated citations never reached the browser** — the corrected answer was persisted but the client rendered the raw stream, so a hallucinated marker showed live and vanished on reload.
- **`/c/[id]` was unreachable** — every conversation persisted with no way to find its URL.
- **`getChatModel` memoized on first call**, so every answer was served at temperature 0 and `CHAT_TEMPERATURE` was a dead tunable.
- **`AGENTS.md` / `CLAUDE.md` untracked** — machine-generated by `next dev`, they would hand every cloner a spurious dirty diff.
