import { useEffect, useRef, useState, useCallback } from 'react';
import {
  listDisplaysScoped,
  displayShowScoped,
  displayClearScoped,
} from '@/api/hardware';
import { formatMoney } from '@/types/domain';
import type { Money } from '@/types/domain';

/**
 * React hook that syncs cart state to a customer-facing pole display
 * (CD5220 / Emax serial display).
 *
 * - **Items in cart** → shows total and item count on two 20-char lines.
 * - **Cart empty**   → clears the display.
 * - Auto-detects the first registered display on mount.
 *
 * @example
 * ```tsx
 * useCustomerDisplay({ sessionToken, lines: cartLines, total });
 * ```
 */
export function useCustomerDisplay({
  sessionToken,
  lines,
  total,
  onPaymentComplete,
}: {
  /** Session token for scoped API calls. */
  sessionToken: string;
  lines: { qty: number }[];
  total: Money | null;
  onPaymentComplete?: () => void;
}) {
  const [displayId, setDisplayId] = useState<string | null>(null);
  const displayIdRef = useRef<string | null>(null);
  const lastContentRef = useRef<string>('');
  const enabledRef = useRef(false);

  // ── Auto-detect display on mount ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!sessionToken) return;

    (async () => {
      try {
        const ids = await listDisplaysScoped(sessionToken);
        if (!cancelled && ids.length > 0) {
          const id = ids[0]!;
          setDisplayId(id);
          displayIdRef.current = id;
          enabledRef.current = true;
        }
      } catch {
        // No display registered — silently no-op.
      }
    })();

    return () => {
      cancelled = true;
      enabledRef.current = false;
    };
  }, [sessionToken]);

  // ── Update display when cart state changes ──────────────────
  useEffect(() => {
    const dId = displayIdRef.current;
    if (!dId) return;

    const itemCount = lines.reduce((acc, l) => acc + l.qty, 0);

    if (itemCount === 0 || !total) {
      // Cart is empty — clear the display.
      displayClearScoped(sessionToken, dId).catch(() => {
        // Display hardware may be disconnected — best-effort.
      });
      lastContentRef.current = '';
      return;
    }

    // Build the two 20-char lines for the pole display.
    const totalStr = formatMoney(total);
    // Line 1: "TOTAL  $12.50" → pad/truncate to 20 chars
    const line1 = padCenter(totalStr, 20);
    // Line 2: "3 items" → pad/truncate to 20 chars
    const itemWord = itemCount === 1 ? 'item' : 'items';
    const line2 = padCenter(`${itemCount} ${itemWord}`, 20);

    const content = `${line1}|${line2}`;
    if (content === lastContentRef.current) return; // skip redundant updates

    displayShowScoped(sessionToken, { displayId: dId, line1, line2 }).catch(() => {
      // Display hardware may be disconnected — best-effort.
    });
    lastContentRef.current = content;
  }, [lines, total, sessionToken]);

  // ── On payment complete, clear the display ──────────────────
  const handlePaymentComplete = useCallback(() => {
    const dId = displayIdRef.current;
    if (!dId) return;
    displayClearScoped(sessionToken, dId).catch(() => {
      // Display hardware may be disconnected — best-effort.
    });
    lastContentRef.current = '';
    onPaymentComplete?.();
  }, [onPaymentComplete, sessionToken]);

  return { displayId, handlePaymentComplete };
}

/** Pad a short string to a fixed width with spaces on both sides. */
function padCenter(text: string, width: number): string {
  if (text.length >= width) {
    return text.slice(0, width);
  }
  const padTotal = width - text.length;
  const leftPad = Math.floor(padTotal / 2);
  return ' '.repeat(leftPad) + text + ' '.repeat(padTotal - leftPad);
}
