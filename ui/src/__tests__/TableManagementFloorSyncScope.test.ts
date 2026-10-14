// ── Floor-plan sync listeners must follow the CURRENT store and section ─────
//
// TableManagementScreen subscribes to three Tauri events so one terminal's
// floor-plan edit lands on every other terminal. The `tabs:changed` handler
// calls `loadTables()`, which reads BOTH the store token and the section:
//
//     listTablesScoped(sessionToken, section ?? undefined)
//     listOpenBillsScoped(sessionToken)
//
// That subscription's effect listed an EMPTY dependency array, so the handler
// was built on the first render and kept that render's `sessionToken` and
// `section` for the lifetime of the screen. The sibling effect two lines above
// (:204-207) lists `[loadTables, sessionToken, refreshKey]` — the contrast that
// makes this a bug rather than a style choice.
//
// The consequence is the store-scoping failure this repo has a rule about: a
// cashier switches store, another terminal saves a tab, the LAN event arrives,
// and the floor plan is REPLACED with the previous store's tables — silently,
// on the screen the cashier is using to seat people. Switching sections had the
// same shape: the reload used the old `section`.
//
// WHY THIS IS A SOURCE CHECK, NOT A RENDER TEST
// A behavioural test would have to mock `listen`, capture the handler, mutate
// the workspace scope, and then prove which token reached `listTablesScoped` —
// but jsdom cannot re-render the real WorkspaceContext around a mocked
// `listen` without pinning a scaffolding the production code does not have. The
// dependency array IS the defect and it is statically visible, so it is read
// directly. This is the same trade the order-type field sweep and the
// crash-isolation guard make, and the weaker evidence is stated rather than
// implied: this asserts the deps, not the runtime token.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '../features/tables/TableManagementScreen.tsx'),
  'utf-8',
);

describe('TableManagementScreen floor-plan sync scope', () => {
  it('the event-listener effect re-subscribes when the load function changes', () => {
    // Isolate the effect that registers the three floor-plan listeners.
    const anchor = SRC.indexOf("listen('tabs:changed'");
    expect(anchor, 'the tabs:changed subscription moved — re-point this guard').toBeGreaterThan(-1);

    // Walk back to that effect's opening, then forward to its dependency array.
    const effectStart = SRC.lastIndexOf('useEffect(() => {', anchor);
    expect(effectStart).toBeGreaterThan(-1);
    // The array is the `}, [...])` that closes this effect, before the next
    // top-level `const`.
    const rest = SRC.slice(anchor);
    const close = rest.indexOf('}, [');
    expect(close, 'could not find the dependency array').toBeGreaterThan(-1);
    const deps = rest.slice(close, rest.indexOf(']);', close) + 3);

    expect(
      deps,
      [
        'the floor-plan listener effect must depend on loadTables, and through it',
        'on sessionToken and section.',
        'With an empty array the tabs:changed handler keeps the mount-time store',
        "token, so a store switch followed by any other terminal's save reloads the",
        "PREVIOUS store's floor plan.",
        'Found: ' + deps.replace(/\\s+/g, ' '),
      ].join(' '),
    ).toContain('loadTables');
  });
});
