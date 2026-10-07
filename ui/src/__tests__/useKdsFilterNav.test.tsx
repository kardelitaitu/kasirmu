import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useKdsFilterNav } from '@/features/kds/useKdsFilterNav';

/* The REAL useKdsFilterNav, driven through its own handlers.
 *
 * Why this file exists, given KdsKeyboardNavigation / KdsFilterDropdownNav /
 * KdsFilterBtnKeyHandler already pass: those three do NOT import this hook.
 * Each RETYPES the arithmetic it claims to cover — KdsFilterDropdownNav.test.ts
 * defines its own `filterNextDown` and calls it "the pure index arithmetic used
 * by handleFilterPanelKeyDown in KdsScreen.tsx". A retyped copy cannot fail when
 * the real handler changes: edit useKdsFilterNav.ts and all three stay green.
 * Before this file, no test imported useKdsFilterNav, nothing named zoneTabRefs,
 * and KdsScreen.test.tsx asserted no keyboard behaviour at all.
 *
 * The hook is a .ts logic file with no markup and no providers, so it is driven
 * directly here — the handlers ARE the contract.
 */

// A DOM element is needed because the handlers read document.activeElement and
// query the panel. jsdom gives us real focus semantics.
function button(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  document.body.appendChild(b);
  return b;
}

/* The hook exposes filterBtnRef / filterPanelRef as React 18 `RefObject<T>`,
 * whose `current` is readonly by type even though it is writable at runtime.
 * The markup that binds them lives in KdsScreen, so a test has to stand in for
 * it: this cast is the stand-in, and it is the only place the read-only view is
 * bypassed. zoneTabRefs needs no cast — the hook types it MutableRefObject. */
function bind<T>(ref: { current: T | null }, value: T): void {
  (ref as { current: T | null }).current = value;
}

