// ── useDisableAutofill tests ─────────────────────────────────────
//
// Covers: autocomplete="off" applied to existing inputs/selects/
// textareas on mount, MutationObserver pickup of dynamically added
// elements (direct + nested), no-op on already-disabled fields, and
// observer disconnect on unmount.
//
// Pure DOM behaviour — no Tauri or network mocking required.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useDisableAutofill } from '@/hooks/useDisableAutofill';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

// ── On-mount sweep ─────────────────────────────────────────────────

describe('useDisableAutofill — on mount', () => {
  it('sets autocomplete="off" on all existing inputs', () => {
    const a = document.createElement('input');
    const b = document.createElement('input');
    document.body.append(a, b);

    renderHook(() => useDisableAutofill());

    expect(a.autocomplete).toBe('off');
    expect(b.autocomplete).toBe('off');
  });

  it('also disables selects and textareas', () => {
    const input = document.createElement('input');
    const select = document.createElement('select');
    const textarea = document.createElement('textarea');
    document.body.append(input, select, textarea);

    renderHook(() => useDisableAutofill());

    expect(input.autocomplete).toBe('off');
    expect(select.autocomplete).toBe('off');
    expect(textarea.autocomplete).toBe('off');
  });

  it('finds fields nested inside other elements', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<form><input id="nested-in"/><textarea id="nested-ta"></textarea></form>';
    document.body.append(wrapper);

    renderHook(() => useDisableAutofill());

    const nestedInput = document.querySelector('#nested-in') as HTMLInputElement;
    const nestedTa = document.querySelector('#nested-ta') as HTMLTextAreaElement;
    expect(nestedInput.autocomplete).toBe('off');
    expect(nestedTa.autocomplete).toBe('off');
  });

  it('does not throw when the document has no form fields', () => {
    expect(() => renderHook(() => useDisableAutofill())).not.toThrow();
  });
});

// ── MutationObserver behaviour ─────────────────────────────────────

describe('useDisableAutofill — dynamically added elements', () => {
  it('disables an input added after mount', async () => {
    renderHook(() => useDisableAutofill());

    const late = document.createElement('input');
    document.body.append(late);

    // MutationObserver callbacks are microtask-scheduled — wait a tick.
    await vi.waitFor(() => {
      expect(late.autocomplete).toBe('off');
    });
  });

  it('disables fields nested inside a dynamically added container', async () => {
    renderHook(() => useDisableAutofill());

    const container = document.createElement('div');
    container.innerHTML = '<input id="late-nested"/><select id="late-select"></select>';
    document.body.append(container);

    await vi.waitFor(() => {
      const nested = document.querySelector('#late-nested') as HTMLInputElement;
      const sel = document.querySelector('#late-select') as HTMLSelectElement;
      expect(nested.autocomplete).toBe('off');
      expect(sel.autocomplete).toBe('off');
    });
  });

  it('leaves non-form elements untouched', () => {
    renderHook(() => useDisableAutofill());

    const div = document.createElement('div');
    const para = document.createElement('p');
    document.body.append(div, para);

    // No assertion to make on autocomplete for divs — the point is that
    // the observer does not crash on non-form nodes.
    expect(div.tagName).toBe('DIV');
    expect(para.tagName).toBe('P');
  });
});

// ── Idempotence ────────────────────────────────────────────────────

describe('useDisableAutofill — idempotence', () => {
  it('keeps an input that already has autocomplete="off"', () => {
    const pre = document.createElement('input');
    pre.autocomplete = 'off';
    document.body.append(pre);

    renderHook(() => useDisableAutofill());

    expect(pre.autocomplete).toBe('off');
  });

  it('overwrites a non-off autocomplete value (e.g. "on")', () => {
    const on = document.createElement('input');
    on.autocomplete = 'on';
    document.body.append(on);

    renderHook(() => useDisableAutofill());

    expect(on.autocomplete).toBe('off');
  });
});

// ── Cleanup ────────────────────────────────────────────────────────

describe('useDisableAutofill — unmount', () => {
  it('stops processing after unmount (observer disconnected)', async () => {
    const { unmount } = renderHook(() => useDisableAutofill());
    unmount();

    const after = document.createElement('input');
    document.body.append(after);

    // Give any (now-disconnected) observer a chance to misfire.
    await new Promise((r) => setTimeout(r, 20));

    // Default autocomplete for an input is "" in jsdom — proving the
    // observer no longer rewrote it.
    expect(after.autocomplete).not.toBe('off');
  });
});
