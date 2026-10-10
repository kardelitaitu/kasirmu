import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import { RecipeEditorModal } from '@/features/products/RecipeEditorModal';
import * as productsApi from '@/api/products';
import productsFtl from '../../../shared-ui/locales/products.ftl?raw';
import sharedFtl from '../../../shared-ui/locales/shared.ftl?raw';

vi.mock('@/api/products', () => ({
  getRecipeScoped: vi.fn(),
  setRecipeScoped: vi.fn(),
  deleteRecipeScoped: vi.fn(),
  listProductsScoped: vi.fn(),
}));

const mockCatalog: productsApi.ProductDto[] = [
  {
    id: 'prod-dish01',
    sku: 'DISH01',
    name: 'Nasi Goreng Special',
    category: 'Mains',
    price: { minor_units: 35000, currency: 'IDR' },
    cost_minor: 0,
    barcode: null,
    in_stock: true,
    stock_qty: 0,
    tax_rate_ids: [],
    created_at: '2026-10-10T00:00:00Z',
    price_updated_at: '2026-10-10T00:00:00Z',
    product_type: 'restaurant',
    is_active: true,
    notes: null,
  },
  {
    id: 'prod-ing01',
    sku: 'ING01',
    name: 'Beras Premium',
    category: 'Ingredients',
    price: { minor_units: 15000, currency: 'IDR' },
    cost_minor: 12000,
    barcode: null,
    in_stock: true,
    stock_qty: 50,
    tax_rate_ids: [],
    created_at: '2026-10-10T00:00:00Z',
    price_updated_at: '2026-10-10T00:00:00Z',
    product_type: 'retail',
    is_active: true,
    notes: null,
  },
  {
    id: 'prod-ing02',
    sku: 'ING02',
    name: 'Telur Ayam',
    category: 'Ingredients',
    price: { minor_units: 3000, currency: 'IDR' },
    cost_minor: 2500,
    barcode: null,
    in_stock: true,
    stock_qty: 100,
    tax_rate_ids: [],
    created_at: '2026-10-10T00:00:00Z',
    price_updated_at: '2026-10-10T00:00:00Z',
    product_type: 'retail',
    is_active: true,
    notes: null,
  },
];

