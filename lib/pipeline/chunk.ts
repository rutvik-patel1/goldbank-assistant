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
      if (d.kind !== 'qa' && countTokens(d.text) < config.MIN_CHUNK_TOKENS) continue; // drop scraps
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
