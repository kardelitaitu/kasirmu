// Unit tests for readLocalPrefs — the pure function that reads and validates KDS
// preferences from localStorage, returning null for missing/invalid data.
//
// This suite previously REIMPLEMENTED readLocalPrefs inside the test file (its own comment
// said so: "Since it's not exported, we'll reimplement the same logic here"). Every one of
// the ten tests therefore asserted against a local copy and would have kept passing if the
// production function had been deleted. readLocalPrefs is now exported from the module and
// imported here, so these tests exercise the code that actually ships.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  readLocalPrefs,
  STORAGE_KEY_PREFIX,
} from '@/features/kds/hooks/useKdsPreferences';

describe('readLocalPrefs', () => {
  // The round-trip tests below cannot detect a change to STORAGE_KEY_PREFIX: they write
  // through the imported constant and read through the same one, so both sides move
  // together and everything stays green. That is a real blind spot -- renaming the key
  // orphans every user's saved preferences in the wild, and no behavioural test can see
  // it. Pinning the literal is what turns a rename into a conscious act.
  it('pins the localStorage key so a rename is a deliberate change', () => {
    expect(STORAGE_KEY_PREFIX).toBe('oz-kds-prefs-');
  });

  it('reads only the per-user key, never a sibling user\'s', () => {
    localStorage.setItem(STORAGE_KEY_PREFIX + 'user-1', JSON.stringify({ layout: 'kanban' }));
    localStorage.setItem('oz-kds-prefs-user-2', JSON.stringify({ layout: 'metro' }));
    expect(readLocalPrefs('user-1')!.layout).toBe('kanban');
    // A different prefix in production would make this read miss and return null.
    expect(readLocalPrefs('user-2')!.layout).toBe('metro');
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no stored data', () => {
    expect(readLocalPrefs('user-1')).toBeNull();
  });

  it('returns null for empty string', () => {
    localStorage.setItem(STORAGE_KEY_PREFIX + 'user-1', '');
    expect(readLocalPrefs('user-1')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY_PREFIX + 'user-1', 'not-json');
    expect(readLocalPrefs('user-1')).toBeNull();
  });

  it('returns null when layout is missing', () => {
    localStorage.setItem(STORAGE_KEY_PREFIX + 'user-1', JSON.stringify({ showOrderId: true }));
    expect(readLocalPrefs('user-1')).toBeNull();
  });

  it('returns null when layout is invalid', () => {
    localStorage.setItem(STORAGE_KEY_PREFIX + 'user-1', JSON.stringify({ layout: 'invalid' }));
    expect(readLocalPrefs('user-1')).toBeNull();
  });

  it('returns valid prefs for kanban layout', () => {
    const prefs = { layout: 'kanban', showOrderId: false, showTableNumber: true };
    localStorage.setItem(STORAGE_KEY_PREFIX + 'user-1', JSON.stringify(prefs));
    const result = readLocalPrefs('user-1');
    expect(result).not.toBeNull();
    expect(result!.layout).toBe('kanban');
    expect(result!.showOrderId).toBe(false);
  });

  it('returns valid prefs for focus layout', () => {
    localStorage.setItem(STORAGE_KEY_PREFIX + 'user-1', JSON.stringify({ layout: 'focus' }));
    expect(readLocalPrefs('user-1')!.layout).toBe('focus');
  });

  it('returns valid prefs for metro layout', () => {
    localStorage.setItem(STORAGE_KEY_PREFIX + 'user-1', JSON.stringify({ layout: 'metro' }));
    expect(readLocalPrefs('user-1')!.layout).toBe('metro');
  });

  it('applies defaults for missing optional fields', () => {
    localStorage.setItem(STORAGE_KEY_PREFIX + 'user-1', JSON.stringify({ layout: 'kanban' }));
    const result = readLocalPrefs('user-1');
    expect(result!.showOrderId).toBe(true);
    expect(result!.showTableNumber).toBe(true);
    expect(result!.kdsZone).toBe('');
    expect(result!.autoAcknowledge).toBe(false);
    expect(result!.acknowledgeDelayMin).toBe(2);
  });

  it('isolates users — different userId reads different data', () => {
    localStorage.setItem(STORAGE_KEY_PREFIX + 'user-1', JSON.stringify({ layout: 'kanban' }));
    localStorage.setItem(STORAGE_KEY_PREFIX + 'user-2', JSON.stringify({ layout: 'metro' }));
    expect(readLocalPrefs('user-1')!.layout).toBe('kanban');
    expect(readLocalPrefs('user-2')!.layout).toBe('metro');
  });

  // The behaviour the local copy could not express. It rebuilt six named fields, so an
  // unknown key in storage vanished; the real function returns `{ ...DEFAULTS, ...parsed }`,
  // so anything stored under this key survives into the returned object. That is a genuine
  // property of the shipping code -- stale keys from an older schema, or a key written by a
  // future version, are visible to callers -- and a test suite that reimplements the
  // function can never discover it.
  it('passes unknown stored keys through, because it spreads parsed over DEFAULTS', () => {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + 'user-1',
      JSON.stringify({ layout: 'kanban', legacyZoneLabel: 'Hot Station' }),
    );
    const result = readLocalPrefs('user-1');
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('legacyZoneLabel', 'Hot Station');
  });

  it('lets a stored field override its default rather than only filling gaps', () => {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + 'user-1',
      JSON.stringify({ layout: 'focus', acknowledgeDelayMin: 9 }),
    );
    expect(readLocalPrefs('user-1')!.acknowledgeDelayMin).toBe(9);
  });
});
