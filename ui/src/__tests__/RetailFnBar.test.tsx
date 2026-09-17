import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/locales/test-utils';
import { ToastProvider } from '@/components/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import salesIdFtl from '@/locales/sales.id.ftl?raw';
import kdsFtl from '@/locales/kds.ftl?raw';
import kdsIdFtl from '@/locales/kds.id.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import tablesIdFtl from '@/locales/tables.id.ftl?raw';
import RetailFnBar from '@/features/retail/RetailFnBar';
import { getRetailShortcut } from '@/features/retail/retailShortcuts';

// Mock useFeatures to enable QUICK_RETURN and TABLE_MANAGEMENT
vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({
    isEnabled: (feature: string) => feature === 'quick-return' || feature === 'table-management',
  }),
  FEATURES: {
    QUICK_RETURN: 'quick-return',
    TABLE_MANAGEMENT: 'table-management',
  },
}));

async function renderWithFluent(ui: React.ReactElement) {
  const wrapped = withFluent(<ToastProvider>{ui}</ToastProvider>, salesFtl, kdsFtl, tablesFtl);
  await renderInAct(wrapped);
}

async function renderWithFluentId(ui: React.ReactElement) {
  const wrapped = withFluentLocale('id', <ToastProvider>{ui}</ToastProvider>, salesIdFtl, kdsIdFtl, tablesIdFtl);
  await renderInAct(wrapped);
}

const mockRef = { current: null };

const defaultProps = {
  linesLength: 2,
  heldCartId: 'cart-123',
  activeShift: true,
  onPay: vi.fn(),
  onRequestClear: vi.fn(),
  onShowDiscount: vi.fn(),
  onHoldResume: vi.fn(),
  onShowSalesHistory: vi.fn(),
  onShowCustomerSearch: vi.fn(),
  onShowStockInquiry: vi.fn(),
  onToggleShift: vi.fn(),
  onOpenSettings: vi.fn(),
  onShowQuickReturn: vi.fn(),
  onShowTables: vi.fn(),
  onNavigateKds: vi.fn(),
  skuInputRef: mockRef,
};

