import type React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import { FluentResource, FluentBundle } from '@fluent/bundle';
import { EditProductModal } from '@/features/retail/EditProductModal';
import type { ProductDto, ProductImageDto } from '@/api/products';
import type * as ProductsModule from '@/api/products';

// ── Mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  pickImage: vi.fn(),
  setImage: vi.fn(),
  clearImage: vi.fn(),
  listImages: vi.fn(),
}));

// The modal no longer calls the dialog plugin directly: it goes through
// `pickImageFile`, which owns the Android content-URI bridge. Mocking that seam
// keeps this file about the modal, and leaves the bridge to its own test
// (`imagePick.test.ts`). It also means these tests no longer need
// `@tauri-apps/plugin-fs` or `@tauri-apps/api/path` mocked at all.
vi.mock('@/api/image-pick', () => ({ pickImageFile: mocks.pickImage }));

/**
 * jsdom has no `__TAURI_INTERNALS__`, so `isTauriWebview()` reads false and the
 * modal's new picker guard short-circuits before the mocked helper is reached.
 * The predicate tests for a CALLABLE `invoke`, not for the key's presence — a
 * bare `{}` does not count, and neither does the dev preview's
 * `{ transformCallback }` stub (`api/tauri.ts:29-57`). Same stub shape as
 * `useUnsavedChangesGuard.test.tsx:65`.
 */
function stubTauriWebview(on: boolean): void {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
  if (on) w.__TAURI_INTERNALS__ = { invoke: () => Promise.resolve() };
  else delete w.__TAURI_INTERNALS__;
}

vi.mock('@/api/products', async (importActual) => {
  const actual = await importActual<typeof ProductsModule>();
  return {
    ...actual,
    productsSetImageScoped: mocks.setImage,
    productsClearImageScoped: mocks.clearImage,
    productsListImagesScoped: mocks.listImages,
  };
});

const sampleProduct: ProductDto = {
  sku: 'CPU-R7-7800X3D',
  name: 'AMD Ryzen 7 7800X3D 8-Core',
  category: 'cat-cpu',
  price: { minor_units: 6250000, currency: 'IDR' },
  barcode: '730143314930',
  in_stock: true,
  stock_qty: 15,
  product_type: 'retail',
  tax_rate_ids: [],
  created_at: '',
  price_updated_at: '',
  low_stock_threshold: 5,
  high_stock_threshold: 10,
};

const menuProduct: ProductDto = {
  ...sampleProduct,
  sku: 'MENU-001',
  name: 'Nasi Goreng',
  product_type: 'restaurant',
};

const ftl = `
retail-edit-product-title = Edit Product
retail-edit-field-sku = SKU / Code
retail-edit-field-name = Product Name
retail-edit-field-price = Price (IDR)
retail-edit-field-stock = Stock Quantity
retail-edit-field-low-stock = Low Stock Threshold
retail-edit-field-high-stock = High Stock Threshold
retail-edit-save = Save Changes
retail-edit-cancel = Cancel
retail-edit-btn-aria = Edit product { $name }
close-aria = Close
retail-edit-image-title = Product Images
retail-edit-image-primary = Primary image
retail-edit-image-alternatives = Additional images
retail-edit-image-set = Set Image
retail-edit-image-set-aria = Choose a new image for { $name }
retail-edit-image-clear = Remove
retail-edit-image-clear-aria = Remove the image for { $name }
retail-edit-image-clear-alt-aria = Remove additional image { $slot } for { $name }
retail-edit-image-uploading = Uploading image…
retail-edit-image-error = Could not update the image. Try again.
retail-edit-image-menu-note = Menu items always have exactly one image.
retail-edit-image-alt = { $name } image { $slot }
image-pick-app-only = Choosing a photo needs the kasir.mu app
`;

function wrapper({ children }: { children: React.ReactNode }) {
  const resource = new FluentResource(ftl);
  const bundle = new FluentBundle('en');
  bundle.addResource(resource);
  const l10n = new ReactLocalization([bundle]);
  return <LocalizationProvider l10n={l10n}>{children}</LocalizationProvider>;
}

