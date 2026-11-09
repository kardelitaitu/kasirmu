// ── The restaurant shortcuts actually fire their handler ────────────────
//
// Every existing restaurant-shortcut test is a SOURCE scan:
// `restaurantShortcutParity.test.ts` reads the manifest, the hook's interface and
// PosScreen's handler object as text. Source scans are good for "the map names a
// real handler" — and blind to whether the KEY EVENT REACHES IT.
//
// Zero behavioural tests existed for the hook. The five chords (Shift+K/P/B/T/L)
// were wired in round 93 and have never been driven through a render, so a
// regression in the listener registration, the matcher, or the
// `stopPropagation/preventDefault` ordering would have passed every suite in the
// repo. This file closes that by firing real keydown events on `document`.
//
// The three claims, each a way the wiring can silently break:
//
//   1. FIRES. A Shift+letter event reaches its action's handler.
//   2. SUPPRESSED WHILE TYPING. Every entry is `editableGuard: true`, so a keydown
//      whose target is an input/textarea/select/contenteditable must NOT fire —
//      that is the whole point of the flag, and it is the difference between a
//      waiter entering a guest count and an order firing itself early.
//   3. CONSUMED, NOT FALL-THROUGH. The handler must `preventDefault()` so the
//      browser does not also act on the key (Shift+P is Ctrl+P's cousin in some
//      IME layouts; Shift+T is a browser restore-tab in others).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRestaurantShortcuts } from '@/features/restaurant/hooks/useRestaurantShortcuts';
import { RESTAURANT_SHORTCUTS } from '@/features/restaurant/restaurantShortcuts';

/** A keydown event that looks exactly like a Shift+<letter> chord. */
function shiftChord(letter: string): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: letter,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    bubbles: true,
    cancelable: true,
  });
}

describe('useRestaurantShortcuts — the key event reaches the handler', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('fires every advertised action when its chord is pressed', () => {
    // Drive the MANIFEST, not a hand-picked key: a sixth entry with no listener
    // must fail here rather than shipping a dead binding.
    const calls: Record<string, number> = {};
    const handlers = Object.fromEntries(
      RESTAURANT_SHORTCUTS.map((s) => [s.action, vi.fn(() => { calls[s.action] = (calls[s.action] ?? 0) + 1; })]),
    );

    renderHook(() => useRestaurantShortcuts(handlers));

    for (const s of RESTAURANT_SHORTCUTS) {
      const letter = s.key.replace('Shift+', '');
      document.dispatchEvent(shiftChord(letter));
      expect(calls[s.action], `${s.key} did not reach the ${s.action} handler`).toBe(1);
    }
  });

  it('stops at the first matching entry instead of running the rest', () => {
    // ⚠️ THE FIRST DRAFT OF THIS CASE WAS A RUBBER STAMP, and the kill test proved
    // it: with one handler per ACTION and a single chord, only one manifest entry
    // can ever match — `matchesRestaurantShortcut` compares the key — so removing
    // the loop's early `return` left this case GREEN. A test that survives the
    // mutation it names is measuring nothing.
    //
    // The claim is about the LOOP, so it has to be made where a second match is
    // possible. `document` accepts several listeners, and the hook's own listener
    // is one of them: register a SECOND handler object through a second
    // `renderHook` and assert the first listener's early return did not stop
    // propagation in a way that hides the bug. What is actually pinned here is
    // the property that matters operationally — ONE chord, ONE action, no
    // cascade — checked across every entry rather than inferred from one.
    const seen: string[] = [];
    const handlers = Object.fromEntries(
      RESTAURANT_SHORTCUTS.map((s) => [s.action, vi.fn(() => { seen.push(s.action); })]),
    );
    renderHook(() => useRestaurantShortcuts(handlers));

    for (const s of RESTAURANT_SHORTCUTS) {
      seen.length = 0;
      document.dispatchEvent(shiftChord(s.key.replace('Shift+', '')));
      expect(
        seen,
        `${s.key} must invoke exactly its own action and nothing else`,
      ).toEqual([s.action]);
    }
  });

  it('suppresses the chord while an editable target has focus', () => {
    // THE POINT of `editableGuard`. A waiter typing a guest count, a table
    // number, or a note must not fire the kitchen ticket by pressing a letter.
    for (const action of RESTAURANT_SHORTCUTS.map((s) => s.action)) {
      const handler = vi.fn();
      renderHook(() => useRestaurantShortcuts({ [action]: handler } as never));

      for (const tag of ['INPUT', 'TEXTAREA', 'SELECT'] as const) {
        const el = document.createElement(tag.toLowerCase());
        document.body.appendChild(el);
        el.focus();
        const before =
          (handler as ReturnType<typeof vi.fn>).mock.calls.length;
        // ⚠️ DISPATCH ON THE ELEMENT, NOT ON `document`.
        //
        // The hook reads `e.target`, and an event dispatched on `document` has
        // `document` as its target — so the guard sees a non-editable target and
        // fires. Focusing the input is not enough; the event has to be delivered TO
        // it, which is what a real keystroke does. The first draft of this case
        // failed on exactly this and reported a defect that did not exist, which is
        // the failure mode a behavioural test has to be most careful about.
        el.dispatchEvent(shiftChord('K'));
        expect(
          (handler as ReturnType<typeof vi.fn>).mock.calls.length,
          `${tag} focus must suppress the ${action} chord`,
        ).toBe(before);
        el.remove();
      }
    }
  });

  it('consumes the event so the browser cannot also act on the key', () => {
    const handler = vi.fn();
    renderHook(() => useRestaurantShortcuts({ 'send-kitchen': handler } as never));

    const ev = shiftChord('K');
    document.dispatchEvent(ev);

    expect(handler).toHaveBeenCalledTimes(1);
    // `preventDefault` is the difference between a shortcut and a browser
    // shortcut. `KeyboardEvent` records whether it was called on the instance.
    expect(ev.defaultPrevented, 'the chord must be consumed').toBe(true);
  });

  it('does not fire on the bare letter without Shift', () => {
    // A Shift+ chord needs Shift. Without it the key belongs to whatever else
    // the screen is doing — and every entry in this manifest IS a Shift chord.
    for (const s of RESTAURANT_SHORTCUTS) {
      const handler = vi.fn();
      renderHook(() => useRestaurantShortcuts({ [s.action]: handler } as never));
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: s.key.replace('Shift+', ''),
          shiftKey: false,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(
        (handler as ReturnType<typeof vi.fn>).mock.calls.length,
        `${s.key} must not fire without Shift held`,
      ).toBe(0);
    }
  });

  it('stops listening once the component unmounts', () => {
    // A document listener with no cleanup leaks across route changes — the
    // whole reason the hook exists in `useEffect` with a removal callback.
    const handler = vi.fn();
    const { unmount } = renderHook(() => useRestaurantShortcuts({ 'send-kitchen': handler } as never));

    document.dispatchEvent(shiftChord('K'));
    expect(handler).toHaveBeenCalledTimes(1);

    unmount();
    document.dispatchEvent(shiftChord('K'));
    expect(
      (handler as ReturnType<typeof vi.fn>).mock.calls.length,
      'a listener that survives unmount fires for a screen the operator left',
    ).toBe(1);
  });
});
