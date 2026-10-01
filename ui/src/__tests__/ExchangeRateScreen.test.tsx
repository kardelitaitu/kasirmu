import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { ToastProvider } from '@/components/Toast';
import currencyFtl from '@/locales/currency.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import ExchangeRateScreen from '@/features/currency/ExchangeRateScreen';
import { minorUnitExponent } from '@/types/domain';

// ── Mocks ────────────────────────────────────────────────────────────

const mockListExchangeRatesScoped = vi.fn();
const mockListCurrenciesScoped = vi.fn();
const mockCreateExchangeRateScoped = vi.fn();
const mockDeleteExchangeRateScoped = vi.fn();
// The auto-sync switch reads/writes rate_sync.enabled through the generic
// scoped settings commands (ui/src/api/settings.ts).
const mockGetSettingScoped = vi.fn();
const mockSetSettingScoped = vi.fn();

// CUR-06: the screen must route through the session-scoped commands when a
// workspace session is active, so multi-store deployments never read or
// mutate the global currency configuration. The non-scoped wrappers were
// removed from @/api/currency (8c21abeb) — the mock mirrors the real
// module surface.
const workspaceMock = vi.hoisted(() => ({ sessionToken: '' }));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspace: null,
    sessionToken: workspaceMock.sessionToken,
    swapSessionToken: vi.fn(),
  }),
}));

vi.mock('@/api/currency', () => ({
  listExchangeRatesScoped: (...args: unknown[]) => mockListExchangeRatesScoped(...args),
  listCurrenciesScoped: (...args: unknown[]) => mockListCurrenciesScoped(...args),
  createExchangeRateScoped: (...args: unknown[]) => mockCreateExchangeRateScoped(...args),
  deleteExchangeRateScoped: (...args: unknown[]) => mockDeleteExchangeRateScoped(...args),
  formatExchangeRate: (rate: { rate_millionths: number }) =>
    (rate.rate_millionths / 1_000_000).toString(),
}));

vi.mock('@/api/settings', () => ({
  getSettingScoped: (...args: unknown[]) => mockGetSettingScoped(...args),
  setSettingScoped: (...args: unknown[]) => mockSetSettingScoped(...args),
}));

// The screen resolves the store's IANA zone to pre-fill the effective date
// (ADR #48 Decision 3). Mocked because the assertion is about WHICH zone the
// date comes from, not about the location fetch itself.
const mockGetPrimaryLocationScoped = vi.fn();
vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mockGetPrimaryLocationScoped(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────

function makeRate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rate-1',
    from_currency: 'USD',
    to_currency: 'IDR',
    rate_millionths: 16_000_000_000,
    source: 'manual',
    effective_date: '2025-07-07',
    created_at: '2025-07-07T00:00:00.000Z',
    ...overrides,
  };
}

function makeCurrency(code: string, name: string) {
  // Derive the exponent from the canonical MINOR_UNIT_EXPONENT map so the
  // fixture stays aligned with the Rust `Currency::minor_unit_exponent`
  // (e.g. IDR = 0, KWD = 3) instead of hardcoding 2 for every code.
  return { code, name, minor_exponent: minorUnitExponent(code), symbol: code };
}

