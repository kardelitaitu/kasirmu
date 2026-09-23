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
 *
 * The stripping itself lives in `html-scan.ts`, shared with the accessibility
 * rule next door — both judge the same rendered pages and must agree on what a
 * consumer actually receives.
 */

// The explicit `.ts` extension is what lets `scripts/check-seo.mjs` load this
// module under Node's type stripping, where extensionless specifiers do not
// resolve; `check-seo` is one of this rule's two callers.
import { textOf, withoutNonRendered } from './html-scan.ts';

/** One heading element, in document order. */
export interface Heading {
  level: number;
  text: string;
}

const HEADING = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g;

const headingsOf = (html: string): Heading[] =>
  [...html.matchAll(HEADING)].map((match) => ({ level: Number(match[1]), text: textOf(match[2]) }));

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
