import { useState, useRef, useCallback, useId, useEffect, useLayoutEffect, type ReactNode, type ReactElement, cloneElement } from 'react';
import { createPortal } from 'react-dom';
import './Tooltip.css';

/** Props for the Tooltip component. */
export interface TooltipProps {
  /** Content to show inside the tooltip. */
  content: ReactNode;
  /** Position relative to the trigger element. */
  position?: 'right' | 'top' | 'bottom' | 'left';
  /** Delay in ms before showing the tooltip. Default 400ms. */
  showDelay?: number;
  /** Delay in ms before hiding the tooltip. Default 100ms. */
  hideDelay?: number;
  /** Maximum width of the tooltip bubble (CSS value). Default '280px'. */
  maxWidth?: string;
  /** Horizontal alignment of the bubble relative to the trigger.
   *  Applies to `position="top"` / `"bottom"`; default 'center'.
   *  Use 'right' when the trigger sits near the right viewport edge. */
  align?: 'center' | 'left' | 'right';
  /** Render the tooltip to document.body via a portal so it escapes
   *  overflow:hidden/scroll clipping. Use when the trigger is inside
   *  a scrollable or clipped container. */
  portal?: boolean;
  /** Prevent the tooltip text from wrapping onto multiple lines. */
  nowrap?: boolean;
  /** Layout footprint of the wrapper element.
   *  'block' (default) — full-width flex row, correct for sidebar/nav rows.
   *  'inline' — shrink-to-fit, for triggers that must keep their own box:
   *  toolbar buttons, badges, inline spans. Without this, wrapping a small
   *  button in the default full-width flex row stretches it and breaks the
   *  surrounding layout. */
  fit?: 'block' | 'inline';
  /** The element that triggers the tooltip on hover/focus. */
  children: ReactElement;
}

/**
 * A polished tooltip component that appears on hover and focus of its trigger.
 *
 * - Appears after a 400ms delay (configurable) so it doesn't flash during mouse passes
 * - Stays visible for 100ms after the cursor leaves (configurable)
 * - Supports `position` prop (right, top, bottom, left)
 * - Handles keyboard focus via `:focus-visible` on the trigger
 * - Includes a small arrow pointing toward the trigger
 * - Uses `role="tooltip"` for accessibility
 * - Optional `portal` mode renders to document.body via createPortal with
 *   position:fixed, escaping parent overflow clipping
 */
