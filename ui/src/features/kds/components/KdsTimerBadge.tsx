/**
 * Kds UI — the SLA time readout and URGENT badge of a ticket card header.
 *
 * View-only extraction from `KdsTicketCard.tsx` by the Agent-2 plan's
 * Phase 2.1. The green → yellow → red thresholds are owned by
 * `hooks/useTicketSla.ts` (and the card's audio side-effects), exactly as
 * the plan's baseline correction states — this component renders that
 * hook's output and duplicates no logic.
 */
import { memo } from 'react';
import { Localized } from '@fluent/react';
import type { SlaLevel } from '@/features/kds/hooks/useTicketSla';

export interface KdsTimerBadgeProps {
  /** SLA level from `useTicketSla` — drives the time span's class modifier. */
  level: SlaLevel;
  /** The hook's red-urgent escalation flag (>= 15 min); gates the URGENT badge. */
  urgent: boolean;
  /** The hook's formatted elapsed-time text. */
  display: string;
}

/** The elapsed-time + urgency pair inside the card header's meta cluster. */
export const KdsTimerBadge = memo(function KdsTimerBadge({ level, urgent, display }: KdsTimerBadgeProps) {
  return (
    <>
      <span className={`kds-ticket-time kds-ticket-time--${level}`}>{display}</span>
      {urgent && (
        <span className="kds-ticket-urgent-badge">
          <Localized id="kds-urgent-badge">URGENT</Localized>
        </span>
      )}
    </>
  );
});