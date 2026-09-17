import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/i18n/test-utils';
import { ToastProvider } from '@/components/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import salesIdFtl from '@/locales/sales.id.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import kdsFtl from '@/locales/kds.ftl?raw';
import kdsIdFtl from '@/locales/kds.id.ftl?raw';
import RetailProductGrid from '@/features/retail/RetailProductGrid';
import { RETAIL_COLUMN_DEFAULTS, type RetailColumn } from '@/features/retail/hooks/useRetailColumnPrefs';
import type { ProductDto, CategoryDto } from '@/api/products';
import type { Money, Sku } from '@/types/domain';
import type { ProductGridData, ProductGridActions } from '@/features/retail/RetailProductGrid';

vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({
    isEnabled: () => true,
  }),
}));

function makeMoney(minor: number): Money {
  return { minor_units: minor, currency: 'IDR' };
}

function makeProduct(overrides: Partial<ProductDto> = {}): ProductDto {
  return {
    sku: 'SKU-001' as Sku,
    name: 'Test Product',
    category: 'cat-1',
    price: makeMoney(10000),
    barcode: '123456789',
    in_stock: true,
    stock_qty: 10,
    tax_rate_ids: [],
    created_at: new Date().toISOString(),
    price_updated_at: new Date().toISOString(),
    product_type: 'retail',
    ...overrides,
  };
}

function makeCategory(overrides: Partial<CategoryDto> = {}): CategoryDto {
  return {
    id: 'cat-1',
    name: 'Test Category',
    colour: '#ff0000',
    icon: 'package',
    ...overrides,
  };
}

const defaultColumns: readonly RetailColumn[] = RETAIL_COLUMN_DEFAULTS;

function makeData(overrides: Partial<ProductGridData> = {}): ProductGridData {
  const productsLoading = overrides.productsLoading ?? false;
  const categoriesLoading = overrides.categoriesLoading ?? false;
  const isLoading = productsLoading || categoriesLoading;
  const categories = isLoading ? [] : (overrides.categories ?? [makeCategory()]);
  return {
    productsLoading,
    categoriesLoading,
    categories,
    activeCategory: overrides.activeCategory ?? null,
    searchQuery: overrides.searchQuery ?? '',
    filteredProducts: overrides.filteredProducts ?? [makeProduct()],
    pagedProducts: overrides.pagedProducts ?? [makeProduct()],
    totalPages: overrides.totalPages ?? 1,
    productPage: overrides.productPage ?? 0,
    sortField: overrides.sortField ?? 'name',
    sortOrder: overrides.sortOrder ?? 'asc',
    allLabel: overrides.allLabel ?? 'All',
    catLabels: overrides.catLabels ?? new Map([['cat-1', 'Test Category']]),
    skuInput: overrides.skuInput ?? '',
    weighTarget: overrides.weighTarget ?? null,
    filterLowStock: overrides.filterLowStock ?? false,
    visibleColumns: overrides.visibleColumns ?? defaultColumns,
    hideInactive: overrides.hideInactive ?? false,
    viewMode: overrides.viewMode ?? 'text',
  };
}

function makeActions(): ProductGridActions {
  return {
    onSetActiveCategory: vi.fn(),
    onSetSearchQuery: vi.fn(),
    onSort: vi.fn(),
    onSetProductPage: vi.fn(),
    onAddProduct: vi.fn(),
    onEditProduct: vi.fn(),
    onOpenQtyPicker: vi.fn(),
    onSetWeighTarget: vi.fn(),
    onClearWeighTarget: vi.fn(),
    onAddCategory: vi.fn(),
    onAddNewProduct: vi.fn(),
    onSkuInputChange: vi.fn(),
    onSkuSubmit: vi.fn(),
    onWeighAdd: vi.fn(),
    onToggleColumn: vi.fn(),
    onToggleHideInactive: vi.fn(),
    onRowContextMenu: vi.fn(),
    onSetViewMode: vi.fn(),
  };
}

function makeProps(overrides: { data?: Partial<ProductGridData>; actions?: Partial<ProductGridActions>; isScaleEnabled?: boolean } = {}) {
  const data = makeData(overrides.data);
  const actions = makeActions();
  if (overrides.actions) Object.assign(actions, overrides.actions);
  // Exclude data and actions from overrides to avoid overwriting our constructed objects
  const { data: _data, actions: _actions, isScaleEnabled, ...restOverrides } = overrides;
  return {
    data,
    actions,
    isScaleEnabled: isScaleEnabled ?? false,
    catHue: () => 0,
    skuInputRef: { current: null },
    ...restOverrides,
  };
}

async function renderWithFluent(ui: React.ReactElement) {
  const wrapped = withFluent(<ToastProvider>{ui}</ToastProvider>, salesFtl, productsFtl, tablesFtl, kdsFtl);
  await renderInAct(wrapped);
}

