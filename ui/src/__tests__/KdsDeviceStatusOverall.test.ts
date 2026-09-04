import { describe, it, expect } from 'vitest';
import { overallDeviceStatus } from '@/features/kds/components/KdsDeviceStatusIndicator';

/**
 * Tests for overallDeviceStatus — the pure logic that determines the
 * KDS device indicator's overall status from connected/total counts.
 *
 * - All connected → 'connected' (green)
 * - Some connected → 'stale' (yellow)
 * - None connected → 'disconnected' (red)
 */

describe('overallDeviceStatus', () => {
  it('returns "connected" when all devices are connected', () => {
    expect(overallDeviceStatus(3, 3)).toBe('connected');
  });

  it('returns "connected" when one device and it is connected', () => {
    expect(overallDeviceStatus(1, 1)).toBe('connected');
  });

  it('returns "connected" when zero devices (vacuously true)', () => {
    expect(overallDeviceStatus(0, 0)).toBe('connected');
  });

  it('returns "stale" when some devices are connected', () => {
    expect(overallDeviceStatus(1, 3)).toBe('stale');
  });

  it('returns "stale" when one of two is connected', () => {
    expect(overallDeviceStatus(1, 2)).toBe('stale');
  });

  it('returns "stale" when all but one are connected', () => {
    expect(overallDeviceStatus(4, 5)).toBe('stale');
  });

  it('returns "disconnected" when no devices are connected', () => {
    expect(overallDeviceStatus(0, 3)).toBe('disconnected');
  });

  it('returns "disconnected" when zero connected, one total', () => {
    expect(overallDeviceStatus(0, 1)).toBe('disconnected');
  });

  it('handles large device counts', () => {
    expect(overallDeviceStatus(100, 100)).toBe('connected');
    expect(overallDeviceStatus(99, 100)).toBe('stale');
    expect(overallDeviceStatus(0, 100)).toBe('disconnected');
  });
});
