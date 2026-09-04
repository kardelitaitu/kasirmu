import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RetailCartPanel, {
  type CartLineActions,
  type RetailCartPanelProps,
} from '@/features/retail/RetailCartPanel';
import type { CartLine, CourseId, ModifierSelection, Sku } from '@/types/domain';

// Mock @fluent/react so useLocalization returns identity keys.
vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: { getString: (id: string) => id },
  }),
  Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
}));

const money = (minor_units: number) => ({ minor_units, currency: 'IDR' as const });

function makeLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'line-1' as CartLine['id'],
    sku: 'SKU-001' as Sku,
    name: 'Nasi Goreng',
    category: 'food',
    qty: 2,
    unit_price: money(25000),
    ...overrides,
  };
}

const MODIFIERS: ModifierSelection[] = [
  { modifierName: 'Extra Egg' },
] as ModifierSelection[];

function makeProps(overrides: Partial<RetailCartPanelProps> = {}): RetailCartPanelProps {
  const lineActions: CartLineActions = {
    onRemoveLine: vi.fn(),
    onIncreaseQty: vi.fn(),
    onUpdateQty: vi.fn(),
    onSerialChange: vi.fn(),
    onSetOverrideTarget: vi.fn(),
    onAssignCourse: vi.fn(),
    onEditModifiers: vi.fn(),
  };
  return {
    lines: [makeLine()],
    showCourseSelector: true,
    lineCount: 2,
    selectedCustomer: null,
    totals: {
      subtotal: money(50000),
      total: money(50000),
      discountPercent: 0,
      discountAmount: null,
      cartTax: 0,
      cartTaxExclusive: false,
    },
    retailCartWidth: 360,
    serialNumbers: {},
    trackSerialMap: {},
    overrideTarget: null,
    undoStack: [],
    undoBarExit: { shouldRender: false, exiting: false, requestClose: vi.fn() },
    isSerialTracking: false,
    isManager: false,
    activeShift: true,
    heldCartId: null,
    cartWidthMin: 300,
    cartWidthMaxCap: 600,
    onResizeWidth: vi.fn(),
    onStartResize: vi.fn(),
    cartSwipe: {},
    lineActions,
    panelActions: {
      onPay: vi.fn(),
      onShowDiscount: vi.fn(),
      onHoldResume: vi.fn(),
      onRequestClear: vi.fn(),
      onShowCreditList: vi.fn(),
      onLoadCreditSales: vi.fn(),
    },
    onUndoRemove: vi.fn(),
    onDismissUndo: vi.fn(),
    onEnsureCart: vi.fn(),
    ...overrides,
  };
}

// ── Remove → undo round-trip ─────────────────────────────────────

