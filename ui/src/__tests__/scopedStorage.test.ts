// ── Store-scoped storage keys ──────────────────────────────────────
//
// Round 104 (F44) fixed the POS cart this way; round 167's sweep found the same class
// unfixed in `RestaurantReceiptsScreen` (14 flat `resto_rcpt_*` keys, 88 call sites). This
// is the helper that fix and any future one depend on, so it is pinned on its own.
//
// The three claims that matter, and the reason each is a claim:
//
//   1. SCOPE ISOLATION. Two stores on one device must not share a value. A helper that
//      produced the same key for both would silently defeat the whole exercise — the
//      equivalent of round 167's finding, reloaded.
//   2. THE SENTINEL DOES NOT COLLIDE. An unresolved scope must not land on a key a real
//      store could own, which is why the fallback is `'unresolved'` and not `'default'`.
//   3. LEGACY ADOPTION HAPPENS ONCE. A configured value under the old flat spelling must
//      survive the scoping change — otherwise scoping keys RESETS an operator's
//      configuration, and the sweep that found the leak would have created a worse bug.

import { describe, it, expect, beforeEach } from 'vitest';
import { scopedKey, readScoped, writeScoped } from '@/utils/scopedStorage';

beforeEach(() => {
  localStorage.clear();
});

describe('store-scoped storage keys', () => {
  it('gives two stores different keys for the same base', () => {
    expect(scopedKey('k', 'store-a')).toBe('k:store-a');
    expect(scopedKey('k', 'store-b')).toBe('k:store-b');
    expect(scopedKey('k', 'store-a')).not.toBe(scopedKey('k', 'store-b'));
  });

  it('does not collide an unresolved scope with a store named default', () => {
    // The sentinel is the whole point: 'default' WOULD collide, which is why it is not used.
    writeScoped('k', undefined, 'x');
    expect(localStorage.getItem('k:unresolved')).toBe('x');
    expect(localStorage.getItem('k:default')).toBeNull();
  });

  it('round-trips a written value', () => {
    writeScoped('k', 'store-a', 'value');
    expect(readScoped('k', 'store-a')).toBe('value');
    // And the other store does not see it.
    expect(readScoped('k', 'store-b')).toBeNull();
  });

  it('adopts a legacy unscoped value, once', () => {
    // The pre-scoping spelling, as an operator would have it on disk today.
    localStorage.setItem('k', 'from-legacy');

    expect(readScoped('k', 'store-a')).toBe('from-legacy');
    expect(localStorage.getItem('k:store-a')).toBe('from-legacy');

    // A scoped write must override the adopted value, not be shadowed by it.
    writeScoped('k', 'store-b', 'changed');
    expect(readScoped('k', 'store-b')).toBe('changed');
    expect(readScoped('k', 'store-a')).toBe('from-legacy');
  });

  it('does not resurrect a legacy value once a scoped one exists', () => {
    localStorage.setItem('k', 'stale');
    localStorage.setItem('k:store-a', 'current');

    expect(readScoped('k', 'store-a')).toBe('current');
  });
});