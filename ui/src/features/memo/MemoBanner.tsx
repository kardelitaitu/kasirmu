import { useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { useMemos } from './useMemos';
import './MemoBanner.css';

/**
 * The Memo display surface (Phase 2 P1, step 4): a dismissible top-left
 * notification showing the highest-priority active memo for this terminal.
 *
 * The read path already stacks Location Memos above Organization Memos, so the
 * banner renders `memos[0]` and advances as each is acknowledged or dismissed.
 * Acknowledge writes the durable recipient ack (the memo stops reappearing);
 * dismiss hides it for this session only. Both run through the shared
 * exit-animation fade (see the exit-animation-pattern skill); the content is
 * keyed by memo id so the next memo plays its entry animation on swap.
 *
 * Renders nothing when there are no active memos, no session, or the fetch is
 * still cold — it never occupies space when empty.
 */
export default function MemoBanner({ kds = false }: { kds?: boolean }) {
  const { l10n } = useLocalization();
  const { memos, acknowledge, dismiss } = useMemos({ kds });
  const top = memos[0];
  const open = top !== undefined;

  // Acknowledge and dismiss differ only in the durable side effect, so both
  // route through the same exit fade; the pending action is captured at click
  // time (with the memo id snapshotted) and run when the fade completes.
  const pendingRef = useRef<(() => void) | null>(null);
  const exit = useExitAnimation(open, () => {
    pendingRef.current?.();
    pendingRef.current = null;
  });

  if (!exit.shouldRender || !top) {
    return null;
  }

  const memoId = top.memo.id;
  const isLocation = top.memo.locationId !== null;

  const handleAcknowledge = () => {
    pendingRef.current = () => acknowledge(memoId);
    exit.requestClose();
  };
  const handleDismiss = () => {
    pendingRef.current = () => dismiss(memoId);
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
      <div className="memo-banner-actions">
        <button
          type="button"
          className="memo-banner-btn memo-banner-btn--acknowledge"
          onClick={handleAcknowledge}
          disabled={exit.exiting}
          aria-label={l10n.getString('memo-banner-acknowledge-aria')}
        >
          <Localized id="memo-banner-acknowledge">Acknowledge</Localized>
        </button>
        <button
          type="button"
          className="memo-banner-btn memo-banner-btn--dismiss"
          onClick={handleDismiss}
          disabled={exit.exiting}
          aria-label={l10n.getString('memo-banner-dismiss-aria')}
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
    </div>
  );
}