function key(k: string): ReactKeyboardEvent {
  return {
    key: k,
    preventDefault: vi.fn(),
  } as unknown as ReactKeyboardEvent;
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('useKdsFilterNav — zone chips (roving tabindex)', () => {
  const zones = ['grill', 'fry', 'bar'];

  function setup() {
    const setKdsZone = vi.fn();
    const setShowFilter = vi.fn();
    const { result } = renderHook(() =>
      useKdsFilterNav({ zones, setKdsZone, showFilter: false, setShowFilter }));
    // chips: index 0 = "All", then one per zone.
    const chips = [button('All'), ...zones.map(button)];
    bind(result.current.zoneTabRefs, chips);
    return { result, chips, setKdsZone, setShowFilter };
  }

  it('ArrowRight from "All" focuses the first zone and selects it', () => {
    const { result, chips, setKdsZone } = setup();
    chips[0]!.focus();
    act(() => result.current.handleZoneTablistKeyDown(key('ArrowRight')));
    expect(document.activeElement).toBe(chips[1]);
    expect(setKdsZone).toHaveBeenCalledWith('grill');
  });

  it('ArrowRight wraps from the last chip back to "All" and clears the zone', () => {
    const { result, chips, setKdsZone } = setup();
    chips[3]!.focus();
    act(() => result.current.handleZoneTablistKeyDown(key('ArrowRight')));
    expect(document.activeElement).toBe(chips[0]);
    expect(setKdsZone).toHaveBeenCalledWith('');   // '' is "All"
  });

  it('ArrowLeft wraps from "All" to the last chip', () => {
    const { result, chips, setKdsZone } = setup();
    chips[0]!.focus();
    act(() => result.current.handleZoneTablistKeyDown(key('ArrowLeft')));
    expect(document.activeElement).toBe(chips[3]);
    expect(setKdsZone).toHaveBeenCalledWith('bar');
  });

  it('Home and End jump to the first and last chip', () => {
    const { result, chips, setKdsZone } = setup();
    chips[2]!.focus();
    act(() => result.current.handleZoneTablistKeyDown(key('Home')));
    expect(document.activeElement).toBe(chips[0]);
    act(() => result.current.handleZoneTablistKeyDown(key('End')));
    expect(document.activeElement).toBe(chips[3]);
    expect(setKdsZone).toHaveBeenLastCalledWith('bar');
  });

  it('an unhandled key does nothing and does NOT preventDefault', () => {
    const { result, chips, setKdsZone } = setup();
    chips[1]!.focus();
    const e = key('Tab');
    act(() => result.current.handleZoneTablistKeyDown(e));
    expect(setKdsZone).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('with no chips mounted it returns early rather than throwing', () => {
    const setKdsZone = vi.fn();
    const { result } = renderHook(() =>
      useKdsFilterNav({ zones, setKdsZone, showFilter: false, setShowFilter: vi.fn() }));
    bind(result.current.zoneTabRefs, []);
    expect(() => act(() => result.current.handleZoneTablistKeyDown(key('ArrowRight')))).not.toThrow();
    expect(setKdsZone).not.toHaveBeenCalled();
  });
});

describe('useKdsFilterNav — filter panel (listbox)', () => {
  function setup() {
    const setShowFilter = vi.fn();
    const { result } = renderHook(() =>
      useKdsFilterNav({ zones: ['grill'], setKdsZone: vi.fn(), showFilter: true, setShowFilter }));
    const panel = document.createElement('div');
    const options = ['a', 'b', 'c'].map((t) => {
      const b = document.createElement('button');
      b.className = 'kds-filter-option';
      b.textContent = t;
      panel.appendChild(b);
      return b;
    });
    document.body.appendChild(panel);
    bind(result.current.filterPanelRef, panel);
    return { result, options, setShowFilter };
  }

  it('ArrowDown wraps from the last option to the first', () => {
    const { result, options } = setup();
    options[2]!.focus();
    act(() => result.current.handleFilterPanelKeyDown(key('ArrowDown')));
    expect(document.activeElement).toBe(options[0]);
  });

  it('ArrowUp wraps from the first option to the last', () => {
    const { result, options } = setup();
    options[0]!.focus();
    act(() => result.current.handleFilterPanelKeyDown(key('ArrowUp')));
    expect(document.activeElement).toBe(options[2]);
  });

  it('Escape closes the panel and returns focus to the button', () => {
    const { result, setShowFilter } = setup();
    const btn = button('filter');
    bind(result.current.filterBtnRef, btn);
    const e = key('Escape');
    act(() => result.current.handleFilterPanelKeyDown(e));
    expect(setShowFilter).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(btn);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('returns early when the panel holds no options', () => {
    const setShowFilter = vi.fn();
    const { result } = renderHook(() =>
      useKdsFilterNav({ zones: ['grill'], setKdsZone: vi.fn(), showFilter: true, setShowFilter }));
    const empty = document.createElement('div');
    document.body.appendChild(empty);
    bind(result.current.filterPanelRef, empty);
    expect(() => act(() => result.current.handleFilterPanelKeyDown(key('ArrowDown')))).not.toThrow();
  });
});

describe('useKdsFilterNav — dismiss effect', () => {
  it('Escape on the document closes the popover while it is open', () => {
    const setShowFilter = vi.fn();
    renderHook(() =>
      useKdsFilterNav({ zones: ['grill'], setKdsZone: vi.fn(), showFilter: true, setShowFilter }));
    act(() => { document.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(setShowFilter).toHaveBeenCalledWith(false);
  });

  it('an outside click closes it, and a click inside the panel does not', () => {
    const setShowFilter = vi.fn();
    const panel = document.createElement('div');
    const inside = document.createElement('button');
    panel.appendChild(inside);
    document.body.appendChild(panel);
    const btn = button('filter');
    const { result } = renderHook(() =>
      useKdsFilterNav({ zones: ['grill'], setKdsZone: vi.fn(), showFilter: true, setShowFilter }));
    bind(result.current.filterPanelRef, panel);
    bind(result.current.filterBtnRef, btn);

    act(() => { inside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(setShowFilter).not.toHaveBeenCalled();

    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(setShowFilter).toHaveBeenCalledWith(false);
  });

  // A click on the BUTTON must not close the panel either — otherwise the
  // open/close toggle would fire twice and the panel would flicker shut.
  it('a click on the filter button itself does not dismiss', () => {
    const setShowFilter = vi.fn();
    const panel = document.createElement('div');
    document.body.appendChild(panel);
    const btn = button('filter');
    const { result } = renderHook(() =>
      useKdsFilterNav({ zones: ['grill'], setKdsZone: vi.fn(), showFilter: true, setShowFilter }));
    bind(result.current.filterPanelRef, panel);
    bind(result.current.filterBtnRef, btn);

    act(() => { btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(setShowFilter).not.toHaveBeenCalled();
  });

  // The guard is a CONJUNCTION: with the button ref unbound the dismiss stays
  // disarmed even on a genuine outside click. Pinned because a refactor that
  // dropped the button half of the condition would look harmless.
  it('stays disarmed while the button ref is unbound', () => {
    const setShowFilter = vi.fn();
    const panel = document.createElement('div');
    document.body.appendChild(panel);
    const { result } = renderHook(() =>
      useKdsFilterNav({ zones: ['grill'], setKdsZone: vi.fn(), showFilter: true, setShowFilter }));
    bind(result.current.filterPanelRef, panel);
    bind(result.current.filterBtnRef, null);

    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(setShowFilter).not.toHaveBeenCalled();
  });

  // The listeners are attached only while open; leaving them on after close
  // would let a stale Escape close an unrelated surface.
  it('attaches no listeners when the popover is closed', () => {
    const setShowFilter = vi.fn();
    renderHook(() =>
      useKdsFilterNav({ zones: ['grill'], setKdsZone: vi.fn(), showFilter: false, setShowFilter }));
    act(() => { document.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(setShowFilter).not.toHaveBeenCalled();
  });
});
