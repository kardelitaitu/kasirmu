// Unit tests for the KDS status advance ladder — STATUS_ORDER progression and the
// boundary conditions behind advanceStatus / advanceItemStatus in KdsScreen.tsx.
//
// This suite used to declare its own STATUS_ORDER array and its own nextStatus()
// ("same logic as advanceStatus in KdsScreen"), so it tested a copy: deleting the
// production progression left all nine tests green, and the copy had already drifted in
// spirit from KdsTicketCard.tsx, which expressed the same rule a third way. Both now
// import from kdsStatus.ts, so these assertions are about the shipped code.

import { describe, it, expect } from 'vitest';
import { STATUS_ORDER, nextKdsStatus, canAdvanceKdsStatus } from '@/features/kds/kdsStatus';

const nextStatus = nextKdsStatus;

describe('nextStatus', () => {
  it('pending → preparing', () => {
    expect(nextStatus('pending')).toBe('preparing');
  });

  it('preparing → ready', () => {
    expect(nextStatus('preparing')).toBe('ready');
  });

  it('ready → served', () => {
    expect(nextStatus('ready')).toBe('served');
  });

  it('served → null (terminal status)', () => {
    expect(nextStatus('served')).toBeNull();
  });

  it('unknown status → null', () => {
    expect(nextStatus('cancelled')).toBeNull();
    expect(nextStatus('')).toBeNull();
    expect(nextStatus('random')).toBeNull();
  });

  it('STATUS_ORDER has exactly 4 steps', () => {
    expect(STATUS_ORDER).toHaveLength(4);
  });

  it('STATUS_ORDER starts with pending and ends with served', () => {
    expect(STATUS_ORDER[0]).toBe('pending');
    expect(STATUS_ORDER[STATUS_ORDER.length - 1]).toBe('served');
  });

  it('STATUS_ORDER is in ascending progression order', () => {
    for (let i = 0; i < STATUS_ORDER.length - 1; i++) {
      expect(nextStatus(STATUS_ORDER[i]!)).toBe(STATUS_ORDER[i + 1]);
    }
  });

  it('all statuses produce a valid next except served', () => {
    for (const s of STATUS_ORDER) {
      if (s === 'served') {
        expect(nextStatus(s)).toBeNull();
      } else {
        expect(nextStatus(s)).not.toBeNull();
        expect(STATUS_ORDER).toContain(nextStatus(s));
      }
    }
  });

  // 'cancelled' is a valid KdsStatus but not a rung on the ladder. The old local copy and
  // KdsTicketCard's inline `indexOf(...) < length - 1` disagreed about it: indexOf returns
  // -1, so -1 < 3 made the card's canAdvance TRUE for a cancelled ticket while nextStatus
  // said null. KdsScreen filters cancelled out before rendering, so nothing was visibly
  // wrong -- but the two expressions of one rule could not both be right.
  it('treats cancelled as terminal, the same way the card does', () => {
    expect(nextStatus('cancelled')).toBeNull();
    expect(canAdvanceKdsStatus('cancelled')).toBe(false);
  });

  it('canAdvanceKdsStatus agrees with nextKdsStatus on every rung', () => {
    for (const s of [...STATUS_ORDER, 'cancelled', 'nonsense', '']) {
      expect(canAdvanceKdsStatus(s)).toBe(nextStatus(s) !== null);
    }
  });

  it('served is the only terminal rung of the ladder itself', () => {
    expect(canAdvanceKdsStatus('served')).toBe(false);
    for (const s of STATUS_ORDER.slice(0, -1)) {
      expect(canAdvanceKdsStatus(s)).toBe(true);
    }
  });
});
