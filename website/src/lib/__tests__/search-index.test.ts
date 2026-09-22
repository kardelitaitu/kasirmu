import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DOC_KEYWORDS,
  INITIAL_RESULTS,
  buildSearchIndex,
  docItems,
  filterSearch,
  scoreItem,
  toSearchDocs,
  type SearchDoc,
  type SearchDocSource,
} from '../search-index';

/**
 * The search index's job is to make every docs page findable, so these tests
 * are written against the **real corpus on disk** rather than a fixture. A
 * fixture would drift exactly the way the hardcoded list this module replaced
 * did; reading `src/content/docs/<locale>/*.md` means adding a doc without
 * making it searchable fails here.
 */
const DOCS_ROOT = join(import.meta.dirname, '..', '..', 'content', 'docs');

function readCorpus(locale: string): SearchDoc[] {
  const dir = join(DOCS_ROOT, locale);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const body = readFileSync(join(dir, name), 'utf-8');
      const title = body.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? name;
      const description = body.match(/^description:\s*"?(.+?)"?\s*$/m)?.[1] ?? '';
      return { slug: name.replace(/\.md$/, ''), title, description };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * The same corpus as collection entries — the shape `toSearchDocs()` consumes,
 * with the `id` prefix and frontmatter `order` the real collection carries.
 * Built from disk for the same reason as `readCorpus`: a fixture cannot catch
 * a doc that stopped being searchable.
 */
function readEntries(locale: string): SearchDocSource[] {
  const dir = join(DOCS_ROOT, locale);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const body = readFileSync(join(dir, name), 'utf-8');
      return {
        id: `${locale}/${name.replace(/\.md$/, '')}`,
        data: {
          title: body.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? name,
          description: body.match(/^description:\s*"?(.+?)"?\s*$/m)?.[1],
          order: Number(body.match(/^order:\s*(\d+)/m)?.[1] ?? 0),
        },
      };
    });
}

const EN_DOCS = readCorpus('en');
const ID_DOCS = readCorpus('id');
const ENTRIES: SearchDocSource[] = [...readEntries('en'), ...readEntries('id')];

describe('search index — corpus coverage', () => {
  it('reads the whole docs corpus', () => {
    // Guards the test itself: an empty or tiny corpus would make every
    // coverage assertion below vacuously true.
    expect(EN_DOCS.length).toBeGreaterThanOrEqual(17);
    expect(ID_DOCS.map((d) => d.slug).sort()).toEqual(EN_DOCS.map((d) => d.slug).sort());
  });

  for (const locale of ['en', 'id'] as const) {
    const docs = locale === 'en' ? EN_DOCS : ID_DOCS;
    const index = buildSearchIndex(locale, docs);

    it(`[${locale}] every doc is findable by its slug words`, () => {
      const missing = docs
        .filter(
          (doc) =>
            !filterSearch(index, doc.slug.replace(/-/g, ' ')).some((item) =>
              item.url.endsWith(`/docs/${doc.slug}`),
            ),
        )
        .map((doc) => doc.slug);
      expect(missing).toEqual([]);
    });

    it(`[${locale}] every doc is findable by its own title`, () => {
      const missing = docs
        .filter((doc) => !filterSearch(index, doc.title).some((item) => item.url.endsWith(`/docs/${doc.slug}`)))
        .map((doc) => doc.slug);
      expect(missing).toEqual([]);
    });

    it(`[${locale}] indexes exactly one entry per doc`, () => {
      const docIds = index.filter((item) => item.category === 'docs').map((item) => item.id);
      expect(docIds).toHaveLength(docs.length);
      expect(new Set(docIds).size).toBe(docs.length);
    });
  }

  it('has no curated keyword for a doc that no longer exists', () => {
    const slugs = new Set(EN_DOCS.map((d) => d.slug));
    expect(Object.keys(DOC_KEYWORDS).filter((slug) => !slugs.has(slug))).toEqual([]);
  });
});