async function renderWithFluentId(ui: React.ReactElement) {
  const wrapped = withFluentLocale('id', <ToastProvider>{ui}</ToastProvider>, salesIdFtl, productsFtl, tablesFtl, kdsIdFtl);
  await renderInAct(wrapped);
}

describe('RetailProductGrid', () => {
  describe('Loading skeleton', () => {
    it('shows skeleton table when productsLoading is true', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { productsLoading: true } })} />);

      expect(screen.getByRole('status', { name: 'Loading products…' })).toBeInTheDocument();
    });

    it('shows skeleton table when categoriesLoading is true', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { categoriesLoading: true } })} />);

      expect(screen.getByRole('status', { name: 'Loading products…' })).toBeInTheDocument();
    });

    it('renders skeleton rows with correct class', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { productsLoading: true } })} />);

      const skeletonRows = screen.getAllByRole('row');
      const skeletonRowCount = skeletonRows.filter(row => row.className?.includes('retail-skeleton-row')).length;
      expect(skeletonRowCount).toBeGreaterThan(0);
    });
  });

  describe('Empty states', () => {
    it('shows "No products" when no products and no filters', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { filteredProducts: [], searchQuery: '', activeCategory: null, filterLowStock: false } })} />);

      expect(screen.getByText('No products')).toBeInTheDocument();
    });

    it('shows "No products match your search" when search query has no results', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { filteredProducts: [], searchQuery: 'nonexistent', activeCategory: null, filterLowStock: false } })} />);

      expect(screen.getByText('No products match your search')).toBeInTheDocument();
    });

    it('shows "No products in this category" when category has no products', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { filteredProducts: [], searchQuery: '', activeCategory: 'cat-1', filterLowStock: false } })} />);

      expect(screen.getByText('No products in this category')).toBeInTheDocument();
    });

    it('shows "No products below the low-stock threshold" when low stock filter active', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { filteredProducts: [], searchQuery: '', activeCategory: null, filterLowStock: true } })} />);

      expect(screen.getByText('No products below the low-stock threshold')).toBeInTheDocument();
    });
  });

  describe('Category tabs', () => {
    it('renders "All" category button', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByText('All')).toBeInTheDocument();
    });

    it('renders category buttons from categories data', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByText('Test Category')).toBeInTheDocument();
    });

    it('highlights active category', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { activeCategory: 'cat-1' } })} />);

      const activeBtn = screen.getByText('Test Category').closest('button');
      expect(activeBtn).toHaveClass('retail-cat-btn--active');
    });

    it('shows +Category button', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByText('+ Category')).toBeInTheDocument();
    });

    it('calls onSetActiveCategory when category clicked', async () => {
      const actions = makeActions();
      await renderWithFluent(<RetailProductGrid {...makeProps({ actions })} />);

      await screen.getByText('Test Category').click();
      expect(actions.onSetActiveCategory).toHaveBeenCalledWith('cat-1');
    });
  });

  describe('Search bar', () => {
    it('renders search input with placeholder', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      const searchInput = screen.getByPlaceholderText('Cari produk…');
      expect(searchInput).toBeInTheDocument();
    });

    it('shows clear button when search query has value', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { searchQuery: 'test' } })} />);

      expect(screen.getByLabelText('Clear search')).toBeInTheDocument();
    });

    it('hides clear button when search query is empty', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { searchQuery: '' } })} />);

      expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument();
    });

    it('shows popularity sort button', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByText('🔥 Popularity')).toBeInTheDocument();
    });

    it('calls onSetSearchQuery when input changes', async () => {
      const actions = makeActions();
      await renderWithFluent(<RetailProductGrid {...makeProps({ actions })} />);

      const searchInput = screen.getByPlaceholderText('Cari produk…');
      fireEvent.change(searchInput, { target: { value: 'coffee' } });
      expect(actions.onSetSearchQuery).toHaveBeenCalledWith('coffee');
    });

    it('calls onSetSearchQuery with empty string when clear clicked', async () => {
      const actions = makeActions();
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { searchQuery: 'test' }, actions })} />);

      await screen.getByLabelText('Clear search').click();
      expect(actions.onSetSearchQuery).toHaveBeenCalledWith('');
    });
  });

  describe('Column toggle menu', () => {
    it('renders column toggle button', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByText('Columns')).toBeInTheDocument();
    });

    it('opens menu when toggle button clicked', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      await screen.getByText('Columns').click();
      expect(screen.getByRole('menu', { name: 'Choose visible columns' })).toBeInTheDocument();
    });

    it('shows all toggleable columns in menu', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      await screen.getByText('Columns').click();

      // Check for default columns (sku, stock, name, price)
      expect(screen.getByRole('menuitemcheckbox', { name: 'SKU / Code', checked: true })).toBeInTheDocument();
      expect(screen.getByRole('menuitemcheckbox', { name: 'Stock', checked: true })).toBeInTheDocument();
      expect(screen.getByRole('menuitemcheckbox', { name: 'Product Name', checked: true })).toBeInTheDocument();
      expect(screen.getByRole('menuitemcheckbox', { name: 'Price', checked: true })).toBeInTheDocument();

      // Check for non-default columns (unchecked)
      expect(screen.getByRole('menuitemcheckbox', { name: 'Barcode', checked: false })).toBeInTheDocument();
      expect(screen.getByRole('menuitemcheckbox', { name: 'Category', checked: false })).toBeInTheDocument();
      expect(screen.getByRole('menuitemcheckbox', { name: 'Brand', checked: false })).toBeInTheDocument();
      expect(screen.getByRole('menuitemcheckbox', { name: 'Rack', checked: false })).toBeInTheDocument();
      expect(screen.getByRole('menuitemcheckbox', { name: 'Notes', checked: false })).toBeInTheDocument();
    });

    it('shows hide inactive toggle in menu', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      await screen.getByText('Columns').click();

      expect(screen.getByRole('menuitemcheckbox', { name: 'Hide inactive products', checked: false })).toBeInTheDocument();
    });

    it('calls onToggleColumn when column clicked', async () => {
      const actions = makeActions();
      await renderWithFluent(<RetailProductGrid {...makeProps({ actions })} />);

      await screen.getByText('Columns').click();
      await screen.getByRole('menuitemcheckbox', { name: 'Barcode' }).click();

      expect(actions.onToggleColumn).toHaveBeenCalledWith('barcode');
    });

    it('calls onToggleHideInactive when hide inactive clicked', async () => {
      const actions = makeActions();
      await renderWithFluent(<RetailProductGrid {...makeProps({ actions })} />);

      await screen.getByText('Columns').click();
      await screen.getByRole('menuitemcheckbox', { name: 'Hide inactive products' }).click();

      expect(actions.onToggleHideInactive).toHaveBeenCalledWith(true);
    });

    it('closes menu when clicking outside', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      await screen.getByText('Columns').click();
      expect(screen.getByRole('menu', { name: 'Choose visible columns' })).toBeInTheDocument();

      // Click outside (on document body)
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole('menu', { name: 'Choose visible columns' })).not.toBeInTheDocument();
    });

    it('closes menu when Escape pressed', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      await screen.getByText('Columns').click();
      expect(screen.getByRole('menu', { name: 'Choose visible columns' })).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menu', { name: 'Choose visible columns' })).not.toBeInTheDocument();
    });
  });

  describe('Product table', () => {
    it('renders product rows when products exist', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByText('Test Product')).toBeInTheDocument();
    });

    it('renders product SKU', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByText('SKU-001')).toBeInTheDocument();
    });

    it('renders product price formatted', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      // formatMoney uses Indonesian locale (space after Rp, dots for thousands)
      expect(screen.getByText((c: string) => c.includes('Rp') && c.includes('10.000'))).toBeInTheDocument();
    });

    it('renders stock badge for in-stock products', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByText('10')).toBeInTheDocument();
    });

    it('shows out of stock label for out-of-stock products', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { pagedProducts: [makeProduct({ in_stock: false, stock_qty: 0 })] } })} />);

      expect(screen.getByText('Out of stock')).toBeInTheDocument();
    });

    it('renders add to cart button', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      const addBtn = screen.getByTitle('Add to Cart');
      expect(addBtn).toBeInTheDocument();
    });

    it('renders edit button', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      const editBtn = screen.getByTitle('Edit Product');
      expect(editBtn).toBeInTheDocument();
    });

    it('disables add to cart for out-of-stock products', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { pagedProducts: [makeProduct({ in_stock: false, stock_qty: 0 })] } })} />);

      const addBtn = screen.getByTitle('Add to Cart');
      expect(addBtn).toBeDisabled();
    });
  });

  describe('Sorting', () => {
    it('renders sortable column headers', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByText('Product Name')).toBeInTheDocument();
      expect(screen.getByText('Stock')).toBeInTheDocument();
      expect(screen.getByText('Price')).toBeInTheDocument();
    });

    it('shows sort indicator for active sort field', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { sortField: 'name', sortOrder: 'asc' } })} />);

      expect(screen.getByText('▲')).toBeInTheDocument();
    });

    it('shows descending sort indicator', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { sortField: 'price', sortOrder: 'desc' } })} />);

      expect(screen.getByText('▼')).toBeInTheDocument();
    });

    it('calls onSort when sortable header clicked', async () => {
      const actions = makeActions();
      await renderWithFluent(<RetailProductGrid {...makeProps({ actions })} />);

      await screen.getByText('Product Name').click();
      expect(actions.onSort).toHaveBeenCalledWith('name');
    });
  });

  describe('Pagination', () => {
    it('renders pagination when totalPages > 1', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { totalPages: 3, productPage: 0 } })} />);

      expect(screen.getByText('1 / 3')).toBeInTheDocument();
    });

    it('disables previous button on first page', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { totalPages: 3, productPage: 0 } })} />);

      expect(screen.getByLabelText('Previous page')).toBeDisabled();
    });

    it('enables previous button on subsequent pages', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { totalPages: 3, productPage: 1 } })} />);

      expect(screen.getByLabelText('Previous page')).not.toBeDisabled();
    });

    it('disables next button on last page', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { totalPages: 3, productPage: 2 } })} />);

      expect(screen.getByLabelText('Next page')).toBeDisabled();
    });

    it('calls onSetProductPage when next clicked', async () => {
      const actions = makeActions();
      await renderWithFluent(<RetailProductGrid {...makeProps({ data: { totalPages: 3, productPage: 0 }, actions })} />);

      await screen.getByLabelText('Next page').click();
      expect(actions.onSetProductPage).toHaveBeenCalled();
    });
  });

  describe('SKU input bar', () => {
    it('renders SKU label', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByText('SKU')).toBeInTheDocument();
    });

    it('renders SKU input with placeholder', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByPlaceholderText('Scan or type barcode / SKU')).toBeInTheDocument();
    });

    it('shows GO button', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByText('GO')).toBeInTheDocument();
    });

    it('calls onSkuSubmit when GO clicked', async () => {
      const actions = makeActions();
      await renderWithFluent(<RetailProductGrid {...makeProps({ actions })} />);

      await screen.getByText('GO').click();
      expect(actions.onSkuSubmit).toHaveBeenCalledTimes(1);
    });

    it('calls onSkuInputChange when input changes', async () => {
      const actions = makeActions();
      await renderWithFluent(<RetailProductGrid {...makeProps({ actions })} />);

      const skuInput = screen.getByPlaceholderText('Scan or type barcode / SKU');
      fireEvent.change(skuInput, { target: { value: 'ABC123' } });
      expect(actions.onSkuInputChange).toHaveBeenCalledWith('ABC123');
    });

    it('calls onSkuSubmit when Enter pressed in SKU input', async () => {
      const actions = makeActions();
      await renderWithFluent(<RetailProductGrid {...makeProps({ actions })} />);

      const skuInput = screen.getByPlaceholderText('Scan or type barcode / SKU');
      fireEvent.keyDown(skuInput, { key: 'Enter' });
      expect(actions.onSkuSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('Scale indicator', () => {
    it('does not render scale indicator when isScaleEnabled is false', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ isScaleEnabled: false })} />);

      expect(screen.queryByText('Scale')).not.toBeInTheDocument();
    });

    it('renders scale indicator when isScaleEnabled is true', async () => {
      await renderWithFluent(<RetailProductGrid {...makeProps({ isScaleEnabled: true })} />);

      expect(screen.getByText('Scale')).toBeInTheDocument();
    });
  });

  describe('Indonesian locale', () => {
    it('renders search placeholder in Indonesian', async () => {
      await renderWithFluentId(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByPlaceholderText('Cari produk…')).toBeInTheDocument();
    });

    it('renders empty state in Indonesian', async () => {
      await renderWithFluentId(<RetailProductGrid {...makeProps({ data: { filteredProducts: [], searchQuery: '', activeCategory: null, filterLowStock: false } })} />);

      expect(screen.getByText('Tidak ada produk')).toBeInTheDocument();
    });

    it('renders column toggle in Indonesian', async () => {
      await renderWithFluentId(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByText('Kolom')).toBeInTheDocument();
    });

    it('renders SKU bar in Indonesian', async () => {
      await renderWithFluentId(<RetailProductGrid {...makeProps()} />);

      expect(screen.getByText('SKU')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Scan atau ketik barcode / SKU')).toBeInTheDocument();
      expect(screen.getByText('CARI')).toBeInTheDocument();
    });

    it('renders price in Indonesian format (space after Rp, dots for thousands)', async () => {
      await renderWithFluentId(<RetailProductGrid {...makeProps()} />);

      // IDR format uses "Rp 10.000" (space after Rp, dots for thousands)
      expect(screen.getByText((c: string) => c.includes('Rp') && c.includes('10.000'))).toBeInTheDocument();
    });
  });
});