import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import inventoryFtl from '@/locales/inventory.ftl?raw';
import inventoryIdFtl from '@/locales/inventory.id.ftl?raw';
import LocationPicker from '@/features/inventory/LocationPicker';

// ── Mock auth and workspace contexts ───────────────────────────
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', display_name: 'Test User', role_name: 'cashier', session_token: 'mock-session-token' },
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: 'mock-session-token',
    activeInstance: { instance_id: 'inst-1', type_key: 'store-pos' },
    swapSessionToken: vi.fn(),
  }),
}));

// ── Mock API module ──────────────────────────────────────────────

const mockLocations = [
  { id: 'loc-warehouse', name: 'Warehouse A', type: 'warehouse', description: 'Main warehouse', is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  { id: 'loc-store', name: 'Store Front', type: 'store', description: 'Retail store', is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  { id: 'loc-transit', name: 'In Transit', type: 'transit', description: 'Transit hub', is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

const mockListLocations = vi.fn();
const mockGetWorkspaceLocations = vi.fn();

vi.mock('@/api/inventory', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@/api/inventory')>();
  return {
    ...actual,
    listInventoryLocations: (...args: unknown[]) => mockListLocations(...args),
    getWorkspaceLocations: (...args: unknown[]) => mockGetWorkspaceLocations(...args),
  };
});

describe('LocationPicker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockListLocations.mockResolvedValue(mockLocations);
    // Default: no workspace bindings → the picker falls back to the full
    // active list (LOC-08). LOC-08 tests override this with real bindings.
    mockGetWorkspaceLocations.mockResolvedValue([]);
  });

  // ── Renders trigger with current value ──────────────────────────

  it('renders the currently selected location name', async () => {
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  // ── Opens dropdown on click ───────────────────────────────────

  it('opens dropdown when trigger is clicked', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });
    expect(screen.getByText('Store Front')).toBeInTheDocument();
    expect(screen.getByText('In Transit')).toBeInTheDocument();
  });

  // ── Closes on outside click ─────────────────────────────────────

  it('closes dropdown on outside click', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Click outside the dropdown
    await user.click(document.body);
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    }, { timeout: 5000 });
  });

  // ── Closes on Escape ────────────────────────────────────────────

  it('closes dropdown on Escape key', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    }, { timeout: 5000 });
  });

  // ── Calls onChange with new location ────────────────────────────

  it('calls onChange with new location when option is clicked', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={handleChange} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('Store Front')).toBeInTheDocument();
    }, { timeout: 5000 });

    const storeOption = screen.getByRole('option', { name: /store front store/i });
    await user.click(storeOption);

    expect(handleChange).toHaveBeenCalledWith('loc-store', 'Store Front');
  });

  // ── Does not call onChange when same location is re-selected ──

  it('does not call onChange when same location is clicked', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={handleChange} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /warehouse a warehouse/i })).toBeInTheDocument();
    }, { timeout: 5000 });

    const sameOption = screen.getByRole('option', { name: /warehouse a warehouse/i });
    await user.click(sameOption);

    expect(handleChange).not.toHaveBeenCalled();
  });

  // ── Shows type metadata in dropdown ─────────────────────────────

  it('displays localized location type metadata in dropdown options', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);

    // Raw machine values (warehouse/store/transit) must never leak — the
    // en bundle renders capitalized Fluent labels instead (LOC-05).
    await waitFor(() => {
      expect(screen.getByText('Warehouse')).toBeInTheDocument();
      expect(screen.getByText('Store')).toBeInTheDocument();
      expect(screen.getByText('Transit')).toBeInTheDocument();
    }, { timeout: 5000 });
    expect(screen.queryByText('warehouse')).not.toBeInTheDocument();
    expect(screen.queryByText('store')).not.toBeInTheDocument();
  });

  it('renders Indonesian type labels from the id bundle', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={vi.fn()} />,
      inventoryIdFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    // The id bundle renders the trigger aria-label in Indonesian, so query by
    // the Indonesian label text rather than the English regex.
    const trigger = screen.getByRole('button', { name: /pilih lokasi inventaris/i });
    await user.click(trigger);

    // Indonesian bundle: warehouse → Gudang, store → Toko.
    await waitFor(() => {
      expect(screen.getByText('Gudang')).toBeInTheDocument();
      expect(screen.getByText('Toko')).toBeInTheDocument();
    }, { timeout: 5000 });
    expect(screen.queryByText('warehouse')).not.toBeInTheDocument();
  });

  // ── Highlights active location with aria-selected ──────────────

  it('marks active location with aria-selected', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);

    await waitFor(() => {
      const options = screen.getAllByRole('option');
      const activeOption = options.find((opt) => opt.getAttribute('aria-selected') === 'true');
      expect(activeOption).toBeDefined();
      expect(activeOption).toHaveTextContent('Warehouse A');
    }, { timeout: 5000 });
  });

  // ── Hides when no locations are loaded ─────────────────────────

  it('renders nothing when locations fail to load', async () => {
    mockListLocations.mockResolvedValue([]);
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={vi.fn()} />,
      inventoryFtl,
    );

    // Wait for the (empty) locations fetch to settle, then confirm the component hides itself
    await waitFor(() => {
      expect(mockListLocations).toHaveBeenCalled();
    }, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: /select inventory location/i })).not.toBeInTheDocument();
  });

  // ── Durable error state (INV-08) ───────────────────────────────

  it('shows a persistent error with retry when the locations fetch fails', async () => {
    // Fail the fetch SYNCHRONOUSLY: mockImplementationOnce that THROWS rather
    // than returning an already-rejected promise. load()'s try/catch then runs
    // inside the mount effect — inside the render act() boundary — and the
    // setLoadError/setLoading(false) updates commit before renderWithProviders
    // resolves. Returning a rejected promise made this test flaky under
    // --pool=forks shard load: the catch handler fired from a later microtask,
    // after the render's act() closed, and its state updates could be dropped
    // (error state never rendered) or leave overlapping act() state that
    // corrupted every test that followed in the file.
    mockListLocations.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    // `await` is required: renderWithProviders is async (it wraps the render
    // in `await act(...)`), and the error state only commits when that act
    // boundary flushes. Dropping the await made the alert assertion race the
    // still-pending act and leak it into the next tests (overlapping act
    // warnings + cascade failures).
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={vi.fn()} />,
      inventoryFtl,
    );

    // The error message (loc-picker-error-load = "Failed to load locations")
    // must render persistently instead of silently returning null.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Failed to load locations')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('recovers when Retry succeeds after a failed load', async () => {
    const user = userEvent.setup();
    // First fetch throws synchronously (error state committed inside the
    // mount act); the Retry fetch resolves with the real location list.
    mockListLocations
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockResolvedValueOnce(mockLocations);
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={vi.fn()} />,
      inventoryFtl,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /select inventory location/i })).toBeInTheDocument();
    }, { timeout: 10000 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // ── Listbox keyboard navigation (LOC-04) ───────────────────────
  //
  // NOTE: since LOC-09 the dropdown is ordered selected-first, then by name.
  // For value=loc-warehouse the order is [Warehouse A, In Transit, Store Front]
  // (index 0 / 1 / 2) — the keyboard tests below pin that ordering.

  it('moves the highlighted option with ArrowDown and selects with Enter', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={handleChange} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Open focuses the listbox; the current value is pre-highlighted (index 0).
    const listbox = screen.getByRole('listbox');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('location-picker-option-loc-warehouse');

    // ArrowDown → In Transit (index 1, selected-first ordering)
    await user.keyboard('{ArrowDown}');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('location-picker-option-loc-transit');

    // Enter selects it
    await user.keyboard('{Enter}');
    expect(handleChange).toHaveBeenCalledWith('loc-transit', 'In Transit');
  });

  it('wraps ArrowUp and jumps with Home/End', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={handleChange} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });

    const listbox = screen.getByRole('listbox');
    // Current value loc-warehouse is index 0 → pre-highlighted.
    expect(listbox.getAttribute('aria-activedescendant')).toBe('location-picker-option-loc-warehouse');

    // ArrowUp from the first option wraps to the last (index 2 = loc-store)
    await user.keyboard('{ArrowUp}');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('location-picker-option-loc-store');

    // Home jumps to the first option
    await user.keyboard('{Home}');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('location-picker-option-loc-warehouse');

    // End jumps to the last option
    await user.keyboard('{End}');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('location-picker-option-loc-store');

    // Space selects the highlighted option
    await user.keyboard(' ');
    expect(handleChange).toHaveBeenCalledWith('loc-store', 'Store Front');
  });

  // ── LOC-09: selected-first ordering + inline search ─────────────

  it('orders the dropdown selected-first, then by name', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <LocationPicker value="loc-store" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Store Front')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });

    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    // Selected location first, then the rest alphabetically:
    // [Store Front (selected), In Transit, Warehouse A]
    expect(options.map((o) => o.textContent)).toEqual([
      'Store FrontStore',
      'In TransitTransit',
      'Warehouse AWarehouse',
    ]);
  });

  it('shows an inline search field for large sets and filters options', async () => {
    const user = userEvent.setup();
    // LOC-09 SEARCH_THRESHOLD is 8 — feed a set large enough to surface the
    // search field.
    const manyLocations = Array.from({ length: 10 }, (_, i) => ({
      id: `loc-${i + 1}`,
      name: `Shelf ${i + 1}`,
      type: 'warehouse' as const,
      description: '',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }));
    mockListLocations.mockResolvedValue(manyLocations);
    await renderWithProviders(
      <LocationPicker value="loc-1" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Shelf 1')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });

    // The search field is present for a 10-location set and takes focus.
    const search = screen.getByRole('searchbox');
    expect(search).toHaveFocus();

    // Typing narrows the list to matching options only.
    await user.type(search, 'Shelf 7');
    const listbox = screen.getByRole('listbox');
    await waitFor(() => {
      const options = within(listbox).getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent('Shelf 7');
    }, { timeout: 5000 });
  });

  // Enter in the search field must commit the option the operator just filtered
  // down to. The document-level keydown handler already computed
  // `isSearchFocused` and used it to protect Space (:247) but never applied it
  // to Enter, and typing resets `activeIndex` to 0 (:393) while the SELECTION
  // still points at the old location — so Enter ran handleSelect on the row at
  // index 0, which for a one-row result set is the row itself, but for the
  // unfiltered list is the alphabetically first match, not what was typed.
  it('commits the searched location when Enter is pressed in the search field', async () => {
    const user = userEvent.setup();
    const manyLocations = Array.from({ length: 10 }, (_, i) => ({
      id: `loc-${i + 1}`,
      name: `Shelf ${i + 1}`,
      type: 'warehouse' as const,
      description: '',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }));
    mockListLocations.mockResolvedValue(manyLocations);
    const onChange = vi.fn();
    await renderWithProviders(
      <LocationPicker value="loc-1" onChange={onChange} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Shelf 1')).toBeInTheDocument();
    }, { timeout: 5000 });

    await user.click(screen.getByRole('button', { name: /select inventory location/i }));
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });

    const search = screen.getByRole('searchbox');
    await user.type(search, 'Shelf 7');
    await waitFor(() => {
      expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
    }, { timeout: 5000 });

    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('loc-7', 'Shelf 7');
    });
    // And the dropdown closes, the way choosing a row does.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows a no-results state when the search matches nothing', async () => {
    const user = userEvent.setup();
    const manyLocations = Array.from({ length: 9 }, (_, i) => ({
      id: `loc-${i + 1}`,
      name: `Shelf ${i + 1}`,
      type: 'warehouse' as const,
      description: '',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }));
    mockListLocations.mockResolvedValue(manyLocations);
    await renderWithProviders(
      <LocationPicker value="loc-1" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Shelf 1')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });

    await user.type(screen.getByRole('searchbox'), 'zzz-nonexistent');
    await waitFor(() => {
      expect(screen.getByText('No locations match your search.')).toBeInTheDocument();
    }, { timeout: 5000 });
    expect(within(screen.getByRole('listbox')).queryAllByRole('option')).toHaveLength(0);
  });

  it('lets Escape dismiss the dropdown from the no-results state', async () => {
    const user = userEvent.setup();
    const manyLocations = Array.from({ length: 9 }, (_, i) => ({
      id: `loc-${i + 1}`,
      name: `Shelf ${i + 1}`,
      type: 'warehouse' as const,
      description: '',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }));
    mockListLocations.mockResolvedValue(manyLocations);
    await renderWithProviders(
      <LocationPicker value="loc-1" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Shelf 1')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Drive the dropdown into the no-results state.
    await user.type(screen.getByRole('searchbox'), 'zzz-nonexistent');
    await waitFor(() => {
      expect(screen.getByText('No locations match your search.')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Escape must still close the dropdown even though no options are visible.
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    }, { timeout: 5000 });
    expect(trigger).toHaveFocus();
  });

  it('keeps the search hidden for small sets', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  // ── LOC-07: invalidation + out-of-order response guard ──────────
  //
  // These tests drive `refreshKey` through a stateful harness instead of RTL
  // `rerender()`: rerender replaces the WHOLE root element, which would drop
  // the Fluent LocalizationProvider / DefaultProviders wrapper and crash the
  // component (useLocalization has no context). The harness bumps a stateful
  // refreshKey the same way a real consumer would after a location mutation.

  // Hoisted so LocationPicker (a memo() component) never sees a fresh onChange
  // reference on every harness re-render (which would defeat memo short-circuit).
  const noopChange = vi.fn();

  function RefreshKeyHarness({
    onChange = noopChange,
  }: {
    onChange?: (locationId: string, locationName: string) => void;
  }) {
    const [refreshKey, setRefreshKey] = useState(0);
    return (
      <>
        <button type="button" onClick={() => setRefreshKey((k) => k + 1)}>
          bump-refresh
        </button>
        <LocationPicker
          value="loc-warehouse"
          onChange={onChange}
          refreshKey={refreshKey}
        />
      </>
    );
  }

  it('refetches locations when refreshKey is bumped (external invalidation)', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<RefreshKeyHarness />, inventoryFtl);

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });
    expect(mockListLocations).toHaveBeenCalledTimes(1);

    // A location is renamed elsewhere; the consumer bumps refreshKey and the
    // picker must reload to pick up the fresh list.
    mockListLocations.mockResolvedValue([
      { id: 'loc-warehouse', name: 'Warehouse A (renamed)', type: 'warehouse', description: '', is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ...mockLocations.slice(1),
    ]);
    await user.click(screen.getByRole('button', { name: 'bump-refresh' }));

    await waitFor(() => {
      expect(mockListLocations).toHaveBeenCalledTimes(2);
    }, { timeout: 5000 });
    await waitFor(() => {
      expect(screen.getByText('Warehouse A (renamed)')).toBeInTheDocument();
    }, { timeout: 5000 });
    expect(screen.queryByText('Warehouse A')).not.toBeInTheDocument();
  });

  it('guards against out-of-order responses (stale load never overwrites fresh)', async () => {
    const user = userEvent.setup();
    // Two overlapping loads: the SECOND resolves first, the FIRST resolves
    // last. Only the second (newest) result may be applied.
    let resolveFirst!: (v: typeof mockLocations) => void;
    let resolveSecond!: (v: typeof mockLocations) => void;
    const first = new Promise<typeof mockLocations>((r) => { resolveFirst = r; });
    const second = new Promise<typeof mockLocations>((r) => { resolveSecond = r; });

    mockListLocations
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    await renderWithProviders(<RefreshKeyHarness />, inventoryFtl);

    // First load is in flight.
    await waitFor(() => {
      expect(mockListLocations).toHaveBeenCalledTimes(1);
    }, { timeout: 5000 });

    // Bump refreshKey → second load starts.
    await user.click(screen.getByRole('button', { name: 'bump-refresh' }));
    await waitFor(() => {
      expect(mockListLocations).toHaveBeenCalledTimes(2);
    }, { timeout: 5000 });

    // The NEW request resolves first with the fresh list.
    await act(async () => {
      resolveSecond(mockLocations);
    });
    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    // The STALE first request resolves last with an outdated payload — the
    // seq guard must drop it.
    await act(async () => {
      resolveFirst([
        { id: 'loc-stale', name: 'Stale Warehouse', type: 'warehouse', description: '', is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ]);
    });
    expect(screen.queryByText('Stale Warehouse')).not.toBeInTheDocument();
    // The fresh list is still what's shown.
    expect(screen.getByText('Warehouse A')).toBeInTheDocument();
  });

  // ── LOC-08: workspace-bound picker source ───────────────────────

  it('scopes the dropdown to workspace bindings and shows policy badges', async () => {
    const user = userEvent.setup();
    // Only Store Front (primary) and In Transit (negative stock) are bound to
    // this workspace — Warehouse A is globally active but belongs to another
    // workspace's binding set, so it must NOT be offered here.
    mockGetWorkspaceLocations.mockResolvedValue([
      { location_id: 'loc-store', location_name: 'Store Front', is_primary: true, allow_negative_stock: false },
      { location_id: 'loc-transit', location_name: 'In Transit', is_primary: false, allow_negative_stock: true },
    ]);
    await renderWithProviders(
      <LocationPicker value="loc-store" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Store Front')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });

    const listbox = screen.getByRole('listbox');
    // Bound locations appear; the unbound Warehouse A must be absent.
    expect(within(listbox).getByText('Store Front')).toBeInTheDocument();
    expect(within(listbox).getByText('In Transit')).toBeInTheDocument();
    expect(within(listbox).queryByText('Warehouse A')).not.toBeInTheDocument();
    // Binding policy is surfaced: Primary badge + negative-stock badge.
    expect(within(listbox).getByText('Primary')).toBeInTheDocument();
    expect(within(listbox).getByText('Neg. stock')).toBeInTheDocument();
  });

  it('falls back to the full active list when the workspace has no bindings', async () => {
    const user = userEvent.setup();
    // Default mockGetWorkspaceLocations resolves [] → full list fallback.
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });

    const listbox = screen.getByRole('listbox');
    // Every globally-active location is offered (pre-binding fallback).
    expect(within(listbox).getByText('Warehouse A')).toBeInTheDocument();
    expect(within(listbox).getByText('Store Front')).toBeInTheDocument();
    expect(within(listbox).getByText('In Transit')).toBeInTheDocument();
    // No binding policy badges when the workspace declares none.
    expect(within(listbox).queryByText('Primary')).not.toBeInTheDocument();
    expect(within(listbox).queryByText('Neg. stock')).not.toBeInTheDocument();
  });

  it('restores focus to the trigger and closes on Escape', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <LocationPicker value="loc-warehouse" onChange={vi.fn()} />,
      inventoryFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    }, { timeout: 5000 });

    const trigger = screen.getByRole('button', { name: /select inventory location/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    }, { timeout: 5000 });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    }, { timeout: 5000 });
    expect(trigger).toHaveFocus();
  });
});