describe('RecipeEditorModal', () => {
  const onClose = vi.fn();
  const onSaved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(productsApi.listProductsScoped).mockResolvedValue(mockCatalog);
    vi.mocked(productsApi.getRecipeScoped).mockResolvedValue([]);
    vi.mocked(productsApi.setRecipeScoped).mockResolvedValue([]);
    vi.mocked(productsApi.deleteRecipeScoped).mockResolvedValue(1);
  });

  it('renders dish name, SKU, and empty recipe state', async () => {
    await renderWithProviders(
      <RecipeEditorModal
        open={true}
        onClose={onClose}
        productSku="DISH01"
        productName="Nasi Goreng Special"
        sessionToken="test-token"
        onSaved={onSaved}
      />,
      productsFtl,
      sharedFtl,
    );

    expect(screen.getByText('Nasi Goreng Special')).toBeInTheDocument();
    expect(screen.getByText('SKU: DISH01')).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText(/No ingredients added yet/i),
      ).toBeInTheDocument();
    });
  });

  it('loads and renders existing recipe items and calculates estimated HPP', async () => {
    const existingRecipe: productsApi.RecipeItemDto[] = [
      {
        id: 'r1',
        parentProductId: 'prod-dish01',
        ingredientProductId: 'prod-ing01',
        ingredientSku: 'ING01',
        ingredientName: 'Beras Premium',
        quantityRequired: 2,
        unit: 'kg',
        costMinor: 12000,
      },
      {
        id: 'r2',
        parentProductId: 'prod-dish01',
        ingredientProductId: 'prod-ing02',
        ingredientSku: 'ING02',
        ingredientName: 'Telur Ayam',
        quantityRequired: 1,
        unit: 'pcs',
        costMinor: 2500,
      },
    ];

    vi.mocked(productsApi.getRecipeScoped).mockResolvedValue(existingRecipe);

    await renderWithProviders(
      <RecipeEditorModal
        open={true}
        onClose={onClose}
        productSku="DISH01"
        productName="Nasi Goreng Special"
        sessionToken="test-token"
        onSaved={onSaved}
      />,
      productsFtl,
      sharedFtl,
    );

    await waitFor(() => {
      expect(screen.getByTestId('recipe-row-0')).toBeInTheDocument();
      expect(screen.getByTestId('recipe-row-1')).toBeInTheDocument();
    });

    const qty0 = screen.getByTestId('recipe-qty-input-0') as HTMLInputElement;
    expect(qty0.value).toBe('2');

    const qty1 = screen.getByTestId('recipe-qty-input-1') as HTMLInputElement;
    expect(qty1.value).toBe('1');

    // Total cost: 2 * 12000 (ING01) + 1 * 2500 (ING02) = 26500
    const totalBox = screen.getByTestId('recipe-total-cost-box');
    expect(totalBox).toHaveTextContent(/26\.500|26,500/);
  });

  it('adds an ingredient line, selects item, and saves', async () => {
    const user = userEvent.setup();

    await renderWithProviders(
      <RecipeEditorModal
        open={true}
        onClose={onClose}
        productSku="DISH01"
        productName="Nasi Goreng Special"
        sessionToken="test-token"
        onSaved={onSaved}
      />,
      productsFtl,
      sharedFtl,
    );

    await waitFor(() => {
      expect(screen.getByTestId('recipe-add-ingredient-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('recipe-add-ingredient-btn'));

    expect(screen.getByTestId('recipe-row-0')).toBeInTheDocument();

    const select = screen.getByTestId('recipe-ingredient-select-0');
    await user.selectOptions(select, 'ING01');

    const qtyInput = screen.getByTestId('recipe-qty-input-0');
    await user.clear(qtyInput);
    await user.type(qtyInput, '3');

    const unitInput = screen.getByTestId('recipe-unit-input-0');
    await user.clear(unitInput);
    await user.type(unitInput, 'g');

    // Save
    const saveBtn = screen.getByRole('button', { name: /save/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(productsApi.setRecipeScoped).toHaveBeenCalledWith('test-token', {
        parentProductId: 'prod-dish01',
        ingredients: [
          {
            ingredientProductId: 'prod-ing01',
            quantityRequired: 3,
            unit: 'g',
          },
        ],
      });
      expect(onSaved).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows error if duplicate ingredient is selected', async () => {
    const user = userEvent.setup();

    await renderWithProviders(
      <RecipeEditorModal
        open={true}
        onClose={onClose}
        productSku="DISH01"
        productName="Nasi Goreng Special"
        sessionToken="test-token"
        onSaved={onSaved}
      />,
      productsFtl,
      sharedFtl,
    );

    await waitFor(() => {
      expect(screen.getByTestId('recipe-add-ingredient-btn')).toBeInTheDocument();
    });

    // Add row 0
    await user.click(screen.getByTestId('recipe-add-ingredient-btn'));
    await user.selectOptions(screen.getByTestId('recipe-ingredient-select-0'), 'ING01');

    // Add row 1
    await user.click(screen.getByTestId('recipe-add-ingredient-btn'));
    await user.selectOptions(screen.getByTestId('recipe-ingredient-select-1'), 'ING01');

    // Click Save
    const saveBtn = screen.getByRole('button', { name: /save/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/Duplicate ingredient selected/i)).toBeInTheDocument();
      expect(productsApi.setRecipeScoped).not.toHaveBeenCalled();
    });
  });

  it('removes a row when delete icon is clicked', async () => {
    const user = userEvent.setup();

    await renderWithProviders(
      <RecipeEditorModal
        open={true}
        onClose={onClose}
        productSku="DISH01"
        productName="Nasi Goreng Special"
        sessionToken="test-token"
        onSaved={onSaved}
      />,
      productsFtl,
      sharedFtl,
    );

    await waitFor(() => {
      expect(screen.getByTestId('recipe-add-ingredient-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('recipe-add-ingredient-btn'));
    expect(screen.getByTestId('recipe-row-0')).toBeInTheDocument();

    await user.click(screen.getByTestId('recipe-remove-btn-0'));
    expect(screen.queryByTestId('recipe-row-0')).not.toBeInTheDocument();
  });

  it('clears recipe when clear button is confirmed', async () => {
    const user = userEvent.setup();

    const existingRecipe: productsApi.RecipeItemDto[] = [
      {
        id: 'r1',
        parentProductId: 'prod-dish01',
        ingredientProductId: 'prod-ing01',
        ingredientSku: 'ING01',
        ingredientName: 'Beras Premium',
        quantityRequired: 1,
        unit: 'kg',
        costMinor: 12000,
      },
    ];

    vi.mocked(productsApi.getRecipeScoped).mockResolvedValue(existingRecipe);

    await renderWithProviders(
      <RecipeEditorModal
        open={true}
        onClose={onClose}
        productSku="DISH01"
        productName="Nasi Goreng Special"
        sessionToken="test-token"
        onSaved={onSaved}
      />,
      productsFtl,
      sharedFtl,
    );

    await waitFor(() => {
      expect(screen.getByTestId('recipe-clear-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('recipe-clear-btn'));

    // Confirm dialog appears
    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog-confirm')).toBeInTheDocument();
    });

    // Click confirm in the dialog
    await user.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(productsApi.deleteRecipeScoped).toHaveBeenCalledWith('test-token', 'prod-dish01');
      expect(onSaved).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
