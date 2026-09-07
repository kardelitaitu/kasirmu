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

function memoList(count: number): ActiveMemo[] {
  return Array.from({ length: count }, (_, i) => activeMemo(`m${i + 1}`, []));
}

function mockMemos(memos: ActiveMemo[]) {
  vi.mocked(useMemos).mockReturnValue({
    memos,
    loading: false,
    error: null,
    acknowledge: mockAcknowledge,
    dismiss: mockDismiss,
    refresh: vi.fn(),
  });
}

beforeEach(() => {
  vi.mocked(useMemos).mockReset();
  mockAcknowledge.mockReset();
  mockDismiss.mockReset();
  mockMemos([activeMemo('m1', [])]);
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

  it('opens the enlarged card with the full body on click', () => {
    const longBody = Array.from({ length: 14 }, (_, i) => `Line ${i + 1}`).join('\n');
    mockMemos([activeMemo('m1', [], longBody)]);
    renderWithL10n(<MemoBanner />);

    // The bubble button carries the dialog trigger semantics.
    const open = screen.getByTestId('memo-banner-open');
    expect(open).toHaveAttribute('aria-haspopup', 'dialog');
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(open).toHaveAttribute('aria-label', 'Read the full memo: Title m1');

    fireEvent.click(open);

    const dialog = screen.getByRole('dialog', { name: 'Title m1' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The full text — all 14 lines — is readable in the card (scoped to
    // it: the bubble's clamped preview also carries the text in the DOM).
    // The body renders as one pre-wrap text node, so match on content.
    expect(within(dialog).getByText(/Line 14/)).toBeInTheDocument();
    expect(open).toHaveAttribute('aria-expanded', 'true');
  });

  it("the card's big (x) acknowledges durably and returns to the stack", () => {
    // Owner direction (round 3): no acknowledge button in the card — the
    // single big (x) outside the card IS the durable ack.
    renderWithL10n(<MemoBanner />);
    fireEvent.click(screen.getByTestId('memo-banner-open'));
    fireEvent.click(screen.getByTestId('memo-expanded-acknowledge'));

    expect(mockAcknowledge).toHaveBeenCalledWith('m1');
    expect(mockDismiss).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Back on the stack (the mocked hook keeps the memo listed; the real
    // hook drops it optimistically after the same ack call).
    expect(screen.getByTestId('memo-banner-open')).toBeInTheDocument();
  });

  it('Escape on the card returns to the stack without acknowledging', () => {
    renderWithL10n(<MemoBanner />);
    fireEvent.click(screen.getByTestId('memo-banner-open'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(mockAcknowledge).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('memo-banner-open')).toBeInTheDocument();
  });

  it('clicking the backdrop returns to the stack without acknowledging', () => {
    renderWithL10n(<MemoBanner />);
    fireEvent.click(screen.getByTestId('memo-banner-open'));
    fireEvent.click(screen.getByTestId('memo-expanded-backdrop'));

    expect(mockAcknowledge).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('memo-banner-open')).toBeInTheDocument();
  });

  it('renders a text-only bubble and a heading-less card when the title is blank', () => {
    // Owner direction (2026-09-08): titles are optional — a blank title
    // renders a text-only bubble with the plain open-aria label, and the
    // enlarged card opens without a heading (aria-labelledby is omitted).
    const blank = activeMemo('m1', []);
    blank.memo.title = '   ';
    mockMemos([blank]);
    const { container } = renderWithL10n(<MemoBanner />);

    const open = screen.getByTestId('memo-banner-open');
    expect(open).toHaveAttribute('aria-label', 'Read the full memo');
    expect(container.querySelector('.memo-banner-title')).not.toBeInTheDocument();

    fireEvent.click(open);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Body m1/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading')).not.toBeInTheDocument();
  });

  it('stacks at most three bubbles and queues the rest silently', () => {
    // Owner direction (round 3): max 3 visible; memos beyond the cap wait
    // in the hook's list and surface when a slot frees — nothing is ever
    // auto-acknowledged to make room.
    mockMemos(memoList(5));
    renderWithL10n(<MemoBanner />);

    const bubbles = screen.getAllByTestId('memo-banner-open');
    expect(bubbles).toHaveLength(3);
    // Backend list order: index 0 is the top of the stack.
    expect(bubbles[0]).toHaveAttribute('aria-label', 'Read the full memo: Title m1');
    expect(bubbles[2]).toHaveAttribute('aria-label', 'Read the full memo: Title m3');
    expect(screen.queryByText('Title m4')).not.toBeInTheDocument();
    expect(screen.queryByText('Title m5')).not.toBeInTheDocument();
    expect(mockAcknowledge).not.toHaveBeenCalled();
  });

  it('each bubble (x) acknowledges its own memo', () => {
    mockMemos(memoList(3));
    renderWithL10n(<MemoBanner />);

    const closeButtons = screen.getAllByRole('button', { name: 'Acknowledge this memo' });
    expect(closeButtons).toHaveLength(3);
    // The length assertion above proves index 1 exists (noUncheckedIndexedAccess).
    fireEvent.click(closeButtons[1]!);

    expect(mockAcknowledge).toHaveBeenCalledTimes(1);
    expect(mockAcknowledge).toHaveBeenCalledWith('m2');
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('renders nothing when there are no active memos', () => {
    mockMemos([]);
    const { container } = renderWithL10n(<MemoBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('exposes an alert role for assistive tech', () => {
    renderWithL10n(<MemoBanner />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
