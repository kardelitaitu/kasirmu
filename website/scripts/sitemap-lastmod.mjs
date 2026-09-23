#!/usr/bin/env node
/**
 * sitemap-lastmod.mjs
 *
 * Per-URL `<lastmod>` for the sitemap, derived from real content dates.
 *
 * WHY NOT `new Date()`: Google discards a lastmod that is always "now". A
 * build-time stamp makes every URL look freshly changed on every deploy, which
 * is strictly worse than omitting the field. So this resolves a genuine date
 * per URL and returns `undefined` when it cannot, rather than inventing one.
 *
 * Sources, in order:
 *   1. Docs pages → the authored `updated` frontmatter date. That is the same
 *      value the page itself renders (DocsLayout), so the sitemap and the page
 *      cannot disagree with each other.
 *   2. Everything else → the newest git commit date for the page's source file.
 *   3. No date available → `undefined`; the field is omitted for that URL.
 *
 * A SHALLOW clone counts as "no git dates". In a depth-1 clone every file
 * appears in the single fetched commit, so every URL would resolve to the
 * checkout date — precisely the always-now value this module exists to avoid.
 * `actions/checkout` is shallow by default, so that is the CI case, not a
 * hypothetical; the docs dates still come through there.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname; // website/scripts
const WEBSITE = join(HERE, '..'); // website
const REPO = join(WEBSITE, '..'); // repo root

const DOCS_PREFIX = 'website/src/content/docs/';

/**
 * Repo-relative source file for a sitemap URL, or null when the URL has no
 * single source file this map knows about.
 */
export function sourceFileFor(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  if (pathname === '/') return 'website/src/pages/index.astro';
  const m = /^\/([a-z]{2})\/(.*)$/.exec(pathname);
  if (!m) return null;
  const [, locale, rest] = m;
  const parts = rest.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return 'website/src/pages/[locale]/index.astro';
  if (parts[0] === 'docs') {
    if (parts.length === 1) return 'website/src/pages/[locale]/docs/index.astro';
    return `${DOCS_PREFIX}${locale}/${parts.slice(1).join('/')}.md`;
  }
  return `website/src/pages/[locale]/${parts.join('/')}.astro`;
}

/** `updated: "2026-08-30"` from a docs file's YAML frontmatter, or undefined. */
export function frontmatterUpdated(absPath) {
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return undefined;
  }
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!block) return undefined;
  const m = /^updated:[ \t]*["']?(\d{4}-\d{2}-\d{2})["']?[ \t]*$/m.exec(block[1]);
  return m ? m[1] : undefined;
}

/**
 * Newest commit date per repo-relative path. The log is newest-first, so the
 * first sighting of a path wins. Returns an empty map when git is unavailable
 * or the clone is shallow — see the header note.
 *
 * MEMOIZED PER REPO. Each call reads a full `git log --name-only` over the
 * whole history, which on this repository is thousands of commits; without a
 * cache, callers that ask twice pay twice, and the test suite asked four times
 * — slow enough (≈1.2 s per call) to trip vitest's 5 s per-test timeout
 * whenever the machine was busy. The answer cannot change under a build, so it
 * is computed once per process and reused. Laziness is preserved: nothing runs
 * until the first call.
 */
const gitDatesCache = new Map();

export function gitDatesByPath(repo = REPO) {
  const cached = gitDatesCache.get(repo);
  if (cached) return cached;
  const result = readGitDates(repo);
  gitDatesCache.set(repo, result);
  return result;
}

/** The uncached read behind `gitDatesByPath` — never call this directly. */
function readGitDates(repo) {
  const git = (args) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

  try {
    if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') return new Map();
  } catch {
    return new Map();
  }

  let log;
  try {
    log = git(['log', '--format=%cI', '--name-only', '--diff-filter=ACMR']);
  } catch {
    return new Map();
  }

  const dates = new Map();
  let date;
  for (const line of log.split('\n')) {
    if (!line) continue;
    if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
      date = line;
    } else if (date && !dates.has(line)) {
      dates.set(line, date);
    }
  }
  return dates;
}

/**
 * `(url) => ISO date string | undefined`, for `@astrojs/sitemap`'s `serialize`.
 * The git log is read lazily so `astro dev` does not pay for it.
 */
export function createLastmodResolver() {
  let gitDates;
  return (url) => {
    const rel = sourceFileFor(url);
    if (!rel) return undefined;
    if (rel.startsWith(DOCS_PREFIX)) return frontmatterUpdated(join(REPO, rel));
    gitDates ??= gitDatesByPath();
    return gitDates.get(rel);
  };
}
