// ── keyboard-modifier tests ──────────────────────────────────────
//
// Covers isCommandModifier (KEY-08): Ctrl on Windows/Linux-style
// events, Meta on macOS-like hardware, neither, and combined presses.

import { describe, it, expect } from 'vitest';
import { isCommandModifier } from '@/utils/keyboard-modifier';

function keyEvent(mods: { ctrlKey?: boolean; metaKey?: boolean }): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 's',
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
  });
}

describe('isCommandModifier', () => {
  it('returns true when Ctrl is held', () => {
    expect(isCommandModifier(keyEvent({ ctrlKey: true }))).toBe(true);
  });

  it('returns true when Meta (⌘) is held', () => {
    expect(isCommandModifier(keyEvent({ metaKey: true }))).toBe(true);
  });

  it('returns true when both are held', () => {
    expect(isCommandModifier(keyEvent({ ctrlKey: true, metaKey: true }))).toBe(true);
  });

  it('returns false when neither modifier is held', () => {
    expect(isCommandModifier(keyEvent({}))).toBe(false);
  });

  it('is independent of other modifiers (alt/shift)', () => {
    const e = new KeyboardEvent('keydown', {
      key: 's', altKey: true, shiftKey: true, ctrlKey: false, metaKey: false,
    });
    expect(isCommandModifier(e)).toBe(false);
  });
});
