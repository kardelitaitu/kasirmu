import { type ReactNode } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import type { ModalProps } from '@/components/Modal';

// ── Types ──────────────────────────────────────────────────────────

export type ConfirmVariant = 'danger' | 'warning' | 'info';

export interface ConfirmDialogProps {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Called when the dialog should close (cancel, overlay click, Escape). */
  onCancel: () => void;
  /** Called when the user confirms the action. */
  onConfirm: () => void;
  /** Dialog title. */
  title: string;
  /** Body message (supports JSX for rich formatting). */
  message: ReactNode;
  /** Visual variant — affects the icon colour and confirm button styling. @default 'danger' */
  variant?: ConfirmVariant;
  /** Show a loading spinner on the confirm button. @default false */
  loading?: boolean;
  /** Disable the confirm button. @default false */
  disabled?: boolean;
  /** Label for the confirm button. Falls back to a localized default. */
  confirmLabel?: string;
  /** Label for the cancel button. Falls back to a localized default. */
  cancelLabel?: string;
  /** Custom icon element. If omitted, a built-in icon is used based on variant. */
  icon?: ReactNode;
  /** Whether to show the close (X) button in the header. @default false */
  showCloseButton?: boolean;
  /** Override the Modal footer (replaces the default Cancel/Confirm buttons). */
  footer?: ModalProps['footer'];
}

// ── Icons ──────────────────────────────────────────────────────────

const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.5',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
};

/** Warning triangle icon for danger/warning variants. */
function WarningIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/** Info circle icon for info variant. */
function InfoIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

// ── Component ──────────────────────────────────────────────────────

/**
 * Shared confirmation dialog — wraps the Modal component with a
 * standardised layout: optional icon, title, message body, and
 * Cancel / Confirm footer buttons.
 *
 * Examples:
 * ```tsx
 * const [show, setShow] = useState(false);
 * return (
 *   <ConfirmDialog
 *     open={show}
 *     onCancel={() => setShow(false)}
 *     onConfirm={() => { doAction(); setShow(false); }}
 *     title="Delete item?"
 *     message="This cannot be undone."
 *     variant="danger"
 *   />
 * );
 * ```
 */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  message,
  variant = 'danger',
  loading = false,
  disabled = false,
  confirmLabel,
  cancelLabel,
  icon,
  showCloseButton = false,
  footer,
}: ConfirmDialogProps) {
  const { l10n } = useLocalization();

  const defaultFooter = (
    <div className="confirm-dialog-actions">
      <Button
        variant="ghost"
        size="md"
        onClick={onCancel}
        disabled={loading}
        aria-label={cancelLabel ?? l10n.getString('cancel')}
        data-testid="confirm-dialog-cancel"
      >
        {cancelLabel ? (
          cancelLabel
        ) : (
          <Localized id="cancel"><span>Cancel</span></Localized>
        )}
      </Button>
      <Button
        variant={variant === 'info' ? 'primary' : 'danger'}
        size="md"
        onClick={onConfirm}
        disabled={disabled || loading}
        loading={loading}
        aria-label={confirmLabel ?? l10n.getString('confirm')}
        data-testid="confirm-dialog-confirm"
      >
        {confirmLabel ? (
          confirmLabel
        ) : (
          <Localized id="confirm"><span>Confirm</span></Localized>
        )}
      </Button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      showCloseButton={showCloseButton}
      footer={footer ?? defaultFooter}
    >
      <div className="confirm-dialog-body">
        {/* Icon */}
        {icon ? (
          <div className={`confirm-dialog-icon confirm-dialog-icon--${variant}`} aria-hidden="true">
            {icon}
          </div>
        ) : variant === 'info' ? (
          <div className="confirm-dialog-icon confirm-dialog-icon--info" aria-hidden="true">
            <InfoIcon />
          </div>
        ) : (
          <div className={`confirm-dialog-icon confirm-dialog-icon--${variant}`} aria-hidden="true">
            <WarningIcon />
          </div>
        )}

        {/* Message */}
        {typeof message === 'string' ? (
          <p className="confirm-dialog-message">{message}</p>
        ) : (
          <div className="confirm-dialog-message">{message}</div>
        )}
      </div>
    </Modal>
  );
}
