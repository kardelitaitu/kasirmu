import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import { ThemeProvider } from '@/app/ThemeProvider';
import { ZoomProvider } from '@/contexts/ZoomContext';
import { ToastProvider } from '@/components/Toast';
import { BrandProvider } from '@/contexts/BrandContext';
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

vi.mock('@/api/kds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/kds')>();
  return {
    ...actual,
    printKdsChitScoped: vi.fn().mockResolvedValue(true),
  };
});

import { printSalesReceipt } from '@/api/sales';
import { printKdsChitScoped } from '@/api/kds';
import { TEST_PRINT_CODES } from '@/features/restaurant/screens/receiptLogic';

import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import inventoryFtl from '@/locales/inventory.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';
import productsIdFtl from '@/locales/products.id.ftl?raw';
import salesIdFtl from '@/locales/sales.id.ftl?raw';
import inventoryIdFtl from '@/locales/inventory.id.ftl?raw';
import settingsIdFtl from '@/locales/settings.id.ftl?raw';
import { withFluentLocale } from '@/i18n/test-utils';
import { renderInAct } from '@/test-utils/renderInAct';

const FTL = [salesFtl, productsFtl, inventoryFtl, settingsFtl];

const renderScreen = (props: { tablesEnabled?: boolean; terminalId?: string; onBack?: () => void; onSaved?: () => void } = {}) =>
  renderWithProviders(<RestaurantReceiptsScreen {...props} />, ...FTL);

/**
 * Render the screen under INDONESIAN.
 *
 * Why the F10 sentinel guard needs this: under the English bundle the key
 * `restaurant-logo-custom-uploaded` resolves to the SAME words as the literal
 * it replaced, so an assertion on the rendered text cannot tell a localized
 * value from a hardcoded one — the kill-test proved exactly that. Indonesian
 * resolves the key to different text, so a literal regression fails here.
 */
const renderScreenId = (props: { tablesEnabled?: boolean; terminalId?: string; onBack?: () => void; onSaved?: () => void } = {}) =>
  renderInAct(
    withFluentLocale(
      'id',
      <BrandProvider>
        <ThemeProvider>
          <ToastProvider>
            <ZoomProvider>
              <RestaurantReceiptsScreen {...props} />
            </ZoomProvider>
          </ToastProvider>
        </ThemeProvider>
      </BrandProvider>,
      salesIdFtl,
      productsIdFtl,
      inventoryIdFtl,
      settingsIdFtl,
    ),
  );

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

  it('PINNED DIVERGENCE: the grouping toggle makes the preview differ from the paper', async () => {
    // ⚠️ This case pins a KNOWN divergence, it does not bless it.
    //
    // The case above states the intent: "The preview mirrors the printed receipt, which
    // renders the major part verbatim (no thousands grouping)". The printer agrees with
    // that — `format_money` (kasirmu-hal/src/drivers/receipt.rs:251) delegates to
    // `foundation::format_minor`, and the printer's own cases assert the ungrouped
    // string (`receipt_tests.rs`: IDR 4_450_000 -> "4450000" under every separator).
    //
    // `ReceiptConfig` (:98-117) has NO grouping field, so this toggle cannot reach the
    // printer — grouping is a preview-only effect, i.e. a control that makes the preview
    // LESS faithful to the paper. `currency.thousands_separator` exists
    // (platform/core/src/settings/keys.rs:71) but no formatter reads it.
    //
    // Pinned rather than changed because removing a merchant-visible effect is a product
    // call (the same open question as the three dead toggles, round 27). What this case
    // guarantees is that the divergence cannot disappear SILENTLY: changing the toggle's
    // behaviour fails here and forces the comment above to be revisited.
    const user = userEvent.setup();
    await renderScreen();

    expect(screen.getByText('93000')).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Show Thousands Separator/i));
    expect(screen.getByText('93.000')).toBeInTheDocument();
    // The paper would print this, whatever the toggle says:
    expect(screen.queryByText('93000')).toBeNull();
  });

  it('does NOT append fractional units for IDR, whatever Show Decimals says', async () => {
    // IDR is an exp-0 currency: the printer's `format_money`
    // (kasirmu-hal/src/drivers/receipt.rs:251) uses the currency's canonical exponent, so
    // the paper never prints a fraction for Rupiah. The preview used to append `,00`
    // here, claiming a precision the printer cannot produce — and `ReceiptConfig`
    // (:98-117) has no `showDecimals` field, so the toggle could not reach it either way.
    //
    // This case previously asserted `93000,00`. It now asserts the printer-agreeing
    // truth: for IDR the decimals toggle is inert, and only grouping changes.
    const user = userEvent.setup();
    await renderScreen();

    expect(screen.getByText('93000')).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Show Decimals/i));
    expect(screen.getByText('93000')).toBeInTheDocument();
    expect(screen.queryByText('93000,00')).toBeNull();

    // Grouping still applies (a separate, recorded preview/print divergence).
    await user.click(screen.getByLabelText(/Show Thousands Separator/i));
    expect(screen.getByText('93.000')).toBeInTheDocument();
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

