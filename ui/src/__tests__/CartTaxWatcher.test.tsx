import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { withFluent } from '@/locales/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import {
  CartTaxWatcher,
  IDLE_TAX_STATE,
} from '@/features/pos/components/CartTaxWatcher';
import type { CartTaxCacheState } from '@/hooks/useCartTax';
import type { CartLineTaxInput } from '@/api/tax';

// ── CartTaxWatcher contract tests ────────────────────────────────────
//
// WHAT THIS COMPONENT ACTUALLY IS, measured (CartTaxWatcher.tsx, 34 ln):
// a headless child. It calls useCartTax, pushes the returned state out of
// the tree through the onState effect, and returns null at :33. It renders
// NOTHING. A planning doc claimed the tax badge renders here — it does not:
// the PPN row, the pos-cart-tax-estimated marker and the role=status retry
// affordance all live in CartFooterTotals.tsx (:316-332), and case 1 below
// pins that split permanently.
//
// The hook is the component's only collaborator and its only input, so the
// hook is mocked (the repo's pattern — see AppShell.test.tsx's vi.mock of
// useTerminalProfile / useIdleTimer). That keeps these tests about THIS
// file's contract — forward args untouched, report every state change once,
// never stampede, report again on remount — instead of re-testing
// useCartTax's cache, which has its own suite at hooks/useCartTax.test.ts.
//
// withFluent + the production sales.ftl are kept for harness parity with the
// sibling cart tests; the component never touches l10n, which is exactly why
// the null-render assertion below is provider-independent.

const { useCartTaxMock } = vi.hoisted(() => ({ useCartTaxMock: vi.fn() }));

vi.mock('@/hooks/useCartTax', () => ({
  useCartTax: (token: string | null, lines: unknown[], currency: string) =>
    useCartTaxMock(token, lines, currency),
}));

const LINES: CartLineTaxInput[] = [
  { sku: 'SKU-1', qty: 2, unit_price_minor: 15000 },
];

const OK_STATE: CartTaxCacheState = {
  severity: 'ok',
  taxMinor: 6000,
  hasExclusive: true,
  estimated: false,
  cacheFresh: true,
};

function renderWatcher(props: {
  sessionToken?: string | null;
  lines?: CartLineTaxInput[];
  currency?: string;
  onState?: (state: CartTaxCacheState) => void;
} = {}) {
  const onState = props.onState ?? vi.fn();
  const result = render(
    withFluent(
      <CartTaxWatcher
        sessionToken={props.sessionToken === undefined ? 'tok-1' : props.sessionToken}
        lines={props.lines ?? LINES}
        currency={props.currency ?? 'IDR'}
        onState={onState}
      />,
      salesFtl,
    ),
  );
  return { ...result, onState };
}

beforeEach(() => {
  useCartTaxMock.mockReset();
  useCartTaxMock.mockReturnValue(IDLE_TAX_STATE);
});

