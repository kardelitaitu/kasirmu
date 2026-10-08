//! Store-identity draft: the state GeneralSection has always been handed but
//! nothing has supplied since the flat-IA rebuild.
//!
//! WHY THIS EXISTS. `GeneralSection.tsx` is presentational — it takes eleven
//! props and owns nothing. Before the rebuild the settings page supplied them;
//! the rebuild commit deliberately removed the form fields ("inputs left the
//! page" — see the header of SettingsPage.test.tsx), and the props went with
//! them. `validateField`, `clearFieldError` and `fieldErrors` were never
//! reimplemented anywhere: `git grep validateField` finds the prop TYPE, its
//! two call sites, and test mocks — no definition. So the store identity form
//! could not be rendered even if someone imported the section.
//!
//! The user-visible cost, measured on the tablet 2026-10-06 over CDP: Settings →
//! General rendered "This page is being rebuilt.", `#settings-field-store-name`
//! was null, and the section held ZERO inputs. Store name, address, tax ID,
//! branch, default currency and UI language were unreachable in the shipped app.
//!
//! This hook restores the missing half. It owns the DRAFT (what the user is
//! typing), the field errors, and the persist call — so a screen can render the
//! section without the page having to thread eleven props again.
//!
//! Deliberately NOT lifted into SettingsContext: the context is a read + refetch
//! surface (it exposes `settings`, no draft setter), and a form draft is the
//! editor's own state. Persisting calls `setStoreSettingsScoped` then
//! `markSettingsUpdated(['store.*'])`, which is exactly what useSettingsSave's
//! store task does, so the two paths agree on the wire format and the refetch
//! trigger and cannot silently diverge.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import { useSettings } from '@/contexts/SettingsContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { setStoreSettingsScoped, type StoreSettingsDto } from '@/api/settings';
import type { CurrencyDto } from '@/api/currency';

/** Empty draft used before the context's first read resolves. */
const EMPTY_STORE: StoreSettingsDto = {
  name: '',
  address: '',
  taxId: '',
  currency: 'IDR',
  branch: '',
};

/** Field ids this hook validates, matching GeneralSection's own error keys. */
export type StoreFieldId = 'store-name' | 'tax-id';

export interface StoreDraft {
  /** The editable draft. Seeded from context, then owned here. */
  store: StoreSettingsDto;
  /** Replace a field and clear its error, mirroring the section's onChange. */
  setField: (id: keyof StoreSettingsDto, value: string) => void;
  /** Field errors, keyed the way GeneralSection reads them (e.g. 'store-name'). */
  fieldErrors: Record<string, string>;
  /** Validate one field; called by the section on blur. */
  validateField: (field: string, value: string) => void;
  /** Clear one field's error; called by the section on change. */
  clearFieldError: (field: string) => void;
  /** True once the draft differs from what the context last reported. */
  isDirty: boolean;
  /** Persist the draft. Resolves true when the write succeeded. */
  save: () => Promise<boolean>;
  saving: boolean;
  /** Autocomplete/autocorrect attributes the section spreads onto its inputs. */
  cmInput: React.HTMLAttributes<HTMLInputElement>;
  /** Currencies the default-currency picker offers, from the context read. */
  currencies: CurrencyDto[];
}

/**
 * Own the store-identity draft, its validation, and its persistence.
 *
 * Validation is intentionally minimal and matches the field constraints the
 * section already declares in markup (`required`, `maxLength`, the tax-id
 * `pattern`): a missing name and a malformed tax id are the only two the
 * original form ever surfaced an error for, and inventing more would add copy
 * the bundles do not carry.
 */
export function useStoreDraft(): StoreDraft {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const { settings, markSettingsUpdated } = useSettings();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken ?? '';

  const [store, setStore] = useState<StoreSettingsDto>(EMPTY_STORE);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Seed the draft from the context read, and RE-seed whenever the context
  // reports different values (a store switch, or a refetch after another
  // surface saved). Guarded on the value, not on identity: the context builds a
  // fresh object per read, so an identity check would re-seed on every render
  // and wipe what the user is typing.
  const contextStore = settings?.store;
  const contextKey = contextStore
    ? [contextStore.name, contextStore.address, contextStore.taxId, contextStore.currency, contextStore.branch].join('\u0000')
    : null;
  useEffect(() => {
    if (!contextStore || contextKey === null) return;
    setStore({
      name: contextStore.name ?? '',
      address: contextStore.address ?? '',
      taxId: contextStore.taxId ?? '',
      currency: contextStore.currency ?? 'IDR',
      branch: contextStore.branch ?? '',
    });
    // contextKey is the value-level identity of contextStore; listing the object
    // would re-seed on every context render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

  const savedKey = useMemo(() => (contextStore
    ? [contextStore.name, contextStore.address, contextStore.taxId, contextStore.currency, contextStore.branch].join('\u0000')
    : ''), [contextKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const draftKey = useMemo(
    () => [store.name, store.address, store.taxId, store.currency, store.branch].join('\u0000'),
    [store.name, store.address, store.taxId, store.currency, store.branch],
  );

  const setField = useCallback((id: keyof StoreSettingsDto, value: string) => {
    setStore((prev) => ({ ...prev, [id]: value }));
  }, []);

  // Same constraints as the markup: a required name, and the tax-id pattern
  // `[A-Za-z0-9\-./]*` the input declares. Message copy is the section's own
  // existing key set — no new Fluent keys, both bundles already carry these.
  const validateField = useCallback((field: string, value: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (field === 'store-name' && value.trim() === '') {
        next['store-name'] = l10n.getString('settings-store-name-required');
      } else if (field === 'tax-id' && value !== '' && !/^[A-Za-z0-9\-./]*$/.test(value)) {
        next['tax-id'] = l10n.getString('settings-tax-id-pattern-hint');
      } else {
        delete next[field];
      }
      return next;
    });
  }, [l10n]);

  const clearFieldError = useCallback((field: string) => {
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev; // keep identity: avoid a render per keystroke
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    if (!sessionToken) return false;
    setSaving(true);
    try {
      await setStoreSettingsScoped(sessionToken, store);
      // Same post-write contract as useSettingsSave's store task: tell the
      // context which keys changed so every consumer refetches.
      markSettingsUpdated(['store.name', 'store.address', 'store.taxId', 'store.branch', 'store.currency']);
      addToast({ message: l10n.getString('settings-saved'), type: 'success' });
      return true;
    } catch {
      addToast({ message: l10n.getString('settings-save-error'), type: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [sessionToken, store, markSettingsUpdated, addToast, l10n]);

  const cmInput = useMemo<React.HTMLAttributes<HTMLInputElement>>(() => ({
    autoComplete: 'off' as const,
    autoCorrect: 'off' as const,
    spellCheck: false as const,
  }), []);

  return {
    store,
    setField,
    fieldErrors,
    validateField,
    clearFieldError,
    isDirty: draftKey !== savedKey,
    save,
    saving,
    cmInput,
    currencies: settings?.currencies ?? [],
  };
}
