// ── NodeTopologyEditor — Branch Location timezone select (slice-4) ──
//
// ADR #48 Decision 2: the regional editor offers a bounded preset list of
// the three Indonesian IANA zones (Asia/Jakarta, Asia/Makassar,
// Asia/Jayapura) — a native select, no free-text entry, no search box.
// The server write boundary (update_location_profile_scoped, 08faea6f0)
// fail-closes on anything outside that list except the legacy UTC
// column-default sentinel, so these tests pin the client to the same
// contract: the three options render (from the real Fluent bundle), the
// write path carries the selected zone, and a legacy-sentinel row shows a
// disabled placeholder the user cannot save as an empty value.
//
// Standalone file (not appended to the 11k-line NodeTopologyEditor.test.tsx)
// so the active topology stream and this regional slice never race on one
// test module. Seeding mirrors that file's proven pattern: pass the seed
// through the real useTopologyEditorGraph when the editor mounts empty.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import NodeTopologyEditor from '../features/locations/NodeTopologyEditor';
import type * as locationsApi from '@/api/locations';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import type * as nodeTopologyEditorState from '../features/locations/nodeTopologyEditorState';
import type * as topologyApi from '@/api/topology';

vi.mock('@/api/topology', async () => {
  const actual = await vi.importActual<typeof topologyApi>('@/api/topology');
  return { ...actual, loadTopology: vi.fn(() => Promise.resolve(null)) };
});

const { mockGetProfile, mockUpdateProfile } = vi.hoisted(() => ({
  mockGetProfile: vi.fn(),
  mockUpdateProfile: vi.fn(),
}));
vi.mock('@/api/locations', async () => {
  const actual = await vi.importActual<typeof locationsApi>('@/api/locations');
  return {
    ...actual,
    getLocationProfileScoped: (...args: unknown[]) => mockGetProfile(...args),
    updateLocationProfileScoped: (...args: unknown[]) => mockUpdateProfile(...args),
  };
});

// BranchLocationFields is mounted with sessionToken from the workspace
// context; without a token the profile section stays in its loading state
// and the select never renders.
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'test-session-token', resolvedStoreId: 'store-1' }),
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      receipt: { showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '', paperWidth: 'standard', showTableNumber: false, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 },
      store: { name: 'Test Store', address: '', taxId: '', currency: 'IDR', branch: '' },
      sync: { serverUrl: null, hasApiKey: false, enabled: false },
      brand: { colour: '#147EFB', storeName: 'Test Store' },
      preferences: { cardSize: 0, fontSize: 0, fontSmoothing: 'antialiased' },
      currencies: [],
      appVersion: '0.0.37',
    },
    loading: false,
    error: null,
    hasPartialError: false,
    refetch: vi.fn(),
    lastChangedKeys: [],
    markSettingsUpdated: vi.fn(),
  }),
}));

// One Branch Location node on the canvas; clicking its card opens the
// inspector drawer, which mounts the lazy profile fields.
const STORE_SEED = {
  nodes: [{ id: 'store-1', type: 'store', name: 'Downtown Branch', x: 80, y: 140 }],
  wires: [] as unknown[],
};
vi.mock('../features/locations/nodeTopologyEditorState', async () => {
  const actual = await vi.importActual<typeof nodeTopologyEditorState>(
    '../features/locations/nodeTopologyEditorState',
  );
  return {
    ...actual,
    useTopologyEditorGraph: (initialNodes: unknown[], initialWires: unknown[]) =>
      actual.useTopologyEditorGraph(
        initialNodes.length > 0 ? initialNodes : STORE_SEED.nodes,
        initialWires.length > 0 ? initialWires : STORE_SEED.wires,
      ),
  };
});

