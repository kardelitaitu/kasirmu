/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
import { describe, expect, it } from 'vitest';
import { normalizeTrialVertical, detectTrialVertical, hasTrialVertical } from '@/utils/trial-vertical';

describe('normalizeTrialVertical', () => {
  it('maps website restaurant/cafe keys to restaurant', () => {
    for (const raw of ['kafe', 'restoran', 'restaurant', 'cafe', 'coffee', 'KAFE', ' Restaurant ']) {
      expect(normalizeTrialVertical(raw)).toBe('restaurant');
    }
  });

  it('maps enterprise referral values to enterprise_referral', () => {
    for (const raw of ['enterprise_referral', 'enterprise', 'referral', 'ENTERPRISE_REFERRAL']) {
      expect(normalizeTrialVertical(raw)).toBe('enterprise_referral');
    }
  });

  it('maps general/retail verticals and unknowns to the empty string', () => {
    for (const raw of ['warung', 'minimarket', 'retail', 'store', '', null, undefined, 'whatever']) {
      expect(normalizeTrialVertical(raw)).toBe('');
    }
  });
});

describe('detectTrialVertical', () => {
  it('reads the ?v= param', () => {
    expect(detectTrialVertical('?v=restaurant')).toBe('restaurant');
    expect(detectTrialVertical('?v=cafe&x=1')).toBe('restaurant');
    expect(detectTrialVertical('?x=1&v=enterprise_referral')).toBe('enterprise_referral');
  });

  it('accepts the ?vertical= alias', () => {
    expect(detectTrialVertical('?vertical=kafe')).toBe('restaurant');
  });

  it('returns empty when the param is absent or unknown', () => {
    expect(detectTrialVertical('')).toBe('');
    expect(detectTrialVertical('?utm_source=ads')).toBe('');
    expect(detectTrialVertical('?v=unknown')).toBe('');
  });

  it('normalizes website vertical keys through the ?v= param', () => {
    expect(detectTrialVertical('?v=restoran')).toBe('restaurant');
    expect(detectTrialVertical('?v=warung')).toBe('');
  });
});

describe('hasTrialVertical', () => {
  it('is true only for a detected non-general vertical', () => {
    expect(hasTrialVertical('?v=restaurant')).toBe(true);
    expect(hasTrialVertical('?v=enterprise_referral')).toBe(true);
    expect(hasTrialVertical('?v=warung')).toBe(false);
    expect(hasTrialVertical('')).toBe(false);
  });
});
