import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import { useSubscription } from '@/contexts/SubscriptionContext';
import RestaurantReceiptsScreen from '@/features/restaurant/screens/RestaurantReceiptsScreen';

beforeEach(() => {
  vi.mocked(useSubscription).mockReturnValue({
    caps: null,
    state: 'active',
    loading: false,
    refresh: vi.fn(),
  });
});

const mockIsManager = vi.hoisted(() => ({ current: true }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', username: 'test', role_name: mockIsManager.current ? 'manager' : 'cashier', token: 't', role_id: 'r', display_name: 'Test' },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: mockIsManager.current,
    isOwner: false,
  }),
}));

// Make the async settings/user-preference + hardware API calls resolve in tests
// so the save flow completes deterministically.
vi.mock('@/api/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/settings')>();
  return {
    ...actual,
    getUserPreferencesScoped: vi.fn().mockResolvedValue({}),
    setUserPreferencesScoped: vi.fn().mockResolvedValue(undefined),
    getReceiptSettingsScoped: vi.fn().mockResolvedValue({ showTableNumber: false }),
    setReceiptSettingsScoped: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/api/receipt-format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/receipt-format')>();
  return {
    ...actual,
    getReceiptFormatScoped: vi.fn().mockResolvedValue({
      layout: {
        paperWidthMm: 80,
        marginTopMm: 5,
        marginBottomMm: 8,
        marginLeftMm: 3,
        marginRightMm: 3,
        showLogo: null,
        printCopies: null,
        showTableNumber: false,
        footerNote: '',
      },
      content: {
        showTax: true,
        showCurrency: false,
        footerText: '',
        decimalSeparator: 'dot',
        requiredFields: [],
      },
      contentSource: 'workspace',
      layoutSource: 'workspace',
    }),
    setReceiptLayoutScoped: vi.fn().mockResolvedValue({}),
  };
});


