import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPopup } from '@/components/SettingsPopup';

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: { getString: (id: string) => id === 'close' ? 'Close' : id },
  }),
}));

// ── Tests ──────────────────────────────────────────────────────────

describe('SettingsPopup', () => {
  const onClose = vi.fn();

  afterEach(() => {
    vi.clearAllMocks();
    document.body.style.overflow = '';
  });

  // ── Visibility ─────────────────────────────────────────────────

  it('renders nothing when open is false', () => {
    const { container } = render(
      <SettingsPopup open={false} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders content when open is true', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="My Popup">
        <p>Popup body content</p>
      </SettingsPopup>,
    );
    expect(screen.getByText('Popup body content')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // ── Title ──────────────────────────────────────────────────────

  it('renders the title in the header', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Configure Tax Rate">
        <p>Content</p>
      </SettingsPopup>,
    );
    expect(screen.getByText('Configure Tax Rate')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Configure Tax Rate');
  });

  it('sets aria-label on dialog from title', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Edit Staff">
        <p>Content</p>
      </SettingsPopup>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Edit Staff');
  });

  // ── Close button ───────────────────────────────────────────────

  it('renders close button', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    const closeBtn = screen.getByRole('button', { name: /close/i });
    expect(closeBtn).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Overlay click ─────────────────────────────────────────────

  it('calls onClose when overlay backdrop is clicked', async () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    const overlay = document.querySelector('.settings-popup-overlay')!;
    await userEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when panel is clicked (event propagation)', async () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    const panel = document.querySelector('.settings-popup')!;
    await userEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Escape key ────────────────────────────────────────────────

  it('calls onClose when Escape is pressed', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Focus trap ────────────────────────────────────────────────

  it('focuses the first focusable element (close button) when opened', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    // The close button is the first focusable element.
    expect(screen.getByRole('button', { name: /close/i })).toHaveFocus();
  });

  it('traps focus: Tab on last focusable wraps to first', () => {
    // Use a custom footer without buttons so the children's buttons
    // are the last focusable elements in the popup.
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test" footer={<span>footer</span>}>
        <button type="button" data-testid="btn-first">First</button>
        <button type="button" data-testid="btn-last">Last</button>
      </SettingsPopup>,
    );

    const last = screen.getByTestId('btn-last');
    const closeBtn = screen.getByRole('button', { name: /close/i });

    // Focus last and press Tab — should wrap to close button (first).
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeBtn).toHaveFocus();
  });

  it('traps focus: Shift+Tab on first focusable wraps to last', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test" footer={<span>footer</span>}>
        <button type="button" data-testid="btn-first">First</button>
        <button type="button" data-testid="btn-last">Last</button>
      </SettingsPopup>,
    );

    const closeBtn = screen.getByRole('button', { name: /close/i });
    const last = screen.getByTestId('btn-last');

    // Focus close button (first) and press Shift+Tab — wraps to last.
    closeBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  // ── Body scroll lock ──────────────────────────────────────────

  it('locks body scroll when open', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body scroll when closed', () => {
    const { rerender } = render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    rerender(
      <SettingsPopup open={false} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('restores original body scroll value', () => {
    document.body.style.overflow = 'scroll';
    const { rerender } = render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <SettingsPopup open={false} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    expect(document.body.style.overflow).toBe('scroll');

    // Reset for other tests.
    document.body.style.overflow = '';
  });

  // ── Default footer ─────────────────────────────────────────────

  it('renders Cancel and Save buttons by default', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('calls onClose when Cancel button is clicked', async () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onSave when Save button is clicked', async () => {
    const onSave = vi.fn();
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test" onSave={onSave}>
        <p>Content</p>
      </SettingsPopup>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows Save button with aria-busy when saving is true', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test" saving={true}>
        <p>Content</p>
      </SettingsPopup>,
    );
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect(saveBtn).toHaveAttribute('aria-busy', 'true');
    expect(saveBtn).toBeDisabled();
  });

  it('does not have aria-busy on Save when saving is false', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect(saveBtn).not.toHaveAttribute('aria-busy');
    expect(saveBtn).not.toBeDisabled();
  });

  it('renders spinner element when saving is true', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test" saving={true}>
        <p>Content</p>
      </SettingsPopup>,
    );
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    const spinner = saveBtn.querySelector('.btn__spinner');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
  });

  it('disables Cancel button when saving is true', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test" saving={true}>
        <p>Content</p>
      </SettingsPopup>,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('disables Save button when saveDisabled is true', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test" saveDisabled={true}>
        <p>Content</p>
      </SettingsPopup>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('does not call onSave when Save button is disabled and clicked', async () => {
    const onSave = vi.fn();
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test" onSave={onSave} saveDisabled={true}>
        <p>Content</p>
      </SettingsPopup>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  // ── Custom labels ─────────────────────────────────────────────

  it('uses custom saveLabel and cancelLabel', () => {
    render(
      <SettingsPopup
        open={true}
        onClose={onClose}
        title="Test"
        saveLabel="Create"
        cancelLabel="Abort"
      >
        <p>Content</p>
      </SettingsPopup>,
    );
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  // ── Custom footer ──────────────────────────────────────────────

  it('renders custom footer when provided', () => {
    render(
      <SettingsPopup
        open={true}
        onClose={onClose}
        title="Test"
        footer={<button type="button">Delete</button>}
      >
        <p>Content</p>
      </SettingsPopup>,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  // ── Error display ──────────────────────────────────────────────

  it('renders error message with alert role when error prop is set', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test" error="Something went wrong">
        <p>Content</p>
      </SettingsPopup>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('Something went wrong');
  });

  it('does not render error element when error is null', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not render error element when error is empty string', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test" error="">
        <p>Content</p>
      </SettingsPopup>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // ── Size variants ──────────────────────────────────────────────

  it('defaults to md size', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    const panel = document.querySelector('.settings-popup')!;
    expect(panel.classList.contains('settings-popup--md')).toBe(true);
  });

  it.each(['sm', 'md', 'lg'] as const)('applies correct CSS class for size=%s', (size) => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test" size={size}>
        <p>Content</p>
      </SettingsPopup>,
    );
    const panel = document.querySelector('.settings-popup')!;
    expect(panel.classList.contains(`settings-popup--${size}`)).toBe(true);
  });

  // ── Children ───────────────────────────────────────────────────

  it('renders children content', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <div data-testid="child">Child Element</div>
      </SettingsPopup>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('Child Element');
  });

  it('renders multiple children', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <span data-testid="child-1">First</span>
        <span data-testid="child-2">Second</span>
      </SettingsPopup>,
    );
    expect(screen.getByTestId('child-1')).toBeInTheDocument();
    expect(screen.getByTestId('child-2')).toBeInTheDocument();
  });

  // ── Portal rendering ──────────────────────────────────────────

  it('renders into document.body via portal', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    const panel = document.querySelector('.settings-popup')!;
    expect(panel.closest('body')).toBeTruthy();
  });

  // ── Overlay presentational role ───────────────────────────────

  it('has presentation role on overlay', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    const overlay = document.querySelector('.settings-popup-overlay');
    expect(overlay).toHaveAttribute('role', 'presentation');
  });

  // ── Dialog aria-modal ─────────────────────────────────────────

  it('has aria-modal="true" on dialog', () => {
    render(
      <SettingsPopup open={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SettingsPopup>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});
