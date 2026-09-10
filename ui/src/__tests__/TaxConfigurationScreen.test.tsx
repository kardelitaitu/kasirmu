import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import {
  assertAllInvokesHandled,
  recordUnmatchedInvoke,
  resetUnmatchedInvokes,
} from '@/__tests__/test-utils/invokeCoverage';
import { ToastProvider } from '@/frontend/shared/Toast';
import taxFtl from '@/locales/tax.ftl?raw';
import TaxConfigurationScreen from '@/features/tax/TaxConfigurationScreen';

const SAMPLE_TAX_RATES = [
  { id: 'tax-1', name: 'Sales Tax', rate_bps: 825, is_default: true, display_rate: '8.25%', is_inclusive: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', scope: { scope: 'location', legalEntityId: null, locationId: 'loc-1' }, window: { effectiveFrom: '2026-01-01', effectiveTo: null } },
  { id: 'tax-2', name: 'VAT', rate_bps: 2000, is_default: false, display_rate: '20%', is_inclusive: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', scope: null, window: null },
];

const SAMPLE_CATEGORIES = [
  { id: 'cat-1', name: 'Food', colour: '#f97316', icon: 'food' },
  { id: 'cat-2', name: 'Drinks', colour: '#3b82f6', icon: 'drink' },
];

const SAMPLE_CAT_TAX_RATES = [
  { category_id: 'cat-1', tax_rate_ids: ['tax-1'] },
];

const { invokeMock, setRoundingModesMock, getRoundingModesMock } = vi.hoisted(() => {
  // Hoisted closure state: the invokeMock implementation (defined in
  // beforeEach, after this runs) must read what tests stage, so the
  // variable lives HERE and both directions go through accessors.
  let roundingModesMock: Record<string, string | null> = {};
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invokeMock: vi.fn() as any,
    setRoundingModesMock: (v: Record<string, string | null>) => {
      roundingModesMock = v;
    },
    getRoundingModesMock: () => roundingModesMock,
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

beforeEach(() => {
  invokeMock.mockClear();
  resetUnmatchedInvokes();
  setRoundingModesMock({});
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_tax_rates_scoped') return Promise.resolve(SAMPLE_TAX_RATES);
    if (cmd === 'list_categories' || cmd === 'list_categories_scoped') return Promise.resolve(SAMPLE_CATEGORIES);
    if (cmd === 'list_category_tax_rates_scoped') return Promise.resolve(SAMPLE_CAT_TAX_RATES);
    if (cmd === 'create_tax_rate_scoped') return Promise.resolve({ ...SAMPLE_TAX_RATES[0], name: 'New Tax' });
    if (cmd === 'update_tax_rate_scoped') return Promise.resolve(SAMPLE_TAX_RATES[0]);
    if (cmd === 'delete_tax_rate_scoped') return Promise.resolve(undefined);
    if (cmd === 'get_tax_rate_dependency_counts_scoped') return Promise.resolve({ products: 0, categories: 0, sale_lines: 0 });
    if (cmd === 'set_category_tax_rates_scoped') return Promise.resolve(undefined);
    if (cmd === 'list_tax_rate_rounding_modes_scoped') {
      return Promise.resolve(getRoundingModesMock());
    }
    recordUnmatchedInvoke(cmd);
    return Promise.reject(new Error(`Unknown command: ${cmd}`));
  });
});

afterEach(() => assertAllInvokesHandled('TaxConfigurationScreen'));

async function waitForTable() {
  // The tax rates table has exact aria-label "Tax rates" (from Fluent key tax-config-table-aria).
  // The category table has "Category tax rates" — don't match that one.
  await screen.findByRole('table', { name: 'Tax rates' });
}

describe('TaxConfigurationScreen', () => {
  it('renders title', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    expect(screen.getByRole('heading', { name: /tax configuration/i })).toBeInTheDocument();
  });

  it('shows loading skeleton while fetching tax rates', async () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    expect(document.querySelector('.tax-config-loading-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/loading tax rates/i)).not.toBeInTheDocument();
  });

  it('renders tax rate rows', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    // Use getAllByText — 'Sales Tax' appears in both the table and category badges
    expect(screen.getAllByText('Sales Tax').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('VAT')).toBeInTheDocument();
    expect(screen.getByText('8.25%')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
  });

  it('shows default badge for default tax rate', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    // Sales Tax is default, VAT is not
    const defaultBadges = screen.getAllByText('Default');
    expect(defaultBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the scope provenance badge for a location-scoped rate', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    // Sales Tax carries scope { location, loc-1 } from the side-channel join.
    expect(screen.getByText('Location · loc-1')).toBeInTheDocument();
  });

  it('shows the Global badge when the scope entry is absent', async () => {
    // A null scope entry is the tenant-global tier — the resolver walk ends
    // there, so the badge must say Global, not hide the row's provenance.
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    expect(screen.getByText('Global')).toBeInTheDocument();
  });

  it('shows empty state when no tax rates exist', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_tax_rates_scoped') return Promise.resolve([]);
      if (cmd === 'list_categories' || cmd === 'list_categories_scoped') return Promise.resolve([]);
      if (cmd === 'list_category_tax_rates_scoped') return Promise.resolve([]);
      return Promise.resolve([]);
    });
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitFor(() => {
      expect(screen.getByText(/no tax rates configured/i)).toBeInTheDocument();
    });
  });

  it('opens add modal when Add Tax Rate is clicked', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /add tax rate/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Tax Name')).toBeInTheDocument();
    // Rate label has exact text 'Rate (%)' — avoid partial match which could
    // also match the hint text 'Enter rate in basis points...'
    expect(within(dialog).getByText('Rate (%)')).toBeInTheDocument();
  });

  // ── New edge-case tests ─────────────────────────────────────────

  it('opens edit modal pre-filled when Edit is clicked', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();

    // 'Sales Tax' appears in both the rate table and category badges,
    // so use getAllByText and scope to the first matching row
    const salesTaxCells = screen.getAllByText('Sales Tax');
    // The first occurrence is in the rate table (row with 8.25%)
    const salesTaxRow = salesTaxCells[0]!.closest('tr')!;
    const editBtn = within(salesTaxRow).getByRole('button', { name: /edit/i });
    await userEvent.click(editBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Modal should have the tax name input pre-filled
    const nameInput = within(dialog).getByDisplayValue('Sales Tax');
    expect(nameInput).toBeInTheDocument();
    // F1: window + scope fields seeded from the joined DTO
    expect(within(dialog).getByLabelText('Effective from')).toHaveValue('2026-01-01');
    expect(within(dialog).getByLabelText('Legal entity id')).toHaveValue('');
    expect(within(dialog).getByLabelText('Location id')).toHaveValue('loc-1');
  });

  it('sends scope and window args through the scoped create command', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /add tax rate/i }));

    await userEvent.type(screen.getByLabelText('Tax Name'), 'Room Tax');
    await userEvent.type(screen.getByLabelText('Rate (%)'), '500');
    await userEvent.type(screen.getByLabelText('Location id'), 'loc-1');
    await userEvent.type(screen.getByLabelText('Effective from'), '2026-10-01');
    await userEvent.type(screen.getByLabelText('Effective to (exclusive)'), '2027-10-01');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('create_tax_rate_scoped', expect.objectContaining({
        args: expect.objectContaining({
          name: 'Room Tax',
          rateBps: 500,
          locationId: 'loc-1',
          effectiveFrom: '2026-10-01',
          effectiveTo: '2027-10-01',
        }),
      }));
    });
  });

  it('warns when editing changes the rate tier', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    const salesTaxRow = screen.getAllByText('Sales Tax')[0]!.closest('tr')!;
    await userEvent.click(within(salesTaxRow).getByRole('button', { name: /edit/i }));

    const dialog = screen.getByRole('dialog');
    // F1 debt: tier move silently empties the vacated tier — warn on change.
    expect(within(dialog).queryByText(/leaves the vacated tier/i)).toBeNull();

    await userEvent.type(within(dialog).getByLabelText('Location id'), '-2');
    expect(within(dialog).getByText(/leaves the vacated tier/i)).toBeInTheDocument();
  });

  it('offers the replacement path when the delete guard refuses', async () => {
    // A3 guard: delete_tax_rate refuses with Validation when the rate is the
    // last row covering a live tier; the refusal dialog offers the remedy.
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    const salesTaxRow = screen.getAllByText('Sales Tax')[0]!.closest('tr')!;
    await userEvent.click(within(salesTaxRow).getByRole('button', { name: /delete/i }));
    const confirm = await screen.findByRole('dialog', { name: /delete sales tax/i });
    // Queue the rejection only for the delete call — the initial list/counts
    // calls must still resolve for the screen to render.
    invokeMock.mockRejectedValueOnce({
      kind: 'invalid',
      message: 'location loc-1 needs a replacement rate first',
    });
    await userEvent.click(within(confirm).getByRole('button', { name: /delete/i }));

    // The refusal dialog names the rate and offers the remedy path.
    const refusal = await screen.findByRole('dialog', { name: /cannot delete sales tax/i });
    expect(within(refusal).getByText(/last rate covering its tier/i)).toBeInTheDocument();
    await userEvent.click(within(refusal).getByRole('button', { name: /create replacement/i }));

    // Remedy: the create modal opens for the replacement authoring.
    expect(await screen.findByText(/tax name/i)).toBeInTheDocument();
  });

  it('deletes a tax rate after confirming the destructive dialog', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();

    // Find and click the Delete button for VAT (non-default)
    // 'VAT' appears in the rate table rows — scope to that table
    const vatRow = screen.getByText('VAT').closest('tr')!;
    const deleteBtn = within(vatRow).getByRole('button', { name: /delete/i });
    expect(deleteBtn).not.toBeDisabled();
    await userEvent.click(deleteBtn);

    // Confirmation dialog must appear and name the rate
    const confirm = await screen.findByRole('dialog', { name: /delete VAT/i });
    expect(within(confirm).getByText(/archive/i)).toBeInTheDocument();

    // Confirm the deletion — then the scoped delete command is invoked
    await userEvent.click(within(confirm).getByRole('button', { name: /delete/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('delete_tax_rate_scoped', expect.objectContaining({
        sessionToken: expect.any(String),
        id: 'tax-2',
      }));
    });
  });

  it('renders the category tax rates section', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();

    // Category section heading
    expect(screen.getByText(/category tax rates/i)).toBeInTheDocument();
    expect(screen.getByText('Food')).toBeInTheDocument();
    expect(screen.getByText('Drinks')).toBeInTheDocument();
  });

  it('shows assigned tax rate badges in category section', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();

    // Food category has Sales Tax (tax-1) assigned
    const foodRow = screen.getByText('Food').closest('tr')!;
    expect(within(foodRow).getByText('Sales Tax')).toBeInTheDocument();

    // Drinks category has no rates assigned
    const drinksRow = screen.getByText('Drinks').closest('tr')!;
    expect(within(drinksRow).getByText(/no rates assigned/i)).toBeInTheDocument();
  });

  it('disables the confirm button while deletion is in progress', async () => {
    // Make delete slow so we can see the pending state
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'delete_tax_rate_scoped') return new Promise(() => {});
      if (cmd === 'get_tax_rate_dependency_counts_scoped') return Promise.resolve({ products: 0, categories: 0, sale_lines: 0 });
      if (cmd === 'list_tax_rates_scoped') return Promise.resolve(SAMPLE_TAX_RATES);
      if (cmd === 'list_categories' || cmd === 'list_categories_scoped') return Promise.resolve(SAMPLE_CATEGORIES);
      if (cmd === 'list_category_tax_rates_scoped') return Promise.resolve(SAMPLE_CAT_TAX_RATES);
      return Promise.resolve([]);
    });

    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();

    const vatRow = screen.getByText('VAT').closest('tr')!;
    const deleteBtn = within(vatRow).getByRole('button', { name: /delete/i });
    await userEvent.click(deleteBtn);

    // Confirmation dialog opens; confirm button is enabled
    const confirm = await screen.findByRole('dialog', { name: /delete VAT/i });
    const confirmBtn = within(confirm).getByRole('button', { name: /delete/i });
    await userEvent.click(confirmBtn);

    // Confirm button should be disabled (loading) while delete is in flight
    await waitFor(() => {
      expect(confirmBtn).toBeDisabled();
    });
  });

  it('shows a load-error state with retry when the initial fetch fails', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_tax_rates_scoped') return Promise.reject(new Error('IPC unavailable'));
      return Promise.reject(new Error('IPC unavailable'));
    });

    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/failed to load tax configuration/i)).toBeInTheDocument();

    // Retry re-attempts the load and recovers
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_tax_rates_scoped') return Promise.resolve(SAMPLE_TAX_RATES);
      if (cmd === 'list_categories' || cmd === 'list_categories_scoped') return Promise.resolve(SAMPLE_CATEGORIES);
      if (cmd === 'list_category_tax_rates_scoped') return Promise.resolve(SAMPLE_CAT_TAX_RATES);
      return Promise.resolve([]);
    });
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitForTable();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes the add modal when Escape is pressed', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();

    // Open add modal
    await userEvent.click(screen.getByRole('button', { name: /add tax rate/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Press Escape
    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('handles save failure gracefully', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'create_tax_rate_scoped') return Promise.reject(new Error('DB error'));
      if (cmd === 'list_tax_rates_scoped') return Promise.resolve(SAMPLE_TAX_RATES);
      if (cmd === 'list_categories' || cmd === 'list_categories_scoped') return Promise.resolve(SAMPLE_CATEGORIES);
      if (cmd === 'list_category_tax_rates_scoped') return Promise.resolve(SAMPLE_CAT_TAX_RATES);
      return Promise.resolve([]);
    });

    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();

    // Open add modal, fill form, and save
    await userEvent.click(screen.getByRole('button', { name: /add tax rate/i }));
    const dialog = screen.getByRole('dialog');

    // Fill the name field
    const nameInput = within(dialog).getByRole('textbox', { name: /tax name/i });
    await userEvent.type(nameInput, 'New Tax');

    // Fill the rate field (type="number", role spinbutton) so save is enabled
    const rateInput = within(dialog).getByRole('spinbutton', { name: /rate/i });
    await userEvent.type(rateInput, '825');

    // Save and wait for error to be caught
    const saveBtn = within(dialog).getByRole('button', { name: /save/i });
    await userEvent.click(saveBtn);

    // Modal should stay open after failure and save should re-enable
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(saveBtn).not.toBeDisabled();
    });
  });

  // ── TAX-03: dependency counts + archive blocking ─────────────────

  it('shows a blocked dialog when the rate is referenced by historical sales', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_tax_rate_dependency_counts_scoped') return Promise.resolve({ products: 1, categories: 1, sale_lines: 3 });
      if (cmd === 'list_tax_rates_scoped') return Promise.resolve(SAMPLE_TAX_RATES);
      if (cmd === 'list_categories' || cmd === 'list_categories_scoped') return Promise.resolve(SAMPLE_CATEGORIES);
      if (cmd === 'list_category_tax_rates_scoped') return Promise.resolve(SAMPLE_CAT_TAX_RATES);
      return Promise.resolve([]);
    });

    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();

    const vatRow = screen.getByText('VAT').closest('tr')!;
    await userEvent.click(within(vatRow).getByRole('button', { name: /delete/i }));

    // Blocked dialog: title names the rate, message explains the sales reference
    const blocked = await screen.findByRole('dialog', { name: /cannot delete VAT/i });
    expect(within(blocked).getByText(/3 historical sale/i)).toBeInTheDocument();

    // Confirm button is disabled — archiving is blocked by the backend policy
    const confirmBtn = within(blocked).getByRole('button', { name: /delete/i });
    expect(confirmBtn).toBeDisabled();
  });

  it('shows dependency counts in the delete confirmation dialog', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_tax_rate_dependency_counts_scoped') return Promise.resolve({ products: 2, categories: 1, sale_lines: 0 });
      if (cmd === 'list_tax_rates_scoped') return Promise.resolve(SAMPLE_TAX_RATES);
      if (cmd === 'list_categories' || cmd === 'list_categories_scoped') return Promise.resolve(SAMPLE_CATEGORIES);
      if (cmd === 'list_category_tax_rates_scoped') return Promise.resolve(SAMPLE_CAT_TAX_RATES);
      return Promise.resolve([]);
    });

    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();

    const vatRow = screen.getByText('VAT').closest('tr')!;
    await userEvent.click(within(vatRow).getByRole('button', { name: /delete/i }));

    const confirm = await screen.findByRole('dialog', { name: /delete VAT/i });
    expect(within(confirm).getByText(/2 product assignments/i)).toBeInTheDocument();
    expect(within(confirm).getByText(/1 category assignment/i)).toBeInTheDocument();

    // No sales references → confirm stays enabled
    expect(within(confirm).getByRole('button', { name: /delete/i })).not.toBeDisabled();
  });

  it('moves selection and focus with arrow keys in the tax type radiogroup', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /add tax rate/i }));
    const dialog = screen.getByRole('dialog');

    const exclusive = within(dialog).getByRole('radio', { name: /exclusive/i });
    const inclusive = within(dialog).getByRole('radio', { name: /inclusive/i });

    // Default (new tax): Exclusive selected → roving tabindex points at it.
    expect(exclusive).toHaveAttribute('aria-checked', 'true');
    expect(inclusive).toHaveAttribute('aria-checked', 'false');
    expect(exclusive).toHaveAttribute('tabindex', '0');
    expect(inclusive).toHaveAttribute('tabindex', '-1');

    // ArrowRight moves focus + selection to Inclusive.
    exclusive.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(inclusive).toHaveAttribute('aria-checked', 'true');
    expect(exclusive).toHaveAttribute('aria-checked', 'false');
    expect(inclusive).toHaveFocus();

    // ArrowLeft moves it back.
    await userEvent.keyboard('{ArrowLeft}');
    expect(exclusive).toHaveAttribute('aria-checked', 'true');
    expect(inclusive).toHaveAttribute('aria-checked', 'false');
    expect(exclusive).toHaveFocus();
  });

  it('trims the name and keeps the rate an integer when saving', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /add tax rate/i }));
    const dialog = screen.getByRole('dialog');

    const nameInput = within(dialog).getByRole('textbox', { name: /tax name/i });
    fireEvent.change(nameInput, { target: { value: '  Sales Tax  ' } });
    const rateInput = within(dialog).getByRole('spinbutton', { name: /rate/i });
    fireEvent.change(rateInput, { target: { value: '825' } });

    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('create_tax_rate_scoped', expect.objectContaining({
        args: expect.objectContaining({ name: 'Sales Tax', rateBps: 825 }),
      }));
    });
  });

  it('disables the category save button until the assignment changes', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();

    // Open the category edit modal for Food (Sales Tax already assigned).
    const foodRow = screen.getByText('Food').closest('tr')!;
    await userEvent.click(within(foodRow).getByRole('button', { name: /edit/i }));

    const dialog = screen.getByRole('dialog');
    const saveBtn = within(dialog).getByRole('button', { name: /save/i });

    // Unchanged assignment → save disabled (no no-op IPC round-trip).
    expect(saveBtn).toBeDisabled();

    // Toggle VAT on → save enabled.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /VAT/i }));
    expect(saveBtn).toBeEnabled();

    // Toggle VAT back off → save disabled again.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /VAT/i }));
    expect(saveBtn).toBeDisabled();
  });

  it('rejects a non-integer rate instead of silently truncating it', async () => {
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /add tax rate/i }));
    const dialog = screen.getByRole('dialog');

    const nameInput = within(dialog).getByRole('textbox', { name: /tax name/i });
    fireEvent.change(nameInput, { target: { value: 'Decimal Tax' } });
    const rateInput = within(dialog).getByRole('spinbutton', { name: /rate/i });
    fireEvent.change(rateInput, { target: { value: '825.5' } });

    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));

    // No create command should fire; the modal stays open for correction.
    await waitFor(() => {
      expect(invokeMock).not.toHaveBeenCalledWith('create_tax_rate_scoped', expect.anything());
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

// ── E1-8: rounding provenance badge (over the E1-5 batch read) ──

describe('TaxConfigurationScreen rounding provenance (E1-8)', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    resetUnmatchedInvokes();
    setRoundingModesMock({});
  });

  it('badge falls back to the store preference when the directive is null', async () => {
    setRoundingModesMock({ 'tax-1': null, 'tax-2': null });
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    await screen.findAllByText(/store preference/i);
    // The preference value is surfaced, not just a generic label.
    expect(screen.getAllByText(/Rounding: half_up \(store preference\)/).length).toBe(2);
  });

  it('badge shows the statutory directive when one is stored', async () => {
    setRoundingModesMock({ 'tax-1': 'truncate', 'tax-2': null });
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    await screen.findAllByText(/statutory/i);
    expect(screen.getByText('Rounding: truncate (statutory)')).toBeInTheDocument();
    expect(screen.getAllByText(/store preference/i).length).toBe(1);
  });

  it('a failed batch read degrades to the preference label, never a fabricated directive', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_tax_rate_rounding_modes_scoped') return Promise.reject(new Error('down'));
      if (cmd === 'list_tax_rates_scoped') return Promise.resolve(SAMPLE_TAX_RATES);
      if (cmd === 'list_categories' || cmd === 'list_categories_scoped') return Promise.resolve(SAMPLE_CATEGORIES);
      if (cmd === 'list_category_tax_rates_scoped') return Promise.resolve(SAMPLE_CAT_TAX_RATES);
      return Promise.reject(new Error(`Unknown command: ${cmd}`));
    });
    renderWithFluentSync(<ToastProvider><TaxConfigurationScreen /></ToastProvider>, taxFtl);
    await waitForTable();
    await screen.findAllByText(/store preference/i);
    expect(screen.queryByText(/statutory/i)).not.toBeInTheDocument();
  });
});
