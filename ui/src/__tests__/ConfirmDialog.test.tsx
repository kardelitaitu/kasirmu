// ── ConfirmDialog contract tests ───────────────────────────────────
//
// Pins the behaviour of the shared ConfirmDialog component:
// variant icons, title/message rendering, cancel/confirm callbacks,
// loading/disabled states, custom footer override, and i18n fallbacks.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { ConfirmDialogProps } from '@/components/ConfirmDialog';

// ── Setup ──────────────────────────────────────────────────────────

const ftl = `
modal-close-aria = Close
cancel = Cancel
confirm = Confirm
`;

const bundle = new FluentBundle('en-US');
bundle.addResource(new FluentResource(ftl));
const l10n = new ReactLocalization([bundle]);

function renderConfirmDialog(props: Partial<ConfirmDialogProps> = {}) {
  const defaults: ConfirmDialogProps = {
    open: true,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    title: 'Are you sure?',
    message: 'This action cannot be undone.',
  };
  return render(
    <LocalizationProvider l10n={l10n}>
      <ConfirmDialog {...defaults} {...props} />
    </LocalizationProvider>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────

describe('ConfirmDialog', () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();

  beforeEach(() => {
    onCancel.mockClear();
    onConfirm.mockClear();
    document.body.style.overflow = '';
  });

  // ── Visibility ─────────────────────────────────────────────────

  it('renders nothing when open is false', () => {
    const { container } = renderConfirmDialog({ open: false });
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when open is true', () => {
    renderConfirmDialog({ open: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // ── Title ──────────────────────────────────────────────────────

  it('renders the title', () => {
    renderConfirmDialog({ title: 'Delete Item?' });
    expect(screen.getByText('Delete Item?')).toBeInTheDocument();
  });

  it('links title to dialog via aria-labelledby', () => {
    renderConfirmDialog({ title: 'Linked Title' });
    const dialog = screen.getByRole('dialog');
    const titleId = dialog.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    const titleEl = document.getElementById(titleId!);
    expect(titleEl).toHaveTextContent('Linked Title');
  });

  // ── Message ────────────────────────────────────────────────────

  it('renders a string message', () => {
    renderConfirmDialog({ message: 'This will delete everything.' });
    expect(screen.getByText('This will delete everything.')).toBeInTheDocument();
    expect(document.querySelector('.confirm-dialog-message')?.tagName).toBe('P');
  });

  it('renders a JSX message as a div', () => {
    renderConfirmDialog({
      message: <span data-testid="rich-msg">Rich <strong>content</strong></span>,
    });
    expect(screen.getByTestId('rich-msg')).toBeInTheDocument();
    expect(screen.getByText('content').tagName).toBe('STRONG');
    expect(document.querySelector('.confirm-dialog-message')?.tagName).toBe('DIV');
  });

  // ── Variant icons ──────────────────────────────────────────────

  it('renders danger icon by default', () => {
    renderConfirmDialog({ variant: 'danger' });
    const icon = document.querySelector('.confirm-dialog-icon--danger');
    expect(icon).toBeInTheDocument();
  });

  it('renders warning icon for warning variant', () => {
    renderConfirmDialog({ variant: 'warning' });
    const icon = document.querySelector('.confirm-dialog-icon--warning');
    expect(icon).toBeInTheDocument();
  });

  it('renders info icon for info variant', () => {
    renderConfirmDialog({ variant: 'info' });
    const icon = document.querySelector('.confirm-dialog-icon--info');
    expect(icon).toBeInTheDocument();
  });

  it('renders custom icon when provided', () => {
    renderConfirmDialog({
      variant: 'danger',
      icon: <svg data-testid="custom-icon" />,
    });
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
    // Custom icon should still be wrapped in the variant's icon container.
    const iconContainer = document.querySelector('.confirm-dialog-icon--danger');
    expect(iconContainer).toBeInTheDocument();
    expect(iconContainer!.querySelector('[data-testid="custom-icon"]')).toBeInTheDocument();
  });

  // ── Cancel button ──────────────────────────────────────────────

  it('renders cancel button with default FTL label', () => {
    renderConfirmDialog({ open: true });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('renders cancel button with custom label', () => {
    renderConfirmDialog({ cancelLabel: 'Nevermind' });
    expect(screen.getByRole('button', { name: 'Nevermind' })).toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    renderConfirmDialog({ onCancel });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables cancel button when loading is true', () => {
    renderConfirmDialog({ loading: true });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  // ── Confirm button ─────────────────────────────────────────────

  it('renders confirm button with default FTL label', () => {
    renderConfirmDialog({ open: true });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('renders confirm button with custom label', () => {
    renderConfirmDialog({ confirmLabel: 'Yes, delete' });
    expect(screen.getByRole('button', { name: 'Yes, delete' })).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', async () => {
    renderConfirmDialog({ onConfirm });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables confirm button when disabled is true', () => {
    renderConfirmDialog({ disabled: true });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('disables confirm button when loading is true', () => {
    renderConfirmDialog({ loading: true });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('shows spinner on confirm button when loading', () => {
    renderConfirmDialog({ loading: true });
    const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
    // The spinner is rendered as a span with aria-hidden
    expect(confirmBtn.querySelector('.btn__spinner')).toBeInTheDocument();
  });

  it('sets aria-busy on confirm button when loading', () => {
    renderConfirmDialog({ loading: true });
    const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmBtn).toHaveAttribute('aria-busy', 'true');
  });

  it('does not set aria-busy when not loading', () => {
    renderConfirmDialog({ loading: false });
    const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmBtn).not.toHaveAttribute('aria-busy');
  });

  // ── Variant affects confirm button class ──────────────────────

  it('uses btn--danger class for danger variant confirm button', () => {
    renderConfirmDialog({ variant: 'danger' });
    const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmBtn.classList.contains('btn--danger')).toBe(true);
  });

  it('uses btn--danger class for warning variant confirm button', () => {
    renderConfirmDialog({ variant: 'warning' });
    const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmBtn.classList.contains('btn--danger')).toBe(true);
  });

  it('uses btn--primary class for info variant confirm button', () => {
    renderConfirmDialog({ variant: 'info' });
    const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmBtn.classList.contains('btn--primary')).toBe(true);
  });

  // ── Custom footer ─────────────────────────────────────────────

  it('renders custom footer when provided, replacing default buttons', () => {
    renderConfirmDialog({
      footer: <button type="button" data-testid="custom-footer-btn">Custom Action</button>,
    });
    expect(screen.getByTestId('custom-footer-btn')).toBeInTheDocument();
    // Default cancel/confirm buttons should NOT be present.
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  // ── showCloseButton ───────────────────────────────────────────

  it('does not render close button by default (showCloseButton=false)', () => {
    renderConfirmDialog({ open: true });
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
  });

  it('renders close button when showCloseButton=true', () => {
    renderConfirmDialog({ showCloseButton: true });
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('calls onCancel when close button is clicked', async () => {
    renderConfirmDialog({ showCloseButton: true, onCancel });
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });

  // ── Overlay click (inherited from Modal) ──────────────────────

  it('calls onCancel when overlay is clicked', async () => {
    renderConfirmDialog({ onCancel });
    const overlay = document.querySelector('.modal-overlay')!;
    await userEvent.click(overlay);
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });

  it('does not call onCancel when panel is clicked', async () => {
    renderConfirmDialog({ onCancel });
    const panel = document.querySelector('.modal-panel')!;
    await userEvent.click(panel);
    expect(onCancel).not.toHaveBeenCalled();
  });

  // ── Escape key (inherited from Modal) ─────────────────────────

  it('calls onCancel when Escape is pressed', async () => {
    renderConfirmDialog({ onCancel });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });

  // ── Body scroll lock (inherited from Modal) ──────────────────

  it('locks body scroll when open', () => {
    renderConfirmDialog({ open: true });
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body scroll when closed', () => {
    const { rerender } = render(
      <LocalizationProvider l10n={l10n}>
        <ConfirmDialog open={true} onCancel={onCancel} onConfirm={onConfirm} title="Test" message="Msg" />
      </LocalizationProvider>,
    );
    rerender(
      <LocalizationProvider l10n={l10n}>
        <ConfirmDialog open={false} onCancel={onCancel} onConfirm={onConfirm} title="Test" message="Msg" />
      </LocalizationProvider>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  // ── Combined state: disabled + loading priority ──────────────

  it('disables both buttons when loading is true', () => {
    renderConfirmDialog({ loading: true, disabled: false });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('disables confirm button when disabled is true even if loading is false', () => {
    renderConfirmDialog({ disabled: true, loading: false });
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });
});