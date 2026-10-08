/**
 * useWarehouseSession - the warehouse console's session state.
 *
 * This hook had NO coverage of any kind. It was found by instrumenting every
 * feature hook that no test imports directly and running the full 665-file
 * suite: 19 of 22 executed anyway through a parent that renders them, and this
 * one ran ZERO times. The filename and import-grep checks both called all 22
 * "untested", so neither could have found it -- see the method note in
 * todo-open-debt-program.md.
 *
 * It is live, reachable code: features/warehouse/register.tsx:8 registers
 * route 'warehouse', WarehouseConsole.tsx consumes the hook, and the console is
 * wired into app/tablet/TabletAppShell.tsx and features/index.ts.
 *
 * No context and no IPC -- every dependency is local state -- so these cases are
 * plain statements about the reducer-like behaviour, and the invariants worth
 * pinning are the ones a counting screen gets wrong silently:
 *   1. Scanning the same SKU twice MERGES into one line rather than duplicating
 *      it, because a duplicate line double-counts the receipt.
 *   2. Quantities clamp at zero: a scan-based flow produces transient negatives.
 *   3. `fullyPicked` is false for an EMPTY list -- "everything is picked" is not
 *      a vacuous truth when nothing has been scanned.
 *   4. The source ids land on the right field (transferLineId vs poLineId),
 *      since receive mode reconciles against two different tables.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useWarehouseSession } from './useWarehouseSession';

function mount() {
  return renderHook(() => useWarehouseSession());
}

/** Add one line and return its generated id. */
function addOne(
  result: { current: ReturnType<typeof useWarehouseSession> },
  sku: string,
  name = sku,
  qty = 1,
  bin: string | null = null,
  sourceLineId?: string,
  sourceType?: 'transfer' | 'po',
) {
  act(() => result.current.addLine(sku, name, bin, qty, sourceLineId, sourceType));
  const line = result.current.lines.find((l) => l.sku === sku);
  return line!;
}

// ── 1. defaults ────────────────────────────────────────────────────────

describe('initial state', () => {
  it('starts empty, in receive mode', () => {
    const { result } = mount();
    expect(result.current.lines).toEqual([]);
    expect(result.current.mode).toBe('receive');
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.itemCount).toBe(0);
  });

  it('starts with no destination, transfer or purchase order chosen', () => {
    const { result } = mount();
    expect(result.current.destinationLocationId).toBeNull();
    expect(result.current.transferId).toBeNull();
    expect(result.current.poId).toBeNull();
  });
});

// ── 2. addLine: the merge rule ─────────────────────────────────────────

describe('addLine', () => {
  it('adds a line with the defaults a scan produces', () => {
    const { result } = mount();
    const line = addOne(result, 'SKU-1', 'Widget', 2);

    expect(result.current.lines).toHaveLength(1);
    expect(line.qty).toBe(2);
    expect(line.pickedQty).toBe(0);
    expect(line.damagedQty).toBe(0);
    expect(line.bin).toBeNull();
  });

  it('defaults the quantity to 1 when omitted', () => {
    const { result } = mount();
    act(() => result.current.addLine('SKU-1', 'Widget'));
    expect(result.current.lines[0]!.qty).toBe(1);
  });

  it('MERGES a repeated SKU into one line instead of duplicating it', () => {
    const { result } = mount();
    addOne(result, 'SKU-1', 'Widget', 2);
    addOne(result, 'SKU-1', 'Widget', 3);

    // Two lines for one SKU would double-count the receipt.
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0]!.qty).toBe(5);
  });

  it('keeps different SKUs as separate lines', () => {
    const { result } = mount();
    addOne(result, 'SKU-1');
    addOne(result, 'SKU-2');
    expect(result.current.lines).toHaveLength(2);
  });

  it('gives each new line a distinct id', () => {
    const { result } = mount();
    const a = addOne(result, 'SKU-1');
    const b = addOne(result, 'SKU-2');
    expect(a.id).not.toBe(b.id);
  });

  it('records the purchase-order source line on poLineId', () => {
    const { result } = mount();
    const line = addOne(result, 'SKU-1', 'Widget', 1, null, 'PO-LINE-9', 'po');
    expect(line.poLineId).toBe('PO-LINE-9');
    // Receive mode reconciles against two different tables; the wrong field
    // would send the PO line id to the transfer lookup.
    expect(line.transferLineId).toBeUndefined();
  });

  it('records the transfer source line on transferLineId', () => {
    const { result } = mount();
    const line = addOne(result, 'SKU-1', 'Widget', 1, null, 'TR-LINE-4', 'transfer');
    expect(line.transferLineId).toBe('TR-LINE-4');
    expect(line.poLineId).toBeUndefined();
  });

  it('carries the bin hint when one is supplied', () => {
    const { result } = mount();
    const line = addOne(result, 'SKU-1', 'Widget', 1, 'A-12');
    expect(line.bin).toBe('A-12');
  });
});

// ── 3. quantity edits clamp ────────────────────────────────────────────

