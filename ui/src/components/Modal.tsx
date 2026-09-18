import { useRef, useId, type ReactNode } from 'react';
import { useLocalization } from '@fluent/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useExitAnimation } from '@/hooks/useExitAnimation';

// ── Types ──────────────────────────────────────────────────────────

export interface ModalProps {
  /** Whether the modal is visible. */
  open: boolean;
  /** Called when the modal should close (overlay click, Escape, close button). */
  onClose: () => void;
  /** Dialog title (rendered in the header). */
  title?: string;
  /** Dialog body content. */
  children: ReactNode;
  /** Optional footer content (typically action buttons). */
  footer?: ReactNode;
  /** Whether to show the close (X) button in the header. @default true */
  showCloseButton?: boolean;
}

// ── Component ─────────────────────────────────────────────────────

/**
 * Accessible modal dialog built with a React portal.
 *
 * Features:
 * - Focus trap: Tab/Shift+Tab cycle through focusable elements
 * - Escape key closes the modal
 * - Overlay click closes the modal
 * - ARIA `dialog` role with `aria-modal` and `aria-labelledby`
 * - Animated entrance (fade + slide)
 *
 * Examples:
 * ```tsx
 * const [open, setOpen] = useState(false);
 * return (
 *   <>
 *     <Button onClick={() => setOpen(true)}>Open</Button>
 *     <Modal open={open} onClose={() => setOpen(false)} title="Confirm">
 *       <p>Are you sure?</p>
 *     </Modal>
 *   </>
 * );
 * ```
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  showCloseButton = true,
}: ModalProps) {
  const { l10n } = useLocalization();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // ── Exit-animation gate ──────────────────────────────────────────
  // Releases the focus trap + scroll lock *while* the fade plays so focus
  // returns to the trigger, then unmounts after the mirror animation.
  const { shouldRender, exiting, requestClose } = useExitAnimation(open, onClose, 300);

  // ── Focus trap (Escape + Tab cycling + auto-focus + scroll lock) ──
  // Inactive while exiting (and when closed) so focus restores to the trigger.
  useFocusTrap(panelRef, open && !exiting, requestClose);

  if (!shouldRender) return null;

  return (
    <div
      className={`modal-overlay${exiting ? ' modal-overlay--exiting' : ''}`}
      role="presentation"
      onClick={(e) => {
        // Only close when the overlay itself is clicked, not the panel.
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        className={`modal-panel${exiting ? ' modal-panel--exiting' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
      >
        {/* ── Header ────────────────────────────── */}
        <div className="modal-header">
          {title && (
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
          )}

          {showCloseButton && (
            <button
              type="button"
              className="modal-close-btn"
              onClick={requestClose}
               aria-label={l10n.getString('modal-close-aria')}
            >
              {/* X icon */}
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
          )}
        </div>

        {/* ── Body ──────────────────────────────── */}
        <div className="modal-body">{children}</div>

        {/* ── Footer ────────────────────────────── */}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}