vi.mock('@/api/hardware', async () => {
  const actual = await vi.importActual<typeof import('@/api/hardware')>('@/api/hardware');
  return {
    ...actual,
    listDisplays: vi.fn(() => Promise.resolve([])),
    displayShow: vi.fn(() => Promise.resolve()),
    displayClear: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('@/api/sales', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/sales')>();
  return {
    ...actual,
    printSalesReceipt: vi.fn().mockResolvedValue({ printed: true }),
  };
});

import { printSalesReceipt } from '@/api/sales';
import { TEST_PRINT_CODES } from '@/features/restaurant/screens/receiptLogic';

import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import inventoryFtl from '@/locales/inventory.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';

const FTL = [salesFtl, productsFtl, inventoryFtl, settingsFtl];

const renderScreen = (props: { tablesEnabled?: boolean; terminalId?: string; onBack?: () => void; onSaved?: () => void } = {}) =>
  renderWithProviders(<RestaurantReceiptsScreen {...props} />, ...FTL);

describe('RestaurantReceiptsScreen — margins & geometry', () => {
  it('clamps margin inputs to their valid ranges', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const top = screen.getByLabelText(/Top/i) as HTMLInputElement;
    await user.clear(top);
    await user.type(top, '150');
    expect(Number(top.value)).toBeLessThanOrEqual(30);
    await user.clear(top);
    await user.type(top, '0');
    expect(Number(top.value)).toBeGreaterThanOrEqual(3);

    const bottom = screen.getByLabelText(/Bottom/i) as HTMLInputElement;
    await user.clear(bottom);
    await user.type(bottom, '999');
    expect(Number(bottom.value)).toBeLessThanOrEqual(30);
    await user.clear(bottom);
    await user.type(bottom, '1');
    expect(Number(bottom.value)).toBeGreaterThanOrEqual(3);

    const left = screen.getByLabelText(/Left/i) as HTMLInputElement;
    await user.clear(left);
    await user.type(left, '50');
    expect(Number(left.value)).toBeLessThanOrEqual(15);
    await user.clear(left);
    await user.type(left, '0');
    expect(Number(left.value)).toBeGreaterThanOrEqual(3);

    const right = screen.getByLabelText(/Right/i) as HTMLInputElement;
    await user.clear(right);
    await user.type(right, '50');
    expect(Number(right.value)).toBeLessThanOrEqual(15);
    await user.clear(right);
    await user.type(right, '2');
    expect(Number(right.value)).toBeGreaterThanOrEqual(3);
  });

  it('switches paper width to narrow and updates the roll/area HUD', async () => {
    const user = userEvent.setup();
    await renderScreen();

    expect(screen.getByText(/80 mm Roll/i)).toBeInTheDocument();
    await user.click(screen.getByText(/58 mm \(Compact\)/i));
    expect(screen.getByText(/58 mm Roll/i)).toBeInTheDocument();
    // narrow roll 58 - (3+3) margins = 52 mm printable area
    expect(screen.getByText(/Area: 52 mm/i)).toBeInTheDocument();
  });
});

describe('RestaurantReceiptsScreen — toggles & tax', () => {
  it('toggles show-currency and prefixes a price with Rp', async () => {
    const user = userEvent.setup();
    await renderScreen();

    // Default showCurrency false -> bare number in the totals. The preview
    // mirrors the printed receipt, which renders the major part verbatim
    // (no thousands grouping) — see formatPrice in receiptLogic.
    const total = screen.getByText('93000');
    expect(total).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Show Currency/i));
    expect(screen.getByText('Rp 93000')).toBeInTheDocument();
  });

  it('adjusts the tax rate input (clamped) and reflects it in the preview', async () => {
    const user = userEvent.setup();
    await renderScreen();

    // showTax defaults to on (FALLBACK_SETTINGS.showTax true), so the tax rate
    // input is already visible without toggling.
    const rateInput = document.querySelector('#resto-tax-rate') as HTMLInputElement;
    expect(rateInput).toBeInTheDocument();
    await user.clear(rateInput);
    await user.type(rateInput, '150');
    expect(Number(rateInput.value)).toBeLessThanOrEqual(100);
  });

  it('switches tax rounding from half-up to truncate', async () => {
    const user = userEvent.setup();
    await renderScreen();
    // showTax defaults on, so the rounding segmented control is already rendered.
    const truncateBtn = screen.getByRole('button', { name: 'Truncate (Legacy)' });
    await user.click(truncateBtn);
    expect(truncateBtn).toHaveClass('resto-segmented-btn--active');
  });

  it('toggles footer note and types footer text', async () => {
    const user = userEvent.setup();
    await renderScreen();

    // showFooter defaults on, so the textarea is already present.
    const footer = document.querySelector('#resto-rcpt-footer') as HTMLTextAreaElement;
    expect(footer).toBeInTheDocument();
    await user.clear(footer);
    await user.type(footer, 'Sampai jumpa lagi!');
    expect(document.querySelector('.resto-receipt-footer-text')).toHaveTextContent('Sampai jumpa lagi!');
  });
});

describe('RestaurantReceiptsScreen — logo', () => {
  it('removes the logo via the Remove Logo button', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const logoInput = screen.getByPlaceholderText(/Or paste Image URL \/ SVG code/i) as HTMLInputElement;
    await user.clear(logoInput);
    await user.type(logoInput, 'data:image/png;base64,abc');
    // A data: logo makes the input show the literal placeholder string as its value.
    expect(logoInput).toHaveValue('Custom uploaded image');

    await user.click(screen.getByRole('button', { name: /Remove Logo/i }));
    expect(logoInput).not.toHaveValue('Custom uploaded image');
  });

  it('cycles logo position top -> left -> right', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const logoInput = screen.getByPlaceholderText(/Or paste Image URL \/ SVG code/i);
    await user.clear(logoInput);
    await user.type(logoInput, 'https://example.com/l.png');

    const group = screen.getByRole('group', { name: 'Logo Position' });
    await user.click(within(group).getByRole('button', { name: /Top/ }));
    expect(document.querySelector('.resto-receipt-center .resto-receipt-logo-wrap')).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: /Left/ }));
    expect(document.querySelector('.resto-receipt-header-row')).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: /Right/ }));
    expect(document.querySelector('.resto-receipt-header-row--right')).toBeInTheDocument();
  });

  it('renders Choose Logo and Remove Logo buttons with md size', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const chooseBtn = screen.getByRole('button', { name: /Choose Logo/i });
    expect(chooseBtn).toHaveClass('btn--md');

    const logoInput = screen.getByPlaceholderText(/Or paste Image URL \/ SVG code/i) as HTMLInputElement;
    await user.clear(logoInput);
    await user.type(logoInput, 'https://example.com/logo.png');

    const removeBtn = screen.getByRole('button', { name: /Remove Logo/i });
    expect(removeBtn).toHaveClass('btn--md');
  });

  it('renders logo position buttons in left-top-right order', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const logoInput = screen.getByPlaceholderText(/Or paste Image URL \/ SVG code/i);
    await user.clear(logoInput);
    await user.type(logoInput, 'https://example.com/logo.png');

    const group = screen.getByRole('group', { name: 'Logo Position' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Left', 'Top', 'Right']);
  });
});