describe('quantity edits', () => {
  it('sets a line quantity', () => {
    const { result } = mount();
    const line = addOne(result, 'SKU-1', 'Widget', 1);
    act(() => result.current.setQty(line.id, 7));
    expect(result.current.lines[0]!.qty).toBe(7);
  });

  it('clamps a negative quantity to zero rather than storing it', () => {
    const { result } = mount();
    const line = addOne(result, 'SKU-1', 'Widget', 5);
    // A scan-driven flow produces transient negatives; a stored -3 would make
    // itemCount lie and could be written to the backend.
    act(() => result.current.setQty(line.id, -3));
    expect(result.current.lines[0]!.qty).toBe(0);
    expect(result.current.itemCount).toBe(0);
  });

  it('clamps a negative picked quantity to zero', () => {
    const { result } = mount();
    const line = addOne(result, 'SKU-1', 'Widget', 2);
    act(() => result.current.pickLine(line.id, -1));
    expect(result.current.lines[0]!.pickedQty).toBe(0);
  });

  it('clamps a negative damaged quantity to zero', () => {
    const { result } = mount();
    const line = addOne(result, 'SKU-1', 'Widget', 2);
    act(() => result.current.setDamagedQty(line.id, -4));
    expect(result.current.lines[0]!.damagedQty).toBe(0);
  });

  it('leaves other lines alone when one is edited', () => {
    const { result } = mount();
    const a = addOne(result, 'SKU-1', 'Widget', 1);
    addOne(result, 'SKU-2', 'Gadget', 1);
    act(() => result.current.setQty(a.id, 9));
    expect(result.current.lines.find((l) => l.sku === 'SKU-2')!.qty).toBe(1);
  });
});

// ── 4. removal and clear ───────────────────────────────────────────────

describe('removal', () => {
  it('removes only the named line', () => {
    const { result } = mount();
    const a = addOne(result, 'SKU-1');
    addOne(result, 'SKU-2');
    act(() => result.current.removeLine(a.id));
    expect(result.current.lines.map((l) => l.sku)).toEqual(['SKU-2']);
  });

  it('clear drops the lines AND the picked ids', () => {
    const { result } = mount();
    addOne(result, 'SKU-1');
    act(() => {
      result.current.setDestinationLocationId('loc-1');
      result.current.setTransferId('tr-1');
      result.current.setPoId('po-1');
    });

    act(() => result.current.clear());

    expect(result.current.lines).toEqual([]);
    // A surviving id would pre-arm the next session's destination, sending a
    // later transfer to wherever the previous one pointed.
    expect(result.current.destinationLocationId).toBeNull();
    expect(result.current.transferId).toBeNull();
    expect(result.current.poId).toBeNull();
  });
});

// ── 5. derived counts ──────────────────────────────────────────────────

describe('derived values', () => {
  it('sums the quantities across lines, not the line count', () => {
    const { result } = mount();
    addOne(result, 'SKU-1', 'Widget', 3);
    addOne(result, 'SKU-2', 'Gadget', 4);
    expect(result.current.itemCount).toBe(7);
    expect(result.current.lines).toHaveLength(2);
  });

  it('isEmpty tracks the line list', () => {
    const { result } = mount();
    expect(result.current.isEmpty).toBe(true);
    act(() => result.current.addLine('SKU-1', 'Widget'));
    expect(result.current.isEmpty).toBe(false);
  });

  it('a line with quantity zero still counts as present', () => {
    const { result } = mount();
    const line = addOne(result, 'SKU-1', 'Widget', 1);
    act(() => result.current.setQty(line.id, 0));
    // Zero units is not the same as no line: the operator is still holding it.
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.lines).toHaveLength(1);
  });
});

describe('fullyPicked', () => {
  it('is FALSE for an empty list', () => {
    const { result } = mount();
    // Not a vacuous truth: nothing has been scanned, so nothing is picked.
    expect(result.current.fullyPicked).toBe(false);
  });

  it('is false while any line is under-picked', () => {
    const { result } = mount();
    const line = addOne(result, 'SKU-1', 'Widget', 5);
    act(() => result.current.pickLine(line.id, 4));
    expect(result.current.fullyPicked).toBe(false);
  });

  it('is true when every line is picked to its quantity', () => {
    const { result } = mount();
    const a = addOne(result, 'SKU-1', 'Widget', 2);
    const b = addOne(result, 'SKU-2', 'Gadget', 3);
    act(() => {
      result.current.pickLine(a.id, 2);
      result.current.pickLine(b.id, 3);
    });
    expect(result.current.fullyPicked).toBe(true);
  });

  it('allows over-picking without losing the state', () => {
    const { result } = mount();
    const line = addOne(result, 'SKU-1', 'Widget', 2);
    // Scanning can over-count; >= is the contract, not ==.
    act(() => result.current.pickLine(line.id, 5));
    expect(result.current.fullyPicked).toBe(true);
  });

  it('falls back to false when a picked line is removed', () => {
    const { result } = mount();
    const a = addOne(result, 'SKU-1', 'Widget', 1);
    addOne(result, 'SKU-2', 'Gadget', 1);
    act(() => result.current.pickLine(a.id, 1));
    // The remaining line is unpicked, so the send is not ready.
    act(() => result.current.removeLine(a.id));
    expect(result.current.fullyPicked).toBe(false);
  });
});

// ── 6. mode and picked ids ─────────────────────────────────────────────

describe('mode and picked ids', () => {
  it('switches mode without disturbing the lines', () => {
    const { result } = mount();
    addOne(result, 'SKU-1');
    act(() => result.current.setMode('send'));
    expect(result.current.mode).toBe('send');
    expect(result.current.lines).toHaveLength(1);
  });

  it('accepts each declared mode', () => {
    const { result } = mount();
    for (const m of ['receive', 'send', 'count', 'stock'] as const) {
      act(() => result.current.setMode(m));
      expect(result.current.mode).toBe(m);
    }
  });

  it('stores and clears the picked ids', () => {
    const { result } = mount();
    act(() => result.current.setDestinationLocationId('loc-9'));
    act(() => result.current.setTransferId('tr-9'));
    act(() => result.current.setPoId('po-9'));
    expect(result.current.destinationLocationId).toBe('loc-9');
    expect(result.current.transferId).toBe('tr-9');
    expect(result.current.poId).toBe('po-9');

    act(() => result.current.setDestinationLocationId(null));
    expect(result.current.destinationLocationId).toBeNull();
  });
});
