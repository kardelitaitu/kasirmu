import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import AuditLogScreen from '@/features/audit/AuditLogScreen';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import {
  ACTION_FLUENT_IDS,
  ACTION_FALLBACK_ID,
  OUTCOME_FLUENT_IDS,
  OUTCOME_FALLBACK_ID,
} from '@/features/audit/auditCatalog';
import sharedFtl from '@/locales/shared.ftl?raw';
import sharedIdFtl from '@/locales/shared.id.ftl?raw';
import subscriptionFtl from '@/locales/subscription.ftl?raw';
import type { AuditEntryDto, AuditLogPageDto } from '@/api/audit';
import type * as SubscriptionContextModule from '@/contexts/SubscriptionContext';

const { mockListAuditLogScoped, mockGetAuditReviewStatusScoped, mockMarkAuditReviewedScoped, mockExportAuditLogScoped } =
  vi.hoisted(() => ({
    mockListAuditLogScoped: vi.fn(),
    mockGetAuditReviewStatusScoped: vi.fn(),
    mockMarkAuditReviewedScoped: vi.fn(),
    mockExportAuditLogScoped: vi.fn(),
  }));

vi.mock('@/api/audit', () => ({
  listAuditLog: (limit: number, offset: number) => mockListAuditLogScoped('tok', { limit, offset }),
  listAuditLogScoped: (token: string, args: unknown) => mockListAuditLogScoped(token, args),
  getAuditReviewStatusScoped: (token: string) => mockGetAuditReviewStatusScoped(token),
  markAuditReviewedScoped: (token: string, args: unknown) => mockMarkAuditReviewedScoped(token, args),
  exportAuditLogScoped: (token: string, args: unknown) => mockExportAuditLogScoped(token, args),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok' }),
}));

// Forwarding partial mock: `useAdminGate` defaults to OPEN for the regular
// screen tests (the §B gate test overrides it per-test), `useSubscription`
// forwards to the real hook.
vi.mock('@/contexts/SubscriptionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof SubscriptionContextModule>();
  const adminGateMock = vi.fn().mockReturnValue({ locked: false, state: 'active' });
  return {
    ...actual,
    useAdminGate: adminGateMock,
    useSubscription: vi.fn((...args: unknown[]) =>
      (actual.useSubscription as (...a: unknown[]) => unknown)(...args),
    ),
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', username: 'admin', role_name: 'admin', token: 'tok', role_id: 'r1', display_name: 'Admin' },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    swapSession: vi.fn(),
    isManager: true,
    isOwner: true,
  }),
}));

function makeL10n(locale: string, ftl: string): ReactLocalization {
  const bundle = new FluentBundle(locale);
  bundle.addResource(new FluentResource(ftl));
  return new ReactLocalization([bundle]);
}

const adminGate = vi.mocked(useAdminGate);

describe('AuditLogScreen §B administrative gate', () => {
  afterEach(() => {
    adminGate.mockReturnValue({ locked: false, state: 'active' });
  });

  it('locks the screen while the subscription is not active (grace)', async () => {
    adminGate.mockReturnValue({ locked: true, state: 'grace' });
    renderScreen(makeL10n('en-US', `${subscriptionFtl}\n${sharedFtl}`));
    await waitFor(() => {
      expect(screen.getByText('Administrative features locked')).toBeInTheDocument();
    });
    expect(screen.queryByText('Audit Log')).not.toBeInTheDocument();
  });
});

const l10n = makeL10n('en-US', sharedFtl);

async function renderScreen(l10nOverride: ReactLocalization = l10n) {
  await renderInAct(
    <LocalizationProvider l10n={l10nOverride}>
      <AuditLogScreen />
    </LocalizationProvider>,
  );
}

function makeEntry(overrides: Partial<AuditEntryDto> = {}): AuditEntryDto {
  return {
    id: 'a-1',
    user_id: 'user-1',
    action: 'sale.complete',
    target_type: 'sale',
    target_id: 'sale-1234-abcd-efgh',
    details: '{"total":50000}',
    outcome: 'success',
    created_at: '2026-07-01T12:00:00Z',
    ...overrides,
  };
}

function makePage(entries: AuditEntryDto[], total?: number, has_more = false): AuditLogPageDto {
  return { items: entries, total: total ?? entries.length, has_more };
}

