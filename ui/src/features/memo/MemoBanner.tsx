import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
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
 * Exit-animation lengths, handed to `useExitAnimation` so its unmount timer
 * covers the matching CSS in `MemoBanner.css`: the row's spring collapse
 * (450ms) and the reading card's reverse zoom (400ms).
 */
const ROW_EXIT_MS = 450;
const OVERLAY_EXIT_MS = 400;

/** Viewport geometry of the bubble a card was opened from. */
interface MemoOrigin {
  left: number;
  top: number;
  width: number;
  height: number;
}

function rectOf(el: HTMLElement): MemoOrigin {
  const rect = el.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * The Memo display surface (Phase 2 P1, step 4): a chat-bubble stack pinned
 * to the bottom-left of the screen showing the highest-priority active
 * memos for this terminal.
 *
 * Owner-directed design (rounds 1–4, 2026-09-07/08):
 *  - The stack shows at most {@link MAX_STACK} bubbles in backend list
 *    order; further memos queue silently and surface — with the spawn
 *    animation — when a slot frees.
 *  - Each bubble is adaptive-width (560px cap), previews at most 3
 *    body rows under a 1-row title, carries its own (x) floating
 *    outside the top-right corner, and opens the enlarged reading
 *    card on click. Titles are optional (blank = text-only bubble)
 *    and no timestamp is ever rendered. The row caps live in
 *    MemoBanner.css as `-webkit-line-clamp`, not here: the preview is
 *    a row budget, so the engine has to do the cutting.
 *  - The enlarged card is a dedicated portal overlay (not the shared
 *    Modal): large reading typography and a single big (x) outside the
 *    card. The big (x) acknowledges durably (chat-bubble semantics: read
 *    it, done); Escape and overlay clicks return to the stack without one.
 *
 * Motion (macOS-grade, round 4): one damped spring (`--memo-spring`, a
 * linear() easing baked from a ζ=0.7 oscillator) drives row height and
 * transforms — bubbles are dealt in from and return to the stack's
 * bottom-left corner; the reflow of the survivors is the star of a close.
 * The reading card zooms from the clicked bubble's rect: the click stores
 * the bubble's geometry, the overlay mounts transformed onto it
 * (FLIP-lite: set from-style → forced reflow → clear, so the CSS spring
 * transition plays to identity) and refolds back into it on dismiss.
 * Opacity always runs on plain ease curves, never the spring. Unmount
 * timing stays with `useExitAnimation` (exit-animation-pattern skill);
 * under reduced motion the CSS transitions are skipped and `animDuration`
 * snaps timers to zero.
 */
export default function MemoBanner({ kds = false }: { kds?: boolean }) {
  const { memos, acknowledge } = useMemos({ kds });
  const [expanded, setExpanded] = useState<{ id: string; origin: MemoOrigin } | null>(null);

  const visible = memos.slice(0, MAX_STACK);
  // Look the expanded memo up in the FULL list: while the card is open the
  // memo could drift past the stack slice on a poll reorder. If it leaves
  // the list entirely (expired, or acknowledged elsewhere) the overlay
  // unmounts directly — acceptable for a state nothing can act on.
  const expandedActive = expanded
    ? memos.find((active) => active.memo.id === expanded.id)
    : undefined;

  return (
    <>
      {visible.length > 0 && (
        <div className="memo-stack" data-testid="memo-stack">
          {visible.map((active, index) => (
            <MemoStackItem
              key={active.memo.id}
              active={active}
              index={index}
              isExpanded={expanded?.id === active.memo.id}
              onAck={acknowledge}
              onExpand={(memoId, origin) => setExpanded({ id: memoId, origin })}
            />
          ))}
        </div>
      )}
      {expandedActive && expanded && (
        <MemoExpandedOverlay
          key={expandedActive.memo.id}
          active={expandedActive}
          origin={expanded.origin}
          onAck={acknowledge}
          onDismiss={() => setExpanded(null)}
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
 * mid-animation. All visible motion (dealt-in from the corner, spring
 * reflow) lives in CSS; this component only stages the state classes and
 * the per-index spawn delay.
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
  onExpand: (memoId: string, origin: MemoOrigin) => void;
}) {
  const { l10n } = useLocalization();
  const memoId = active.memo.id;

  // Spawn: the row mounts collapsed (0fr) and flips to expanded two frames
  // later so the grid-rows transition actually plays (a same-frame flip
  // would paint the final state with no transition).
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
  }, ROW_EXIT_MS);

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
      style={{ '--memo-delay': `${index * SPAWN_STAGGER_MS}ms` } as CSSProperties}
    >
      <div className="memo-banner" role="alert" aria-live="polite">
        <button
          type="button"
          className="memo-banner-open"
          onClick={(e) => onExpand(memoId, rectOf(e.currentTarget))}
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
 * reading size and a single big (x) floating outside the card. The card
 * ZOOMS from the bubble it was opened from (FLIP-lite — see the zoom
 * effects below) and refolds back into that rect on dismiss. The big (x)
 * runs the durable ack; Escape (via the focus trap) and backdrop clicks
 * close without acknowledging, so a stray click can never permanently
 * dismiss a memo nobody read.
 */
function MemoExpandedOverlay({
  active,
  origin,
  onAck,
  onDismiss,
}: {
  active: ActiveMemo;
  origin: MemoOrigin;
  onAck: (memoId: string) => void;
  onDismiss: () => void;
}) {
  const { l10n } = useLocalization();
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Same pendingRef pattern as the bubble row: the action is captured at
  // click time and runs when the exit completes. `onDismiss` always clears
  // the expanded state; the pending action additionally acknowledges.
  const pendingRef = useRef<(() => void) | null>(null);
  const exit = useExitAnimation(true, () => {
    pendingRef.current?.();
    pendingRef.current = null;
    onDismiss();
  }, OVERLAY_EXIT_MS);

  const closeWith = (action: (() => void) | null) => {
    pendingRef.current = action;
    exit.requestClose();
  };

  // Focus trap owns Escape + Tab cycling + auto-focus + scroll lock, the
  // same contract the shared Modal gives every other dialog in the app.
  useFocusTrap(cardRef, true, () => closeWith(null));

  // Zoom-from-origin (FLIP-lite): transform the card onto the source
  // bubble's rect, commit the from-style with a forced reflow, then clear
  // it so the CSS spring transition plays to identity. With `hide`, the
  // transform is left in place so the same transition plays in reverse
  // while the overlay is exiting. Skipped when geometry is unavailable
  // (jsdom reports zero-size rects) — the card then simply fades.
  const zoomToOrigin = (hide: boolean) => {
    const card = cardRef.current;
    if (!card || origin.width <= 0 || origin.height <= 0) return;
    const rect = card.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const sx = origin.width / rect.width;
    const sy = origin.height / rect.height;
    const dx = origin.left + origin.width / 2 - (rect.left + rect.width / 2);
    const dy = origin.top + origin.height / 2 - (rect.top + rect.height / 2);
    card.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    card.style.opacity = '0';
    if (!hide) {
      // Commit the from-style so the cleared style below transitions
      // from the bubble's geometry instead of snapping.
      void card.offsetHeight;
      card.style.transform = '';
      card.style.opacity = '';
    }
  };

  useLayoutEffect(() => {
    zoomToOrigin(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Under reduced motion the transitions are media-gated off; applying
    // the from-transform anyway would flash a tiny card for a frame
    // before the (zero-length) unmount timer fires.
    if (exit.exiting && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      zoomToOrigin(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exit.exiting]);

  const displayTitle = active.memo.title.trim();

  return createPortal(
    <div
      className={`memo-expanded-overlay${exit.exiting ? ' is-exiting' : ''}`}
      data-testid="memo-expanded-overlay"
    >
      <div
        className="memo-expanded-backdrop"
        role="presentation"
        data-testid="memo-expanded-backdrop"
        onClick={() => closeWith(null)}
      />
      <div
        ref={cardRef}
        className="memo-expanded-card"
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
