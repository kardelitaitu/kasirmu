import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ALLOWED_LITERALS, findUiStringOffenders } from '../lib/ui-strings';

/**
 * Hardcoded-UI-string gate.
 *
 * `audit-i18n.mjs` proves the KEYS a file reads exist; island-label-coverage
 * proves an island's declared keys match its call sites. Neither can see a
 * literal, which is how English reached /id/ pages through `aria-label="Search"`,
 * `btn.textContent = 'Copy'` and an `isId ? … : 'Thanks for your feedback!'`
 * ternary. This is the missing third check: every literal on a prose attribute,
 * written into the DOM, or spelled out in markup must be routed through the
 * dictionaries or declared in ALLOWED_LITERALS with a reason.
 *
 * The second describe block is the part that matters most: it proves the gate
 * can FAIL, on a fixture, so a passing run means something.
 */

describe('hardcoded UI strings', () => {
  it('finds no undeclared literal UI string in the site source', () => {
    const offenders = findUiStringOffenders();
    expect(
      offenders.map((item) => `${item.file}:${item.line} [${item.rule}] ${JSON.stringify(item.value)}`),
    ).toEqual([]);
  });

  it('keeps every allowlisted literal documented', () => {
    for (const entry of ALLOWED_LITERALS) {
      expect(entry.value.length, 'allowlist entry needs a value').toBeGreaterThan(0);
      // Short is fine ("The product name."); empty or "n/a" is not.
      expect(
        entry.reason.trim().length,
        `"${entry.value}" needs a written reason, not a placeholder`,
      ).toBeGreaterThan(12);
    }
  });
});

describe('the gate itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-strings-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const fixture = (name: string, contents: string) => {
    writeFileSync(join(dir, name), contents, 'utf8');
    return name;
  };

  it('catches a literal attribute, a literal DOM write and prose in markup', () => {
    mkdirSync(join(dir, '__tests__'), { recursive: true });
    fixture(
      'offender.tsx',
      [
        'export const A = () => <button aria-label="Search" />;',
        "el.textContent = 'Copy code to clipboard';",
        "el.setAttribute('aria-label', 'Copy code to clipboard');",
        'el.innerHTML = `Please try again later`;',
        'export const B = () => <p>Page not found</p>;',
      ].join('\n'),
    );
    fixture(
      'offender.astro',
      [
        '---',
        "import { t } from '../i18n';",
        'const x: Record<string, string> = {};',
        '---',
        '<a href="#main">',
        '  Skip to content',
        '</a>',
        '<script>const label = x > y ? "a" : "b";</script>',
      ].join('\n'),
    );
    // A test file quotes what it guards and must not be scanned.
    fixture('__tests__/guard.test.ts', "expect(x).toBe('Page not found');");

    const found = findUiStringOffenders(dir);
    const values = found.map((item) => item.value);
    expect(values).toContain('Search');
    expect(values).toContain('Copy code to clipboard');
    expect(values).toContain('Please try again later');
    expect(values).toContain('Page not found');
    // A sentence on its own line between two tags — no `>` on that line.
    expect(values).toContain('Skip to content');
    // Frontmatter and script bodies are not markup: their code is not prose.
    expect(values.some((value) => value.includes('Record<string'))).toBe(false);
    expect(values.some((value) => value.includes('label = x'))).toBe(false);
    expect(found.filter((item) => item.file.includes('__tests__'))).toEqual([]);
  });

  it('does not read TypeScript code between a `>` and a later `<` as text', () => {
    const ts = mkdtempSync(join(tmpdir(), 'ui-strings-ts-'));
    writeFileSync(
      join(ts, 'code.ts'),
      [
        'export const f = (cond: boolean) => {',
        '  const nodes = cond ? Array.from(document.querySelectorAll("a")) : [];',
        '  return nodes.filter((node) => node.id !== "");',
        '};',
      ].join('\n'),
      'utf8',
    );
    expect(findUiStringOffenders(ts)).toEqual([]);
    rmSync(ts, { recursive: true, force: true });
  });

  it('ignores translated expressions, tokens and declared literals', () => {
    const clean = mkdtempSync(join(tmpdir(), 'ui-strings-clean-'));
    writeFileSync(
      join(clean, 'clean.tsx'),
      [
        "export const A = ({ labels }) => <button aria-label={t(labels, 'search.quickSearch')} />;",
        "el.textContent = t(labels, 'docs.copyCode');",
        "el.textContent = data.license_key;",
        "el.setAttribute('aria-expanded', 'true');",
        "el.setAttribute('aria-label', 'Discord');",
        'export const B = () => <p>{t(locale, \'notFound.title\')}</p>;',
        '// <h1>Page not found</h1> was the old behaviour',
        '/* thanks for reading */',
      ].join('\n'),
      'utf8',
    );
    expect(findUiStringOffenders(clean)).toEqual([]);
    rmSync(clean, { recursive: true, force: true });
  });
});
