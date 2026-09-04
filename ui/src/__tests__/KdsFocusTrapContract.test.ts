// Contract tests for useFocusTrap — verifies the focus trapping behavior
// (Tab/Shift+Tab cycling, Escape dismissal) using a real DOM.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

function createPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.innerHTML = `
    <button id="btn1">First</button>
    <input id="input1" type="text" />
    <button id="btn2">Last</button>
  `;
  document.body.appendChild(panel);
  return panel;
}

describe('useFocusTrap', () => {
  let panel: HTMLElement;

  beforeEach(() => {
    panel = createPanel();
  });

  afterEach(() => {
    panel.remove();
  });

  it('calls onEscape when Escape is pressed', () => {
    const onEscape = vi.fn();
    const panelRef = { current: panel };
    renderHook(() => useFocusTrap(panelRef, true, onEscape));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('does not call onEscape when trap is inactive', () => {
    const onEscape = vi.fn();
    const panelRef = { current: panel };
    renderHook(() => useFocusTrap(panelRef, false, onEscape));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onEscape).not.toHaveBeenCalled();
  });

  it('wraps Tab from last element to first', () => {
    const panelRef = { current: panel };
    renderHook(() => useFocusTrap(panelRef, true, () => {}));

    const last = panel.querySelector('#btn2') as HTMLElement;
    last.focus();
    document.activeElement; // ensure focus is set

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });

    // After wrapping, focus should move to first element
    const first = panel.querySelector('#btn1') as HTMLElement;
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from first element to last', () => {
    const panelRef = { current: panel };
    renderHook(() => useFocusTrap(panelRef, true, () => {}));

    const first = panel.querySelector('#btn1') as HTMLElement;
    first.focus();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    });

    const last = panel.querySelector('#btn2') as HTMLElement;
    expect(document.activeElement).toBe(last);
  });

  it('locks body scroll when active', () => {
    const panelRef = { current: panel };
    const { unmount } = renderHook(() => useFocusTrap(panelRef, true, () => {}));

    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('does not lock body scroll when inactive', () => {
    const panelRef = { current: panel };
    renderHook(() => useFocusTrap(panelRef, false, () => {}));

    expect(document.body.style.overflow).toBe('');
  });
});