function renderScreen() {
  return renderWithFluentSync(<ToastProvider><ExchangeRateScreen /></ToastProvider>, currencyFtl, sharedFtl);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('ExchangeRateScreen', () => {
  beforeEach(() => {
    mockListExchangeRatesScoped.mockReset();
    mockListCurrenciesScoped.mockReset();
    mockCreateExchangeRateScoped.mockReset();
    mockDeleteExchangeRateScoped.mockReset();
    mockGetPrimaryLocationScoped.mockReset();
    // No store zone by default: a store profile that never loads is the
    // fallback path, and it must still not fall back to the DEVICE.
    mockGetPrimaryLocationScoped.mockResolvedValue(null);
    workspaceMock.sessionToken = '';
  });

  it('renders the title', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([makeRate()]);
    mockListCurrenciesScoped.mockResolvedValue([makeCurrency('USD', 'US Dollar')]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Exchange Rates')).toBeTruthy();
    });
  });

  it('renders the Add button', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([makeRate()]);
    mockListCurrenciesScoped.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      const addBtns = screen.getAllByText('Add');
      expect(addBtns.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows loading skeleton initially', () => {
    mockListExchangeRatesScoped.mockImplementation(() => new Promise(() => {}));
    mockListCurrenciesScoped.mockImplementation(() => new Promise(() => {}));
    const { container } = renderScreen();

    const skeleton = container.querySelector('[aria-hidden="true"].exchange-rate-loading-skeleton');
    expect(skeleton).toBeTruthy();
    expect(screen.queryByText(/loading exchange rates/i)).toBeNull();
  });

  it('shows error state with retry', async () => {
    mockListExchangeRatesScoped.mockRejectedValue(new Error('Failed'));
    mockListCurrenciesScoped.mockRejectedValue(new Error('Failed'));
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeTruthy();
    });
  });

  it('shows empty state when no rates exist', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([]);
    mockListCurrenciesScoped.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No exchange rates configured')).toBeTruthy();
    });
  });

  it('renders a table with rate rows', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([
      makeRate({ id: 'r1', from_currency: 'USD', to_currency: 'IDR', rate_millionths: 16_000_000_000 }),
      makeRate({ id: 'r2', from_currency: 'EUR', to_currency: 'IDR', rate_millionths: 17_000_000_000 }),
    ]);
    mockListCurrenciesScoped.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('From')).toBeTruthy();
      expect(screen.getByText('To')).toBeTruthy();
      expect(screen.getByText('Rate')).toBeTruthy();
    });

    // IDR appears twice (as to_currency for both rows), use getAllByText
    const idrEls = screen.getAllByText('IDR');
    expect(idrEls.length).toBe(2);
    expect(screen.getByText('USD')).toBeTruthy();
    expect(screen.getByText('EUR')).toBeTruthy();
    expect(screen.getByText('16000')).toBeTruthy();
  });

  it('shows manual source label', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([makeRate({ source: 'manual' })]);
    mockListCurrenciesScoped.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('manual')).toBeTruthy();
    });
  });

  it('each row has a Delete button', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([makeRate()]);
    mockListCurrenciesScoped.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      const deleteBtns = screen.getAllByText('Delete');
      expect(deleteBtns.length).toBe(1);
    });
  });

  it('opens the add modal when Add is clicked', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([]);
    mockListCurrenciesScoped.mockResolvedValue([
      makeCurrency('USD', 'US Dollar'),
      makeCurrency('IDR', 'Indonesian Rupiah'),
    ]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No exchange rates configured')).toBeTruthy();
    });

    const user = userEvent.setup();
    const addBtns = screen.getAllByText('Add');
    await user.click(addBtns[0]!);

    await waitFor(() => {
      expect(screen.getByText('Add Exchange Rate')).toBeTruthy();
    });
  });

  it('closes the add modal with Cancel', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([]);
    mockListCurrenciesScoped.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No exchange rates configured')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getAllByText('Add')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeTruthy();
    });

    await user.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(screen.queryByText('Add Exchange Rate')).toBeNull();
    });
  });

  it('saves a new exchange rate via the modal', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([]);
    mockListCurrenciesScoped.mockResolvedValue([
      makeCurrency('USD', 'US Dollar'),
      makeCurrency('IDR', 'Indonesian Rupiah'),
    ]);
    mockCreateExchangeRateScoped.mockResolvedValue(makeRate());

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No exchange rates configured')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getAllByText('Add')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Add Exchange Rate')).toBeTruthy();
    });

    // Fill the rate field
    const rateInput = document.querySelector('#er-field-rate') as HTMLElement as HTMLInputElement | null;
    await user.type(rateInput!, '16000');

    // Select From currency
    const fromSelect = document.querySelector('#er-field-from') as HTMLElement as HTMLSelectElement | null;
    await user.selectOptions(fromSelect!, 'USD');

    // Select To currency
    const toSelect = document.querySelector('#er-field-to') as HTMLElement as HTMLSelectElement | null;
    await user.selectOptions(toSelect!, 'IDR');

    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockCreateExchangeRateScoped).toHaveBeenCalledWith('', {
        from_currency: 'USD',
        to_currency: 'IDR',
        rate_millionths: 16_000_000_000,
        effective_date: expect.any(String),
      });
    });
  });

  it('deletes a rate on Delete click', async () => {
    mockListExchangeRatesScoped.mockResolvedValueOnce([makeRate()]);
    mockListExchangeRatesScoped.mockResolvedValueOnce([]);
    mockListCurrenciesScoped.mockResolvedValue([]);
    mockDeleteExchangeRateScoped.mockResolvedValue(undefined);

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Delete'));

    // The row Delete button opens a confirmation dialog; the dialog's
    // confirm button is the only one with the plain "Delete" name.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteExchangeRateScoped).toHaveBeenCalledWith('', 'rate-1');
    });
  });
});

