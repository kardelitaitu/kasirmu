import { useRef, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { useMemos } from './useMemos';
import './MemoBanner.css';

/**
 * The Memo display surface (Phase 2 P1, step 4): a chat-bubble overlay
 * pinned to the bottom-left of the screen showing the highest-priority
 * active memo for this terminal (owner-directed redesign, 2026-09-07 —
 * replaced the top sliding banner; body clamped + expandable per the
 * owner's follow-up, 2026-09-08).
 *
 * Layout: title + body only — the scope badge (Location/Organization) was
 * dropped as visual noise. The body is clamped to 10 lines; the title+body
 * block is one button that opens the shared centered `Modal` with the full
 * text (the bubble stays behind the overlay until the dialog resolves).
 * Titles are optional — a blank title renders a text-only bubble and no
 * timestamp is ever shown — and the (x) floats outside the bubble's
 * top-right corner (owner direction, 2026-09-08).
 *
 * Acknowledge semantics are unchanged: the single (x) acknowledges durably —
 * the memo never reappears on this terminal (chat-bubble semantics: read it,
 * done). Inside the modal, the primary Acknowledge button runs the same
 * durable ack, while closing the dialog (X / Escape / overlay) returns to
 * the bubble without one. Both paths route through the shared exit-animation
 * fade (see the exit-animation-pattern skill); the content is keyed by memo
 * id so the next memo plays its entry animation on swap.
 *
 * Renders nothing when there are no active memos, no session, or the fetch is
 * still cold — it never occupies space when empty.
 */
export default function MemoBanner({ kds = false }: { kds?: boolean }) {
  const { l10n } = useLocalization();
  const { memos, acknowledge } = useMemos({ kds });
  const top = memos[0];
  const open = top !== undefined;
  const [expanded, setExpanded] = useState(false);

  // The close action is captured at click time (with the memo id
  // snapshotted) and run when the exit fade completes.
  const pendingRef = useRef<(() => void) | null>(null);
  const exit = useExitAnimation(open, () => {
    pendingRef.current?.();
    pendingRef.current = null;
  });

  if (!exit.shouldRender || !top) {
    return null;
  }

  const memoId = top.memo.id;
  // Titles are optional in the display contract: a blank title renders a
  // text-only bubble, and no timestamp is ever shown (owner direction,
  // 2026-09-08).
  const displayTitle = top.memo.title.trim();
  const openLabel = displayTitle
    ? l10n.getString('memo-banner-open-aria', { title: displayTitle })
    : l10n.getString('memo-banner-open-aria-plain');

  const handleClose = () => {
    pendingRef.current = () => acknowledge(memoId);
    exit.requestClose();
  };

  // The dialog's primary action: close the dialog first, then run the
  // same durable-ack fade the (x) button uses.
  const handleAcknowledgeFromModal = () => {
    setExpanded(false);
    handleClose();
  };

  return (
    <>
      <div
        key={memoId}
        className={`memo-banner${exit.exiting ? ' memo-banner--exiting' : ''}`}
        role="alert"
        aria-live="polite"
      >
        <button
          type="button"
          className="memo-banner-open"
          onClick={() => setExpanded(true)}
          aria-haspopup="dialog"
          aria-expanded={expanded}
          aria-label={openLabel}
          data-testid="memo-banner-open"
        >
          {displayTitle && <strong className="memo-banner-title">{displayTitle}</strong>}
          <p className="memo-banner-text">{top.memo.body}</p>
        </button>
        <button
          type="button"
          className="memo-banner-close"
          onClick={handleClose}
          disabled={exit.exiting}
          aria-label={l10n.getString('memo-banner-acknowledge-aria')}
          data-testid="memo-banner-acknowledge"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {expanded && (
        <Modal
          open
          onClose={() => setExpanded(false)}
          // Conditional spread, not `title={displayTitle || undefined}`:
          // exactOptionalPropertyTypes forbids passing explicit undefined
          // to `title?: string`, and omitting the prop is what makes the
          // shared Modal skip the h2 + aria-labelledby for blank titles.
          {...(displayTitle ? { title: displayTitle } : {})}
          footer={
            <Button
              variant="primary"
              onClick={handleAcknowledgeFromModal}
              data-testid="memo-modal-acknowledge"
            >
              <Localized id="memo-modal-acknowledge">
                <span>Acknowledge</span>
              </Localized>
            </Button>
          }
        >
          <p className="memo-modal-text">{top.memo.body}</p>
        </Modal>
      )}
    </>
  );
}