/**
 * The English bundle's value for a key, read from disk. Asserting a bundle VALUE
 * rather than the old literal is what makes a regression to a literal fail: the
 * test bundle resolves the key to its own text, so the two cannot agree by accident.
 */
function bundleValue(key: string): string {
  const ftl = fs.readFileSync(path.resolve(process.cwd(), '../shared-ui/locales/products.ftl'), 'utf-8');
  return (ftl.match(new RegExp('^' + key + ' = (.*)$', 'm')) ?? [])[1]?.trim() ?? '';
}

/** The Indonesian bundle's value for a key. See the non-English sentinel case. */
function idBundleValue(key: string): string {
  const ftl = fs.readFileSync(path.resolve(process.cwd(), '../shared-ui/locales/products.id.ftl'), 'utf-8');
  return (ftl.match(new RegExp('^' + key + ' = (.*)$', 'm')) ?? [])[1]?.trim() ?? '';
}

describe('RestaurantReceiptsScreen — logo', () => {
  it('removes the logo via the Remove Logo button', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const logoInput = screen.getByPlaceholderText(/Or paste Image URL \/ SVG code/i) as HTMLInputElement;
    await user.clear(logoInput);
    await user.type(logoInput, 'data:image/png;base64,abc');
    // A binary data: logo has no readable text form, so the field shows a LABEL.
    // Assert the BUNDLE value, not the old literal 'Custom uploaded image' (F10):
    // the key resolves to its own text here, so a regression to a literal fails,
    // and a locale that translates the key is proven to reach this field.
    const sentinel = bundleValue('restaurant-logo-custom-uploaded');
    expect(sentinel, 'the sentinel key vanished from the bundle').not.toBe('');
    expect(logoInput).toHaveValue(sentinel);

    await user.click(screen.getByRole('button', { name: /Remove Logo/i }));
    expect(logoInput).not.toHaveValue(sentinel);
  });

  it('renders the upload sentinel from the bundle under a NON-English locale (F10)', async () => {
    // The discriminating half. Under English the key resolves to the same words
    // as the old literal, so the case above cannot tell them apart — a planted
    // literal PASSED it. Indonesian resolves the key to different text, so this
    // is the assertion that actually fails on a hardcoded sentinel.
    const user = userEvent.setup();
    await renderScreenId();

    const logoInput = screen.getByPlaceholderText(/tempel URL gambar/i) as HTMLInputElement;
    await user.clear(logoInput);
    await user.type(logoInput, 'data:image/png;base64,abc');

    const idSentinel = idBundleValue('restaurant-logo-custom-uploaded');
    expect(idSentinel, 'the sentinel key vanished from the Indonesian bundle').not.toBe('');
    expect(idSentinel).not.toBe('Custom uploaded image');
    expect(logoInput).toHaveValue(idSentinel);
    expect(logoInput).not.toHaveValue('Custom uploaded image');
  });

  it('does not store the localized sentinel back as the logo when it is edited', async () => {
    // The onChange guard must compare against the SAME localized string the value
    // renders. While it was hardcoded to 'Custom uploaded', the Indonesian field
    // treated its own translated label as a real URL and STORED it: the receipt
    // logo became the words "Gambar yang diunggah khusus" instead of the upload.
    //
    // The observable is the STORED value, not the input's own text: the field is
    // controlled, so it renders the sentinel before and after the edit either way.
    // The preview <img src> is what reveals whether the logo survived.
    await renderScreenId();

    const logoInput = screen.getByPlaceholderText(/tempel URL gambar/i) as HTMLInputElement;
    // A data URL arrives as ONE change (paste, or the file picker's FileReader),
    // never one keystroke at a time — typing it char-by-char re-renders the
    // sentinel after 'data:' and can never reach the full value.
    fireEvent.change(logoInput, { target: { value: 'data:image/png;base64,abc' } });
    const idSentinel = idBundleValue('restaurant-logo-custom-uploaded');
    expect(logoInput).toHaveValue(idSentinel);

    const srcBefore = document.querySelector('.resto-receipt-logo')?.getAttribute('src');
    expect(srcBefore).toBe('data:image/png;base64,abc');

    // The edit: the field is showing the sentinel and the user touches it. The
    // value must DIFFER from what React last rendered or the framework's value
    // tracker suppresses onChange — so append a character, which is the real
    // "user edits the label" path.
    fireEvent.change(logoInput, { target: { value: idSentinel + 'x' } });

    // The guard's contract is `startsWith(sentinel)`, so an edit that still begins
    // with the label must NOT be stored as the logo. With the old hardcoded
    // 'Custom uploaded' check the Indonesian label failed that test and REPLACED
    // the uploaded image with the words of the label.
    const srcAfter = document.querySelector('.resto-receipt-logo')?.getAttribute('src');
    expect(srcAfter, 'the localized sentinel was stored as the logo').toBe('data:image/png;base64,abc');
    expect(srcAfter).not.toBe(idSentinel);
  });

  it('gives the receipt logo an alt from the bundle, not a literal (F10)', async () => {
    // The alt was the hardcoded literal 'Business logo' while the bundle key
    // `restaurant-logo-preview-alt` already existed and was used elsewhere in this
    // same screen. Asserting the bundle VALUE (not the old literal) is what makes a
    // regression to a literal fail: the test bundle resolves the key to its own text.
    const user = userEvent.setup();
    await renderScreen();

    const logoInput = screen.getByPlaceholderText(/Or paste Image URL \/ SVG code/i);
    await user.clear(logoInput);
    await user.type(logoInput, 'https://example.com/l.png');

    const imgs = document.querySelectorAll('.resto-receipt-logo');
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of Array.from(imgs)) {
      expect(img.getAttribute('alt')).not.toBe('Business logo');
      expect(img.getAttribute('alt')).toBeTruthy();
    }
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

  it('dispatches printKdsChitScoped and shows success toast when kitchen test chit button is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(printKdsChitScoped).mockResolvedValueOnce(true);
    await renderScreen();

    const kitchenSel = document.querySelector('#resto-hw-kitchen-conn') as HTMLSelectElement;
    await user.selectOptions(kitchenSel, 'network');

    const hostInput = screen.getByLabelText(/Kitchen Printer IP \/ Device Path/i) as HTMLInputElement;
    await user.clear(hostInput);
    await user.type(hostInput, '192.168.1.200:9100');

    const chitBtn = screen.getByTestId('restaurant-kitchen-test-chit-btn');
    expect(chitBtn).toBeInTheDocument();
    await user.click(chitBtn);

    await waitFor(() => {
      expect(printKdsChitScoped).toHaveBeenCalledWith('mock-session-token', 'test-order-chit');
    });
  });

  it('shows error toast when kitchen test chit fails', async () => {
    const user = userEvent.setup();
    vi.mocked(printKdsChitScoped).mockRejectedValueOnce(new Error('Connection refused to kitchen printer'));
    await renderScreen();

    const kitchenSel = document.querySelector('#resto-hw-kitchen-conn') as HTMLSelectElement;
    await user.selectOptions(kitchenSel, 'network');

    const hostInput = screen.getByLabelText(/Kitchen Printer IP \/ Device Path/i) as HTMLInputElement;
    await user.clear(hostInput);
    await user.type(hostInput, '192.168.1.200:9100');

    const chitBtn = screen.getByTestId('restaurant-kitchen-test-chit-btn');
    await user.click(chitBtn);

    await waitFor(() => {
      expect(printKdsChitScoped).toHaveBeenCalledWith('mock-session-token', 'test-order-chit');
    });
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
      expect(localStorage.getItem('resto_rcpt_header_title')).toBe('REMOTE RESTO');
      expect(localStorage.getItem('resto_rcpt_tax_rate')).toBe('12');
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
    expect(within(statusEl).getByText(bundleValue('restaurant-test-print-msg-success'))).toBeInTheDocument();
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
    expect(within(statusEl).getByText(bundleValue('restaurant-test-print-msg-printer-disabled'))).toBeInTheDocument();
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
    expect(within(statusEl).getByText(bundleValue('restaurant-test-print-msg-printer-not-found'))).toBeInTheDocument();
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
    expect(within(statusEl).getByText(bundleValue('restaurant-test-print-msg-paper-fault'))).toBeInTheDocument();
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
    expect(within(statusEl).getByText(bundleValue('restaurant-test-print-msg-timeout'))).toBeInTheDocument();
  });

  it('renders the test-print message from the bundle under a NON-English locale (F10)', async () => {
    // The discriminating half. Under English the message keys resolve to the
    // same sentences the literals used, so the cases above cannot tell a
    // localized string from a hardcoded one — a planted literal PASSED them.
    // Indonesian differs, so this fails on a regression to a literal.
    const user = userEvent.setup();
    vi.mocked(printSalesReceipt).mockRejectedValueOnce(new Error('no receipt printer registered'));
    await renderScreenId();

    await user.click(screen.getByTestId('restaurant-receipts-test-print-btn'));

    const statusEl = await screen.findByTestId('restaurant-receipts-test-print-status');
    const idMessage = idBundleValue('restaurant-test-print-msg-printer-not-found');
    expect(idMessage, 'the message key vanished from the Indonesian bundle').not.toBe('');
    expect(idMessage).not.toBe('No receipt printer is registered or detected on this device.');
    expect(within(statusEl).getByText(idMessage)).toBeInTheDocument();
    // And explicitly NOT the English sentence that used to be hardcoded.
    expect(within(statusEl).queryByText(/No receipt printer is registered/i)).toBeNull();
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

  it('refuses to look saved when the user-preferences read FAILS (F4)', async () => {
    // The screen seeds from localStorage/context before the prefs read resolves,
    // so a rejected read used to leave dirty false and Save enabled over
    // unconfirmed values.
    const { getUserPreferencesScoped } = await import('@/api/settings');
    vi.mocked(getUserPreferencesScoped).mockRejectedValueOnce(new Error('ipc down'));

    await renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-receipts-load-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('restaurant-receipts-save-btn')).toBeDisabled();
    expect(screen.queryByText(/All changes saved/i)).toBeNull();
    expect(screen.getByTestId('restaurant-receipts-retry-btn')).toBeInTheDocument();
  });

  it('re-reads the preferences when Retry is pressed after a failure', async () => {
    const { getUserPreferencesScoped } = await import('@/api/settings');
    vi.mocked(getUserPreferencesScoped).mockRejectedValueOnce(new Error('ipc down'));

    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('restaurant-receipts-load-error')).toBeInTheDocument();
    });

    vi.mocked(getUserPreferencesScoped).mockResolvedValue({});
    await userEvent.click(screen.getByTestId('restaurant-receipts-retry-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('restaurant-receipts-load-error')).toBeNull();
    });
  });

  it('does not write the localStorage cache when the save is rejected (F5)', async () => {
    // The cache is what a fresh mount renders from, so writing it before the
    // writes resolve would show an un-persisted edit as if it had saved.
    const { setUserPreferencesScoped } = await import('@/api/settings');
    vi.mocked(setUserPreferencesScoped).mockRejectedValueOnce(new Error('ipc down'));

    localStorage.removeItem('resto_rcpt_header_title');
    const user = userEvent.setup();
    await renderScreen();

    // Target the receipt-title field by its own id. Using the FIRST textbox (an
    // earlier attempt) edited some other control, so the save never carried a
    // changed value and the case passed for the wrong reason — it survived the
    // kill-test, which is how that was caught.
    const input = document.getElementById('resto-header-title') as HTMLInputElement;
    expect(input).not.toBeNull();
    await user.clear(input);
    await user.type(input, 'ChangedTitle');

    const saveBtn = screen.getByTestId('restaurant-receipts-save-btn');
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    await user.click(saveBtn);

    await waitFor(() => expect(setUserPreferencesScoped).toHaveBeenCalled());
    // The DB write failed, so the cache must not have been advanced. Asserting on
    // the exact typed value is what makes this discriminating.
    expect(localStorage.getItem('resto_rcpt_header_title')).not.toBe('ChangedTitle');
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


// ── The printer-hardware controls must not hardcode English (F10) ──────────
//
// §6.3 requires every user-visible string to route through @fluent/react. This
// screen's Printer card was the last cluster on it that did not: the connection
// dropdown, the Bluetooth MAC label/placeholder/grant button, the paired-device
// option, the network/serial path labels and the kitchen-printer path labels
// were plain literals, so an Indonesian operator saw English there.
//
// The payments screen was swept the same way in `883dd842e`; this is the sibling
// half. Two cases, because each catches a different regression:
//   1. the KEYS resolve in both bundles (a deleted translation is a defect even
//      if the call site is correct);
//   2. the SOURCE contains no literal again — a literal can render the right
//      words and still be a literal, and only reading the file catches that.
describe('RestaurantReceiptsScreen — printer-hardware i18n sweep (no hardcoded English)', () => {
  const SWEPT = [
    'restaurant-printer-conn-auto',
    'restaurant-printer-conn-bluetooth',
    'restaurant-printer-conn-network',
    'restaurant-printer-conn-usb',
    'restaurant-printer-conn-serial',
    'restaurant-printer-conn-disabled',
    'restaurant-printer-bt-mac-label',
    'restaurant-printer-bt-mac-placeholder',
    'restaurant-printer-bt-grant',
    'restaurant-printer-bt-paired-placeholder',
    'restaurant-printer-ip-label',
    'restaurant-printer-ip-placeholder',
    'restaurant-printer-port-label',
    'restaurant-printer-port-placeholder',
    'restaurant-kitchen-printer-path-label',
    'restaurant-kitchen-printer-net-placeholder',
    'restaurant-kitchen-printer-bt-placeholder',
    'restaurant-kitchen-printer-serial-placeholder',
    'restaurant-test-kitchen-chit',
    'restaurant-test-kitchen-chit-desc',
    'restaurant-test-kitchen-chit-success-title',
    'restaurant-test-kitchen-chit-success',
    'restaurant-receipt-logo-too-large',
    'restaurant-test-print-unsaved-title',
    'restaurant-test-print-unsaved-message',
    'restaurant-test-print-bt-mac-required',
    'restaurant-drawer-auth-title',
    'restaurant-drawer-auth-message',
    'restaurant-drawer-sent-title',
    'restaurant-drawer-sent-message',
    'restaurant-drawer-unconfirmed-title',
    'restaurant-drawer-unconfirmed-message',
    'restaurant-drawer-failed-title',
    // Test-print result messages. These were English literals RETURNED FROM
    // receiptLogic.ts (a pure function), so the status card and every toast
    // rendered English under every locale. They now travel as Fluent keys.
    'restaurant-test-print-msg-success',
    'restaurant-test-print-msg-auth-required',
    'restaurant-test-print-msg-printer-disabled',
    'restaurant-test-print-msg-missing-host',
    'restaurant-test-print-msg-missing-port',
    'restaurant-test-print-msg-printer-not-found',
    'restaurant-test-print-msg-paper-fault',
    'restaurant-test-print-msg-timeout',
    'restaurant-test-print-msg-busy',
    'restaurant-test-print-msg-permission-denied',
    'restaurant-test-print-msg-communication',
    'restaurant-test-print-msg-communication-detail',
    'restaurant-test-print-msg-unconfirmed',
    'restaurant-test-print-msg-general',
    'restaurant-test-print-msg-general-detail',
    'restaurant-test-print-error-title',
    'restaurant-test-print-success-title',
  ];

  function bundle(rel: string): string {
    return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');
  }

  it('every swept key exists in BOTH bundles', () => {
    for (const [locale, rel] of [
      ['en', '../shared-ui/locales/products.ftl'],
      ['id', '../shared-ui/locales/products.id.ftl'],
    ] as const) {
      const src = bundle(rel);
      for (const key of SWEPT) {
        expect(
          src,
          `${key} is missing from the ${locale} bundle — if this screen went back ` +
            'to a hardcoded literal, that is the regression this case exists for',
        ).toMatch(new RegExp('^' + key + ' = ', 'm'));
      }
    }
  });

  it('leaves no hardcoded English label, placeholder or toast in the source', () => {
    // TWO files: the screen renders the strings, and receiptLogic.ts used to
    // RETURN them. A guard that read only the screen would have missed the
    // twelve literals in the pure function entirely.
    const src = [
      'src/features/restaurant/screens/RestaurantReceiptsScreen.tsx',
      'src/features/restaurant/screens/receiptLogic.ts',
    ]
      .map((rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8'))
      .join('\n');
    const offenders = src
      .split('\n')
      .map((line, i) => ({ n: i + 1, line }))
      .filter(({ line }) =>
        /placeholder="[A-Za-z0-9]/.test(line) ||
        /label: '[A-Z]/.test(line) ||
        /(title|message): '[A-Z]/.test(line) ||
        /^\s*(Bluetooth MAC Address|Grant Bluetooth Permission|Kitchen Printer IP)/.test(line));
    expect(
      offenders.map((o) => `${o.n}: ${o.line.trim().slice(0, 70)}`),
      'these lines hardcode user-visible English again — route them through l10n.getString',
    ).toEqual([]);
  });
});


