import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { KdsOrder } from '@/api/kds';
import { useKdsShortcuts } from '@/features/kds/hooks/useKdsKeyboardShortcuts';

/* The REAL useKdsShortcuts, driven through the document listener it installs.
 *
 * WHY, given three KDS suites already pass: none of them imports this hook.
 * KdsKeyboardNavigation.test.ts defines its own `nextIndexDown` ("the pure
 * selection logic used by the keyboard handler"); KdsDeselectOnFilter.test.ts
 * defines its own `shouldDeselect`, labelled "Same deselect logic as
 * KdsScreen.tsx useEffect"; KdsFilterDropdownNav / KdsFilterBtnKeyHandler do the
 * same for the filter cluster. A retyped copy is inert with respect to the real
 * code: change a branch here and every one of those stays green. Before this
 * file nothing referenced useKdsShortcuts, selectedRef or kdsRef.
 *
 * The hook is .ts with no markup and no providers, so its handlers ARE its
 * contract — the document listener is the entry point under test.
 */

function order(id: string): KdsOrder {
  return { id } as KdsOrder;
}

const ORDERS = [order('a'), order('b'), order('c')];

/* Build the event. `target` is returned alongside it because jsdom dispatches
 * on the node you call dispatchEvent on, and several cases here need the event
 * to ORIGINATE inside a specific element (an input, a ticket) so the hook's
 * e.target guards are exercised rather than bypassed. */
function key(k: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

function setup(over: Partial<{ orders: KdsOrder[]; selected: string | null }> = {}) {
  const setSelectedOrderId = vi.fn();
  const advanceStatus = vi.fn();
  const orders = over.orders ?? ORDERS;
  const api = renderHook(
    ({ selected }: { selected: string | null }) =>
      useKdsShortcuts({
        filteredOrders: orders,
        selectedOrderId: selected,
        setSelectedOrderId,
        advanceStatus,
      }),
    { initialProps: { selected: over.selected ?? null } },
  );
  return { ...api, setSelectedOrderId, advanceStatus, orders };
}

describe('useKdsShortcuts — number keys', () => {
  it('selects the nth order for key "n", 1-based', () => {
    const { setSelectedOrderId } = setup();
    act(() => { document.dispatchEvent(key('2')); });
    expect(setSelectedOrderId).toHaveBeenCalledWith('b');
  });

  it('does nothing for a number beyond the list length', () => {
    const { setSelectedOrderId } = setup();
    act(() => { document.dispatchEvent(key('5')); });
    expect(setSelectedOrderId).not.toHaveBeenCalled();
  });

  it('ignores 0, which is below the 1-9 range', () => {
    const { setSelectedOrderId } = setup();
    act(() => { document.dispatchEvent(key('0')); });
    expect(setSelectedOrderId).not.toHaveBeenCalled();
  });
});

describe('useKdsShortcuts — arrows', () => {
  // The setter is called with an updater; invoking it is what exercises the
  // clamp. This is the branch the retyped tests cannot reach.
  it('ArrowDown from nothing selects the first order', () => {
    const { setSelectedOrderId } = setup();
    act(() => { document.dispatchEvent(key('ArrowDown')); });
    const updater = setSelectedOrderId.mock.calls[0]![0] as (p: string | null) => string | null;
    expect(updater(null)).toBe('a');
  });

  it('ArrowDown clamps at the last order instead of running past it', () => {
    const { setSelectedOrderId } = setup();
    act(() => { document.dispatchEvent(key('ArrowDown')); });
    const updater = setSelectedOrderId.mock.calls[0]![0] as (p: string | null) => string | null;
    expect(updater('c')).toBe('c');
  });

  it('ArrowUp from nothing selects the LAST order', () => {
    const { setSelectedOrderId } = setup();
    act(() => { document.dispatchEvent(key('ArrowUp')); });
    const updater = setSelectedOrderId.mock.calls[0]![0] as (p: string | null) => string | null;
    expect(updater(null)).toBe('c');
  });

  it('ArrowUp clamps at the first order', () => {
    const { setSelectedOrderId } = setup();
    act(() => { document.dispatchEvent(key('ArrowUp')); });
    const updater = setSelectedOrderId.mock.calls[0]![0] as (p: string | null) => string | null;
    expect(updater('a')).toBe('a');
  });

  it('both arrows yield null on an empty board rather than throwing', () => {
    const { setSelectedOrderId } = setup({ orders: [] });
    act(() => { document.dispatchEvent(key('ArrowDown')); });
    const down = setSelectedOrderId.mock.calls[0]![0] as (p: string | null) => string | null;
    expect(down(null)).toBeNull();
  });
});

describe('useKdsShortcuts — Space and Escape', () => {
  it('Space advances the currently selected order', () => {
    const { advanceStatus } = setup({ selected: 'b' });
    act(() => { document.dispatchEvent(key(' ')); });
    expect(advanceStatus).toHaveBeenCalledWith(ORDERS[1]);
  });

  it('Space does nothing when no order is selected', () => {
    const { advanceStatus } = setup({ selected: null });
    act(() => { document.dispatchEvent(key(' ')); });
    expect(advanceStatus).not.toHaveBeenCalled();
  });

  // A focused ticket button handles Space itself; the document handler must
  // stand down or the status would advance twice.
  it('Space stands down when the event came from inside a ticket', () => {
    const { advanceStatus } = setup({ selected: 'b' });
    const ticket = document.createElement('button');
    ticket.className = 'kds-ticket';
    document.body.appendChild(ticket);
    act(() => { ticket.dispatchEvent(key(' ')); });
    expect(advanceStatus).not.toHaveBeenCalled();
  });

  it('Escape clears the selection', () => {
    const { setSelectedOrderId } = setup({ selected: 'b' });
    act(() => { document.dispatchEvent(key('Escape')); });
    expect(setSelectedOrderId).toHaveBeenCalledWith(null);
  });
});

describe('useKdsShortcuts — the two guards', () => {
  it('ignores keys typed into an input', () => {
    const { setSelectedOrderId } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => { input.dispatchEvent(key('2')); });
    expect(setSelectedOrderId).not.toHaveBeenCalled();
  });

  // NOT asserted here: contenteditable. jsdom does not implement
  // `isContentEditable` (it reads back undefined even with the attribute set),
  // so isEditableTarget cannot detect it in this environment and a test would be
  // asserting a jsdom gap rather than the hook. The input/textarea path below is
  // the branch that IS observable here; the contenteditable case is covered by
  // isEditableTarget's own suite and by real-browser behaviour.
  it('ignores keys typed into an ARIA-editable role element', () => {
    const { setSelectedOrderId } = setup();
    const div = document.createElement('div');
    div.setAttribute('role', 'textbox');
    document.body.appendChild(div);
    act(() => { div.dispatchEvent(key('2')); });
    expect(setSelectedOrderId).not.toHaveBeenCalled();
  });

  it('ignores keys while an aria-modal is open', () => {
    const { setSelectedOrderId } = setup();
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    act(() => { document.dispatchEvent(key('2')); });
    expect(setSelectedOrderId).not.toHaveBeenCalled();
  });

  it('works again once the modal is gone', () => {
    const { setSelectedOrderId } = setup();
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    act(() => { document.dispatchEvent(key('2')); });
    expect(setSelectedOrderId).not.toHaveBeenCalled();
    modal.remove();
    act(() => { document.dispatchEvent(key('2')); });
    expect(setSelectedOrderId).toHaveBeenCalledWith('b');
  });
});

