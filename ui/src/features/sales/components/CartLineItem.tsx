/* eslint-disable jsx-a11y/no-noninteractive-tabindex */
import { useCallback, useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import {
  formatMoney,
  COURSES,
  courseEmoji,
  courseLabel,
  type CartLine,
  type CourseId,
  type LineId,
} from '@/types/domain';
import { animDuration } from '@/utils/animation';
import { triggerInteraction } from '@/utils/interaction';
import { useSwipe } from '@/hooks/useSwipe';
import { lineThumbnail } from '../utils/cartCalculations';

// ── Swipeable cart line item ──────────────────────────────────────────

/** Minus icon SVG */
function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Plus icon SVG */
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Note / Pencil icon SVG */
function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

export interface CartLineItemProps {
  line: CartLine;
  onRemove: (line: CartLine) => void;
  onDecreaseQty: (line: CartLine) => void;
  onIncreaseQty: (line: CartLine) => void;
  onOverride?: (line: CartLine) => void;
  /**
   * Update or remove the kitchen / special instruction note for this line.
   */
  onUpdateNote?: ((lineId: LineId, note: string) => void) | undefined;
  /**
   * Assign a course to this line (restaurant coursing).
   *
   * When omitted the course chip is not rendered at all, so the retail path
   * and every unit test that does not care about coursing are unaffected.
   */
  onAssignCourse?: (lineId: LineId, courseId: CourseId) => void;
  /**
   * Edit modifiers for this line item.
   */
  onEditModifiers?: ((line: CartLine) => void) | undefined;
  /**
   * Id of the line whose course dropdown is open. Held by the panel rather
   * than per line so only one dropdown can be open at a time.
   */
  courseMenuLine?: LineId | null;
  onCourseMenuLineChange?: (lineId: LineId | null) => void;
  /**
   * Registers the line DOM node so the parent can move focus during
   * keyboard navigation (↑ / ↓). When omitted the line is rendered
   * focusless (e.g. in unit-test environments that don't render a DOM).
   */
  registerRef?: (lineId: LineId, el: HTMLDivElement | null) => void;
}

export function CartLineItem({
  line,
  onRemove,
  onDecreaseQty,
  onIncreaseQty,
  onOverride,
  onUpdateNote,
  onAssignCourse,
  onEditModifiers,
  courseMenuLine = null,
  onCourseMenuLineChange,
  registerRef,
}: CartLineItemProps) {
  const { l10n } = useLocalization();
  const [revealed, setRevealed] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [qtyFlash, setQtyFlash] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const openNoteEditor = useCallback(() => {
    setNoteDraft(line.note ?? '');
    setShowNoteModal(true);
  }, [line.note]);
  const prevQty = useRef(line.qty);
  const swipe = useSwipe({
    onSwipeLeft: () => setRevealed(true),
    onSwipeRight: () => setRevealed(false),
  });
  // Compute once per render.
  const thumbnail = lineThumbnail(String(line.sku));
  // Only meaningful when the caller passed onAssignCourse; the chip renders
  // on that condition too, so a line without coursing never reaches here.
  const courseOpen = !!onAssignCourse && courseMenuLine === line.id;

  const MS_200 = animDuration(200);

  // When exit animation starts, remove the line after it completes.
  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => onRemove(line), MS_200);
    return () => clearTimeout(timer);
  }, [exiting, onRemove, line, MS_200]);

  // Flash + click on qty change.
  useEffect(() => {
    if (prevQty.current !== line.qty) {
      prevQty.current = line.qty;
      setQtyFlash(true);
      triggerInteraction('qty-change');
      const timer = setTimeout(() => setQtyFlash(false), 350);
      return () => clearTimeout(timer);
    }
  }, [line.qty]);

  const handleRemove = useCallback(() => {
    setExiting(true);
    setRevealed(false);
    triggerInteraction('remove-item');
  }, []);

  return (
    <div
      className={`pos-cart-line-wrap ${revealed ? 'pos-cart-line-wrap--revealed' : ''} ${exiting ? 'pos-cart-line-wrap--exiting' : ''} ${qtyFlash ? 'pos-cart-line-wrap--qty-flash' : ''}`}
      {...swipe}
    >
      <div
        className="pos-cart-line"
        ref={(el) => registerRef?.(line.id, el)}
        tabIndex={0}
        data-line-id={line.id}
        data-testid="cart-panel-line-item"
        role="group"
        aria-label={l10n.getString('pos-cart-line-aria', { sku: String(line.sku), qty: String(line.qty), amount: formatMoney(line.unit_price) })}
      >
        {/* 1 — Thumbnail */}
        <span
          className="pos-cart-line-thumb"
          style={{ '--thumb-hue': thumbnail.hue } as CSSProperties}
          aria-hidden="true"
        >
          {thumbnail.initial}
        </span>

        {/* 2 — Name + price */}
        <div className="pos-cart-line-info">
          <div className="pos-cart-line-name">
            {line.name ?? line.sku}
            {onUpdateNote && (
              <button
                type="button"
                className={`pos-cart-line-note-btn${line.note ? ' pos-cart-line-note-btn--active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  openNoteEditor();
                }}
                aria-label={line.note ? `${l10n.getString('pos-cart-line-edit-note') || 'Edit Note'}: ${line.note}` : (l10n.getString('pos-cart-line-add-note') || 'Add Note')}
                data-testid="cart-line-note-btn"
              >
                <NoteIcon />
              </button>
            )}
            {onAssignCourse && (
              <span className="pos-cart-line-course">
                <button
                  type="button"
                  className={`pos-cart-course-chip${line.courseId ? ' pos-cart-course-chip--set' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCourseMenuLineChange?.(courseOpen ? null : line.id);
                  }}
                  aria-label={l10n.getString('retail-cart-course-aria', { name: line.name ?? line.sku })}
                  aria-expanded={courseOpen}
                  data-testid="cart-line-course-chip"
                >
                  {line.courseId ? `${courseEmoji(line.courseId)} ${courseLabel(line.courseId)}` : 'Course'}
                </button>
                {courseOpen && (
                  <span
                    className="pos-cart-course-dropdown"
                    role="listbox"
                    aria-label={l10n.getString('select-course-aria')}
                    data-testid="cart-line-course-dropdown"
                  >
                    <button
                      type="button"
                      className={`pos-cart-course-option${!line.courseId ? ' pos-cart-course-option--active' : ''}`}
                      role="option"
                      aria-selected={!line.courseId}
                      data-testid="cart-line-course-option-none"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAssignCourse(line.id, '');
                        onCourseMenuLineChange?.(null);
                      }}
                    >
                      <Localized id="retail-course-none">
                        <span>None</span>
                      </Localized>
                    </button>
                    {COURSES.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`pos-cart-course-option${line.courseId === c.id ? ' pos-cart-course-option--active' : ''}`}
                        role="option"
                        aria-selected={line.courseId === c.id}
                        data-testid={`cart-line-course-option-${c.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAssignCourse(line.id, c.id);
                          onCourseMenuLineChange?.(null);
                        }}
                      >
                        {c.emoji} {c.label}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            )}
          </div>
          {line.modifiers && line.modifiers.length > 0 && (
            <div className="pos-cart-line-modifiers" data-testid="cart-line-modifiers">
              {line.modifiers.map((m) => (
                <span key={`${m.groupId}-${m.modifierId}`} className="pos-cart-line-modifier-tag">
                  {m.modifierName}
                  {m.priceMinor > 0 && (
                    <span className="pos-cart-line-modifier-price">
                      {' '}(+{formatMoney({ minor_units: m.priceMinor, currency: line.unit_price.currency })})
                    </span>
                  )}
                </span>
              ))}
              {onEditModifiers && (
                <button
                  type="button"
                  className="pos-cart-line-edit-modifiers-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditModifiers(line);
                  }}
                  aria-label={l10n.getString('edit-modifiers') || 'Edit Modifiers'}
                  data-testid="cart-line-edit-modifiers-btn"
                >
                  Edit
                </button>
              )}
            </div>
          )}
          {line.note && (
            <div
              className="pos-cart-line-note-badge"
              data-testid="cart-line-note"
              onClick={(e) => {
                e.stopPropagation();
                openNoteEditor();
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  openNoteEditor();
                }
              }}
              aria-label={line.note}
            >
              <span className="pos-cart-line-note-icon" aria-hidden="true">📝</span>
              <span className="pos-cart-line-note-text">{line.note}</span>
            </div>
          )}
          <div className="pos-cart-line-price">
            <span className="pos-cart-line-price-at">@</span> {formatMoney(line.unit_price)}
          </div>
          {onOverride && (
            <button
              type="button"
              className="pos-cart-line-override"
              onClick={() => onOverride(line)}
              aria-label={l10n.getString('pos-cart-line-override-aria', { name: line.name ?? line.sku }, 'Override price')}
            >
              <Localized id="pos-cart-line-override">Override</Localized>
            </button>
          )}
        </div>

        {/* 3 — Qty controls */}
        <div className="pos-cart-line-controls">
          <button
            type="button"
            className="pos-cart-qty-btn"
            onClick={() => onDecreaseQty(line)}
            disabled={line.qty <= 1}
            aria-label={l10n.getString('pos-cart-line-decrease-aria', { sku: String(line.sku) })}
          >
            <MinusIcon />
          </button>
          <span className="pos-cart-qty-value" aria-label={l10n.getString('pos-cart-line-qty-aria', { qty: String(line.qty) })}>
            {line.qty}
          </span>
          <button
            type="button"
            className="pos-cart-qty-btn"
            onClick={() => onIncreaseQty(line)}
            aria-label={l10n.getString('pos-cart-line-increase-aria', { sku: String(line.sku) })}
          >
            <PlusIcon />
          </button>
        </div>

        {/* 4 — Remove button */}
        <button
          type="button"
          className="pos-cart-line-remove"
          onClick={handleRemove}
          aria-label={l10n.getString('pos-cart-line-remove-aria', { sku: String(line.sku) })}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Category ribbon */}
        {line.category && (
          <span
            className="pos-cart-line-ribbon"
            style={{ '--thumb-hue': thumbnail.hue } as CSSProperties}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Revealed swipe action */}
      <div className="pos-cart-line-swipe-action" aria-hidden={!revealed}>
        <button
          type="button"
          className="pos-cart-line-swipe-remove"
          onClick={handleRemove}
          aria-label={l10n.getString('pos-cart-line-swipe-remove-aria', { sku: String(line.sku) })}
        >
          <Localized id="pos-cart-remove">
            <span>Remove</span>
          </Localized>
        </button>
      </div>

      {/* Note editor modal */}
      {showNoteModal && (
        <Modal
          open={showNoteModal}
          onClose={() => setShowNoteModal(false)}
          title={l10n.getString('pos-cart-line-note-title') || 'Special Request'}
          className="pos-cart-line-note-modal"
          footer={
            <div className="pos-cart-note-modal-actions">
              {line.note && (
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    onUpdateNote?.(line.id, '');
                    setShowNoteModal(false);
                  }}
                  data-testid="cart-line-note-clear-btn"
                >
                  <Localized id="pos-cart-line-note-clear">
                    <span>Clear</span>
                  </Localized>
                </Button>
              )}
              <Button
                variant="ghost"
                size="md"
                onClick={() => setShowNoteModal(false)}
              >
                <Localized id="cancel">
                  <span>Cancel</span>
                </Localized>
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  onUpdateNote?.(line.id, noteDraft);
                  setShowNoteModal(false);
                }}
                data-testid="cart-line-note-save-btn"
              >
                <Localized id="save">
                  <span>Save</span>
                </Localized>
              </Button>
            </div>
          }
        >
          <div className="pos-cart-note-modal-body">
            <p className="pos-cart-note-modal-item-name">{line.name ?? line.sku}</p>
            <textarea
              className="pos-cart-note-input"
              rows={3}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder={l10n.getString('pos-cart-line-note-placeholder') || 'e.g. No onion, less ice, allergy...'}
              data-testid="cart-line-note-input"
              maxLength={200}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