const makeProfile = (timezone: string) => ({
  id: 'store-1',
  name: 'Downtown Branch',
  address: 'Jl. Sudirman 1',
  tax_id: '',
  currency: 'USD',
  timezone,
  is_primary: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const renderWithStoreSelected = () => {
  renderWithProvidersSync(<NodeTopologyEditor currentTier="plus" />, multiStoreFtl, sharedFtl);
  const storeCard = document.querySelector('.node-type-store');
  expect(storeCard).not.toBeNull();
  fireEvent.mouseDown(storeCard as Element, { button: 0 });
};

const getTimezoneSelect = () =>
  screen.getByRole('combobox', { name: 'Timezone' }) as HTMLSelectElement;

describe('NodeTopologyEditor — Branch Location timezone select (ADR #48 Decision 2)', () => {
  beforeEach(() => {
    mockGetProfile.mockReset();
    mockUpdateProfile.mockReset();
    mockGetProfile.mockResolvedValue(makeProfile('Asia/Jakarta'));
    mockUpdateProfile.mockImplementation(
      (_token: string, args: Record<string, unknown>) =>
        Promise.resolve({ ...makeProfile('Asia/Jakarta'), ...args }),
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('renders exactly the three Indonesian IANA preset options', async () => {
    renderWithStoreSelected();

    const select = await waitFor(() => {
      const el = getTimezoneSelect();
      expect(el.options).toHaveLength(3);
      return el;
    });

    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'Asia/Jakarta',
      'Asia/Makassar',
      'Asia/Jayapura',
    ]);
    // Labels resolve from the real multi-location.ftl bundle (WIB/WITA/WIT
    // with UTC offsets), proving the Fluent keys exist.
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Asia/Jakarta (WIB, +07:00)',
      'Asia/Makassar (WITA, +08:00)',
      'Asia/Jayapura (WIT, +09:00)',
    ]);
    expect(select.value).toBe('Asia/Jakarta');
  });

  it('legacy UTC sentinel rows show a disabled placeholder, not a fake preset', async () => {
    mockGetProfile.mockResolvedValue(makeProfile('UTC'));
    renderWithStoreSelected();

    const select = await waitFor(() => {
      const el = getTimezoneSelect();
      expect(el.options).toHaveLength(4);
      return el;
    });

    const placeholder = select.options[0];
    expect(placeholder?.value).toBe('');
    expect(placeholder?.disabled).toBe(true);
    // The un-migrated row displays "Select a timezone…" rather than a zone
    // it does not actually have; the presets stay fully selectable.
    expect(select.value).toBe('');
    expect(select.options[1]?.value).toBe('Asia/Jakarta');
    expect(select.options[2]?.value).toBe('Asia/Makassar');
    expect(select.options[3]?.value).toBe('Asia/Jayapura');
  });

  it('writes the selected preset zone through updateLocationProfileScoped', async () => {
    renderWithStoreSelected();

    const select = await waitFor(() => getTimezoneSelect());
    fireEvent.change(select, { target: { value: 'Asia/Makassar' } });
    fireEvent.blur(select);

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      'test-session-token',
      expect.objectContaining({ id: 'store-1', timezone: 'Asia/Makassar' }),
    );
    // The scoped write is a full-overwrite payload: non-timezone fields ride
    // along unchanged, exactly as the server contract expects.
    const payload = (mockUpdateProfile.mock.calls[0]?.[1] ?? {}) as { timezone: string; address: string; currency: string };
    expect(payload.timezone).toBe('Asia/Makassar');
    expect(payload.address).toBe('Jl. Sudirman 1');
    expect(payload.currency).toBe('USD');
  });

  it('refuses to send a non-preset value (client-side fail-closed guard)', async () => {
    renderWithStoreSelected();

    const select = await waitFor(() => getTimezoneSelect());
    // The placeholder is disabled, so a user cannot reach this; fire the
    // change programmatically to pin the guard against a regression that
    // would let an empty/unparseable zone reach the write boundary.
    fireEvent.change(select, { target: { value: '' } });
    fireEvent.blur(select);

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    // The controlled select snapped back to the stored preset.
    expect(select.value).toBe('Asia/Jakarta');
  });
});
