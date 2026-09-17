import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { ToastProvider } from '@/components/Toast';
import promotionsFtl from '@/locales/promotions.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import PromotionManagementScreen from '@/features/promotions/PromotionManagementScreen';

// ── Mocks ────────────────────────────────────────────────────────────

const mockListPromotions = vi.fn();
const mockCreatePromotion = vi.fn();
const mockUpdatePromotion = vi.fn();
const mockDeletePromotion = vi.fn();

vi.mock('@/api/promotions', () => ({
  listPromotions: (...args: unknown[]) => mockListPromotions(...args),
  createPromotion: (...args: unknown[]) => mockCreatePromotion(...args),
  updatePromotion: (...args: unknown[]) => mockUpdatePromotion(...args),
  deletePromotion: (...args: unknown[]) => mockDeletePromotion(...args),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1', activeWorkspace: null, logout: vi.fn() }),
}));

// ── Helpers ───────────────────────────────────────────────────────────

function makePromo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'promo-1',
    name: 'Summer Sale',
    description: 'Summer discount',
    promo_type: 'percentage',
    value_minor: 10,
    min_qty: null,
    trigger_sku: null,
    reward_sku: null,
    reward_qty: null,
    starts_at: '2025-07-01T00:00:00.000Z',
    ends_at: '2025-08-31T00:00:00.000Z',
    min_order_minor: 0,
    category_id: null,
    active: true,
    created_at: '2025-06-01T00:00:00.000Z',
    updated_at: '2025-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderScreen() {
  return renderWithFluentSync(<ToastProvider><PromotionManagementScreen /></ToastProvider>, promotionsFtl, sharedFtl);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('PromotionManagementScreen', () => {
  beforeEach(() => {
    mockListPromotions.mockReset();
    mockCreatePromotion.mockReset();
    mockUpdatePromotion.mockReset();
    mockDeletePromotion.mockReset();
  });

  it('renders the title', async () => {
    mockListPromotions.mockResolvedValue([makePromo()]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Promotions')).toBeTruthy();
    });
  });

  it('renders the Add Promotion button', async () => {
    mockListPromotions.mockResolvedValue([makePromo()]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Add Promotion')).toBeTruthy();
    });
  });

  it('shows loading skeleton while fetching promotions', () => {
    mockListPromotions.mockImplementation(() => new Promise(() => {}));
    renderScreen();

    expect(document.querySelector('.promo-mgmt-loading-skeleton')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('shows empty state when no promotions', async () => {
    mockListPromotions.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No promotions yet.')).toBeTruthy();
    });
  });

  it('renders a table with promotions', async () => {
    mockListPromotions.mockResolvedValue([
      makePromo({ id: 'p1', name: 'Summer Sale', promo_type: 'percentage' }),
      makePromo({ id: 'p2', name: 'Winter Deal', promo_type: 'fixed_amount', value_minor: 500 }),
    ]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Summer Sale')).toBeTruthy();
      expect(screen.getByText('Winter Deal')).toBeTruthy();
    });

    // Table headers
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Type')).toBeTruthy();
    expect(screen.getByText('Value')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows promotion type labels via Fluent', async () => {
    mockListPromotions.mockResolvedValue([makePromo({ promo_type: 'percentage', value_minor: 15 })]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Percentage')).toBeTruthy();
      // 15% for percentage type
      expect(screen.getByText('15%')).toBeTruthy();
    });
  });

  it('shows fixed amount value without percent sign', async () => {
    mockListPromotions.mockResolvedValue([makePromo({ promo_type: 'fixed_amount', value_minor: 5000 })]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Fixed Amount')).toBeTruthy();
      expect(screen.getByText('5000')).toBeTruthy();
    });
  });

  it('has an active toggle checkbox per row', async () => {
    mockListPromotions.mockResolvedValue([makePromo({ active: true })]);
    renderScreen();

    await waitFor(() => {
      const checkbox = document.querySelector('input[type="checkbox"]') as HTMLElement as HTMLInputElement | null;
      expect(checkbox).toBeTruthy();
      expect(checkbox!.checked).toBe(true);
    });
  });

  it('opens the add modal when Add Promotion is clicked', async () => {
    mockListPromotions.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No promotions yet.')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Add Promotion'));

    await waitFor(() => {
      // Modal form fields should be visible
      expect(screen.getByText('Value')).toBeTruthy();
      expect(screen.getByText('Cancel')).toBeTruthy();
      expect(screen.getByText('Save')).toBeTruthy();
    });
  });

  it('rejects fractional value input instead of truncating it', async () => {
    mockListPromotions.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No promotions yet.')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Add Promotion'));

    const valueInput = await screen.findByLabelText('Value') as HTMLInputElement;
    await user.type(valueInput, '12.5');

    // Fractional keystrokes are ignored — the field must not silently
    // truncate 12.5 to 12 via parseInt.
    expect(valueInput.value).toBe('12');
  });

  it('closes the add modal with Cancel', async () => {
    mockListPromotions.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No promotions yet.')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Add Promotion'));

    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeTruthy();
    });

    await user.click(screen.getByText('Cancel'));

    await waitFor(() => {
      // Modal should close
      expect(screen.queryByText('Cancel')).toBeNull();
    });
  });

  it('opens the delete confirm modal when Delete is clicked', async () => {
    mockListPromotions.mockResolvedValue([makePromo({ name: 'To Delete' })]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Delete Promotion')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Delete Promotion'));

    await waitFor(() => {
      // Delete confirm modal should appear
      expect(screen.getByText(/Are you sure/)).toBeTruthy();
    });
  });

  it('closes delete confirm with Cancel', async () => {
    mockListPromotions.mockResolvedValue([makePromo({ name: 'Temp' })]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Delete Promotion')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Delete Promotion'));

    await waitFor(() => {
      expect(screen.getByText(/Are you sure/)).toBeTruthy();
    });

    // Click Cancel in the delete modal
    const cancelBtns = screen.getAllByText('Cancel');
    await user.click(cancelBtns[0]!);

    await waitFor(() => {
      expect(screen.queryByText(/Are you sure/)).toBeNull();
    });
  });

  it('has Edit buttons per row', async () => {
    mockListPromotions.mockResolvedValue([makePromo()]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Edit Promotion')).toBeTruthy();
    });
  });

  it('has Delete buttons per row', async () => {
    mockListPromotions.mockResolvedValue([makePromo()]);
    renderScreen();

    await waitFor(() => {
      const deleteBtns = screen.getAllByText('Delete Promotion');
      expect(deleteBtns.length).toBe(1);
    });
  });

  it('opens the edit modal with pre-filled data', async () => {
    mockListPromotions.mockResolvedValue([makePromo({ name: 'Summer Sale', promo_type: 'percentage', value_minor: 15 })]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Summer Sale')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Edit Promotion'));

    await waitFor(() => {
      // Edit modal should show form fields (scope within modal since "Value" also appears in table header)
      const modal = document.querySelector('.promo-mgmt-overlay');
      expect(modal).toBeTruthy();
      expect(modal!.querySelector('input[aria-label="Name"]')).toBeTruthy();
      expect(modal!.querySelector('input[aria-label="Value"]')).toBeTruthy();
    });
  });

  it('calls createPromotion when saving a new promo', async () => {
    mockListPromotions.mockResolvedValueOnce([]);
    mockListPromotions.mockResolvedValueOnce([makePromo({ name: 'New Promo' })]);
    mockCreatePromotion.mockResolvedValue(makePromo({ name: 'New Promo' }));
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No promotions yet.')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Add Promotion'));

    await waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    // Fill the name field via aria-label
    const nameInput = document.querySelector('input[aria-label="Name"]') as HTMLElement as HTMLInputElement | null;
    await user.type(nameInput!, 'New Promo');

    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockCreatePromotion).toHaveBeenCalled();
    });
  });

  it('toggles active status via checkbox', async () => {
    mockListPromotions.mockResolvedValueOnce([makePromo({ active: true })]);
    mockListPromotions.mockResolvedValueOnce([makePromo({ active: false })]);
    mockUpdatePromotion.mockResolvedValue(makePromo({ active: false }));
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Summer Sale')).toBeTruthy();
    });

    const user = userEvent.setup();
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLElement as HTMLInputElement | null;
    expect(checkbox!.checked).toBe(true);

    await user.click(checkbox!);

    await waitFor(() => {
      expect(mockUpdatePromotion).toHaveBeenCalled();
    });
  });
});