export default function Tooltip({
  content,
  position = 'right',
  showDelay = 400,
  hideDelay = 100,
  maxWidth = '280px',
  portal = false,
  nowrap = false,
  align = 'center',
  fit = 'block',
  children,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const uid = useId();
  const tooltipId = `tooltip-${uid}`;
  const showTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);

  // Clear pending show/hide timers on unmount. A Tooltip can disappear
  // mid-interaction (nav search filtering a row, section switch, sidebar
  // collapse) while an 800ms show timer is still armed; without this the
  // timer fires setState against a dead component and any companion state
  // (portal rect) can end up inconsistent for the next mount.
  useEffect(
    () => () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
    },
    [],
  );

  const startShow = useCallback(() => {
    // Capture trigger position before showing (portal needs viewport coords)
    if (portal && triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
    clearTimeout(hideTimer.current);
    showTimer.current = setTimeout(() => setVisible(true), showDelay);
  }, [showDelay, portal]);

  const startHide = useCallback(() => {
    clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), hideDelay);
  }, [hideDelay]);

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      // If focus moves to the tooltip itself, don't hide
      if (tooltipRef.current && tooltipRef.current.contains(e.relatedTarget as Node)) return;
      startHide();
    },
    [startHide],
  );

  // Portal: pass viewport coordinates as CSS custom properties for
  // position:fixed layout. Fall back gracefully when rect is null.
  const portalStyle: React.CSSProperties | undefined =
    portal && triggerRect
      ? ({
          '--trigger-top': `${triggerRect.top}px`,
          '--trigger-left': `${triggerRect.left}px`,
          '--trigger-width': `${triggerRect.width}px`,
          '--trigger-height': `${triggerRect.height}px`,
          '--trigger-bottom': `${triggerRect.bottom}px`,
          '--trigger-right': `${triggerRect.right}px`,
          maxWidth,
        } as React.CSSProperties)
      : undefined;

  // ── Clamp to viewport (portal mode only) ──────────────────────────
  const [clamped, setClamped] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!visible || !portal || !triggerRect || !tooltipRef.current) {
      setClamped(null);
      return;
    }
    const tip = tooltipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;

    const clampX = (x: number) => Math.max(margin, Math.min(x, vw - tip.width - margin));
    const clampY = (y: number) => Math.max(margin, Math.min(y, vh - tip.height - margin));

    let left: number;
    let top: number;
    if (position === 'right') {
      // Bubble to the right of the trigger, vertically centered
      left = clampX(triggerRect.right + 10);
      top = clampY(triggerRect.top + triggerRect.height / 2 - tip.height / 2);
    } else if (position === 'left') {
      // Bubble to the left of the trigger, vertically centered
      left = clampX(triggerRect.left - tip.width - 10);
      top = clampY(triggerRect.top + triggerRect.height / 2 - tip.height / 2);
    } else if (position === 'bottom') {
      // Bubble below the trigger, horizontally aligned per `align`
      if (align === 'right') {
        left = clampX(triggerRect.right - tip.width);
      } else if (align === 'left') {
        left = clampX(triggerRect.left);
      } else {
        left = clampX(triggerRect.left + triggerRect.width / 2 - tip.width / 2);
      }
      top = clampY(triggerRect.bottom + 10);
    } else {
      // top: bubble above the trigger, horizontally aligned per `align`
      if (align === 'right') {
        left = clampX(triggerRect.right - tip.width);
      } else if (align === 'left') {
        left = clampX(triggerRect.left);
      } else {
        left = clampX(triggerRect.left + triggerRect.width / 2 - tip.width / 2);
      }
      top = clampY(triggerRect.top - tip.height - 10);
    }

    setClamped({ left, top });
  }, [visible, portal, position, triggerRect]);

  const tooltipNode = (
    <div
      ref={tooltipRef}
      id={tooltipId}
      className={`tooltip-content tooltip-content--${position}${visible ? ' tooltip-content--visible' : ''}${portal ? ' tooltip-content--portal' : ''}${nowrap ? ' tooltip-content--nowrap' : ''}${align !== 'center' ? ` tooltip-content--align-${align}` : ''}`}
      style={
        portal
          ? clamped
            ? {
                left: `${clamped.left}px`,
                top: `${clamped.top}px`,
                // Clear the opposing CSS anchor so the fixed bubble is not
                // stretched between two insets (top+bottom or left+right),
                // which would give it the wrong height/width.
                right: 'auto',
                bottom: 'auto',
                // Inline left/top are already the final centered position,
                // so drop the CSS translateX/Y centering transform. This also
                // removes the scale-pop transition, but opacity fade remains.
                transform: 'none',
                maxWidth,
              }
            : portalStyle
          : maxWidth ? { maxWidth } : undefined
      }
      role="tooltip"
      onMouseEnter={() => {
        // Guard against the "stuck tooltip" bug: this handler must only
        // count when the bubble is genuinely hoverable (visible). While
        // hidden the bubble is opacity:0 + pointer-events:none (Tooltip.css),
        // so in a real browser this only fires for a visible bubble — but a
        // synthetic event (test, E2E, automation) can still reach a hidden
        // one and would force-show a tooltip with no trigger under the
        // cursor, and with the trigger far away no mouseleave ever arrives.
        if (!visible) return;
        clearTimeout(hideTimer.current);
        clearTimeout(showTimer.current);
        setVisible(true);
      }}
      onMouseLeave={startHide}
      aria-hidden={!visible}
    >
      {content}
    </div>
  );

  return (
    <div
      className={`tooltip-wrapper${fit === 'inline' ? ' tooltip-wrapper--inline' : ''}`}
      onMouseEnter={startShow}
      onMouseLeave={startHide}
      onFocus={startShow}
      onBlur={handleBlur}
    >
      {cloneElement(children, {
        ref: triggerRef,
        'aria-describedby': visible ? tooltipId : undefined,
      } as Record<string, unknown>)}
      {portal && typeof document !== 'undefined'
        ? createPortal(tooltipNode, document.body)
        : tooltipNode}
    </div>
  );
}
