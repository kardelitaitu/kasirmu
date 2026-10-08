import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import RestaurantMenuEditorScreen from '@/features/restaurant/screens/RestaurantMenuEditorScreen';
import * as productsApi from '@/api/products';
import productsFtl from '../../../shared-ui/locales/products.ftl?raw';

vi.mock('@/api/products', () => ({
  listProductsScoped: vi.fn(),
  createProductScoped: vi.fn(),
  updateProductScoped: vi.fn(),
  deleteProductScoped: vi.fn(),
  listCategoriesScoped: vi.fn(),
  createCategoryScoped: vi.fn(),
  updateCategoryScoped: vi.fn(),
  deleteCategoryScoped: vi.fn(),
}));

const mockProducts: productsApi.ProductDto[] = [
  {
    sku: 'MN001',
    name: 'Nasi Goreng Kampung',
    category: 'Mains',
    price: { minor_units: 35000, currency: 'IDR' },
    barcode: null,
    in_stock: true,
    stock_qty: 10,
    tax_rate_ids: [],
    created_at: '2026-10-08T00:00:00Z',
    price_updated_at: '2026-10-08T00:00:00Z',
    product_type: 'restaurant',
    is_active: true,
    notes: 'Served with crackers and pickles',
  },
  {
    sku: 'MN002',
    name: 'Es Teh Manis',
    category: 'Drinks',
    price: { minor_units: 8000, currency: 'IDR' },
    barcode: null,
    in_stock: true,
    stock_qty: 50,
    tax_rate_ids: [],
    created_at: '2026-10-08T00:00:00Z',
    price_updated_at: '2026-10-08T00:00:00Z',
    product_type: 'restaurant',
    is_active: false,
    notes: 'Jasmine tea',
  },
];

const mockCategories: productsApi.CategoryDto[] = [
  { id: 'cat-mains', name: 'Mains', colour: '#f97316', icon: 'food' },
  { id: 'cat-drinks', name: 'Drinks', colour: '#06b6d4', icon: 'cold-drink' },
];

