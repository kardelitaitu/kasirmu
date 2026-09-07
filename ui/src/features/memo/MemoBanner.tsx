import { useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { useMemos } from './useMemos';
import './MemoBanner.css';

/**
 * The Memo display surface (Phase 2 P1, step 4): a chat-bubble overlay
 * pinned to the bottom-left of the screen showing the highest-priority
 * active memo for this terminal (owner-directed redesign, 2026-09-07 —
 * replaced the top sliding banner).
 *
 * The read path already stacks Location Memos above Organization Memos, so
 * the bubble renders `memos[0]` and advances as each is acknowledged. The
 * single (x) button acknowledges durably — the memo never reappears on this
 * terminal (chat-bubble semantics: read it, done); the session-only dismiss
 * path remains on the useMemos hook for other consumers. The close routes
 * through the shared exit-animation fade (see the exit-animation-pattern
 * skill); the content is keyed by memo id so the next memo plays its entry
 * animation on swap.
 *
 * Renders nothing when there are no active memos, no session, or the fetch is
 * still cold — it never occupies space when empty.
 */
export default function MemoBanner({ kds = false }: { kds?: boolean }) {
  const { l10n } = useLocalization();
  const { memos, acknowledge } = useMemos({ kds });
  const top = memos[0];
  const open = top !== undefined;

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
  const isLocation = top.memo.locationIds.length > 0;

  const handleClose = () => {
    pendingRef.current = () => acknowledge(memoId);
    exit.requestClose();
  };

  return (
    <div
      key={memoId}
      className={`memo-banner${exit.exiting ? ' memo-banner--exiting' : ''}`}
      role="alert"
      aria-live="polite"
    >
      <div className="memo-banner-body">
        <span className="memo-banner-scope">
          {isLocation ? (
            <Localized id="memo-banner-scope-location">
              <span className="memo-banner-badge memo-banner-badge--location" />
            </Localized>
          ) : (
            <Localized id="memo-banner-scope-organization">
              <span className="memo-banner-badge memo-banner-badge--organization" />
            </Localized>
          )}
        </span>
        <strong className="memo-banner-title">{top.memo.title}</strong>
        <p className="memo-banner-text">{top.memo.body}</p>
      </div>
      <button
        type="button"
        className="memo-banner-close"
        onClick={handleClose}
        disabled={exit.exiting}
        aria-label={l10n.getString('memo-banner-acknowledge-aria')}
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
  );
}
