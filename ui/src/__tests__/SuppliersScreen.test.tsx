import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import purchasingFtl from '@/locales/purchasing.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-test', activeWorkspace: null, logout: vi.fn() }),
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/api/purchasing', () => ({
  listSuppliers: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
}));

import SuppliersScreen from '@/features/purchasing/SuppliersScreen';
import { listSuppliers, createSupplier } from '@/api/purchasing';

const mockListSuppliers = listSuppliers as ReturnType<typeof vi.fn>;
const mockCreateSupplier = createSupplier as ReturnType<typeof vi.fn>;

// Inline FTL for keys not in the bundle yet.
const supplierFtl = `
supplier-name-required = Name is required
supplier-code-required = Code is required
supplier-save-failed = Save failed
suppliers-add-title = Add Supplier
suppliers-edit-title = Edit Supplier
suppliers-btn-create = Create
suppliers-btn-update = Update
suppliers-btn-cancel = Cancel
`;

const sampleSuppliers = [
  {
    id: 'sup-1', code: 'SUP001', name: 'Acme Corp',
    contact_person: 'John', phone: '555-0100', email: 'john@acme.com',
    address: '123 Main St', tax_id: 'TAX-001', payment_terms: 'NET30',
    notes: '', status: 'active', created_at: '2026-01-01', updated_at: '2026-01-01',
  },
  {
    id: 'sup-2', code: 'SUP002', name: 'Global Goods',
    contact_person: 'Jane', phone: '555-0200', email: 'jane@global.com',
    address: '', tax_id: '', payment_terms: '',
    notes: 'Preferred vendor', status: 'active', created_at: '2026-02-01', updated_at: '2026-02-01',
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function clickButton(name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function fillField(index: number, value: string) {
  const inputs = screen.getAllByRole('textbox');
  fireEvent.change(inputs[index]!, { target: { value } });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SuppliersScreen', () => {
  // ── List rendering ───────────────────────────────────────────
  it('renders the title and Add Supplier button', async () => {
    mockListSuppliers.mockResolvedValue([]);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);
    expect(screen.getByText('Suppliers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add supplier/i })).toBeInTheDocument();
  });

  it('loads and displays suppliers in the table', async () => {
    mockListSuppliers.mockResolvedValue(sampleSuppliers);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    await waitFor(() => {
      expect(screen.getByText('SUP001')).toBeInTheDocument();
    });
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Global Goods')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.getByText('555-0100')).toBeInTheDocument();
    expect(screen.getByText('john@acme.com')).toBeInTheDocument();
  });

  it('shows loading skeleton while fetching suppliers', async () => {
    mockListSuppliers.mockReturnValue(new Promise(() => {}));
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);
    expect(document.querySelector('.suppliers-loading-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/loading suppliers/i)).not.toBeInTheDocument();
  });

  it('shows empty state when no suppliers exist', async () => {
    mockListSuppliers.mockResolvedValue([]);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);
    await waitFor(() => {
      expect(screen.getByText(/no suppliers yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /add your first supplier/i })).toBeInTheDocument();
  });

  it('filters suppliers by search query', async () => {
    mockListSuppliers.mockResolvedValue(sampleSuppliers);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox');
    fireEvent.change(searchInput, { target: { value: 'global' } });

    await waitFor(() => {
      expect(screen.getByText('Global Goods')).toBeInTheDocument();
      expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();
    });
  });

  it('shows no-match message when search filters everything out', async () => {
    mockListSuppliers.mockResolvedValue(sampleSuppliers);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz404' } });

    await waitFor(() => {
      expect(screen.getByText(/no suppliers match your search/i)).toBeInTheDocument();
    });
  });

  it('renders status badges with correct class', async () => {
    mockListSuppliers.mockResolvedValue(sampleSuppliers);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    await waitFor(() => {
      const badges = screen.getAllByText('active');
      expect(badges.length).toBeGreaterThanOrEqual(2);
      if (badges[0]) {
        expect(badges[0].className).toContain('suppliers-badge--active');
      }
    });
  });

  // ── Create/Edit modal ────────────────────────────────────────
  it('opens create modal when Add Supplier is clicked', async () => {
    mockListSuppliers.mockResolvedValue([]);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    clickButton(/add supplier/i);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // "Add Supplier" appears in both the dialog heading and the Fluent Localized text.
    const addSupplierTexts = screen.getAllByText('Add Supplier');
    expect(addSupplierTexts.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Code *')).toBeInTheDocument();
    expect(screen.getByText('Name *')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('opens edit modal when Edit button is clicked on a row', async () => {
    mockListSuppliers.mockResolvedValue(sampleSuppliers);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    await waitFor(() => {
      expect(screen.getByText('SUP001')).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    fireEvent.click(editButtons[0]!);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Edit Supplier')).toBeInTheDocument();
    // Form pre-filled with existing code.
    expect(screen.getByDisplayValue('SUP001')).toBeInTheDocument();
  });

  it('enables save button when both code and name are filled', async () => {
    mockListSuppliers.mockResolvedValue([]);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    clickButton(/add supplier/i);

    // Initially disabled.
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();

    // Fill both required fields.
    fillField(0, 'SUP-001');
    fillField(1, 'Test Co');

    // Now enabled.
    expect(screen.getByRole('button', { name: /create/i })).toBeEnabled();
  });

  it('creates a supplier and refreshes the list', async () => {
    mockListSuppliers.mockResolvedValue(sampleSuppliers);
    mockCreateSupplier.mockResolvedValue({ id: 'sup-3', code: 'SUP-NEW', name: 'New Co', status: 'active' });
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    clickButton(/add supplier/i);

    fillField(0, 'SUP-NEW');
    fillField(1, 'New Co');

    clickButton(/create/i);

    await waitFor(() => {
      expect(mockCreateSupplier).toHaveBeenCalledTimes(1);
      expect(mockCreateSupplier).toHaveBeenCalledWith(
        'tok-test',
        expect.objectContaining({ code: 'SUP-NEW', name: 'New Co' }),
      );
    });
  });

  it('shows error when createSupplier fails', async () => {
    mockListSuppliers.mockResolvedValue(sampleSuppliers);
    mockCreateSupplier.mockRejectedValue(new Error('Duplicate code'));
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    clickButton(/add supplier/i);

    fillField(0, 'SUP-DUP');
    fillField(1, 'Duplicate Co');

    clickButton(/create/i);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
    });
  });

  // A double tap on Create must not report FAILURE for a supplier that was saved.
  //
  // The backend refuses the replay, so no duplicate row is stored: core inserts into a
  // table whose `code` column carries a unique index (idx_suppliers_code,
  // migrations/20260813_init.sql:1172-1173), so the second create is rejected. But that
  // rejection lands in the SAME catch that handles genuine failures -- see the case
  // below, which asserts 'Save failed' on a rejected promise. So a double tap raises
  // 'Save failed' while the supplier WAS created: the operator is told the write failed
  // on a record that exists. Same re-entry class as ShiftBar's open/close shift (rounds
  // 136-137).
  //
  // SHAPE 3 (round 139): both taps inside ONE act() batch, because sequential `fireEvent`
  // wraps each dispatch in its own act() and React commits `setSaving(true)` between them
  // -- measured on three other screens, that reports 1 call where a real double tap sends
  // 2. Batching removes the intervening commit.
  it('does not report a failure for a supplier saved by a double tap on Create', async () => {
    mockListSuppliers.mockResolvedValue(sampleSuppliers);
    mockCreateSupplier.mockResolvedValue({ id: 'sup-3', code: 'SUP-DUP', name: 'Dup Co', status: 'active' });
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    clickButton(/add supplier/i);
    fillField(0, 'SUP-DUP');
    fillField(1, 'Dup Co');

    const createBtn = screen.getByRole('button', { name: /create/i });
    await act(async () => {
      fireEvent.click(createBtn);
      // The disabled flag React set is not yet authoritative for a live double tap;
      // dropping it sends the second click to the handler the way a real one would.
      createBtn.removeAttribute('disabled');
      fireEvent.click(createBtn);
    });

    // The supplier WAS created -- exactly one write, and the modal closed.
    await waitFor(() => {
      expect(mockCreateSupplier).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByRole('alert'),
      'a double tap on Create surfaced a failure alert for a supplier that WAS saved',
    ).toBeNull();
  });

  it('closes modal when Cancel is clicked', async () => {
    mockListSuppliers.mockResolvedValue([]);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    clickButton(/add supplier/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    clickButton(/cancel/i);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes modal when X button is clicked', async () => {
    mockListSuppliers.mockResolvedValue([]);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    clickButton(/add supplier/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    clickButton(/close/i);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('renders all optional fields in the form', async () => {
    mockListSuppliers.mockResolvedValue([]);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    clickButton(/add supplier/i);

    expect(screen.getByText('Contact Person')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Address')).toBeInTheDocument();
    expect(screen.getByText('Tax ID')).toBeInTheDocument();
    expect(screen.getByText('Payment Terms')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  // A rejected list_suppliers_scoped used to be reported by stuffing
  // `suppliers` with [] and printing nothing, so the empty-state card below
  // said "No suppliers yet." with a "Add your first supplier" call to action —
  // a transport or permission failure presented as an authoritative answer
  // about the store's supplier registry.
  it('reports a failed supplier read instead of claiming the registry is empty', async () => {
    mockListSuppliers.mockRejectedValue(new Error('Server offline'));
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    await waitFor(() => {
      expect(screen.getByText(/suppliers could not be loaded/i)).toBeInTheDocument();
    });
    // The empty-state claim must not be made on behalf of a failed read.
    expect(screen.queryByText(/no suppliers yet/i)).toBeNull();
    expect(screen.queryByText(/add your first supplier/i)).toBeNull();
    // And the failure must be recoverable without leaving the screen.
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('disables save button when code or name is empty', async () => {
    mockListSuppliers.mockResolvedValue([]);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    clickButton(/add supplier/i);

    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });
});
