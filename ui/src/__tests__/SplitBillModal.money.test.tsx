// ── A split must conserve the bill: every unit once, never twice ─────────
//
// `SplitBillModal` partitions a cart into the lines to PAY now and the lines to
// keep on the tab, and the partition is the money. The modal had a render smoke
// test and NO arithmetic test, so this file pins the properties that make the
// feature safe:
//
//   1. CONSERVATION. Per line, the quantity sent to payment plus the quantity kept
//      on the tab equals what was ordered — exactly. A shortfall is a lost charge;
//      a duplicate is a DOUBLE charge, the worse direction, and the one the
//      parent's create-first ordering already trades against.
//   2. THE CEILING. A line cannot be selected for more than it holds.
//      `updateLineQty` clamps to `line.qty` (:74) AND the increase button is
//      `disabled={count >= line.qty}` (:224) — two doors to the same rule, so both
//      are asserted.
//
// The percentages are deliberately NOT asserted as summing to a whole: there is no
// backend split model (grep 'split_bill' under crates/ → 0 hits), so each half is a
// separate SALE with its own discount/tip/service charge and its own per-sale
// `Math.floor`. Asserting the halves sum exactly would claim a contract the system
// does not have.

import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { withFluent } from '@/i18n/test-utils';
import type { ReactElement } from 'react';
import salesFtl from '@/locales/sales.ftl?raw';
import { SplitBillModal } from '@/features/sales/components/SplitBillModal';
import type { CartLine } from '@/types/domain';

function line(id: string, name: string, qty: number, unitMinor: number): CartLine {
  return {
    id: id as never,
    sku: name as never,
    name,
    qty,
    unit_price: { minor_units: unitMinor, currency: 'IDR' },
  } as CartLine;
}

/**
 * Typed with its arguments: a bare `vi.fn()` records no parameter list, so
 * `mock.calls[0]` is typed `[]` and cannot be destructured into the pair the
 * assertions read — the typecheck rejects the cast rather than letting a wrong
 * runtime value through.
 */
type ConfirmSplit = (selected: CartLine[], remaining: CartLine[]) => Promise<boolean | void> | boolean | void;

function makeConfirmSplit(): ConfirmSplit & { mock: { calls: [CartLine[], CartLine[]][] } } {
  // Declared with its parameters so `mock.calls[0]` is a typed pair. A bare
  // `vi.fn()` infers no parameter list and the destructuring below would need a
  // cast the typecheck rightly rejects.
  const impl = vi.fn(async (_selected: CartLine[], _remaining: CartLine[]) => true) as unknown as
    ConfirmSplit & { mock: { calls: [CartLine[], CartLine[]][] } };
  return impl;
}

function renderModal(lines: CartLine[], onConfirmSplit: ConfirmSplit = makeConfirmSplit()) {
  return {
    onConfirmSplit,
    ...render(
      withFluent(
        (<SplitBillModal
          isOpen
          onClose={vi.fn()}
          lines={lines}
          currency="IDR"
          tableNumber="Table 7"
          onConfirmSplit={onConfirmSplit}
        />) as ReactElement,
        salesFtl,
      ),
    ),
  };
}

/** The "selected / ordered" readout for a line, e.g. 1 / 3. */
function qtyPairOf(name: string): [number, number] {
  const row = screen.getByText(name).closest('.pos-split-item-row') as HTMLElement;
  const text = within(row).getByText(/\d+\s*\/\s*\d+/).textContent ?? '';
  const [sel, ord] = text.split('/').map((s) => Number(s.trim()));
  return [sel!, ord!];
}

