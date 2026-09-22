/**
 * The heading-outline rule — one h1 per document, no level skipped — with one
 * owner for the rule and for what counts as a heading.
 *
 * Two callers run it, and they must never disagree about either:
 *   • `scripts/check-seo.mjs` check 12, on all 89 built pages. That is the only
 *     place a composed Astro page's real outline exists.
 *   • `src/__tests__/heading-outline.test.ts`, on the HTML sources that ship
 *     verbatim (`prototypes/**` → `/dev/`, `public/**` → `/admin/`) and on every
 *     template that writes heading markup, so a violation visible in source
 *     fails in `npm test` instead of after a full `astro build`.
 *
 * RENDERING is the subject, not markup: comments, `<script>`, `<style>`,
 * `<noscript>` and `<template>` are stripped before headings are counted,
 * because a heading no consumer receives is not part of an outline. For one
 * round the two locale-detect stubs passed this rule through an `<h1>` inside
 * `<noscript>` while being headless on every path a reader or crawler takes.
 * That is why the two forms are exported separately: `renderedHeadings()` is
 * what the rule runs on, and the difference against `allHeadingsIn()` is how a
 * test detects a heading that exists only in markup that never renders.
 */

/** One heading element, in document order. */
export interface Heading {
  level: number;
  text: string;
}

const HEADING = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g;

/** A comment open, and a non-rendered element open, in one pass. */
const NON_RENDERED_OR_COMMENT = /<!--|<(script|style|noscript|template)\b/gi;

/**
 * Drop the regions a consumer does not receive — comments, and the content of
 * `<script>`, `<style>`, `<noscript>` (not rendered when scripting is on) and
 * `<template>` (not rendered until cloned).
 *
 * A scan rather than a pair of regexes, because a regex that only knew about
 * `</script>` cannot tell which form it is looking at and reads straight past a
 * self-closing one. Both forms are real here: `DocsLayout.astro` and
 * `Base.astro` write their JSON-LD blocks as `<script ... />`, and stripping
 * from the first of those to the file's one true closer swallowed the whole
 * page template, `<h1>{title}</h1>` included — a false "this page has no h1"
 * that only the source-level test ever saw, since Astro writes the explicit
 * closer into dist. Comments are handled in the same pass so that neither shape
 * can hide inside the other.
 */
function withoutNonRendered(html: string): string {
  const kept: string[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  NON_RENDERED_OR_COMMENT.lastIndex = 0;
  while ((match = NON_RENDERED_OR_COMMENT.exec(html))) {
    const start = match.index;
    let end: number;
    if (match[0] === '<!--') {
      const close = html.indexOf('-->', start + '<!--'.length);
      end = close === -1 ? html.length : close + '-->'.length;
    } else {
      const openEnd = html.indexOf('>', start);
      if (openEnd === -1) break; // malformed tail: keep it rather than guess
      if (html[openEnd - 1] === '/') {
        end = openEnd + 1; // `<script ... />` ends at its own tag
      } else {
        const name = match[1].toLowerCase();
        const close = new RegExp(`</${name}\\s*>`, 'i').exec(html.slice(openEnd + 1));
        // No closer: treat the element as ending at its own tag and keep the
        // rest. Dropping the remainder instead would turn a prose mention of
        // `<noscript>` in a source comment into "this page has no h1" — which is
        // how this rule first failed on its own component. Astro always writes
        // the closer into dist, so the malformed shape is a source artifact.
        end = close ? openEnd + 1 + close.index + close[0].length : openEnd + 1;
      }
    }
    kept.push(html.slice(cursor, start));
    cursor = end;
    NON_RENDERED_OR_COMMENT.lastIndex = cursor;
  }
  kept.push(html.slice(cursor));
  return kept.join('');
}

/** The heading's own text, as a screen reader would announce it. */
const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const headingsOf = (html: string): Heading[] =>
  [...html.matchAll(HEADING)].map((match) => ({ level: Number(match[1]), text: text(match[2]) }));

/** Every heading element in the markup, rendered or not. */
export const allHeadingsIn = headingsOf;

/** The headings a consumer receives: non-rendered regions are stripped first. */
export const renderedHeadings = (html: string): Heading[] => headingsOf(withoutNonRendered(html));

/**
 * Every way an outline is wrong, in the order a reader would meet it. Messages
 * are returned rather than thrown so that both callers report the same wording.
 */
export function outlineIssues(headings: Heading[]): string[] {
  const issues: string[] = [];
  const h1s = headings.filter((heading) => heading.level === 1);
  if (h1s.length === 0) {
    issues.push('has no <h1> — the document has no title in its outline');
  } else if (h1s.length > 1) {
    issues.push(
      `has ${h1s.length} <h1>s (${h1s.map((heading) => JSON.stringify(heading.text.slice(0, 40))).join(', ')}) — a page has one`,
    );
  }
  let previous: number | null = null;
  for (const heading of headings) {
    if (previous !== null && heading.level > previous + 1) {
      issues.push(
        `skips from h${previous} to h${heading.level} at ${JSON.stringify(heading.text.slice(0, 40))} — a level may not be skipped`,
      );
    }
    previous = heading.level;
  }
  return issues;
}
