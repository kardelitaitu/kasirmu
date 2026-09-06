import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import StoreSwitcher from '@/components/StoreSwitcher';
import sharedFtl from '@/locales/shared.ftl?raw';
import type { LocationProfile } from '@/api/locations';

const { mockListStores, mockSetPrimaryStore } = vi.hoisted(() => ({
  mockListStores: vi.fn(),
  mockSetPrimaryStore: vi.fn(),
}));

vi.mock('@/api/locations', () => ({
  listLocationsScoped: () => mockListStores(),
  setPrimaryLocationScoped: (_sessionToken: string, id: string) => mockSetPrimaryStore(id),
}));

// ADR #4 Phase 2b: StoreSwitcher now calls switchStore from WorkspaceContext.
const mockSwitchStore = vi.fn();
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    switchStore: mockSwitchStore,
    resolvedStoreId: 'default',
    activeWorkspace: null,
    activeInstance: null,
    setActiveWorkspace: vi.fn(),
    setActiveInstance: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    error: null,
    retry: vi.fn(),
    lastWorkspace: null,
  }),
}));

// ── Fluent setup ────────────────────────────────────────────────────

const bundle = new FluentBundle('en-US');
bundle.addResource(new FluentResource(sharedFtl));
const l10n = new ReactLocalization([bundle]);

