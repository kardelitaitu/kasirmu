import { type ReactNode, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import './SettingsPopup.css';

export type SettingsPopupSize = 'sm' | 'md' | 'lg';

export interface SettingsPopupProps {
  /** Whether the popup is visible. */
  open: boolean;
  /** Called when the user clicks Close, Cancel, or the backdrop. */
  onClose: () => void;
  /** Modal title (changes between Create / Edit). */
  title: string;
  /** Form fields rendered in the body area. */
  children: ReactNode;
  /**
   * Custom footer content. When omitted, the default footer renders
   * a Cancel button + a Save button with loading support.
   */
  footer?: ReactNode;
  /** Error message shown below the children, or null. */
  error?: string | null;
  /** Whether a save operation is in progress (shows spinner on Save button). */
  saving?: boolean;
  /** Called when the default Save button is clicked. */
  onSave?: () => void;
  /** Text for the Save button (default: "Save"). */
  saveLabel?: string;
  /** Disable the Save button. */
  saveDisabled?: boolean;
  /** Text for the Cancel button (default: "Cancel"). */
  cancelLabel?: string;
  /** Modal width variant. sm=480px, md=560px (default), lg=640px */
  size?: SettingsPopupSize;
}

/**
 * Shared popup/modal for settings editing screens.
 *
 * Renders a full overlay + panel at `document.body` via `createPortal`
 * with:
 * - Header (title + close button)
 * - Scrollable body (children)
 * - Error display with SVG icon
 * - Default footer (Cancel / Save with loading) or custom footer
 * - Size variants (sm / md / lg)
 * - Keyboard: Escape to close, Tab trap for focus cycling
 * - Backdrop click to close
 * - Body scroll lock while open
 *
 * Usage:
 * ```tsx
 * <SettingsPopup
 *   open={showModal}
 *   onClose={closeModal}
 *   title={l10n.getString(isEditing ? 'edit-title' : 'create-title')}
 *   error={error}
 *   saving={saving}
 *   onSave={handleSave}
 *   saveLabel={l10n.getString('save')}
 *   saveDisabled={!isValid}
 * >
 *   <label>…</label>
 *   <input … />
 * </SettingsPopup>
 * ```
 */
export function SettingsPopup({
  open,
  onClose,
  title,
  children,
  footer,
  error,
  saving,
  onSave,
  saveLabel,
  saveDisabled,
  cancelLabel,
  size = 'md',
}: SettingsPopupProps) {
  const { l10n } = useLocalization();
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Focus trap (Escape + Tab cycling + auto-focus + scroll lock) ──
  useFocusTrap(panelRef, open, onClose);

  if (!open) return null;

  return createPortal(
    <div
      className="settings-popup-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`settings-popup settings-popup--${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="settings-popup-header">
          <h2 className="settings-popup-title">{title}</h2>
          <button
            type="button"
            className="settings-popup-close"
            onClick={onClose}
            aria-label={l10n.getString('close')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="settings-popup-body">
          {children}

          {/* Error */}
          {error && (
            <div className="settings-popup-error" role="alert">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                width="16"
                height="16"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="settings-popup-footer">
          {footer ?? (
            <>
              <Button variant="ghost" onClick={onClose} disabled={saving}>
                {cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                variant="primary"
                {...(saving ? { loading: true } : {})}
                disabled={saveDisabled}
                onClick={onSave}
              >
                {saveLabel ?? 'Save'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
