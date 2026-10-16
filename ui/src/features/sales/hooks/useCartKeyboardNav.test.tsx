// ── Cart keyboard navigation: arrow / qty / delete / Enter-to-pay ───────────
//
// THE COVERAGE THIS FILE ADDS, and why it was missing.
//
// `useCartKeyboardNav` is 134 lines of reachable logic on the POS cart: ArrowUp/ArrowDown
// move focus between lines, +/= and -/_ change quantity on the focused line,
// Delete/Backspace remove it, and Enter PAYS. None of it had a behavioural test.
//
// The reason is a mocking boundary rather than neglect. `CartPanel.test.tsx:275` passes
// `handleCartPanelKeyDown: vi.fn()` and asserts only that the panel CALLED it
// (`:288`) — so the panel-to-handler wiring is covered and the HANDLER ITSELF is not.
// The hook own header claimed the opposite: "the keyboard tests pin down" the memo
// boundary. Grepping the repo for the hook name, `handleCartPanelKeyDown` or
// `cartLineRefs` returns no test that exercises a single branch of it. That comment was
// wrong, and this suite is what makes it true.
//
// Two branches here are money-facing rather than convenience:
//   * Enter calls `handlePay` — a stray Enter in the cart paying an empty sale would be
//     the worst failure in the set, which is why it is gated on `total`;
//   * +, - and Delete resolve the line from a `data-line-id` ANCESTOR, because the key
//     bubbles from a button inside the row — so a mis-resolved id would silently adjust
//     or remove the WRONG line.

import { describe, expect, it, vi } from 'vitest';
import { renderHookInAct } from '@/test-utils/renderInAct';
import { useCartKeyboardNav } from '@/features/sales/hooks/useCartKeyboardNav';
import type { CartLine, LineId, Sku } from '@/types/domain';

/** A cart line with only the fields this hook reads. */
function line(id: string, sku = "SKU-1"): CartLine {
  return {
    id: id as LineId,
    sku: sku as Sku,
    name: sku,
    qty: 1,
    unit_price: { minor_units: 1_000, currency: "IDR" },
  };
}

/**
 * A DOM row the handler can resolve, since it reads `closest([data-line-id])`.
 * Returns the element to dispatch the key ON — a child of the row, which is how a real
 * keypress arrives (the row contains buttons).
 */
function row(id: string): { rowEl: HTMLDivElement; child: HTMLButtonElement } {
  const rowEl = document.createElement("div");
  rowEl.setAttribute("data-line-id", id);
  const child = document.createElement("button");
  rowEl.appendChild(child);
  document.body.appendChild(rowEl);
  return { rowEl, child };
}

/** An ATTACHED, focusable div — so `document.activeElement` is a meaningful assertion. */
function focusableDiv(): HTMLDivElement {
  const el = document.createElement("div");
  el.tabIndex = 0;
  document.body.appendChild(el);
  return el;
}

/** Minimal React keydown shape: the handler reads `key`, `target` and calls preventDefault. */
function key(k: string, target: HTMLElement) {
  let prevented = false;
  return {
    ev: {
      key: k,
      target,
      preventDefault: () => { prevented = true; },
    },
    wasPrevented: () => prevented,
  };
}

interface Harness {
  refs: Map<LineId, HTMLDivElement>;
}

function harness(): Harness {
  return { refs: new Map<LineId, HTMLDivElement>() };
}