describe('search index — ranking', () => {
  const index = buildSearchIndex('en', EN_DOCS);
  const idIndex = buildSearchIndex('id', ID_DOCS);

  it('ranks an exact title match above keyword-only matches', () => {
    // "Inventory & Warehouses" is a word-prefix title hit; the marketing pages
    // only carry "inventory" in their keywords, so the doc must come first.
    const results = filterSearch(index, 'inventory');
    expect(results[0].url).toBe('/en/docs/inventory');
    expect(results.length).toBeGreaterThan(1);
  });

  it('ranks a doc above a page that merely shares the word', () => {
    const results = filterSearch(index, 'settings');
    expect(results[0].url).toBe('/en/docs/settings');
  });

  it('matches a singular query against a plural doc title', () => {
    expect(filterSearch(index, 'terminal')[0].url).toBe('/en/docs/terminals');
  });

  it('matches slug words for multi-word slugs', () => {
    expect(filterSearch(index, 'user roles').map((i) => i.url)).toContain('/en/docs/user-roles');
  });

  it('surfaces symptom keywords a page title never contains', () => {
    const hits = filterSearch(index, 'reconciliation').map((i) => i.url);
    expect(hits).toContain('/en/docs/shifts');
    expect(filterSearch(index, 'insufficient scope').map((i) => i.url)).toContain('/en/docs/api-read-tiers');
  });

  it('ranks localized id titles for Indonesian queries', () => {
    expect(filterSearch(idIndex, 'pengaturan')[0].url).toBe('/id/docs/settings');
    expect(filterSearch(idIndex, 'lisensi')[0].url).toBe('/id/docs/licensing');
  });

  it('returns nothing for an unmatched query so the modal can show its empty state', () => {
    expect(filterSearch(index, 'xyznonexistentterm')).toEqual([]);
  });

  it('shows the first pages before any query, limited to INITIAL_RESULTS', () => {
    const initial = filterSearch(index, '   ');
    expect(initial).toHaveLength(INITIAL_RESULTS);
    expect(initial.every((item) => item.category === 'pages')).toBe(true);
  });

  it('is deterministic for equal scores', () => {
    // Two items with the same score keep their index order rather than
    // depending on sort implementation.
    expect(filterSearch(index, 'kasir').map((i) => i.url)).toEqual(
      filterSearch(index, 'kasir').map((i) => i.url),
    );
  });

  it('scores an exact title above a substring title above a keyword hit', () => {
    const base = { id: 'x', category: 'docs' as const, url: '/en/docs/x' };
    const exact = scoreItem({ ...base, title: 'Terminals' }, 'terminals');
    const substring = scoreItem({ ...base, title: 'Managing Terminals Today' }, 'terminals');
    const keyword = scoreItem({ ...base, title: 'Something Else', keywords: 'terminals here' }, 'terminals');
    expect(exact).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(keyword);
    expect(keyword).toBeGreaterThan(0);
  });
});

describe('search index — toSearchDocs (the one doc→payload rule)', () => {
  it('keeps only the requested locale and strips its prefix from the slug', () => {
    const en = toSearchDocs(ENTRIES, 'en');
    expect(en).toHaveLength(EN_DOCS.length);
    expect(en.map((doc) => doc.slug).sort()).toEqual(EN_DOCS.map((doc) => doc.slug).sort());
    // A doc from the other locale must never leak into this payload.
    expect(en.some((doc) => doc.slug.startsWith('id/'))).toBe(false);
  });

  it('orders by frontmatter order, as the sidebar does', () => {
    const entries: SearchDocSource[] = [
      { id: 'en/second', data: { title: 'Second', order: 2 } },
      { id: 'en/first', data: { title: 'First', order: 1 } },
      { id: 'id/other', data: { title: 'Other', order: 0 } },
    ];
    expect(toSearchDocs(entries, 'en').map((doc) => doc.slug)).toEqual(['first', 'second']);
  });

  it('normalizes a missing description to an empty string', () => {
    expect(toSearchDocs([{ id: 'en/only', data: { title: 'Only', order: 1 } }], 'en')).toEqual([
      { slug: 'only', title: 'Only', description: '' },
    ]);
  });

  it("leaves the caller's array alone while sorting", () => {
    // The collection read is shared and cached, so ordering it in place would
    // reorder every other consumer of the same array.
    const entries: SearchDocSource[] = [
      { id: 'en/b', data: { title: 'B', order: 2 } },
      { id: 'en/a', data: { title: 'A', order: 1 } },
    ];
    toSearchDocs(entries, 'en');
    expect(entries.map((entry) => entry.id)).toEqual(['en/b', 'en/a']);
  });

  it('builds a payload that keeps every corpus doc findable in both locales', () => {
    for (const locale of ['en', 'id'] as const) {
      const docs = readCorpus(locale);
      const index = buildSearchIndex(locale, toSearchDocs(ENTRIES, locale));
      const missing = docs
        .filter(
          (doc) =>
            !filterSearch(index, doc.slug.replace(/-/g, ' ')).some((item) =>
              item.url.endsWith(`/docs/${doc.slug}`),
            ),
        )
        .map((doc) => doc.slug);
      expect(missing).toEqual([]);
    }
  });
});

describe('search index — doc item shape', () => {
  it('builds localized urls and searchable text from the entry', () => {
    const [item] = docItems([{ slug: 'cloud-sync', title: 'Sinkron Cloud', description: 'Sinkron lintas toko' }], 'id');
    expect(item.url).toBe('/id/docs/cloud-sync');
    expect(item.id).toBe('doc-cloud-sync');
    expect(item.keywords).toContain('cloud sync'); // slug words
    expect(item.keywords).toContain('Sinkron lintas toko'); // description
  });
});
