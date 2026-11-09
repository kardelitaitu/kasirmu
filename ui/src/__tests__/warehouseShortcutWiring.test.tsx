// ── ui/src/__tests__/warehouseShortcutWiring.test.tsx ────────────────────
//
// The FnBar button and the keyboard shortcut that advertises the SAME key must run
// the same action.
//
// WHY THIS FILE EXISTS
// --------------------
// `warehouseShortcutParity.test.tsx` looks like it covers this and does not. Its
// claim 3 ("every active shortcut must have a keydown handler") compares
// `ACTIVE_SHORTCUT_ACTIONS` against `WAREHOUSE_SHORTCUTS` — but that set is DERIVED
// from that manifest (warehouseShortcuts.ts:61-63), so the assertion is A ⊆ A and can
// never fail. Measured: deleting the real `case 'print':` handler from
// WarehouseConsole.tsx, which kills F5, left all nine parity tests GREEN.
//
// The consequence was live: `case 'print':` called `e.preventDefault()` and then did
// nothing, while the FnBar button for the same key called
// `addToast({type:'info', message:'Print'})` (WarehouseConsole.tsx:557). F5 was
// printed on the button, listed in the help overlay, and dead. `case 'shortcut-list':`
// had the identical shape for `?`.
//
// These tests drive the real keydown path and assert an observable effect, which is
// the only thing that can detect a dead or divergent handler.

import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import WarehouseConsole from '@/features/warehouse/WarehouseConsole';

vi.mock('@/features/warehouse/useWarehouseScanner', () => ({
  useWarehouseScanner: () => ({}),
}));
// `ShiftBar` (mounted into WarehouseConsole in round 164) reads `useAuth`, and the shared
// `renderWithProviders` helper supplies Brand/Theme/Toast/Zoom but NOT AuthProvider. Mocking
// `useAuth` directly is the established workaround -- 86 other suites do the same -- and it is
// safer than widening the helper for every component that happens to read a session.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: null, user: null }),
}));


/** The FnBar button that advertises `key`, or null when nothing advertises it. */
function fnBarButton(key: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`.warehouse-fn-btn[aria-keyshortcuts="${key}"]`);
}

/**
 * Assert a key runs the same action as the button advertising it.
 *
 * The button is clicked FIRST to establish the baseline: the shortcut is required to
 * add its own announcement on top, which is what "runs the same action" means
 * observably. A key that preventDefaults and does nothing leaves the count unchanged.
 */
async function assertKeyRunsTheButtonAction(key: string): Promise<void> {
  const btn = fnBarButton(key);
  expect(btn, `no FnBar button advertises ${key} — the manifest and the bar disagree`).not.toBeNull();

  fireEvent.click(btn!);
  await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1));
  const afterClick = screen.getAllByRole('alert').length;

  fireEvent.keyDown(document, { key });
  await waitFor(() =>
    expect(
      screen.getAllByRole('alert').length,
      `${key} produced no announcement; the button advertising it did`,
    ).toBeGreaterThan(afterClick),
  );
}

describe('warehouse shortcut wiring — key and button must agree', () => {
  it('F5 (print) runs the same action as its FnBar button', async () => {
    await renderWithProviders(<WarehouseConsole />);
    await assertKeyRunsTheButtonAction('F5');
  });

  it('? (help) runs the same action as its FnBar button', async () => {
    await renderWithProviders(<WarehouseConsole />);
    await assertKeyRunsTheButtonAction('?');
  });
});
