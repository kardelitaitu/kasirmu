import { useState, useEffect, useRef } from 'react';

// ── Types ─────────────────────────────────────────────────────────────

/** SLA threshold level for a KDS ticket (P3-1 progressive escalation). */
export type SlaLevel = 'green' | 'yellow' | 'red';

/** Per-board SLA thresholds in seconds (wired from the settings panel). */
export interface SlaThresholds {
  /** Elapsed seconds at which a ticket turns yellow. */
  yellowAtSec: number;
  /** Elapsed seconds at which a ticket turns red. */
  redAtSec: number;
}

/** Defaults match the settings-panel defaults (5 min / 10 min). */
export const DEFAULT_SLA_THRESHOLDS: SlaThresholds = {
  yellowAtSec: 300,
  redAtSec: 600,
};

/** Return type of useTicketSla. */
export interface TicketSlaResult {
  /** Elapsed seconds since the ticket was received. */
  elapsedSeconds: number;
  /** SLA threshold level. */
  level: SlaLevel;
  /** True when the ticket is ≥15 min overdue (red background + urgent badge). */
  urgent: boolean;
  /** Human-readable elapsed time string (e.g. "5m 30s"). */
  display: string;
}

// ── Constants ─────────────────────────────────────────────────────────

/** Red-urgent threshold: ≥ 900 seconds (15 minutes). Adds bg + badge. */
const RED_URGENT = 900;

/** Tick interval in milliseconds (every second). */
const TICK_MS = 1000;

// ── Shared 1 Hz ticker ────────────────────────────────────────────────
//
// PERF-KDS-01: every ticket card runs this hook, and each one used to own
// its own `setInterval`. A 30-ticket board therefore woke 30 independent
// timers per second, each re-rendering one card — on WebView2 that render
// storm helped saturate the PostMessage queue. One process-wide interval now
// fans out to every subscriber, so the cost is O(1) timers instead of O(n).

type Ticker = () => void;

const tickerSubscribers = new Set<Ticker>();
let tickerHandle: ReturnType<typeof setInterval> | null = null;

/** Subscribe to the shared 1 Hz tick. Returns an unsubscribe function. */
function subscribeToTicker(fn: Ticker): () => void {
  tickerSubscribers.add(fn);
  if (tickerHandle === null) {
    tickerHandle = setInterval(() => {
      // Copy first: a subscriber may unsubscribe during the fan-out.
      for (const sub of [...tickerSubscribers]) sub();
    }, TICK_MS);
  }
  return () => {
    tickerSubscribers.delete(fn);
    if (tickerSubscribers.size === 0 && tickerHandle !== null) {
      clearInterval(tickerHandle);
      tickerHandle = null;
    }
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Compute the SLA level from elapsed seconds (P3-1 progressive thresholds). */
export function computeLevel(elapsed: number, t: SlaThresholds): SlaLevel {
  if (elapsed < t.yellowAtSec) return 'green';
  if (elapsed < t.redAtSec) return 'yellow';
  return 'red';
}

/** Format elapsed seconds into a short display string like "5m 30s". */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

// ── Hook ──────────────────────────────────────────────────────────────

/**
 * `useTicketSla` — computes elapsed seconds and returns an SLA
 * threshold level for a KDS ticket given its `created_at` ISO-8601
 * timestamp.
 *
 * Progressive escalation thresholds (P3-1) come from the `thresholds`
 * argument — wired from the settings panel's yellow/red sliders
 * (defaults: 5 min yellow / 10 min red) so operators can retune the
 * board without a code change:
 * - **Green**:     below `yellowAtSec` — on time
 * - **Yellow**:    `yellowAtSec`–`redAtSec` — amber border + pulse
 * - **Red**:       `redAtSec`+ — red border + shake animation
 * - **Red urgent**: ≥ 15 min (≥ 900 s, `urgent: true`) — red bg + badge
 *
 * The `urgent` flag indicates the ticket has exceeded the 15-minute
 * threshold and needs urgent visual escalation (red background + badge).
 *
 * Updates every second via a single process-wide ticker shared by every
 * ticket card. Automatically unsubscribes on unmount or when `createdAt`
 * changes; the underlying interval is cleared once the last card unmounts.
 */
export function useTicketSla(
  createdAt: string,
  thresholds: SlaThresholds = DEFAULT_SLA_THRESHOLDS,
): TicketSlaResult {
  // Clamp so the state machine stays monotonic: yellow must precede red.
  const t: SlaThresholds = {
    yellowAtSec: Math.max(30, Math.min(thresholds.yellowAtSec, RED_URGENT - 60)),
    redAtSec: Math.max(60, Math.min(thresholds.redAtSec, RED_URGENT)),
  };

  // Store the parsed epoch in a ref so we don't re-parse on every tick.
  const createdAtMs = useRef(Date.now());

  // Update the ref whenever createdAt changes.
  if (createdAt) {
    createdAtMs.current = new Date(createdAt).getTime();
  }

  const thresholdsRef = useRef(t);
  thresholdsRef.current = t;

  const compute = (): TicketSlaResult => {
    const elapsed = Math.max(0, Math.floor((Date.now() - createdAtMs.current) / 1000));
    const level = computeLevel(elapsed, thresholdsRef.current);
    const urgent = elapsed >= RED_URGENT;
    return { elapsedSeconds: elapsed, level, urgent, display: formatElapsed(elapsed) };
  };

  const [result, setResult] = useState<TicketSlaResult>(compute);

  useEffect(() => {
    // Recompute immediately if createdAt changes.
    setResult(compute());

    // PERF-KDS-01: only re-render when a displayed field actually changes.
    // At 1 Hz the elapsed second always moves, but the object identity is
    // what React diffs — returning `prev` for an unchanged second keeps a
    // paused/settled board quiet.
    return subscribeToTicker(() => {
      setResult((prev) => {
        const next = compute();
        return next.elapsedSeconds === prev.elapsedSeconds &&
          next.level === prev.level &&
          next.urgent === prev.urgent
          ? prev
          : next;
      });
    });

  }, [createdAt]);

  return result;
}
