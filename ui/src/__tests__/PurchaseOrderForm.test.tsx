import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, render, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import { ToastProvider } from '@/components/Toast';
import poFtl from '@/locales/purchasing.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

// Mock the purchasing API — use vi.fn() inline to avoid hoisting issues.
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-test', activeWorkspace: null, logout: vi.fn() }),
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/api/purchasing', () => ({
  createPurchaseOrder: vi.fn(),
  listSuppliers: vi.fn(),
}));

// Line totals render via the store default currency (USD fixtures → 45.00).
// Mutable so a case can bill the store in another currency — the form is meant to
// follow it (minorUnitExponent), and the placeholder is part of that contract.
const currencyState = vi.hoisted(() => ({ code: 'USD' }));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: currencyState.code, setCurrency: vi.fn(), loading: false }),
}));

import PurchaseOrderForm from '@/features/purchasing/PurchaseOrderForm';
import { createPurchaseOrder, listSuppliers } from '@/api/purchasing';

const mockCreatePO = createPurchaseOrder as ReturnType<typeof vi.fn>;
const mockListSuppliers = listSuppliers as ReturnType<typeof vi.fn>;

// Fluent bundle for the PurchaseOrderForm component.
const poBundle = new FluentBundle('en-US');
poBundle.addResource(new FluentResource(poFtl));
poBundle.addResource(new FluentResource(sharedFtl));
const poL10n = new ReactLocalization([poBundle]);

/**
 * Fluent wraps every interpolated variable in Unicode bidi ISOLATE characters
 * (U+2068/U+2069), so a placeholder built from `{ $currency }` never matches a plain
 * string. Same helper the POS integration suite carries for the same reason.
 */
function stripIsolates(text: string): string {
  return text.replace(/[\u2068\u2069]/g, '');
}

// Wrapper to provide Fluent + render.
function renderForm(el: React.ReactElement): ReturnType<typeof render> {
  return render(
    <LocalizationProvider l10n={poL10n}>
      <ToastProvider>{el}</ToastProvider>
    </LocalizationProvider>,
  );
}

