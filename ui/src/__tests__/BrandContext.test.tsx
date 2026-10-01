import { describe, it, expect, vi, beforeEach } from 'vitest';
// `render` is kept in the import below — the 'throws when used outside
// BrandProvider' test relies on a synchronous throw during render, so
// `renderInAct`'s async boundary cannot be used there.
import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { BrandProvider, useBrand } from '@/contexts/BrandContext';

const mockGetBrandSettings = vi.fn();

vi.mock('@/api/branding', () => ({
  getBrandSettings: (...args: unknown[]) => mockGetBrandSettings(...args),
}));

// Test consumer component
function TestConsumer() {
  const brand = useBrand();
  return (
    <div>
      <span data-testid="colour">{brand.settings.primary_colour}</span>
      <span data-testid="store">{brand.settings.store_name}</span>
      <span data-testid="logo">{brand.settings.logo_path ?? 'no-logo'}</span>
      <button data-testid="refresh" onClick={brand.refreshBrandSettings}>
        Refresh
      </button>
    </div>
  );
}

async function renderProvider() {
  await renderInAct(
    <BrandProvider>
      <TestConsumer />
    </BrandProvider>,
  );
}

describe('BrandContext', () => {
  beforeEach(() => {
    mockGetBrandSettings.mockResolvedValue({
      primary_colour: '#4f46e5',
      logo_path: '/logo.png',
      store_name: 'Test Store',
    });
  });

  it('renders defaults before API resolves', async () => {
    mockGetBrandSettings.mockImplementation(() => new Promise(() => {}));
    await renderProvider();
    expect(screen.getByTestId('colour').textContent).toBe('#147EFB'); // default
    expect(screen.getByTestId('store').textContent).toBe(''); // default
    expect(screen.getByTestId('logo').textContent).toBe('no-logo'); // default null
  });

  it('updates with fetched settings after API resolves', async () => {
    await renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId('colour').textContent).toBe('#4f46e5');
    });
    expect(screen.getByTestId('store').textContent).toBe('Test Store');
    expect(screen.getByTestId('logo').textContent).toBe('/logo.png');
  });

  it('keeps current settings on API error', async () => {
    mockGetBrandSettings.mockRejectedValue(new Error('Offline'));
    await renderProvider();

    // Wait for the error to be swallowed
    await waitFor(() => {
      // Defaults remain
      expect(screen.getByTestId('colour').textContent).toBe('#147EFB');
    });

    // Settings should still be defaults
    expect(screen.getByTestId('store').textContent).toBe('');
  });

  it('refreshBrandSettings re-fetches from the API', async () => {
    await renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId('store').textContent).toBe('Test Store');
    });

    mockGetBrandSettings.mockClear();
    mockGetBrandSettings.mockResolvedValue({
      primary_colour: '#ef4444',
      logo_path: null,
      store_name: 'Updated Store',
    });

    act(() => {
      screen.getByTestId('refresh').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('colour').textContent).toBe('#ef4444');
      expect(screen.getByTestId('store').textContent).toBe('Updated Store');
    });
    expect(mockGetBrandSettings).toHaveBeenCalledTimes(1);
  });

  it('survives sequential refresh errors without losing current settings', async () => {
    // Load initial settings
    await renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId('store').textContent).toBe('Test Store');
    });

    // Two sequential refresh failures
    mockGetBrandSettings.mockRejectedValue(new Error('Offline'));
    act(() => screen.getByTestId('refresh').click());
    await waitFor(() => {
      expect(screen.getByTestId('store').textContent).toBe('Test Store');
    });

    mockGetBrandSettings.mockRejectedValue(new Error('Still offline'));
    act(() => screen.getByTestId('refresh').click());
    await waitFor(() => {
      expect(screen.getByTestId('store').textContent).toBe('Test Store');
    });
  });

  it('recovers from refresh error when next attempt succeeds', async () => {
    // Load initial settings
    await renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId('store').textContent).toBe('Test Store');
    });

    // Refresh fails
    mockGetBrandSettings.mockRejectedValue(new Error('Offline'));
    act(() => screen.getByTestId('refresh').click());
    await waitFor(() => {
      expect(screen.getByTestId('store').textContent).toBe('Test Store');
    });

    // Next refresh succeeds with updated data
    mockGetBrandSettings.mockClear();
    mockGetBrandSettings.mockResolvedValue({
      primary_colour: '#22c55e',
      logo_path: '/new-logo.png',
      store_name: 'Recovered Store',
    });
    act(() => screen.getByTestId('refresh').click());
    await waitFor(() => {
      expect(screen.getByTestId('store').textContent).toBe('Recovered Store');
      expect(screen.getByTestId('colour').textContent).toBe('#22c55e');
      expect(screen.getByTestId('logo').textContent).toBe('/new-logo.png');
    });
  });

  // Two refreshes in quick succession -- which is what a double save does, since
  // `useSettingsSave` calls `refreshBrandSettings` after every write and
  // `AppearanceSettings` adds three more call sites. The reads OVERLAP, so without
  // the sequence guard a slower earlier one overwrites the newer brand.
  //
  // The stale read resolves with DISTINCTLY DIFFERENT values. Returning the same
  // values would make this pass with the guard removed, because the late write
  // would then be indistinguishable from the correct one -- which is exactly how
  // the SettingsContext equivalent fooled its own mutation twice.
  it('ignores a slower earlier refresh that settles last', async () => {
    let releaseStale: (v: unknown) => void = () => {};
    const stalePending = new Promise((resolve) => { releaseStale = resolve; });

    await renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId('store').textContent).toBe('Test Store');
    });

    // First refresh: held open, will answer with the STALE brand.
    mockGetBrandSettings.mockClear();
    mockGetBrandSettings.mockImplementationOnce(() => stalePending);
    act(() => { screen.getByTestId('refresh').click(); });

    // Second refresh: resolves immediately with the CURRENT brand.
    mockGetBrandSettings.mockResolvedValueOnce({
      primary_colour: '#22c55e',
      logo_path: null,
      store_name: 'Current Store',
    });
    act(() => { screen.getByTestId('refresh').click(); });

    await waitFor(() => {
      expect(screen.getByTestId('store').textContent).toBe('Current Store');
    });

    // Now the stale one lands, after the current one already won.
    await act(async () => {
      releaseStale({
        primary_colour: '#ef4444',
        logo_path: '/stale-logo.png',
        store_name: 'Stale Store',
      });
      await stalePending;
    });

    // The current brand survives the late arrival.
    expect(screen.getByTestId('store').textContent).toBe('Current Store');
    expect(screen.getByTestId('colour').textContent).toBe('#22c55e');
    expect(screen.getByTestId('logo').textContent).toBe('no-logo');
  });

  it('throws when useBrand is used outside BrandProvider', () => {
    // Suppress console.error from React and JSDOM for this expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const preventJsdomError = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', preventJsdomError);
    expect(() => {
      render(<TestConsumer />);
    }).toThrow('useBrand must be used within a BrandProvider');
    window.removeEventListener('error', preventJsdomError);
    spy.mockRestore();
  });
});
