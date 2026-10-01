import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor, act, screen } from '@testing-library/react';
import { CurrencyProvider, useCurrency } from '@/contexts/CurrencyContext';
import CurrencyWorkspaceSync from '@/contexts/CurrencyWorkspaceSync';

// CurrencyContext reload (workspace half): the provider sits ABOVE
// WorkspaceProvider (pre-session bootstrap), so it can never see the
// store switch itself. CurrencyWorkspaceSync is the bridge rendered
// below WorkspaceProvider: on every session-token change it pushes the
// token into refresh(), so per-store scoped defaults (CUR-03) reach
// every useCurrency consumer without a page reload.

const wsState = vi.hoisted(() => ({ current: null as string | null }));
const mockGetDefaultCurrency = vi.hoisted(() => vi.fn());
const mockGetDefaultCurrencyScoped = vi.hoisted(() => vi.fn());

vi.mock('@/api/currency', () => ({
  getDefaultCurrency: () => mockGetDefaultCurrency(),
  getDefaultCurrencyScoped: (t: string) => mockGetDefaultCurrencyScoped(t),
  setDefaultCurrency: vi.fn(),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: wsState.current }),
}));

beforeEach(() => {
  mockGetDefaultCurrency.mockReset();
  mockGetDefaultCurrencyScoped.mockReset();
  mockGetDefaultCurrency.mockResolvedValue('USD');
  mockGetDefaultCurrencyScoped.mockResolvedValue('IDR');
  wsState.current = null;
});

/** Renders the resolved currency so a test can assert WHAT is displayed. */
function CurrencyProbe() {
  const { currency } = useCurrency();
  return <span data-testid="cur">{currency}</span>;
}

function Tree() {
  return (
    <CurrencyProvider>
      <CurrencyWorkspaceSync />
      <CurrencyProbe />
    </CurrencyProvider>
  );
}

describe('CurrencyWorkspaceSync', () => {
  it('does not call the scoped getter without a session token', async () => {
    render(<Tree />);
    await waitFor(() => expect(mockGetDefaultCurrency).toHaveBeenCalled());
    expect(mockGetDefaultCurrencyScoped).not.toHaveBeenCalled();
  });

  it('refreshes with the scoped default when a session token appears', async () => {
    const { rerender } = render(<Tree />);
    await waitFor(() => expect(mockGetDefaultCurrency).toHaveBeenCalled());

    act(() => {
      wsState.current = 'tok-1';
    });
    rerender(<Tree />);

    await waitFor(() => expect(mockGetDefaultCurrencyScoped).toHaveBeenCalledWith('tok-1'));
  });

  it('re-refreshes when the workspace switches to a new token', async () => {
    wsState.current = 'tok-1';
    const { rerender } = render(<Tree />);
    await waitFor(() => expect(mockGetDefaultCurrencyScoped).toHaveBeenCalledWith('tok-1'));

    act(() => {
      wsState.current = 'tok-2';
    });
    rerender(<Tree />);

    await waitFor(() => expect(mockGetDefaultCurrencyScoped).toHaveBeenCalledWith('tok-2'));
    expect(mockGetDefaultCurrencyScoped).toHaveBeenCalledTimes(2);
  });

  // A fast store switch must not let a SLOW earlier read win.
  //
  // `refresh` is called once per token change and those calls OVERLAP rather than
  // nest, so tok-1's scoped read can settle AFTER tok-2's. Without the sequence
  // guard in CurrencyContext.refresh the older answer overwrites the newer one and
  // the app keeps displaying the PREVIOUS store's currency -- and every money
  // figure is formatted with that value, so a price is printed in the wrong
  // currency's units.
  it('ignores a slower earlier refresh when the workspace switches', async () => {
    // Held open so tok-1's read is still in flight when tok-2's resolves.
    let releaseTok1: (v: string) => void = () => {};
    const tok1Pending = new Promise<string>((resolve) => {
      releaseTok1 = resolve;
    });
    mockGetDefaultCurrencyScoped.mockImplementation((t: string) =>
      t === 'tok-1' ? tok1Pending : Promise.resolve('SGD'),
    );
    mockGetDefaultCurrency.mockResolvedValue('USD');

    wsState.current = 'tok-1';
    const { rerender } = render(<Tree />);
    await waitFor(() => expect(mockGetDefaultCurrencyScoped).toHaveBeenCalledWith('tok-1'));

    // Switch stores while tok-1 is outstanding.
    act(() => {
      wsState.current = 'tok-2';
    });
    rerender(<Tree />);
    await waitFor(() => expect(screen.getByTestId('cur').textContent).toBe('SGD'));

    // Now let the STALE tok-1 read settle, after tok-2 already won.
    await act(async () => {
      releaseTok1('IDR');
      await tok1Pending;
    });

    // The newer store's currency survives the late arrival.
    expect(screen.getByTestId('cur').textContent).toBe('SGD');
  });
});