describe('RestaurantReceiptsScreen — font size scaling', () => {
  it('switches font size from very small to large with proper modifier classes', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const verySmallBtn = screen.getByRole('button', { name: /Very Small/i });
    await user.click(verySmallBtn);
    expect(document.querySelector('.resto-receipt-paper--font-very-small')).toBeInTheDocument();

    const smallBtn = screen.getByRole('button', { name: 'Small' });
    await user.click(smallBtn);
    expect(document.querySelector('.resto-receipt-paper--font-small')).toBeInTheDocument();

    const mediumBtn = screen.getByRole('button', { name: 'Medium' });
    await user.click(mediumBtn);
    expect(document.querySelector('.resto-receipt-paper--font-medium')).toBeInTheDocument();

    const largeBtn = screen.getByRole('button', { name: 'Large' });
    await user.click(largeBtn);
    expect(document.querySelector('.resto-receipt-paper--font-large')).toBeInTheDocument();
  });
});

describe('RestaurantReceiptsScreen — printer hardware', () => {
  it('shows the device path input for a network printer connection', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const connSelect = document.querySelector('#resto-hw-printer-conn') as HTMLSelectElement;
    await user.selectOptions(connSelect, 'network');
    expect(screen.getByLabelText(/Printer IP \/ Host/i)).toBeInTheDocument();
  });

  it('hides the device path input when the printer connection is disabled', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const connSelect = document.querySelector('#resto-hw-printer-conn') as HTMLSelectElement;
    await user.selectOptions(connSelect, 'disabled');
    expect(screen.queryByLabelText(/Device Port \/ Path/i)).toBeNull();
  });

  it('shows the kitchen device path input when kitchen connection is not disabled', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const kitchenSel = document.querySelector('#resto-hw-kitchen-conn') as HTMLSelectElement;
    await user.selectOptions(kitchenSel, 'network');
    expect(screen.getByLabelText(/Kitchen Printer IP \/ Device Path/i)).toBeInTheDocument();
  });

  it('greys out and disables kitchen printer when subscription lacks KDS feature', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: {
        tier: 'free',
        status: 'active',
        state: 'active',
        isTrial: false,
        trialEndsAt: null,
        features: {},
        maxLocations: 1,
        maxPosInstances: 1,
        maxWarehouses: 0,
        maxKdsScreens: 0,
        maxStaffUsers: 2,
        salesHistoryDays: 90,
        supportsQris: false,
        supportsAnalytics: false,
        supportsLoyalty: false,
        supportsDailyDashboard: false,
        supportsCloudSync: false,
        offlineGraceDays: 0,
        expiresAt: null,
        graceUntil: null,
        isExpired: false,
        locationCount: 1,
        staffCount: 1,
        terminalCount: 1,
        addons: [],
      },
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });

    await renderScreen();

    const kitchenSel = document.querySelector('#resto-hw-kitchen-conn') as HTMLSelectElement;
    expect(kitchenSel).toBeDisabled();
    expect(screen.getByText(/Pro Plan or KDS Required/i)).toBeInTheDocument();
    expect(document.querySelector('.resto-kitchen-printer--disabled')).toBeInTheDocument();
  });
});

