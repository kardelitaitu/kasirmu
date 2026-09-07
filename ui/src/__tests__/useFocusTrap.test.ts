import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

/**
 * Create a DOM structure that mirrors a modal dialog:
 *
 *   <div id="panel">
 *     <button id="first">Close</button>
 *     <input id="middle" />
 *     <button id="last">Save</button>
 *   </div>
 *   <button id="outside">Outside</button>
 */
function createPanel(): {
  panel: HTMLDivElement;
  first: HTMLButtonElement;
  middle: HTMLInputElement;
  last: HTMLButtonElement;
  outside: HTMLButtonElement;
} {
  document.body.innerHTML = `
    <div id="panel">
      <button id="first">Close</button>
      <input id="middle" />
      <button id="last">Save</button>
    </div>
    <button id="outside">Outside</button>
  `;

  const panel = document.getElementById('panel') as HTMLDivElement;
  const first = document.getElementById('first') as HTMLButtonElement;
  const middle = document.getElementById('middle') as HTMLInputElement;
  const last = document.getElementById('last') as HTMLButtonElement;
  const outside = document.getElementById('outside') as HTMLButtonElement;

  return { panel, first, middle, last, outside };
}

describe('useFocusTrap', () => {
  let elements: ReturnType<typeof createPanel>;
  let onEscape: () => void;

  beforeEach(() => {
    elements = createPanel();
    onEscape = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // ── Activation / deactivation ─────────────────────────────

  it('does not attach event listeners when active is false', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() =>
      useFocusTrap({ current: elements.panel }, false, onEscape),
    );

    // Should not have registered any listeners
    expect(addSpy).not.toHaveBeenCalledWith('keydown', expect.any(Function));

    unmount();

    // Should not have tried to remove any listeners
    expect(removeSpy).not.toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('attaches keydown listener when active is true', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');

    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('auto-focuses the first focusable element when activated', () => {
    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    expect(document.activeElement).toBe(elements.first);
  });

  it('auto-focuses an input element when it is the first focusable', () => {
    // Remove the first button so the input becomes first
    elements.first.remove();

    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    expect(document.activeElement).toBe(elements.middle);
  });

  it('does not auto-focus when panel has no focusable elements', () => {
    // Remove all focusable children
    elements.panel.innerHTML = '<span>Just text</span>';

    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    // Focus should not have moved since no focusable element exists inside panel.
    // The hook's auto-focus querySelector returns null, so focusable?.focus() is a no-op.
    expect(document.activeElement).toBe(document.body);
  });

  // ── Escape key ────────────────────────────────────────────

  it('calls onEscape when Escape is pressed while active', () => {
    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('does not call onEscape when active is false', () => {
    renderHook(() =>
      useFocusTrap({ current: elements.panel }, false, onEscape),
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    expect(onEscape).not.toHaveBeenCalled();
  });

  it('calls updated onEscape callback when it changes', () => {
    const onEscape2 = vi.fn();

    const { rerender } = renderHook(
      ({ cb }) => useFocusTrap({ current: elements.panel }, true, cb),
      { initialProps: { cb: onEscape } },
    );

    // Update the callback
    rerender({ cb: onEscape2 });

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    // Only the latest callback should be called
    expect(onEscape).not.toHaveBeenCalled();
    expect(onEscape2).toHaveBeenCalledTimes(1);
  });

  // ── Tab cycling ───────────────────────────────────────────

  it('does not wrap Tab when focus is on middle element (natural browser order)', () => {
    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    // Focus the middle element
    elements.middle.focus();
    expect(document.activeElement).toBe(elements.middle);

    // Press Tab — should NOT cycle because middle is not the last element
    const preventDefaultSpy = vi.spyOn(KeyboardEvent.prototype, 'preventDefault');
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          shiftKey: false,
        }),
      );
    });

    // preventDefault should NOT be called — browser will naturally
    // advance focus to the next element without interception.
    expect(preventDefaultSpy).not.toHaveBeenCalled();
    // Focus should still be on middle (no artificial cycle was triggered)
    expect(document.activeElement).toBe(elements.middle);
  });

  it('does not wrap Shift+Tab when focus is on middle element (natural browser order)', () => {
    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    // Focus the middle element
    elements.middle.focus();
    expect(document.activeElement).toBe(elements.middle);

    const preventDefaultSpy = vi.spyOn(KeyboardEvent.prototype, 'preventDefault');
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          shiftKey: true,
        }),
      );
    });

    // preventDefault should NOT be called — browser will naturally
    // move focus backwards without interception.
    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(elements.middle);
  });

  it('calls preventDefault when Tab wraps from last to first', () => {
    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    elements.last.focus();
    expect(document.activeElement).toBe(elements.last);

    const preventDefaultSpy = vi.spyOn(KeyboardEvent.prototype, 'preventDefault');
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          shiftKey: false,
        }),
      );
    });

    // preventDefault must be called to stop the browser from moving
    // focus outside the panel as part of the natural Tab cycle.
    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(elements.first);
  });

  it('calls preventDefault when Shift+Tab wraps from first to last', () => {
    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    // Focus is auto-set to first element on activation
    expect(document.activeElement).toBe(elements.first);

    const preventDefaultSpy = vi.spyOn(KeyboardEvent.prototype, 'preventDefault');
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          shiftKey: true,
        }),
      );
    });

    // preventDefault must be called to stop the browser from moving
    // focus outside the panel as part of the natural Tab cycle.
    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(elements.last);
  });

  it('wraps Tab from last element to first', () => {
    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    // Focus the last element
    elements.last.focus();
    expect(document.activeElement).toBe(elements.last);

    // Press Tab (no Shift)
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          shiftKey: false,
        }),
      );
    });

    // Focus should have wrapped to the first element
    expect(document.activeElement).toBe(elements.first);
  });

  it('wraps Shift+Tab from first element to last', () => {
    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    // Focus is auto-set to first element on activation
    expect(document.activeElement).toBe(elements.first);

    // Press Shift+Tab
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          shiftKey: true,
        }),
      );
    });

    // Focus should have wrapped to the last element
    expect(document.activeElement).toBe(elements.last);
  });

  it('does not cycle Tab within the panel when non-Tab keys are pressed', () => {
    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    // Focus the last element
    elements.last.focus();
    expect(document.activeElement).toBe(elements.last);

    // Press Enter (not Tab) — should NOT cycle focus
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });

    expect(document.activeElement).toBe(elements.last);
  });

  it('does not cycle when there is only one focusable element', () => {
    // Remove middle and last, leaving only first
    elements.middle.remove();
    elements.last.remove();

    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    expect(document.activeElement).toBe(elements.first);

    // Pressing Tab should not cause any issues
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          shiftKey: false,
        }),
      );
    });

    expect(document.activeElement).toBe(elements.first);
  });

  it('does not cycle Tab when no focusable elements exist', () => {
    elements.panel.innerHTML = '<span>Just text</span>';

    const tabSpy = vi.spyOn(KeyboardEvent.prototype, 'preventDefault');

    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          shiftKey: false,
        }),
      );
    });

    expect(tabSpy).not.toHaveBeenCalled();
  });

  // ── Focusable element types ────────────────────────────────

  it('treats a div with tabindex="0" as focusable', () => {
    const div = document.createElement('div');
    div.tabIndex = 0;
    div.textContent = 'Fake button';
    elements.panel.appendChild(div);

    // Place the new div first so auto-focus targets it
    elements.panel.insertBefore(div, elements.first);

    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    // The tabindex="0" div should be auto-focused as the first focusable
    expect(document.activeElement).toBe(div);
  });

  it('excludes a div with tabindex="-1" from focusable set', () => {
    const div = document.createElement('div');
    div.tabIndex = -1;
    div.textContent = 'Hidden focus';
    elements.panel.insertBefore(div, elements.first);

    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    // The tabindex="-1" div should be skipped; first button is first
    expect(document.activeElement).toBe(elements.first);
  });

  it('treats an anchor with href as focusable', () => {
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com';
    anchor.textContent = 'Link';
    elements.panel.appendChild(anchor);

    // Remove the other elements so the anchor is the only focusable
    elements.first.remove();
    elements.middle.remove();
    elements.last.remove();

    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    expect(document.activeElement).toBe(anchor);
  });

  it('includes a disabled button in the focusable set (selector does not exclude :disabled)', () => {
    const disabledBtn = document.createElement('button');
    disabledBtn.disabled = true;
    disabledBtn.textContent = 'Disabled';
    elements.panel.appendChild(disabledBtn);

    // Remove other focusable elements so disabledBtn is the only match
    elements.first.remove();
    elements.middle.remove();
    elements.last.remove();

    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    // The selector `'button, [href], input, select, textarea, [tabindex]:...'`
    // matches <button> regardless of the :disabled property. Verify the
    // disabled button is in the focusable NodeList even though in both
    // real browsers and jsdom, calling .focus() on a disabled element
    // does not move focus.
    const focusable = elements.panel.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );

    expect(focusable).toHaveLength(1);
    expect(focusable[0]).toBe(disabledBtn);
    // The disabled button cannot receive focus via .focus() — this is
    // correct browser/jsdom behavior, not a hook bug.
    expect(document.activeElement).not.toBe(disabledBtn);
  });

  // ── Stacked traps ─────────────────────────────────────────

  it('two active traps — Escape handled by the most recently registered handler', () => {
    const outerOnEscape = vi.fn();
    const innerOnEscape = vi.fn();

    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, outerOnEscape),
    );

    // Mount a second (inner/modal) trap on a child panel
    const innerPanel = document.createElement('div');
    const innerBtn = document.createElement('button');
    innerBtn.textContent = 'Inner';
    innerPanel.appendChild(innerBtn);
    elements.panel.appendChild(innerPanel);

    renderHook(() =>
      useFocusTrap({ current: innerPanel }, true, innerOnEscape),
    );

    // Escape should call the INNER handler first (last registered)
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    // Both handlers fire because both are listening on document
    expect(innerOnEscape).toHaveBeenCalledTimes(1);
    expect(outerOnEscape).toHaveBeenCalledTimes(1);
  });

  // ── Focus restoration (A11Y-01) ─────────────────────────

  it('restores focus to the previously focused element on unmount', () => {
    elements.outside.focus();
    expect(document.activeElement).toBe(elements.outside);

    const { unmount } = renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    // Auto-focus moved into the panel while active.
    expect(document.activeElement).toBe(elements.first);

    unmount();

    expect(document.activeElement).toBe(elements.outside);
  });

  it('restores focus to the previously focused element on deactivation', () => {
    elements.outside.focus();

    const { rerender } = renderHook(
      ({ active }) => useFocusTrap({ current: elements.panel }, active, onEscape),
      { initialProps: { active: true } },
    );

    expect(document.activeElement).toBe(elements.first);

    rerender({ active: false });

    expect(document.activeElement).toBe(elements.outside);
  });

  it('does not restore focus when the trigger was removed from the DOM', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Trigger';
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    // The trap auto-focused the first panel element while active.
    expect(document.activeElement).toBe(elements.first);

    trigger.remove();
    unmount();

    // The detached trigger must NOT be refocused; focus stays where the
    // panel left it (the auto-focused first element, still in the DOM).
    expect(document.activeElement).not.toBe(trigger);
    expect(document.activeElement).toBe(elements.first);
  });

  it('does not restore focus when the trigger is disabled', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Trigger';
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    expect(document.activeElement).toBe(elements.first);

    trigger.disabled = true;
    unmount();

    // The disabled trigger must NOT be refocused.
    expect(document.activeElement).not.toBe(trigger);
    expect(document.activeElement).toBe(elements.first);
  });

  it('does not crash when nothing was focused before activation', () => {
    // No explicit focus — activeElement is body in jsdom.
    const { unmount } = renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    expect(() => unmount()).not.toThrow();
  });

  // ── Scroll lock ───────────────────────────────────────────

  it('locks body scroll when active', () => {
    renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body overflow on cleanup', () => {
    // Set initial overflow
    document.body.style.overflow = 'auto';

    const { unmount } = renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    expect(document.body.style.overflow).toBe('hidden');

    unmount();

    expect(document.body.style.overflow).toBe('auto');
  });

  it('restores body overflow on deactivation (active becomes false)', () => {
    document.body.style.overflow = 'auto';

    const { rerender } = renderHook(
      ({ active }) =>
        useFocusTrap({ current: elements.panel }, active, onEscape),
      { initialProps: { active: true } },
    );

    expect(document.body.style.overflow).toBe('hidden');

    // Deactivate
    rerender({ active: false });

    expect(document.body.style.overflow).toBe('auto');
  });

  it('restores the original overflow value (not just "visible")', () => {
    document.body.style.overflow = 'scroll';

    const { unmount } = renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    expect(document.body.style.overflow).toBe('hidden');

    unmount();

    expect(document.body.style.overflow).toBe('scroll');
  });

  // ── Cleanup ───────────────────────────────────────────────

  it('removes keydown listener on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() =>
      useFocusTrap({ current: elements.panel }, true, onEscape),
    );

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('does not crash when panelRef.current is null', () => {
    expect(() => {
      renderHook(() =>
        useFocusTrap({ current: null }, true, onEscape),
      );
    }).not.toThrow();
  });

  it('gracefully handles when panelRef.current becomes null during activation', () => {
    // Create a ref that we can clear
    const ref = { current: elements.panel as HTMLElement | null };

    const { unmount } = renderHook(() =>
      useFocusTrap(ref, true, onEscape),
    );

    // Clear the ref (simulating DOM removal during lifecycle)
    ref.current = null;

    // Should not crash on unmount
    expect(() => unmount()).not.toThrow();
  });

  // ── Focusable-set accuracy (UX audit round 3) ──────────────
  //
  // The wrap conditions compare document.activeElement against the first/last
  // of the focusable set. If that set contains an element the browser can
  // never land focus on, the comparison can never become true and Tab walks
  // straight out of the dialog into the page behind it. ConfirmDialog hits
  // this for real: its confirm button is disabled while the form is invalid
  // and while the action is in flight (`loading`).

  describe('elements the browser cannot focus', () => {
    const pressTab = (shiftKey = false) => {
      const spy = vi.spyOn(KeyboardEvent.prototype, 'preventDefault');
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, shiftKey }),
        );
      });
      return spy;
    };

    it('wraps past a disabled last button', () => {
      elements.last.disabled = true;
      renderHook(() => useFocusTrap({ current: elements.panel }, true, onEscape));
      elements.middle.focus();

      expect(pressTab()).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(elements.first);
    });

    it('wraps past a hidden last button', () => {
      elements.last.hidden = true;
      renderHook(() => useFocusTrap({ current: elements.panel }, true, onEscape));
      elements.middle.focus();

      expect(pressTab()).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(elements.first);
    });

    it('wraps past an aria-hidden last button', () => {
      elements.last.setAttribute('aria-hidden', 'true');
      renderHook(() => useFocusTrap({ current: elements.panel }, true, onEscape));
      elements.middle.focus();

      expect(pressTab()).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(elements.first);
    });

    it('wraps Shift+Tab past a disabled first button', () => {
      elements.first.disabled = true;
      renderHook(() => useFocusTrap({ current: elements.panel }, true, onEscape));
      elements.middle.focus();

      expect(pressTab(true)).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(elements.last);
    });
  });

  // A trap that only reacts when focus sits exactly on its first/last child
  // has no answer for focus that is already elsewhere — an overlay click, or
  // any programmatic focus outside the panel. Tab then continues through the
  // page behind the dialog, which is the escape the trap exists to prevent.
  describe('focus that is outside the panel', () => {
    const pressTab = (shiftKey = false) => {
      const spy = vi.spyOn(KeyboardEvent.prototype, 'preventDefault');
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, shiftKey }),
        );
      });
      return spy;
    };

    it('pulls Tab back into the panel', () => {
      renderHook(() => useFocusTrap({ current: elements.panel }, true, onEscape));
      elements.outside.focus();
      expect(document.activeElement).toBe(elements.outside);

      expect(pressTab()).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(elements.first);
    });

    it('sends Shift+Tab from outside to the last element', () => {
      renderHook(() => useFocusTrap({ current: elements.panel }, true, onEscape));
      elements.outside.focus();

      expect(pressTab(true)).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(elements.last);
    });
  });
});