describe('SplitBillModal — the split conserves the bill', () => {
  it('sends every unit exactly once when the whole bill is selected', async () => {
    const lines = [line('l1', 'Nasi Goreng', 2, 25000), line('l2', 'Es Teh', 3, 5000)];
    const onConfirmSplit = makeConfirmSplit();
    renderModal(lines, onConfirmSplit);

    // Select each line IN FULL via its stepper's ceiling press. `toggleLineFull`
    // is wired to the row's info area (:190) but the name div also carries the text, so
    // driving the documented increase control is unambiguous — and it exercises the
    // clamp path the ceiling case below asserts, rather than a second way in.
    for (const [name, qty] of [['Nasi Goreng', 2], ['Es Teh', 3]] as const) {
      const inc = screen.getByLabelText(`Increase ${name}`) as HTMLButtonElement;
      for (let i = 0; i < qty; i += 1) fireEvent.click(inc);
      expect(qtyPairOf(name), `${name} must reach its ceiling`).toEqual([qty, qty]);
      expect(inc.disabled, 'the control disables at the ceiling').toBe(true);
    }

    fireEvent.click(screen.getByTestId('pos-split-modal-confirm-btn'));
    await vi.waitFor(() => expect(onConfirmSplit).toHaveBeenCalled());

    const [selected, remaining] = onConfirmSplit.mock.calls[0]!;
    const units = (ls: CartLine[]) => ls.reduce((s, l) => s + l.qty, 0);

    expect(units(selected) + units(remaining), 'every unit once').toBe(2 + 3);
    expect(remaining, 'all units selected leaves no remainder').toHaveLength(0);
    // And the money going to payment is the whole bill.
    expect(selected.reduce((s, l) => s + l.unit_price.minor_units * l.qty, 0)).toBe(
      2 * 25000 + 3 * 5000,
    );
  });

  it('confirms once when the confirm button is double-tapped', async () => {
    // A replay bills the SAME selected partition twice: the caller turns each half into
    // its own sale. The button's `state` flips to 'processing' only on the next render,
    // so both taps inside one tick reach the handler.
    const lines = [line('l1', 'Nasi Goreng', 2, 25000)];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((res) => { release = res; });
    const onConfirmSplit = vi.fn(() => gate.then(() => true)) as unknown as ConfirmSplit;
    renderModal(lines, onConfirmSplit);

    // A selection that is neither empty (confirm refuses) nor the whole bill: the first
    // line is auto-selected IN FULL, so the increase control starts at its ceiling and
    // step DOWN once, then back UP once — 1 of 2 units go to payment.
    fireEvent.click(screen.getByLabelText('Decrease Nasi Goreng'));
    fireEvent.click(screen.getByLabelText('Increase Nasi Goreng'));
    expect(qtyPairOf('Nasi Goreng')).toEqual([1, 2]);

    // Dispatch both clicks BEFORE react-testing-library wraps the first in act() and
    // flushes a render: a flush in between would re-render the button as 'processing',
    // which disables it and the second click would prove nothing.
    const confirmBtn = screen.getByTestId('pos-split-modal-confirm-btn');
    await act(async () => {
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);
    });

    release?.();
    await vi.waitFor(() => expect(onConfirmSplit).toHaveBeenCalledTimes(1));
  });

  it('refuses to select more units than the line holds', () => {
    renderModal([line('l1', 'Nasi Goreng', 2, 25000)]);

    // The modal AUTO-SELECTS the first line at qty 1 (:63-65), so the starting
    // state is 1 / 2, not 0 / 2. That pre-selection is itself the defect pinned below,
    // and it is why a bare "one press" reading is 2 rather than 1.
    expect(qtyPairOf('Nasi Goreng'), 'the modal opens with the first line pre-selected').toEqual([1, 2]);

    const inc = screen.getByLabelText('Increase Nasi Goreng') as HTMLButtonElement;
    fireEvent.click(inc);
    expect(qtyPairOf('Nasi Goreng')).toEqual([2, 2]);

    fireEvent.click(inc);
    expect(qtyPairOf('Nasi Goreng')).toEqual([2, 2]);

    // The DOM refuses the third press — the visible half of the clamp.
    expect(inc.disabled, 'the increase control disables at the ceiling').toBe(true);
    // And a dispatch anyway cannot exceed it: the handler clamps (SplitBillModal.tsx:74).
    fireEvent.click(inc);
    expect(qtyPairOf('Nasi Goreng'), 'the handler clamp is the second door').toEqual([2, 2]);
  });

  it('auto-selecting the first line does not defeat the select-all tap', async () => {
    // THE DEFECT THIS PINS: on open the modal selects line[0] at qty 1 (:63-65), and
    // `toggleLineFull` (:79-85) decides "select all" from `current === 0`. With the
    // first line pre-set to 1 the tap reads it as DESELECT and sets 0 — so the waiter
    // taps a row expecting "take this whole item" and gets "take none of it".
    //
    // The pre-selection is deliberate ("so the user immediately sees how it works",
    // :62-63), so the fix belongs in `toggleLineFull`, not in removing the nice
    // default: when a line already has SOME units chosen, a tap should go to the
    // CEILING rather than to zero. A tap that empties a partially-chosen line is the
    // one reading the waiter does not expect.
    renderModal([line('l1', 'Nasi Goreng', 3, 25000)]);

    // The auto-selected first line, at 1 of 3.
    expect(qtyPairOf('Nasi Goreng')).toEqual([1, 3]);

    // Tap the row's info area — the "take the whole item" gesture.
    fireEvent.click(screen.getByText('Nasi Goreng'));

    expect(
      qtyPairOf('Nasi Goreng'),
      'a tap on a partially-selected line must take it to full, not clear it — the '
      + 'waiter asked for the whole item and got none of it',
    ).toEqual([3, 3]);
  });

  it('keeps the remainder when only part of a line is selected', async () => {
    const onConfirmSplit = makeConfirmSplit();
    renderModal([line('l1', 'Nasi Goreng', 3, 25000)], onConfirmSplit);

    // 1 of 3 to payment, 2 stay on the tab. The first line is pre-selected at 1,
    // so one press is not needed to reach that state — assert the starting state and
    // confirm directly, which is what "hold one unit back" actually means here.
    expect(qtyPairOf('Nasi Goreng')).toEqual([1, 3]);

    fireEvent.click(screen.getByTestId('pos-split-modal-confirm-btn'));
    await vi.waitFor(() => expect(onConfirmSplit).toHaveBeenCalled());

    const [selected, remaining] = onConfirmSplit.mock.calls[0]!;
    expect(selected[0]!.qty).toBe(1);
    expect(remaining[0]!.qty).toBe(2);
    // CONSERVATION as money: 1 paid + 2 kept = the 3 ordered.
    expect(selected[0]!.qty + remaining[0]!.qty).toBe(3);
    expect(remaining[0]!.unit_price.minor_units * remaining[0]!.qty).toBe(50000);
  });

  it('clamps dispatchedQty to each partition quantity so dispatchedQty never exceeds qty', async () => {
    const itemWithDispatch = {
      ...line('l1', 'Ribeye Steak', 3, 150000),
      dispatchedQty: 3,
    };
    const onConfirmSplit = makeConfirmSplit();
    renderModal([itemWithDispatch], onConfirmSplit);

    // Starting state is 1 of 3 selected, 2 remaining
    fireEvent.click(screen.getByTestId('pos-split-modal-confirm-btn'));
    await vi.waitFor(() => expect(onConfirmSplit).toHaveBeenCalled());

    const [selected, remaining] = onConfirmSplit.mock.calls[0]!;
    expect(selected[0]!.qty).toBe(1);
    expect(selected[0]!.dispatchedQty).toBe(1);

    expect(remaining[0]!.qty).toBe(2);
    expect(remaining[0]!.dispatchedQty).toBe(2);
  });
});
