import { describe, it, expect, vi } from 'vitest';
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
    // `now` is read ONCE. The previous form called Date.now() twice — once to build the
    // token, once as the argument — and the implementation is Math.floor((expiresAt - now)
    // / 1000), so any gap at all makes it floor(89.999) = 89. The assertion therefore held
    // only while both calls landed in the same millisecond, which is why this test failed
    // intermittently under full-suite load and passed in isolation. Pinned by the gap cases
    // below.
    const now = Date.now();
    const future = new Date(now + 90_000).toISOString(); // 90s from now
    expect(secondsUntilExpiry(future, now)).toBe(90);
  });

  it('is 90 only at a zero gap, and 89 one millisecond later', () => {
    // Guards the fix above: if someone reintroduces the double Date.now(), the flake comes
    // back silently. These inputs are absolute, so they cannot themselves drift.
    const t = 1_700_000_000_000;
    const future = new Date(t + 90_000).toISOString();
    expect(secondsUntilExpiry(future, t)).toBe(90);
    expect(secondsUntilExpiry(future, t + 1)).toBe(89);
    expect(secondsUntilExpiry(future, t + 999)).toBe(89);
  });

  it('returns 0 when expired', () => {
    const now = Date.now();
    const past = new Date(now - 60_000).toISOString(); // 60s ago
    expect(secondsUntilExpiry(past, now)).toBe(0);
  });

  it('clamps to 0 when now is in the far future', () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const wayLater = Date.now() + 10 * 60 * 1000;
    expect(secondsUntilExpiry(future, wayLater)).toBe(0);
  });

  it('uses the current time when now is omitted (Date.now path)', () => {
    // Default-now path: the function reads Date.now() ITSELF, so capturing `now` above
    // pins nothing -- the comment here used to claim it did. The internal read lands at
    // least a millisecond after the captured one, which turns floor(29.999) into 29 and
    // this assertion into a coin flip. Fake timers are the only way to pin a clock the
    // callee reads.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_700_000_000_000));
      const future = new Date(Date.now() + 30_000).toISOString();
      expect(secondsUntilExpiry(future)).toBe(30);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles sub-second remainders via floor', () => {
    // Absolute instants, not two Date.now() reads: the previous form computed
    // future = now + 1500 and now = Date.now() + 1 from separate calls, so the real
    // remainder was 1500 - δ and only stayed in the floor-to-1 band while δ < 500ms.
    const t = 1_700_000_000_000;
    const future = new Date(t + 1500).toISOString();
    expect(secondsUntilExpiry(future, t + 1)).toBe(1);
    expect(secondsUntilExpiry(future, t)).toBe(1);
    expect(secondsUntilExpiry(future, t + 501)).toBe(0);
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
    // Was `'unknown' as any`, which is the repo's only remaining eslint ERROR and therefore
    // fails `npm run lint` -- a step dev-ci.yml#ui-test runs, so the next PR opened from this
    // branch would go red on it. `any` also defeats the point of the assertion: it silences the
    // checker everywhere the value flows, not just here.
    //
    // EnrollmentStep is not exported (KdsEnrollmentModal.tsx:28), so the parameter type is
    // derived from the function rather than imported -- which keeps this honest if the union
    // grows: a new member still has to be a real step, and 'unknown' still is not one.
    const bogusStep = 'unknown' as unknown as Parameters<typeof shouldFireOnEnrolledOnDone>[0];
    expect(shouldFireOnEnrolledOnDone(bogusStep, device)).toBe(false);
  });
});
