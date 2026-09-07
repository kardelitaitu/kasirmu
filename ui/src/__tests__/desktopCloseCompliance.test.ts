/**
 * Desktop close-guard compliance.
 *
 * Why this exists: SettingsPage protected unsaved work with a `beforeunload`
 * listener. That is the browser mechanism — in a Tauri window the Rust event
 * loop decides whether the close proceeds and the webview's `beforeunload`
 * prompt is never surfaced, so the guard silently did nothing in the desktop
 * app while looking correct in code review and working fine in the :1420
 * browser preview.
 *
 * The supported seam is `getCurrentWindow().onCloseRequested()` +
 * `event.preventDefault()`, wrapped by `@/hooks/useUnsavedChangesGuard`.
 *
 * This suite pins two things:
 *  1. `beforeunload` may only be bound inside that hook, so an ad-hoc listener
 *     cannot reappear somewhere else and quietly not work on desktop.
 *  2. The hook itself must wire BOTH seams (Tauri + browser), because either
 *     one alone leaves a hole.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve, relative, sep } from 'path';

const UI_SRC = resolve(__dirname, '..');
const GUARD_FILE = 'hooks/useUnsavedChangesGuard.ts';

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/** Files that bind a beforeunload handler, via AST so comments can't match. */
function findBeforeUnloadBindings(): string[] {
  const found: string[] = [];
  for (const abs of sourceFiles(UI_SRC)) {
    if (abs.includes(`__tests__${sep}`)) continue;
    const source = readFileSync(abs, 'utf8');
    if (!source.includes('beforeunload')) continue;

    const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let hit = false;
    const visit = (n: ts.Node): void => {
      // addEventListener('beforeunload', …) / window.onbeforeunload = …
      if (ts.isCallExpression(n) && n.expression.getText(sf).endsWith('addEventListener')) {
        const first = n.arguments[0];
        if (first && ts.isStringLiteral(first) && first.text === 'beforeunload') hit = true;
      }
      if (ts.isBinaryExpression(n) && n.left.getText(sf).endsWith('onbeforeunload')) hit = true;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (hit) found.push(relative(UI_SRC, abs).split(sep).join('/'));
  }
  return found;
}

describe('desktop close-guard compliance', () => {
  it('binds beforeunload in exactly one place — the shared guard hook', () => {
    const files = findBeforeUnloadBindings();
    expect(
      files,
      `beforeunload is inert on Tauri window close. Route unsaved-work guards ` +
        `through @/${GUARD_FILE.replace('.ts', '')} so onCloseRequested is wired too.`,
    ).toEqual([GUARD_FILE]);
  });

  it('the guard hook wires the Tauri onCloseRequested seam', () => {
    const src = readFileSync(join(UI_SRC, GUARD_FILE), 'utf8');
    expect(src).toContain('onCloseRequested');
    expect(src).toContain('preventDefault()');
    // A close that is allowed must actually close the window.
    expect(src).toMatch(/getCurrentWindow\(\)\.close\(\)/);
  });

  it('the guard hook keeps the browser beforeunload seam', () => {
    // Both seams are required: dropping this one re-breaks tab close and the
    // :1420 dev preview, dropping the other re-breaks the real desktop app.
    const src = readFileSync(join(UI_SRC, GUARD_FILE), 'utf8');
    expect(src).toContain("'beforeunload'");
  });

  it('the guard latches its own close so it cannot intercept itself', () => {
    // win.close() re-enters onCloseRequested. Without a one-way latch the
    // discard path would preventDefault its own close and trap the window open.
    const src = readFileSync(join(UI_SRC, GUARD_FILE), 'utf8');
    expect(src).toMatch(/allowCloseRef\.current\s*=\s*true/);
    expect(src).toMatch(/if\s*\(allowCloseRef\.current\s*\|\|/);
  });

  it('SettingsPage drives its prompt from the guard, not a local listener', () => {
    const src = readFileSync(
      join(UI_SRC, 'features', 'settings', 'SettingsPage.tsx'),
      'utf8',
    );
    expect(src).toContain('useUnsavedChangesGuard');
    expect(src).toContain('<ConfirmDialog');
    expect(src).not.toMatch(/addEventListener\(\s*['"]beforeunload/);
  });
});
