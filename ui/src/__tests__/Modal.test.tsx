import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '@/components/Modal';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';

// ── Setup ──────────────────────────────────────────────────────────

const bundle = new FluentBundle('en-US');
bundle.addResource(new FluentResource('modal-close-aria = Close'));
const l10n = new ReactLocalization([bundle]);

function renderModal(props: Parameters<typeof Modal>[0]) {
  return render(
    <LocalizationProvider l10n={l10n}>
      <Modal {...props} />
    </LocalizationProvider>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Modal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockClear();
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  // ── Visibility ─────────────────────────────────────────────────

  it('renders nothing when open is false', () => {
    const { container } = renderModal({
      open: false,
      onClose,
      title: 'Test',
      children: <p>Content</p>,
    });
    expect(container.innerHTML).toBe('');
  });

  it('renders content when open is true', () => {
    renderModal({
      open: true,
      onClose,
      title: 'My Modal',
      children: <p>Modal body content</p>,
    });
    expect(screen.getByText('Modal body content')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // ── Title ──────────────────────────────────────────────────────

  it('renders the title when provided', () => {
    renderModal({
      open: true,
      onClose,
      title: 'Confirm Action',
      children: <p>Are you sure?</p>,
    });
    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
  });

  it('does not render title heading when title is omitted', () => {
    renderModal({
      open: true,
      onClose,
      children: <p>Content</p>,
    });
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  // ── Dialog ARIA attributes ────────────────────────────────────

  it('has dialog role and aria-modal', () => {
    renderModal({
      open: true,
      onClose,
      title: 'Test',
      children: <p>Content</p>,
    });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
  });

  it('links title to dialog via aria-labelledby', () => {
    renderModal({
      open: true,
      onClose,
      title: 'Linked Title',
      children: <p>Content</p>,
    });
    const dialog = screen.getByRole('dialog');
    const titleId = dialog.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    const titleEl = document.getElementById(titleId!);
    expect(titleEl).toHaveTextContent('Linked Title');
  });

  // ── Close button ──────────────────────────────────────────────

  it('renders close button by default', () => {
    renderModal({
      open: true,
      onClose,
      children: <p>Content</p>,
    });
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    renderModal({
      open: true,
      onClose,
      children: <p>Content</p>,
    });
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('hides close button when showCloseButton is false', () => {
    renderModal({
      open: true,
      onClose,
      showCloseButton: false,
      children: <p>Content</p>,
    });
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
  });

  // ── Overlay click ─────────────────────────────────────────────

  it('calls onClose when overlay is clicked', async () => {
    renderModal({
      open: true,
      onClose,
      children: <p>Content</p>,
    });
    const overlay = document.querySelector('.modal-overlay')!;
    await userEvent.click(overlay);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does not call onClose when panel is clicked', async () => {
    renderModal({
      open: true,
      onClose,
      children: <p>Content</p>,
    });
    const panel = document.querySelector('.modal-panel')!;
    await userEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Escape key ────────────────────────────────────────────────

  it('calls onClose when Escape is pressed', async () => {
    renderModal({
      open: true,
      onClose,
      children: <p>Content</p>,
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  // ── Focus trap ────────────────────────────────────────────────

  it('focuses the first focusable element when opened', () => {
    renderModal({
      open: true,
      onClose,
      title: 'Test',
      children: (
        <>
          <button type="button">First</button>
          <button type="button">Last</button>
        </>
      ),
    });
    // The close button is the first focusable element.
    expect(screen.getByRole('button', { name: /close/i })).toHaveFocus();
  });

  it('traps focus: Tab on last element wraps to first', () => {
    renderModal({
      open: true,
      onClose,
      children: (
        <>
          <button type="button" data-testid="btn-first">First</button>
          <button type="button" data-testid="btn-last">Last</button>
        </>
      ),
    });

    const last = screen.getByTestId('btn-last');
    const closeBtn = screen.getByRole('button', { name: /close/i });

    // Tab on the last focusable element wraps to the first.
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeBtn).toHaveFocus();
  });

  it('traps focus: Shift+Tab on first element wraps to last', () => {
    renderModal({
      open: true,
      onClose,
      children: (
        <>
          <button type="button" data-testid="btn-first">First</button>
          <button type="button" data-testid="btn-last">Last</button>
        </>
      ),
    });

    const closeBtn = screen.getByRole('button', { name: /close/i });

    // Shift+Tab on the first element wraps to the last.
    closeBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByTestId('btn-last')).toHaveFocus();
  });

  // ── Body scroll lock ──────────────────────────────────────────

  it('locks body scroll when open', () => {
    renderModal({
      open: true,
      onClose,
      children: <p>Content</p>,
    });
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body scroll when closed', () => {
    const { rerender } = render(
      <LocalizationProvider l10n={l10n}>
        <Modal open={true} onClose={onClose}>
          <p>Content</p>
        </Modal>
      </LocalizationProvider>,
    );
    rerender(
      <LocalizationProvider l10n={l10n}>
        <Modal open={false} onClose={onClose}>
          <p>Content</p>
        </Modal>
      </LocalizationProvider>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  // ── Footer ────────────────────────────────────────────────────

  it('renders footer content when provided', () => {
    renderModal({
      open: true,
      onClose,
      footer: <button type="button">Save</button>,
      children: <p>Content</p>,
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('does not render footer when not provided', () => {
    renderModal({
      open: true,
      onClose,
      children: <p>Content</p>,
    });
    expect(document.querySelector('.modal-footer')).toBeNull();
  });

  // ── Overlay role ──────────────────────────────────────────────

  it('has presentation role on overlay', () => {
    renderModal({
      open: true,
      onClose,
      children: <p>Content</p>,
    });
    const overlay = document.querySelector('.modal-overlay');
    expect(overlay).toHaveAttribute('role', 'presentation');
  });
});