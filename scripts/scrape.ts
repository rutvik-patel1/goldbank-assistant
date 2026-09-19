import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import TurndownService from 'turndown';
import { paths } from '../lib/config';

/**
 * Rebuild the committed corpus under `knowledge-base/goldbank/`.
 *
 * The original ten pages were scraped with Firecrawl in September 2026; this
 * harness fetches the same shape without that dependency — HTML over plain
 * HTTP, converted with `turndown`, written into the same
 * `{ markdown, metadata }` envelope `loadScrapedJson` reads. Provenance is
 * recorded per file in `metadata.scraper` so the two batches stay tellable
 * apart.
 *
 * Informational pages only. Product, brand and collection pages quote live
 * prices that move daily, and nothing in this pipeline refreshes an indexed
 * document — the bot would cite a stale figure as current fact.
 */
const PAGES = [
  'contact',
  'our-delivery-options',
  'our-trade-services',
  'sell',
  // `sell-now` is not listed: it is a client-rendered valuation widget whose
  // entire static body sits inside an `aria-hidden` container, so once hidden
  // markup is excluded there is nothing on the page to index.
  'gold-account',
  'vat-on-bullion',
  'zakat',
  'what-determines-the-price-of-gold',
  'why-buy-goldarticle',
  'history-of-the-gold-sovereign',
  'cash-for-gold-companies',
];

const ORIGIN = 'https://goldbank.co.uk';
const USER_AGENT = 'goldbank-kb-scraper/1.0 (+corpus rebuild for gb-chatbot)';
const POLITE_DELAY_MS = 750;

function turndown(): TurndownService {
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });

  // Pair a <dl> positionally. This site lays its opening hours out as one column
  // of <dt> and a second of <dd>, so the default rules emit seven day names
  // followed by seven unattached times — "Sunday" and "Closed" eight lines
  // apart. Opening hours are a top-five customer question; scrambled is worse
  // than absent.
  td.addRule('definitionList', {
    filter: 'dl',
    replacement: (content, node) => {
      const textOf = (tag: string) =>
        Array.from((node as unknown as Element).getElementsByTagName(tag))
          .map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);
      const terms = textOf('dt');
      const defs = textOf('dd');
      if (!terms.length || terms.length !== defs.length) return content;
      return `\n\n${terms.map((t, i) => `- ${t}: ${defs[i]}`).join('\n')}\n\n`;
    },
  });

  // A heading broken across lines by <br> ("Get in<br>touch") becomes a one-word
  // heading with the rest orphaned as prose, which then lands in the heading
  // path and every citation drawn from the page.
  td.addRule('headings', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: (content, node) => {
      const text = content.replace(/\s+/g, ' ').trim();
      if (!text) return '';
      return `\n\n${'#'.repeat(Number(node.nodeName.charAt(1)))} ${text}\n\n`;
    },
  });

  // Per-page furniture the tag name alone does not identify.
  //
  // Breadcrumbs restate the heading path the pipeline recovers anyway, and
  // arrive as a link soup that `splitLeadingTocList` would harvest as a table of
  // contents, inventing anchors that do not exist on the page.
  //
  // The newsletter and its `aria-hidden` "Coming soon" modal are identical on
  // every page and invisible to a reader on all of them. Left in, the modal's
  // paragraph is indexed a dozen times over and — because heading recovery
  // promotes its `Coming soon` title to a section — it outranks the real answer:
  // it was the top hit for "what determines the gold price?".
  td.addRule('furniture', {
    filter: (node) =>
      /breadcrumb|subscribe|newsletter|modal/i.test(String(node.getAttribute?.('class') ?? '')) ||
      node.getAttribute?.('aria-hidden') === 'true' ||
      node.hasAttribute?.('hidden'),
    replacement: () => '',
  });

  // Chrome, not content. This site has no <main>: the shared 220 KB mega-menu
  // lives in <header> and the link farm in <footer>, so dropping those leaves
  // exactly the page body. These go through `addRule` rather than `remove`,
  // because `remove` is consulted only after turndown's built-in rules — an
  // `img` or a `head` passed to it is matched by the built-in rule first and
  // survives.
  td.addRule('chrome', {
    filter: [
      'head', 'title', 'meta', 'link', 'base',
      'script', 'style', 'noscript', 'svg', 'iframe', 'form',
      'header', 'footer', 'nav', 'button', 'select',
      'img', 'picture', 'video', 'source',
    ] as never,
    replacement: () => '',
  });

  return td;
}

