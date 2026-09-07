/**
 * Native dialog compliance — no window.alert / window.confirm / window.prompt.
 *
 * Why this exists: the destructive "Pull from Server" in Cloud Sync asked for
 * consent with `window.confirm()`. The OS rendered that dialog — off-design,
 * unlocalized chrome, and it blocks the JS event loop while open. The app
 * already ships a designed equivalent (`@/components/ConfirmDialog`, used by
 * currency, customers, inventory, data management, appearance and topology),
 * so any native dialog is a regression to browser UI inside a desktop shell.
 *
 * Same class of defect as the native `title` tooltip guard
 * (nativeTooltipCompliance.test.ts): the browser/OS drawing chrome that the
 * design system owns.
 *
 * Unlike that guard, this one is zero-tolerance — the codebase is already
 * clean, so there is nothing to grandfather.
 *
 * Detection is AST-based (TypeScript compiler API), so comments and string
 * literals can never trip it: only real call expressions do.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve, relative, sep } from 'path';

const UI_SRC = resolve(__dirname, '..');

const NATIVE_DIALOGS = new Set(['alert', 'confirm', 'prompt']);
/** Receivers that make a call native rather than a local helper. */
const GLOBAL_RECEIVERS = new Set(['window', 'globalThis', 'self']);

interface DialogHit {
  file: string;
  line: number;
  /** e.g. `window.confirm` or bare `alert` */
  callee: string;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Resolve a callee to a dotted name, or null when it is not a plain reference. */
function calleeName(node: ts.Expression, sf: ts.SourceFile): string | null {
  if (ts.isIdentifier(node)) return node.getText(sf);
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const owner = node.expression.getText(sf);
    // Only `window.confirm(...)` counts; `store.confirm(...)` is app code.
    if (GLOBAL_RECEIVERS.has(owner)) return `${owner}.${node.name.getText(sf)}`;
  }
  return null;
}

function isNativeCall(name: string | null): boolean {
  if (!name) return false;
  const dot = name.indexOf('.');
  const bare = dot === -1 ? name : name.slice(dot + 1);
  return NATIVE_DIALOGS.has(bare);
}

export function findNativeDialogs(absPath: string): DialogHit[] {
  const source = readFileSync(absPath, 'utf8');
  // Cheap pre-filter: nothing to parse without one of the names.
  if (!/(alert|confirm|prompt)\s*\(/.test(source)) return [];

  const sf = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = relative(UI_SRC, absPath).split(sep).join('/');
  const hits: DialogHit[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isNativeCall(calleeName(node.expression, sf))) {
      hits.push({
        file: rel,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        callee: calleeName(node.expression, sf) as string,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

const SCANNED = sourceFiles(UI_SRC).filter((f) => !f.includes(`__tests__${sep}`));
const HITS = SCANNED.flatMap(findNativeDialogs);

function format(hits: DialogHit[]): string {
  return hits.map((h) => `  ${h.file}:${h.line}  ${h.callee}()`).join('\n');
}

describe('native dialog compliance (no alert/confirm/prompt)', () => {
  it('scans a meaningful share of the UI source tree', () => {
    expect(SCANNED.length).toBeGreaterThan(200);
  });

  it('contains zero native browser dialogs in application code', () => {
    expect(
      HITS,
      'Native dialogs render OS chrome instead of the design system. Use ' +
        '<ConfirmDialog> from @/components/ConfirmDialog (themed, localized, non-blocking) ' +
        `or the Toast system from @/frontend/shared/Toast instead.\n${format(HITS)}`,
    ).toEqual([]);
  });

  it('the destructive sync pull uses ConfirmDialog, not window.confirm', () => {
    // Regression pin for the specific defect this suite was written for.
    const src = readFileSync(
      join(UI_SRC, 'features', 'settings', 'sections', 'SyncSection.tsx'),
      'utf8',
    );
    expect(src).toContain('<ConfirmDialog');
    expect(src).toContain('confirmDestructive: true');
    expect(HITS.some((h) => h.file.endsWith('SyncSection.tsx'))).toBe(false);
  });

  it('does not flag same-named methods on app objects', () => {
    // `store.confirm()` and `props.alert()` are app code, not the native
    // global. Feed the classifier a synthetic sample to prove the distinction,
    // otherwise the guard would be trivially bypassable by renaming nothing —
    // or worse, would block legitimate method calls.
    const sample = [
      'const a = store.confirm();',
      'const b = props.alert();',
      'const c = window.confirm("native");',
      'const d = confirm("also native");',
    ].join('\n');
    const sf = ts.createSourceFile('sample.ts', sample, ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const name = calleeName(n.expression, sf);
        if (isNativeCall(name)) found.push(name as string);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(found).toEqual(['window.confirm', 'confirm']);
  });
});