describe('RestaurantMenuEditorScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(productsApi.listProductsScoped).mockResolvedValue([...mockProducts]);
    vi.mocked(productsApi.listCategoriesScoped).mockResolvedValue([...mockCategories]);
    vi.mocked(productsApi.createProductScoped).mockResolvedValue({ sku: 'MN_NEW' });
    vi.mocked(productsApi.updateProductScoped).mockResolvedValue({ sku: 'MN001' });
    vi.mocked(productsApi.deleteProductScoped).mockResolvedValue();
    vi.mocked(productsApi.createCategoryScoped).mockResolvedValue({ id: 'cat-new' });
    vi.mocked(productsApi.updateCategoryScoped).mockResolvedValue({ id: 'cat-mains' });
    vi.mocked(productsApi.deleteCategoryScoped).mockResolvedValue({ affected_products: 1 });
  });

  it('renders categories and items successfully', async () => {
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByText('Nasi Goreng Kampung')).toBeInTheDocument();
      expect(screen.getByText('Es Teh Manis')).toBeInTheDocument();
    });

    // Check categories rendered in the rail
    const rail = screen.getByLabelText('Categories');
    expect(within(rail).getByText('All Items')).toBeInTheDocument();
    expect(within(rail).getByText('Mains')).toBeInTheDocument();
    expect(within(rail).getByText('Drinks')).toBeInTheDocument();
  });

  it('filters items when a category is selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByText('Nasi Goreng Kampung')).toBeInTheDocument();
    });

    // Click Mains category in the rail
    const rail = screen.getByLabelText('Categories');
    await user.click(within(rail).getByText('Mains'));

    expect(screen.getByText('Nasi Goreng Kampung')).toBeInTheDocument();
    expect(screen.queryByText('Es Teh Manis')).not.toBeInTheDocument();
  });

  it('filters items by real-time search query', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByText('Nasi Goreng Kampung')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('restaurant-menu-editor-search-input');
    await user.type(searchInput, 'crackers'); // search by note

    expect(screen.getByText('Nasi Goreng Kampung')).toBeInTheDocument();
    expect(screen.queryByText('Es Teh Manis')).not.toBeInTheDocument();

    // Clear search
    await user.clear(searchInput);
    expect(screen.getByText('Es Teh Manis')).toBeInTheDocument();
  });

  it('toggles item availability quickly without opening edit form', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByText('Nasi Goreng Kampung')).toBeInTheDocument();
    });

    const availableBtn = screen.getByLabelText('Toggle availability for Nasi Goreng Kampung');
    await user.click(availableBtn);

    expect(productsApi.updateProductScoped).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        sku: 'MN001',
        isActive: false,
        productType: 'restaurant',
      }),
    );
  });

  it('allows adding a new menu item with notes and productType restaurant', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-new-item')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('restaurant-menu-editor-new-item'));

    const form = screen.getByTestId('restaurant-menu-editor-form');
    expect(form).toBeInTheDocument();

    await user.type(screen.getByTestId('restaurant-menu-editor-name'), 'Sate Ayam');
    await user.type(screen.getByTestId('restaurant-menu-editor-price'), '25000');
    await user.type(screen.getByTestId('restaurant-menu-editor-notes'), 'Bumbu kacang pedas');

    await user.click(within(form).getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(productsApi.createProductScoped).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          name: 'Sate Ayam',
          priceMinor: 2500000,
          notes: 'Bumbu kacang pedas',
          productType: 'restaurant',
          isActive: true,
        }),
      );
    });
  });

  it('opens category modal to create a new category', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-btn-add-cat')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('restaurant-menu-editor-btn-add-cat'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('New Category')).toBeInTheDocument();

    await user.type(screen.getByTestId('restaurant-menu-editor-cat-input-name'), 'Desserts');
    await user.click(screen.getByTestId('restaurant-menu-editor-cat-save'));

    await waitFor(() => {
      expect(productsApi.createCategoryScoped).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          name: 'Desserts',
        }),
      );
    });
  });

  it('prevents creating a category with duplicate name client-side', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-btn-add-cat')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('restaurant-menu-editor-btn-add-cat'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // 'Mains' already exists in mockCategories
    await user.type(screen.getByTestId('restaurant-menu-editor-cat-input-name'), 'Mains');
    await user.click(screen.getByTestId('restaurant-menu-editor-cat-save'));

    expect(productsApi.createCategoryScoped).not.toHaveBeenCalled();
    expect(screen.getByText('A category with this name already exists.')).toBeInTheDocument();
  });

  it('prompts confirmation dialog before deleting an item and executes delete on confirm', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-del-MN001')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('restaurant-menu-editor-del-MN001'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete Menu Item')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete "Nasi Goreng Kampung"/i)).toBeInTheDocument();

    const confirmBtn = screen.getByTestId('confirm-dialog-confirm');
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(productsApi.deleteProductScoped).toHaveBeenCalledWith(expect.any(String), 'MN001');
    });
  });

  it('cancels item deletion without calling API when cancel is clicked in confirm dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-del-MN001')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('restaurant-menu-editor-del-MN001'));
    expect(screen.getByText('Delete Menu Item')).toBeInTheDocument();

    const cancelBtn = screen.getByTestId('confirm-dialog-cancel');
    await user.click(cancelBtn);

    expect(productsApi.deleteProductScoped).not.toHaveBeenCalled();
  });

  it('prompts confirmation dialog before deleting a category and executes delete on confirm', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-cat-del-cat-mains')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('restaurant-menu-editor-cat-del-cat-mains'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete Category')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete category "Mains"/i)).toBeInTheDocument();

    const confirmBtn = screen.getByTestId('confirm-dialog-confirm');
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(productsApi.deleteCategoryScoped).toHaveBeenCalledWith(expect.any(String), 'cat-mains');
    });
  });

  it('duplicates an existing menu item with 1-click clone and pre-filled draft', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-dup-MN001')).toBeInTheDocument();
    });

    // Click duplicate button on MN001
    await user.click(screen.getByTestId('restaurant-menu-editor-dup-MN001'));

    // Draft form should open prefilled
    const form = screen.getByTestId('restaurant-menu-editor-form');
    expect(form).toBeInTheDocument();
    const nameInput = screen.getByTestId('restaurant-menu-editor-name') as HTMLInputElement;
    expect(nameInput.value).toBe('Nasi Goreng Kampung (Copy)');

    const categorySelect = screen.getByTestId('restaurant-menu-editor-draft-category') as HTMLSelectElement;
    expect(categorySelect.value).toBe('Mains');

    // Save duplicated item
    await user.click(within(form).getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(productsApi.createProductScoped).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          name: 'Nasi Goreng Kampung (Copy)',
          priceMinor: 35000,
          notes: 'Served with crackers and pickles',
          productType: 'restaurant',
          isActive: true,
        }),
      );
    });
  });

  it('sorts menu items dynamically via sort selector', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByText('Nasi Goreng Kampung')).toBeInTheDocument();
      expect(screen.getByText('Es Teh Manis')).toBeInTheDocument();
    });

    const sortSelect = screen.getByTestId('restaurant-menu-editor-sort-select');

    // Sort price-asc: Es Teh Manis (8000) should appear before Nasi Goreng Kampung (35000)
    await user.selectOptions(sortSelect, 'price-asc');
    const cards = screen.getAllByTestId(/^menu-item-card-/);
    expect(cards[0]).toHaveTextContent('Es Teh Manis');
    expect(cards[1]).toHaveTextContent('Nasi Goreng Kampung');

    // Sort price-desc: Nasi Goreng Kampung (35000) before Es Teh Manis (8000)
    await user.selectOptions(sortSelect, 'price-desc');
    const cardsDesc = screen.getAllByTestId(/^menu-item-card-/);
    expect(cardsDesc[0]).toHaveTextContent('Nasi Goreng Kampung');
    expect(cardsDesc[1]).toHaveTextContent('Es Teh Manis');
  });

  it('updates availability in bulk for category items', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-bulk-avail')).toBeInTheDocument();
    });

    // Make all available: MN002 is currently inactive (is_active: false)
    await user.click(screen.getByTestId('restaurant-menu-editor-bulk-avail'));

    await waitFor(() => {
      expect(productsApi.updateProductScoped).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          sku: 'MN002',
          isActive: true,
        }),
      );
    });
  });

  it('builds and saves modifier groups for dish variations', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-edit-MN001')).toBeInTheDocument();
    });

    // Edit MN001
    await user.click(screen.getByTestId('restaurant-menu-editor-edit-MN001'));

    const addGroupBtn = screen.getByTestId('restaurant-menu-editor-add-group-btn');
    await user.click(addGroupBtn);

    // Group should appear
    expect(screen.getByTestId('modifier-group-0')).toBeInTheDocument();
    await user.type(screen.getByTestId('modifier-group-name-0'), 'Level Pedas');

    // Option name and price
    await user.type(screen.getByTestId('modifier-option-name-0-0'), 'Extra Pedas');
    await user.type(screen.getByTestId('modifier-option-price-0-0'), '2000');

    // Save draft
    const form = screen.getByTestId('restaurant-menu-editor-form');
    await user.click(within(form).getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(productsApi.updateProductScoped).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          sku: 'MN001',
          notes: expect.stringContaining('Level Pedas'),
        }),
      );
    });
  });

  it('supports adding and removing modifier options and groups interactively in the draft form', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-new-item')).toBeInTheDocument();
    });

    // Open new item draft
    await user.click(screen.getByTestId('restaurant-menu-editor-new-item'));

    // Add first group
    await user.click(screen.getByTestId('restaurant-menu-editor-add-group-btn'));
    expect(screen.getByTestId('modifier-group-0')).toBeInTheDocument();

    // Add a second option to group 0
    await user.click(screen.getByTestId('modifier-option-add-0'));
    expect(screen.getByTestId('modifier-option-name-0-1')).toBeInTheDocument();

    // Remove the first option (index 0)
    await user.click(screen.getByTestId('modifier-option-remove-0-0'));
    // Only one option should remain in group 0
    expect(screen.queryByTestId('modifier-option-name-0-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('modifier-option-name-0-0')).toBeInTheDocument();

    // Remove the whole group
    await user.click(screen.getByTestId('modifier-group-remove-0'));
    expect(screen.queryByTestId('modifier-group-0')).not.toBeInTheDocument();
  });

  it('supports configuring optional multi-select modifier variants with presets', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-new-item')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('restaurant-menu-editor-new-item'));

    // Fill item details for Ice Tea
    await user.type(screen.getByTestId('restaurant-menu-editor-name'), 'Ice Tea');
    await user.type(screen.getByTestId('restaurant-menu-editor-price'), '10000');

    // Add modifier group
    await user.click(screen.getByTestId('restaurant-menu-editor-add-group-btn'));
    await user.type(screen.getByTestId('modifier-group-name-0'), 'Sugar & Ice Level');

    // Add options
    await user.type(screen.getByTestId('modifier-option-name-0-0'), 'Less Sugar');
    await user.click(screen.getByTestId('modifier-option-add-0'));
    await user.type(screen.getByTestId('modifier-option-name-0-1'), 'Less Ice');
    await user.click(screen.getByTestId('modifier-option-add-0'));
    await user.type(screen.getByTestId('modifier-option-name-0-2'), 'No Sugar');

    // Click "Optional (Multi)" preset
    await user.click(screen.getByTestId('modifier-preset-opt-multi-0'));

    // Verify hint badge displays optional multi-select explanation
    expect(screen.getByText(/Optional — customer can select up to/i)).toBeInTheDocument();

    // Save item
    const form = screen.getByTestId('restaurant-menu-editor-form');
    await user.click(within(form).getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(productsApi.createProductScoped).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          name: 'Ice Tea',
          notes: expect.stringMatching(/"minSelections":0.*"maxSelections":3/),
        }),
      );
    });
  });

  it('filters dishes by availability status tabs', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByText('Nasi Goreng Kampung')).toBeInTheDocument();
      expect(screen.getByText('Es Teh Manis')).toBeInTheDocument();
    });

    // Click "Available" tab (MN001 is active, MN002 is inactive)
    const availTab = screen.getByRole('tab', { name: /Available/i });
    await user.click(availTab);
    expect(screen.getByText('Nasi Goreng Kampung')).toBeInTheDocument();
    expect(screen.queryByText('Es Teh Manis')).not.toBeInTheDocument();

    // Click "Hidden (86)" tab
    const hiddenTab = screen.getByRole('tab', { name: /Hidden/i });
    await user.click(hiddenTab);
    expect(screen.queryByText('Nasi Goreng Kampung')).not.toBeInTheDocument();
    expect(screen.getByText('Es Teh Manis')).toBeInTheDocument();

    // Click "All" tab
    const allTab = screen.getByRole('tab', { name: /All/i });
    await user.click(allTab);
    expect(screen.getByText('Nasi Goreng Kampung')).toBeInTheDocument();
    expect(screen.getByText('Es Teh Manis')).toBeInTheDocument();
  });

  it('clears search via the search clear button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByText('Nasi Goreng Kampung')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('restaurant-menu-editor-search-input');
    await user.type(searchInput, 'Teh');
    expect(screen.queryByText('Nasi Goreng Kampung')).not.toBeInTheDocument();
    expect(screen.getByText('Es Teh Manis')).toBeInTheDocument();

    // Clear button appears when query is non-empty
    const clearBtn = screen.getByLabelText('Clear search');
    await user.click(clearBtn);

    expect(screen.getByText('Nasi Goreng Kampung')).toBeInTheDocument();
    expect(screen.getByText('Es Teh Manis')).toBeInTheDocument();
  });

  it('guards unsaved draft changes when back button is pressed', async () => {
    const user = userEvent.setup();
    const handleBack = vi.fn();
    renderWithProviders(<RestaurantMenuEditorScreen onBack={handleBack} />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-new-item')).toBeInTheDocument();
    });

    // Open new item draft (marks form dirty)
    await user.click(screen.getByTestId('restaurant-menu-editor-new-item'));
    await user.type(screen.getByTestId('restaurant-menu-editor-name'), 'Draft Dish');

    // Attempt back navigation
    await user.click(screen.getByTestId('restaurant-menu-editor-back-btn'));

    // Unsaved changes dialog should open
    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument();
    expect(handleBack).not.toHaveBeenCalled();

    // Click discard
    const discardBtn = screen.getByTestId('unsaved-dialog-discard');
    await user.click(discardBtn);

    expect(handleBack).toHaveBeenCalled();
  });

  it('allows editing an existing category from the category rail', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RestaurantMenuEditorScreen />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-cat-edit-cat-mains')).toBeInTheDocument();
    });

    // Click edit on Mains category
    await user.click(screen.getByTestId('restaurant-menu-editor-cat-edit-cat-mains'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Edit Category')).toBeInTheDocument();

    const nameInput = screen.getByTestId('restaurant-menu-editor-cat-input-name') as HTMLInputElement;
    expect(nameInput.value).toBe('Mains');

    await user.clear(nameInput);
    await user.type(nameInput, 'Main Courses');
    await user.click(screen.getByTestId('restaurant-menu-editor-cat-save'));

    await waitFor(() => {
      expect(productsApi.updateCategoryScoped).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          id: 'cat-mains',
          name: 'Main Courses',
        }),
      );
    });
  });

  it('closes category modal when Escape key is pressed', async () => {
    const user = userEvent.setup();
    const handleBack = vi.fn();
    renderWithProviders(<RestaurantMenuEditorScreen onBack={handleBack} />, productsFtl);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-menu-editor-btn-add-cat')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('restaurant-menu-editor-btn-add-cat'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
