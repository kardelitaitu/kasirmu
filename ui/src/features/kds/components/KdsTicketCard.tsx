import { useEffect, useRef, useState, memo, useCallback, useMemo } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useTicketSla, type SlaThresholds } from '@/features/kds/hooks/useTicketSla';
import { useSound } from '@/frontend/shared/useSound';
import { requiredLocalized } from '@/frontend/shared';
import { getKdsOrderLinesScoped, type KdsOrder, type KdsLineItem } from '@/api/kds';
import { createCooldownWrapper } from '@/features/kds/hooks/useActionCooldown';
import { contrastText } from '@/features/kds/kdsCardColors';
import { ModifierBadge } from '@/features/kds/components/ModifierBadge';
import { canAdvanceKdsStatus } from '@/features/kds/kdsStatus';
import { useKdsCardColors } from '@/features/kds/KdsCardColorsContext';

/** Props for the KdsTicketCard component. */
export interface KdsTicketCardProps {
  /** The KDS order data to display. */
  order: KdsOrder;
  /** Called when the ticket is tapped to advance to the next status. */
  onAdvance: (order: KdsOrder) => void;
  /** Whether to show the order number (#123). */
  showOrderId?: boolean;
  /** Whether to show the table number. */
  showTableNumber?: boolean;
  /** Whether this ticket is keyboard-selected (highlighted). */
  selected?: boolean;
  /** Called when the items on this ticket are edited. */
  onSaveItems?: (orderId: string, itemsSummary: string, itemCount: number) => void;
  /** Session token for scoped API calls (e.g., fetching line items). */
  sessionToken: string;
  /** Called when a single line item is tapped to advance its status. */
  onAdvanceItem?: (item: KdsLineItem) => void;
  /** Called to open the product picker for adding items to this order (TODO 3f). */
  onAddItems?: (orderId: string) => void;
  /** Whether this ticket just arrived (brief highlight animation). */
  isNew?: boolean;
  /** SLA thresholds from the settings panel (defaults apply when omitted). */
  slaThresholds?: SlaThresholds;
}

/** Fork-and-knife SVG for dine-in orders (matches prototype DINE_ICON). */
const DINE_ICON = (
  <svg className="kds-service-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
    <path d="M7 2v20" />
    <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
  </svg>
);

