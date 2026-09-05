import { describe, it, expect } from 'vitest';
import {
  addStationToList,
  secondsUntilExpiry,
  shouldFireOnEnrolledOnDone,
} from '@/features/kds/components/KdsEnrollmentModal';
import type { KdsDevice } from '@/api/kds';

describe('addStationToList', () => {
  it('appends a new trimmed station', () => {
    expect(addStationToList(['Front Bar'], 'Kitchen')).toEqual(['Front Bar', 'Kitchen']);
  });

  it('trims surrounding whitespace', () => {
    expect(addStationToList(['A'], '  Bar  ')).toEqual(['A', 'Bar']);
  });

  it('rejects empty / whitespace-only input', () => {
    expect(addStationToList(['A'], '')).toEqual(['A']);
    expect(addStationToList(['A'], '   ')).toEqual(['A']);
  });

  it('rejects a duplicate (case-sensitive)', () => {
    expect(addStationToList(['Kitchen'], 'Kitchen')).toEqual(['Kitchen']);
    expect(addStationToList(['Kitchen'], 'kitchen')).toEqual(['Kitchen', 'kitchen']);
  });

  it('rejects a duplicate that only differs by trailing whitespace', () => {
    expect(addStationToList(['Bar'], 'Bar  ')).toEqual(['Bar']);
  });

  it('returns the same array reference when unchanged', () => {
    const input = ['A'];
    expect(addStationToList(input, '  ')).toBe(input);
  });

  it('handles an empty initial list', () => {
    expect(addStationToList([], 'First')).toEqual(['First']);
  });
});

describe('secondsUntilExpiry', () => {
  it('returns remaining seconds for a future expiry', () => {
    const future = new Date(Date.now() + 90_000).toISOString(); // 90s from now
    expect(secondsUntilExpiry(future, Date.now())).toBe(90);
  });

  it('returns 0 when expired', () => {
    const past = new Date(Date.now() - 60_000).toISOString(); // 60s ago
    expect(secondsUntilExpiry(past, Date.now())).toBe(0);
  });

  it('clamps to 0 when now is in the far future', () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const wayLater = Date.now() + 10 * 60 * 1000;
    expect(secondsUntilExpiry(future, wayLater)).toBe(0);
  });

  it('uses the current time when now is omitted (Date.now path)', () => {
    const now = Date.now();
    const future = new Date(now + 30_000).toISOString();
    // Default-now path — Date.now drives the result; we pin by constructing the ISO string from a known instant captured above.
    expect(secondsUntilExpiry(future)).toBe(30);
  });

  it('handles sub-second remainders via floor', () => {
    const future = new Date(Date.now() + 1500).toISOString();
    // now sits 1499ms after the start of the second
    const now = Date.now() + 1;
    expect(secondsUntilExpiry(future, now)).toBe(1);
  });
});

describe('shouldFireOnEnrolledOnDone', () => {
  const device: KdsDevice = {
    id: 'dev-1',
    name: 'KDS-1',
    restaurant_pos_id: 'pos-1',
    station_ids: ['Front Bar'],
    is_active: true,
    last_seen_at: null,
    connection_status: 'connected',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('fires when on the QR step with a device', () => {
    expect(shouldFireOnEnrolledOnDone('qr', device)).toBe(true);
  });

  it('does not fire on the form step', () => {
    expect(shouldFireOnEnrolledOnDone('form', device)).toBe(false);
  });

  it('does not fire on the generating step', () => {
    expect(shouldFireOnEnrolledOnDone('generating', device)).toBe(false);
  });

  it('does not fire on the error step even with a device', () => {
    expect(shouldFireOnEnrolledOnDone('error', device)).toBe(false);
  });

  it('does not fire when there is no enrolled device (QR step)', () => {
    expect(shouldFireOnEnrolledOnDone('qr', null)).toBe(false);
  });

  it('does not fire when the device is null on the error step', () => {
    expect(shouldFireOnEnrolledOnDone('error', null)).toBe(false);
  });

  it('does not fire on an unknown step', () => {
    expect(shouldFireOnEnrolledOnDone('unknown' as any, device)).toBe(false);
  });
});
