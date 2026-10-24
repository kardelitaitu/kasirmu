import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VariantManagementScreen from '@/features/products/VariantManagementScreen';
import type { ProductVariantDto } from '@/api/products';

// ── Mocks ────────────────────────────────────────────────────────

const mockListVariants = vi.fn<() => Promise<ProductVariantDto[]>>();
const mockCreateVariant = vi.fn();
const mockUpdateVariant = vi.fn();
const mockDeleteVariant = vi.fn();

vi.mock('@/api/products', () => ({
  listProductVariants: (_sessionToken: string) => mockListVariants(),
  createProductVariant: (_sessionToken: string, args: unknown) => mockCreateVariant(args),
  updateProductVariant: (_sessionToken: string, args: unknown) => mockUpdateVariant(args),
  deleteProductVariant: (_sessionToken: string, sku: string) => mockDeleteVariant(sku),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1', activeWorkspace: null, logout: vi.fn() }),
}));

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: {
      getString: (key: string, vars?: Record<string, string>) => {
        // Map variant-mgmt modal keys to expected test text.
        const keyMap: Record<string, string> = {
          'variant-mgmt-modal-add-title': 'Add Variant',
          'variant-mgmt-modal-edit-title': 'Edit Variant',
          'variant-mgmt-modal-delete-title': 'Delete Variant',
          'variant-mgmt-btn-update': 'Update',
          'variant-mgmt-btn-create': 'Create',
          'variant-mgmt-delete-confirm-title': 'Delete Variant',
          'variant-mgmt-btn-cancel': 'Cancel',
          'variant-mgmt-add-variant': 'Add Variant',
          'variant-mgmt-loading': 'Loading variants…',
          'variant-mgmt-error-retry': 'Retry',
          'variant-mgmt-empty': 'No variants yet.',
          'variant-mgmt-empty-cta': 'Add a variant',
          'variant-mgmt-edit': 'Edit',
          'variant-mgmt-delete': 'Delete',
        };
        if (keyMap[key]) return keyMap[key];
        if (vars?.['name']) return `aria-${key}-${vars['name']}`;
        return key;
      },
    },
  }),
  Localized: ({ children }: { id: string; children: React.ReactNode; vars?: Record<string, string> }) => (
    <>{children}</>
  ),
}));

vi.mock('@/components/Button', () => ({
  Button: ({
    children,
    onClick,
    variant,
    disabled,
    loading,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    disabled?: boolean;
    loading?: boolean;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`btn btn--${variant ?? 'primary'}`}
    >
      {children}
    </button>
  ),
}));

// ── Test data ────────────────────────────────────────────────────

