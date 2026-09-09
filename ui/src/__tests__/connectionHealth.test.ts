/**
 * @file connectionHealth.test.ts
 * @description Tests for the shared connection-health vocabulary
 * (todo-global-saas-3.md, service health contracts).
 *
 * Covers:
 *   - toneForHealth: degraded is warn, not bad and not good
 *   - the latency thresholds that separate good / warn / bad when connected
 *   - fromWireHealth: every Rust state maps, and an absent state falls back
 *     to reachability rather than inventing health
 *   - the mapping is total: no wire string produces undefined
 */

import { describe, expect, it } from 'vitest';
import {
  LATENCY_GOOD_MAX_MS,
  LATENCY_WARN_MAX_MS,
  fromWireHealth,
  toneForHealth,
  type WireHealth,
} from '@/hooks/connectionHealth';

describe('toneForHealth', () => {
  it('renders degraded as warn, not as bad', () => {
    // The point of adding the state. Red would tell a cashier to stop using
    // a till whose server is up and merely wants its database fixed.
    expect(toneForHealth('degraded', 12)).toBe('warn');
  });

  it('does not render degraded as good either', () => {
    // Green would hide a named fault from support.
    expect(toneForHealth('degraded', 12)).not.toBe('good');
  });

  it('keeps checking distinct from a failed probe', () => {
    expect(toneForHealth('checking', null)).toBe('checking');
    expect(toneForHealth('disconnected', null)).toBe('bad');
  });

  it('applies the latency thresholds only when connected', () => {
    expect(toneForHealth('connected', LATENCY_GOOD_MAX_MS)).toBe('good');
    expect(toneForHealth('connected', LATENCY_GOOD_MAX_MS + 1)).toBe('warn');
    expect(toneForHealth('connected', LATENCY_WARN_MAX_MS)).toBe('warn');
    expect(toneForHealth('connected', LATENCY_WARN_MAX_MS + 1)).toBe('bad');
  });

  it('treats a connected service with no latency reading as bad', () => {
    expect(toneForHealth('connected', null)).toBe('bad');
  });

  it('ignores latency when the service is degraded', () => {
    // A degraded server answering fast is still degraded; latency must not
    // upgrade the tone.
    expect(toneForHealth('degraded', 1)).toBe('warn');
    expect(toneForHealth('degraded', 99_999)).toBe('warn');
  });
});

describe('fromWireHealth', () => {
  const ALL_WIRE: WireHealth[] = ['operational', 'degraded', 'unavailable', 'unknown'];

  it('maps every Rust state to a UI state', () => {
    expect(fromWireHealth('operational', true)).toBe('connected');
    expect(fromWireHealth('degraded', false)).toBe('degraded');
    expect(fromWireHealth('unavailable', false)).toBe('disconnected');
    expect(fromWireHealth('unknown', false)).toBe('checking');
  });

  it('maps the whole wire domain with no gaps', () => {
    for (const wire of ALL_WIRE) {
      expect(fromWireHealth(wire, true)).toBeTruthy();
    }
  });

  it('degrades to the reachability answer when the field is absent', () => {
    // A desktop build predating `state` sends no such key. Inventing
    // `operational` there would report health we never measured.
    expect(fromWireHealth(undefined, true)).toBe('connected');
    expect(fromWireHealth(undefined, false)).toBe('disconnected');
  });

  it('does not let an unrecognised string become a health claim', () => {
    expect(fromWireHealth('healthy' as WireHealth, false)).toBe('disconnected');
    expect(fromWireHealth('OK' as WireHealth, true)).toBe('connected');
  });

  it('trusts a degraded state over an ok flag', () => {
    // The two disagree exactly when the server answers 503 with a payload.
    expect(fromWireHealth('degraded', false)).toBe('degraded');
  });
});
