import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import ItemModifierModal from '@/features/sales/components/ItemModifierModal';
import type {
  ItemModifierModalProps,
  ModifierGroup,
} from '@/features/sales/components/ItemModifierModal';

// ── Fixtures ─────────────────────────────────────────────────────────

const donenessGroup: ModifierGroup = {
  id: 'grp-doneness',
  name: 'Doneness',
  minSelections: 1,
  maxSelections: 1,
  sortOrder: 1,
  modifiers: [
    { id: 'mod-rare', name: 'Rare', priceMinor: 0, sortOrder: 1, isDefault: false },
    { id: 'mod-medium', name: 'Medium', priceMinor: 0, sortOrder: 2, isDefault: true },
    { id: 'mod-well', name: 'Well Done', priceMinor: 0, sortOrder: 3, isDefault: false },
  ],
};

const sidesGroup: ModifierGroup = {
  id: 'grp-sides',
  name: 'Add Sides',
  minSelections: 0,
  maxSelections: 2,
  sortOrder: 2,
  modifiers: [
    { id: 'mod-fries', name: 'French Fries', priceMinor: 5000, sortOrder: 1, isDefault: false },
    { id: 'mod-salad', name: 'Side Salad', priceMinor: 3000, sortOrder: 2, isDefault: false },
    { id: 'mod-onion', name: 'Onion Rings', priceMinor: 7000, sortOrder: 3, isDefault: false },
  ],
};

const defaultProps: ItemModifierModalProps = {
  open: true,
  productName: 'Grilled Ribeye',
  basePriceMinor: 150000,
  currency: 'IDR',
  groups: [donenessGroup, sidesGroup],
  onConfirm: vi.fn(),
  onClose: vi.fn(),
};

const ftl = `
modifier-no-options = No customisation options available
modifier-dialog-aria = Customise { $productName }
modifier-free = Free
modifier-base-price = Base price
modifier-addons = Add-ons
modifier-total = Total
cancel = Cancel
close = Close
modifier-add-to-cart = Add to Order
`;

function wrapper({ children }: { children: React.ReactNode }) {
  // Match production (i18n/index.ts) — useIsolating: false avoids
  // U+2068/U+2069 isolation markers around interpolated variables.
  const bundle = new FluentBundle('en', { useIsolating: false });
  bundle.addResource(new FluentResource(ftl));
  const l10n = new ReactLocalization([bundle]);
  return <LocalizationProvider l10n={l10n}>{children}</LocalizationProvider>;
}

