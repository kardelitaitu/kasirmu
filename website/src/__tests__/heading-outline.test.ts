import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allHeadingsIn, outlineIssues, renderedHeadings } from '../lib/heading-outline';

/**
 * The other half of the heading-outline guard.
 *
 * `scripts/check-seo.mjs` check 12 measures every BUILT page, which is the
 * authority on a composed Astro page's outline — that outline only exists after
 * the layout, the page and the components are assembled. What it cannot do is
 * fail early: it needs a full `astro build` first, so the cheapest way to learn
 * that a hand-written page lost its `<h1>` is a build plus a post-build run.
 *
 * This test covers what source can prove exactly, using the same rule module so
 * the two can never disagree about what a heading is:
 *
 *   1. HTML that ships VERBATIM. `prototypes/**` is copied into
 *      `website/public/dev/` by `scripts/sync-dev-files.mjs` on prebuild and
 *      `public/**` is copied as-is, so `/dev/kds-prototype.html`,
 *      `/dev/design-language.html`, `/admin/` and `/admin/login.html` reach the
 *      build byte-for-byte. Their outline is decided entirely in the file, which
 *      is why the rule applies to the source and not just to dist. The list is a
 *      directory walk, not an array, so a new prototype is covered on the commit
 *      that adds it.
 *
 *   2. No heading may live in markup that never renders. `renderedHeadings()`
 *      strips comments, `<script>`, `<style>`, `<noscript>` and `<template>`;
 *      a template whose raw and rendered headings differ has a heading that no
 *      reader and no crawler receives. That is not hypothetical: `/` and
 *      `/pair/` satisfied the built check for a round through an `<h1>` inside
 *      `<noscript>` while being headless on every path a consumer takes, and
 *      this arm fails on that shape before a build is attempted.
 *
 * Composed Astro pages are deliberately NOT approximated here. Counting `<h1>`
 * literals in a page file would call every page that delegates its heading to a
 * component (the five vertical landings all do) a violation, and a guard that
 * cries wolf is worse than the build it saves. The built check owns those.
 */

const SRC = join(import.meta.dirname, '..');
const WEBSITE = join(SRC, '..');
const REPO = join(WEBSITE, '..');
const PROTOTYPES = join(REPO, 'prototypes');
const PUBLIC = join(WEBSITE, 'public');

// The generated mirror of prototypes/ — identical bytes, and gitignored, so it
// is the source directory that is checked rather than its copy.
const GENERATED = `${sep}public${sep}dev${sep}`;
/** Markup-bearing sources: a heading can only be written in one of these. */
const MARKUP = /\.(?:astro|tsx|html)$/;
const SKIPPED = [`${sep}__tests__${sep}`, GENERATED];

const isMarkup = (path: string) => MARKUP.test(path) && !SKIPPED.some((part) => path.includes(part));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (isMarkup(path)) out.push(path);
  }
  return out;
}

/** Repo-relative, forward-slashed: what a failure message should name. */
const named = (path: string) => relative(REPO, path).split(sep).join('/');

/** Files whose outline is fully decided by the file itself. */
const verbatim = [...walk(PROTOTYPES), ...walk(PUBLIC)].filter((path) => path.endsWith('.html'));

