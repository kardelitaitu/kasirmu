// ── The Payments Save button cannot exist while the location is unresolved ──
//
// Round 156 read `handleSave`'s gate (`if (!sessionToken || !locationId) return;`,
// `RestaurantPaymentsScreen.tsx:740`) and the Save button's `disabled={!dirty || saving ||
// loadFailed}` (:997) and concluded the two disagreed: Save could look clickable while the
// save silently did nothing — the same shape as F40.
//
// They do NOT disagree, and the reason is a render gate further down. The whole header,
// Save button included, is inside `{!loading && …}` (:976), and `locationId` is resolved
// inside the SAME `loadAll` that clears `loading` (:374-385, :540). So the control cannot
// mount before the location exists, and the silent return is unreachable through the UI.
//
// This pins that, because what makes it true is the ORDERING, not the line numbers. A
// refactor that lifts the header out of the `!loading` branch, or that resolves the location
// in a second effect, would reopen the hole. A test that holds the location read open and
// asks whether Save is on screen fails in exactly that case.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import RestaurantPaymentsScreen from '@/features/restaurant/screens/RestaurantPaymentsScreen';
import { ToastProvider } from '@/components/Toast';
import { getPrimaryLocationScoped } from '@/api/locations';

vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: vi.fn(),
}));
vi.mock('@/api/local-payment', () => ({
  getLocalPaymentMethodsScoped: vi.fn(async () => []),
  setLocalPaymentMethodsScoped: vi.fn(async () => []),
  readStaticQrPayload: vi.fn(() => null),
  writeStaticQrPayload: vi.fn(() => {}),
}));
vi.mock('@/api/edc', () => ({
  listEdcTerminalsScoped: vi.fn(async () => []),
  edcTerminalStatusScoped: vi.fn(async () => ({ connected: false })),
}));
vi.mock('@/hooks/useTerminalHardware', () => ({
  useTerminalHardware: () => ({
    profile: null,
    save: async () => {},
    updateLocalPrefs: () => {},
  }),
}));

const mockLocation = vi.mocked(getPrimaryLocationScoped);

function bundleForTest() {
  const bundle = new FluentBundle('en');
  bundle.addResource(new FluentResource('save = Save'));
  const l10n = new ReactLocalization([bundle]);
  return l10n;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the Payments Save button and the unresolved-location race', () => {
  it('does not render Save while the location read is still pending', async () => {
    // The read NEVER resolves — the worst case for the race round 156 described.
    // The read NEVER resolves — the worst case for the race round 156 described.
    let resolveIt: ((v: unknown) => void) | undefined;
    mockLocation.mockImplementation(
      () => new Promise((resolve) => { resolveIt = resolve; }) as unknown as ReturnType<typeof getPrimaryLocationScoped>,
    );

    render(
      <LocalizationProvider l10n={bundleForTest()}>
        <ToastProvider>
          {/* No sessionToken prop: the screen reads it from useWorkspace(), which the
              * global test-setup stub provides. */}
          <RestaurantPaymentsScreen onBack={() => {}} />
        </ToastProvider>
      </LocalizationProvider>,
    );

    // The screen must stay on its loading branch, which is what keeps Save off the page.
    await waitFor(() => {
      expect(screen.getByText(/loading/i)).toBeTruthy();
    }, { timeout: 4000 });

    expect(
      screen.queryByTestId('restaurant-payments-save-btn'),
      'Save must not be reachable before the location resolves',
    ).toBeNull();

    // Let it resolve — Save must then appear, so this is not a test of a blank screen.
    resolveIt?.({ id: 'loc-1', name: 'Store' });
    await waitFor(() => {
      expect(screen.queryByTestId('restaurant-payments-save-btn')).not.toBeNull();
    }, { timeout: 4000 });
  });
});