import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The quick-search modal's docs used to be a hardcoded array inside
 * `SearchModal.tsx` that fell behind the corpus (measured: 9 of 17 docs
 * searchable, several titles stale). These are source assertions for the
 * ownership rule that replaced it — the same style as
 * `doc-sidebar-search.test.ts` — because the failure mode was structural
 * (a second, drifting list), not behavioural.
 */
const ROOT = join(import.meta.dirname, '..', '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf-8');

describe('search index wiring', () => {
  it('Header derives docs from the content collection', () => {
    const header = read('components/Header.astro');
    expect(header).toContain("getCollection('docs')");
    expect(header).toContain('docs={searchDocs}');
  });

  it('Header only reads the collection where the trigger renders', () => {
    // The collection read is gated on isDocs so non-docs pages do not pay for it.
    const header = read('components/Header.astro');
    expect(header).toMatch(/isDocs\s*\?[\s\S]{0,80}getCollection\('docs'\)/);
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
