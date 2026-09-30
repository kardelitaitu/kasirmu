import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import type { UnsavedChangesDialogProps } from '@/components/UnsavedChangesDialog';

const ftl = `
modal-close-aria = Close
cancel = Cancel
save = Save
discard = Discard
restaurant-unsaved-discard = Discard
restaurant-unsaved-dialog-headline = You have unsaved changes.
restaurant-unsaved-dialog-subtext = Save before leaving, or discard them.
`;

const bundle = new FluentBundle('en-US');
bundle.addResource(new FluentResource(ftl));
const l10n = new ReactLocalization([bundle]);

function renderDialog(props: Partial<UnsavedChangesDialogProps> = {}) {
  const defaults: UnsavedChangesDialogProps = {
    open: true,
    onCancel: vi.fn(),
    onDiscard: vi.fn(),
    onSave: vi.fn(),
  };
  return render(
    <LocalizationProvider l10n={l10n}>
      <UnsavedChangesDialog {...defaults} {...props} />
    </LocalizationProvider>,
  );
}

describe('UnsavedChangesDialog', () => {
  const onCancel = vi.fn();
  const onDiscard = vi.fn();
  const onSave = vi.fn();

  beforeEach(() => {
    onCancel.mockClear();
    onDiscard.mockClear();
    onSave.mockClear();
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('renders nothing when open is false', () => {
    const { container } = renderDialog({ open: false });
    expect(container.innerHTML).toBe('');
  });

  it('renders icon on left and 2-row text without a separate title bar', () => {
    renderDialog();

    // Icon on left
    expect(document.querySelector('.unsaved-dialog-icon')).toBeInTheDocument();

    // 2-row text
    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument();
    expect(screen.getByText('Save before leaving, or discard them.')).toBeInTheDocument();

    // No separate modal header / heading title
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders a close button on outside of the box', () => {
    renderDialog();

    const outsideBtn = screen.getByTestId('modal-close-btn-outside');
    expect(outsideBtn).toBeInTheDocument();
    expect(outsideBtn).toHaveClass('modal-close-btn--outside');
  });

  it('calls onCancel when the outside close button is clicked', async () => {
    const user = userEvent.setup();
    renderDialog({ onCancel });

    const outsideBtn = screen.getByTestId('modal-close-btn-outside');
    await user.click(outsideBtn);
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });

  it('calls onCancel when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    renderDialog({ onCancel });

    await user.click(screen.getByTestId('unsaved-dialog-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onDiscard when Discard button is clicked', async () => {
    const user = userEvent.setup();
    renderDialog({ onDiscard });

    await user.click(screen.getByTestId('unsaved-dialog-discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('calls onSave when Save button is clicked', async () => {
    const user = userEvent.setup();
    renderDialog({ onSave });

    await user.click(screen.getByTestId('unsaved-dialog-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('disables Cancel and Discard buttons while saving', () => {
    renderDialog({ saving: true });

    expect(screen.getByTestId('unsaved-dialog-cancel')).toBeDisabled();
    expect(screen.getByTestId('unsaved-dialog-discard')).toBeDisabled();
    expect(screen.getByTestId('unsaved-dialog-save')).toBeDisabled();
    expect(screen.getByTestId('unsaved-dialog-save')).toHaveAttribute('aria-busy', 'true');
  });

  it('supports custom headline, subtext, and icon', () => {
    renderDialog({
      headline: 'Custom Unsaved Header',
      subtext: 'Custom detail message.',
      icon: <span data-testid="custom-icon">⚠️</span>,
    });

    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
    expect(screen.getByText('Custom Unsaved Header')).toBeInTheDocument();
    expect(screen.getByText('Custom detail message.')).toBeInTheDocument();
  });
});
