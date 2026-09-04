// Unit tests for KDS status advance logic — documents the
// STATUS_ORDER progression and boundary conditions used by
// advanceStatus and advanceItemStatus in KdsScreen.tsx.

import { describe, it, expect } from 'vitest';

const STATUS_ORDER = ['pending', 'preparing', 'ready', 'served'] as const;
type Status = (typeof STATUS_ORDER)[number];

/** Pure next-status resolver — same logic as advanceStatus in KdsScreen. */
function nextStatus(current: string): Status | null {
  const idx = STATUS_ORDER.indexOf(current as Status);
  if (idx < 0 || idx >= STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1]!;
}

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
});
