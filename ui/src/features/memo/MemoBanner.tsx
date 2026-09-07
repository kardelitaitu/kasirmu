import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocalization } from '@fluent/react';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useMemos } from './useMemos';
import type { ActiveMemo } from '@/api/memos';
import './MemoBanner.css';

/** Bubbles shown at once (owner direction, round 3); the rest queue. */
const MAX_STACK = 3;

/** Per-index spawn delay when several bubbles mount in the same render. */
const SPAWN_STAGGER_MS = 60;

/**
 * Exit-animation length, handed to `useExitAnimation` so its unmount timer
 * covers the CSS row transition in `MemoBanner.css` (200ms).
 */
const EXIT_DURATION_MS = 200;

/**
 * The Memo display surface (Phase 2 P1, step 4): a chat-bubble stack pinned
 * to the bottom-left of the screen showing the highest-priority active
 * memos for this terminal.
 *
 * Owner-directed design (rounds 1–3, 2026-09-07/08):
 *  - The stack shows at most {@link MAX_STACK} bubbles in backend list
 *    order; further memos queue silently and surface — with the spawn
 *    animation — when a slot frees.
 *  - Each bubble is adaptive-width (400px cap), previews at most 10 lines,
 *    carries its own (x) floating outside the top-right corner, and opens
 *    the enlarged reading card on click. Titles are optional (blank =
 *    text-only bubble) and no timestamp is ever rendered.
 *  - The enlarged card is a dedicated portal overlay (not the shared
 *    Modal): large reading typography and a single big (x) outside the
 *    card. The big (x) acknowledges durably (chat-bubble semantics: read
 *    it, done); Escape and overlay clicks return to the stack without one.
 *
 * Animation: stack rows are grid wrappers transitioning `grid-template-rows`
 * between 0fr and 1fr, so a spawning bubble expands (pushing the stack down)
 * and a closing one collapses (letting the stack slide up) purely through
 * layout flow — no FLIP measurement. Unmount timing stays with
 * `useExitAnimation` (exit-animation-pattern skill); under reduced motion
 * the CSS transitions are skipped and `animDuration` snaps timers to zero.
 */
export default function MemoBanner({ kds = false }: { kds?: boolean }) {
  const { memos, acknowledge } = useMemos({ kds });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const visible = memos.slice(0, MAX_STACK);
  // Look the expanded memo up in the FULL list: while the card is open the
  // memo could drift past the stack slice on a poll reorder. If it leaves
  // the list entirely (expired, or acknowledged elsewhere) the overlay
  // unmounts directly — acceptable for a state nothing can act on.
  const expanded =
    expandedId === null
      ? undefined
      : memos.find((active) => active.memo.id === expandedId);

  return (
    <>
      {visible.length > 0 && (
        <div className="memo-stack" data-testid="memo-stack">
          {visible.map((active, index) => (
            <MemoStackItem
              key={active.memo.id}
              active={active}
              index={index}
              isExpanded={expandedId === active.memo.id}
              onAck={acknowledge}
              onExpand={(memoId) => setExpandedId(memoId)}
            />
          ))}
        </div>
      )}
      {expanded && (
        <MemoExpandedOverlay
          key={expanded.memo.id}
          active={expanded}
          onAck={acknowledge}
          onDismiss={() => setExpandedId(null)}
        />
      )}
    </>
  );
}

/**
 * One bubble row of the stack. Owns its own exit-animation state: the (x)
 * captures the durable ack in `pendingRef` and only fires it after the row
 * has fully collapsed — `acknowledge` drops the memo from the hook
 * immediately (optimistic), so firing it early would yank the bubble out
 * mid-animation.
 */
