import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The product was renamed from OZ-POS to kasir.mu, and the two install guides
 * kept telling readers to run `OZ-POS_<version>_x64-setup.exe` until 2026-09-23.
 * No installer has been published under that name since the rebrand, because a
 * bundle's installer is named after the productName in
 * apps/desktop-tauri/tauri.conf.json — so anyone who followed the published
 * install steps met a file-not-found, and every other guard here stayed green:
 * both dictionaries agreed with each other, both locales matched, and the
 * sentence was well-formed prose in a markdown file.
 *
 * This is the source half of the guard. scripts/check-seo.mjs asserts the same
 * thing on the rendered pages, where an href to the GitHub repository — which
 * still contains `oz-pos` — is not counted, since the repo kept its name.
 */

const SRC = join(import.meta.dirname, '..');
const RETIRED_BRAND = /\bOZ[-_ ]?POS/i;
/** The GitHub repository kept its name through the rebrand; naming it is right. */
const KEPT_REPOSITORY = /kardelitaitu\/oz-pos/g;
const SCANNED = /\.(?:md|astro|tsx|ts|json)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SCANNED.test(name)) out.push(path);
  }
  return out;
}

const relativeToSrc = (path: string) => relative(SRC, path).split(sep).join('/');
/** Test files quote the retired brand in order to guard against it. */
const sources = walk(SRC).filter((path) => !relativeToSrc(path).includes('__tests__'));

describe('retired brand', () => {
  it('is named nowhere in the site source', () => {
    const offenders = sources.filter((path) =>
      RETIRED_BRAND.test(readFileSync(path, 'utf8').replace(KEPT_REPOSITORY, ' ')),
    );
    expect(offenders.map(relativeToSrc)).toEqual([]);
  });
});

describe('install guides', () => {
  const guides = {
    en: readFileSync(join(SRC, 'content', 'docs', 'en', 'installation.md'), 'utf8'),
    id: readFileSync(join(SRC, 'content', 'docs', 'id', 'installation.md'), 'utf8'),
  };

  it.each(Object.keys(guides) as (keyof typeof guides)[])(
    'name the installer the app actually builds (%s)',
    (locale) => {
      const placeholder = locale === 'en' ? '<version>' : '<versi>';
      expect(guides[locale]).toContain(`kasir.mu_${placeholder}_x64-setup.exe`);
    },
  );

  it.each(Object.keys(guides) as (keyof typeof guides)[])(
    'route the reader into the site download page (%s)',
    (locale) => {
      // `../../download/` from /xx/docs/installation/ is /xx/download/, the
      // product's own localized page — not straight off-site to the repository.
      expect(guides[locale]).toContain('](../../download/)');
    },
  );
});
