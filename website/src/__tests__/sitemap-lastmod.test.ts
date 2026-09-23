import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createLastmodResolver,
  frontmatterUpdated,
  gitDatesByPath,
  sourceFileFor,
} from '../../scripts/sitemap-lastmod.mjs';

/**
 * Tests for the sitemap `<lastmod>` resolver.
 *
 * The rule under test is accuracy: a lastmod must reflect when the content
 * actually changed. A build timestamp for every URL is the failure mode this
 * module exists to prevent, because Google discards a lastmod that always says
 * "now" — so `undefined` (field omitted) is the correct answer whenever no real
 * date is known.
 */

const WEBSITE = join(import.meta.dirname, '..', '..');
const REPO = join(WEBSITE, '..');
const DOCS_WELCOME = join(REPO, 'website', 'src', 'content', 'docs', 'id', 'welcome.md');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T/;

describe('sourceFileFor', () => {
  it('maps the root to the locale-detect page', () => {
    expect(sourceFileFor('https://kasir.mu/')).toBe('website/src/pages/index.astro');
  });

  it('maps a locale home to that locale index', () => {
    expect(sourceFileFor('https://kasir.mu/id/')).toBe('website/src/pages/[locale]/index.astro');
    expect(sourceFileFor('https://kasir.mu/en/')).toBe('website/src/pages/[locale]/index.astro');
  });

  it('maps a marketing page', () => {
    expect(sourceFileFor('https://kasir.mu/id/pricing/')).toBe(
      'website/src/pages/[locale]/pricing.astro',
    );
  });

  it('keeps nested paths', () => {
    expect(sourceFileFor('https://kasir.mu/id/legal/privacy/')).toBe(
      'website/src/pages/[locale]/legal/privacy.astro',
    );
  });

  it('is indifferent to the trailing slash', () => {
    expect(sourceFileFor('https://kasir.mu/id/pricing')).toBe(
      sourceFileFor('https://kasir.mu/id/pricing/'),
    );
  });

  it('maps the docs hub to its own page, not to a doc', () => {
    expect(sourceFileFor('https://kasir.mu/id/docs/')).toBe(
      'website/src/pages/[locale]/docs/index.astro',
    );
  });

  it('maps a docs page to its markdown source', () => {
    expect(sourceFileFor('https://kasir.mu/id/docs/cloud-sync/')).toBe(
      'website/src/content/docs/id/cloud-sync.md',
    );
    expect(sourceFileFor('https://kasir.mu/en/docs/welcome/')).toBe(
      'website/src/content/docs/en/welcome.md',
    );
  });

  it('returns null when there is no single source file', () => {
    expect(sourceFileFor('https://kasir.mu/sitemap-0.xml')).toBeNull();
    expect(sourceFileFor('https://kasir.mu/robots.txt')).toBeNull();
    expect(sourceFileFor('not a url')).toBeNull();
  });

  it('maps real pages to files that exist on disk', () => {
    const urls = [
      'https://kasir.mu/',
      'https://kasir.mu/id/',
      'https://kasir.mu/id/pricing/',
      'https://kasir.mu/id/legal/privacy/',
      'https://kasir.mu/id/docs/',
      'https://kasir.mu/id/docs/cloud-sync/',
      'https://kasir.mu/en/docs/welcome/',
    ];
    for (const url of urls) {
      const rel = sourceFileFor(url);
      // `sourceFileFor` is typed `string | null`; assert non-null and narrow.
      if (!rel) throw new Error(`${url} should map to a source file`);
      expect(existsSync(join(REPO, rel)), `${url} -> ${rel} must exist`).toBe(true);
    }
  });
});

describe('frontmatterUpdated', () => {
  it('reads the authored date from a real docs file', () => {
    expect(frontmatterUpdated(DOCS_WELCOME)).toMatch(DATE);
  });

  it('returns undefined for a file that does not exist', () => {
    expect(frontmatterUpdated(join(REPO, 'website', 'src', 'content', 'docs', 'id', 'nope.md'))).toBeUndefined();
  });

  it('returns undefined for a file with no frontmatter', () => {
    expect(frontmatterUpdated(join(WEBSITE, 'package.json'))).toBeUndefined();
  });
});

describe('gitDatesByPath', () => {
  // The first call reads `git log --name-only` over the whole history — ~1 s on
  // an idle machine, several seconds while vitest is running 24 workers. Paying
  // it here (as setup, with a budget for it) keeps every assertion below on the
  // default timeout and makes the order the tests run in irrelevant.
  beforeAll(() => {
    gitDatesByPath();
  }, 30_000);

  it('returns a Map', () => {
    expect(gitDatesByPath()).toBeInstanceOf(Map);
  });

  it('keys by repo-relative path with forward slashes', () => {
    for (const key of gitDatesByPath().keys()) {
      expect(key.startsWith('/')).toBe(false);
      expect(key.includes('\\')).toBe(false);
    }
  });
});

describe('createLastmodResolver', () => {
  it('dates a docs URL from its frontmatter, not from git', () => {
    const resolver = createLastmodResolver();
    expect(resolver('https://kasir.mu/id/docs/welcome/')).toBe(frontmatterUpdated(DOCS_WELCOME));
    expect(resolver('https://kasir.mu/id/docs/welcome/')).toMatch(DATE);
  });

  it('returns undefined for a URL with no source file', () => {
    const resolver = createLastmodResolver();
    expect(resolver('https://kasir.mu/sitemap-0.xml')).toBeUndefined();
    expect(resolver('https://kasir.mu/xx/not-a-page/')).toBeUndefined();
  });

  it('never invents a date for a marketing page', () => {
    // A shallow clone (CI's default) yields no git dates, so the resolver must
    // omit the field rather than fall back to "now". Either a real commit date
    // or undefined is acceptable; a bare build timestamp is not.
    const value = createLastmodResolver()('https://kasir.mu/id/pricing/');
    expect(value === undefined || ISO.test(value)).toBe(true);
  });
});
