/**
 * Native browser tooltip compliance
 *
 * The app has ONE tooltip design: the React <Tooltip> component in
 * `frontend/shell/Tooltip.tsx`. A `title` attribute on a plain HTML element
 * instead renders the OS/browser's own square tooltip, which
 *
 *   1. looks nothing like the designed bubble (off-brand, unthemeable),
 *   2. is not localized (browsers render it verbatim),
 *   3. cannot be delayed/clamped/dismissed like ours, and
 *   4. STACKS on top of a real <Tooltip> when both sit on the same hover
 *      target — the settings-sidebar "double tooltip" report, where the
 *      scope pill's `title="Configuration Scope: …"` appeared next to the
 *      nav item's own bubble.
 *
 * So: `title=` is banned on intrinsic JSX elements. A `title` PROP on a
 * component (`<SectionCard title="…">`) is fine — that is app code deciding
 * how to render it, not the browser.
 *
 * Detection is AST-based (TypeScript), not regex: the attribute must be
 * resolved against its owning tag, which line-based matching cannot do.
 *
 * Enforcement is a RATCHET against `scripts/native-tooltip-baseline.json`:
 * ~90 legacy uses predate this rule and live across files under active
 * development, so they are grandfathered by per-file count. The test fails
 * when a file GAINS one, and also when a file SHRINKS (stale baseline), so
 * the list can only ever get shorter.
 *
 * Known limitation: a `title` arriving via spread (`<div {...props}>`) or
 * `setAttribute('title', …)` is invisible to static analysis.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve, relative, sep } from 'path';

const UI_SRC = resolve(__dirname, '..');
const REPO_ROOT = resolve(UI_SRC, '..', '..');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'native-tooltip-baseline.json');

/** POSIX-relative path from ui/src, e.g. "features/settings/SettingsNavTree.tsx". */
function relPath(absPath: string): string {
  return relative(UI_SRC, absPath).split(sep).join('/');
}

function collectTsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectTsxFiles(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

export interface NativeTitleHit {
  file: string;
  line: number;
  tag: string;
}

/**
 * A `title` is a NATIVE browser tooltip only when it is a JSX attribute on an
 * intrinsic (lower-case) element. Qualified names (`<Foo.Bar>`) and capitalised
 * names (`<Tooltip>`) are component props.
 */
function isNativeTitleTarget(tagName: string): boolean {
  return /^[a-z]/.test(tagName) && !tagName.includes('.');
}

/** Scan one source file for native `title` attributes. */
export function findNativeTitles(absPath: string): NativeTitleHit[] {
  const source = readFileSync(absPath, 'utf8');
  // Cheap pre-filter: nothing to parse without the word.
  if (!/\btitle\s*=/.test(source)) return [];

  const sf = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: NativeTitleHit[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (isNativeTitleTarget(tag)) {
        for (const prop of node.attributes.properties) {
          if (ts.isJsxAttribute(prop) && prop.name.getText(sf) === 'title') {
            hits.push({
              file: relPath(absPath),
              line: sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line + 1,
              tag,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** All shipped source (tests excluded — fixtures may legitimately set title). */
const SHIPPED_FILES = collectTsxFiles(UI_SRC).filter((f) => !f.includes(`__tests__${sep}`));

const HITS = SHIPPED_FILES.flatMap(findNativeTitles);

/** file -> count of native title attributes. */
const counts = new Map<string, number>();
for (const hit of HITS) counts.set(hit.file, (counts.get(hit.file) ?? 0) + 1);

const baseline: Record<string, number> = existsSync(BASELINE_PATH)
  ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as { counts: Record<string, number> }).counts
  : {};

const format = (file: string, line: number, tag: string): string =>
  `  ${file}:${line}  <${tag} title=…>`;

describe('native browser tooltip compliance (no title= on HTML elements)', () => {
  it('baseline file exists and is valid', () => {
    expect(existsSync(BASELINE_PATH), `missing ${BASELINE_PATH}`).toBe(true);
    expect(Object.keys(baseline).length, 'baseline is empty').toBeGreaterThan(0);
  });

  it('introduces no NEW native title attributes', () => {
    const regressions: string[] = [];
    for (const [file, count] of counts) {
      const allowed = baseline[file] ?? 0;
      if (count > allowed) {
        const hits = HITS.filter((h) => h.file === file);
        regressions.push(
          `${file}: ${count} native title(s), baseline allows ${allowed}\n` +
            hits.map((h) => format(h.file, h.line, h.tag)).join('\n'),
        );
      }
    }
    expect(regressions, `New native browser tooltips found.\n${regressions.join('\n')}`).toEqual([]);
  });

  it('keeps the baseline honest — shrink it when a file is cleaned up', () => {
    const stale: string[] = [];
    for (const [file, allowed] of Object.entries(baseline)) {
      const actual = counts.get(file) ?? 0;
      if (actual < allowed) {
        stale.push(`${file}: baseline says ${allowed}, source now has ${actual} — lower it to ${actual}`);
      }
    }
    expect(stale, `Stale baseline entries.\n${stale.join('\n')}`).toEqual([]);
  });

  it('total native tooltip count never grows', () => {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const baselineTotal = Object.values(baseline).reduce((a, b) => a + b, 0);
    expect(total, `native title= count rose from ${baselineTotal} to ${total}`).toBeLessThanOrEqual(baselineTotal);
  });

  // ── Specific guards ───────────────────────────────────────────────

  it('SettingsScopeTag carries no native title (the double-tooltip origin)', () => {
    const hits = HITS.filter((h) => h.file.endsWith('SettingsScopeTag.tsx'));
    expect(hits.map((h) => format(h.file, h.line, h.tag))).toEqual([]);
  });

  it('the shared Tooltip component itself never sets a native title', () => {
    const hits = HITS.filter((h) => h.file.endsWith('shell/Tooltip.tsx'));
    expect(hits.map((h) => format(h.file, h.line, h.tag))).toEqual([]);
  });

  it('document.title (page title) is not mistaken for a tooltip', () => {
    // AppLayout sets document.title for the window caption — legitimate.
    const src = readFileSync(join(UI_SRC, 'frontend', 'shell', 'AppLayout.tsx'), 'utf8');
    expect(src).toContain('document.title');
    expect(HITS.some((h) => h.file.endsWith('AppLayout.tsx'))).toBe(false);
  });
});