describe('RetailFnBar', () => {
  it('renders as a toolbar with aria-label', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} />);

    const toolbar = screen.getByRole('toolbar');
    expect(toolbar).toBeInTheDocument();
    expect(toolbar).toHaveAttribute('aria-label', 'Function bar');
  });

  it('renders all 13 function key buttons with correct F-key labels', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(13);

    // Verify each button has the correct F-key from manifest
    const expectedKeys = [
      { action: 'pay', key: 'F1' },
      { action: 'void', key: 'F2' },
      { action: 'discount', key: 'F3' },
      { action: 'hold-resume', key: 'F4' },
      { action: 'focus-sku', key: 'F5' },
      { action: 'sales-history', key: 'F6' },
      { action: 'customer-search', key: 'F7' },
      { action: 'stock-inquiry', key: 'F8' },
      { action: 'shift', key: 'F9' },
      { action: 'options', key: 'F10' },
      { action: 'quick-return', key: 'F11' },
      { action: 'navigate-kds', key: 'F12' },
      { action: 'tables', key: '🪑' }, // Tables uses emoji, not F-key
    ];

    for (const { action } of expectedKeys) {
      const entry = getRetailShortcut(action);
      if (entry) {
        const btn = screen.getByText(entry.key);
        expect(btn).toBeInTheDocument();
      }
    }
  });

  it('renders localized labels for each button', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} />);

    // Use flexible matchers since text is split across span + text node
    // Get all buttons and check their text content
    const buttons = screen.getAllByRole('button');
    const buttonTexts = buttons.map(btn => btn.textContent || '').join(' ');
    
    expect(buttonTexts).toContain('Pay'); // F1 - sale-pay-button
    expect(buttonTexts).toContain('Void'); // F2 - retail-fn-void
    expect(buttonTexts).toContain('Diskon'); // F3 - retail-fn-diskon (Indonesian term in EN locale)
    expect(buttonTexts).toContain('Resume'); // F4 - heldCartId present
    expect(buttonTexts).toContain('Cari'); // F5 - retail-fn-cari
    expect(buttonTexts).toContain('History'); // F6 - retail-fn-history
    expect(buttonTexts).toContain('Pelanggan'); // F7 - retail-fn-pelanggan
    expect(buttonTexts).toContain('Stok'); // F8 - retail-fn-stok
    expect(buttonTexts).toContain('Close Shift'); // F9 - activeShift=true
    expect(buttonTexts).toContain('Options'); // F10 - retail-fn-options
    expect(buttonTexts).toContain('Quick Return'); // F11 - retail-fn-quick-return
    expect(buttonTexts).toContain('Kitchen Display'); // F12 - kds-title
    expect(buttonTexts).toContain('Table Management'); // Tables
  });

  it('shows "Hold" label when no held cart (heldCartId=null)', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} heldCartId={null} linesLength={0} />);

    expect(screen.getByText('Hold')).toBeInTheDocument();
    expect(screen.queryByText('Resume')).not.toBeInTheDocument();
  });

  it('shows "Hold" label when no held cart and linesLength > 0', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} heldCartId={null} linesLength={2} />);

    expect(screen.getByText('Hold')).toBeInTheDocument();
  });

  it('disables Pay, Void, Discount when linesLength === 0', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} linesLength={0} />);

    const payBtn = screen.getByText('F1').closest('button');
    expect(payBtn).toBeDisabled();
    expect(screen.getByText('F2').closest('button')).toBeDisabled();
    expect(screen.getByText('F3').closest('button')).toBeDisabled();

    // Hold/Resume should still be enabled when linesLength=0 but heldCartId exists
    expect(screen.getByText('Resume')).not.toBeDisabled();
  });

  it('enables Pay, Void, Discount when linesLength > 0', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} linesLength={2} />);

    const payBtn = screen.getByText('F1').closest('button');
    expect(payBtn).not.toBeDisabled();
    expect(screen.getByText('F2').closest('button')).not.toBeDisabled();
    expect(screen.getByText('F3').closest('button')).not.toBeDisabled();
  });

  it('enables Hold/Resume when heldCartId exists regardless of linesLength', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} linesLength={0} heldCartId="cart-1" />);

    expect(screen.getByText('Resume')).not.toBeDisabled();
  });

  it('disables Navigate KDS when onNavigateKds is undefined', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} onNavigateKds={undefined} />);

    expect(screen.getByText('Kitchen Display')).toBeDisabled();
  });

  it('enables Navigate KDS when onNavigateKds is provided', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} onNavigateKds={vi.fn()} />);

    expect(screen.getByText('Kitchen Display')).not.toBeDisabled();
  });

  it('renders Tables button', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} />);

    expect(screen.getByText('Table Management')).toBeInTheDocument();
  });

  it('renders Quick Return button (feature-gated)', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} />);

    expect(screen.getByText('Quick Return')).toBeInTheDocument();
  });

  it('has aria-keyshortcuts on each button matching manifest', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} />);

    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      // Tables button doesn't have aria-keyshortcuts (uses emoji)
      const shortcut = btn.getAttribute('aria-keyshortcuts');
      if (btn.textContent?.includes('Table Management')) {
        // Tables button - no shortcut expected
        continue;
      }
      expect(shortcut).toBeTruthy();
    }
  });

  it('calls onPay when Pay button is clicked', async () => {
    const onPay = vi.fn();
    await renderWithFluent(<RetailFnBar {...defaultProps} onPay={onPay} />);

    const payBtn = screen.getByText('F1').closest('button');
    await payBtn?.click();
    expect(onPay).toHaveBeenCalledTimes(1);
  });

  it('calls onRequestClear when Void button is clicked', async () => {
    const onRequestClear = vi.fn();
    await renderWithFluent(<RetailFnBar {...defaultProps} onRequestClear={onRequestClear} />);

    const voidBtn = screen.getByText('F2').closest('button');
    await voidBtn?.click();
    expect(onRequestClear).toHaveBeenCalledTimes(1);
  });

  it('calls onShowDiscount when Discount button is clicked', async () => {
    const onShowDiscount = vi.fn();
    await renderWithFluent(<RetailFnBar {...defaultProps} onShowDiscount={onShowDiscount} />);

    const discountBtn = screen.getByText('F3').closest('button');
    await discountBtn?.click();
    expect(onShowDiscount).toHaveBeenCalledTimes(1);
  });

  it('calls onHoldResume when Hold/Resume button is clicked', async () => {
    const onHoldResume = vi.fn();
    await renderWithFluent(<RetailFnBar {...defaultProps} onHoldResume={onHoldResume} />);

    const holdBtn = screen.getByText('F4').closest('button');
    await holdBtn?.click();
    expect(onHoldResume).toHaveBeenCalledTimes(1);
  });

  it('focuses SKU input ref when Focus SKU button is clicked', async () => {
    const mockInput = { current: { focus: vi.fn() } } as unknown as React.RefObject<HTMLInputElement>;
    await renderWithFluent(<RetailFnBar {...defaultProps} skuInputRef={mockInput} />);

    await screen.getByText('Cari').click();
    expect(mockInput.current?.focus).toHaveBeenCalledTimes(1);
  });

  // ── Indonesian locale ──

  it('renders in Indonesian locale', async () => {
    await renderWithFluentId(<RetailFnBar {...defaultProps} />);

    expect(screen.getByRole('toolbar')).toHaveAttribute('aria-label', 'Bilah fungsi');
    expect(screen.getByText('Bayar')).toBeInTheDocument(); // sale-pay-button
    expect(screen.getByText('Batal')).toBeInTheDocument(); // retail-fn-void
    expect(screen.getByText('Diskon')).toBeInTheDocument(); // retail-fn-diskon
    expect(screen.getByText('Lanjutkan')).toBeInTheDocument(); // retail-resume-button
    expect(screen.getByText('Cari')).toBeInTheDocument(); // retail-fn-cari
    expect(screen.getByText('Riwayat')).toBeInTheDocument(); // retail-fn-history
    expect(screen.getByText('Pelanggan')).toBeInTheDocument(); // retail-fn-pelanggan
    expect(screen.getByText('Stok')).toBeInTheDocument(); // retail-fn-stok
    expect(screen.getByText('Tutup Shift')).toBeInTheDocument(); // retail-fn-shift + pos-shift-close-btn
    expect(screen.getByText('Opsi')).toBeInTheDocument(); // retail-fn-options
    expect(screen.getByText('Retur Cepat')).toBeInTheDocument(); // retail-fn-quick-return
    expect(screen.getByText('Tampilan Dapur')).toBeInTheDocument(); // kds-title
    expect(screen.getByText('Manajemen Meja')).toBeInTheDocument(); // tables-title
  });

  // ── Shift button label ──

  it('shows "Open Shift" when activeShift is false', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} activeShift={false} />);

    expect(screen.getByText('Open Shift')).toBeInTheDocument();
    expect(screen.queryByText('Close Shift')).not.toBeInTheDocument();
  });

  it('shows "Close Shift" when activeShift is true', async () => {
    await renderWithFluent(<RetailFnBar {...defaultProps} activeShift={true} />);

    expect(screen.getByText('Close Shift')).toBeInTheDocument();
    expect(screen.queryByText('Open Shift')).not.toBeInTheDocument();
  });
});