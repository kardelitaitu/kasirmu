// ── StockAlertBell tests ──────────────────────────────────────────
//
// Covers the global-header stock alert bell: polling the alert count,
// badge rendering (including the 99+ cap), click navigation, and — the
// regression this file was written for — localized aria-labels.
//
// The component previously hardcoded English in its accessible names
// ("No stock alerts", "2 active stock alerts"); the Indonesian
// assertion below fails if the component ever falls back to hardcoded
// strings instead of reading the Fluent bundle.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/i18n/test-utils';
import StockAlertBell from '@/components/StockAlertBell';
import sharedId from '@/locales/shared.id.ftl?raw';

// ── Mock the API module at the module boundary (never invoke()) ──

const mockGetActiveStockAlerts = vi.fn();

vi.mock('@/api/inventory', () => ({
  getActiveStockAlerts: (...args: unknown[]) => mockGetActiveStockAlerts(...args),
}));

describe('StockAlertBell', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Polling / data ─────────────────────────────────────────────

  it('fetches the scoped alert count on mount with session token and location', async () => {
    mockGetActiveStockAlerts.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
    await renderInAct(
      withFluent(
        <StockAlertBell sessionToken="tok-1" locationId="loc-9" onClick={() => {}} />,
      ),
    );
    await waitFor(() => {
      expect(mockGetActiveStockAlerts).toHaveBeenCalledWith('tok-1', 'loc-9');
    });
  });

  it('defaults the location to "default" when not provided', async () => {
    mockGetActiveStockAlerts.mockResolvedValue([]);
    await renderInAct(
      withFluent(<StockAlertBell sessionToken="tok-1" onClick={() => {}} />),
    );
    await waitFor(() => {
      expect(mockGetActiveStockAlerts).toHaveBeenCalledWith('tok-1', 'default');
    });
  });

  it('does not fetch when no session token is provided', async () => {
    await renderInAct(
      withFluent(<StockAlertBell sessionToken="" onClick={() => {}} />),
    );
    expect(mockGetActiveStockAlerts).not.toHaveBeenCalled();
  });

  // ── Badge ──────────────────────────────────────────────────────

  it('shows the badge with the alert count', async () => {
    mockGetActiveStockAlerts.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);
    await renderInAct(
      withFluent(<StockAlertBell sessionToken="tok-1" onClick={() => {}} />),
    );
    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  it('caps the badge at 99+', async () => {
    mockGetActiveStockAlerts.mockResolvedValue(Array.from({ length: 150 }, (_, i) => ({ id: String(i) })));
    await renderInAct(
      withFluent(<StockAlertBell sessionToken="tok-1" onClick={() => {}} />),
    );
    await waitFor(() => {
      expect(screen.getByText('99+')).toBeInTheDocument();
    });
  });

  it('hides the badge when there are no alerts', async () => {
    mockGetActiveStockAlerts.mockResolvedValue([]);
    await renderInAct(
      withFluent(<StockAlertBell sessionToken="tok-1" onClick={() => {}} />),
    );
    await waitFor(() => {
      expect(screen.queryByText('99+')).not.toBeInTheDocument();
      expect(screen.queryByText(/\d+/)).not.toBeInTheDocument();
    });
  });

  // ── Interaction ────────────────────────────────────────────────

  it('calls onClick when the bell is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    mockGetActiveStockAlerts.mockResolvedValue([]);
    await renderInAct(
      withFluent(<StockAlertBell sessionToken="tok-1" onClick={onClick} />),
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // ── i18n (the regression this file exists for) ─────────────────
  //
  // The component previously hardcoded English accessible names
  // ("No stock alerts", "2 active stock alerts"). The Indonesian
  // assertion below is the regression killer: if the component ever
  // falls back to hardcoded strings, the accessible name renders in
  // English and this test fails. The English assertions pin the exact
  // plural behavior through the real shared bundle.

  it('localizes the plural aria-label from the bundle', async () => {
    mockGetActiveStockAlerts.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
    await renderInAct(
      withFluent(<StockAlertBell sessionToken="tok-1" onClick={() => {}} />),
    );
    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAccessibleName('2 active stock alerts');
    });
  });

  it('localizes the singular aria-label from the bundle', async () => {
    mockGetActiveStockAlerts.mockResolvedValue([{ id: 'a1' }]);
    await renderInAct(
      withFluent(<StockAlertBell sessionToken="tok-1" onClick={() => {}} />),
    );
    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAccessibleName('1 active stock alert');
    });
  });

  it('localizes the empty aria-label from the bundle', async () => {
    mockGetActiveStockAlerts.mockResolvedValue([]);
    await renderInAct(
      withFluent(<StockAlertBell sessionToken="tok-1" onClick={() => {}} />),
    );
    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAccessibleName('No stock alerts');
    });
  });

  it('renders the Indonesian aria-label, not hardcoded English', async () => {
    mockGetActiveStockAlerts.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
    await renderInAct(
      withFluentLocale(
        'id',
        <StockAlertBell sessionToken="tok-1" onClick={() => {}} />,
        sharedId,
      ),
    );
    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAccessibleName('2 peringatan stok aktif');
    });
  });
});
