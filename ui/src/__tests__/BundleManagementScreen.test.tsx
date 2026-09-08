import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import BundleManagementScreen from '@/features/products/BundleManagementScreen';
import { type BundleWithItems } from '@/api/bundles';
import bundlesFtl from '@/locales/bundles.ftl?raw';

const { mockListBundles, mockCreateBundle, mockUpdateBundle, mockDeleteBundle } =
  vi.hoisted(() => ({
    mockListBundles: vi.fn(),
    mockCreateBundle: vi.fn(),
    mockUpdateBundle: vi.fn(),
    mockDeleteBundle: vi.fn(),
  }));

vi.mock('@/api/bundles', () => ({
  listBundles: (_sessionToken: string) => mockListBundles(),
  createBundle: (_sessionToken: string, args: unknown) => mockCreateBundle(args),
  updateBundle: (_sessionToken: string, bundle: unknown) => mockUpdateBundle(bundle),
  deleteBundle: (_sessionToken: string, id: string) => mockDeleteBundle(id),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-test', activeWorkspace: null, logout: vi.fn() }),
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ role: { id: 'admin', name: 'Admin' } }),
}));

const bundle = new FluentBundle('en-US');
bundle.addResource(new FluentResource(bundlesFtl));
const l10n = new ReactLocalization([bundle]);

function renderScreen() {
  return render(
    <LocalizationProvider l10n={l10n}>
      <BundleManagementScreen />
    </LocalizationProvider>,
  );
}

