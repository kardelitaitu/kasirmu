import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, render } from '@testing-library/react';
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
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'USD', setCurrency: vi.fn(), loading: false }),
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

  it('updates line fields — SKU, product name, qty, unit cost', async () => {
    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    const skuInput = screen.getByPlaceholderText('SKU');
    const nameInput = screen.getByPlaceholderText('Product Name');
    const qtyInput = screen.getByDisplayValue('1');
    const costInput = screen.getByPlaceholderText('in cents');

    fillField('SKU', 'SKU-123');
    fireEvent.change(nameInput, { target: { value: 'Widget' } });
    fireEvent.change(qtyInput, { target: { value: '5' } });
    fireEvent.change(costInput, { target: { value: '2000' } });

    expect(skuInput).toHaveValue('SKU-123');
    expect(nameInput).toHaveValue('Widget');
    expect(qtyInput).toHaveValue(5);
    expect(costInput).toHaveValue(2000);
  });

  it('shows computed line total and subtotal', async () => {
    renderForm(<PurchaseOrderForm editingId={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    const qtyInput = screen.getByDisplayValue('1');
    const costInput = screen.getByPlaceholderText('in cents');

    fireEvent.change(qtyInput, { target: { value: '3' } });
    fireEvent.change(costInput, { target: { value: '1500' } });

    // Line total: 3 × 1500 = 4500 cents → $45.00
    // The line total cell + subtotal value should both show 45.00.
    const totalCells = screen.getAllByText('45.00');
    expect(totalCells.length).toBeGreaterThanOrEqual(2);
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
