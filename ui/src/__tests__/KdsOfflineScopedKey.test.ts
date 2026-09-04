import { describe, it, expect } from 'vitest';
import { scopedKey } from '@/hooks/useKdsOffline';

/**
 * Tests for scopedKey — OFF-07 store-scoped localStorage key builder.
 *
 * Every localStorage key used by useKdsOffline is namespaced by the store
 * scope so switching stores on a shared terminal never leaks data.
 */

describe('scopedKey', () => {
  it('returns prefix unchanged when scope is undefined', () => {
    expect(scopedKey('kds-orders', undefined)).toBe('kds-orders');
  });

  it('returns prefix unchanged when scope is empty string', () => {
    expect(scopedKey('kds-orders', '')).toBe('kds-orders');
  });

  it('appends scope with colon separator', () => {
    expect(scopedKey('kds-orders', 'store-42')).toBe('kds-orders:store-42');
  });

  it('handles UUID-style store scopes', () => {
    expect(scopedKey('kds-queue', 'abc-123-def')).toBe('kds-queue:abc-123-def');
  });

  it('different scopes produce different keys', () => {
    const a = scopedKey('kds-orders', 'store-a');
    const b = scopedKey('kds-orders', 'store-b');
    expect(a).not.toBe(b);
  });

  it('same scope produces same key (deterministic)', () => {
    expect(scopedKey('kds-orders', 'store-1')).toBe(
      scopedKey('kds-orders', 'store-1'),
    );
  });

  it('different prefixes with same scope produce different keys', () => {
    const a = scopedKey('kds-orders', 's1');
    const b = scopedKey('kds-queue', 's1');
    expect(a).not.toBe(b);
  });
});
