import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The quick-search modal's docs used to be a hardcoded array inside
 * `SearchModal.tsx` that fell behind the corpus (measured: 9 of 17 docs
 * searchable, several titles stale). These are source assertions for the
 * ownership rule that replaced it — the same style as
 * `doc-sidebar-search.test.ts` — because the failure mode was structural
 * (a second, drifting source of the doc list), not behavioural.
 *
 * The payload has since moved again: it was built inside `Header.astro`, which
 * made a presentational component the owner of a collection read *and* of the
 * `pathname.includes('/docs')` rule for what counts as a docs page. It is now
 * built by the docs routes (`toSearchDocs`) and forwarded as a prop through the
 * layout, so these pin both halves: the header must stay prop-only, and the
 * builder must stay in the docs routes.
 */
const ROOT = join(import.meta.dirname, '..', '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf-8');

/** Every non-test source file under src/, as src/-relative POSIX paths. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const relative = `${dir}/${entry}`;
      if (statSync(join(ROOT, relative)).isDirectory()) {
        if (entry !== '__tests__') walk(relative);
        continue;
      }
      if (/\.(astro|ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(relative);
    }
  };
  walk('components');
  walk('layouts');
  walk('lib');
  walk('pages');
  return out;
}

const DOCS_ROUTES = ['pages/[locale]/docs/[...slug].astro', 'pages/[locale]/docs/index.astro'];

/**
 * A real import of the payload builder. Matching the import rather than the
 * bare name means prose *about* the builder (several comments name it) cannot
 * be mistaken for a use of it, the way a plain `includes('toSearchDocs')` did.
 */
const BUILDER_IMPORT = /import\s*(?:type\s*)?\{[^}]*\btoSearchDocs\b[^}]*\}\s*from/;

describe('search index wiring', () => {
  it('Header renders the trigger from a prop, not from the collection', () => {
    const header = read('components/Header.astro');
    expect(header).not.toContain('astro:content');
    expect(header).not.toContain('getCollection(');
    // The docs-ness rule must not come back as a pathname test here.
    expect(header).not.toContain('pathname.includes');
    expect(header).toContain('searchDocs?: SearchDoc[]');
    expect(header).toContain('docs={searchDocs}');
  });

  it('the docs routes are the only builders of the payload', () => {
    // Exactly the two docs routes, so the read cannot drift back into a
    // component or layout — which is the defect this move removed.
    const builders = sourceFiles().filter((file) => BUILDER_IMPORT.test(read(file))).sort();
    expect(builders).toEqual([...DOCS_ROUTES]);
    for (const route of DOCS_ROUTES) expect(read(route)).toContain('toSearchDocs(');
  });

  it('each docs route hands its payload to the layout it renders', () => {
    expect(read('pages/[locale]/docs/[...slug].astro')).toContain('searchDocs={searchDocs}');
    expect(read('pages/[locale]/docs/index.astro')).toContain('searchDocs={searchDocs}');
  });

  it('the layouts only forward the prop — they own no fetch and no rule', () => {
    for (const file of ['layouts/Base.astro', 'layouts/DocsLayout.astro']) {
      const layout = read(file);
      expect(layout).toContain('searchDocs?: SearchDoc[]');
      expect(layout).toContain('searchDocs={searchDocs}');
      expect(layout).not.toContain('astro:content');
      expect(BUILDER_IMPORT.test(layout)).toBe(false);
    }
  });

  it('no component under components/ reads a content collection', () => {
    // The Header read was the only one, and it is exactly the drift this
    // rewrite removed: a presentational component fetching a collection.
    const offenders = sourceFiles().filter((file) => file.startsWith('components/') && read(file).includes('astro:content'));
    expect(offenders).toEqual([]);
  });

  it('SearchTrigger forwards docs to the modal', () => {
    const trigger = read('components/SearchTrigger.tsx');
    expect(trigger).toContain('docs: SearchDoc[]');
    expect(trigger).toContain('docs={docs}');
  });

  it('SearchModal holds no hardcoded doc entries', () => {
    const modal = read('components/SearchModal.tsx');
    expect(modal).not.toMatch(/id:\s*'doc-/);
    expect(modal).not.toMatch(/\/docs\//);
    expect(modal).toContain('buildSearchIndex');
  });

  it('the index module never hardcodes a specific doc', () => {
    const index = read('lib/search-index.ts');
    // Doc urls are built from the entry's slug, so no literal `docs/<slug>`
    // may appear — that is what a regressed hardcoded entry would look like.
    expect(index).not.toMatch(/\/docs\/[a-z]/);
    expect(index).toContain('docItems');
  });
});
