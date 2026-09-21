/**
 * SegmentedTabs — a single-select tab strip whose active segment is one sliding
 * thumb, instead of a per-tab active background that blinks from one to the next.
 *
 * The pattern is the KDS header's (KdsScreen.css:239, and
 * prototypes/kds-prototype.html before it): a `role="tablist"` track holding one
 * absolutely positioned thumb plus the `role="tab"` buttons, the thumb at
 * `z-index: 0` so the labels paint over it. The fill, box and type are the design
 * system's primary button (`.btn--primary.btn--md`), which is what makes a
 * segmented control here read as the same control family as the buttons beside it.
 *
 * PRESENTATIONAL. No state, no refs, no effects, no measurement: the thumb is
 * placed by two custom properties (`--segmented-tab-index` / `-count`) that this
 * component writes from values it already has, because the track is an
 * equal-column grid and the thumb is one column wide. That is deliberately not
 * KdsHeaderTabs' arrangement, which measures its pills with refs and a `resize`
 * listener from the screen — its tabs carry order counts and its labels can be
 * uneven, while these segments are always equal. MEASURED, not assumed: an
 * equal-column grid at `width: max-content` sizes `1fr` tracks to the widest
 * label, and the thumb lands within 0.03px of the active tab over both two and
 * four uneven labels — a hug-width FLEX track with `flex: 1 1 0` does NOT
 * equalize (2px off at two labels, 40px at four), which is why the track is a
 * grid. Callers that need a screen-specific placement hook pass `className`,
 * which lands on the scroll viewport that wraps the track — see the second
 * element below.
 *
 * TWO ELEMENTS, on purpose. The outer `div` is the scroll viewport: it hugs the
 * track while there is room and caps it at its container when there is not, so a
 * strip whose labels are wider than the screen scrolls instead of being cut off
 * (measured: the Indonesian stock-transfer segments are 786px against 740px of
 * container at a 1024px viewport). The cap cannot move onto the track: `1fr`
 * tracks are equal only at `max-content`, so a capped grid makes them unequal and
 * drifts the thumb off the active segment — SegmentedTabs.css carries the detail.
 * `role="tablist"` stays on the track, which is the box that holds the tabs.
 *
 * Callers own their strings. Each label arrives already localized (`Localized`
 * or a Fluent node) and the accessible name for the strip is passed in, so no
 * message id or English literal lives here.
 */
import { type CSSProperties, type ReactNode } from 'react';
import './SegmentedTabs.css';

export interface SegmentedTabItem<T extends string> {
  /** Value this segment selects — the caller's own active-value vocabulary. */
  value: T;
  /** The segment's content, already localized by the caller. */
  label: ReactNode;
  /** Accessible name, when `label` alone does not name the segment. */
  ariaLabel?: string;
  /** DOM id for the tab button, when something else points at it by id. */
  tabId?: string;
  /** Id of the panel this tab controls, for `aria-controls`. */
  controls?: string;
  /** `data-testid` for the button. */
  testId?: string;
}

export interface SegmentedTabsProps<T extends string> {
  /** The segments, left to right. Order is the layout: equal columns follow it. */
  items: readonly SegmentedTabItem<T>[];
  /** Which segment is active. A value absent from `items` renders no active tab. */
  activeValue: T;
  /** Called with the clicked segment's value; the caller owns the state. */
  onSelect: (value: T) => void;
  /** Accessible name for the whole strip. */
  ariaLabel: string;
  /**
   * Screen-level placement hook (margin, justify-self), applied to the control's
   * outer box — the scroll viewport wrapping the track — so a screen positions
   * the whole control, not the part that can overflow it.
   */
  className?: string;
}

/** A single-select tab strip with one sliding thumb. */
export function SegmentedTabs<T extends string>({
  items,
  activeValue,
  onSelect,
  ariaLabel,
  className,
}: SegmentedTabsProps<T>) {
  // -1 when the active value is not rendered (a gated tab): the thumb parks on
  // the first column rather than translating one column the wrong way.
  const index = Math.max(0, items.findIndex((item) => item.value === activeValue));

  return (
    // The scroll viewport. Its own box is the control's; the track inside it
    // keeps `max-content` so the columns stay equal (see the module doc).
    <div
      className={className ? `segmented-tabs-scroll ${className}` : 'segmented-tabs-scroll'}
    >
      <div className="segmented-tabs" role="tablist" aria-label={ariaLabel}>
        {/* Decorative: no text, no pointer events, so it stays out of the
            accessibility tree while the tabs announce selection via
            aria-selected. The transform is LTR-only, like every other sheet in
            this repo. */}
        <span
          className="segmented-tab-indicator"
          aria-hidden="true"
          style={{
            '--segmented-tab-index': index,
            '--segmented-tab-count': items.length,
          } as CSSProperties}
        />
        {items.map((item) => {
          const active = item.value === activeValue;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={item.tabId}
              aria-selected={active}
              aria-controls={item.controls}
              aria-label={item.ariaLabel}
              data-testid={item.testId}
              className={active ? 'segmented-tab segmented-tab--active' : 'segmented-tab'}
              onClick={() => onSelect(item.value)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
