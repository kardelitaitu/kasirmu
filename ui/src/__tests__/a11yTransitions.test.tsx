//! A11Y-12: dynamic-state transition + assistive-announcement coverage.
//!
//! The audit flagged that axe tests only targeted initial renders, leaving
//! real workflows — modal open/close, payment confirmation, PIN errors,
//! status changes, loading skeletons, toasts — untested for live regions,
//! focus targets, and duplicate announcements.
//!
//! This suite pins, for the SHARED primitives (Modal, Button, Toast,
//! StatusBar):
//!
//!   1. Modal open → focus moves into the dialog; close → focus restored
//!      to the trigger; closed dialog leaves NO duplicate in the a11y tree.
//!   2. Button processing state → disabled + aria-busy + accessible name
//!      preserved (no lost label while loading).
//!   3. Toast → live region politeness (role="alert", aria-live="assertive"),
//!      exit animation does not leave duplicate announcements in the tree.
//!   4. StatusBar → polite live regions (role="status") for app status
//!      and conflict count.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useRef, useState } from 'react';
import { act } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { ToastProvider, useToast } from '@/components/Toast';
import StatusBar from '@/app/StatusBar';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import sharedFtl from '@/locales/shared.ftl?raw';

// ── Fluent for Modal/Toast/StatusBar primitives ─────────────────────
const bundle = new FluentBundle('en-US', { useIsolating: false });
bundle.addResource(new FluentResource(sharedFtl));
const l10n = new ReactLocalization([bundle]);

function renderWithFluent(ui: React.ReactElement) {
  return render(<LocalizationProvider l10n={l10n}>{ui}</LocalizationProvider>);
}

// ── StatusBar dependency mocks ───────────────────────────────────────
const { mockOfflineSummary } = vi.hoisted(() => ({
  mockOfflineSummary: vi.fn(),
}));

vi.mock('@/api/offline', () => ({
  getOfflineQueueStatusSummary: () => mockOfflineSummary(),
  // StatusBar polls conflict count via the session-scoped variant.
  getOfflineQueueStatusSummaryScoped: () => mockOfflineSummary(),
}));

vi.mock('@/hooks/useGatewayStatus', () => ({
  useGatewayStatus: () => ({ online: false, configured: false }),
}));

vi.mock('@/hooks/useSyncConnection', () => ({
  useSyncConnection: () => ({ state: 'connected' }),
}));

vi.mock('@/hooks/useWorkspaceNav', () => ({
  useWorkspaceNav: () => ({ goToWorkspacePicker: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: null }),
}));

vi.mock('@/components/FastPINOverlay', () => ({
  default: () => null,
}));

vi.mock('@/app/ThemeToggle', () => ({
  default: () => <button type="button">Theme</button>,
}));

// ── Modal open/close transitions ─────────────────────────────────────