function makeVariant(overrides: Partial<ProductVariantDto> = {}): ProductVariantDto {
  return {
    id: 'v-1',
    parent_sku: 'PROD-001',
    name: 'Large',
    sku: 'PROD-001-L',
    price: { minor_units: 500, currency: 'USD' },
    barcode: '4901234567890',
    sort_order: 0,
    is_active: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

const sampleVariants: ProductVariantDto[] = [
  makeVariant(),
  makeVariant({ id: 'v-2', name: 'Small', sku: 'PROD-001-S', price: null, barcode: null, sort_order: 1 }),
  makeVariant({ id: 'v-3', name: 'Medium', sku: 'PROD-001-M', is_active: false, sort_order: 2 }),
];

// ── Default props ────────────────────────────────────────────────

const defaultProps = {
  productSku: 'PROD-001',
  productName: 'Test Product',
  onClose: vi.fn(),
};

// ── Tests ────────────────────────────────────────────────────────

describe('VariantManagementScreen', () => {
  beforeEach(() => {
    mockListVariants.mockResolvedValue(sampleVariants);
    mockCreateVariant.mockResolvedValue(undefined);
    mockUpdateVariant.mockResolvedValue(undefined);
    mockDeleteVariant.mockResolvedValue(undefined);
  });

  // ── Loading state ─────────────────────────────────────────────

  it('shows loading skeleton while fetching variants', () => {
    mockListVariants.mockReturnValue(new Promise(() => {}));
    render(<VariantManagementScreen {...defaultProps} />);
    const skeleton = document.querySelector('.product-mgmt-table')?.closest('[aria-hidden="true"]');
    expect(skeleton).toBeInTheDocument();
    expect(screen.queryByText('Loading variants…')).not.toBeInTheDocument();
  });

  // ── Error state ──────────────────────────────────────────────

  it('shows error message and retry button on fetch failure', async () => {
    mockListVariants.mockRejectedValue(new Error('Network error'));
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load variants')).toBeInTheDocument();
    });
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  // ── Empty state ──────────────────────────────────────────────

  it('shows empty state when no variants exist', async () => {
    mockListVariants.mockResolvedValue([]);
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No variants yet.')).toBeInTheDocument();
    });
    expect(screen.getByText('Add a variant')).toBeInTheDocument();
  });

  // ── Data table ───────────────────────────────────────────────

  it('renders variants table with column headers', async () => {
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });
    expect(screen.getByText('SKU')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('Barcode')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('renders variant rows with name and SKU', async () => {
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Large')).toBeInTheDocument();
    });
    expect(screen.getByText('PROD-001-L')).toBeInTheDocument();
    expect(screen.getByText('Small')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('shows active/inactive status badges', async () => {
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Large')).toBeInTheDocument();
    });

    // Active variants show "Active", inactive show "Inactive"
    const activeBadges = screen.getAllByText('Active');
    const inactiveBadges = screen.getAllByText('Inactive');
    expect(activeBadges.length).toBeGreaterThanOrEqual(2);
    expect(inactiveBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "Uses parent price" for variants without a price', async () => {
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Small')).toBeInTheDocument();
    });

    expect(screen.getByText('Uses parent price')).toBeInTheDocument();
  });

  it('shows em-dash for null barcode', async () => {
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Small')).toBeInTheDocument();
    });

    // Small has null barcode → renders em-dash
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  // ── Create modal ──────────────────────────────────────────────

  it('opens create modal when "Add Variant" is clicked', async () => {
    const user = userEvent.setup();
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Add Variant')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Add Variant'));

    // After clicking, there are two "Add Variant" elements (button + modal title).
    // Verify at least one heading, plus form fields.
    expect(screen.getByRole('heading', { name: 'Add Variant' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Large')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. TEA-LARGE')).toBeInTheDocument();
  });

  it('has save button disabled when name or SKU is empty in create form', async () => {
    const user = userEvent.setup();
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Add Variant')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Add Variant'));

    // Save button (Create) should be disabled with empty form
    const createBtn = screen.getByText('Create').closest('button');
    expect(createBtn).toBeDisabled();
  });

  it('rejects fractional price instead of silently truncating it', async () => {
    const user = userEvent.setup();
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Add Variant')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Add Variant'));

    await user.type(screen.getByPlaceholderText('e.g. Large'), 'Large');
    await user.type(screen.getByPlaceholderText('e.g. TEA-LARGE'), 'PROD-001-XL');
    await user.type(screen.getByPlaceholderText('450'), '500.5');
    await user.type(screen.getByPlaceholderText('USD'), 'USD');

    await user.click(screen.getByText('Create').closest('button')!);

    // The previous `parseInt('500.5', 10)` would have sent 500 silently;
    // now the validation error surfaces (the l10n mock returns the key id)
    // and no create call fires.
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('variant-mgmt-error-invalid-price');
    });
    expect(mockCreateVariant).not.toHaveBeenCalled();
  });

  it('cancel button closes the create modal', async () => {
    const user = userEvent.setup();
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Add Variant')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Add Variant'));

    const cancelBtns = screen.getAllByText('Cancel');
    await user.click(cancelBtns[0]!);

    // Modal form fields should be gone
    expect(screen.queryByPlaceholderText('e.g. Large')).not.toBeInTheDocument();
  });

  it('creates a variant once for a double tap while the first is in flight', async () => {
    // The second click of a real double tap lands BEFORE React commits `saving`, so the
    // handler is entered twice. MEASURED below: without an atomic guard the create is sent
    // twice, and `product_variants.sku` is UNIQUE -- the replay fails with a constraint,
    // which `create_product_variant_on` maps to "product not found" (products.rs:369-377).
    // The operator sees the variant appear (first tap) beside a "could not save" error
    // (second tap) and cannot tell which is true.
    let releaseCreate: ((v: unknown) => void) | undefined;
    mockCreateVariant.mockImplementation(
      () => new Promise((resolve) => { releaseCreate = resolve; }),
    );

    const user = userEvent.setup();
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Add Variant')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Add Variant'));

    await user.type(screen.getByPlaceholderText('e.g. Large'), 'Large');
    await user.type(screen.getByPlaceholderText('e.g. TEA-LARGE'), 'PROD-001-XL');

    const createBtn = screen.getByText('Create').closest('button')!;
    // Two clicks with no await between them: the same batching a real double tap produces.
    // The disabled flag React sets on the first is not yet authoritative, so it is dropped
    // for the second -- otherwise this would test the browser, not the guard.
    await act(async () => {
      fireEvent.click(createBtn);
      createBtn.removeAttribute('disabled');
      fireEvent.click(createBtn);
    });

    expect(
      mockCreateVariant.mock.calls.length,
      'a double tap on Create sent the variant create twice; the second is refused by the ' +
        'UNIQUE sku index and reported as "product not found", so the operator cannot tell ' +
        'whether the save worked',
    ).toBe(1);

    releaseCreate?.({ sku: 'PROD-001-XL' });
    await waitFor(() => {
      expect(mockCreateVariant).toHaveBeenCalledTimes(1);
    });
  });

  // ── Edit modal ────────────────────────────────────────────────

  it('opens edit modal with pre-filled form when Edit is clicked', async () => {
    const user = userEvent.setup();
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Large')).toBeInTheDocument();
    });

    // Click Edit for the first variant (Large)
    const editBtns = screen.getAllByText('Edit');
    await user.click(editBtns[0]!);

    // Modal title should say "Edit Variant"
    expect(screen.getByText('Edit Variant')).toBeInTheDocument();
    // Name field pre-filled with variant name
    const nameInput = screen.getByPlaceholderText('e.g. Large') as HTMLInputElement;
    expect(nameInput.value).toBe('Large');
    // SKU field disabled in edit mode
    const skuInput = screen.getByPlaceholderText('e.g. TEA-LARGE') as HTMLInputElement;
    expect(skuInput).toBeDisabled();
    expect(skuInput.value).toBe('PROD-001-L');
  });

  it('shows "Update" button text in edit mode', async () => {
    const user = userEvent.setup();
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Large')).toBeInTheDocument();
    });

    const editBtns = screen.getAllByText('Edit');
    await user.click(editBtns[0]!);

    expect(screen.getByText('Update')).toBeInTheDocument();
  });

  // ── Delete confirmation ───────────────────────────────────────

  it('shows delete confirmation dialog when Delete is clicked', async () => {
    const user = userEvent.setup();
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Large')).toBeInTheDocument();
    });

    const deleteBtns = screen.getAllByText('Delete');
    await user.click(deleteBtns[0]!);

    // Confirmation dialog should appear
    expect(screen.getByText('Delete Variant')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure/)).toBeInTheDocument();
  });

  it('cancel button closes delete confirmation dialog', async () => {
    const user = userEvent.setup();
    render(<VariantManagementScreen {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Large')).toBeInTheDocument();
    });

    const deleteBtns = screen.getAllByText('Delete');
    await user.click(deleteBtns[0]!);

    // The delete confirmation dialog has one Cancel button.
    await user.click(screen.getByText('Cancel'));

    // Dialog should close
    expect(screen.queryByText(/Are you sure/)).not.toBeInTheDocument();
  });

  // ── Close overlay ─────────────────────────────────────────────

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<VariantManagementScreen {...defaultProps} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Large')).toBeInTheDocument();
    });

    // The × close button
    const closeBtn = screen.getByText('×');
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