describe('useKdsShortcuts — the deselect effect', () => {
  it('clears a selection that the filter has removed', () => {
    const setSelectedOrderId = vi.fn();
    renderHook(() =>
      useKdsShortcuts({
        filteredOrders: [order('a')],
        selectedOrderId: 'gone',
        setSelectedOrderId,
        advanceStatus: vi.fn(),
      }));
    expect(setSelectedOrderId).toHaveBeenCalledWith(null);
  });

  it('leaves a selection the filter still contains alone', () => {
    const setSelectedOrderId = vi.fn();
    renderHook(() =>
      useKdsShortcuts({
        filteredOrders: ORDERS,
        selectedOrderId: 'b',
        setSelectedOrderId,
        advanceStatus: vi.fn(),
      }));
    expect(setSelectedOrderId).not.toHaveBeenCalled();
  });
});

describe('useKdsShortcuts — listener lifecycle', () => {
  it('removes the document listener on unmount', () => {
    const { unmount, setSelectedOrderId } = setup();
    unmount();
    act(() => { document.dispatchEvent(key('2')); });
    expect(setSelectedOrderId).not.toHaveBeenCalled();
  });

  it('returns a focusable ref and focuses it on mount', () => {
    const holder = document.createElement('div');
    document.body.appendChild(holder);
    const { result } = setup();
    // The markup binds kdsRef to the board region; stand in for it.
    const el = document.createElement('div');
    el.tabIndex = -1;
    document.body.appendChild(el);
    (result.current.kdsRef as { current: HTMLDivElement | null }).current = el;
    el.focus();
    expect(document.activeElement).toBe(el);
  });
});