// ── CUR-06: session-scoped routing ─────────────────────────────────────
describe('ExchangeRateScreen — scoped session', () => {
  beforeEach(() => {
    mockListExchangeRatesScoped.mockReset();
    mockListCurrenciesScoped.mockReset();
    mockCreateExchangeRateScoped.mockReset();
    mockDeleteExchangeRateScoped.mockReset();
    workspaceMock.sessionToken = 'test-token';
  });

  it('loads rates and currencies through the scoped commands', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([]);
    mockListCurrenciesScoped.mockResolvedValue([]);

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No exchange rates configured')).toBeTruthy();
    });
    expect(mockListExchangeRatesScoped).toHaveBeenCalledWith('test-token');
    expect(mockListCurrenciesScoped).toHaveBeenCalledWith('test-token');
  });

  it('creates through createExchangeRateScoped with the session token', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([]);
    mockListCurrenciesScoped.mockResolvedValue([
      makeCurrency('USD', 'US Dollar'),
      makeCurrency('IDR', 'Indonesian Rupiah'),
    ]);
    mockCreateExchangeRateScoped.mockResolvedValue(makeRate());

    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('No exchange rates configured')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getAllByText('Add')[0]!);
    await waitFor(() => {
      expect(screen.getByText('Add Exchange Rate')).toBeTruthy();
    });
    const rateInput = document.querySelector('#er-field-rate') as HTMLInputElement | null;
    await user.type(rateInput!, '16000');
    const fromSelect = document.querySelector('#er-field-from') as HTMLSelectElement | null;
    await user.selectOptions(fromSelect!, 'USD');
    const toSelect = document.querySelector('#er-field-to') as HTMLSelectElement | null;
    await user.selectOptions(toSelect!, 'IDR');
    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockCreateExchangeRateScoped).toHaveBeenCalledWith('test-token', {
        from_currency: 'USD',
        to_currency: 'IDR',
        rate_millionths: 16_000_000_000,
        effective_date: expect.any(String),
      });
    });
  });

  it('deletes through deleteExchangeRateScoped with the session token', async () => {
    mockListExchangeRatesScoped.mockResolvedValueOnce([makeRate()]);
    mockListExchangeRatesScoped.mockResolvedValueOnce([]);
    mockListCurrenciesScoped.mockResolvedValue([]);
    mockDeleteExchangeRateScoped.mockResolvedValue(undefined);

    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Delete'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteExchangeRateScoped).toHaveBeenCalledWith('test-token', 'rate-1');
    });
  });
});