describe("useCartKeyboardNav — the cart key handler", () => {
  it("ArrowDown moves focus to the NEXT line, and to the first when nothing is focused", async () => {
    // The stubs are ATTACHED and given tabIndex so they are genuinely focusable. My first
    // version spied on a detached div focus method and asserted document.activeElement --
    // which can never become a detached, non-focusable node, so the assertion failed for a
    // harness reason and looked like a product failure.
    const h = harness();
    const lines = [line("a"), line("b"), line("c")];
    const first = focusableDiv();
    const second = focusableDiv();
    h.refs.set("a" as LineId, first);
    h.refs.set("b" as LineId, second);

    const { result } = await renderHookInAct(() =>
      useCartKeyboardNav({
        cartLineRefs: { current: h.refs },
        lines,
        total: { minor_units: 3_000, currency: "IDR" },
        handlePay: vi.fn(),
        handleIncreaseQty: vi.fn(),
        handleDecreaseQty: vi.fn(),
        handleRemoveLine: vi.fn(),
      }),
    );

    // Nothing focused -> start at the TOP. This is the `focusedIdx < 0` arm.
    const outside = focusableDiv();
    const start = key("ArrowDown", outside);
    result.current.handleCartPanelKeyDown(start.ev as never);
    expect(document.activeElement).toBe(first);

    // A row IS focused -> advance by one.
    const { child } = row("a");
    const next = key("ArrowDown", child);
    result.current.handleCartPanelKeyDown(next.ev as never);
    expect(document.activeElement).toBe(second);
  });

  it("ArrowUp from nothing focuses the LAST line — the mirror of ArrowDown", async () => {
    const h = harness();
    const lines = [line("a"), line("b"), line("c")];
    const last = focusableDiv();
    h.refs.set("c" as LineId, last);

    const { result } = await renderHookInAct(() =>
      useCartKeyboardNav({
        cartLineRefs: { current: h.refs },
        lines,
        total: null,
        handlePay: vi.fn(),
        handleIncreaseQty: vi.fn(),
        handleDecreaseQty: vi.fn(),
        handleRemoveLine: vi.fn(),
      }),
    );

    const outside = focusableDiv();
    const k = key("ArrowUp", outside);
    result.current.handleCartPanelKeyDown(k.ev as never);
    expect(document.activeElement).toBe(last);
  });

  it("ignores every key while focus is in an INPUT, so typing is never hijacked", async () => {
    const handleIncreaseQty = vi.fn();
    const handlePay = vi.fn();
    const h = harness();

    const { result } = await renderHookInAct(() =>
      useCartKeyboardNav({
        cartLineRefs: { current: h.refs },
        lines: [line("a")],
        total: { minor_units: 1_000, currency: "IDR" },
        handlePay,
        handleIncreaseQty,
        handleDecreaseQty: vi.fn(),
        handleRemoveLine: vi.fn(),
      }),
    );

    // A qty field lives INSIDE a line row, so the row resolves — the input guard is the
    // only thing standing between "+" in a text field and an unintended quantity bump.
    const { rowEl, child } = row("a");
    const input = document.createElement("input");
    rowEl.appendChild(input);

    // POSITIVE CONTROL FIRST. This case asserts only negatives, so a handler that never
    // ran at all would satisfy it — measured: with `handleCartPanelKeyDown` replaced by a
    // no-op, this case still passed. Pressing the same key on the ROW (not the input)
    // proves the handler is live before the guard is asserted.
    const onRow = key("+", child);
    result.current.handleCartPanelKeyDown(onRow.ev as never);
    expect(
      handleIncreaseQty,
      "control: + on the row DOES change a quantity, so the guard below is meaningful",
    ).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    handleIncreaseQty.mockClear();

    const k = key("+", input);
    result.current.handleCartPanelKeyDown(k.ev as never);
    expect(handleIncreaseQty, "a + typed in a field must not change a quantity").not.toHaveBeenCalled();

    const enter = key("Enter", input);
    result.current.handleCartPanelKeyDown(enter.ev as never);
    expect(handlePay, "Enter in a field must not pay").not.toHaveBeenCalled();
  });

  it("Enter pays, but ONLY when there is a total", async () => {
    const handlePay = vi.fn();
    const h = harness();

    const withTotal = await renderHookInAct(() =>
      useCartKeyboardNav({
        cartLineRefs: { current: h.refs },
        lines: [line("a")],
        total: { minor_units: 5_000, currency: "IDR" },
        handlePay,
        handleIncreaseQty: vi.fn(),
        handleDecreaseQty: vi.fn(),
        handleRemoveLine: vi.fn(),
      }),
    );
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const k = key("Enter", outside);
    withTotal.result.current.handleCartPanelKeyDown(k.ev as never);
    expect(handlePay, "Enter pays when a total exists").toHaveBeenCalledTimes(1);

    // THE GATE: with no total there is nothing to pay for, and Enter must do nothing.
    // This is the money-facing half — paying an empty sale is the worst outcome here.
    handlePay.mockClear();
    const withoutTotal = await renderHookInAct(() =>
      useCartKeyboardNav({
        cartLineRefs: { current: h.refs },
        lines: [],
        total: null,
        handlePay,
        handleIncreaseQty: vi.fn(),
        handleDecreaseQty: vi.fn(),
        handleRemoveLine: vi.fn(),
      }),
    );
    const k2 = key("Enter", outside);
    withoutTotal.result.current.handleCartPanelKeyDown(k2.ev as never);
    expect(handlePay, "Enter must not pay with no total").not.toHaveBeenCalled();
  });

  it("resolves the line from the data-line-id ANCESTOR, not the event target", async () => {
    // The key arrives from a BUTTON inside the row, so the target is not the row. A
    // mis-resolved id would adjust or delete the WRONG line, which is why this is
    // asserted by identity rather than by call count.
    const handleIncreaseQty = vi.fn();
    const handleDecreaseQty = vi.fn();
    const handleRemoveLine = vi.fn();
    const h = harness();
    const target = line("b", "SKU-B");

    const { result } = await renderHookInAct(() =>
      useCartKeyboardNav({
        cartLineRefs: { current: h.refs },
        lines: [line("a", "SKU-A"), target, line("c", "SKU-C")],
        total: null,
        handlePay: vi.fn(),
        handleIncreaseQty,
        handleDecreaseQty,
        handleRemoveLine,
      }),
    );

    const { child } = row("b");

    const plus = key("+", child);
    result.current.handleCartPanelKeyDown(plus.ev as never);
    expect(handleIncreaseQty).toHaveBeenCalledWith(target);

    const minus = key("-", child);
    result.current.handleCartPanelKeyDown(minus.ev as never);
    expect(handleDecreaseQty).toHaveBeenCalledWith(target);

    const del = key("Delete", child);
    result.current.handleCartPanelKeyDown(del.ev as never);
    expect(handleRemoveLine).toHaveBeenCalledWith(target);
  });

  it("does nothing for + / - / Delete when no line is under the key", async () => {
    // Without this the previous case would pass even if the handler ignored the id and
    // always acted on `lines[0]`.
    const handleIncreaseQty = vi.fn();
    const handleRemoveLine = vi.fn();
    const h = harness();

    const { result } = await renderHookInAct(() =>
      useCartKeyboardNav({
        cartLineRefs: { current: h.refs },
        lines: [line("a")],
        total: null,
        handlePay: vi.fn(),
        handleIncreaseQty,
        handleDecreaseQty: vi.fn(),
        handleRemoveLine,
      }),
    );

    // POSITIVE CONTROL FIRST — see the input-guard case for the measurement. This case is
    // negative-only, so it passed against a no-op handler until this line was added.
    const { child } = row("a");
    const onLine = key("+", child);
    result.current.handleCartPanelKeyDown(onLine.ev as never);
    expect(handleIncreaseQty, "control: + INSIDE a row does act").toHaveBeenCalledTimes(1);
    handleIncreaseQty.mockClear();

    const outside = focusableDiv();
    for (const k of ["+", "-", "Delete"]) {
      const ev = key(k, outside);
      result.current.handleCartPanelKeyDown(ev.ev as never);
    }
    expect(handleIncreaseQty).not.toHaveBeenCalled();
    expect(handleRemoveLine).not.toHaveBeenCalled();
  });

  it("does not preventDefault on a key it does not handle", async () => {
    // preventDefault on an unrelated key would swallow browser and screen-reader
    // behaviour on the whole cart surface.
    const h = harness();
    const { result } = await renderHookInAct(() =>
      useCartKeyboardNav({
        cartLineRefs: { current: h.refs },
        lines: [line("a")],
        total: null,
        handlePay: vi.fn(),
        handleIncreaseQty: vi.fn(),
        handleDecreaseQty: vi.fn(),
        handleRemoveLine: vi.fn(),
      }),
    );
    // POSITIVE CONTROL FIRST — this case is negative-only and passed against a no-op.
    // A HANDLED key must still be consumed, so `false` below means "not handled", not
    // "the handler never ran".
    const focused = focusableDiv();
    const handled = key("ArrowDown", focused);
    result.current.handleCartPanelKeyDown(handled.ev as never);
    expect(handled.wasPrevented(), "control: a handled key IS consumed").toBe(true);

    const k = key("Tab", focused);
    result.current.handleCartPanelKeyDown(k.ev as never);
    expect(k.wasPrevented(), "an unhandled key must not be consumed").toBe(false);
  });
});