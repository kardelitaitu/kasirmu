import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/i18n/test-utils';
import { ToastProvider } from '@/components/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import salesIdFtl from '@/locales/sales.id.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import sharedIdFtl from '@/locales/shared.id.ftl?raw';
import RetailModals from '@/features/retail/RetailModals';
import type { ExitAnim } from '@/features/retail/RetailModals';

// Mock all the sub-modals to avoid complex setup
vi.mock('@/features/sales/PriceOverrideModal', () => ({
  default: () => null,
}));
vi.mock('@/features/retail/EditProductModal', () => ({
  EditProductModal: () => null,
}));
vi.mock('@/features/retail/AddCategoryModal', () => ({
  AddCategoryModal: () => null,
}));
vi.mock('@/features/retail/AddProductModal', () => ({
  AddProductModal: () => null,
}));
vi.mock('@/features/sales/RefundModal', () => ({
  default: () => null,
}));

// Mock useFocusTrap to avoid complex focus logic in tests
vi.mock('@/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}));

const makeExitAnim = (overrides: Partial<ExitAnim> = {}): ExitAnim => ({
  shouldRender: false,
  exiting: false,
  requestClose: vi.fn(),
  ...overrides,
});

const defaultProps = {
  canEditCost: true,
  shift: {
    activeShift: null,
    openShiftExit: makeExitAnim(),
    closeShiftExit: makeExitAnim(),
    shiftSummaryExit: makeExitAnim(),
    closedShiftSummary: null,
    openingBalance: '',
    closingBalance: '',
    shiftNotes: '',
    openingShift: false,
    closingShift: false,
    closeShiftError: null,
    storeSettings: { currency: 'IDR' },
    onOpeningBalanceChange: vi.fn(),
    onClosingBalanceChange: vi.fn(),
    onShiftNotesChange: vi.fn(),
    onOpenShift: vi.fn(),
    onCloseShift: vi.fn(),
  },
  discount: {
    exit: makeExitAnim(),
    tab: 'pct' as const,
    input: '',
    rpInput: '',
    onTabChange: vi.fn(),
    onInputChange: vi.fn(),
    onRpInputChange: vi.fn(),
    onApplyPct: vi.fn(),
    onApplyRp: vi.fn(),
    onCancel: vi.fn(),
  },
  customer: {
    exit: makeExitAnim(),
    query: '',
    results: [],
    loading: false,
    selected: null,
    onQueryChange: vi.fn(),
    onSelect: vi.fn(),
    onClear: vi.fn(),
    onClose: vi.fn(),
  },
  qtyPicker: {
    exit: makeExitAnim(),
    product: null,
    input: '',
    onInputChange: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  },
  heldCarts: {
    exit: makeExitAnim(),
    list: [],
    onResume: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  },
  credit: {
    exit: makeExitAnim(),
    sales: [],
    settlingId: null,
    onSettle: vi.fn(),
    onClose: vi.fn(),
  },
  quickReturn: {
    exit: makeExitAnim(),
    barcode: '',
    loading: false,
    onBarcodeChange: vi.fn(),
    onSubmit: vi.fn(),
    onClose: vi.fn(),
  },
  clearConfirm: {
    exit: makeExitAnim({ shouldRender: false }),
    lineCount: 0,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
  },
  deleteHeldCartConfirm: {
    exit: makeExitAnim(),
    label: '',
    onConfirm: vi.fn(),
    onClose: vi.fn(),
  },
  shortcuts: {
    exit: makeExitAnim(),
    onClose: vi.fn(),
  },
  override: {
    target: null,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
  },
  editProduct: {
    product: null,
    isOpen: false,
    onClose: vi.fn(),
    onSave: vi.fn(),
  },
  addCategory: {
    isOpen: false,
    onClose: vi.fn(),
    onSave: vi.fn(),
  },
  addProduct: {
    categories: [],
    isOpen: false,
    onClose: vi.fn(),
    onSave: vi.fn(),
  },
  showQuickReturnRefund: false,
  quickReturnSale: null,
  quickReturnRefundDone: vi.fn(),
  scanFlash: false,
};

async function renderWithFluent(ui: React.ReactElement) {
  const wrapped = withFluent(<ToastProvider>{ui}</ToastProvider>, salesFtl, sharedFtl);
  await renderInAct(wrapped);
}

async function renderWithFluentId(ui: React.ReactElement) {
  const wrapped = withFluentLocale('id', <ToastProvider>{ui}</ToastProvider>, salesIdFtl, sharedIdFtl);
  await renderInAct(wrapped);
}

describe('RetailModals — Clear Confirm Modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when shouldRender is false', async () => {
    await renderWithFluent(<RetailModals {...defaultProps} />);

    expect(screen.queryByRole('dialog', { name: /clear cart/i })).not.toBeInTheDocument();
  });

  it('renders dialog with correct title when shouldRender is true', async () => {
    const props = {
      ...defaultProps,
      clearConfirm: {
        ...defaultProps.clearConfirm,
        exit: makeExitAnim({ shouldRender: true }),
        lineCount: 3,
      },
    };
    await renderWithFluent(<RetailModals {...props} />);

    const dialog = screen.getByRole('dialog', { name: /clear cart/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Clear Cart')).toBeInTheDocument();
  });

  it('shows confirmation message with line count', async () => {
    const props = {
      ...defaultProps,
      clearConfirm: {
        ...defaultProps.clearConfirm,
        exit: makeExitAnim({ shouldRender: true }),
        lineCount: 3,
      },
    };
    await renderWithFluent(<RetailModals {...props} />);

    // Message uses Fluent interpolation: "Remove all {count} items from the cart?"
    expect(screen.getByText(/remove all 3 items? from the cart\?/i)).toBeInTheDocument();
  });

  it('renders Cancel and Clear buttons', async () => {
    const props = {
      ...defaultProps,
      clearConfirm: {
        ...defaultProps.clearConfirm,
        exit: makeExitAnim({ shouldRender: true }),
        lineCount: 1,
      },
    };
    await renderWithFluent(<RetailModals {...props} />);

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('calls requestClose when Cancel button clicked', async () => {
    const requestClose = vi.fn();
    const props = {
      ...defaultProps,
      clearConfirm: {
        ...defaultProps.clearConfirm,
        exit: makeExitAnim({ shouldRender: true, requestClose }),
        lineCount: 1,
      },
    };
    await renderWithFluent(<RetailModals {...props} />);

    await screen.getByRole('button', { name: /cancel/i }).click();
    expect(requestClose).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when Clear button clicked', async () => {
    const onConfirm = vi.fn();
    const props = {
      ...defaultProps,
      clearConfirm: {
        ...defaultProps.clearConfirm,
        exit: makeExitAnim({ shouldRender: true }),
        lineCount: 1,
        onConfirm,
      },
    };
    await renderWithFluent(<RetailModals {...props} />);

    await screen.getByRole('button', { name: /clear/i }).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls requestClose when Escape key pressed', async () => {
    const requestClose = vi.fn();
    const props = {
      ...defaultProps,
      clearConfirm: {
        ...defaultProps.clearConfirm,
        exit: makeExitAnim({ shouldRender: true, requestClose }),
        lineCount: 1,
      },
    };
    await renderWithFluent(<RetailModals {...props} />);

    const dialog = screen.getByRole('dialog', { name: /clear cart/i });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(requestClose).toHaveBeenCalledTimes(1);
  });

  it('calls requestClose when clicking overlay outside modal', async () => {
    const requestClose = vi.fn();
    const props = {
      ...defaultProps,
      clearConfirm: {
        ...defaultProps.clearConfirm,
        exit: makeExitAnim({ shouldRender: true, requestClose }),
        lineCount: 1,
      },
    };
    await renderWithFluent(<RetailModals {...props} />);

    const overlay = screen.getByRole('dialog', { name: /clear cart/i });
    fireEvent.click(overlay, { target: overlay, currentTarget: overlay });
    expect(requestClose).toHaveBeenCalledTimes(1);
  });

  it('does not call requestClose when clicking inside modal panel', async () => {
    const requestClose = vi.fn();
    const props = {
      ...defaultProps,
      clearConfirm: {
        ...defaultProps.clearConfirm,
        exit: makeExitAnim({ shouldRender: true, requestClose }),
        lineCount: 1,
      },
    };
    await renderWithFluent(<RetailModals {...props} />);

    const overlay = screen.getByRole('dialog', { name: /clear cart/i });
    const panel = screen.getByText('Clear Cart').closest('div')!;
    fireEvent.click(panel, { target: panel, currentTarget: overlay });
    // Should not call requestClose since target !== currentTarget
    expect(requestClose).not.toHaveBeenCalled();
  });

  it('applies exiting class when exiting is true', async () => {
    const props = {
      ...defaultProps,
      clearConfirm: {
        ...defaultProps.clearConfirm,
        exit: makeExitAnim({ shouldRender: true, exiting: true }),
        lineCount: 1,
      },
    };
    await renderWithFluent(<RetailModals {...props} />);

    const overlay = screen.getByRole('dialog', { name: /clear cart/i });
    expect(overlay).toHaveClass('retail-clear-overlay--exiting');

    const panel = screen.getByText('Clear Cart').closest('div')!;
    expect(panel).toHaveClass('retail-clear-modal--exiting');
  });

  it('renders in Indonesian locale', async () => {
    const props = {
      ...defaultProps,
      clearConfirm: {
        ...defaultProps.clearConfirm,
        exit: makeExitAnim({ shouldRender: true }),
        lineCount: 2,
      },
    };
    await renderWithFluentId(<RetailModals {...props} />);

    expect(screen.getByRole('dialog', { name: /hapus keranjang/i })).toBeInTheDocument();
    expect(screen.getByText('Hapus Keranjang')).toBeInTheDocument();
    // Indonesian message: "Hapus 2 item dari keranjang?"
    expect(screen.getByText(/hapus 2 item dari keranjang\?/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /batal/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hapus/i })).toBeInTheDocument();
  });
});