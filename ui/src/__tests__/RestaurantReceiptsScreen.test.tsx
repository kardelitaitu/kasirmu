import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import RestaurantReceiptsScreen from '@/features/restaurant/screens/RestaurantReceiptsScreen';

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

import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import inventoryFtl from '@/locales/inventory.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';

const FTL = [salesFtl, productsFtl, inventoryFtl, settingsFtl];

const renderScreen = (props: { tablesEnabled?: boolean; terminalId?: string; onBack?: () => void } = {}) =>
  renderWithProviders(<RestaurantReceiptsScreen {...props} />, ...FTL);

describe('RestaurantReceiptsScreen — margins & geometry', () => {
  it('clamps margin inputs to their valid ranges', async () => {
    const user = userEvent.setup();
    await renderScreen();

    const top = screen.getByLabelText(/Top/i) as HTMLInputElement;
    await user.clear(top);
    await user.type(top, '150');
    expect(Number(top.value)).toBeLessThanOrEqual(30);

    const bottom = screen.getByLabelText(/Bottom/i) as HTMLInputElement;
    await user.clear(bottom);
    await user.type(bottom, '999');
    expect(Number(bottom.value)).toBeLessThanOrEqual(30);

    const left = screen.getByLabelText(/Left/i) as HTMLInputElement;
    await user.clear(left);
    await user.type(left, '50');
    expect(Number(left.value)).toBeLessThanOrEqual(15);

    const right = screen.getByLabelText(/Right/i) as HTMLInputElement;
    await user.clear(right);
    await user.type(right, '50');
    expect(Number(right.value)).toBeLessThanOrEqual(15);
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

    // Default showCurrency false -> bare id-ID number in the totals.
    const total = screen.getByText('93.000');
    expect(total).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Show Currency/i));
    expect(screen.getByText('Rp 93.000')).toBeInTheDocument();
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
});

describe('RestaurantReceiptsScreen — back nav & save', () => {
  it('fires onBack when the header back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    await renderScreen({ onBack });
    await user.click(screen.getByTestId('restaurant-receipts-back-btn'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('saves a dirty change when Save is clicked and clears the unsaved indicator', async () => {
    const user = userEvent.setup();
    await renderScreen();

    // The Save button is disabled until a change makes the screen dirty.
    const saveBtn = screen.getByRole('button', { name: /Save/i });
    expect(saveBtn).toBeDisabled();

    const title = screen.getByLabelText(/Receipt Title/i);
    await user.clear(title);
    await user.type(title, 'WARUNG BARU');
    expect(saveBtn).toBeEnabled();

    await user.click(saveBtn);

    await waitFor(() => {
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
});

