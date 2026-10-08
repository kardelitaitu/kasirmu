// ── useStoreDraft ──────────────────────────────────────────────────
//
// Restores the half of the store-identity form that the flat-IA rebuild
// removed: the props GeneralSection has always taken but nothing has supplied
// since (see the hook's own header, and `git grep validateField` — the prop
// type and two call sites, no definition).
//
// The cases below pin the four behaviours the section depends on: the draft
// seeds from the context read, a change clears that field's error, blur
// validates, and save writes the draft and asks the context to refetch.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const markSettingsUpdated = vi.fn();
const addToast = vi.fn();
let contextStore = { name: 'Test Store', address: 'A', taxId: '12-3456789', currency: 'IDR', branch: 'Main' };

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: { store: contextStore, currencies: [], receipt: {}, sync: {}, brand: {}, preferences: {} },
    loading: false,
    error: null,
    hasPartialError: false,
    refetch: vi.fn(),
    lastChangedKeys: [],
    markSettingsUpdated,
  }),
  SettingsProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok', switchStore: vi.fn() }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

import { LocalizationProvider } from '@fluent/react';
import { createEnUsLocalization } from '@/i18n/createEnUsLocalization';
import { useStoreDraft } from '@/features/settings/hooks/useStoreDraft';

const wrapper = ({ children }: { children: ReactNode }) => (
  <LocalizationProvider l10n={createEnUsLocalization()}>{children}</LocalizationProvider>
);

describe('useStoreDraft', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    markSettingsUpdated.mockClear();
    addToast.mockClear();
    contextStore = { name: 'Test Store', address: 'A', taxId: '12-3456789', currency: 'IDR', branch: 'Main' };
  });

  it('seeds the draft from the context store read', async () => {
    const { result } = renderHook(() => useStoreDraft(), { wrapper });
    await waitFor(() => expect(result.current.store.name).toBe('Test Store'));
    expect(result.current.store.taxId).toBe('12-3456789');
    expect(result.current.isDirty).toBe(false);
  });

  it('setField updates one field and marks the draft dirty', async () => {
    const { result } = renderHook(() => useStoreDraft(), { wrapper });
    await waitFor(() => expect(result.current.store.name).toBe('Test Store'));

    act(() => { result.current.setField('name', 'Renamed'); });

    expect(result.current.store.name).toBe('Renamed');
    expect(result.current.store.address).toBe('A'); // siblings untouched
    expect(result.current.isDirty).toBe(true);
  });

  it('validates a blank store name on blur, and clears the error on change', async () => {
    const { result } = renderHook(() => useStoreDraft(), { wrapper });
    await waitFor(() => expect(result.current.store.name).toBe('Test Store'));

    act(() => { result.current.validateField('store-name', '   '); });
    expect(result.current.fieldErrors['store-name']).toBeTruthy();

    act(() => { result.current.clearFieldError('store-name'); });
    expect(result.current.fieldErrors['store-name']).toBeUndefined();
  });

  it('accepts a valid name and a well-formed tax id without an error', async () => {
    const { result } = renderHook(() => useStoreDraft(), { wrapper });
    await waitFor(() => expect(result.current.store.name).toBe('Test Store'));

    act(() => {
      result.current.validateField('store-name', 'Fine');
      result.current.validateField('tax-id', '12-3456789');
    });
    expect(result.current.fieldErrors).toEqual({});
  });

  it('rejects a tax id outside the pattern the input declares', async () => {
    const { result } = renderHook(() => useStoreDraft(), { wrapper });
    await waitFor(() => expect(result.current.store.name).toBe('Test Store'));

    act(() => { result.current.validateField('tax-id', 'bad id!'); });
    expect(result.current.fieldErrors['tax-id']).toBeTruthy();
  });

  it('save writes the draft through the scoped command and asks the context to refetch', async () => {
    const { result } = renderHook(() => useStoreDraft(), { wrapper });
    await waitFor(() => expect(result.current.store.name).toBe('Test Store'));

    act(() => { result.current.setField('name', 'Saved Name'); });

    let ok = false;
    await act(async () => { ok = await result.current.save(); });

    expect(ok).toBe(true);
    // The scoped store command carries the session token and the draft.
    const call = invokeMock.mock.calls.find((c) => String(c[0]).includes('set_store_settings'));
    expect(call, 'expected a set_store_settings* invoke').toBeTruthy();
    expect(JSON.stringify(call![1])).toContain('Saved Name');
    // Same post-write contract as useSettingsSave's store task.
    expect(markSettingsUpdated).toHaveBeenCalledWith(
      ['store.name', 'store.address', 'store.taxId', 'store.branch', 'store.currency'],
    );
  });

  it('re-seeds when the context reports a different store (a store switch)', async () => {
    const { result, rerender } = renderHook(() => useStoreDraft(), { wrapper });
    await waitFor(() => expect(result.current.store.name).toBe('Test Store'));

    contextStore = { name: 'Other Store', address: 'B', taxId: '', currency: 'USD', branch: '' };
    rerender();

    await waitFor(() => expect(result.current.store.name).toBe('Other Store'));
    expect(result.current.store.currency).toBe('USD');
  });
});
