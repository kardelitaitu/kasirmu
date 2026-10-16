import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import kioskFtl from '@/locales/kiosk.ftl?raw';

const { mockListProducts, mockListCategories } = vi.hoisted(() => ({
  mockListProducts: vi.fn(),
  mockListCategories: vi.fn(),
}));

vi.mock('@/api/products', () => ({
  listProducts: () => mockListProducts(),
  listProductsScoped: () => mockListProducts(),
  listCategories: () => mockListCategories(),
  listCategoriesScoped: () => mockListCategories(),
}));

// Kiosk renders prices/totals via the store default currency (IDR fixtures).
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'IDR', setCurrency: vi.fn(), loading: false }),
}));

import KioskScreen from '@/features/kiosk/KioskScreen';

// KioskScreen uses useToast — must wrap in ToastProvider via renderWithProviders.
const renderKiosk = (ftl: string) => renderWithProviders(<KioskScreen />, ftl);

const sampleProducts = [
  { sku: 'SKU-001', name: 'Indomie Goreng', category: 'cat-food', price: { minor_units: 3500, currency: 'IDR' }, barcode: '8991002100110', in_stock: true, stock_qty: 100, tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'SKU-002', name: 'Teh Botol Sosro', category: 'cat-drink', price: { minor_units: 5000, currency: 'IDR' }, barcode: '8991002100220', in_stock: true, stock_qty: 50, tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'SKU-003', name: 'Nasi Goreng Spesial', category: 'cat-food', price: { minor_units: 15000, currency: 'IDR' }, barcode: null, in_stock: true, stock_qty: 20, tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'SKU-004', name: 'Aqua 600ml', category: 'cat-drink', price: { minor_units: 3000, currency: 'IDR' }, barcode: '8991002100330', in_stock: true, stock_qty: 3, tax_rate_ids: [], created_at: '', price_updated_at: '' },
];

const sampleCategories = [
  { id: 'cat-food', name: 'Makanan', colour: '#e74c3c' },
  { id: 'cat-drink', name: 'Minuman', colour: '#3498db' },
];