describe('EditProductModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Baseline: not a Tauri webview. Tests that need the picker opt in, so a
    // leftover stub from an earlier test cannot make a guard look exercised.
    stubTauriWebview(false);
    mocks.pickImage.mockReset();
    mocks.setImage.mockReset();
    mocks.clearImage.mockReset();
    mocks.listImages.mockReset();
  });
  it('does not render when isOpen is false', () => {
    render(
      <EditProductModal
        product={sampleProduct}
        isOpen={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
      { wrapper },
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders modal with initial product values when open', () => {
    render(
      <EditProductModal
        product={sampleProduct}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
      { wrapper },
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByDisplayValue('CPU-R7-7800X3D')).toBeInTheDocument();
    expect(screen.getByDisplayValue('AMD Ryzen 7 7800X3D 8-Core')).toBeInTheDocument();
    expect(screen.getByDisplayValue('6250000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('15')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();
  });

  it('calls onClose when Cancel or close X is clicked', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();

    render(
      <EditProductModal
        product={sampleProduct}
        isOpen={true}
        onClose={handleClose}
        onSave={vi.fn()}
      />,
      { wrapper },
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handleClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(handleClose).toHaveBeenCalledTimes(2);
  });

  it('submits updated product fields when Save Changes is clicked', async () => {
    const user = userEvent.setup();
    const handleSave = vi.fn();
    const handleClose = vi.fn();

    render(
      <EditProductModal
        product={sampleProduct}
        isOpen={true}
        onClose={handleClose}
        onSave={handleSave}
      />,
      { wrapper },
    );

    const nameInput = screen.getByDisplayValue('AMD Ryzen 7 7800X3D 8-Core');
    const priceInput = screen.getByDisplayValue('6250000');
    const stockInput = screen.getByDisplayValue('15');
    const lowInput = screen.getByDisplayValue('5');
    const highInput = screen.getByDisplayValue('10');

    await user.clear(nameInput);
    await user.type(nameInput, 'AMD Ryzen 7 7800X3D (Edited)');

    await user.clear(priceInput);
    await user.type(priceInput, '6500000');

    await user.clear(stockInput);
    await user.type(stockInput, '20');

    await user.clear(lowInput);
    await user.type(lowInput, '3');

    await user.clear(highInput);
    await user.type(highInput, '12');

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(handleSave).toHaveBeenCalledWith({
      ...sampleProduct,
      name: 'AMD Ryzen 7 7800X3D (Edited)',
      price: { minor_units: 6500000, currency: 'IDR' },
      stock_qty: 20,
      in_stock: true,
      low_stock_threshold: 3,
      high_stock_threshold: 12,
      // ADR #36 attributes default in the modal.
      cost_minor: 0,
      brand: null,
      rack_location: null,
      notes: null,
      unit: null,
      is_active: true,
      default_supplier_id: null,
      popularity_score: 0,
    });
    expect(handleClose).toHaveBeenCalled();
  });

  // ── Product image editor (spec 0046b §3.2–3.3) ──────────────────

  it('hides the image editor when no sessionToken is provided', () => {
    render(
      <EditProductModal
        product={sampleProduct}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.queryByText('Product Images')).not.toBeInTheDocument();
    expect(mocks.listImages).not.toHaveBeenCalled();
  });

  it('shows the image editor and loads existing images when sessionToken + product.id are present', async () => {
    const existing: ProductImageDto[] = [
      { slot: 1, hash: 'aaaa1111aaaa1111', position: 0 },
      { slot: 2, hash: 'bbbb2222bbbb2222', position: 1 },
    ];
    mocks.listImages.mockResolvedValue(existing);

    render(
      <EditProductModal
        product={{ ...sampleProduct, id: 'prod-1' }}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
        sessionToken="tok-1"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText('Product Images')).toBeInTheDocument();
    });
    expect(mocks.listImages).toHaveBeenCalledWith('tok-1', 'prod-1');
    // Alternatives strip is present for a retail product.
    expect(screen.getByText('Additional images')).toBeInTheDocument();
  });

  it('sets the primary image through the picker bridge + scoped command', async () => {
    const user = userEvent.setup();
    stubTauriWebview(true);
    const release = vi.fn();
    mocks.pickImage.mockResolvedValue({ path: '/path/to/photo.png', release });
    mocks.setImage.mockResolvedValue('cafe0000cafe0000');
    mocks.listImages.mockResolvedValue([]);

    render(
      <EditProductModal
        product={{ ...sampleProduct, id: 'prod-1' }}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
        sessionToken="tok-1"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText('Product Images')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Choose a new image/ }));

    // The path the bridge resolved is what reaches the scoped command — on
    // Android that is the cache copy, never the `content://` URI.
    await waitFor(() => {
      expect(mocks.setImage).toHaveBeenCalledWith('tok-1', 'prod-1', 1, '/path/to/photo.png');
    });
    // The bridged temp copy is released once the ingest has settled.
    expect(release).toHaveBeenCalled();
    // Reloads the list after setting.
    expect(mocks.listImages).toHaveBeenCalledTimes(2);
  });

  it('reports the app-only message instead of throwing outside a webview', async () => {
    const user = userEvent.setup();
    mocks.listImages.mockResolvedValue([]);

    render(
      <EditProductModal
        product={{ ...sampleProduct, id: 'prod-1' }}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
        sessionToken="tok-1"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText('Product Images')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Choose a new image/ }));

    // Before this guard existed the browser dev preview reached `open()` and
    // threw `__TAURI_INTERNALS__.invoke is not a function`, so the click
    // reported a hard failure. It now says what is actually wrong.
    await waitFor(() => {
      expect(screen.getByText('Choosing a photo needs the kasir.mu app')).toBeInTheDocument();
    });
    expect(mocks.pickImage).not.toHaveBeenCalled();
    expect(mocks.setImage).not.toHaveBeenCalled();
  });

  it('clears an assigned alternative slot via the scoped command', async () => {
    const user = userEvent.setup();
    mocks.listImages.mockResolvedValue([
      { slot: 1, hash: 'aaaa1111aaaa1111', position: 0 },
      { slot: 2, hash: 'bbbb2222bbbb2222', position: 1 },
    ]);

    render(
      <EditProductModal
        product={{ ...sampleProduct, id: 'prod-1' }}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
        sessionToken="tok-1"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText('Product Images')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Remove additional image/ }));

    await waitFor(() => {
      expect(mocks.clearImage).toHaveBeenCalledWith('tok-1', 'prod-1', 2);
    });
  });

  it('refuses to clear the primary image of a menu item and shows the note', async () => {
    mocks.listImages.mockResolvedValue([{ slot: 1, hash: 'aaaa1111aaaa1111', position: 0 }]);

    render(
      <EditProductModal
        product={{ ...menuProduct, id: 'menu-1' }}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
        sessionToken="tok-1"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText('Product Images')).toBeInTheDocument();
    });
    // Menu items: no alternatives strip, and the note is visible.
    expect(screen.queryByText('Additional images')).not.toBeInTheDocument();
    expect(screen.getByText('Menu items always have exactly one image.')).toBeInTheDocument();
    // No remove button on a menu primary image.
    expect(screen.queryByRole('button', { name: /Remove the image for Nasi Goreng/ })).not.toBeInTheDocument();
  });
});