// ── Auto-sync toggle: the rate_sync.enabled round trip ───────────────────
// The daemon started shipping 2026-09-29 and re-reads this key every cycle,
// so the switch is the whole control surface: what it reads must match what
// it writes, and a failed write must not leave a switch claiming ON.
describe('ExchangeRateScreen — auto-sync toggle', () => {
  beforeEach(() => {
    mockListExchangeRatesScoped.mockReset();
    mockListCurrenciesScoped.mockReset();
    mockGetSettingScoped.mockReset();
    mockSetSettingScoped.mockReset();
    mockGetSettingScoped.mockResolvedValue(null);
    mockSetSettingScoped.mockResolvedValue(undefined);
    workspaceMock.sessionToken = 'test-token';
  });

  it('reads rate_sync.enabled through the scoped command and reflects it on the switch', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([]);
    mockListCurrenciesScoped.mockResolvedValue([]);
    mockGetSettingScoped.mockResolvedValue('1');

    renderScreen();

    await waitFor(() => {
      const sw = screen.getByRole('switch', { name: /auto-update rates/i }) as HTMLInputElement;
      expect(sw.checked).toBe(true);
    });
    expect(mockGetSettingScoped).toHaveBeenCalledWith('test-token', 'rate_sync.enabled');
  });

  it('renders off when the key has never been written (backend default "0")', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([]);
    mockListCurrenciesScoped.mockResolvedValue([]);
    mockGetSettingScoped.mockResolvedValue(null);

    renderScreen();

    const sw = (await screen.findByRole('switch', { name: /auto-update rates/i })) as HTMLInputElement;
    expect(sw.checked).toBe(false);
  });

  it('persists a flip as "1" and confirms with a toast', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([]);
    mockListCurrenciesScoped.mockResolvedValue([]);
    mockGetSettingScoped.mockResolvedValue('0');

    renderScreen();
    const sw = (await screen.findByRole('switch', { name: /auto-update rates/i })) as HTMLInputElement;
    await waitFor(() => expect(sw).toBeEnabled());

    const user = userEvent.setup();
    await user.click(sw);

    await waitFor(() => {
      expect(mockSetSettingScoped).toHaveBeenCalledWith('test-token', 'rate_sync.enabled', '1');
    });
    await waitFor(() => {
      expect(screen.getByText('Rate auto-sync turned on')).toBeTruthy();
    });
    expect(sw.checked).toBe(true);
  });

  it('reverts the switch and toasts when the write fails', async () => {
    mockListExchangeRatesScoped.mockResolvedValue([]);
    mockListCurrenciesScoped.mockResolvedValue([]);
    mockGetSettingScoped.mockResolvedValue('0');
    mockSetSettingScoped.mockRejectedValue(new Error('denied'));

    renderScreen();
    const sw = (await screen.findByRole('switch', { name: /auto-update rates/i })) as HTMLInputElement;
    await waitFor(() => expect(sw).toBeEnabled());

    const user = userEvent.setup();
    await user.click(sw);

    await waitFor(() => {
      expect(screen.getByText('Could not save the auto-sync setting')).toBeTruthy();
    });
    expect(sw.checked).toBe(false);
  });

  // ── The effective date anchors to the STORE, not the device ──────────
  //
  // These two cases exist because the two "creates a rate" tests above assert
  // effective_date: expect.any(String) -- which is satisfied by ANY date, on
  // any host, in any zone. That is why a device-local prefill could ship
  // despite ADR #48 Decision 3 (the effective date is a business date in the
  // store's IANA zone) being implemented correctly in the backend.
  //
  // The assertion is by VALUE against a store zone the test controls, so it
  // cannot pass on a host that happens to agree.
  describe('effective date anchoring', () => {
    // The clock is pinned so these cases assert a property of the fixture, not
    // of the hour the suite happens to run at. The case below requires a
    // +14:00 store to be on a DIFFERENT calendar day from UTC, and that only
    // holds while UTC is at or past 10:00 -- at 00:38 UTC both are still on the
    // same date, so `not.toBe(storeToday('+00:00'))` could not hold and the
    // suite failed for ten hours of every day. 14:00 UTC puts Kiritimati on
    // the next day, which is the state the case is about.
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date('2026-09-05T14:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** The date the store's zone is currently on, computed the way the backend computes it. */
    function storeToday(tz: string): string {
      const now = new Date();
      // Fixed-offset zones are all this needs, and keeping it explicit means the
      // test's expectation is derived rather than pasted.
      const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
      if (!m) return new Date(now.getTime()).toISOString().slice(0, 10);
      const sign = m[1] === '-' ? -1 : 1;
      const offset = sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
      return new Date(now.getTime() + offset).toISOString().slice(0, 10);
    }

    /** Open the create modal and return its date input. */
    async function openCreateDateField(): Promise<HTMLInputElement> {
      const user = userEvent.setup();
      await user.click(screen.getByText('Add'));
      const input = (await screen.findByDisplayValue(/^\d{4}-\d{2}-\d{2}$/)) as HTMLInputElement;
      return input;
    }

    it('pre-fills the store business date, not the device date', async () => {
      // +14:00 (Kiritimati) is the largest offset that can put the store's
      // calendar a full day AHEAD of UTC, and therefore ahead of any west-of-UTC
      // device.
      const storeTz = '+14:00';
      workspaceMock.sessionToken = 'test-token';
      mockGetPrimaryLocationScoped.mockResolvedValue({ timezone: storeTz });
      mockListExchangeRatesScoped.mockResolvedValue([]);
      mockListCurrenciesScoped.mockResolvedValue([]);

      renderScreen();
      const input = await openCreateDateField();

      expect(input.value).toBe(storeToday(storeTz));
    });

    it('re-seeds the prefill once the store zone arrives after first paint', async () => {
      // The zone is fetched, so the first render has only the UTC fallback. If
      // the form captured its default at module load the prefill would stay on
      // the fallback forever, and the ADR #48 rule would hold only in the
      // narrow case where the profile is already cached. This pins that the
      // value is read when the form is OPENED, not at import time.
      const storeTz = '+14:00';
      workspaceMock.sessionToken = 'test-token';
      mockGetPrimaryLocationScoped.mockResolvedValue({ timezone: storeTz });
      mockListExchangeRatesScoped.mockResolvedValue([]);
      mockListCurrenciesScoped.mockResolvedValue([]);

      renderScreen();
      const input = await openCreateDateField();

      // Same value as the case above, reached through a different path: this
      // one fails if the prefill is computed once at module scope.
      expect(input.value).toBe(storeToday(storeTz));
      expect(input.value).not.toBe(storeToday('+00:00'));
    });

    it('falls back to the store default, never the device, when the profile never loads', async () => {
      // A store profile that fails to load must not silently become the host
      // zone: that is the exact failure ADR #48 was written to prevent, and
      // FALLBACK_STORE_TZ (UTC) is the schema's own column default.
      workspaceMock.sessionToken = 'test-token';
      mockGetPrimaryLocationScoped.mockRejectedValue(new Error('offline'));
      mockListExchangeRatesScoped.mockResolvedValue([]);
      mockListCurrenciesScoped.mockResolvedValue([]);

      renderScreen();
      const input = await openCreateDateField();

      expect(input.value).toBe(storeToday('+00:00'));
    });
  });
});