function renderComponent() {
  return render(
    <LocalizationProvider l10n={l10n}>
      <StoreSwitcher />
    </LocalizationProvider>,
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeStore(overrides: Partial<LocationProfile> = {}): LocationProfile {
  return {
    id: 'store-1',
    name: 'Main Store',
    address: '123 Main St',
    tax_id: '',
    currency: 'IDR',
    timezone: 'Asia/Jakarta',
    is_primary: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('StoreSwitcher', () => {
  beforeEach(() => {
    mockListStores.mockResolvedValue([]);
    mockSetPrimaryStore.mockResolvedValue(makeStore());
    mockSwitchStore.mockImplementation(() => {});
  });

  // ── Null states ────────────────────────────────────────────────

  it('returns null during loading', () => {
    mockListStores.mockReturnValue(new Promise(() => {}));
    const { container } = renderComponent();
    expect(container.textContent).toBe('');
  });

  it('returns null when no stores', async () => {
    mockListStores.mockResolvedValue([]);
    const { container } = renderComponent();
    await waitFor(() => {
      expect(mockListStores).toHaveBeenCalled();
    });
    expect(container.textContent).toBe('');
  });

  it('returns null when only one store', async () => {
    mockListStores.mockResolvedValue([makeStore()]);
    const { container } = renderComponent();
    await waitFor(() => {
      expect(mockListStores).toHaveBeenCalled();
    });
    expect(container.textContent).toBe('');
  });

  // ── Rendering ──────────────────────────────────────────────────

  it('renders trigger button with primary store name when 2+ stores', async () => {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'HQ', is_primary: true }),
      makeStore({ id: 'store-2', name: 'Branch A', is_primary: false }),
    ]);
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('HQ')).toBeDefined();
    });
  });

  it('renders first store name when none marked primary', async () => {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'Store Alpha', is_primary: false }),
      makeStore({ id: 'store-2', name: 'Store Beta', is_primary: false }),
    ]);
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Store Alpha')).toBeDefined();
    });
  });

  // ── Dropdown toggle ───────────────────────────────────────────

  it('opens dropdown on trigger click', async () => {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'HQ', is_primary: true }),
      makeStore({ id: 'store-2', name: 'Branch', is_primary: false }),
    ]);
    renderComponent();

    await waitFor(() => expect(screen.getByText('HQ')).toBeDefined());

    await userEvent.click(screen.getByText('HQ').closest('button')!);

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeDefined();
    });
  });

  it('closes dropdown on second trigger click', async () => {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'HQ', is_primary: true }),
      makeStore({ id: 'store-2', name: 'Branch', is_primary: false }),
    ]);
    renderComponent();

    await waitFor(() => expect(screen.getByText('HQ')).toBeDefined());

    const trigger = screen.getByText('HQ').closest('button')!;
    await userEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeDefined());
    await userEvent.click(trigger);

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });

  // ── Dropdown content ──────────────────────────────────────────

  it('shows all stores in dropdown with names and currencies', async () => {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'HQ', currency: 'IDR', is_primary: true }),
      makeStore({ id: 'store-2', name: 'Branch A', currency: 'USD', is_primary: false }),
      makeStore({ id: 'store-3', name: 'Branch B', currency: 'EUR', is_primary: false }),
    ]);
    renderComponent();

    await waitFor(() => expect(screen.getByText('HQ')).toBeDefined());
    await userEvent.click(screen.getByText('HQ').closest('button')!);

    await waitFor(() => {
      expect(screen.getByText('Branch A')).toBeDefined();
      expect(screen.getByText('Branch B')).toBeDefined();
    });
  });

  it('highlights primary store with active class', async () => {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'HQ', is_primary: true }),
      makeStore({ id: 'store-2', name: 'Branch', is_primary: false }),
    ]);
    renderComponent();

    await waitFor(() => expect(screen.getByText('HQ')).toBeDefined());
    await userEvent.click(screen.getByText('HQ').closest('button')!);

    await waitFor(() => {
      const options = screen.getAllByRole('option');
      const primaryOption = options.find(
        (o) => o.getAttribute('aria-selected') === 'true',
      );
      expect(primaryOption).toBeDefined();
      expect(primaryOption?.classList.contains('store-switcher-option--active')).toBe(true);
    });
  });

  // ── Store selection ───────────────────────────────────────────

  it('calls setPrimaryStore when selecting a different store', async () => {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'HQ', is_primary: true }),
      makeStore({ id: 'store-2', name: 'Branch', is_primary: false }),
    ]);
    renderComponent();

    await waitFor(() => expect(screen.getByText('HQ')).toBeDefined());
    await userEvent.click(screen.getByText('HQ').closest('button')!);

    await waitFor(() => expect(screen.getByText('Branch')).toBeDefined());
    await userEvent.click(screen.getByText('Branch').closest('button')!);

    await waitFor(() => {
      expect(mockSetPrimaryStore).toHaveBeenCalledWith('store-2');
    });
  });

  it('does not call setPrimaryStore when clicking already-primary store', async () => {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'HQ', is_primary: true }),
      makeStore({ id: 'store-2', name: 'Branch', is_primary: false }),
    ]);
    renderComponent();

    await waitFor(() => expect(screen.getByText('HQ')).toBeDefined());
    await userEvent.click(screen.getByText('HQ').closest('button')!);

    await waitFor(() => expect(screen.getByRole('listbox')).toBeDefined());
    // Click the already-primary store option
    const options = screen.getAllByRole('option');
    const primaryOption = options.find(
      (o) => o.getAttribute('aria-selected') === 'true',
    )!;
    await userEvent.click(primaryOption);

    expect(mockSetPrimaryStore).not.toHaveBeenCalled();
  });

  it('calls switchStore from WorkspaceContext after switching stores', async () => {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'HQ', is_primary: true }),
      makeStore({ id: 'store-2', name: 'Branch', is_primary: false }),
    ]);
    renderComponent();

    await waitFor(() => expect(screen.getByText('HQ')).toBeDefined());
    await userEvent.click(screen.getByText('HQ').closest('button')!);

    await waitFor(() => expect(screen.getByText('Branch')).toBeDefined());
    await userEvent.click(screen.getByText('Branch').closest('button')!);

    await waitFor(() => {
      // ADR #4 Phase 2b: switchStore should be called with the new store ID.
      expect(mockSwitchStore).toHaveBeenCalledWith('store-2');
    });
  });

  it('closes dropdown after selecting a store', async () => {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'HQ', is_primary: true }),
      makeStore({ id: 'store-2', name: 'Branch', is_primary: false }),
    ]);
    renderComponent();

    await waitFor(() => expect(screen.getByText('HQ')).toBeDefined());
    await userEvent.click(screen.getByText('HQ').closest('button')!);

    await waitFor(() => expect(screen.getByText('Branch')).toBeDefined());
    await userEvent.click(screen.getByText('Branch').closest('button')!);

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });

  // ── Outside click ─────────────────────────────────────────────

  it('closes dropdown on outside mousedown', async () => {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'HQ', is_primary: true }),
      makeStore({ id: 'store-2', name: 'Branch', is_primary: false }),
    ]);
    renderComponent();

    await waitFor(() => expect(screen.getByText('HQ')).toBeDefined());
    await userEvent.click(screen.getByText('HQ').closest('button')!);

    await waitFor(() => expect(screen.getByRole('listbox')).toBeDefined());

    // Click outside the switcher
    await userEvent.click(document.body);

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });

  // ── ARIA ──────────────────────────────────────────────────────

  it('trigger button has correct aria attributes', async () => {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'HQ', is_primary: true }),
      makeStore({ id: 'store-2', name: 'Branch', is_primary: false }),
    ]);
    renderComponent();

    await waitFor(() => expect(screen.getByText('HQ')).toBeDefined());

    const trigger = screen.getByText('HQ').closest('button')!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe('store-switcher-listbox');

    await userEvent.click(trigger);

    await waitFor(() => {
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });
  });

  // ── A11Y-05: listbox keyboard navigation ───────────────────────
  // Mirrors the LOC-04 pattern from LocationPicker: ArrowUp/Down wrap through
  // options, Home/End jump, Enter/Space selects the active option, Escape
  // closes and restores focus to the trigger, and aria-activedescendant
  // tracks the highlighted option.

  async function openListbox() {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'HQ', is_primary: true }),
      makeStore({ id: 'store-2', name: 'Branch A', is_primary: false }),
      makeStore({ id: 'store-3', name: 'Branch B', is_primary: false }),
    ]);
    renderComponent();
    await waitFor(() => expect(screen.getByText('HQ')).toBeDefined());
    await userEvent.click(screen.getByText('HQ').closest('button')!);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeDefined());
  }

  it('moves focus to the listbox when opened', async () => {
    await openListbox();
    expect(screen.getByRole('listbox')).toHaveFocus();
  });

  it('highlights the primary store on open via aria-activedescendant', async () => {
    await openListbox();
    const listbox = screen.getByRole('listbox');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('store-switcher-option-store-1');
  });

  it('moves the active descendant with ArrowDown (wrapping)', async () => {
    await openListbox();
    const listbox = screen.getByRole('listbox');

    await userEvent.keyboard('{ArrowDown}');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('store-switcher-option-store-2');

    await userEvent.keyboard('{ArrowDown}');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('store-switcher-option-store-3');

    // Wrap to the first option.
    await userEvent.keyboard('{ArrowDown}');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('store-switcher-option-store-1');
  });

  it('moves the active descendant with ArrowUp (wrapping)', async () => {
    await openListbox();
    const listbox = screen.getByRole('listbox');

    await userEvent.keyboard('{ArrowUp}');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('store-switcher-option-store-3');

    await userEvent.keyboard('{ArrowUp}');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('store-switcher-option-store-2');
  });

  it('jumps to the first option with Home and the last with End', async () => {
    await openListbox();
    const listbox = screen.getByRole('listbox');

    await userEvent.keyboard('{End}');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('store-switcher-option-store-3');

    await userEvent.keyboard('{Home}');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('store-switcher-option-store-1');
  });

  it('selects the active option with Enter', async () => {
    await openListbox();

    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockSetPrimaryStore).toHaveBeenCalledWith('store-3');
    });
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });

  it('selects the active option with Space', async () => {
    await openListbox();

    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard(' ');

    await waitFor(() => {
      expect(mockSetPrimaryStore).toHaveBeenCalledWith('store-2');
    });
  });

  it('closes with Escape and restores focus to the trigger', async () => {
    await openListbox();
    // The dropdown is open, so 'HQ' appears twice (trigger + option). The
    // trigger is the only role="button" — options use role="option".
    const trigger = screen.getByRole('button', { name: /HQ/ });

    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
    expect(trigger).toHaveFocus();
  });

  it('highlights the active option with the highlighted class', async () => {
    await openListbox();

    await userEvent.keyboard('{ArrowDown}');
    const options = screen.getAllByRole('option');
    const highlighted = options.find((o) =>
      o.classList.contains('store-switcher-option--highlighted'),
    );
    expect(highlighted).toBeDefined();
    expect(highlighted?.textContent).toContain('Branch A');
  });
});