/** Collapse the layout noise turndown faithfully preserves from a visual page. */
function tidy(markdown: string): string {
  const lines = markdown
    // An icon-only link survives its stripped <img> as empty brackets, often
    // wrapped across lines. Match before splitting, or only the inline form goes.
    .replace(/\[\s*\]\([^)]*\)/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+$/, '').replace(/ /g, ' '))
    // `* * *` is a stripped icon rule; "Loading..." is the placeholder a
    // client-rendered page (sell-now) ships in its static HTML.
    // `* * *` is a stripped icon rule, a bare `-` an emptied list item, and
    // "Loading..." the placeholder a client-rendered page (sell-now) ships in
    // its static HTML.
    .filter((l) => !['* * *', '-', 'Loading...'].includes(l.trim()));

  // These pages render the same copy twice, once per breakpoint, and the two
  // copies are usually far apart rather than adjacent. Left in, each one becomes
  // a second near-identical chunk competing with the first at retrieval. Drop
  // any exact repeat of a heading or of a substantial line, keeping the first.
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of lines) {
    const key = line.trim();
    const worthDeduping = /^#{1,6}\s/.test(key) || key.length >= 25;
    if (worthDeduping) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(line);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function titleFrom(html: string): string {
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  return raw.replace(/\s+/g, ' ').trim();
}

async function scrape(slug: string, td: TurndownService) {
  const url = `${ORIGIN}/${slug}`;
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  const html = await res.text();

  // Two sitemap entries (`about`, `supplier`) answer 404 with the site's styled
  // error page. Report them rather than writing a stub: the corpus already
  // carries one such page and refusing it at parse time is a behaviour worth
  // testing, not one worth duplicating.
  const soft404 = /404 - Page not found/i.test(html);
  if (!res.ok || soft404) {
    return { slug, url, skipped: `HTTP ${res.status}${soft404 ? ' (soft 404 body)' : ''}` };
  }

  const markdown = tidy(td.turndown(html));
  if (markdown.length < 200) return { slug, url, skipped: `only ${markdown.length} chars of body` };

  const filename = `goldbank.co.uk_${slug}.json`;
  await writeFile(
    join(paths.corpus, filename),
    `${JSON.stringify(
      {
        markdown,
        metadata: {
          title: titleFrom(html),
          sourceURL: url,
          url,
          statusCode: res.status,
          contentType: res.headers.get('content-type') ?? 'text/html',
          scrapedAt: new Date().toISOString(),
          scraper: 'curl+turndown (scripts/scrape.ts)',
        },
      },
      null,
      2,
    )}\n`,
  );
  return { slug, url, filename, chars: markdown.length };
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const targets = only.length ? only : PAGES;
  await mkdir(paths.corpus, { recursive: true });
  const td = turndown();

  console.log(`scraping ${targets.length} page(s) from ${ORIGIN} into ${paths.corpus}\n`);
  let written = 0, skipped = 0;
  for (const [i, slug] of targets.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
    try {
      const r = await scrape(slug, td);
      if ('skipped' in r) {
        skipped++;
        console.log(`  ${slug.padEnd(34)} SKIPPED — ${r.skipped}`);
      } else {
        written++;
        console.log(`  ${slug.padEnd(34)} ${String(r.chars).padStart(6)} chars → ${r.filename}`);
      }
    } catch (e) {
      skipped++;
      console.log(`  ${slug.padEnd(34)} FAILED  — ${(e as Error).message}`);
    }
  }
  console.log(`\nwrote ${written} file(s), skipped ${skipped}`);
  console.log('Next: npm run verify:parse, then npm run seed -- --force');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