describe('KioskScreen', () => {
  it('loads and displays products', async () => {
    mockListProducts.mockResolvedValue(sampleProducts);
    mockListCategories.mockResolvedValue(sampleCategories);
    await renderKiosk(kioskFtl);

    await waitFor(() => {
      expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    });
    expect(screen.getByText('Teh Botol Sosro')).toBeInTheDocument();
    expect(screen.getByText('Nasi Goreng Spesial')).toBeInTheDocument();
    expect(screen.getByText('Aqua 600ml')).toBeInTheDocument();
  });

  it('renders category filter buttons', async () => {
    mockListProducts.mockResolvedValue(sampleProducts);
    mockListCategories.mockResolvedValue(sampleCategories);
    await renderKiosk(kioskFtl);

    await waitFor(() => {
      expect(screen.getByText('All')).toBeInTheDocument();
    });
    expect(screen.getByText('Makanan')).toBeInTheDocument();
    expect(screen.getByText('Minuman')).toBeInTheDocument();
  });

  it('filters products by category', async () => {
    mockListProducts.mockResolvedValue(sampleProducts);
    mockListCategories.mockResolvedValue(sampleCategories);
    await renderKiosk(kioskFtl);

    await waitFor(() => {
      expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Minuman'));

    expect(screen.queryByText('Indomie Goreng')).not.toBeInTheDocument();
    expect(screen.queryByText('Nasi Goreng Spesial')).not.toBeInTheDocument();
    expect(screen.getByText('Teh Botol Sosro')).toBeInTheDocument();
    expect(screen.getByText('Aqua 600ml')).toBeInTheDocument();
  });

  it('shows all products when All category is selected', async () => {
    mockListProducts.mockResolvedValue(sampleProducts);
    mockListCategories.mockResolvedValue(sampleCategories);
    await renderKiosk(kioskFtl);

    await waitFor(() => {
      expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Makanan'));
    expect(screen.queryByText('Teh Botol Sosro')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('All'));
    expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    expect(screen.getByText('Teh Botol Sosro')).toBeInTheDocument();
  });

  it('adds product to cart when clicked', async () => {
    mockListProducts.mockResolvedValue(sampleProducts);
    mockListCategories.mockResolvedValue(sampleCategories);
    await renderKiosk(kioskFtl);

    await waitFor(() => {
      expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Indomie Goreng'));

    await waitFor(() => {
      expect(screen.getByText('Checkout')).toBeInTheDocument();
    });
  });

  it('shows cart items after adding products', async () => {
    mockListProducts.mockResolvedValue(sampleProducts);
    mockListCategories.mockResolvedValue(sampleCategories);
    await renderKiosk(kioskFtl);

    await waitFor(() => {
      expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Indomie Goreng'));
    await userEvent.click(screen.getByText('Teh Botol Sosro'));

    await waitFor(() => {
      const indomieItems = screen.getAllByText(/Indomie/);
      expect(indomieItems.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getAllByText(/Teh Botol/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows attract screen after idle timeout', async () => {
    vi.useFakeTimers();
    mockListProducts.mockResolvedValue(sampleProducts);
    mockListCategories.mockResolvedValue(sampleCategories);
    await renderKiosk(kioskFtl);

    await act(async () => {
      vi.advanceTimersByTime(61000);
    });
    vi.useRealTimers();

    expect(screen.getByText('Tap to start')).toBeInTheDocument();
  });

  it('exits attract screen on click', async () => {
    vi.useFakeTimers();
    mockListProducts.mockResolvedValue(sampleProducts);
    mockListCategories.mockResolvedValue(sampleCategories);
    await renderKiosk(kioskFtl);

    await act(async () => {
      vi.advanceTimersByTime(61000);
    });
    vi.useRealTimers();

    expect(screen.getByText('Tap to start')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByText('Tap to start'));

    await waitFor(() => {
      expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    });
  });

  // ── "Payment processed!" must be a claim the code can support ──────────
  //
  // The Pay button (:164-168) toasts `kiosk-pay-success` — "Payment processed!" /
  // "Pembayaran berhasil!" — and clears local state. It calls NO sales API: the file
  // imports nothing from `@/api/sales` (`listProductsScoped` and
  // `listCategoriesScoped` are the only API imports) and contains no dynamic import.
  //
  // So a customer taps Pay, the kiosk tells them the payment succeeded, and NO SALE
  // EXISTS: no revenue recorded, no stock deducted, nothing for reconciliation. On a
  // CUSTOMER-FACING device with no staff in the loop, that is the strongest claim the
  // UI can make about money and the one it is least entitled to.
  //
  // This is not a demo shell: `register.tsx` registers the route behind the real
  // backend feature `Feature::SelfServiceKiosk` (`crates/kasirmu-core/src/features.rs:499`)
  // with a nav item, and no plan or record documents the gap.
  //
  // A SOURCE check, because the fix is to wire a sale (or to stop claiming one) and
  // the defect is the ABSENCE of a call — which a render test can only observe as
  // "a toast appeared", the same thing it observes when the call succeeds.
  it('does not claim the payment was processed without recording a sale', () => {
    const src = readFileSync(resolve(__dirname, '../features/kiosk/KioskScreen.tsx'), 'utf-8');
    // Strip comments before matching: a fix would explain itself in prose.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    const claimsSuccess = /kiosk-pay-success/.test(code);
    const recordsSale =
      /completeSaleScoped|startSaleScoped|finalizeSale|from '@\/api\/sales'/.test(code) ||
      /import\(/.test(code);

    expect(
      claimsSuccess && !recordsSale,
      'the kiosk tells the customer "Payment processed!" while calling no sales API, '
      + 'so no sale is recorded — either wire the sale or stop claiming it was paid',
    ).toBe(false);
  });

  // ── The attract screen must also DISCARD the abandoned order ───────────
  //
  // `resetIdle` clears only the `idle` flag. `setCart([])` and `setCheckout(false)`
  // exist on the PAY handler alone (:138-139), so an order abandoned at the attract
  // screen survives into the next customer's session.
  //
  // The consequence is not cosmetic and this is a CUSTOMER-FACING device with no
  // staff in the loop:
  //
  //   1. Customer A adds items and taps Checkout, then walks away.
  //   2. 60 s pass; the attract screen appears.
  //   3. Customer B taps "Tap to start".
  //   4. `idle` goes false and `checkout` is STILL TRUE — so B lands on A's
  //      checkout total, sees A's items, and can tap Pay.
  //
  // Both existing idle cases start from an EMPTY cart and no checkout, so neither
  // can observe it: idle-with-an-order is the state that matters and nothing
  // constructed it.
  it('discards an abandoned order when the attract screen is dismissed', async () => {
    // FAKE TIMERS FROM THE START, and every interaction goes through `fireEvent`.
    //
    // The first draft enabled fake timers only before the idle advance, which cannot
    // work: the mount effect (:57-61) and every `resetIdle` install their timer with
    // whatever `setTimeout` is current AT THAT MOMENT. Clicks made under real timers
    // left a real timer pending, so `advanceTimersByTime` had nothing of its own to
    // fire — measured, the checkout screen was still up after advancing 61 s.
    vi.useFakeTimers();
    try {
      mockListProducts.mockResolvedValue(sampleProducts);
      mockListCategories.mockResolvedValue(sampleCategories);
      await renderKiosk(kioskFtl);

      await act(async () => {
        await Promise.resolve();
      });

      // Customer A builds an order and opens checkout.
      fireEvent.click(screen.getByText('Indomie Goreng'));
      fireEvent.click(screen.getByText('Checkout'));
      expect(screen.getByText('Pay'), 'A is at the checkout step').toBeInTheDocument();

      // A walks away; the kiosk idles out. The idle listener is on `window`
      // click/touch/keydown (:63-73), so every interaction resets the timer.
      await act(async () => {
        vi.advanceTimersByTime(61000);
      });
      expect(
        screen.getByText('Tap to start'),
        'the kiosk must idle out while a checkout is open',
      ).toBeInTheDocument();

      // Customer B starts a session.
      fireEvent.click(screen.getByText('Tap to start'));

      expect(
        screen.queryByText('Pay'),
        'customer B landed on customer A\'s checkout — the abandoned order, its total, '
        + 'and the Pay button all survived the attract screen',
      ).toBeNull();
      // The cart region renders ONLY when the cart is non-empty (KioskScreen:209), so
      // its absence is the assertion — there is no "Cart is empty" string on this
      // screen, which the first draft of this case assumed.
      expect(
        screen.queryByRole('region', { name: /cart/i }),
        'the abandoned cart must be gone, not merely off the checkout step',
      ).toBeNull();
    } finally {
      // IN A `finally`: the first draft restored real timers after the assertions, so
      // a failure left them installed and broke the SEVEN cases below it — a test that
      // fails loudly is fine, one that poisons its neighbours is not.
      vi.useRealTimers();
    }
  });

  it('increments quantity when same product is added again', async () => {
    mockListProducts.mockResolvedValue(sampleProducts);
    mockListCategories.mockResolvedValue(sampleCategories);
    await renderKiosk(kioskFtl);

    await waitFor(() => {
      expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    });

    const productCard1 = screen.getAllByText('Indomie Goreng');
    await userEvent.click(productCard1[0]!);
    const productCard2 = screen.getAllByText('Indomie Goreng');
    await userEvent.click(productCard2[0]!);

    await waitFor(() => {
      expect(screen.getByText('Checkout')).toBeInTheDocument();
    });
  });

  it('opens checkout screen when Checkout is clicked', async () => {
    mockListProducts.mockResolvedValue(sampleProducts);
    mockListCategories.mockResolvedValue(sampleCategories);
    await renderKiosk(kioskFtl);

    await waitFor(() => {
      expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Indomie Goreng'));

    await userEvent.click(screen.getByText('Checkout'));

    await waitFor(() => {
      expect(screen.getByText(/Checkout/)).toBeInTheDocument();
    });
  });

  it('shows low stock badge for products with stock <= 5', async () => {
    mockListProducts.mockResolvedValue(sampleProducts);
    mockListCategories.mockResolvedValue(sampleCategories);
    await renderKiosk(kioskFtl);

    await waitFor(() => {
      expect(screen.getByText(/3 left/)).toBeInTheDocument();
    });
  });

  it('shows back button in checkout', async () => {
    mockListProducts.mockResolvedValue(sampleProducts);
    mockListCategories.mockResolvedValue(sampleCategories);
    await renderKiosk(kioskFtl);

    await waitFor(() => {
      expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Indomie Goreng'));
    await userEvent.click(screen.getByText('Checkout'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    });
  });

  it('shows a retry surface when the menu fails to load', async () => {
    mockListProducts.mockRejectedValue(new Error('boom'));
    mockListCategories.mockRejectedValue(new Error('boom'));
    await renderKiosk(kioskFtl);

    await waitFor(() => {
      expect(screen.getByText('Failed to load the menu')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('recovers after retry when the menu load succeeds', async () => {
    mockListProducts.mockRejectedValueOnce(new Error('boom'));
    mockListCategories.mockRejectedValueOnce(new Error('boom'));
    mockListProducts.mockResolvedValue(sampleProducts);
    mockListCategories.mockResolvedValue(sampleCategories);
    await renderKiosk(kioskFtl);

    await waitFor(() => {
      expect(screen.getByText('Failed to load the menu')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    });
    expect(screen.queryByText('Failed to load the menu')).not.toBeInTheDocument();
  });
});
