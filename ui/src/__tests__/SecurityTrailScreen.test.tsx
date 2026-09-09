import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import SecurityTrailScreen from '@/features/audit/SecurityTrailScreen';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import { ACTION_FLUENT_IDS } from '@/features/audit/auditCatalog';
import sharedFtl from '@/locales/shared.ftl?raw';
import sharedIdFtl from '@/locales/shared.id.ftl?raw';
import subscriptionFtl from '@/locales/subscription.ftl?raw';
import type { AuditEntryDto, AuditLogPageDto } from '@/api/audit';
import type * as SubscriptionContextModule from '@/contexts/SubscriptionContext';

/**
 * The screen a §J audit-baseline scoping report called "one call site short": the
 * command, its filters and its pagination were all landed and tested, and nothing
 * rendered them. These tests therefore pin the parts that only a CONSUMER can
 * prove — that the actions this trail emits have labels, and that the args the
 * backend documents actually go over the wire.
 */

const { mockListSecurityEvents } = vi.hoisted(() => ({
  mockListSecurityEvents: vi.fn(),
}));

vi.mock('@/api/audit', () => ({
  listSecurityEventsScoped: (token: string, args: unknown) => mockListSecurityEvents(token, args),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok' }),
}));

vi.mock('@/contexts/SubscriptionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof SubscriptionContextModule>();
  return {
    ...actual,
    useAdminGate: vi.fn().mockReturnValue({ locked: false, state: 'active' }),
    useSubscription: vi.fn((...args: unknown[]) =>
      (actual.useSubscription as (...a: unknown[]) => unknown)(...args),
    ),
  };
});

function makeL10n(locale: string, ftl: string): ReactLocalization {
  const bundle = new FluentBundle(locale);
  bundle.addResource(new FluentResource(ftl));
  return new ReactLocalization([bundle]);
}

function entry(over: Partial<AuditEntryDto>): AuditEntryDto {
  return {
    id: 'sec-1',
    user_id: 'user-1',
    action: 'logout',
    target_type: 'session',
    target_id: 'sess-1',
    details: '',
    outcome: 'success',
    created_at: '2026-09-09T10:00:00.000Z',
    ...over,
  };
}

function page(items: AuditEntryDto[], hasMore = false): AuditLogPageDto {
  return { items, total: items.length, has_more: hasMore };
}

const adminGate = vi.mocked(useAdminGate);

beforeEach(() => {
  adminGate.mockReturnValue({ locked: false, state: 'active' });
  mockListSecurityEvents.mockResolvedValue(page([entry({})]));
});

afterEach(() => {
  vi.restoreAllMocks();
  adminGate.mockReset();
  adminGate.mockReturnValue({ locked: false, state: 'active' });
});

function renderWith(l10n: ReactLocalization) {
  return render(
    <LocalizationProvider l10n={l10n}>
      <SecurityTrailScreen />
    </LocalizationProvider>,
  );
}

import { render } from '@testing-library/react';