describe('RestaurantReceiptsScreen — back nav & save', () => {
  it('fires onBack when the header back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    await renderScreen({ onBack });
    await user.click(screen.getByTestId('restaurant-receipts-back-btn'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows unsaved-changes dialog when back is clicked with dirty form', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    await renderScreen({ onBack });

    // Make the form dirty
    const title = screen.getByLabelText(/Receipt Title/i);
    await user.clear(title);
    await user.type(title, 'WARUNG BARU');

    await user.click(screen.getByTestId('restaurant-receipts-back-btn'));
    // Dialog should appear; onBack not yet called
    expect(screen.getByTestId('unsaved-dialog-discard')).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('calls onBack when Discard is clicked in the unsaved dialog', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    await renderScreen({ onBack });

    const title = screen.getByLabelText(/Receipt Title/i);
    await user.clear(title);
    await user.type(title, 'DISCARD TEST');

    await user.click(screen.getByTestId('restaurant-receipts-back-btn'));
    await user.click(screen.getByTestId('unsaved-dialog-discard'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('closes dialog and stays when Cancel is clicked in the unsaved dialog', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    await renderScreen({ onBack });

    const title = screen.getByLabelText(/Receipt Title/i);
    await user.clear(title);
    await user.type(title, 'CANCEL TEST');

    await user.click(screen.getByTestId('restaurant-receipts-back-btn'));
    await user.click(screen.getByTestId('unsaved-dialog-cancel'));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.queryByTestId('unsaved-dialog-discard')).toBeNull();
  });

  it('renders redesigned unsaved dialog with 2-row text, outside close button, and no heading', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    await renderScreen({ onBack });

    const title = screen.getByLabelText(/Receipt Title/i);
    await user.clear(title);
    await user.type(title, 'REDESIGN TEST');

    await user.click(screen.getByTestId('restaurant-receipts-back-btn'));

    // Redesigned 2-row text
    expect(screen.getByText(/You have unsaved changes/i)).toBeInTheDocument();
    expect(screen.getByText(/Save before leaving, or discard them/i)).toBeInTheDocument();

    // No separate heading inside the dialog (unlike before, no 'Unsaved Changes' title)
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('heading')).not.toBeInTheDocument();

    // Outside close button closes dialog without navigating
    const outsideClose = screen.getByTestId('modal-close-btn-outside');
    expect(outsideClose).toBeInTheDocument();
    await user.click(outsideClose);
    expect(onBack).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId('unsaved-dialog-discard')).toBeNull();
    });
  });

  it('saves a dirty change when Save is clicked and calls onSaved', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    await renderScreen({ onSaved });

    // The Save button is disabled until a change makes the screen dirty.
    const saveBtn = screen.getByRole('button', { name: /Save/i });
    expect(saveBtn).toBeDisabled();

    const title = screen.getByLabelText(/Receipt Title/i);
    await user.clear(title);
    await user.type(title, 'WARUNG BARU');
    expect(saveBtn).toBeEnabled();

    await user.click(saveBtn);

    // The mocked settings/hardware APIs resolve, so the save completes and
    // calls onSaved — a deterministic assertion (no timing race on `disabled`).
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('remains clean with All changes saved on mount when preferences exist in localStorage', async () => {
    localStorage.setItem('resto_rcpt_header_title', 'WARUNG MAKAN PADANG');
    localStorage.setItem('resto_rcpt_header_line1', 'Jl. Sudirman No. 42');
    localStorage.setItem('resto_rcpt_header_line2', 'Tel: 08123456789');
    localStorage.setItem('resto_rcpt_tax_rate', '11');
    localStorage.setItem('resto_rcpt_font_size', 'large');

    try {
      await renderScreen();
      expect(screen.getByText(/All changes saved/i)).toBeInTheDocument();
      expect(screen.queryByText(/Unsaved changes/i)).toBeNull();
      const saveBtn = screen.getByRole('button', { name: /Save/i });
      expect(saveBtn).toBeDisabled();
    } finally {
      localStorage.clear();
    }
  });

  it('remains clean with All changes saved when remote preferences resolve', async () => {
    const { getUserPreferencesScoped } = await import('@/api/settings');
    vi.mocked(getUserPreferencesScoped).mockResolvedValueOnce({
      resto_rcpt_header_title: 'REMOTE RESTO',
      resto_rcpt_tax_rate: '12',
    });

    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText(/All changes saved/i)).toBeInTheDocument();
      expect(screen.queryByText(/Unsaved changes/i)).toBeNull();
      const saveBtn = screen.getByRole('button', { name: /Save/i });
      expect(saveBtn).toBeDisabled();
    });
  });

  it('renders test print button with stationary label container', async () => {
    await renderScreen();
    const testPrintBtn = screen.getByTestId('restaurant-receipts-test-print-btn');
    expect(testPrintBtn).toBeInTheDocument();
    expect(testPrintBtn).toHaveClass('resto-test-print-btn');

    const label = testPrintBtn.querySelector('.resto-test-print-label');
    expect(label).toBeInTheDocument();
    expect(label).toHaveTextContent(/Test Print/i);
  });

  it('enforces maximum character limits on header title and lines', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const titleInput = screen.getByLabelText(/Receipt Title/i) as HTMLInputElement;
    await user.clear(titleInput);
    // 30 characters typed, should truncate to 26
    await user.type(titleInput, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234');
    expect(titleInput.value).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(titleInput.value.length).toBe(26);

    const line1Input = screen.getByLabelText(/Header Line 1/i) as HTMLInputElement;
    await user.clear(line1Input);
    // 55 characters typed, should truncate to 49
    await user.type(line1Input, 'ABCDEFGHIJKLMNOPZRTSUVWXYZ1234567890ABCDEFGHIJKLMEXTRA');
    expect(line1Input.value).toBe('ABCDEFGHIJKLMNOPZRTSUVWXYZ1234567890ABCDEFGHIJKLM');
    expect(line1Input.value.length).toBe(49);

    const line2Input = screen.getByLabelText(/Header Line 2/i) as HTMLInputElement;
    await user.clear(line2Input);
    // 55 characters typed, should truncate to 49
    await user.type(line2Input, 'ABCDEFGHIJKLMNOPZRTSUVWXYZ1234567890ABCDEFGHIJKLMEXTRA');
    expect(line2Input.value).toBe('ABCDEFGHIJKLMNOPZRTSUVWXYZ1234567890ABCDEFGHIJKLM');
    expect(line2Input.value.length).toBe(49);
  });
});

