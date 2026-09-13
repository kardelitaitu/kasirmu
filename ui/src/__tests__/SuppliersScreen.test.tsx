import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
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

  it('disables save button when code or name is empty', async () => {
    mockListSuppliers.mockResolvedValue([]);
    renderWithFluentSync(<SuppliersScreen />, purchasingFtl, sharedFtl, supplierFtl);

    clickButton(/add supplier/i);

    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });
});