// Sample supplier data for the dropdown.
const sampleSuppliers = [
  { id: 'sup-1', code: 'SUP001', name: 'Acme Corp', status: 'active' },
  { id: 'sup-2', code: 'SUP002', name: 'Global Goods', status: 'active' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function fillField(placeholder: string | RegExp, value: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
}

function clickButton(name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

async function selectOption(_label: string | RegExp, value: string) {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole('combobox'), value);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PurchaseOrderForm', () => {
  beforeEach(() => {
    mockListSuppliers.mockResolvedValue(sampleSuppliers);
  });

  it('renders the form with title and fields', async () => {
    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByText('New Purchase Order')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('PO-001')).toBeInTheDocument();
    expect(screen.getByText('-- Select --')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add Line' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create po/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('loads suppliers into the dropdown', async () => {
    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    // Suppliers are loaded async.
    expect(mockListSuppliers).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(screen.getByText('Acme Corp (SUP001)')).toBeInTheDocument();
      expect(screen.getByText('Global Goods (SUP002)')).toBeInTheDocument();
    });
  });

  it('shows empty supplier dropdown without error when listSuppliers fails', async () => {
    mockListSuppliers.mockRejectedValueOnce(new Error('Network down'));

    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    // Should not crash; dropdown stays with just "-- Select --".
    await vi.waitFor(() => {
      expect(screen.getByText('-- Select --')).toBeInTheDocument();
    });
    // No alert or crash.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows Edit title when editingId is set', async () => {
    renderForm(<PurchaseOrderForm editingId="po-existing" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText('Edit Purchase Order')).toBeInTheDocument();
  });

  it('calls onClose when cancel is clicked', async () => {
    const onClose = vi.fn();
    renderForm(<PurchaseOrderForm editingId={null} onClose={onClose} onSaved={vi.fn()} />);
    clickButton(/cancel/i);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when X button is clicked', async () => {
    const onClose = vi.fn();
    renderForm(<PurchaseOrderForm editingId={null} onClose={onClose} onSaved={vi.fn()} />);
    clickButton(/close/i);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('button is disabled when PO number or supplier is missing', async () => {
    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /create po/i });
    expect(btn).toBeDisabled();
  });

  it('button enables when both PO number and supplier are filled', async () => {
    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Acme Corp (SUP001)')).toBeInTheDocument();
    });
    fillField('PO-001', 'PO-001');
    await selectOption(/supplier/i, 'sup-1');
    expect(screen.getByRole('button', { name: /create po/i })).toBeEnabled();
  });

  it('validates SKU is required on each line', async () => {
    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await vi.waitFor(() => {
      expect(screen.getByText('Acme Corp (SUP001)')).toBeInTheDocument();
    });
    fillField('PO-001', 'PO-001');
    await selectOption(/supplier/i, 'sup-1');
    // Leave the default empty SKU line.
    clickButton(/create po/i);

    expect(screen.getByRole('alert')).toHaveTextContent('Each line must have a SKU');
  });

  it('adds a new line row when + Add Line is clicked', async () => {
    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    // Start with 1 SKU input.
    const initialSkuInputs = screen.getAllByPlaceholderText('SKU');
    expect(initialSkuInputs).toHaveLength(1);

    clickButton('+ Add Line');

    const afterSkuInputs = screen.getAllByPlaceholderText('SKU');
    expect(afterSkuInputs).toHaveLength(2);
  });

  it('removes a line row when remove button is clicked', async () => {
    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    clickButton('+ Add Line');
    expect(screen.getAllByPlaceholderText('SKU')).toHaveLength(2);

    const removeButtons = screen.getAllByRole('button', { name: /remove line/i });
    fireEvent.click(removeButtons[0]!);

    expect(screen.getAllByPlaceholderText('SKU')).toHaveLength(1);
  });

  it('does not show remove button when only one line remains', async () => {
    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /remove line/i })).not.toBeInTheDocument();
  });

  it('names the store currency in the unit-cost placeholder without naming an exponent', async () => {
    // The field takes a NATURAL amount in whatever the store bills in, so the label
    // names the currency. It must NOT name a subunit or an exponent: "cents" was wrong
    // on an exponent-0 currency (IDR has no subunit), and "minor units" is developer
    // jargon the UX must never show — the guard for that is
    // noMinorUnitsInUxCompliance.test.ts, which scans these bundles directly.
    currencyState.code = 'IDR';
    try {
      renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);
      expect(
        screen.getByPlaceholderText((content) => stripIsolates(content) === 'Amount in IDR'),
      ).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/cents/i)).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/minor/i)).not.toBeInTheDocument();
    } finally {
      currencyState.code = 'USD';
    }
  });

  it('updates line fields — SKU, product name, qty, unit cost', async () => {
    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    const skuInput = screen.getByPlaceholderText('SKU');
    const nameInput = screen.getByPlaceholderText('Product Name');
    const qtyInput = screen.getByDisplayValue('1');
    const costInput = screen.getByPlaceholderText(
      (content) => stripIsolates(content) === 'Amount in USD',
    );

    fillField('SKU', 'SKU-123');
    fireEvent.change(nameInput, { target: { value: 'Widget' } });
    fireEvent.change(qtyInput, { target: { value: '5' } });
    // A natural amount, as the operator would say it out loud.
    fireEvent.change(costInput, { target: { value: '20.00' } });

    expect(skuInput).toHaveValue('SKU-123');
    expect(nameInput).toHaveValue('Widget');
    expect(qtyInput).toHaveValue(5);
    // Held verbatim while typing — not reformatted under the cursor.
    expect(costInput).toHaveValue('20.00');
  });

  it('shows computed line total and subtotal', async () => {
    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    const qtyInput = screen.getByDisplayValue('1');
    const costInput = screen.getByPlaceholderText(
      (content) => stripIsolates(content) === 'Amount in USD',
    );

    fireEvent.change(qtyInput, { target: { value: '3' } });
    // $15.00 each, typed naturally. parseMoneyInput turns it into 1500 minor units.
    fireEvent.change(costInput, { target: { value: '15.00' } });

    // Line total: 3 × 1500 = 4500 minor units, rendered through formatMoney at USD's
    // exponent 2 — $45.00. The line-total cell and the subtotal both show it, which is
    // what proves the typed MAJOR amount converted rather than being read as 15 minor
    // units (which would have shown 0.45).
    const totalCells = screen.getAllByText('45.00');
    expect(totalCells.length).toBeGreaterThanOrEqual(2);
  });

  it('converts a natural IDR amount (exponent 0) and shows the right total', async () => {
    // IDR has no subunit, so "45000" is 45000 minor units and the total reads 45000.
    // Worth pinning separately from the USD case: on an exponent-0 currency the old
    // raw-minor binding and the new parse agree, so only the USD case above would catch
    // a regression that reverted the conversion.
    currencyState.code = 'IDR';
    try {
      renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);

      const qtyInput = screen.getByDisplayValue('1');
      const costInput = screen.getByPlaceholderText(
        (content) => stripIsolates(content) === 'Amount in IDR',
      );

      fireEvent.change(qtyInput, { target: { value: '2' } });
      fireEvent.change(costInput, { target: { value: '45000' } });

      // 2 × 45000 minor units = 90000, rendered at exponent 0 as 90000.
      expect(screen.getAllByText('90000').length).toBeGreaterThanOrEqual(2);
    } finally {
      currencyState.code = 'USD';
    }
  });

  it('allows entering expected date and notes', async () => {
    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    const dateInput = screen.getByLabelText('Expected Date');
    fireEvent.change(dateInput, { target: { value: '2026-08-01' } });
    expect(dateInput).toHaveValue('2026-08-01');

    const notesInput = screen.getByPlaceholderText('Optional notes');
    fireEvent.change(notesInput, { target: { value: 'Rush order' } });
    expect(notesInput).toHaveValue('Rush order');
  });

  it('successfully submits and calls onSaved', async () => {
    mockCreatePO.mockResolvedValueOnce({ id: 'po-new' });
    const onSaved = vi.fn();

    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={onSaved} />);

    await vi.waitFor(() => {
      expect(screen.getByText('Acme Corp (SUP001)')).toBeInTheDocument();
    });
    fillField('PO-001', 'PO-001');
    await selectOption(/supplier/i, 'sup-1');
    fillField('SKU', 'SKU-001');
    fireEvent.change(screen.getByPlaceholderText('Product Name'), { target: { value: 'Test Product' } });

    clickButton(/create po/i);

    expect(mockCreatePO).toHaveBeenCalledTimes(1);
    expect(mockCreatePO).toHaveBeenCalledWith(
      'tok-test',
      expect.objectContaining({
        po_number: 'PO-001',
        supplier_id: 'sup-1',
        lines: expect.arrayContaining([
          expect.objectContaining({ sku: 'SKU-001', product_name: 'Test Product' }),
        ]),
      }),
    );

    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  // A double tap on Create PO must not send the create twice.
  //
  // core refuses the replay -- `purchase_orders.po_number` carries a unique index
  // (idx_purchase_orders_po_number, migrations/20260813_init.sql) -- so a duplicate PO is
  // not stored. But the handler has no in-flight guard of its own, only `saving` state,
  // which React commits on its NEXT render: after the second dispatch of a real double
  // tap. MEASURED on three sibling screens, and confirmed here, that the second create
  // IS SENT -- so the round trip is wasted and its rejection surfaces as a failure toast
  // on a PO that was created.
  //
  // SHAPE 3 (round 139): both taps inside ONE act() batch. Sequential `fireEvent` wraps
  // each dispatch in its own act() and React commits `setSaving(true)` between them, which
  // disables the button -- that shape reports 1 call where a real double tap sends 2.
  it('sends the create once for a double tap while the first is in flight', async () => {
    let releaseCreate: ((v: unknown) => void) | undefined;
    const heldCreate = new Promise((resolve) => { releaseCreate = resolve; });
    mockCreatePO.mockImplementation(() => heldCreate as never);

    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Acme Corp (SUP001)')).toBeInTheDocument();
    });
    fillField('PO-001', 'PO-001');
    await selectOption(/supplier/i, 'sup-1');
    fillField('SKU', 'SKU-001');
    fireEvent.change(screen.getByPlaceholderText('Product Name'), { target: { value: 'Test Product' } });

    const createBtn = screen.getByRole('button', { name: /create po/i });
    await act(async () => {
      fireEvent.click(createBtn);
      // The disabled flag React set is not yet authoritative for a live double tap;
      // dropping it sends the second click to the handler the way a real one would.
      createBtn.removeAttribute('disabled');
      fireEvent.click(createBtn);
    });

    expect(
      mockCreatePO.mock.calls.length,
      'a double tap on Create PO sent the create twice; core rejects the replay on its ' +
        'unique po_number, so the failure is reported for a PO that WAS created',
    ).toBe(1);

    releaseCreate?.({ id: 'po-new' });
    await vi.waitFor(() => {
      expect(mockCreatePO).toHaveBeenCalledTimes(1);
    });
  });

  it('shows error when createPurchaseOrder fails', async () => {
    mockCreatePO.mockRejectedValueOnce(new Error('Network failure'));

    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await vi.waitFor(() => {
      expect(screen.getByText('Acme Corp (SUP001)')).toBeInTheDocument();
    });
    fillField('PO-001', 'PO-FAIL');
    await selectOption(/supplier/i, 'sup-1');
    fillField('SKU', 'SKU-X');

    clickButton(/create po/i);

    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to create purchase order');
    });
  });
});