describe('RestaurantReceiptsScreen — Test Print Codes & Results', () => {
  it('displays PRN_SUCCESS_200 and success message when test print succeeds', async () => {
    const user = userEvent.setup();
    vi.mocked(printSalesReceipt).mockResolvedValueOnce({ printed: true });
    await renderScreen();

    const testPrintBtn = screen.getByTestId('restaurant-receipts-test-print-btn');
    await user.click(testPrintBtn);

    const statusEl = await screen.findByTestId('restaurant-receipts-test-print-status');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl).toHaveClass('resto-test-print-status--success');
    expect(within(statusEl).getByText(TEST_PRINT_CODES.SUCCESS)).toBeInTheDocument();
    expect(within(statusEl).getByText(/Test receipt was sent to the printer successfully/i)).toBeInTheDocument();
  });

  it('produces PRN_ERR_DISABLED when printer connection is set to disabled', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const connSelect = document.querySelector('#resto-hw-printer-conn') as HTMLSelectElement;
    await user.selectOptions(connSelect, 'disabled');

    const testPrintBtn = screen.getByTestId('restaurant-receipts-test-print-btn');
    await user.click(testPrintBtn);

    const statusEl = await screen.findByTestId('restaurant-receipts-test-print-status');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl).toHaveClass('resto-test-print-status--error');
    expect(within(statusEl).getByText(TEST_PRINT_CODES.ERR_PRINTER_DISABLED)).toBeInTheDocument();
    expect(within(statusEl).getByText(/Receipt printer is currently disabled/i)).toBeInTheDocument();
  });

  it('produces PRN_ERR_MISSING_HOST when network printer has empty host', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const connSelect = document.querySelector('#resto-hw-printer-conn') as HTMLSelectElement;
    await user.selectOptions(connSelect, 'network');

    const hostInput = screen.getByLabelText(/Printer IP \/ Host/i) as HTMLInputElement;
    await user.clear(hostInput);

    const testPrintBtn = screen.getByTestId('restaurant-receipts-test-print-btn');
    await user.click(testPrintBtn);

    const statusEl = await screen.findByTestId('restaurant-receipts-test-print-status');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl).toHaveClass('resto-test-print-status--error');
    expect(within(statusEl).getByText(TEST_PRINT_CODES.ERR_MISSING_HOST)).toBeInTheDocument();
  });

  it('produces PRN_ERR_NOT_FOUND when printer driver is not registered', async () => {
    const user = userEvent.setup();
    vi.mocked(printSalesReceipt).mockRejectedValueOnce(new Error('no receipt printer registered'));
    await renderScreen();

    const testPrintBtn = screen.getByTestId('restaurant-receipts-test-print-btn');
    await user.click(testPrintBtn);

    const statusEl = await screen.findByTestId('restaurant-receipts-test-print-status');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl).toHaveClass('resto-test-print-status--error');
    expect(within(statusEl).getByText(TEST_PRINT_CODES.ERR_PRINTER_NOT_FOUND)).toBeInTheDocument();
    expect(within(statusEl).getByText(/No receipt printer is registered or detected/i)).toBeInTheDocument();
  });

  it('produces PRN_ERR_PAPER_FAULT when printer is out of paper or cover open', async () => {
    const user = userEvent.setup();
    vi.mocked(printSalesReceipt).mockRejectedValueOnce(new Error('Printer is not ready: check paper supply and cover'));
    await renderScreen();

    const testPrintBtn = screen.getByTestId('restaurant-receipts-test-print-btn');
    await user.click(testPrintBtn);

    const statusEl = await screen.findByTestId('restaurant-receipts-test-print-status');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl).toHaveClass('resto-test-print-status--error');
    expect(within(statusEl).getByText(TEST_PRINT_CODES.ERR_PAPER_FAULT)).toBeInTheDocument();
    expect(within(statusEl).getByText(/Printer fault: check paper roll supply, cover latch, or paper jam/i)).toBeInTheDocument();
  });

  it('produces PRN_ERR_TIMEOUT when connection times out', async () => {
    const user = userEvent.setup();
    vi.mocked(printSalesReceipt).mockRejectedValueOnce(new Error('TCP socket timed out connecting to 192.168.1.100'));
    await renderScreen();

    const testPrintBtn = screen.getByTestId('restaurant-receipts-test-print-btn');
    await user.click(testPrintBtn);

    const statusEl = await screen.findByTestId('restaurant-receipts-test-print-status');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl).toHaveClass('resto-test-print-status--error');
    expect(within(statusEl).getByText(TEST_PRINT_CODES.ERR_TIMEOUT)).toBeInTheDocument();
    expect(within(statusEl).getByText(/Printer communication timed out/i)).toBeInTheDocument();
  });

  it('remains clean when scoped receipt format resolves with non-default values', async () => {
    const { getReceiptFormatScoped } = await import('@/api/receipt-format');
    vi.mocked(getReceiptFormatScoped).mockResolvedValueOnce({
      layout: {
        paperWidthMm: 58,
        marginTopMm: 12,
        marginBottomMm: 14,
        marginLeftMm: 5,
        marginRightMm: 5,
        showLogo: true,
        printCopies: 1,
        showTableNumber: true,
        footerNote: 'Custom scoped footer',
      },
      content: {
        showTax: true,
        showCurrency: true,
        footerText: '',
        decimalSeparator: 'dot',
        requiredFields: [],
      },
      contentSource: 'workspace',
      layoutSource: 'workspace',
    });

    await renderScreen({ tablesEnabled: true });
    await waitFor(() => {
      expect(screen.getByText(/All changes saved/i)).toBeInTheDocument();
      expect(screen.queryByText(/Unsaved changes/i)).toBeNull();
      const saveBtn = screen.getByRole('button', { name: /Save/i });
      expect(saveBtn).toBeDisabled();
    });
  });

  it('normalizes pasted SVG snippets to data URLs in logo text input', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const logoInput = screen.getByPlaceholderText(/Or paste Image URL \/ SVG code/i) as HTMLInputElement;
    await user.clear(logoInput);
    await user.type(logoInput, '<svg><circle/></svg>');

    expect(logoInput.value).toContain('data:image/svg+xml;utf8,');
    expect(screen.getByText(/Logo Position/i)).toBeInTheDocument();
  });
});


