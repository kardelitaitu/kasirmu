/**
 * useStoreDraft - the store-identity draft contract.
 *
 * This hook had NO dedicated suite: 174 lines owning the store draft, the two
 * field validators, `isDirty` and the persist call, written to restore the half
 * of Settings -> General that the flat-IA rebuild removed ("inputs left the
 * page"). Its ONLY indirect exercise was 22 `it.skip` cases in
 * CloudSyncSettings.test.tsx that mount the whole page and fail on a navigation
 * step the rebuild deleted, so the layer below GeneralSection was ungraded.
 *
 * Why the hook is testable where the page was not: every dependency is a
 * module-scope mock or a context whose shape is one object, so a case here is a
 * statement about a VALUE (what Save tried to persist, what a validator decided)
 * rather than about which IPC command happened to run.
 *
 * The properties worth pinning, all of them silent-failure shaped:
 *   1. Validation is minimal ON PURPOSE -- the two constraints the original form
 *      surfaced. Inventing more would emit copy the bundles do not carry.
 *   2. `isDirty` compares ALL FIVE fields, so editing anything but the name is
 *      still a pending write.
 *   3. A failed save is not a successful one: the draft stays, and the toast is
 *      an error.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import type { StoreSettingsDto } from '@/api/settings';
import type { CurrencyDto } from '@/api/currency';

// ── module-scope fakes ─────────────────────────────────────────────────
const api = vi.hoisted(() => ({ setStore: vi.fn() }));

vi.mock('@/api/settings', () => ({
  setStoreSettingsScoped: (...a: unknown[]) => api.setStore(...a),
}));

// ── context fakes ──────────────────────────────────────────────────────
const ctx = vi.hoisted(() => ({
  sessionToken: 'tok-1' as string | null,
  contextStore: null as StoreSettingsDto | null,
  currencies: [] as CurrencyDto[],
  markSettingsUpdated: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: ctx.sessionToken }),
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: ctx.contextStore
      ? { store: ctx.contextStore, currencies: ctx.currencies }
      : { store: undefined, currencies: ctx.currencies },
    markSettingsUpdated: ctx.markSettingsUpdated,
  }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: ctx.addToast }),
}));

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({ l10n: { getString: (id: string) => id } }),
}));

import { useStoreDraft } from '../hooks/useStoreDraft';

// ── fixtures ───────────────────────────────────────────────────────────
const SEEDED: StoreSettingsDto = {
  name: 'Warung A',
  address: 'Jl. Lama 1',
  taxId: 'TAX-001',
  currency: 'IDR',
  branch: 'A-1',
};

const USD: CurrencyDto = { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' };
const IDR: CurrencyDto = { code: 'IDR', name: 'Rupiah', minor_exponent: 0, symbol: 'Rp' };

beforeEach(() => {
  vi.clearAllMocks();
  ctx.sessionToken = 'tok-1';
  ctx.contextStore = SEEDED;
  ctx.currencies = [IDR, USD];
  api.setStore.mockResolvedValue(undefined);
});

function mount() {
  return renderHook(() => useStoreDraft());
}

// ── 1. seeding ─────────────────────────────────────────────────────────

describe('seeding from the context read', () => {
  it('seeds every field from the context store', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    expect(result.current.store.address).toBe('Jl. Lama 1');
    expect(result.current.store.taxId).toBe('TAX-001');
    expect(result.current.store.currency).toBe('IDR');
    expect(result.current.store.branch).toBe('A-1');
  });

  it('is not dirty immediately after seeding', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    expect(result.current.isDirty).toBe(false);
  });

  it('exposes an empty currency list when the context read has none, never a crash', () => {
    ctx.contextStore = null;
    ctx.currencies = [];
    const { result } = mount();
    // An unread picker, not an undefined one: the section maps over this.
    expect(result.current.currencies).toEqual([]);
  });

  it('exposes the context currencies once present', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    expect(result.current.currencies).toEqual([IDR, USD]);
  });

  it('coerces a null field in the read into an empty string, not undefined', async () => {
    // Every read is coerced before it reaches the render: a transport resolving
    // undefined must not become an uncontrolled input.
    ctx.contextStore = { ...SEEDED, address: undefined as unknown as string };
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    expect(result.current.store.address).toBe('');
  });
});

// ── 2. editing and isDirty ─────────────────────────────────────────────

describe('editing', () => {
  it('sets one field without disturbing the others', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    act(() => result.current.setField('branch', 'B-9'));
    expect(result.current.store.branch).toBe('B-9');
    expect(result.current.store.name).toBe('Warung A');
  });

  it('becomes dirty when a non-name field is edited', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    // isDirty compares ALL FIVE fields; a branch-only edit is still a pending write.
    act(() => result.current.setField('branch', 'B-9'));
    expect(result.current.isDirty).toBe(true);
  });

  it('becomes dirty when the currency changes', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    act(() => result.current.setField('currency', 'USD'));
    expect(result.current.isDirty).toBe(true);
  });
});

// ── 3. validation ──────────────────────────────────────────────────────

describe('validateField', () => {
  it('flags an empty store name after trimming', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    act(() => result.current.validateField('store-name', '   '));
    expect(result.current.fieldErrors['store-name']).toBe('settings-store-name-required');
  });

  it('accepts a non-empty store name', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    act(() => result.current.validateField('store-name', 'Warung B'));
    expect(result.current.fieldErrors).not.toHaveProperty('store-name');
  });

  it('flags a tax id outside the declared pattern', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    act(() => result.current.validateField('tax-id', 'has space!'));
    expect(result.current.fieldErrors['tax-id']).toBe('settings-tax-id-pattern-hint');
  });

  it('accepts a tax id using the pattern characters', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    act(() => result.current.validateField('tax-id', 'AB-12/3.4'));
    expect(result.current.fieldErrors).not.toHaveProperty('tax-id');
  });

  it('treats an EMPTY tax id as valid, not as a pattern failure', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    // An optional field: blank must not raise the malformed-value hint.
    // NOTE: the hook guards this twice -- `value !== ''` AND the pattern, whose
    // trailing `*` already matches the empty string. Deleting the first guard
    // changes nothing, so no test can kill it (proven by mutation); this case
    // pins the BEHAVIOUR, which survives either way. Recorded so nobody reads a
    // green suite as proof that both guards are load-bearing.
    act(() => result.current.validateField('tax-id', ''));
    expect(result.current.fieldErrors).not.toHaveProperty('tax-id');
  });

  it('clears a previously-raised error when the value becomes valid', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    act(() => result.current.validateField('store-name', ''));
    expect(result.current.fieldErrors).toHaveProperty('store-name');
    act(() => result.current.validateField('store-name', 'Warung B'));
    expect(result.current.fieldErrors).not.toHaveProperty('store-name');
  });

  it('does not raise an error for a field it does not validate', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    // Only the two original constraints exist; inventing more would add copy the
    // bundles do not carry.
    act(() => result.current.validateField('address', ''));
    expect(result.current.fieldErrors).toEqual({});
  });
});

describe('clearFieldError', () => {
  it('removes one error and leaves the other', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    act(() => result.current.validateField('store-name', ''));
    act(() => result.current.validateField('tax-id', 'bad value'));
    expect(Object.keys(result.current.fieldErrors).sort()).toEqual(['store-name', 'tax-id']);

    act(() => result.current.clearFieldError('store-name'));
    expect(result.current.fieldErrors).toEqual({ 'tax-id': 'settings-tax-id-pattern-hint' });
  });

  it('is a no-op for a field with no error', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    act(() => result.current.clearFieldError('store-name'));
    expect(result.current.fieldErrors).toEqual({});
  });
});

// ── 4. save ────────────────────────────────────────────────────────────

describe('save', () => {
  it('persists the whole draft under the session token', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    act(() => result.current.setField('branch', 'B-9'));

    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.save(); });

    expect(ok).toBe(true);
    expect(api.setStore).toHaveBeenCalledWith('tok-1', expect.objectContaining({ name: 'Warung A', branch: 'B-9' }));
  });

  it('tells the context which store keys changed so every consumer refetches', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    await act(async () => { await result.current.save(); });
    expect(ctx.markSettingsUpdated).toHaveBeenCalledWith([
      'store.name', 'store.address', 'store.taxId', 'store.branch', 'store.currency',
    ]);
  });

  it('reports success through the toast', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    act(() => result.current.setField('branch', 'B-9'));

    await act(async () => { await result.current.save(); });

    expect(ctx.addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('stays dirty after a successful save until the CONTEXT re-reports', async () => {
    // `savedKey` is derived from `settings.store`, NOT from a post-write ref --
    // unlike useDataSyncDraft, which snapshots a savedRef. So a write alone does
    // not clear the flag: the contract is that markSettingsUpdated triggers a
    // refetch and the re-seed is what settles it. Measured here so the two
    // hooks' differing designs cannot silently converge on one.
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    act(() => result.current.setField('branch', 'B-9'));

    await act(async () => { await result.current.save(); });

    expect(result.current.isDirty).toBe(true);
    expect(ctx.markSettingsUpdated).toHaveBeenCalled();
  });

  it('returns false and keeps the draft when the write fails', async () => {
    api.setStore.mockRejectedValue(new Error('disk full'));
    const { result } = mount();
    await waitFor(() => expect(result.current.store.name).toBe('Warung A'));
    act(() => result.current.setField('name', 'Warung B'));

    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.save(); });

    expect(ok).toBe(false);
    // A failed write must not look like a successful one, and must not discard
    // what the user typed.
    expect(result.current.store.name).toBe('Warung B');
    expect(result.current.isDirty).toBe(true);
    expect(ctx.addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(ctx.markSettingsUpdated).not.toHaveBeenCalled();
  });

  it('with no session token reaches no door and reports failure', async () => {
    ctx.sessionToken = null;
    const { result } = mount();

    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.save(); });

    expect(ok).toBe(false);
    expect(api.setStore).not.toHaveBeenCalled();
    expect(ctx.markSettingsUpdated).not.toHaveBeenCalled();
  });
});

// ── 5. input attributes ────────────────────────────────────────────────

describe('cmInput', () => {
  it('spreads the attributes that keep a POS keyboard from fighting the form', () => {
    const { result } = mount();
    expect(result.current.cmInput).toMatchObject({
      autoComplete: 'off',
      autoCorrect: 'off',
      spellCheck: false,
    });
  });
});