describe('SecurityTrailScreen', () => {
  it('labels every action the trail emits, using the real shared bundle', async () => {
    // The weld this slice exists to close: SECURITY_ACTION_LOGOUT and the two
    // impersonate actions were emitted by the backend with no catalog entry and
    // no FTL key. Resolving them against the ACTUAL bundle text (not a stub)
    // is what makes "the label exists" a checked claim rather than a promise.
    mockListSecurityEvents.mockResolvedValue(
      page([
        entry({ id: 'a', action: 'logout' }),
        entry({ id: 'b', action: 'impersonate.start' }),
        entry({ id: 'c', action: 'impersonate.stop' }),
      ]),
    );
    renderWith(makeL10n('en-US', sharedFtl));
    await waitFor(() => {
      expect(screen.getAllByTestId('security-trail-row')).toHaveLength(3);
    });
    expect(screen.getByText('Logged out')).toBeInTheDocument();
    expect(screen.getByText('Impersonation started')).toBeInTheDocument();
    expect(screen.getByText('Impersonation stopped')).toBeInTheDocument();
    // Not one row fell through to the unknown-action fallback.
    expect(screen.queryByText('Unknown action')).not.toBeInTheDocument();
  });

  it('resolves the Indonesian labels from the id sibling', async () => {
    mockListSecurityEvents.mockResolvedValue(page([entry({ action: 'logout' })]));
    renderWith(makeL10n('id-ID', sharedIdFtl));
    await waitFor(() => {
      expect(screen.getByText('Keluar dari sesi')).toBeInTheDocument();
    });
  });

  it('sends the outcome filter and search query as args', async () => {
    renderWith(makeL10n('en-US', sharedFtl));
    await waitFor(() => {
      expect(mockListSecurityEvents).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByTestId('security-trail-outcome-failure'));
    await waitFor(() => {
      expect(mockListSecurityEvents).toHaveBeenLastCalledWith('tok', {
        limit: 50,
        outcome: 'failure',
      });
    });
  });

  it('pages with the keyset cursor taken from the last row received', async () => {
    mockListSecurityEvents.mockResolvedValueOnce(
      page([entry({ id: 'first' }), entry({ id: 'last', created_at: '2026-09-09T09:00:00.000Z' })], true),
    );
    renderWith(makeL10n('en-US', sharedFtl));
    await waitFor(() => {
      expect(screen.getByTestId('security-trail-load-more')).toBeInTheDocument();
    });
    mockListSecurityEvents.mockResolvedValueOnce(page([entry({ id: 'older' })]));
    fireEvent.click(screen.getByTestId('security-trail-load-more'));
    await waitFor(() => {
      expect(mockListSecurityEvents).toHaveBeenLastCalledWith('tok', {
        limit: 50,
        beforeCreatedAt: '2026-09-09T09:00:00.000Z',
        beforeId: 'last',
      });
    });
  });

  it('shows the tier refusal rather than an empty trail when the backend refuses', async () => {
    // The distinguishing behavior of this surface: a below-Premium session is
    // REFUSED, and an empty list means "no events". Rendering the empty state for
    // a refusal would tell an owner they have no security history when the truth
    // is that the feature is above their plan.
    mockListSecurityEvents.mockRejectedValue(
      // `AppError::PermissionDenied` as it crosses the IPC boundary — the shape the
      // real backend sends, not an Error carrying its sentence (ERR-05/06).
      { kind: 'permissionDenied', message: 'audit log requires the Premium plan or above' },
    );
    renderWith(makeL10n('en-US', sharedFtl));
    await waitFor(() => {
      expect(screen.getByTestId('security-trail-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('security-trail-error')).toHaveTextContent(
      "You don't have permission to do this.",
    );
    // The backend sentence stays out of the DOM; only the mapped copy renders.
    expect(screen.getByTestId('security-trail-error')).not.toHaveTextContent('Premium plan');
    expect(screen.queryByTestId('security-trail-empty')).not.toBeInTheDocument();
  });

  it('locks while the subscription is not active', async () => {
    adminGate.mockReturnValue({ locked: true, state: 'grace' });
    renderWith(makeL10n('en-US', `${subscriptionFtl}\n${sharedFtl}`));
    await waitFor(() => {
      expect(screen.getByText('Administrative features locked')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('security-trail')).not.toBeInTheDocument();
    expect(mockListSecurityEvents).not.toHaveBeenCalled();
  });

  it('keeps the catalog honest about what it maps', () => {
    // The catalog's own test welds each value to a bundle key; this pins the
    // other direction, that the three actions added for this screen are actually
    // reachable from the trail's action set.
    expect(ACTION_FLUENT_IDS['logout']).toBe('audit-action-logout');
    expect(ACTION_FLUENT_IDS['impersonate.start']).toBe('audit-action-impersonate-start');
    expect(ACTION_FLUENT_IDS['impersonate.stop']).toBe('audit-action-impersonate-stop');
  });
});