describe('CartTaxWatcher', () => {
  it('renders no DOM whatsoever and exposes no status, badge, or amount node', () => {
    const { container, onState, baseElement } = renderWatcher();

    // Mounted and reported, so the emptiness below is a choice, not a crash.
    expect(onState).toHaveBeenCalledTimes(1);
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeNull();
    expect(container.childNodes).toHaveLength(0);
    expect(container.innerHTML).toBe('');
    // The doc error, pinned: nothing tax-shaped is emitted from here. The
    // PPN row / estimated marker / role=status live in CartFooterTotals.
    expect(baseElement.querySelector('.pos-cart-tax-row')).toBeNull();
    expect(baseElement.querySelector('.pos-cart-tax-estimated')).toBeNull();
    expect(baseElement.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(container.ownerDocument.body.textContent).toBe('');
  });

  it('exports IDLE_TAX_STATE as the exact zero-value every consumer seeds from', () => {
    // toEqual on the whole literal pins keys AND values: a new required
    // CartTaxCacheState field that IDLE_TAX_STATE fails to carry, or a flip
    // of any of these five, breaks this file's consumers at once.
    expect(IDLE_TAX_STATE).toEqual({
      severity: 'unknown',
      taxMinor: 0,
      hasExclusive: null,
      estimated: false,
      cacheFresh: false,
    });
    // The three readings PosScreen.tsx:456-462 derives from it — 0 tax shown,
    // no exclusive add-on, and NOT cacheFresh, which is what marks a non-null
    // cart's figure as an estimate. BINDING (D64 b): cacheFresh false must
    // keep this tax out of the tender total.
    expect(IDLE_TAX_STATE.taxMinor).toBe(0);
    expect(IDLE_TAX_STATE.hasExclusive ?? false).toBe(false);
    expect(IDLE_TAX_STATE.cacheFresh).toBe(false);
    expect(IDLE_TAX_STATE.severity).not.toBe('ok');
  });

  it('hands the hook its props untouched and publishes the state it gets back', () => {
    const { onState } = renderWatcher({ currency: 'IDR' });

    // Same identity for the lines array: the watcher must not map, copy or
    // sort the cart, because useCartTax keys its cache on a signature of it.
    expect(useCartTaxMock).toHaveBeenCalledTimes(1);
    expect(useCartTaxMock.mock.calls[0]?.[0]).toBe('tok-1');
    expect(useCartTaxMock.mock.calls[0]?.[1]).toBe(LINES);
    expect(useCartTaxMock.mock.calls[0]?.[2]).toBe('IDR');
    // Out, verbatim — no reshaping on the way through the effect.
    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenCalledWith(IDLE_TAX_STATE);
  });

  it('publishes every state change once and stays silent when the state object is unchanged', () => {
    const onState = vi.fn();
    useCartTaxMock.mockReturnValue(IDLE_TAX_STATE);
    const { rerender } = renderWatcher({ onState });
    expect(onState).toHaveBeenCalledTimes(1);

    // Re-render with an identical state reference: the effect deps are
    // [state, onState], so nothing may be published. This is the no-stampede
    // half of the contract — a screen re-renders on every keystroke.
    rerender(
      withFluent(
        <CartTaxWatcher
          sessionToken="tok-1"
          lines={LINES}
          currency="IDR"
          onState={onState}
        />,
        salesFtl,
      ),
    );
    expect(onState).toHaveBeenCalledTimes(1);

    // unknown -> ok: the fresh compute must reach the screen exactly once.
    useCartTaxMock.mockReturnValue(OK_STATE);
    rerender(
      withFluent(
        <CartTaxWatcher
          sessionToken="tok-1"
          lines={LINES}
          currency="IDR"
          onState={onState}
        />,
        salesFtl,
      ),
    );
    expect(onState).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenLastCalledWith(OK_STATE);
  });

  it('reports again on remount, which is the whole retry mechanism behind key={taxRetryNonce}', () => {
    const first = vi.fn();
    const mountOne = renderWatcher({ onState: first });
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(IDLE_TAX_STATE);
    mountOne.unmount();

    // The retry affordance is a fresh mount with identical props
    // (PosScreen.tsx:686). Nothing about the props changed, so the only thing
    // a remount can be relied on to do is re-run the effect and re-publish.
    useCartTaxMock.mockReturnValue(OK_STATE);
    const second = vi.fn();
    renderWatcher({ onState: second });
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(OK_STATE);
    // A null session token is forwarded as-is too — the hook owns what that
    // means (it resets to its unknown state); the watcher must not gate it.
    const third = vi.fn();
    useCartTaxMock.mockReturnValue(IDLE_TAX_STATE);
    renderWatcher({ sessionToken: null, onState: third });
    expect(useCartTaxMock.mock.calls[useCartTaxMock.mock.calls.length - 1]?.[0]).toBeNull();
    expect(third).toHaveBeenCalledWith(IDLE_TAX_STATE);
  });
});