function renderModal(props: Partial<ItemModifierModalProps> = {}) {
  return render(<ItemModifierModal {...defaultProps} {...props} />, { wrapper });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ItemModifierModal', () => {
  // ── Render / open state ─────────────────────────────────────────

  it('renders nothing when open is false', () => {
    renderModal({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders modal with product name and groups when open', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Grilled Ribeye')).toBeInTheDocument();
    expect(screen.getByText('Doneness')).toBeInTheDocument();
    expect(screen.getByText('Add Sides')).toBeInTheDocument();
  });

  it('pre-selects default modifiers', () => {
    renderModal();
    const mediumBtn = screen.getByTestId('modifier-mod-medium');
    // aria-checked, not aria-selected: these are radio/checkbox controls now —
    // aria-selected is only valid on option/tab/gridcell-like roles.
    expect(mediumBtn).toHaveAttribute('aria-checked', 'true');
  });

  it('shows price values in footer', () => {
    renderModal();
    // formatMoney with IDR/id-ID: 150000 → "Rp 150.000"
    const priceElements = screen.getAllByText(/150\.000/);
    expect(priceElements.length).toBeGreaterThanOrEqual(1);
  });

  // ── Selection logic ──────────────────────────────────────────────

  it('toggles a modifier on click', async () => {
    const user = userEvent.setup();
    renderModal();
    const rareBtn = screen.getByTestId('modifier-mod-rare');
    expect(rareBtn).toHaveAttribute('aria-checked', 'false');

    await user.click(rareBtn);
    await waitFor(() => {
      expect(rareBtn).toHaveAttribute('aria-checked', 'true');
    });

    // Medium should be deselected (single-select group: maxSelections=1).
    const mediumBtn = screen.getByTestId('modifier-mod-medium');
    await waitFor(() => {
      expect(mediumBtn).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('selects multiple modifiers in a multi-select group', async () => {
    const user = userEvent.setup();
    renderModal();
    const friesBtn = screen.getByTestId('modifier-mod-fries');
    const saladBtn = screen.getByTestId('modifier-mod-salad');

    await user.click(friesBtn);
    await user.click(saladBtn);

    await waitFor(() => {
      expect(friesBtn).toHaveAttribute('aria-checked', 'true');
    });
    await waitFor(() => {
      expect(saladBtn).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('prevents exceeding maxSelections in a group', async () => {
    const user = userEvent.setup();
    renderModal();
    const friesBtn = screen.getByTestId('modifier-mod-fries');
    const saladBtn = screen.getByTestId('modifier-mod-salad');
    const onionBtn = screen.getByTestId('modifier-mod-onion');

    await user.click(friesBtn);
    await user.click(saladBtn);

    // Third option should be disabled after 2 selections (maxSelections = 2).
    await waitFor(() => {
      expect(onionBtn).toBeDisabled();
    });
  });

  it('prevents deselecting below minSelections in a group', async () => {
    const user = userEvent.setup();
    renderModal();
    const mediumBtn = screen.getByTestId('modifier-mod-medium');

    // Try to deselect Medium (minSelections = 1 for doneness).
    await user.click(mediumBtn);
    await waitFor(() => {
      expect(mediumBtn).toHaveAttribute('aria-checked', 'true');
    });
  });

  // ── Confirm / close ──────────────────────────────────────────────

  it('calls onConfirm with selections when Add to Order is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add to Order/ })).not.toBeDisabled();
    });

    await user.click(screen.getByRole('button', { name: /Add to Order/ }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ groupName: 'Doneness', modifierName: 'Medium' }),
        ]),
        150000,
      );
    });
  });

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });
    await user.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when overlay backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });
    await user.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalled();
  });

  it('disables Confirm when group selections are invalid', () => {
    const invalidGroups: ModifierGroup[] = [
      {
        ...donenessGroup,
        minSelections: 1,
        maxSelections: 1,
        modifiers: donenessGroup.modifiers.map((m) => ({ ...m, isDefault: false })),
      },
    ];
    renderModal({
      groups: invalidGroups,
      onConfirm: vi.fn(),
    });

    // No default selected + minSelections = 1 → invalid.
    const confirmBtn = screen.getByRole('button', { name: /Add to Order/ });
    expect(confirmBtn).toBeDisabled();
  });

  it('shows empty state when no modifier groups are provided', () => {
    renderModal({ groups: [] });
    expect(screen.getByText('No customisation options available')).toBeInTheDocument();
  });

  // ── Selection metadata ───────────────────────────────────────────

  it('calls onConfirm with correct modifier metadata including prices', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderModal({ onConfirm });

    // Select Rare (replaces Medium) and French Fries.
    await user.click(screen.getByTestId('modifier-mod-rare'));
    await user.click(screen.getByTestId('modifier-mod-fries'));

    await user.click(screen.getByRole('button', { name: /Add to Order/ }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            groupName: 'Doneness',
            modifierName: 'Rare',
            priceMinor: 0,
          }),
          expect.objectContaining({
            groupName: 'Add Sides',
            modifierName: 'French Fries',
            priceMinor: 5000,
          }),
        ]),
        155000,
      );
    });
  });

  // ── Close button ──

  it('calls onClose when the X close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });
    await user.click(screen.getByRole('button', { name: /Close/ }));
    expect(onClose).toHaveBeenCalled();
  });

  // ── Free / paid labels ──

  it('shows "Free" label for a selected zero-price modifier', async () => {
    const user = userEvent.setup();
    renderModal();
    // Rare has priceMinor = 0. Select it; Medium (also price=0) is deselected.
    await user.click(screen.getByTestId('modifier-mod-rare'));
    await waitFor(() => {
      // "Free" should appear inside the Rare button specifically.
      expect(screen.getByTestId('modifier-mod-rare').textContent).toContain('Free');
    });
  });

  it('shows price suffix for paid modifier options', () => {
    renderModal();
    // French Fries has priceMinor = 5000 → +Rp 5.000 (always visible)
    expect(screen.getByText(/5\.000/)).toBeInTheDocument();
  });

  // ── Add-ons row ──

  it('shows add-ons row when surcharge is present', async () => {
    const user = userEvent.setup();
    renderModal();
    // Select French Fries to add 5000 surcharge.
    await user.click(screen.getByTestId('modifier-mod-fries'));
    await waitFor(() => {
      expect(screen.getByText('Add-ons')).toBeInTheDocument();
    });
  });

  it('hides add-ons row when no surcharge applies', () => {
    renderModal();
    // Default selection (Medium, price=0) → no surcharge.
    expect(screen.queryByText('Add-ons')).not.toBeInTheDocument();
  });

  // ── Group count display ──

  it('displays "N required" when min equals max', () => {
    renderModal();
    // Doneness group: min=1, max=1 → "1 required"
    expect(screen.getByText('1 required')).toBeInTheDocument();
  });

  it('displays "N/M" format when min differs from max', () => {
    renderModal();
    // Sides group: min=0, max=2, initially 0 selected → "0/2"
    expect(screen.getByText('0/2')).toBeInTheDocument();
  });

  it('updates group count when selections change', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByTestId('modifier-mod-fries'));
    // Sides group: now 1 selected → "1/2"
    await waitFor(() => {
      expect(screen.getByText('1/2')).toBeInTheDocument();
    });
  });

  // ── Group count CSS classes ──

  it('applies valid CSS class when group selection is valid', () => {
    renderModal();
    // Doneness group has Medium selected → 1/1 → valid.
    const countEls = document.querySelectorAll('.modifier-group-count--valid');
    expect(countEls.length).toBeGreaterThanOrEqual(1);
  });

  it('applies invalid CSS class when group selection is invalid', () => {
    const invalidGroups: ModifierGroup[] = [{
      ...donenessGroup,
      minSelections: 1,
      maxSelections: 1,
      modifiers: donenessGroup.modifiers.map((m) => ({ ...m, isDefault: false })),
    }];
    renderModal({ groups: invalidGroups });
    // No default, min=1 → invalid.
    const countEls = document.querySelectorAll('.modifier-group-count--invalid');
    expect(countEls.length).toBeGreaterThanOrEqual(1);
  });

  // ── Modifier option CSS classes ──

  it('applies selected CSS class to chosen modifiers', () => {
    renderModal();
    // Medium is the default selection.
    const mediumBtn = screen.getByTestId('modifier-mod-medium');
    expect(mediumBtn.className).toContain('modifier-option--selected');
  });

  it('applies disabled CSS class to options at max selections', async () => {
    const user = userEvent.setup();
    renderModal();
    // Fill sides group (max=2) to block the 3rd option.
    await user.click(screen.getByTestId('modifier-mod-fries'));
    await user.click(screen.getByTestId('modifier-mod-salad'));
    await waitFor(() => {
      const onionBtn = screen.getByTestId('modifier-mod-onion');
      expect(onionBtn.className).toContain('modifier-option--disabled');
    });
  });

  it('does not apply disabled class before max is reached', () => {
    renderModal();
    // At 0 selections, all sides options should be enabled.
    const onionBtn = screen.getByTestId('modifier-mod-onion');
    expect(onionBtn.className).not.toContain('modifier-option--disabled');
  });

  // ── Aria attributes ──

  it('dialog has aria-modal="true"', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('dialog aria-label includes product name', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toHaveAttribute(
      'aria-label',
      'Customise Grilled Ribeye',
    );
  });

  // ── Overlay click behaviour ──

  it('does not call onClose when clicking inside the dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });
    // Click the dialog itself (not the backdrop).
    await user.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Confirm blocked when invalid ──

  it('does not call onConfirm when button is clicked while disabled', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const invalidGroups: ModifierGroup[] = [{
      ...donenessGroup,
      minSelections: 1,
      maxSelections: 1,
      modifiers: donenessGroup.modifiers.map((m) => ({ ...m, isDefault: false })),
    }];
    renderModal({ groups: invalidGroups, onConfirm });
    const confirmBtn = screen.getByRole('button', { name: /Add to Order/ });
    expect(confirmBtn).toBeDisabled();
    await user.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