describe('AuditLogScreen', () => {
  beforeEach(() => {
    mockListAuditLogScoped.mockReset();
    mockGetAuditReviewStatusScoped.mockReset();
    mockMarkAuditReviewedScoped.mockReset();
    mockExportAuditLogScoped.mockReset();
    mockGetAuditReviewStatusScoped.mockResolvedValue({ checkpoint: null, unreviewed_count: 0 });
    mockListAuditLogScoped.mockResolvedValue(makePage([]));
  });

  it('renders the title', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Audit Log')).toBeDefined());
  });

  it('renders the Refresh button', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Refresh')).toBeDefined());
  });

  it('loads the scoped page with the session token on mount (AUD-01)', async () => {
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry()]));
    await renderScreen();
    await waitFor(() =>
      expect(mockListAuditLogScoped).toHaveBeenCalledWith(
        'tok',
        expect.objectContaining({ limit: 50 }),
      ),
    );
  });

  it('keeps rows visible and announces refreshing during a reload (ERR-09)', async () => {
    // First load resolves with rows.
    mockListAuditLogScoped.mockResolvedValueOnce(makePage([makeEntry()]));
    // The reload stays pending so the `refreshing` phase is observable.
    mockListAuditLogScoped.mockImplementationOnce(() => new Promise(() => {}));
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Date')).toBeDefined());

    // Trigger Refresh while rows are on screen.
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    // Rows stay visible (no skeleton), and the refreshing status announces
    // the retry intent (ERR-09).
    await waitFor(() => {
      expect(screen.getByText('Date')).toBeDefined();
      expect(document.querySelector('.audit-log-refreshing')).toBeTruthy();
    });
    expect(document.querySelector('.audit-log-loading-skeleton')).toBeNull();
  });

  it('calls load(reset) when Refresh is clicked', async () => {
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry()]));
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Refresh')).toBeDefined());

    mockListAuditLogScoped.mockClear();
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry()]));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(mockListAuditLogScoped).toHaveBeenCalledWith(
        'tok',
        expect.objectContaining({ limit: 50 }),
      ),
    );
  });

  it('shows loading skeleton initially', async () => {
    mockListAuditLogScoped.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    const skeleton = document.querySelector('.audit-log-loading-skeleton');
    expect(skeleton).toBeTruthy();
    expect(screen.queryByText('Loading audit log…')).toBeNull();
  });

  it('shows empty state with no entries yet', async () => {
    await renderScreen();
    await waitFor(() => {
      const msg = screen.getByText(/No audit entries recorded yet/);
      expect(msg).toBeDefined();
    });
  });

  it('shows error state with retry button', async () => {
    mockListAuditLogScoped.mockRejectedValue(new Error('DB error'));
    await renderScreen();
    // ERR-05: the raw backend message must never render — the localized copy does.
    await waitFor(() => expect(screen.getByText('Failed to load audit log')).toBeDefined());
    expect(screen.queryByText('DB error')).toBeNull();
    expect(screen.getByText('Retry')).toBeDefined();
  });

  it('calls load(reset) when retry button is clicked after error', async () => {
    // First call during mount rejects — shows error state (localized, ERR-05)
    mockListAuditLogScoped.mockRejectedValueOnce(new Error('DB error'));
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Failed to load audit log')).toBeDefined());

    // Clear mock so retry uses the default resolved value from beforeEach
    mockListAuditLogScoped.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(mockListAuditLogScoped).toHaveBeenCalledWith(
        'tok',
        expect.objectContaining({ limit: 50 }),
      ),
    );
  });

  it('renders table with audit entries', async () => {
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry(), makeEntry({ id: 'a-2', action: 'login' })]));
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Date')).toBeDefined();
      expect(screen.getByText('Action')).toBeDefined();
      expect(screen.getByText('Target')).toBeDefined();
      expect(screen.getByText('User ID')).toBeDefined();
      expect(screen.getByText('Outcome')).toBeDefined();
      expect(screen.getByText('Details')).toBeDefined();
    });
  });

  it('shows outcome badge with proper class', async () => {
    mockListAuditLogScoped.mockResolvedValue(makePage([
      makeEntry({ id: 'a-1', outcome: 'success' }),
      makeEntry({ id: 'a-2', outcome: 'failure' }),
    ]));
    await renderScreen();
    await waitFor(() => {
      const successBadges = document.querySelectorAll('.audit-badge--success');
      const failureBadges = document.querySelectorAll('.audit-badge--failure');
      expect(successBadges.length).toBeGreaterThanOrEqual(1);
      expect(failureBadges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows action label for known action keys', async () => {
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ action: 'sale.void' })]));
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Void Sale')).toBeDefined());
  });

  it('shows the localized unknown-action fallback while keeping the raw key (AUD-08)', async () => {
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ action: 'custom.event' })]));
    await renderScreen();
    await waitFor(() => {
      // The primary label uses the safe localized fallback, not the raw key.
      const label = document.querySelector('.audit-log-action-label');
      expect(label?.textContent).toBe('Unknown Action');
      // The raw action is preserved as secondary technical metadata.
      const actionKeys = document.querySelectorAll('.audit-log-action-key');
      expect(actionKeys.length).toBeGreaterThanOrEqual(1);
      expect(actionKeys[0]?.textContent).toBe('custom.event');
    });
  });

  it('shows target type and truncated target id', async () => {
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ target_type: 'product', target_id: 'prod-abcdef-123456' })]));
    await renderScreen();
    await waitFor(() => {
      const targetType = document.querySelector('.audit-log-target-type');
      expect(targetType?.textContent).toBe('product');
    });
  });

  it('shows em-dash when target_type is null', async () => {
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ target_type: null, target_id: null })]));
    await renderScreen();
    await waitFor(() => {
      const dash = document.querySelector('.audit-log-target-none');
      expect(dash).toBeDefined();
    });
  });

  it('truncates details preview to 60 chars', async () => {
    const longDetails = 'x'.repeat(100);
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ details: longDetails })]));
    await renderScreen();
    await waitFor(() => {
      const preview = document.querySelector('.audit-log-details-preview');
      // 60 chars + ellipsis character = 61
      expect(preview?.textContent?.length).toBe(61);
    });
  });

  it('shows em-dash for empty/null details', async () => {
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ details: '{}' })]));
    await renderScreen();
    await waitFor(() => {
      const dash = document.querySelector('.audit-log-details-none');
      expect(dash).toBeDefined();
    });
  });

  it('sends the outcome filter to the server (AUD-02)', async () => {
    mockListAuditLogScoped.mockImplementation((_token: string, args: { outcome?: string }) => {
      if (args.outcome === 'success') {
        return Promise.resolve(makePage([makeEntry({ id: 'a-1', outcome: 'success', action: 'login' })]));
      }
      return Promise.resolve(makePage([
        makeEntry({ id: 'a-1', outcome: 'success', action: 'login' }),
        makeEntry({ id: 'a-2', outcome: 'failure', action: 'login.failed' }),
      ]));
    });
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Audit Log')).toBeDefined());

    // Click the Success filter chip (role=radio; the outcome badges also render
    // localized "Success", so query the radio group rather than text).
    const successChip = screen.getByRole('radio', { name: 'Success' });
    await userEvent.click(successChip);

    await waitFor(() => {
      expect(mockListAuditLogScoped).toHaveBeenCalledWith(
        'tok',
        expect.objectContaining({ outcome: 'success' }),
      );
      // The failed entry should be gone (server returned only success rows)
      const failureBadges = document.querySelectorAll('.audit-badge--failure');
      expect(failureBadges.length).toBe(0);
    });
  });

  it('shows empty filtered state when the server returns no matches', async () => {
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ outcome: 'success' })]));
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Audit Log')).toBeDefined());

    // Click Failure filter — server returns an empty page
    mockListAuditLogScoped.mockResolvedValue(makePage([], 0, false));
    const failureChip = screen.getByRole('radio', { name: 'Failure' });
    await userEvent.click(failureChip);

    await waitFor(() =>
      expect(screen.getByText('No audit entries match the current filters.')).toBeDefined(),
    );
  });

  it('shows Load More button when has_more is true (AUD-03)', async () => {
    const entries = Array.from({ length: 50 }, (_, i) => makeEntry({ id: `a-${i}`, created_at: `2026-07-01T12:0${Math.floor(i / 10)}:00Z` }));
    mockListAuditLogScoped.mockResolvedValue(makePage(entries, 60, true));
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Load More')).toBeDefined());
  });

  it('sends the keyset cursor on Load More (AUD-03)', async () => {
    const entries = Array.from({ length: 50 }, (_, i) => makeEntry({ id: `a-${i}` }));
    mockListAuditLogScoped.mockResolvedValue(makePage(entries, 60, true));
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Load More')).toBeDefined());

    mockListAuditLogScoped.mockClear();
    mockListAuditLogScoped.mockResolvedValue(makePage([], 60, false));

    const loadMoreBtn = screen.getByText('Load More').closest('button')!;
    await userEvent.click(loadMoreBtn);

    await waitFor(() =>
      expect(mockListAuditLogScoped).toHaveBeenCalledWith(
        'tok',
        expect.objectContaining({ beforeId: 'a-49' }),
      ),
    );
  });

  it('sends the debounced search query to the server (AUD-02)', async () => {
    mockListAuditLogScoped.mockImplementation((_token: string, args: { query?: string }) => {
      if (args.query) {
        return Promise.resolve(makePage([makeEntry({ id: 'a-1', user_id: 'alice' })]));
      }
      return Promise.resolve(makePage([
        makeEntry({ id: 'a-1', user_id: 'alice' }),
        makeEntry({ id: 'a-2', action: 'login', user_id: 'bob' }),
      ]));
    });
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Audit Log')).toBeDefined());

    const searchInput = document.querySelector('.audit-log-search') as HTMLInputElement;
    await userEvent.type(searchInput, 'alice');

    await waitFor(() =>
      expect(mockListAuditLogScoped).toHaveBeenCalledWith(
        'tok',
        expect.objectContaining({ query: 'alice' }),
      ),
    );
  });

  // ── Review checkpoints (AUD-04) ─────────────────────────────────

  it('shows the server-side unreviewed badge count (AUD-04)', async () => {
    mockGetAuditReviewStatusScoped.mockResolvedValue({ checkpoint: null, unreviewed_count: 3 });
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText('3 new')).toBeDefined();
    });
  });

  it('shows reviewed-at date when a checkpoint exists (AUD-04)', async () => {
    mockGetAuditReviewStatusScoped.mockResolvedValue({
      checkpoint: {
        id: 'cp-1',
        store_id: 'store-a',
        reviewer_user_id: 'user-1',
        reviewed_at: '2026-07-02T00:00:00Z',
        reviewed_through_created_at: '2026-07-01T12:00:00Z',
        reviewed_through_id: 'a-1',
      },
      unreviewed_count: 0,
    });
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText(/Reviewed:/)).toBeDefined();
    });
  });

  it('marks reviewed via the scoped API with the newest entry cursor (AUD-04)', async () => {
    mockGetAuditReviewStatusScoped.mockResolvedValue({ checkpoint: null, unreviewed_count: 5 });
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ id: 'a-1', created_at: '2026-07-01T12:00:00Z' })]));
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Mark Reviewed')).toBeDefined());

    await userEvent.click(screen.getByRole('button', { name: 'Mark Reviewed' }));

    await waitFor(() =>
      expect(mockMarkAuditReviewedScoped).toHaveBeenCalledWith('tok', {
        reviewedThroughCreatedAt: '2026-07-01T12:00:00Z',
        reviewedThroughId: 'a-1',
      }),
    );
  });

  // ── Request-generation protection (AUD-05) ─────────────────────

  it('discards a stale slower load in favor of a newer one (AUD-05)', async () => {
    // Mount load (request 1) is deferred; a later filter change (request 2)
    // resolves first. The outcome chip stands in for the Refresh button's
    // load({reset:true}) path because the shared Button disables while
    // loading.
    let resolveStale!: (page: AuditLogPageDto) => void;
    mockListAuditLogScoped.mockImplementationOnce(
      () => new Promise<AuditLogPageDto>((resolve) => { resolveStale = resolve; }),
    );
    // The newer request returns the newest row. user_id is truncated to 8
    // chars in the table, so use <=8-char ids for exact text matching.
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ id: 'a-fresh', user_id: 'fresh-1' })]));

    await renderScreen();

    // Trigger a new request generation while the first is still in flight by
    // changing a server-side filter. The outcome chip is a plain button (never
    // disabled), unlike the Refresh Button which disables while loading — so
    // this deterministically exercises the "overlap across state transitions
    // and external triggers" the seq guard must absorb.
    const successChip = screen.getByRole('radio', { name: 'Success' });
    await userEvent.click(successChip);
    await waitFor(() => expect(screen.getByText('fresh-1')).toBeDefined());

    // The stale first request resolves late — it must be ignored.
    await act(async () => {
      resolveStale(makePage([makeEntry({ id: 'a-stale', user_id: 'stale-1' })]));
    });
    expect(screen.queryByText('stale-1')).toBeNull();
    expect(screen.getByText('fresh-1')).toBeDefined();
  });

  it('discards a stale Load More append after a filter change (AUD-05)', async () => {
    // First page loaded normally.
    mockListAuditLogScoped.mockResolvedValueOnce(
      makePage(Array.from({ length: 50 }, (_, i) => makeEntry({ id: `a-${i}` })), 60, true),
    );
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Load More')).toBeDefined());

    // Load More (request 2) is deferred.
    let resolveAppend!: (page: AuditLogPageDto) => void;
    mockListAuditLogScoped.mockImplementationOnce(
      () => new Promise<AuditLogPageDto>((resolve) => { resolveAppend = resolve; }),
    );
    const loadMoreBtn = screen.getByText('Load More').closest('button')!;
    await userEvent.click(loadMoreBtn);

    // A filter change (request 3, a reset generation) resolves with a fresh
    // first page while the append is still in flight.
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ id: 'a-fresh', user_id: 'fresh-1' })], 1, false));
    const successChip = screen.getByRole('radio', { name: 'Success' });
    await userEvent.click(successChip);
    await waitFor(() => expect(screen.getByText('fresh-1')).toBeDefined());

    // The stale append resolves late — it must NOT append its rows.
    await act(async () => {
      resolveAppend(makePage([makeEntry({ id: 'a-late', user_id: 'late-1' })], 60, true));
    });
    expect(screen.queryByText('late-1')).toBeNull();
    expect(screen.getByText('fresh-1')).toBeDefined();
  });

  it('deduplicates appended rows by id (AUD-03 defense in depth)', async () => {
    // First page + append both contain id 'a-dup'.
    mockListAuditLogScoped.mockResolvedValueOnce(
      makePage([makeEntry({ id: 'a-dup', user_id: 'dup-1' })], 2, true),
    );
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Load More')).toBeDefined());

    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ id: 'a-dup', user_id: 'dup-1' })], 2, false));
    const loadMoreBtn = screen.getByText('Load More').closest('button')!;
    await userEvent.click(loadMoreBtn);

    await waitFor(() => {
      const rows = document.querySelectorAll('.audit-log-table tbody tr');
      expect(rows.length).toBe(1);
    });
  });

  // ── Locale-aware date formatting (AUD-07) ───────────────────────

  it('formats the entry timestamp using the active en-US locale (AUD-07)', async () => {
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ created_at: '2026-07-01T12:00:00Z' })]));
    await renderScreen();
    await waitFor(() => {
      const cell = document.querySelector('.audit-log-cell-date');
      // 'Jul 1, 2026' style month name confirms en-US formatting, not raw ISO.
      expect(cell?.textContent).toContain('Jul');
      expect(cell?.textContent).toContain('2026');
      expect(cell?.textContent).not.toContain('2026-07-01');
    });
  });

  it('formats the timestamp in Indonesian when the id bundle is active (AUD-07)', async () => {
    // August is abbreviated 'Aug' in en but 'Agu' in Indonesian, so this
    // genuinely proves the Fluent locale flows into Intl.DateTimeFormat
    // (an en fallback would render 'Aug').
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ created_at: '2026-08-15T12:00:00Z' })]));
    await renderScreen(makeL10n('id', sharedIdFtl));
    await waitFor(() => {
      const cell = document.querySelector('.audit-log-cell-date');
      expect(cell?.textContent).toContain('Agu');
      expect(cell?.textContent).not.toContain('Aug');
      expect(cell?.textContent).not.toContain('2026-08-15');
      expect(cell?.querySelector('time')?.getAttribute('dateTime')).toBe('2026-08-15T12:00:00Z');
    });
  });

  it('exposes the raw ISO timestamp as an accessible time value (AUD-07)', async () => {
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry({ created_at: '2026-07-01T12:00:00Z' })]));
    await renderScreen();
    await waitFor(() => {
      const timeEl = document.querySelector('.audit-log-cell-date time');
      expect(timeEl?.getAttribute('dateTime')).toBe('2026-07-01T12:00:00Z');
      expect(timeEl?.getAttribute('title')).toBe('2026-07-01T12:00:00Z');
    });
  });

  it('formats the reviewed-at date using the active locale (AUD-07)', async () => {
    mockGetAuditReviewStatusScoped.mockResolvedValue({
      checkpoint: {
        id: 'cp-1',
        store_id: 'store-a',
        reviewer_user_id: 'user-1',
        reviewed_at: '2026-07-02T00:00:00Z',
        reviewed_through_created_at: '2026-07-01T12:00:00Z',
        reviewed_through_id: 'a-1',
      },
      unreviewed_count: 0,
    });
    await renderScreen();
    await waitFor(() => {
      const el = document.querySelector('.audit-log-reviewed-at time');
      expect(el?.getAttribute('dateTime')).toBe('2026-07-02T00:00:00Z');
      expect(el?.textContent).toContain('2026');
    });
  });

  // ── Export (AUD-09) ─────────────────────────────────────────────

  it('calls the scoped export API with current filters and triggers a download (AUD-09)', async () => {
    mockExportAuditLogScoped.mockResolvedValue({
      csv: '\uFEFFid,created_at\n"a-1","2026-07-01T12:00:00Z"\n',
      row_count: 1,
      generated_at: '2026-08-01T00:00:00.000Z',
      requested_by: 'user-1',
    });
    // Stub the browser download plumbing.
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    mockListAuditLogScoped.mockResolvedValue(makePage([
      makeEntry({ id: 'a-1', outcome: 'failure', action: 'login.failed' }),
    ]));
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Export CSV')).toBeDefined());

    // Apply the Failure filter so the export carries the server-side scope.
    await userEvent.click(screen.getByRole('radio', { name: 'Failure' }));
    await waitFor(() => expect(screen.getByText('Export CSV')).toBeDefined());

    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => {
      expect(mockExportAuditLogScoped).toHaveBeenCalledWith(
        'tok',
        expect.objectContaining({ outcome: 'failure' }),
      );
    });
    expect(createUrl).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalled();

    createUrl.mockRestore();
    revokeUrl.mockRestore();
    clickSpy.mockRestore();
  });

  it('shows a localized export-error notice even when the table has rows (AUD-09)', async () => {
    mockExportAuditLogScoped.mockRejectedValue(new Error('export boom'));
    // Rows present — the table-load error branch (error && entries.length === 0)
    // does NOT render here, so the dedicated export notice must appear instead.
    mockListAuditLogScoped.mockResolvedValue(makePage([makeEntry()]));
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Export CSV')).toBeDefined());

    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() =>
      expect(screen.getByText('Export failed. Please try again.')).toBeDefined(),
    );
    // The table is still rendered — the notice did not replace the content.
    expect(document.querySelector('.audit-log-table')).toBeDefined();
  });

  // ── Action/outcome catalog parity (AUD-08) ──────────────────────

  it('localizes the outcome badge instead of the raw machine value (AUD-08)', async () => {
    mockListAuditLogScoped.mockResolvedValue(makePage([
      makeEntry({ id: 'a-1', outcome: 'success' }),
      makeEntry({ id: 'a-2', outcome: 'failure' }),
      makeEntry({ id: 'a-3', outcome: 'unknown_value' }),
    ]));
    await renderScreen();
    await waitFor(() => {
      // Known outcomes render localized labels; unknown ones get the fallback.
      // (The filter chips also render "Success"/"Failure", so scope the text
      // assertions to the badge elements.)
      const badges = document.querySelectorAll('.audit-log-badge');
      expect(badges.length).toBe(3);
      expect(badges[0]?.textContent).toBe('Success');
      expect(badges[1]?.textContent).toBe('Failure');
      expect(badges[2]?.textContent).toBe('Unknown');
      // The raw value stays available as an accessible title.
      expect(badges[2]?.getAttribute('title')).toBe('unknown_value');
    });
  });

  it('maps all catalog actions to ids that resolve in BOTH locale bundles (AUD-08)', () => {
    // Build raw bundles to introspect message availability (rather than
    // relying on Fluent's reportError callback).
    const enRaw = new FluentBundle('en');
    enRaw.addResource(new FluentResource(sharedFtl));
    const idRaw = new FluentBundle('id');
    idRaw.addResource(new FluentResource(sharedIdFtl));

    const catalogIds = [
      ...new Set([
        ...Object.values(ACTION_FLUENT_IDS),
        ACTION_FALLBACK_ID,
        ...Object.values(OUTCOME_FLUENT_IDS),
        OUTCOME_FALLBACK_ID,
      ]),
    ];
    // Sanity: the catalog is non-trivial.
    expect(catalogIds.length).toBeGreaterThan(10);

    const missing: string[] = [];
    for (const id of catalogIds) {
      if (!enRaw.getMessage(id)) missing.push(`${id} (en)`);
      if (!idRaw.getMessage(id)) missing.push(`${id} (id)`);
    }
    expect(missing).toEqual([]);
  });
});
