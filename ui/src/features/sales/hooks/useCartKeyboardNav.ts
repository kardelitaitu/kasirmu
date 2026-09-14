import { useCallback } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react';
import type { CartLine, LineId, Money } from '@/types/domain';

export interface UseCartKeyboardNavParams {
  /**
   * The cart-line DOM registry, injected and never allocated here. PosScreen
   * owns the Map because its 'setCartLineRef' callback is passed DOWN to
   * CartPanel at the call site - this hook only reads it.
   */
  cartLineRefs: MutableRefObject<Map<LineId, HTMLDivElement>>;
  lines: CartLine[];
  total: Money | null;
  handlePay: () => void;
  handleIncreaseQty: (line: CartLine) => void;
  handleDecreaseQty: (line: CartLine) => void;
  handleRemoveLine: (line: CartLine) => void;
}

/**
 * Cart keyboard navigation for the POS screen - the arrow / plus / minus /
 * Delete / Enter keys handled on the cart panel itself.
 *
 * The cart panel handles keys when its focus, or any descendant cart line's
 * focus, is active. Inputs, textareas, and content-editable elements are
 * excluded so text-entry UX is preserved.
 *
 * Behaviour only - it never owns a ref. The caller keeps the Map of the
 * registered cart-line div elements and hands it in, so this hook stays out
 * of the DOM-registration plumbing that CartPanel's props carry.
 *
 * Moved verbatim out of PosScreen.tsx: same names, same logic, same handler
 * identity. 'focusLineByIndex' keeps its [lines] dependency plus the injected
 * ref object, whose identity never changes (it is the caller's useRef result),
 * so no memo boundary widens - which is what the keyboard tests pin down.
 */
export function useCartKeyboardNav({
  cartLineRefs,
  lines,
  total,
  handlePay,
  handleIncreaseQty,
  handleDecreaseQty,
  handleRemoveLine,
}: UseCartKeyboardNavParams) {
  const focusLineByIndex = useCallback(
    (idx: number) => {
      if (lines.length === 0) return;
      const clamped = Math.max(0, Math.min(lines.length - 1, idx));
      cartLineRefs.current.get(lines[clamped]!.id)?.focus();
    },
    [lines, cartLineRefs],
  );

  const handleCartPanelKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      const tgt = e.target as HTMLElement;
      if (
        tgt instanceof HTMLInputElement ||
        tgt instanceof HTMLTextAreaElement ||
        tgt.isContentEditable
      ) {
        return;
      }
      // Resolve which cart line emitted the key (allow bubble from a
      // child button inside the line - the line has data-line-id).
      const lineEl = tgt.closest('[data-line-id]') as HTMLElement | null;
      const focusedLineId = lineEl?.dataset['lineId'] as LineId | undefined;
      const focusedIdx = focusedLineId
        ? lines.findIndex((l) => l.id === focusedLineId)
        : -1;

      switch (e.key) {
        case 'ArrowDown':
          if (lines.length === 0) return;
          e.preventDefault();
          focusLineByIndex(focusedIdx < 0 ? 0 : focusedIdx + 1);
          return;
        case 'ArrowUp':
          if (lines.length === 0) return;
          e.preventDefault();
          focusLineByIndex(focusedIdx < 0 ? lines.length - 1 : focusedIdx - 1);
          return;
        case '+':
        case '=':
          if (focusedLineId == null) return;
          {
            const l = lines.find((x) => x.id === focusedLineId);
            if (!l) return;
            e.preventDefault();
            handleIncreaseQty(l);
          }
          return;
        case '-':
        case '_':
          if (focusedLineId == null) return;
          {
            const l = lines.find((x) => x.id === focusedLineId);
            if (!l) return;
            e.preventDefault();
            handleDecreaseQty(l);
          }
          return;
        case 'Delete':
        case 'Backspace':
          if (focusedLineId == null) return;
          {
            const l = lines.find((x) => x.id === focusedLineId);
            if (!l) return;
            e.preventDefault();
            handleRemoveLine(l);
          }
          return;
        case 'Enter':
          if (!total) return;
          e.preventDefault();
          handlePay();
          return;
      }
    },
    [
      lines,
      total,
      handlePay,
      handleIncreaseQty,
      handleDecreaseQty,
      handleRemoveLine,
      focusLineByIndex,
    ],
  );

  return { focusLineByIndex, handleCartPanelKeyDown };
}
