// ── KdsProductPickerModal contract tests ──────────────────────────
//
// Pins the add → confirm / cancel semantics of the mid-preparation
// product picker: tapping a product merges by SKU into the picked list
// with a category-derived course, confirm emits the exact payload exactly
// once, backdrop/Escape cancel without mutating, and a failed product
// fetch renders the localized error with a working Retry.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import { KdsProductPickerModal } from '@/features/kds/components/KdsProductPickerModal';
import type { ProductDto } from '@/api/products';
import kdsFtl from '@/locales/kds.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

const { mockListProductsScoped } = vi.hoisted(() => ({
  mockListProductsScoped: vi.fn(),
}));

vi.mock('@/api/products', () => ({
  listProductsScoped: (token: string) => mockListProductsScoped(token),
}));

const bundle = new FluentBundle('en-US');
bundle.addResource(new FluentResource(kdsFtl));
bundle.addResource(new FluentResource(sharedFtl));
const l10n = new ReactLocalization([bundle]);

function makeProduct(overrides: Partial<ProductDto> = {}): ProductDto {
  return {
    sku: 'ESPR',
    name: 'Espresso Shot',
    category: 'Hot Drinks',
    price: { minor_units: 15000, currency: 'IDR' },
    barcode: '8990000000001',
    in_stock: true,
    stock_qty: 10,
    tax_rate_ids: [],
    created_at: '',
    price_updated_at: '',
    product_type: 'restaurant',
    ...overrides,
  };
}

const ESPRESSO = makeProduct();
const CROISSANT = makeProduct({
  sku: 'CROISS',
  name: 'Butter Croissant',
  category: 'Main Course',
  barcode: '8990000000002',
});

function renderModal(overrides: { onConfirm?: () => void; onClose?: () => void; pending?: boolean } = {}) {
  const onConfirm = overrides.onConfirm ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const utils = render(
    <LocalizationProvider l10n={l10n}>
      <KdsProductPickerModal
        orderId="kds-order-1"
        sessionToken="tok-1"
        isOpen
        pending={overrides.pending ?? false}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </LocalizationProvider>,
  );
  return { onConfirm, onClose, ...utils };
}

describe('KdsProductPickerModal', () => {
  beforeEach(() => {
    mockListProductsScoped.mockReset();
  });

  it('confirm emits the picked items once with sku, display_name, qty, course, and empty modifiers', async () => {
    mockListProductsScoped.mockResolvedValue([ESPRESSO, CROISSANT]);
    const { onConfirm } = renderModal();
    await waitFor(() => expect(screen.getByText('Espresso Shot')).toBeInTheDocument());

    // Tap espresso twice (qty merges to 2) and croissant once. Anchored
    // names avoid matching the picked-list Remove buttons ("Remove …").
    await userEvent.click(screen.getByRole('button', { name: /^espresso shot( \(added\))?$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^espresso shot( \(added\))?$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^butter croissant( \(added\))?$/i }));

    await userEvent.click(screen.getByRole('button', { name: /add .* item/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      orderId: 'kds-order-1',
      items: [
        { sku: 'ESPR', display_name: 'Espresso Shot', qty: 2, course: 'beverage', modifiers: [] },
        { sku: 'CROISS', display_name: 'Butter Croissant', qty: 1, course: 'main', modifiers: [] },
      ],
    });
  });

  it('backdrop click cancels without confirming', async () => {
    mockListProductsScoped.mockResolvedValue([ESPRESSO]);
    const { onConfirm, onClose } = renderModal();
    await waitFor(() => expect(screen.getByText('Espresso Shot')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /espresso shot/i }));
    // Click the overlay itself (target === currentTarget) — not the modal.
    fireEvent.click(document.querySelector('.kds-picker-overlay')!);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Escape closes the modal without confirming', async () => {
    mockListProductsScoped.mockResolvedValue([ESPRESSO]);
    const { onConfirm, onClose } = renderModal();
    await waitFor(() => expect(screen.getByText('Espresso Shot')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^espresso shot( \(added\))?$/i }));
    // Focus inside the dialog so the focus trap's keydown listener fires.
    screen.getByRole('textbox').focus();
    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a failed product fetch renders the localized error with a working Retry', async () => {
    mockListProductsScoped.mockRejectedValueOnce(new Error('boom'));
    renderModal();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load products/);
    });

    // Retry re-fetches and recovers.
    mockListProductsScoped.mockResolvedValueOnce([ESPRESSO]);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('Espresso Shot')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('the course dropdown and quantity stepper edit the picked entry before confirm', async () => {
    mockListProductsScoped.mockResolvedValue([ESPRESSO]);
    const { onConfirm } = renderModal();
    await waitFor(() => expect(screen.getByText('Espresso Shot')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^espresso shot( \(added\))?$/i }));
    // Re-assign course and bump qty to 2.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /course/i }), 'side');
    await userEvent.click(screen.getByRole('button', { name: /increase quantity/i }));

    await userEvent.click(screen.getByRole('button', { name: /add .* item/i }));
    expect(onConfirm).toHaveBeenCalledWith({
      orderId: 'kds-order-1',
      items: [{ sku: 'ESPR', display_name: 'Espresso Shot', qty: 2, course: 'side', modifiers: [] }],
    });
  });

  it('disables the confirm button while a save is pending', async () => {
    mockListProductsScoped.mockResolvedValue([ESPRESSO]);
    const onConfirm = vi.fn();
    renderModal({ onConfirm, pending: true });
    await waitFor(() => expect(screen.getByText('Espresso Shot')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^espresso shot( \(added\))?$/i }));
    const confirmBtn = screen.getByRole('button', { name: /add .* item/i });
    // Even with a picked item, pending locks the button — and the handler
    // guard would drop the tap even if it were dispatched.
    expect(confirmBtn).toBeDisabled();
    await userEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
