/**
 * Tests for `useContextMenu` — right-click context menu with clipboard
 * copy/paste, outside-click dismiss, and Escape key handling.
 *
 * The hook manages a `ContextMenuState` (position + target input), exposes
 * `open`/`close`/`handleCopy`/`handlePaste`, and attaches document-level
 * listeners for dismiss-on-outside-click and Escape.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useContextMenu } from '@/components/useContextMenu';

/* ── Clipboard mock ──────────────────────────────────────────────── */

let mockClipboardText = '';
let mockClipboardReadReject = false;
let mockClipboardWriteReject = false;

beforeEach(() => {
  mockClipboardText = 'clipboard content';
  mockClipboardReadReject = false;
  mockClipboardWriteReject = false;

  Object.defineProperty(navigator, 'clipboard', {
    value: {
      readText: vi.fn(async () => {
        if (mockClipboardReadReject) throw new Error('read denied');
        return mockClipboardText;
      }),
      writeText: vi.fn(async (text: string) => {
        if (mockClipboardWriteReject) throw new Error('write denied');
        mockClipboardText = text;
      }),
    },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── Helpers ──────────────────────────────────────────────────────── */

function createInput(value = ''): HTMLInputElement {
  const el = document.createElement('input');
  el.value = value;
  el.setSelectionRange(0, 0);
  return el;
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('useContextMenu', () => {
  /* ── open / close ─────────────────────────────────────────────── */

  it('starts with no menu open', () => {
    const { result } = renderHook(() => useContextMenu());
    expect(result.current.menu).toBeNull();
  });

  it('open sets the menu position and target from the event', () => {
    const { result } = renderHook(() => useContextMenu());
    const input = createInput('hello');
    const event = { clientX: 100, clientY: 200, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent;

    act(() => { result.current.open(event, input); });

    expect(result.current.menu).not.toBeNull();
    expect(result.current.menu!.x).toBe(100);
    expect(result.current.menu!.y).toBe(200);
    expect(result.current.menu!.target).toBe(input);
  });

  it('open calls preventDefault and stopPropagation', () => {
    const { result } = renderHook(() => useContextMenu());
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const event = { clientX: 0, clientY: 0, preventDefault, stopPropagation } as unknown as React.MouseEvent;

    act(() => { result.current.open(event, createInput()); });

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('close sets the menu to null', () => {
    const { result } = renderHook(() => useContextMenu());
    const input = createInput();
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, input); });
    expect(result.current.menu).not.toBeNull();

    act(() => { result.current.close(); });
    expect(result.current.menu).toBeNull();
  });

  /* ── handleCopy ───────────────────────────────────────────────── */

  it('handleCopy copies the selected text to clipboard', async () => {
    const { result } = renderHook(() => useContextMenu());
    const input = createInput('hello world');
    input.setSelectionRange(0, 5);
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, input); });

    await act(async () => { await result.current.handleCopy(); });

    expect(mockClipboardText).toBe('hello');
  });

  it('handleCopy copies the entire value when nothing is selected', async () => {
    const { result } = renderHook(() => useContextMenu());
    const input = createInput('full text');
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, input); });

    await act(async () => { await result.current.handleCopy(); });

    expect(mockClipboardText).toBe('full text');
  });

  it('handleCopy closes the menu after copying', async () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, createInput('x')); });

    await act(async () => { await result.current.handleCopy(); });

    expect(result.current.menu).toBeNull();
  });

  it('handleCopy does not throw when clipboard write is denied', async () => {
    mockClipboardWriteReject = true;
    const { result } = renderHook(() => useContextMenu());
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, createInput('x')); });

    await expect(act(async () => { await result.current.handleCopy(); })).resolves.not.toThrow();
  });

  it('handleCopy does nothing when menu is null', async () => {
    const { result } = renderHook(() => useContextMenu());
    const writeSpy = vi.spyOn(navigator.clipboard, 'writeText');

    await act(async () => { await result.current.handleCopy(); });

    expect(writeSpy).not.toHaveBeenCalled();
  });

  /* ── handlePaste ──────────────────────────────────────────────── */

  it('handlePaste inserts clipboard text at the cursor position', async () => {
    const { result } = renderHook(() => useContextMenu());
    const input = createInput('helo world');
    input.setSelectionRange(3, 3); // cursor after 'hel'
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, input); });

    await act(async () => { await result.current.handlePaste(); });

    expect(input.value).toBe('helclipboard contento world');
  });

  it('handlePaste replaces the selected range', async () => {
    const { result } = renderHook(() => useContextMenu());
    const input = createInput('hello world');
    input.setSelectionRange(0, 5); // selects 'hello'
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, input); });

    await act(async () => { await result.current.handlePaste(); });

    expect(input.value).toBe('clipboard content world');
  });

  it('handlePaste dispatches an input event after pasting', async () => {
    const { result } = renderHook(() => useContextMenu());
    const input = createInput('abc');
    input.setSelectionRange(3, 3);
    const dispatchSpy = vi.spyOn(input, 'dispatchEvent');
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, input); });

    await act(async () => { await result.current.handlePaste(); });

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'input', bubbles: true }),
    );
  });

  it('handlePaste closes the menu after pasting', async () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, createInput('x')); });

    await act(async () => { await result.current.handlePaste(); });

    expect(result.current.menu).toBeNull();
  });

  it('handlePaste does not throw when clipboard read is denied', async () => {
    mockClipboardReadReject = true;
    const { result } = renderHook(() => useContextMenu());
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, createInput('x')); });

    await expect(act(async () => { await result.current.handlePaste(); })).resolves.not.toThrow();
  });

  it('handlePaste does nothing when menu is null', async () => {
    const { result } = renderHook(() => useContextMenu());
    const readSpy = vi.spyOn(navigator.clipboard, 'readText');

    await act(async () => { await result.current.handlePaste(); });

    expect(readSpy).not.toHaveBeenCalled();
  });

  /* ── Document listeners (outside-click, Escape) ───────────────── */

  it('closes the menu on a mousedown outside the menu ref', () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, createInput('x')); });
    expect(result.current.menu).not.toBeNull();

    // Attach the menuRef to a real element; a mousedown on document.body
    // lands outside it, so the outside-click listener closes the menu.
    const menuEl = document.createElement('div');
    // @ts-expect-error — assigning a DOM element to the MutableRefObject
    result.current.menuRef.current = menuEl;

    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(result.current.menu).toBeNull();
  });

  it('does not close when mousedown is inside the menu ref', () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, createInput('x')); });
    expect(result.current.menu).not.toBeNull();

    // Attach the menuRef to a real element and click inside it.
    const menuEl = document.createElement('div');
    // @ts-expect-error — assigning a DOM element to the MutableRefObject
    result.current.menuRef.current = menuEl;

    act(() => { menuEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    // Outside-click listener checks `menuRef.current.contains(target)`.
    // Since the event target is menuEl, it IS contained, so menu stays.
    expect(result.current.menu).not.toBeNull();
  });

  it('closes the menu on Escape keydown', () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, createInput('x')); });
    expect(result.current.menu).not.toBeNull();

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(result.current.menu).toBeNull();
  });

  it('does not close on a non-Escape keydown', () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, createInput('x')); });

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
    expect(result.current.menu).not.toBeNull();
  });

  it('cleans up document listeners when menu closes', () => {
    const { result, unmount } = renderHook(() => useContextMenu());
    act(() => { result.current.open({ clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent, createInput('x')); });
    expect(result.current.menu).not.toBeNull();

    // Close the menu.
    act(() => { result.current.close(); });
    // Unmount — should not throw (cleanup runs on the now-empty effect).
    expect(() => unmount()).not.toThrow();
  });
});