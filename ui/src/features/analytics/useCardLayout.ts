import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalyticsCard } from './AnalyticsScreen';
import type { WorkspaceView } from './utils/dateRangePresets';

/**
 * Card ordering and collapse state for the analytics dashboard — extracted
 * from `AnalyticsScreen.tsx` (Phase 2 split). Owns the per-workspace card
 * order (persisted to localStorage), per-card collapse state, and the
 * reorder/move/collapse/reset actions.
 */
export function useCardLayout(
  workspaceView: WorkspaceView,
  cardId: (c: AnalyticsCard) => string,
  cards: AnalyticsCard[],
  showToast: (msg: string) => void,
  toastLayoutSaved: string,
  toastLayoutReset: string,
) {
  const [cardOrder, setCardOrder] = useState<string[]>([]);
  const [collapsedCards, setCollapsedCards] = useState<Set<string>>(new Set());

  const orderStorageKey = useMemo(() => `oz-analytics-card-order-${workspaceView}`, [workspaceView]);
  const defaultOrder = useMemo(() => cards.map(cardId), [cards, cardId]);

  // Load the saved card order per workspace; merge any new cards at the end
  useEffect(() => {
    let order = defaultOrder;
    try {
      const saved = localStorage.getItem(orderStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        const known = new Set(defaultOrder);
        const filtered = parsed.filter((id) => known.has(id));
        order = [...filtered, ...defaultOrder.filter((id) => !filtered.includes(id))];
      }
    } catch {
      /* corrupt storage — fall back to default order */
    }
    setCardOrder(order);
  }, [workspaceView, defaultOrder, orderStorageKey]);

  const persistOrder = useCallback(
    (order: string[]) => {
      setCardOrder(order);
      try {
        localStorage.setItem(orderStorageKey, JSON.stringify(order));
      } catch {
        /* storage unavailable — keep in-memory order */
      }
    },
    [orderStorageKey],
  );

  const reorderCard = useCallback(
    (from: string, to: string) => {
      if (from === to) return;
      const order = [...cardOrder];
      const i = order.indexOf(from);
      const j = order.indexOf(to);
      if (i < 0 || j < 0) return;
      order.splice(i, 1);
      order.splice(j, 0, from);
      persistOrder(order);
      showToast(toastLayoutSaved);
    },
    [cardOrder, persistOrder, showToast, toastLayoutSaved],
  );

  const moveCard = useCallback(
    (id: string, dir: 'up' | 'down' | 'top' | 'bottom') => {
      const order = [...cardOrder];
      const i = order.indexOf(id);
      if (i < 0) return;
      if (dir === 'up' && i > 0) {
        order.splice(i, 1);
        order.splice(i - 1, 0, id);
      } else if (dir === 'down' && i < order.length - 1) {
        order.splice(i, 1);
        order.splice(i + 1, 0, id);
      } else if (dir === 'top' && i > 0) {
        order.splice(i, 1);
        order.unshift(id);
      } else if (dir === 'bottom' && i < order.length - 1) {
        order.splice(i, 1);
        order.push(id);
      } else {
        return;
      }
      persistOrder(order);
      showToast(toastLayoutSaved);
    },
    [cardOrder, persistOrder, showToast, toastLayoutSaved],
  );

  const toggleCardCollapsed = useCallback((id: string) => {
    setCollapsedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => {
    try {
      localStorage.removeItem(orderStorageKey);
    } catch {
      /* storage unavailable */
    }
    setCardOrder(defaultOrder);
    showToast(toastLayoutReset);
  }, [orderStorageKey, defaultOrder, showToast, toastLayoutReset]);

  const isDefaultOrder = JSON.stringify(cardOrder) === JSON.stringify(defaultOrder);

  return {
    cardOrder,
    defaultOrder,
    collapsedCards,
    toggleCardCollapsed,
    reorderCard,
    moveCard,
    resetLayout,
    isDefaultOrder,
  };
}