describe('A11Y-12 — modal open/close transitions', () => {
  function ModalHarness() {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          data-testid="open-dialog"
          onClick={() => setOpen(true)}
        >
          Open dialog
        </button>
        <Modal open={open} onClose={() => setOpen(false)} title="Settings">
          <button type="button">Save</button>
        </Modal>
      </>
    );
  }

  it('moves focus into the dialog on open', async () => {
    const user = userEvent.setup();
    renderWithFluent(<ModalHarness />);

    await user.click(screen.getByTestId('open-dialog'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Focus trap auto-focuses the first focusable (close button).
    expect(screen.getByRole('button', { name: /close/i })).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('restores focus to the trigger on close and removes the dialog from the a11y tree', async () => {
    const user = userEvent.setup();
    renderWithFluent(<ModalHarness />);

    await user.click(screen.getByTestId('open-dialog'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Closed dialog leaves NO duplicate in the a11y tree.
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(screen.getByTestId('open-dialog')).toHaveFocus();
  });

  it('re-opening after close creates exactly one dialog (no stale duplicate)', async () => {
    const user = userEvent.setup();
    renderWithFluent(<ModalHarness />);

    await user.click(screen.getByTestId('open-dialog'));
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByTestId('open-dialog'));
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
  });
});

// ── Button processing/loading semantics ──────────────────────────────

describe('A11Y-12 — Button loading/processing semantics', () => {
  it('marks the button aria-busy + disabled while preserving its accessible name', () => {
    renderWithFluent(<Button state="processing">Save changes</Button>);

    const btn = screen.getByRole('button', { name: 'Save changes' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    // The visible label is swapped for an sr-only label while processing —
    // the accessible name must survive the transition.
    expect(btn).toHaveAccessibleName('Save changes');
  });

  it('supports the deprecated loading prop with identical semantics', () => {
    renderWithFluent(<Button loading>Submit</Button>);
    const btn = screen.getByRole('button', { name: 'Submit' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('clears aria-busy when the transition back to ready', () => {
    const { rerender } = renderWithFluent(<Button state="processing">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('aria-busy', 'true');
    rerender(<Button state="ready">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button', { name: 'Go' })).not.toBeDisabled();
  });
});

// ── Toast live region announcements ──────────────────────────────────

function ToastHarness() {
  const { addToast } = useToast();
  const counter = useRef(0);
  return (
    <button
      type="button"
      data-testid="add-toast"
      onClick={() =>
        addToast({
          id: `t-${++counter.current}`,
          type: 'success',
          message: 'Payment confirmed',
        })
      }
    >
      Add toast
    </button>
  );
}

describe('A11Y-12 — toast live-region announcements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces toasts in an assertive live region', () => {
    renderWithFluent(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-toast'));
    const toast = document.querySelector('.toast');
    expect(toast).not.toBeNull();
    expect(toast).toHaveAttribute('role', 'alert');
    expect(toast).toHaveAttribute('aria-live', 'assertive');
    expect(toast?.textContent).toContain('Payment confirmed');
  });

  it('exit animation marks aria-busy and removes the toast without duplicates', () => {
    renderWithFluent(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-toast'));
    expect(document.querySelectorAll('.toast')).toHaveLength(1);

    // Dismiss via the X button.
    const dismiss = document.querySelector<HTMLButtonElement>('.toast__dismiss');
    fireEvent.click(dismiss!);

    // Mid-fade: still one toast, marked aria-busy.
    expect(document.querySelectorAll('.toast')).toHaveLength(1);
    expect(document.querySelector('.toast')).toHaveAttribute('aria-busy', 'true');

    // Fade completes → no duplicate left behind.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(document.querySelectorAll('.toast')).toHaveLength(0);
  });
});

// ── StatusBar polite live regions ────────────────────────────────────

describe('A11Y-12 — StatusBar polite live regions', () => {
  it('announces app status via a polite role="status" region', async () => {
    mockOfflineSummary.mockResolvedValue({ conflictCount: 0 });
    renderWithFluent(<ToastProvider><StatusBar /></ToastProvider>);

    await waitFor(() => {
      expect(mockOfflineSummary).toHaveBeenCalled();
    });

    const footer = document.querySelector('.app-statusbar');
    expect(footer).toHaveAttribute('role', 'status');
    expect(footer).toHaveAttribute('aria-label', 'Application status');
  });

  it('announces conflict count in a polite live region when present', async () => {
    mockOfflineSummary.mockResolvedValue({ conflictCount: 3 });
    renderWithFluent(<ToastProvider><StatusBar /></ToastProvider>);

    await waitFor(() => {
      expect(document.querySelector('.statusbar-conflict')).not.toBeNull();
    });

    const conflict = document.querySelector('.statusbar-conflict');
    expect(conflict).toHaveAttribute('role', 'status');
    expect(conflict).toHaveAttribute('aria-live', 'polite');
    expect(conflict?.textContent).toContain('3');
  });
});