function MemoStackItem({
  active,
  index,
  isExpanded,
  onAck,
  onExpand,
}: {
  active: ActiveMemo;
  index: number;
  isExpanded: boolean;
  onAck: (memoId: string) => void;
  onExpand: (memoId: string) => void;
}) {
  const { l10n } = useLocalization();
  const memoId = active.memo.id;

  // Spawn: the row mounts collapsed (0fr) and flips to expanded two frames
  // later so the grid-rows transition actually plays (a same-frame flip
  // would paint the final state with no transition). The delay staggers
  // simultaneous spawns; exit transitions must never be delayed.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setMounted(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  const pendingRef = useRef<(() => void) | null>(null);
  const exit = useExitAnimation(true, () => {
    pendingRef.current?.();
    pendingRef.current = null;
  }, EXIT_DURATION_MS);

  const handleClose = () => {
    pendingRef.current = () => onAck(memoId);
    exit.requestClose();
  };

  // Titles are optional in the display contract: a blank title renders a
  // text-only bubble, and no timestamp is ever shown (owner direction).
  const displayTitle = active.memo.title.trim();
  const openLabel = displayTitle
    ? l10n.getString('memo-banner-open-aria', { title: displayTitle })
    : l10n.getString('memo-banner-open-aria-plain');

  const itemClass = ['memo-stack-item', mounted ? 'is-mounted' : '', exit.exiting ? 'is-exiting' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={itemClass}
      style={{ transitionDelay: exit.exiting ? '0ms' : `${index * SPAWN_STAGGER_MS}ms` }}
    >
      <div className="memo-banner" role="alert" aria-live="polite">
        <button
          type="button"
          className="memo-banner-open"
          onClick={() => onExpand(memoId)}
          aria-haspopup="dialog"
          aria-expanded={isExpanded}
          aria-label={openLabel}
          data-testid="memo-banner-open"
        >
          {displayTitle && <strong className="memo-banner-title">{displayTitle}</strong>}
          <p className="memo-banner-text">{active.memo.body}</p>
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
    </div>
  );
}

/**
 * The enlarged reading card: a portal overlay with the full memo text at
 * reading size and a single big (x) floating outside the card. The big (x)
 * runs the durable ack; Escape (via the focus trap) and overlay clicks
 * close without acknowledging, so a stray click can never permanently
 * dismiss a memo nobody read.
 */
function MemoExpandedOverlay({
  active,
  onAck,
  onDismiss,
}: {
  active: ActiveMemo;
  onAck: (memoId: string) => void;
  onDismiss: () => void;
}) {
  const { l10n } = useLocalization();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Same pendingRef pattern as the bubble row: the action is captured at
  // click time and runs when the exit fade completes. `onDismiss` always
  // clears the expanded id; the pending action additionally acknowledges.
  const pendingRef = useRef<(() => void) | null>(null);
  const exit = useExitAnimation(true, () => {
    pendingRef.current?.();
    pendingRef.current = null;
    onDismiss();
  }, EXIT_DURATION_MS);

  const closeWith = (action: (() => void) | null) => {
    pendingRef.current = action;
    exit.requestClose();
  };

  // Focus trap owns Escape + Tab cycling + auto-focus + scroll lock, the
  // same contract the shared Modal gives every other dialog in the app.
  useFocusTrap(panelRef, true, () => closeWith(null));

  const displayTitle = active.memo.title.trim();

  return createPortal(
    <div
      className={`memo-expanded-overlay${exit.exiting ? ' is-exiting' : ''}`}
      role="presentation"
      data-testid="memo-expanded-overlay"
      onClick={(e) => {
        // Only close when the overlay itself is clicked, not the card.
        if (e.target === e.currentTarget) closeWith(null);
      }}
    >
      <div
        ref={panelRef}
        className={`memo-expanded-card${exit.exiting ? ' is-exiting' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={displayTitle ? titleId : undefined}
        data-testid="memo-expanded-card"
      >
        {displayTitle && (
          <h2 id={titleId} className="memo-expanded-title">
            {displayTitle}
          </h2>
        )}
        <p className="memo-expanded-text">{active.memo.body}</p>
        <button
          type="button"
          className="memo-expanded-close"
          onClick={() => closeWith(() => onAck(active.memo.id))}
          aria-label={l10n.getString('memo-banner-acknowledge-aria')}
          data-testid="memo-expanded-acknowledge"
        >
          <svg
            width="20"
            height="20"
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
    </div>,
    document.body,
  );
}
