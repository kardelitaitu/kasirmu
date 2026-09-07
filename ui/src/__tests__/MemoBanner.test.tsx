import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
memo-banner-open-aria = Read the full memo: { $title }
memo-banner-open-aria-plain = Read the full memo
memo-banner-acknowledge-aria = Acknowledge this memo
memo-modal-acknowledge = Acknowledge
modal-close-aria = Close dialog
`;

function renderWithL10n(ui: ReactNode) {
  // useIsolating: false mirrors the app's real bundle config
  // (ui/src/i18n/index.ts) — substituted values carry no directional marks.
  const bundle = new FluentBundle('en-US', { useIsolating: false });
  bundle.addResource(new FluentResource(MEMO_FTL));
  const l10n = new ReactLocalization([bundle]);
  return render(<LocalizationProvider l10n={l10n}>{ui}</LocalizationProvider>);
}

function activeMemo(id: string, locationIds: string[], body?: string): ActiveMemo {
  return {
    memo: {
      id,
      tenantId: 'default',
      locationIds,
      authorUserId: 'user-1',
      authorRole: 'role-owner',
      title: `Title ${id}`,
      body: body ?? `Body ${id}`,
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

  it('does not render the scope type', () => {
    // Owner direction (2026-09-08): the Location/Organization badge is
    // visual noise on the bubble — the audience is the memo metadata, not
    // something staff act on.
    renderWithL10n(<MemoBanner />);
    expect(screen.queryByText('Location notice')).not.toBeInTheDocument();
    expect(screen.queryByText('Organization notice')).not.toBeInTheDocument();
  });

  it('opens the enlarged dialog with the full body on click', () => {
    const longBody = Array.from({ length: 14 }, (_, i) => `Line ${i + 1}`).join('\n');
    vi.mocked(useMemos).mockReturnValue({
      memos: [activeMemo('m1', [], longBody)],
      loading: false,
      error: null,
      acknowledge: mockAcknowledge,
      dismiss: mockDismiss,
      refresh: vi.fn(),
    });
    renderWithL10n(<MemoBanner />);

    // The bubble button carries the dialog trigger semantics.
    const open = screen.getByTestId('memo-banner-open');
    expect(open).toHaveAttribute('aria-haspopup', 'dialog');
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(open).toHaveAttribute('aria-label', 'Read the full memo: Title m1');

    fireEvent.click(open);

    const dialog = screen.getByRole('dialog', { name: 'Title m1' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The full text — all 14 lines — is readable in the dialog (scoped to
    // it: the bubble's clamped preview also carries the text in the DOM).
    // The body renders as one pre-wrap text node, so match on content.
    expect(within(dialog).getByText(/Line 14/)).toBeInTheDocument();
    expect(open).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders a text-only bubble when the title is blank', () => {
    // Owner direction (2026-09-08): titles are optional — a blank title
    // renders a text-only bubble with the plain open-aria label, and the
    // enlarged dialog opens without a heading (the shared Modal omits the
    // h2 + aria-labelledby when the title is undefined).
    const blank = activeMemo('m1', []);
    blank.memo.title = '   ';
    vi.mocked(useMemos).mockReturnValue({
      memos: [blank],
      loading: false,
      error: null,
      acknowledge: mockAcknowledge,
      dismiss: mockDismiss,
      refresh: vi.fn(),
    });
    const { container } = renderWithL10n(<MemoBanner />);

    const open = screen.getByTestId('memo-banner-open');
    expect(open).toHaveAttribute('aria-label', 'Read the full memo');
    expect(container.querySelector('.memo-banner-title')).not.toBeInTheDocument();

    fireEvent.click(open);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Body m1/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading')).not.toBeInTheDocument();
  });

  it('the dialog acknowledge button runs the durable ack and closes the dialog', () => {
    renderWithL10n(<MemoBanner />);
    fireEvent.click(screen.getByTestId('memo-banner-open'));
    fireEvent.click(screen.getByTestId('memo-modal-acknowledge'));

    expect(mockAcknowledge).toHaveBeenCalledWith('m1');
    expect(mockDismiss).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closing the dialog returns to the bubble without acknowledging', () => {
    renderWithL10n(<MemoBanner />);
    fireEvent.click(screen.getByTestId('memo-banner-open'));
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));

    expect(mockAcknowledge).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The bubble is still on-screen for the (x) durable ack.
    expect(screen.getByTestId('memo-banner-open')).toBeInTheDocument();
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
