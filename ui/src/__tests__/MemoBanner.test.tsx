import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import MemoBanner from '@/features/memo/MemoBanner';
import { useMemos } from '@/features/memo/useMemos';
import type { ActiveMemo } from '@/api/memos';

const { mockAcknowledge, mockDismiss } = vi.hoisted(() => ({
  mockAcknowledge: vi.fn(),
  mockDismiss: vi.fn(),
}));

vi.mock('@/features/memo/useMemos', () => ({
  useMemos: vi.fn(),
}));

// Collapse the exit fade so requestClose runs the pending action synchronously;
// the animation itself is covered by useExitAnimation's own tests.
vi.mock('@/hooks/useExitAnimation', () => ({
  useExitAnimation: (open: boolean, onClose: () => void) => ({
    shouldRender: open,
    exiting: false,
    requestClose: () => onClose(),
  }),
}));

const MEMO_FTL = `
memo-banner-scope-location = Location notice
memo-banner-scope-organization = Organization notice
memo-banner-acknowledge-aria = Acknowledge this memo
`;

function renderWithL10n(ui: ReactNode) {
  const bundle = new FluentBundle('en-US');
  bundle.addResource(new FluentResource(MEMO_FTL));
  const l10n = new ReactLocalization([bundle]);
  return render(<LocalizationProvider l10n={l10n}>{ui}</LocalizationProvider>);
}

function activeMemo(id: string, locationIds: string[]): ActiveMemo {
  return {
    memo: {
      id,
      tenantId: 'default',
      locationIds,
      authorUserId: 'user-1',
      authorRole: 'role-owner',
      title: `Title ${id}`,
      body: `Body ${id}`,
      status: 'published',
      duration: '24h',
      revision: 1,
      publishedAt: '2026-09-08T09:00:00.000Z',
      expiresAt: '2026-09-09T09:00:00.000Z',
      createdAt: '2026-09-08T09:00:00.000Z',
    },
    deliveryStatus: 'pending',
  };
}

beforeEach(() => {
  vi.mocked(useMemos).mockReset();
  mockAcknowledge.mockReset();
  mockDismiss.mockReset();
  vi.mocked(useMemos).mockReturnValue({
    memos: [activeMemo('m1', [])],
    loading: false,
    error: null,
    acknowledge: mockAcknowledge,
    dismiss: mockDismiss,
    refresh: vi.fn(),
  });
});

describe('MemoBanner', () => {
  it('forwards the kds surface flag to useMemos', () => {
    // The seam the Phase 2 journal flagged as missing: the surface decides
    // which server-issued interval the poll runs on, so the banner must pass
    // the flag through rather than every surface polling at the base rate.
    const first = renderWithL10n(<MemoBanner kds />);
    expect(vi.mocked(useMemos)).toHaveBeenCalledWith({ kds: true });
    first.unmount();
    renderWithL10n(<MemoBanner />);
    expect(vi.mocked(useMemos)).toHaveBeenLastCalledWith({ kds: false });
  });

  it('renders the top memo title and body', () => {
    renderWithL10n(<MemoBanner />);
    expect(screen.getByText('Title m1')).toBeInTheDocument();
    expect(screen.getByText('Body m1')).toBeInTheDocument();
  });

  it('shows the Organization badge for an org memo and Location for a location memo', () => {
    const { unmount } = renderWithL10n(<MemoBanner />);
    expect(screen.getByText('Organization notice')).toBeInTheDocument();
    unmount();
    vi.mocked(useMemos).mockReturnValue({
      memos: [activeMemo('m2', ['loc-1'])],
      loading: false,
      error: null,
      acknowledge: mockAcknowledge,
      dismiss: mockDismiss,
      refresh: vi.fn(),
    });
    renderWithL10n(<MemoBanner />);
    expect(screen.getByText('Location notice')).toBeInTheDocument();
  });

  it('the close button runs the durable ack action', () => {
    // The single (x) acknowledges durably (chat-bubble semantics: read it,
    // done) — the memo never returns on this terminal. The session-only
    // dismiss path stays on the useMemos hook; the bubble must not touch it.
    renderWithL10n(<MemoBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge this memo' }));
    expect(mockAcknowledge).toHaveBeenCalledWith('m1');
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('renders nothing when there are no active memos', () => {
    vi.mocked(useMemos).mockReturnValue({
      memos: [],
      loading: false,
      error: null,
      acknowledge: mockAcknowledge,
      dismiss: mockDismiss,
      refresh: vi.fn(),
    });
    const { container } = renderWithL10n(<MemoBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('exposes an alert role for assistive tech', () => {
    renderWithL10n(<MemoBanner />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
