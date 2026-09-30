import { type ReactNode } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import './UnsavedChangesDialog.css';

export interface UnsavedChangesDialogProps {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Called when the user cancels (dialog closes, stays on screen). Also fired on Escape, overlay click, or close button. */
  onCancel: () => void;
  /** Called when the user chooses to discard unsaved changes and navigate away. */
  onDiscard: () => void;
  /** Called when the user chooses to save changes before navigating away. */
  onSave: () => void | Promise<void>;
  /** Whether saving is in progress. Shows loading spinner on the Save button. */
  saving?: boolean;
  /** First row headline text. Defaults to localized "You have unsaved changes." */
  headline?: ReactNode;
  /** Second row descriptive text. Defaults to localized "Save before leaving, or discard them." */
  subtext?: ReactNode;
  /** Custom icon element. Defaults to warning triangle icon. */
  icon?: ReactNode;
}

/** Warning icon for unsaved changes alert */
function DefaultWarningIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/**
 * Modern, accessible unsaved-changes confirmation dialog.
 *
 * Displays an icon on the left and a 2-row headline/subtext on the right,
 * with no separate title bar and an elevated (x) close button floating
 * outside the card corner.
 *
 * Provides three clear actions: Cancel, Discard, and Save.
 */
export function UnsavedChangesDialog({
  open,
  onCancel,
  onDiscard,
  onSave,
  saving = false,
  headline,
  subtext,
  icon,
}: UnsavedChangesDialogProps) {
  const { l10n } = useLocalization();

  const footer = (
    <div className="unsaved-dialog-actions">
      <Button
        variant="ghost"
        size="md"
        onClick={onCancel}
        disabled={saving}
        aria-label={l10n.getString('cancel') || 'Cancel'}
        data-testid="unsaved-dialog-cancel"
      >
        <Localized id="cancel">
          <span>Cancel</span>
        </Localized>
      </Button>
      <Button
        variant="danger"
        size="md"
        onClick={onDiscard}
        disabled={saving}
        aria-label={l10n.getString('restaurant-unsaved-discard') || l10n.getString('discard') || 'Discard'}
        data-testid="unsaved-dialog-discard"
      >
        <Localized id="restaurant-unsaved-discard">
          <span>Discard</span>
        </Localized>
      </Button>
      <Button
        variant="primary"
        size="md"
        loading={saving}
        onClick={onSave}
        aria-label={l10n.getString('save') || 'Save'}
        data-testid="unsaved-dialog-save"
      >
        <Localized id="save">
          <span>Save</span>
        </Localized>
      </Button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onCancel}
      showCloseButton={true}
      closeButtonPosition="outside"
      className="unsaved-changes-dialog-panel"
      ariaLabel={l10n.getString('restaurant-unsaved-dialog-headline') || 'You have unsaved changes.'}
      footer={footer}
    >
      <div className="unsaved-dialog-body">
        <div className="unsaved-dialog-icon" aria-hidden="true">
          {icon ?? <DefaultWarningIcon />}
        </div>
        <div className="unsaved-dialog-text">
          <div className="unsaved-dialog-headline">
            {headline ?? (
              <Localized id="restaurant-unsaved-dialog-headline">
                <span>You have unsaved changes.</span>
              </Localized>
            )}
          </div>
          <div className="unsaved-dialog-subtext">
            {subtext ?? (
              <Localized id="restaurant-unsaved-dialog-subtext">
                <span>Save before leaving, or discard them.</span>
              </Localized>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