function makeBundle(overrides: Partial<BundleWithItems['bundle']> = {}): BundleWithItems['bundle'] {
  return {
    id: 'b-1',
    bundle_sku: 'GIFT-BOX',
    name: 'Gift Box',
    description: 'A curated box',
    bundle_price_minor: 25000,
    currency: 'IDR',
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeItem(overrides: Partial<BundleWithItems['items'][number]> = {}): BundleWithItems['items'][number] {
  return {
    id: 'i-1',
    bundle_id: 'b-1',
    sku: 'SKU-001',
    qty: 2,
    unit_price_minor: 10000,
    ...overrides,
  };
}

function makeBundleWithItems(overrides: Partial<BundleWithItems> = {}): BundleWithItems {
  return {
    bundle: makeBundle(),
    items: [makeItem(), makeItem({ id: 'i-2', sku: 'SKU-002', qty: 1, unit_price_minor: null })],
    ...overrides,
  };
}

function pendingPromise() {
  return new Promise<BundleWithItems[]>(() => {});
}

describe('BundleManagementScreen', () => {
  beforeEach(() => {
    mockListBundles.mockResolvedValue([]);
  });

  it('renders the title', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Product Bundles')).toBeDefined());
  });

  it('renders the Add Bundle button', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Add Bundle')).toBeDefined());
  });

  it('shows loading skeleton initially', () => {
    mockListBundles.mockImplementation(() => pendingPromise());
    const { container } = renderScreen();

    const skeleton = container.querySelector('[aria-hidden="true"].bundle-mgmt-loading-skeleton');
    expect(skeleton).toBeTruthy();
    expect(screen.queryByText(/loading bundles/i)).toBeNull();
  });

  it('shows empty state when no bundles', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('No bundles yet.')).toBeDefined());
    // Empty state shows an "Add Bundle" button (Fluent key bundles-add)
    const addButtons = screen.getAllByText('Add Bundle');
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders a table with bundles', async () => {
    mockListBundles.mockResolvedValue([
      makeBundleWithItems(),
      makeBundleWithItems({ bundle: makeBundle({ id: 'b-2', name: 'Holiday Pack', bundle_sku: 'HOL-001' }) }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Gift Box')).toBeDefined());
    expect(screen.getByText('Holiday Pack')).toBeDefined();
    expect(screen.getByText('Name')).toBeDefined();
    expect(screen.getByText('Bundle SKU')).toBeDefined();
    expect(screen.getByText('Price')).toBeDefined();
    expect(screen.getByText('Items')).toBeDefined();
  });

  it('shows IDR price without a decimal tail (minor units = whole rupiah)', async () => {
    mockListBundles.mockResolvedValue([makeBundleWithItems()]);
    renderScreen();
    // 25000 IDR minor = Rp 25.000 — formatMoney (exp 0) must NOT emit 250.00.
    await waitFor(() => expect(screen.getByText('Rp 25.000')).toBeDefined());
  });

  it('shows em-dash when price is null', async () => {
    mockListBundles.mockResolvedValue([
      makeBundleWithItems({ bundle: makeBundle({ id: 'b-3', bundle_price_minor: null }) }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('\u2014')).toBeDefined());
  });

  it('shows item count per bundle', async () => {
    mockListBundles.mockResolvedValue([makeBundleWithItems()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('2')).toBeDefined());
  });

  it('has an active toggle per row on by default', async () => {
    mockListBundles.mockResolvedValue([makeBundleWithItems()]);
    renderScreen();
    await waitFor(() => {
      // Both the table header <th> and the toggle <span> say "Active" — at least 2
      const activeTexts = screen.getAllByText('Active');
      expect(activeTexts.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('toggles active state on click and calls updateBundle', async () => {
    mockListBundles.mockResolvedValue([makeBundleWithItems()]);
    mockUpdateBundle.mockResolvedValue({});
    renderScreen();
    await waitFor(() => expect(screen.getByText('Gift Box')).toBeDefined());

    // The toggle button has class bundle-mgmt-toggle -- find it by that
    const toggleBtn = document.querySelector('.bundle-mgmt-toggle--on')!;
    await userEvent.click(toggleBtn);
    await waitFor(() => expect(mockUpdateBundle).toHaveBeenCalled());
  });

  it('has Edit and Delete buttons per row', async () => {
    mockListBundles.mockResolvedValue([makeBundleWithItems()]);
    renderScreen();
    await waitFor(() => {
      const editBtns = screen.getAllByText('Edit');
      const deleteBtns = screen.getAllByText('Delete');
      expect(editBtns.length).toBeGreaterThanOrEqual(1);
      expect(deleteBtns.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('calls deleteBundle when Delete is clicked', async () => {
    mockListBundles.mockResolvedValue([makeBundleWithItems()]);
    mockDeleteBundle.mockResolvedValue(undefined);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Gift Box')).toBeDefined());

    const deleteBtn = screen.getAllByText('Delete')[0]!.closest('button')!;
    await userEvent.click(deleteBtn);
    await waitFor(() => expect(mockDeleteBundle).toHaveBeenCalledWith('b-1'));
  });

  it('opens the add modal when Add Bundle is clicked', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Add Bundle')).toBeDefined());

    const addBtn = screen.getAllByText('Add Bundle')[0]!.closest('button')!;
    await userEvent.click(addBtn);

    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());
    expect(screen.getByText('Create')).toBeDefined();
  });

  it('closes the add modal when Cancel is clicked', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Add Bundle')).toBeDefined());

    const addBtn = screen.getAllByText('Add Bundle')[0]!.closest('button')!;
    await userEvent.click(addBtn);
    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());

    const cancelBtn = screen.getByText('Cancel').closest('button')!;
    await userEvent.click(cancelBtn);
    await waitFor(() => expect(screen.queryByText('Cancel')).toBeNull());
  });

  it('opens the edit modal with pre-filled data', async () => {
    mockListBundles.mockResolvedValue([makeBundleWithItems()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Gift Box')).toBeDefined());

    const editBtn = screen.getAllByText('Edit')[0]!.closest('button')!;
    await userEvent.click(editBtn);

    await waitFor(() => {
      // The modal heading renders "Edit" (Fluent bundles-edit), but there are also
      // Edit buttons in the table — use getAllByText and check we have at least 2
      const editTexts = screen.getAllByText('Edit');
      expect(editTexts.length).toBeGreaterThanOrEqual(2);
      const nameInput = document.getElementById('bundle-field-name') as HTMLInputElement;
      expect(nameInput?.value).toBe('Gift Box');
    });
  });

  it('SKU field is disabled in edit mode', async () => {
    mockListBundles.mockResolvedValue([makeBundleWithItems()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Gift Box')).toBeDefined());

    const editBtn = screen.getAllByText('Edit')[0]!.closest('button')!;
    await userEvent.click(editBtn);

    await waitFor(() => {
      const skuInput = document.getElementById('bundle-field-sku') as HTMLInputElement;
      expect(skuInput?.disabled).toBe(true);
    });
  });

  it('adds an item row when + Add Item is clicked in the modal', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Add Bundle')).toBeDefined());

    const addBtn = screen.getAllByText('Add Bundle')[0]!.closest('button')!;
    await userEvent.click(addBtn);

    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());

    // Initial form has 1 item row
    const itemRowsBefore = document.querySelectorAll('.bundle-mgmt-item-row');
    expect(itemRowsBefore.length).toBe(1);

    // Click "+ Add Item" button
    const addItemBtn = screen.getByText('+ Add Item').closest('button')!;
    await userEvent.click(addItemBtn);

    const itemRowsAfter = document.querySelectorAll('.bundle-mgmt-item-row');
    expect(itemRowsAfter.length).toBe(2);
  });

  it('removes an item row when the remove button is clicked', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Add Bundle')).toBeDefined());

    const addBtn = screen.getAllByText('Add Bundle')[0]!.closest('button')!;
    await userEvent.click(addBtn);

    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());

    // Add a second item first so remove buttons appear
    await userEvent.click(screen.getByText('+ Add Item').closest('button')!);

    await waitFor(() => {
      const rows = document.querySelectorAll('.bundle-mgmt-item-row');
      expect(rows.length).toBe(2);
    });

    const removeBtns = document.querySelectorAll('.bundle-mgmt-item-remove');
    expect(removeBtns.length).toBeGreaterThanOrEqual(1);
    await userEvent.click(removeBtns[0] as HTMLElement);

    await waitFor(() => {
      const rows = document.querySelectorAll('.bundle-mgmt-item-row');
      expect(rows.length).toBe(1);
    });
  });

  it('calls createBundle on save with valid form data', async () => {
    mockCreateBundle.mockResolvedValue(makeBundleWithItems());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Add Bundle')).toBeDefined());

    const addBtn = screen.getAllByText('Add Bundle')[0]!.closest('button')!;
    await userEvent.click(addBtn);

    await waitFor(() => expect(screen.getByText('Cancel')).toBeDefined());

    const skuInput = document.getElementById('bundle-field-sku') as HTMLInputElement;
    await userEvent.type(skuInput, 'NEW-SKU');

    const nameInput = document.getElementById('bundle-field-name') as HTMLInputElement;
    await userEvent.type(nameInput, 'New Bundle');

    // Find the item SKU input inside the first item row (via document.querySelectorAll)
    await waitFor(() => {
      const rows = document.querySelectorAll('.bundle-mgmt-item-sku');
      expect(rows.length).toBe(1);
    }, { timeout: 5000 });
    const itemSkuInput = document.querySelector('.bundle-mgmt-item-sku') as HTMLInputElement;
    await userEvent.type(itemSkuInput, 'SKU-ONE');

    const createBtn = screen.getByText('Create').closest('button')!;
    await userEvent.click(createBtn);

    await waitFor(() => expect(mockCreateBundle).toHaveBeenCalled());
  });
});
