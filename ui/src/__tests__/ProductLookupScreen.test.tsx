import { describe, expect, it, vi } from 'vitest';
import { screen, within, waitFor, fireEvent } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { renderWithFluent } from '@/__tests__/test-utils/render';
import { withFluentLocale } from '@/locales/test-utils';
import productsFtl from '@/locales/products.ftl?raw';
import productsId from '@/locales/products.id.ftl?raw';
import sharedId from '@/locales/shared.id.ftl?raw';

import { ToastProvider } from '@/components/Toast';
import { ScannerError } from '@/api/hardware';
import * as bundlesApi from '@/api/bundles';
import ProductLookupScreen from '@/features/products/ProductLookupScreen';
import type { Product } from '@/types/domain';
import type * as productsModule from '@/api/products';

// ── Mock: make the scoped catalogue reads reject so useProducts
//    falls back to its own SAMPLE_PRODUCTS (coffee-shop items) instead
//    of the dev-mock's PC hardware catalog. All other exports (e.g.
//    lookupProductBySkuScoped) remain the real implementations.
vi.mock('@/api/products', async (importOriginal) => {
  const actual = await importOriginal<typeof productsModule>();
  return {
    ...actual,
    // T21: the unscoped listProducts / listCategories doors were deleted from the module, so
    // overriding them configured nothing and the real scoped reads ran instead — the fallback
    // this file is about never happened. Reject the doors the hook actually calls.
    listProductsScoped: vi.fn(() => Promise.reject(new Error('IPC unavailable'))),
    listCategoriesScoped: vi.fn(() => Promise.reject(new Error('IPC unavailable'))),
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

function fillInput(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function pressEnter(element: HTMLElement) {
  fireEvent.keyDown(element, { key: 'Enter' });
}

function clickButton(name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function clickRadio(name: string | RegExp) {
  fireEvent.click(screen.getByRole('radio', { name }));
}

async function waitForProducts() {
  // P200 a11y fix: product grid uses role="grid" (label is on parent container)
  await screen.findByRole('grid');
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ProductLookupScreen', () => {
  it('renders the search bar and barcode input', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    expect(screen.getByRole('searchbox', { name: /search for products/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/enter or scan a barcode/i)).toBeInTheDocument();
  });

  it('renders category filter chips after loading', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    await waitFor(() => {
      expect(screen.getByRole('radiogroup', { name: /filter by category/i })).toBeInTheDocument();
    });
    // "All Categories", "Beverages", "Food" (after async fallback loads)
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /all categories/i })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /^Cold Drinks$/ })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /^Food$/ })).toBeInTheDocument();
    });
  });

  it('renders all products in the grid by default', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    await waitForProducts();
    // Virtualized grid — count product card buttons instead of rows
    const productButtons = screen.getAllByRole('button', { name: /sku:/i });
    expect(productButtons.length).toBe(18);
  });

  it('filters products by search query (name)', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    await waitForProducts();
    fillInput(/search for products/i, 'Latte');
    // Virtualized: 2 matching products (Caffè Latte, Matcha Latte)
    expect(screen.getByText('Caffè Latte')).toBeInTheDocument();
    expect(screen.getByText('Matcha Latte')).toBeInTheDocument();
    expect(screen.queryByText('Espresso Shot')).not.toBeInTheDocument();
  });

  it('filters products by search query (SKU)', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    await waitForProducts();
    fillInput(/search for products/i, 'ESPR');
    const list = screen.getByRole('grid');
    const items = within(list).getAllByRole('row');
    expect(items.length).toBe(1);
    expect(screen.getByText(/Espresso Shot/)).toBeInTheDocument();
  });

  it('filters products by search query (barcode)', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    await waitForProducts();
    // Search for barcode "4901234567904" (Orange Juice)
    fillInput(/search for products/i, '7904');
    const list = screen.getByRole('grid');
    const items = within(list).getAllByRole('row');
    expect(items.length).toBe(1);
    expect(screen.getByText(/Orange Juice/)).toBeInTheDocument();
  });

  it('shows empty state when no products match', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    await waitForProducts();
    fillInput(/search for products/i, 'zzzznotfound');
    expect(screen.getByText(/no products found/i)).toBeInTheDocument();
  });

  it('offers a clear-search action that restores results (EMPTY-05)', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    await waitForProducts();
    fillInput(/search for products/i, 'zzzznotfound');
    expect(screen.getByText(/no products found/i)).toBeInTheDocument();

    // The no-results state must announce via role=status and offer Clear search.
    const status = document.querySelector('[role="status"]');
    expect(status?.textContent).toMatch(/no products found/i);
    clickButton(/clear search/i);

    // Grid returns after clearing the search.
    await waitForProducts();
    expect(screen.getByText('Caffè Latte')).toBeInTheDocument();
  });

  it('offers clear-search after a search + category combo empties the grid (EMPTY-05)', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    await waitForProducts();
    // A non-matching search plus an active category filter leaves the grid
    // empty; the clear action must reset BOTH so results return.
    fillInput(/search for products/i, 'zzzznotfound');
    clickRadio(/^Food$/);
    await waitFor(() => {
      expect(screen.getByText(/no products found/i)).toBeInTheDocument();
    });
    clickButton(/clear search/i);
    await waitForProducts();
    expect(screen.getByText('Caffè Latte')).toBeInTheDocument();
  });

  it('filters by category using chip button', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    await waitForProducts();
    clickRadio(/^Food$/);
    // Virtualized: 5 food items should be visible
    expect(screen.getByText('Plain Bagel')).toBeInTheDocument();
    expect(screen.getByText('Butter Croissant')).toBeInTheDocument();
    // No beverage items
    expect(screen.queryByText('Caffè Latte')).not.toBeInTheDocument();
  });

  it('switching to "All Categories" shows all products', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    await waitForProducts();
    // First filter to Food
    clickRadio(/^Food$/);
    // Then back to All
    clickRadio(/all categories/i);
    // Virtualized: all products visible again
    expect(screen.getByText('Caffè Latte')).toBeInTheDocument();
    expect(screen.getByText('Orange Juice')).toBeInTheDocument();
  });

  it('renders product card with name, price, SKU, and stock indicator', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    await waitForProducts();
    // Check a specific product is rendered
    expect(screen.getByText('Caffè Latte')).toBeInTheDocument();
    expect(screen.getByText('$ 4,50')).toBeInTheDocument();
    expect(screen.getByText('LATTE')).toBeInTheDocument();
    expect(screen.getAllByText(/in stock/i).length).toBeGreaterThanOrEqual(1);
  });

  it('marks out-of-stock products with disabled style and disabled button', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    await waitForProducts();
    // Brownie is out of stock
    const brownie = screen.getByText('Fudge Brownie');
    expect(brownie).toBeInTheDocument();

    // Out-of-stock text
    const outOfStock = screen.getAllByText(/out of stock/i);
    expect(outOfStock.length).toBeGreaterThanOrEqual(2); // Brownie + Chocolate Muffin

    // All 18 cards have buttons (disabled for out-of-stock)
    const productButtons = screen.getAllByRole('button', { name: /sku:/i });
    expect(productButtons.length).toBe(18);

    // 2 buttons should be disabled (out of stock)
    const disabledBtns = productButtons.filter((btn) => btn.hasAttribute('disabled'));
    expect(disabledBtns.length).toBe(2);
  });

  it('calls onAddProduct when clicking the add button', async () => {
    const handler = vi.fn();
    await renderWithFluent(<ToastProvider><ProductLookupScreen onAddProduct={handler} /></ToastProvider>, productsFtl);
    await waitForProducts();

    clickButton(/Caffè Latte/i);

    expect(handler).toHaveBeenCalledTimes(1);
    const product = handler.mock.calls[0]![0] as Product;
    expect(product.sku).toBe('LATTE');
    expect(product.name).toBe('Caffè Latte');
  });

  it('calls onAddProduct on Enter key for in-stock product card', async () => {
    const handler = vi.fn();
    await renderWithFluent(<ToastProvider><ProductLookupScreen onAddProduct={handler} /></ToastProvider>, productsFtl);
    await waitForProducts();

    const cardBtn = screen.getByRole('button', { name: /Caffè Latte/i });
    // Pressing Enter on a focused button is equivalent to clicking it.
    fireEvent.click(cardBtn);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('handles barcode scan via Enter key in barcode input', async () => {
    const handler = vi.fn();
    await renderWithFluent(<ToastProvider><ProductLookupScreen onAddProduct={handler} /></ToastProvider>, productsFtl);
    await waitForProducts();

    const barcodeInput = screen.getByLabelText(/enter or scan a barcode/i);
    fillInput(/enter or scan a barcode/i, '4901234567890');
    pressEnter(barcodeInput);

    expect(handler).toHaveBeenCalledTimes(1);
    const product = handler.mock.calls[0]![0] as Product;
    expect(product.sku).toBe('LATTE');
  });

  it('handles barcode scan via Scan button', async () => {
    const handler = vi.fn();
    await renderWithFluent(<ToastProvider><ProductLookupScreen onAddProduct={handler} /></ToastProvider>, productsFtl);
    await waitForProducts();

    fillInput(/enter or scan a barcode/i, '4901234567904');

    clickButton(/submit the entered barcode/i);

    expect(handler).toHaveBeenCalledTimes(1);
    const product = handler.mock.calls[0]![0] as Product;
    expect(product.sku).toBe('JUICE-O');
  });

  it('does not call onAddProduct for unknown barcode', async () => {
    const handler = vi.fn();
    await renderWithFluent(<ToastProvider><ProductLookupScreen onAddProduct={handler} /></ToastProvider>, productsFtl);
    await waitForProducts();

    const barcodeInput = screen.getByLabelText(/enter or scan a barcode/i);
    fillInput(/enter or scan a barcode/i, '0000000000000');
    pressEnter(barcodeInput);

    expect(handler).not.toHaveBeenCalled();
  });

  it('clears barcode input after scan', async () => {
    const handler = vi.fn();
    await renderWithFluent(<ToastProvider><ProductLookupScreen onAddProduct={handler} /></ToastProvider>, productsFtl);
    await waitForProducts();

    const barcodeInput = screen.getByLabelText(/enter or scan a barcode/i);
    fillInput(/enter or scan a barcode/i, '4901234567890');
    pressEnter(barcodeInput);

    expect(barcodeInput).toHaveValue('');
  });

  it('renders product category badges', async () => {
    await renderWithFluent(<ToastProvider><ProductLookupScreen /></ToastProvider>, productsFtl);
    await waitForProducts();
    const badges = screen.getAllByText(/^Cold Drinks$|^Hot Drinks$|^Food$|^Snacks$/);
    expect(badges.length).toBeGreaterThanOrEqual(17);
  });

  it('silently swallows when lookupBundleBySku rejects with a ScannerError in the barcode scan catch block', async () => {
    const handler = vi.fn();
    await renderWithFluent(<ToastProvider><ProductLookupScreen onAddProduct={handler} /></ToastProvider>, productsFtl);
    await waitForProducts();

    // Spy on lookupBundleBySku and make it reject with a ScannerError.
    // The barcode doesn't match any product's barcode, so the callback
    // falls through to the bundle lookup path, which rejects.
    vi.spyOn(bundlesApi, 'lookupBundleBySku').mockRejectedValueOnce(
      new ScannerError(
        'Scanner disconnected — check USB connection',
        ScannerError.codes.DISCONNECTED,
      ),
    );

    const barcodeInput = screen.getByLabelText(/enter or scan a barcode/i);
    fillInput(/enter or scan a barcode/i, '0000000000000');
    pressEnter(barcodeInput);

    // The catch block silently swallows the ScannerError.
    // No product should have been added.
    expect(handler).not.toHaveBeenCalled();

    // Barcode input should still be cleared after the catch block.
    // Use waitFor because handleBarcodeScan is async and the
    // setBarcodeInput('') runs on a microtask after the await.
    await waitFor(() => {
      expect(barcodeInput).toHaveValue('');
    });
  });
});

// ── Indonesian locale ────────────────────────────────────────────

describe('ProductLookupScreen — locale: id', () => {
  it('renders the Indonesian-translated search and barcode inputs', async () => {
    await renderInAct(
      withFluentLocale(
        'id',
        <ToastProvider><ProductLookupScreen /></ToastProvider>,
        productsId,
        sharedId,
      ),
    );
    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: /Cari produk/i })).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Masukkan atau pindai barcode/i)).toBeInTheDocument();
  });
});