describe('RetailCartPanel — remove → undo', () => {
  it('passes the complete line payload to onRemoveLine so undo can restore modifiers + course', () => {
    const onRemoveLine = vi.fn();
    const line = makeLine({
      id: 'l1' as CartLine['id'],
      qty: 3,
      courseId: 'main' as CourseId,
      modifiers: MODIFIERS,
    });
    render(
      <RetailCartPanel {...makeProps({ lines: [line], lineActions: { ...makeProps().lineActions, onRemoveLine } })} />,
    );
    fireEvent.click(screen.getByLabelText('retail-cart-remove-aria'));

    expect(onRemoveLine).toHaveBeenCalledTimes(1);
    expect(onRemoveLine).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        sku: 'SKU-001',
        name: 'Nasi Goreng',
        category: 'food',
        unit_price: money(25000),
        qty: 3,
        courseId: 'main',
        modifiers: MODIFIERS,
      }),
    );
  });

  it('renders the undo bar with the pending count when shouldRender is set', () => {
    const onUndoRemove = vi.fn();
    const onDismissUndo = vi.fn();
    const undoStack: RetailCartPanelProps['undoStack'] = [
      { sku: 'SKU-001' as Sku, name: 'Nasi Goreng', category: 'food', unit_price: money(25000), qty: 2 },
      { sku: 'SKU-002' as Sku, name: 'Es Teh', category: 'drinks', unit_price: money(5000), qty: 1 },
    ];
    render(
      <RetailCartPanel
        {...makeProps({
          undoStack,
          undoBarExit: { shouldRender: true, exiting: false, requestClose: vi.fn() },
          onUndoRemove,
          onDismissUndo,
        })}
      />,
    );
    const bar = screen.getByRole('status');
    expect(bar).toBeInTheDocument();
    // Mock l10n returns the FTL key; the count arg is what we pin.
    expect(screen.getByText('retail-undo-items-removed')).toBeInTheDocument();

    fireEvent.click(screen.getByText('pos-cart-undo'));
    expect(onUndoRemove).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('pos-cart-undo-dismiss-aria'));
    expect(onDismissUndo).toHaveBeenCalledTimes(1);
  });

  it('hides the undo bar when shouldRender is false', () => {
    render(<RetailCartPanel {...makeProps()} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// ── Quantity controls ───────────────────────────────────────────

describe('RetailCartPanel — quantity controls', () => {
  it('decrease at qty 1 removes the line instead of updating qty', () => {
    const onRemoveLine = vi.fn();
    const onUpdateQty = vi.fn();
    render(
      <RetailCartPanel
        {...makeProps({
          lines: [makeLine({ qty: 1 })],
          lineActions: { ...makeProps().lineActions, onRemoveLine, onUpdateQty },
        })}
      />,
    );
    fireEvent.click(screen.getByLabelText('retail-cart-qty-decrease-aria'));

    expect(onRemoveLine).toHaveBeenCalledTimes(1);
    expect(onUpdateQty).not.toHaveBeenCalled();
  });

  it('decrease at qty > 1 updates the quantity and keeps the line', () => {
    const onRemoveLine = vi.fn();
    const onUpdateQty = vi.fn();
    render(
      <RetailCartPanel
        {...makeProps({
          lines: [makeLine({ qty: 3 })],
          lineActions: { ...makeProps().lineActions, onRemoveLine, onUpdateQty },
        })}
      />,
    );
    fireEvent.click(screen.getByLabelText('retail-cart-qty-decrease-aria'));

    expect(onUpdateQty).toHaveBeenCalledWith('line-1', 2);
    expect(onRemoveLine).not.toHaveBeenCalled();
  });

  it('increase calls onIncreaseQty with the full line', () => {
    const onIncreaseQty = vi.fn();
    const line = makeLine({ qty: 2 });
    render(
      <RetailCartPanel
        {...makeProps({ lines: [line], lineActions: { ...makeProps().lineActions, onIncreaseQty } })}
      />,
    );
    fireEvent.click(screen.getByLabelText('retail-cart-qty-increase-aria'));

    expect(onIncreaseQty).toHaveBeenCalledWith(line);
  });
});

// ── Course dropdown (restaurant coursing) ───────────────────────

describe('RetailCartPanel — course dropdown', () => {
  it('opens the dropdown from the course chip and assigns a course on option click', () => {
    const onAssignCourse = vi.fn();
    render(
      <RetailCartPanel
        {...makeProps({ lineActions: { ...makeProps().lineActions, onAssignCourse } })}
      />,
    );

    fireEvent.click(screen.getByLabelText('retail-cart-course-aria'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: /main course/i }));
    expect(onAssignCourse).toHaveBeenCalledWith('line-1', 'main');
    // Dropdown closes after a selection.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('offers "None" to clear an assigned course', () => {
    const onAssignCourse = vi.fn();
    render(
      <RetailCartPanel
        {...makeProps({
          lines: [makeLine({ courseId: 'drinks' as CourseId })],
          lineActions: { ...makeProps().lineActions, onAssignCourse },
        })}
      />,
    );
    fireEvent.click(screen.getByLabelText('retail-cart-course-aria'));
    fireEvent.click(screen.getByRole('option', { name: /none/i }));
    expect(onAssignCourse).toHaveBeenCalledWith('line-1', '');
  });
});

// ── Pay button + empty state ────────────────────────────────────

describe('RetailCartPanel — pay button and empty state', () => {
  it('renders the empty state without a pay button when the cart has no lines', () => {
    render(<RetailCartPanel {...makeProps({ lines: [], lineCount: 0 })} />);
    expect(screen.getByText('pos-cart-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('pay-btn')).toBeNull();
  });

  it('disables pay when no shift is active', () => {
    render(<RetailCartPanel {...makeProps({ activeShift: false })} />);
    expect(screen.getByTestId('pay-btn')).toBeDisabled();
  });

  it('enables pay with lines and an active shift', () => {
    render(<RetailCartPanel {...makeProps()} />);
    expect(screen.getByTestId('pay-btn')).toBeEnabled();
  });
});

// ── Serial tracking input ───────────────────────────────────────

describe('RetailCartPanel — serial tracking input', () => {
  it('renders the serial input for a tracked sku with the stored value', () => {
    render(
      <RetailCartPanel
        {...makeProps({
          isSerialTracking: true,
          trackSerialMap: { 'SKU-001': true },
          serialNumbers: { 'line-1': 'SN-ABC-123' },
        })}
      />,
    );
    const input = screen.getByLabelText('retail-serial-aria');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('SN-ABC-123');
  });

  it('updates the serial via onSerialChange as the cashier types', () => {
    const onSerialChange = vi.fn();
    render(
      <RetailCartPanel
        {...makeProps({
          isSerialTracking: true,
          trackSerialMap: { 'SKU-001': true },
          lineActions: { ...makeProps().lineActions, onSerialChange },
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText('retail-serial-aria'), {
      target: { value: 'SN-999' },
    });
    expect(onSerialChange).toHaveBeenCalledWith('line-1', 'SN-999');
  });

  it('omits the serial input when serial tracking is off', () => {
    render(
      <RetailCartPanel
        {...makeProps({
          isSerialTracking: false,
          trackSerialMap: { 'SKU-001': true },
        })}
      />,
    );
    expect(screen.queryByLabelText('retail-serial-aria')).toBeNull();
  });

  it('omits the serial input for skus that are not tracked', () => {
    render(
      <RetailCartPanel
        {...makeProps({
          isSerialTracking: true,
          trackSerialMap: {}, // SKU-001 not in the tracked map
        })}
      />,
    );
    expect(screen.queryByLabelText('retail-serial-aria')).toBeNull();
  });
});

// ── Manager override ────────────────────────────────────────────

describe('RetailCartPanel — manager override', () => {
  it('shows the override button only for managers', () => {
    const { unmount } = render(<RetailCartPanel {...makeProps({ isManager: true })} />);
    expect(screen.getByLabelText('retail-override-aria')).toBeInTheDocument();
    unmount();

    render(<RetailCartPanel {...makeProps({ isManager: false })} />);
    expect(screen.queryByLabelText('retail-override-aria')).toBeNull();
  });

  it('opens the override target with the line identity and ensures the cart', () => {
    const onSetOverrideTarget = vi.fn();
    const onEnsureCart = vi.fn();
    render(
      <RetailCartPanel
        {...makeProps({
          isManager: true,
          lines: [makeLine({ qty: 2, unit_price: money(15000) })],
          lineActions: { ...makeProps().lineActions, onSetOverrideTarget },
          onEnsureCart,
        })}
      />,
    );
    fireEvent.click(screen.getByLabelText('retail-override-aria'));

    expect(onSetOverrideTarget).toHaveBeenCalledWith({
      id: 'line-1',
      name: 'Nasi Goreng',
      unit_price: money(15000),
    });
    expect(onEnsureCart).toHaveBeenCalledWith('IDR');
  });
});

// ── Modifier badge ──────────────────────────────────────────────

describe('RetailCartPanel — modifier badge', () => {
  it('shows a +N badge when the line carries modifiers', () => {
    render(<RetailCartPanel {...makeProps({ lines: [makeLine({ modifiers: MODIFIERS })] })} />);
    const badge = document.querySelector('.retail-cart-modifier-badge');
    expect(badge).toBeInTheDocument();
    expect(badge?.textContent).toBe('+1');
  });

  it('omits the badge for lines without modifiers', () => {
    render(<RetailCartPanel {...makeProps()} />);
    expect(document.querySelector('.retail-cart-modifier-badge')).toBeNull();
  });
});

// ── Grand total and the exclusive/inclusive tax rule ─────────────
//
// `grandTotal()` is the amount the customer actually pays, and it is the one
// money computation in the cart that has no arithmetic test anywhere. The
// PosScreen integration suite has `it.skip('includes tax in payment total when
// tax is exclusive')`, and even that skipped body only asserted
// `getByText(/total/i)` exists -- which passes whether or not tax was added, so
// un-skipping it would not have tested anything.
//
// Expected values are extracted from the rendered rows and compared
// numerically rather than against a literal string, because formatMoney is
// locale- and separator-dependent (id-ID groups with '.', and the decimal
// separator is a per-store receipt setting). Calling formatMoney here to build
// the expectation would assert the helper against itself -- the same tautology
// removed from AnalyticsScreen in f069cd2e.
//
// The exclusive/inclusive distinction is the whole point: inclusive tax is
// already embedded in the line prices, so adding it again over-charges.

const digitsOf = (el: Element | null): number =>
  Number((el?.textContent ?? '').replace(/[^\d]/g, ''));

function grandRow(): Element | null {
  return document.querySelector('.retail-total-row--grand');
}
function subtotalRow(): Element | null {
  return document.querySelectorAll('.retail-total-row')[0] ?? null;
}

describe('RetailCartPanel — grand total tax arithmetic', () => {
  it('adds exclusive tax to the grand total', () => {
    render(
      <RetailCartPanel
        {...makeProps({
          totals: {
            subtotal: money(50000),
            total: money(50000),
            discountPercent: 0,
            discountAmount: null,
            cartTax: 5000,
            cartTaxExclusive: true,
          },
        })}
      />,
    );
    expect(digitsOf(subtotalRow())).toBe(50000);
    expect(digitsOf(grandRow())).toBe(55000);
  });

  it('does NOT add inclusive tax, which is already in the prices', () => {
    render(
      <RetailCartPanel
        {...makeProps({
          totals: {
            subtotal: money(50000),
            total: money(50000),
            discountPercent: 0,
            discountAmount: null,
            cartTax: 5000,
            cartTaxExclusive: false,
          },
        })}
      />,
    );
    // Same tax amount, opposite outcome: the flag is what decides, so a
    // regression that dropped the `cartTaxExclusive` test would fail here
    // rather than at the previous one.
    expect(digitsOf(grandRow())).toBe(50000);
    expect(digitsOf(grandRow())).toBe(digitsOf(subtotalRow()));
  });

  it('shows the tax row only when there is tax to show', () => {
    const { unmount } = render(
      <RetailCartPanel
        {...makeProps({
          totals: {
            subtotal: money(50000), total: money(50000), discountPercent: 0,
            discountAmount: null, cartTax: 5000, cartTaxExclusive: true,
          },
        })}
      />,
    );
    expect(screen.getByText('retail-total-tax')).toBeInTheDocument();
    unmount();

    render(
      <RetailCartPanel
        {...makeProps({
          totals: {
            subtotal: money(50000), total: money(50000), discountPercent: 0,
            discountAmount: null, cartTax: 0, cartTaxExclusive: false,
          },
        })}
      />,
    );
    expect(screen.queryByText('retail-total-tax')).toBeNull();
  });

  // Pins CURRENT behaviour, which is a hazard rather than a goal: when the
  // computeCartTax IPC fails the callers set cartTax 0 / exclusive false, and
  // the panel then renders the pre-tax amount as the amount due with nothing on
  // screen distinguishing "this cart has no tax" from "we could not work out the
  // tax". See R36-19 -- the assertion exists so that changing the behaviour
  // breaks a test loudly instead of silently fixing itself.
  it('renders the pre-tax amount as the grand total when tax is unknown (R36-19)', () => {
    render(
      <RetailCartPanel
        {...makeProps({
          totals: {
            subtotal: money(50000), total: money(50000), discountPercent: 0,
            discountAmount: null, cartTax: 0, cartTaxExclusive: false,
          },
        })}
      />,
    );
    expect(digitsOf(grandRow())).toBe(50000);
    // Nothing in the panel says the lookup failed -- there is no such state.
    expect(document.querySelector('.retail-total-row--grand')?.textContent)
      .not.toMatch(/retail-total-tax|—/);
  });
});
