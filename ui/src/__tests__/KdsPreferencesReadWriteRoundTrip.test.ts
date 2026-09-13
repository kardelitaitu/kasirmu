import { describe, it, expect, beforeEach } from 'vitest';
import { readLocalPrefs, writeLocalPrefs } from '@/features/kds/hooks/useKdsPreferences';
import type { KdsPreferences } from '@/features/kds/hooks/useKdsPreferences';

/**
 * Tests for the writeLocalPrefs ↔ readLocalPrefs round-trip.
 *
 * readLocalPrefs was already tested (Round 11), but writeLocalPrefs was
 * private — the suite validated the read side alone. This tests the full
 * persistence cycle: write → read → verify fields match.
 */

const USER = 'test-user-roundtrip';

describe('writeLocalPrefs ↔ readLocalPrefs round-trip', () => {
  beforeEach(() => {
    localStorage.removeItem(`oz-kds-prefs-${USER}`);
  });

  const prefs: KdsPreferences = {
    layout: 'kanban',
    showOrderId: true,
    showTableNumber: false,
    kdsZone: 'grill',
    autoAcknowledge: true,
    acknowledgeDelayMin: 5,
  };

  it('round-trips all fields through write→read', () => {
    writeLocalPrefs(USER, prefs);
    const read = readLocalPrefs(USER);
    expect(read).toEqual(prefs);
  });

  it('round-trips with layout "focus"', () => {
    const focus = { ...prefs, layout: 'focus' as const };
    writeLocalPrefs(USER, focus);
    expect(readLocalPrefs(USER)).toEqual(focus);
  });

  it('round-trips with layout "metro"', () => {
    const metro = { ...prefs, layout: 'metro' as const };
    writeLocalPrefs(USER, metro);
    expect(readLocalPrefs(USER)).toEqual(metro);
  });

  it('different users have independent prefs', () => {
    writeLocalPrefs('user-a', prefs);
    writeLocalPrefs('user-b', { ...prefs, layout: 'focus' });
    expect(readLocalPrefs('user-a')?.layout).toBe('kanban');
    expect(readLocalPrefs('user-b')?.layout).toBe('focus');
  });

  it('overwrites previous prefs for the same user', () => {
    writeLocalPrefs(USER, prefs);
    const updated = { ...prefs, kdsZone: 'back' };
    writeLocalPrefs(USER, updated);
    expect(readLocalPrefs(USER)?.kdsZone).toBe('back');
  });

  it('readLocalPrefs returns null for unknown user', () => {
    expect(readLocalPrefs('unknown-user')).toBeNull();
  });

  it('handles empty kdsZone', () => {
    writeLocalPrefs(USER, { ...prefs, kdsZone: '' });
    expect(readLocalPrefs(USER)?.kdsZone).toBe('');
  });

  it('handles all boolean combos', () => {
    const combos = [
      { showOrderId: false, showTableNumber: false, autoAcknowledge: false },
      { showOrderId: true, showTableNumber: true, autoAcknowledge: true },
      { showOrderId: true, showTableNumber: false, autoAcknowledge: true },
      { showOrderId: false, showTableNumber: true, autoAcknowledge: false },
    ];
    for (const combo of combos) {
      const p = { ...prefs, ...combo };
      writeLocalPrefs(USER, p);
      expect(readLocalPrefs(USER)).toEqual(p);
    }
  });
});