/** Shopping-bag SVG for takeaway orders (matches prototype TAKEAWAY_ICON). */
const TAKEAWAY_ICON = (
  <svg className="kds-service-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

/** Format duration in seconds as a human-readable string (e.g. "3m 12s", "1h 5m"). */
export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min < 60) return sec ? `${min}m ${sec}s` : `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

/** Course display order — items without a course map to "other" at the end. */
const COURSE_ORDER = ['appetizer', 'main', 'side', 'dessert', 'beverage'] as const;

/**
 * Exported for testing. KdsTicketCardCourseLabel.test.ts redeclared this map value for
 * value, alongside its own courseLabel(); a copied lookup table passes forever, because
 * both the input and the expectation come from the same file.
 */
export const COURSE_L10N_KEYS: Record<string, string> = {
  appetizer: 'kds-course-appetizer',
  main: 'kds-course-main',
  side: 'kds-course-side',
  dessert: 'kds-course-dessert',
  beverage: 'kds-course-beverage',
};

/**
 * The fluent key for a course, or the "other" fallback.
 *
 * The pure half of the component's courseLabel callback, which wraps this in
 * requiredLocalized(). Extracted so the mapping can be tested without a localization
 * context -- the previous suite reproduced the mapping by hand and labelled the copy
 * "(without l10n)", which is exactly the kind of near-equivalent copy that drifts.
 */
export function courseL10nKey(course: string | null): string {
  if (!course) return 'kds-course-other';
  return COURSE_L10N_KEYS[course] ?? 'kds-course-other';
}

/**
 * Card header background: dine-in colour when the ticket has a table, takeaway otherwise.
 *
 * Extracted from the inline ternary in the component body, which
 * KdsTicketCardCourseLabel.test.ts had copied as its own headerBg(). Like the SLA clamp,
 * production had no name for this expression, so a name-matching detector cannot see the
 * copy at all -- naming it is the only way it becomes testable rather than re-invented.
 */
export function headerBg(
  tableNumber: string | null,
  colors: { dinein: string; takeaway: string },
): string {
  return tableNumber ? colors.dinein : colors.takeaway;
}

/** Group line items by course, preserving course order. Returns entries in display order. */
export function groupByCourse(items: KdsLineItem[]): { course: string | null; items: KdsLineItem[] }[] {
  const groups = new Map<string | null, KdsLineItem[]>();
  for (const item of items) {
    const course = item.course ?? null;
    if (!groups.has(course)) groups.set(course, []);
    groups.get(course)!.push(item);
  }

  const ordered: { course: string | null; items: KdsLineItem[] }[] = [];
  for (const c of COURSE_ORDER) {
    if (groups.has(c)) {
      ordered.push({ course: c, items: groups.get(c)! });
      groups.delete(c);
    }
  }
  // Remaining courses (including null/unknown) come last.
  for (const [course, courseItems] of groups) {
    ordered.push({ course, items: courseItems });
  }
  return ordered;
}

/**
 * An item is "done" when it has been served (or cancelled — off the board).
 *
 * Takes the structural minimum rather than a full KdsLineItem: the body reads exactly one
 * field, and the wider `Pick<...>` accepts every KdsLineItem unchanged while letting callers
 * (and tests) pass a fixture without inventing unrelated fields. This is a widening, not a
 * behaviour change -- both production call sites pass real items.
 */
export function itemDone(item: Pick<KdsLineItem, 'item_status'>): boolean {
  return item.item_status === 'served' || item.item_status === 'cancelled';
}

/** Next-action label key for the footer advance button, or null when terminal. */
export function nextActionKey(status: string): string | null {
  switch (status) {
    case 'pending': return 'kds-advance-start';
    case 'preparing': return 'kds-advance-ready';
    case 'ready': return 'kds-advance-serve';
    default: return null; // served / cancelled — no advance
  }
}

/**
 * KdsTicketCard renders a single KDS ticket with the design-language
 * prototype anatomy (dev/kds-prototype.html):
 *
 *   header (icon + order# + SLA time + status)  → collapses the card
 *   body: category headers (n/M Course + check) → collapse per course,
 *         item rows (qty× name, status dot, modifiers)
 *   footer: order notes + advance/edit/add action buttons
 *
 * Functionality preserved: SLA aging + audio alerts, lazy line-item
 * fetch + course grouping, per-item status advance, edit mode, product
 * picker, and click-to-advance (now on the footer Advance button).
 */
export const KdsTicketCard = memo(function KdsTicketCard({
  order, onAdvance, showOrderId = true, showTableNumber = true,
  selected = false, onSaveItems, sessionToken, onAdvanceItem, onAddItems,
  isNew = false, slaThresholds,
}: KdsTicketCardProps) {
  const { l10n } = useLocalization();
  const { level, urgent, display } = useTicketSla(order.received_at, slaThresholds);
  const { playAlert } = useSound();
  const prevLevel = useRef<'green' | 'yellow' | 'red' | null>(null);
  const prevUrgent = useRef(false);

  // Card-level collapse (prototype: header toggles the whole body).
  const [collapsed, setCollapsed] = useState(false);
  // Per-category collapse keyed by course (prototype: category header toggles).
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  // Play audio alert when ticket transitions into the red threshold.
  useEffect(() => {
    if (prevLevel.current !== null && prevLevel.current !== 'red' && level === 'red') {
      playAlert();
    }
    prevLevel.current = level;
  }, [level, playAlert]);

  // Play a second alert when ticket escalates to red-urgent (≥15 min).
  useEffect(() => {
    if (urgent && !prevUrgent.current) {
      playAlert();
    }
    prevUrgent.current = urgent;
  }, [urgent, playAlert]);

  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState(order.items_summary);
  const [editCount, setEditCount] = useState(String(order.item_count));
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Line items: lazy-fetch + re-fetch on save (TODO 3f) ────────
  const [lineItems, setLineItems] = useState<KdsLineItem[] | null>(null);
  const [lineItemsLoading, setLineItemsLoading] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);
  // Sequence guard: two in-flight fetches (e.g. a summary-change refetch
  // racing a fetchKey bump) can resolve out of order and pin stale items.
  const loadSeqRef = useRef(0);

  useEffect(() => {
    const seq = ++loadSeqRef.current;
    setLineItemsLoading(true);

    getKdsOrderLinesScoped(sessionToken, order.id)
      .then((items) => {
        if (seq !== loadSeqRef.current) return;
        setLineItems(items);
        setLineItemsLoading(false);
      })
      .catch(() => {
        // Silently fall back to items_summary — the flat display works for all orders.
        if (seq !== loadSeqRef.current) return;
        setLineItemsLoading(false);
      });
    // items_summary is the refetch trigger for external edits (e.g. an FOH
    // product-picker merge): the board event replaces the order object, the
    // changed summary re-fetches the structured lines so the course-grouped
    // display never goes stale.
  }, [sessionToken, order.id, order.items_summary, fetchKey]);

  // Group items by course for structured display.
  const courseGroups = lineItems && lineItems.length > 0
    ? groupByCourse(lineItems)
    : null;

  // ── Edit state ───────────────────────────────────────────────────

  // Sync edit state when order changes (e.g., after save).
  useEffect(() => {
    if (!editing) {
      setEditSummary(order.items_summary);
      setEditCount(String(order.item_count));
    }
  }, [order.items_summary, order.item_count, editing]);

  // Focus the text input when edit mode opens.
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleSaveEdit = useCallback(() => {
    const parsed = parseInt(editCount, 10);
    if (!editSummary.trim() || isNaN(parsed) || parsed <= 0) return;
    onSaveItems?.(order.id, editSummary.trim(), parsed);
    setEditing(false);
    // Re-fetch line items so the structured display reflects the saved items.
    setFetchKey((k) => k + 1);
  }, [editSummary, editCount, onSaveItems, order.id]);

  const handleCancelEdit = useCallback(() => {
    setEditSummary(order.items_summary);
    setEditCount(String(order.item_count));
    setEditing(false);
  }, [order.items_summary, order.item_count]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveEdit();
    if (e.key === 'Escape') handleCancelEdit();
  }, [handleSaveEdit, handleCancelEdit]);

  // ── Advance (footer button) — cooldown-guarded like the old card tap ──
  // This used to read `STATUS_ORDER.indexOf(status) < STATUS_ORDER.length - 1`, which
  // omits the `idx < 0` half of the progression test: for 'cancelled' indexOf returns -1,
  // and -1 < 3 makes canAdvance TRUE. Unreachable today because KdsScreen.tsx:196 filters
  // cancelled orders out before any card renders -- but it disagreed with both
  // nextKdsStatus and nextActionKey below, which treat cancelled as terminal. Sharing the
  // one helper removes the disagreement without changing behaviour on any reachable input.
  const canAdvance = canAdvanceKdsStatus(order.status);
  const nextKey = nextActionKey(order.status);
  const handleAdvance = useMemo(
    () => createCooldownWrapper(() => {
      if (editing) return;
      onAdvance(order);
    }, 200),
    [editing, order, onAdvance],
  );

  // Toggle the whole card body (prototype: header button).
  const toggleCollapsed = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((c) => !c);
  }, []);

  // Toggle one category's items.
  const toggleCategoryCollapsed = useCallback((key: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
  };

  // ── Course label resolver ────────────────────────────────────────
  const courseLabel = useCallback((course: string | null): string =>
    requiredLocalized(l10n, courseL10nKey(course)), [l10n]);

  const advanceLabel = nextKey ? requiredLocalized(l10n, nextKey) : '';

  // Card header colour — from context (shared with hamburger panel)
  const { colors } = useKdsCardColors();
  const hdrBg = headerBg(order.table_number, colors);
  const hdrText = contrastText(hdrBg);

  return (
    <div
      className={`kds-ticket kds-ticket--${level}${urgent ? ' kds-ticket--urgent' : ''}${selected ? ' kds-ticket--selected' : ''}${order.priority ? ' kds-ticket--rush' : ''}${isNew ? ' kds-ticket--new kds-card-spawn' : ''}${collapsed ? ' kds-card collapsed' : ''}`}
      data-testid={`kds-order-card-${order.display_number ?? order.id}`}
    >
      {/* ── Card header — collapse toggle ─────────────────────────── */}
      <button
        className="kds-card-header"
        style={{ background: hdrBg, color: hdrText }}
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={requiredLocalized(
          l10n,
          collapsed ? 'kds-toggle-card-aria-collapsed' : 'kds-toggle-card-aria',
          { number: order.display_number ?? 0 },
        )}
        data-testid={`kds-order-card-${order.display_number ?? order.id}-header`}
      >
        <span className="kds-card-header-icon" aria-hidden="true">
          {order.table_number ? DINE_ICON : TAKEAWAY_ICON}
        </span>
        <span className="kds-card-header-left">
          <span className="kds-card-header-row">
            {showOrderId && <span className="order-no">#{order.display_number}</span>}
            {showTableNumber && order.table_number && (
              <span className="kds-ticket-table">{order.table_number}</span>
            )}
            {order.priority && (
              <span className="kds-rush-badge">
                <Localized id="kds-rush-badge">RUSH</Localized>
              </span>
            )}
          </span>
        </span>
        <span className="kds-card-header-right">
          <span className="kds-card-header-meta">
            <span className={`kds-ticket-time kds-ticket-time--${level}`}>{display}</span>
            {urgent && (
              <span className="kds-ticket-urgent-badge">
                <Localized id="kds-urgent-badge">URGENT</Localized>
              </span>
            )}
            <span className={`status status--${order.status}`}>
              {requiredLocalized(l10n, `kds-${order.status}`)}
            </span>
          </span>
        </span>
      </button>

      {/* ── Collapsible body ──────────────────────────────────────── */}
      <div className="kds-card-collapsible">
        <div className="kds-card-collapsible-inner">
          <div className="kds-card-main">
            {/* ── Course-grouped line items as categories ─────────── */}
            {courseGroups ? (
              courseGroups.map((group) => {
                const key = group.course ?? '__other__';
                const doneCount = group.items.filter(itemDone).length;
                const allDone = doneCount === group.items.length;
                const catCollapsed = collapsedCats.has(key);
                return (
                  <div key={key} className="kds-category">
                    <button
                      className={`kds-category-header${allDone ? ' done' : ''}`}
                      onClick={toggleCategoryCollapsed(key)}
                      aria-expanded={!catCollapsed}
                      data-testid={`kds-order-card-${order.display_number ?? order.id}-cat-${key}`}
                    >
                      <span className="kds-cat-label">
                        {doneCount}/{group.items.length} {courseLabel(group.course)}
                      </span>
                      <span className={`kds-cat-check${allDone ? ' done' : ''}`} aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 10, height: 10 }}>
                          <path d="M4 12.5l5 5L20 6.5" />
                        </svg>
                      </span>
                    </button>
                    {!catCollapsed && group.items.map((item) => {
                      const done = itemDone(item);
                      const canAdvanceItem = !done;
                      return (
                        <div className="kds-item" key={item.id}>
                          <button
                            className={`kds-item-row${done ? ' done' : ''}${canAdvanceItem ? ' kds-ticket-item-row--actionable' : ''}`}
                            onClick={(e) => {
                              if (canAdvanceItem && onAdvanceItem) {
                                e.stopPropagation();
                                createCooldownWrapper(() => onAdvanceItem(item), 200)();
                              }
                            }}
                            onKeyDown={canAdvanceItem ? (e) => {
                              // role="button" handles Enter natively via onClick.
                              if (e.key === 'Enter') e.stopPropagation();
                            } : undefined}
                            aria-label={canAdvanceItem ? `${item.display_name} — ${requiredLocalized(l10n, `kds-item-status-${item.item_status}`)}` : undefined}
                            data-testid={`kds-order-card-${order.display_number ?? order.id}-item-${item.id}`}
                          >
                            <span className="kds-item-row-inner">
                              <span className="kds-item-left">
                                <span className="kds-item-qty">{item.qty}×</span>
                                <span className="kds-item-name">{item.display_name}</span>
                              </span>
                              <span className={`kds-ticket-item-status-dot kds-ticket-item-status-dot--${item.item_status}`} aria-hidden="true" />
                              <span className="kds-ticket-item-status-label">
                                {requiredLocalized(l10n, `kds-item-status-${item.item_status}`)}
                              </span>
                              {done && item.served_at && (
                                <span className="kds-item-done-time" aria-hidden="true">
                                  {fmtDuration(Math.floor((new Date(item.served_at).getTime() - new Date(order.received_at).getTime()) / 1000))}
                                </span>
                              )}
                            </span>
                            {item.modifiers.length > 0 && (
                              <span className="kds-ticket-modifiers">
                                {item.modifiers.map((mod, mi) => (
                                  <ModifierBadge key={mi} modifier={mod} />
                                ))}
                              </span>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              /* ── Fallback: flat items_summary (loading, old orders) ── */
              <span className="kds-ticket-items">
                {lineItemsLoading
                  ? requiredLocalized(l10n, 'kds-course-loading')
                  : order.items_summary}
              </span>
            )}
          </div>

          {/* ── Card footer: notes + actions ──────────────────────── */}
          <div className="kds-card-footer">
            {order.notes && (
              <span className="kds-ticket-notes">{order.notes}</span>
            )}

            {editing && (
              <div
                className="kds-ticket-edit"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === 'Escape') handleCancelEdit(); }}
                role="presentation"
                tabIndex={-1}
              >
                <input
                  ref={inputRef}
                  className="kds-ticket-edit-input"
                  type="text"
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  onKeyDown={handleKeyDown}
                  aria-label={requiredLocalized(l10n, 'kds-edit-items-aria')}
                  data-testid={`kds-order-card-${order.display_number ?? order.id}-edit-input`}
                />
                <div className="kds-ticket-edit-row">
                  <label className="kds-ticket-edit-label">
                    <Localized id="kds-edit-count-label">Count</Localized>:
                    <input
                      className="kds-ticket-edit-count"
                      type="number"
                      min={1}
                      value={editCount}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (e.target.value === '' || (Number.isInteger(v) && v >= 1)) setEditCount(e.target.value);
                      }}
                      onKeyDown={handleKeyDown}
                      aria-label={requiredLocalized(l10n, 'kds-edit-count-aria')}
                      data-testid={`kds-order-card-${order.display_number ?? order.id}-edit-count`}
                    />
                  </label>
                  <div className="kds-ticket-edit-actions">
                    <button
                      className="kds-ticket-edit-save"
                      onClick={handleSaveEdit}
                      disabled={!editSummary.trim() || parseInt(editCount, 10) <= 0}
                      aria-label={requiredLocalized(l10n, 'kds-edit-save-aria')}
                    >
                      <Localized id="kds-edit-save">Save</Localized>
                    </button>
                    <button
                      className="kds-ticket-edit-cancel"
                      onClick={handleCancelEdit}
                      aria-label={requiredLocalized(l10n, 'kds-edit-cancel-aria')}
                    >
                      <Localized id="kds-edit-cancel">Cancel</Localized>
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="kds-footer-actions">
              {!editing && canAdvance && nextKey && (
                <button
                  className="kds-status-btn"
                  style={{
                    // Ready orders get the green complete colour; anything
                    // still in progress stays amber (processing).
                    background: order.status === 'ready' ? colors.complete : colors.processing,
                    color: contrastText(order.status === 'ready' ? colors.complete : colors.processing),
                  }}
                  onClick={handleAdvance}
                  aria-label={`${advanceLabel} ${order.display_number ?? ''}`.trim()}
                  data-testid={`kds-order-card-${order.display_number ?? order.id}-status-advance`}
                >
                  {advanceLabel}
                </button>
              )}
              {onSaveItems && !editing && (
                <button
                  className="kds-ticket-edit-btn"
                  onClick={startEditing}
                  aria-label={requiredLocalized(l10n, 'kds-edit-items-btn-aria')}
                  data-testid={`kds-order-card-${order.display_number ?? order.id}-edit-items`}
                >
                  <Localized id="kds-edit-items-btn">Edit Items</Localized>
                </button>
              )}
              {onAddItems && !editing && (
                <button
                  className="kds-ticket-add-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddItems(order.id);
                  }}
                  aria-label={requiredLocalized(l10n, 'kds-add-items-btn-aria')}
                  data-testid={`kds-order-card-${order.display_number ?? order.id}-add-items`}
                >
                  <Localized id="kds-add-items-btn">Add Items</Localized>
                </button>
              )}
            </div>

            <span className="kds-ticket-count">
              <Localized id="kds-items" vars={{ count: order.item_count }}>
                {`${order.item_count} items`}
              </Localized>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});
