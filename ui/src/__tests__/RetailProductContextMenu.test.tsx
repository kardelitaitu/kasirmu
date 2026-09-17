import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/i18n/test-utils';
import { ToastProvider } from '@/components/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import salesIdFtl from '@/locales/sales.id.ftl?raw';
import RetailProductContextMenu from '@/features/retail/RetailProductContextMenu';
import type { ProductDto } from '@/api/products';
import type { ContextMenuState } from '@/features/retail/RetailProductContextMenu';

function makeProduct(overrides: Partial<ProductDto> = {}): ProductDto {
  return {
    sku: 'SKU-001',
    name: 'Test Product',
    category: 'cat-1',
    price: { minor_units: 10000, currency: 'IDR' },
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

const makeMenuState = (overrides: Partial<ContextMenuState> = {}): ContextMenuState => ({
  product: makeProduct(),
  x: 100,
  y: 200,
  ...overrides,
});

async function renderWithFluent(ui: React.ReactElement) {
  const wrapped = withFluent(<ToastProvider>{ui}</ToastProvider>, salesFtl);
  await renderInAct(wrapped);
}

async function renderWithFluentId(ui: React.ReactElement) {
  const wrapped = withFluentLocale('id', <ToastProvider>{ui}</ToastProvider>, salesIdFtl);
  await renderInAct(wrapped);
}

describe('RetailProductContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders null when menu is null', async () => {
    await renderWithFluent(<RetailProductContextMenu menu={null} onClose={vi.fn()} onViewImages={vi.fn()} />);

    expect(screen.queryByRole('menu', { name: /product actions/i })).not.toBeInTheDocument();
  });

  it('renders menu at specified position when menu is provided', async () => {
    const menu = makeMenuState({ x: 100, y: 200 });
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={vi.fn()} onViewImages={vi.fn()} />);

    const menuEl = screen.getByRole('menu', { name: /product actions/i });
    expect(menuEl).toBeInTheDocument();
    expect(menuEl).toHaveStyle({ position: 'fixed', left: '100px', top: '200px' });
  });

  it('clamps x position to viewport right edge', async () => {
    const menu = makeMenuState({ x: 5000, y: 100 }); // Way beyond right edge
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={vi.fn()} onViewImages={vi.fn()} />);

    const menuEl = screen.getByRole('menu', { name: /product actions/i });
    // Should be clamped to viewport width - 220 (jsdom default is 1024)
    expect(menuEl).toHaveStyle({ left: '804px' }); // 1024 - 220
  });

  it('clamps y position to viewport bottom edge', async () => {
    const menu = makeMenuState({ x: 100, y: 5000 }); // Way beyond bottom edge
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={vi.fn()} onViewImages={vi.fn()} />);

    const menuEl = screen.getByRole('menu', { name: /product actions/i });
    // Should be clamped to viewport height - 120 (jsdom default is 768)
    expect(menuEl).toHaveStyle({ top: '648px' }); // 768 - 120
  });

  it('clamps x position to 0 minimum', async () => {
    const menu = makeMenuState({ x: -50, y: 100 });
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={vi.fn()} onViewImages={vi.fn()} />);

    const menuEl = screen.getByRole('menu', { name: /product actions/i });
    expect(menuEl).toHaveStyle({ left: 0 });
  });

  it('clamps y position to 0 minimum', async () => {
    const menu = makeMenuState({ x: 100, y: -30 });
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={vi.fn()} onViewImages={vi.fn()} />);

    const menuEl = screen.getByRole('menu', { name: /product actions/i });
    expect(menuEl).toHaveStyle({ top: 0 });
  });

  it('renders "View product images" menuitem with icon', async () => {
    const menu = makeMenuState();
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={vi.fn()} onViewImages={vi.fn()} />);

    const menuItem = screen.getByRole('menuitem', { name: /view product images/i });
    expect(menuItem).toBeInTheDocument();
    expect(menuItem).toContainHTML('<svg');
  });

  it('calls onViewImages and onClose when menuitem clicked', async () => {
    const onViewImages = vi.fn();
    const onClose = vi.fn();
    const menu = makeMenuState();
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={onClose} onViewImages={onViewImages} />);

    await screen.getByRole('menuitem', { name: /view product images/i }).click();
    expect(onViewImages).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key pressed', async () => {
    const onClose = vi.fn();
    const menu = makeMenuState();
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={onClose} onViewImages={vi.fn()} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking outside menu', async () => {
    const onClose = vi.fn();
    const menu = makeMenuState();
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={onClose} onViewImages={vi.fn()} />);

    // Click on document body (outside menu)
    fireEvent.pointerDown(document.body, { bubbles: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when scroll event fires', async () => {
    const onClose = vi.fn();
    const menu = makeMenuState();
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={onClose} onViewImages={vi.fn()} />);

    fireEvent(document, new Event('scroll'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when window resize fires', async () => {
    const onClose = vi.fn();
    const menu = makeMenuState();
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={onClose} onViewImages={vi.fn()} />);

    fireEvent(window, new Event('resize'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses first menuitem on open', async () => {
    const menu = makeMenuState();
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={vi.fn()} onViewImages={vi.fn()} />);

    const menuItem = screen.getByRole('menuitem', { name: /view product images/i });
    expect(menuItem).toHaveFocus();
  });

  it('renders in Indonesian locale', async () => {
    const menu = makeMenuState();
    await renderWithFluentId(<RetailProductContextMenu menu={menu} onClose={vi.fn()} onViewImages={vi.fn()} />);

    const menuEl = screen.getByRole('menu', { name: /aksi produk/i });
    expect(menuEl).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /lihat gambar produk/i })).toBeInTheDocument();
  });

  it('prevents context menu on right-click inside menu', async () => {
    const menu = makeMenuState();
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={vi.fn()} onViewImages={vi.fn()} />);

    const menuEl = screen.getByRole('menu', { name: /product actions/i });
    fireEvent.contextMenu(menuEl);
    // Should not throw, and default is prevented
  });

  it('has zIndex of 1000', async () => {
    const menu = makeMenuState();
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={vi.fn()} onViewImages={vi.fn()} />);

    const menuEl = screen.getByRole('menu', { name: /product actions/i });
    expect(menuEl).toHaveStyle({ zIndex: 1000 });
  });

  it('has tabIndex -1', async () => {
    const menu = makeMenuState();
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={vi.fn()} onViewImages={vi.fn()} />);

    const menuEl = screen.getByRole('menu', { name: /product actions/i });
    expect(menuEl).toHaveAttribute('tabIndex', '-1');
  });

  it('does not call onClose when clicking inside menu', async () => {
    const onClose = vi.fn();
    const menu = makeMenuState();
    await renderWithFluent(<RetailProductContextMenu menu={menu} onClose={onClose} onViewImages={vi.fn()} />);

    const menuItem = screen.getByRole('menuitem', { name: /view product images/i });
    fireEvent.pointerDown(menuItem, { bubbles: true });
    expect(onClose).not.toHaveBeenCalled();
  });
});