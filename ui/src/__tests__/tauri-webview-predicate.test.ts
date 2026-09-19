/**
 * isTauriWebview() — the seam predicate itself.
 *
 * This is the one place that decides "are we in a real Tauri webview?" for
 * useFullscreen, useUnsavedChangesGuard and PosScreen. It exists because the
 * obvious test is wrong: `'__TAURI_INTERNALS__' in window` is TRUE in the
 * browser dev preview, where `ui/index.html` installs a partial stub
 * (`{ transformCallback }`) so the Tauri mocks lib can bootstrap. Every caller
 * that trusted key-presence went on to call `invoke`, which the stub does not
 * have, and the resulting TypeError was toasted as "Unexpected error".
 *
 * So the contract pinned here is deliberately narrow: only a CALLABLE `invoke`
 * counts. `invoke` present-but-not-a-function must not, because that is exactly
 * the shape that made the old test look right.
 *
 * The function reads `window` directly and has no other dependency, so these
 * cases need no module mocks — they install the internals object and assert.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { isTauriWebview } from '@/api/tauri';

const KEY = '__TAURI_INTERNALS__';

/** Install (or clear) the internals object the way a host would. Bracket
 *  notation is required by the repo's noPropertyAccessFromIndexSignature rule. */
function setInternals(value: unknown): void {
  const w = window as unknown as Record<string, unknown>;
  if (value === undefined) delete w[KEY];
  else w[KEY] = value;
}

describe('isTauriWebview', () => {
  afterEach(() => {
    setInternals(undefined);
  });

  it('is false when the internals object is absent', () => {
    expect(isTauriWebview()).toBe(false);
  });

  it('is false for the dev preview partial stub ({ transformCallback } only)', () => {
    // Verbatim shape from ui/index.html — the case the whole predicate exists
    // for. Key-presence would answer true here.
    setInternals({ transformCallback: () => 1 });
    expect(isTauriWebview()).toBe(false);
  });

  it('is false when invoke is present but not callable', () => {
    setInternals({ invoke: 'not-a-function' });
    expect(isTauriWebview()).toBe(false);

    setInternals({ invoke: null });
    expect(isTauriWebview()).toBe(false);

    setInternals({ invoke: {} });
    expect(isTauriWebview()).toBe(false);
  });

  it('is false when the internals object is not an object', () => {
    setInternals('tauri');
    expect(isTauriWebview()).toBe(false);
  });

  it('is true when invoke is a function', () => {
    setInternals({ invoke: () => Promise.resolve() });
    expect(isTauriWebview()).toBe(true);
  });

  it('is true when invoke is a function alongside other internals keys', () => {
    // A live webview carries more than `invoke`; nothing else may change the
    // answer in either direction.
    setInternals({ transformCallback: () => 1, invoke: () => Promise.resolve(), metadata: {} });
    expect(isTauriWebview()).toBe(true);
  });
});