describe('the heading rule', () => {
  const outline = (html: string) => outlineIssues(renderedHeadings(html));

  it('accepts a document with one h1 and no skipped level', () => {
    expect(outline('<h1>Title</h1><h2>One</h2><h3>Detail</h3><h2>Two</h2>')).toEqual([]);
  });

  it('rejects a document with no h1', () => {
    expect(outline('<h2>Only a subhead</h2>')).toEqual([
      'has no <h1> — the document has no title in its outline',
    ]);
  });

  it.each([
    ['<noscript>', '<noscript><h1>Fallback</h1></noscript>'],
    ['a comment', '<!-- <h1>Old title</h1> -->'],
    ['<template>', '<template><h1>Card</h1></template>'],
    ['<script>', '<script>const t = "<h1>x</h1>";</script>'],
  ])('rejects a document whose only h1 sits inside %s', (_what, markup) => {
    // The shape both stubs shipped: the check passed, and no consumer got a
    // heading. `<noscript>` is the one that matters — with scripting on it is
    // never rendered, so "it has an h1 for the no-script reader" is not a
    // defence.
    expect(outline(markup)).toEqual(['has no <h1> — the document has no title in its outline']);
  });

  it('does not count a second heading that only exists in non-rendered markup', () => {
    expect(outline('<h1>Title</h1><!-- <h1>Duplicate</h1> -->')).toEqual([]);
  });

  it('ends a self-closing element at its own tag, not at the next closer', () => {
    // `DocsLayout.astro` and `Base.astro` write their JSON-LD blocks as
    // `<script ... />`. A matcher that only knew `</script>` read from the first
    // of those to the file's one real closer and swallowed the page template,
    // h1 included — a false "this page has no h1" that no built page could
    // show, because Astro writes the explicit closer into dist.
    const source =
      '<script type="application/ld+json" set:html={{ a: 1 }} />\n<h1>{title}</h1>\n<script>setup();</script>';
    expect(renderedHeadings(source).map((heading) => heading.text)).toEqual(['{title}']);
  });

  it('handles a comment inside an element and an element inside a comment', () => {
    // Comments and elements are stripped in one pass so neither can hide in the
    // other — the two orders a pair of regexes has to pick between.
    expect(outline('<script>const guard = "<!--";</script><h1>Title</h1>')).toEqual([]);
    expect(outline('<!-- <script><h1>Example</h1></script> --><h1>Title</h1>')).toEqual([]);
  });

  it('rejects two rendered h1s', () => {
    expect(outline('<h1>One</h1><h1>Two</h1>')).toEqual([
      'has 2 <h1>s ("One", "Two") — a page has one',
    ]);
  });

  it('rejects a skipped level and names where', () => {
    expect(outline('<h1>Title</h1><h2>Setup</h2><h4>Theme</h4>')).toEqual([
      'skips from h2 to h4 at "Theme" — a level may not be skipped',
    ]);
  });
});

describe('HTML that ships verbatim', () => {
  it('has files to check at all', () => {
    // Without this, a rename of prototypes/ or a change to the walker would
    // leave every assertion below vacuously green.
    expect(verbatim.length, 'no verbatim HTML found — is the walker still pointed at the sources?')
      .toBeGreaterThan(3);
    expect(verbatim.map(named)).toContain('prototypes/kds-prototype.html');
    expect(verbatim.map(named)).toContain('website/public/admin/index.html');
  });

  it.each(verbatim.map((path) => [named(path), path]))(
    '%s has exactly one h1 and no skipped level in its source',
    (_name, path) => {
      const issues = outlineIssues(renderedHeadings(readFileSync(path, 'utf8')));
      expect(
        issues,
        'this file is shipped as-is, so its outline is decided here and the built check would only catch it after a full build',
      ).toEqual([]);
    },
  );
});

describe('no heading lives in markup that never renders', () => {
  // The TEMPLATE, not the whole file: `.astro` frontmatter is JS, where a
  // heading can only be a string or part of a comment explaining the rule.
  // `LocaleFallback.astro` names `<noscript>` in its own doc comment, and the
  // first version of this arm reported the component that documents the rule as
  // a violation of it.
  const templateOf = (source: string) =>
    source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

  const templates = walk(SRC);

  it('scans the templates that write headings', () => {
    const names = templates.map(named);
    expect(templates.length).toBeGreaterThan(20);
    expect(names.some((name) => name.endsWith('src/pages/index.astro'))).toBe(true);
    expect(names.some((name) => name.includes('src/components/'))).toBe(true);
  });

  it.each(templates.map((path) => [named(path), path]))(
    '%s renders every heading it writes',
    (_name, path) => {
      const template = templateOf(readFileSync(path, 'utf8'));
      expect(
        allHeadingsIn(template).map((heading) => heading.text),
        'a heading inside a comment, <script>, <style>, <noscript> or <template> is part of no outline — check-seo check 12 strips it, and no consumer receives it',
      ).toEqual(renderedHeadings(template).map((heading) => heading.text));
    },
  );
});
