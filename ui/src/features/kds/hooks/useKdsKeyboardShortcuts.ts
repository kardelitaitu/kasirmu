/**
 * useKdsShortcuts — the KDS board's keyboard cluster: the deselect-on-filter
 * effect, the `kdsRef` / `selectedRef` pair, the autofocus-on-mount effect, and
 * the document-level `keydown` handler (KEY-07) with its editable-target and
 * modal-open guards.
 *
 * Extracted verbatim from KdsScreen.tsx:406-411 (deselect), :413-421 (refs +
 * autofocus) and :423-470 (the KEY-07 listener). The handler body is the sed
 * output: no key, no branch, no precedence and no `preventDefault()` call was
 * retyped, and the declaration order of the three effects (deselect → focus →
 * keydown) is unchanged, so they still run at the same point in the screen's
 * effect sequence. Every listener is added and removed by the same effect, and
 * the autofocus effect still has an empty dependency list — it fires once per
 * mount, so the document `keydown` listener can only ever be registered once
 * per mount and is always torn down by the cleanup on unmount.
 *
 * WHAT MOVES AND WHAT DOES NOT: the two REFS move here — `selectedRef` is read
 * only by this handler — but `kdsRef` is handed back out, because the markup
 * that binds it (`ref=` on the board region) stayed in the screen. The
 * selection STATE (`selectedOrderId`) stays page-level by the same ruling that
 * kept the filter state in the screen: `KdsLayoutProps.selectedOrderId` is read
 * in the render, so moving the state would widen this seam rather than narrow
 * it. The hook receives the value and its setter only.
 *
 * `setSelectedOrderId` is in the deselect effect's dependency array where the
 * original did not need it: while it was a local `useState` result react-hooks
 * could prove it stable, and as a prop it cannot. The call site still passes
 * the raw setter, so this changes identity nothing — it is a lint requirement,
 * not a behavioural change.
 *
 * NO MARKUP, NO STRINGS, NO CLASS NAMES: it is a .ts logic file, so the
 * screen-extraction and native-tooltip guards have nothing to re-register.
 */
import { useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { KdsOrder } from '@/api/kds';
import { isEditableTarget } from '@/utils/isEditableTarget';
import { isAnyAriaModalOpen } from '@/utils/modal-guard';

export interface UseKdsShortcutsOptions {
  /** The board as currently filtered — number keys and arrows index into THIS list. */
  filteredOrders: KdsOrder[];
  /** Currently keyboard-selected order ID (the state itself stays in the screen). */
  selectedOrderId: string | null;
  setSelectedOrderId: Dispatch<SetStateAction<string | null>>;
  /** Advance a ticket one status; Space activates the selected ticket with it. */
  advanceStatus: (order: KdsOrder) => void | Promise<void>;
}

export interface UseKdsShortcutsResult {
  /** The focusable board region; focused on mount so the shortcuts work immediately. */
  kdsRef: RefObject<HTMLDivElement>;
}

export function useKdsShortcuts({
  filteredOrders,
  selectedOrderId,
  setSelectedOrderId,
  advanceStatus,
}: UseKdsShortcutsOptions): UseKdsShortcutsResult {
  const kdsRef = useRef<HTMLDivElement>(null);

  // Deselect if currently selected order is filtered out.
  useEffect(() => {
    if (selectedOrderId && !filteredOrders.some((o) => o.id === selectedOrderId)) {
      setSelectedOrderId(null);
    }
  }, [selectedOrderId, filteredOrders, setSelectedOrderId]);

  // 2d: Keyboard shortcuts — number keys to select, Space to advance, Arrows/Escape to navigate.
  const selectedRef = useRef(selectedOrderId);
  selectedRef.current = selectedOrderId;

  // Auto-focus the container on mount so keyboard shortcuts work immediately.
  useEffect(() => {
    kdsRef.current?.focus();
  }, []);

  // KEY-07: managed screen-level listener with editable + modal guards.
  // Previously the handler was bound to the root element, so shortcuts stopped
  // working whenever focus left the region. Binding to `document` (with guards)
  // keeps 1-9/Arrow/Space/Escape working regardless of where focus lands, and
  // the KDS component unmounting removes the listener.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Guard: never intercept while the user is typing in an editable target.
      if (isEditableTarget(e.target)) return;
      // Guard: never intercept while a modal owns the keyboard.
      if (isAnyAriaModalOpen()) return;

      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        if (idx < filteredOrders.length) {
          setSelectedOrderId(filteredOrders[idx]!.id);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedOrderId((prev) => {
          const currentIdx = prev ? filteredOrders.findIndex((o) => o.id === prev) : -1;
          const nextIdx = Math.min(currentIdx + 1, filteredOrders.length - 1);
          return nextIdx >= 0 ? filteredOrders[nextIdx]!.id : null;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedOrderId((prev) => {
          const currentIdx = prev ? filteredOrders.findIndex((o) => o.id === prev) : filteredOrders.length;
          const nextIdx = Math.max(currentIdx - 1, 0);
          return filteredOrders.length > 0 ? filteredOrders[nextIdx]!.id : null;
        });
      } else if (e.key === ' ' && selectedRef.current) {
        // Skip if a ticket button already has focus (its onClick will handle advance).
        if ((e.target as HTMLElement).closest('.kds-ticket')) return;
        e.preventDefault();
        const selected = filteredOrders.find((o) => o.id === selectedRef.current);
        if (selected) {
          advanceStatus(selected);
        }
      } else if (e.key === 'Escape') {
        setSelectedOrderId(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [filteredOrders, advanceStatus, setSelectedOrderId]);

  return { kdsRef };
}
