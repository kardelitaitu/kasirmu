import { useState, useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import {
  listTaxRatesScoped,
  createTaxRateScoped,
  updateTaxRateScoped,
  deleteTaxRateScoped,
  getTaxRateDependencyCountsScoped,
  listCategoryTaxRatesScoped,
  setCategoryTaxRatesScoped,
  listTaxRateRoundingModesScoped,
  type TaxRateDto,
  type CreateTaxRateArgs,
  type TaxRateDependencyCounts,
  type RoundingModeKey,
} from '@/api/tax';
import { listCategoriesScoped, type CategoryDto } from '@/api/products';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useOptionalSettings } from '@/contexts/SettingsContext';
import { invalidateCartTaxCache } from '@/hooks/useCartTax';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Skeleton } from '@/components/Skeleton';
import { SettingsPopup, requiredLocalized } from '@/components';
import { parseAppError } from '@/utils/app-error';
import './TaxConfigurationScreen.css';

/** Maximum supported rate in basis points — mirrored from the backend (TAX-04). */
const MAX_RATE_BPS = 1_000_000;

interface TaxFormData {
  name: string;
  rateBps: string;
  isDefault: boolean;
  isInclusive: boolean;
  // F1: scope + window authoring. Empty scope ids = the tenant-global tier;
  // the two arms are mutually exclusive (both set is refused with a typed
  // validation error, so the UI clears its counterpart on input).
  legalEntityId: string;
  locationId: string;
  // Strict YYYY-MM-DD; exclusive end. Empty = unbounded on that arm.
  effectiveFrom: string;
  effectiveTo: string;
  // E1-6: statutory rounding directive. '' = the store preference
  // applies (omitted from the write payload); the select is editable
  // ONLY on the tenant-global authoring arm (D8 hub-only authoring).
  roundingMode: RoundingModeKey | '';
}

const EMPTY_TAX_FORM: TaxFormData = {
  name: '',
  rateBps: '',
  isDefault: false,
  isInclusive: false,
  legalEntityId: '',
  locationId: '',
  effectiveFrom: '',
  effectiveTo: '',
  roundingMode: '',
};

/** Tax configuration screen — CRUD for tax rates, inclusive/exclusive toggle, and per-category tax rate assignment. */
export default function TaxConfigurationScreen() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  // ── Tax rates state ─────────────────────────────────────────────
  const [rates, setRates] = useState<TaxRateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TaxFormData>(EMPTY_TAX_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  // TAX-06: distinct load error state + retry so a failed load is not
  // indistinguishable from an empty result.
  const [loadError, setLoadError] = useState(false);
  // TAX-03/07: pending deletion confirmation (names the rate being removed).
  const [pendingDelete, setPendingDelete] = useState<TaxRateDto | null>(null);
  // TAX-03: dependency counts for the pending delete, fetched before the
  // dialog opens so the operator sees exactly what archiving will detach.
  const [pendingDeleteCounts, setPendingDeleteCounts] = useState<TaxRateDependencyCounts | null>(null);
  const [loadingDeleteCounts, setLoadingDeleteCounts] = useState(false);
  // Guards against a stale counts response if the user switches rate mid-flight.
  const pendingDeleteIdRef = useRef<string | null>(null);
  // E1-8: the store's tax rounding preference (per-row fallback display).
  // Optional read: the screen's existing tests render without a provider,
  // and the preference only refines the null-directive label.
  const settingsCtx = useOptionalSettings();
  const preferenceMode = settingsCtx?.settings.receipt.taxRoundingMode ?? 'half_up';
  // E1-8: per-rate statutory directives, E1-5 batch read. A missing entry
  // (fetch failed) renders the same preference label as null — but
  // nothing invents a directive that was never signed.
  const [roundingModes, setRoundingModes] = useState<Record<string, RoundingModeKey | null>>({});
  // E1-6: D8 hub-only authoring — the rounding select is editable only
  // while neither scoped tier is targeted in the form (the same
  // mutually-exclusive arms the scope fields enforce).
  const isGlobalRoundingArm = form.legalEntityId.trim() === '' && form.locationId.trim() === '';
  // F1: the tier the edit dialog opened with, so a changed tier can warn —
  // the backend move leaves the vacated tier without a default silently.
  const originalScopeRef = useRef<{ legalEntityId: string; locationId: string } | null>(null);
  // F1: the delete guard refused (the tier's last covering row). The dialog
  // offers the replacement path the backend's remedy text prescribes.
  const [deleteRefusal, setDeleteRefusal] = useState(false);
  // F1 debt: the tier-move write stashed while the in-app <ConfirmDialog>
  // asks consent (replaces the native window.confirm — native-dialog
  // compliance). null = no consent pending.
  const [pendingTierMove, setPendingTierMove] = useState<CreateTaxRateArgs | null>(null);

  // Refs for the Inclusive/Exclusive radio options so arrow-key navigation can
  // move focus to the newly-selected option (roving tabindex, WAI-ARIA radio).
  const exclusiveRadioRef = useRef<HTMLButtonElement>(null);
  const inclusiveRadioRef = useRef<HTMLButtonElement>(null);

  // WAI-ARIA radiogroup: Arrow keys move focus AND selection; Tab leaves the
  // group. `aria-checked` + `tabIndex` make the roving-tabindex contract work.
  const handleTaxTypeKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      setForm((prev) => ({ ...prev, isInclusive: true }));
      inclusiveRadioRef.current?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      setForm((prev) => ({ ...prev, isInclusive: false }));
      exclusiveRadioRef.current?.focus();
    }
  }, []);

  // ── Category tax rates state ────────────────────────────────────
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [catTaxRates, setCatTaxRates] = useState<Map<string, string[]>>(new Map());
  const [showCatModal, setShowCatModal] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [selectedCatRateIds, setSelectedCatRateIds] = useState<string[]>([]);
  const [savingCat, setSavingCat] = useState(false);

  // ── Data loading ────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [items, cats, catTax] = await Promise.all([
        listTaxRatesScoped(sessionToken),
        listCategoriesScoped(sessionToken),
        listCategoryTaxRatesScoped(sessionToken),
      ]);
      setRates(items);
      setCategories(cats);

      const map = new Map<string, string[]>();
      for (const row of catTax) {
        map.set(row.category_id, row.tax_rate_ids);
      }
      setCatTaxRates(map);
    } catch {
      // TAX-06: surface the failure instead of silently treating it as empty.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // E1-8: refresh the batch rounding read whenever the rate list changes.
  // Best-effort by contract — a failure leaves the previous map, whose
  // missing entries render the preference (the E1-5 null = preference
  // semantics), never a fabricated directive. Leaving it is the point: a
  // directive an EARLIER read answered keeps rendering as that directive,
  // because "this read failed" is not evidence that no directive exists. The
  // map also feeds openEdit, so wiping it would seed the preference arm into
  // a form whose Save writes a rounding change nobody asked for.
  useEffect(() => {
    if (rates.length === 0) {
      setRoundingModes({});
      return;
    }
    let cancelled = false;
    listTaxRateRoundingModesScoped(sessionToken, rates.map((r) => r.id))
      .then((modes) => {
        if (!cancelled) setRoundingModes(modes);
      })
      .catch((err) => {
        // The shape settle() uses in frontend/shell/AppShell.tsx:87-94: record
        // the failure and WRITE NOTHING, so the map keeps what it already
        // answered with. Nothing is written on this path either way, which is
        // why the cancelled flag is not consulted here.
        console.error('[tax-config] rounding-mode read failed — keeping the previous map:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [rates, sessionToken]);

  // ── Tax rate CRUD ───────────────────────────────────────────────

  const openCreate = useCallback(() => {
    setForm(EMPTY_TAX_FORM);
    setEditingId(null);
    originalScopeRef.current = null;
    setShowModal(true);
  }, []);

  const openEdit = useCallback((r: TaxRateDto) => {
    setForm({
      name: r.name,
      rateBps: String(r.rate_bps),
      isDefault: r.is_default,
      isInclusive: r.is_inclusive,
      legalEntityId: r.scope?.scope === 'legal_entity' ? (r.scope?.legalEntityId ?? '') : '',
      locationId: r.scope?.scope === 'location' ? (r.scope?.locationId ?? '') : '',
      effectiveFrom: r.window?.effectiveFrom ?? '',
      effectiveTo: r.window?.effectiveTo ?? '',
      // E1-6: seed from the E1-5 batch read; null (no directive)
      // maps to '' = the preference arm.
      roundingMode: roundingModes[r.id] ?? '',
    });
    originalScopeRef.current = {
      legalEntityId: r.scope?.scope === 'legal_entity' ? (r.scope?.legalEntityId ?? '') : '',
      locationId: r.scope?.scope === 'location' ? (r.scope?.locationId ?? '') : '',
    };
    setEditingId(r.id);
    setShowModal(true);
    // Depends on the E1-5 batch map — the editor seeds the rounding
    // select from it, so a stale empty map must not be captured.
  }, [roundingModes]);

  // Shared write tail of a save: called directly by handleSave, and by the
  // tier-move ConfirmDialog continuation — the action on confirm is exactly
  // the write the removed native gate used to gate.
  const commitSave = useCallback(async (args: CreateTaxRateArgs) => {
    if (editingId) {
      await updateTaxRateScoped(sessionToken, { id: editingId, ...args });
    } else {
      await createTaxRateScoped(sessionToken, args);
    }
    // F2-8: the write succeeded — any cached cart-tax answer computed
    // under the old configuration is now potentially stale. Drop it so
    // an open POS session can never serve it as fresh.
    invalidateCartTaxCache();
    setShowModal(false);
    await loadAll();
  }, [editingId, sessionToken, loadAll]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // TAX-04: the rate is an integer in basis points — reject non-integers
      // (e.g. "825.5") rather than silently truncating via parseInt.
      const rawRate = form.rateBps.trim();
      const rateBps = Number(rawRate);
      if (rawRate === '' || !Number.isInteger(rateBps) || rateBps < 0 || rateBps > MAX_RATE_BPS) {
        addToast({
          message: l10n.getString('tax-config-rate-invalid', { max: String(MAX_RATE_BPS) }),
          type: 'error',
        });
        return;
      }

      // Scope + window are additive and optional: omitting every scope arm
      // writes the tenant-global tier, omitting a date arm leaves it unbounded.
      const args = {
        name: form.name.trim(),
        rateBps,
        isDefault: form.isDefault,
        isInclusive: form.isInclusive,
        ...(form.legalEntityId.trim() ? { legalEntityId: form.legalEntityId.trim() } : {}),
        ...(form.locationId.trim() ? { locationId: form.locationId.trim() } : {}),
        ...(form.effectiveFrom ? { effectiveFrom: form.effectiveFrom } : {}),
        ...(form.effectiveTo ? { effectiveTo: form.effectiveTo } : {}),
        // E1-6: '' (the preference arm) is OMITTED, never sent — the
        // backend column accepts ''|half_up|truncate, and omitting keeps
        // the payload free of a claimed directive when none was chosen.
        ...(form.roundingMode ? { roundingMode: form.roundingMode } : {}),
      };
      // F1 debt: moving a rate between tiers empties the vacated tier's
      // default silently — warn before the write, not after the damage.
      // Consent is asked by the in-app <ConfirmDialog> (native-dialog
      // compliance): stash the payload and stop here — confirming continues
      // the identical write, cancelling drops the stash (old semantics:
      // proceed ? write : return).
      if (
        editingId &&
        originalScopeRef.current &&
        (originalScopeRef.current.legalEntityId !== (form.legalEntityId.trim() || '') ||
          originalScopeRef.current.locationId !== (form.locationId.trim() || ''))
      ) {
        setPendingTierMove(args);
        return;
      }
      await commitSave(args);
    } catch {
      addToast({ message: requiredLocalized(l10n, 'tax-config-save-error'), type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [form, editingId, l10n, addToast, commitSave]);

  // Tier-move consent continuation — performs the write the operator just
  // approved (the exact action the removed native confirm used to gate).
  const confirmTierMove = useCallback(async () => {
    if (!pendingTierMove) return;
    const args = pendingTierMove;
    setPendingTierMove(null);
    setSaving(true);
    try {
      await commitSave(args);
    } catch {
      addToast({ message: requiredLocalized(l10n, 'tax-config-save-error'), type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [pendingTierMove, commitSave, l10n, addToast]);

  // TAX-03/07: ask for confirmation (naming the rate) before deleting.
  // Fetches the dependency counts first so the dialog can show what
  // archiving will detach — and block when historical sales reference it.
  const requestDelete = useCallback(async (rate: TaxRateDto) => {
    pendingDeleteIdRef.current = rate.id;
    setPendingDelete(rate);
    setPendingDeleteCounts(null);
    setLoadingDeleteCounts(true);
    try {
      const counts = await getTaxRateDependencyCountsScoped(sessionToken, rate.id);
      if (pendingDeleteIdRef.current === rate.id) {
        setPendingDeleteCounts(counts);
      }
    } catch {
      // Counts are best-effort — the dialog still opens with generic copy.
      if (pendingDeleteIdRef.current === rate.id) {
        setPendingDeleteCounts(null);
      }
    } finally {
      // Guard against a stale response from a previous rate: only clear the
      // loading flag for the rate that is still being requested, so a rapid
      // A→B switch never opens the dialog mid-flight for B.
      if (pendingDeleteIdRef.current === rate.id) {
        setLoadingDeleteCounts(false);
      }
    }
  }, [sessionToken]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setDeleting(id);
    try {
      await deleteTaxRateScoped(sessionToken, id);
      // F2-8: success path ONLY — the refusal catch below means the
      // backend refused the write and the cache is still accurate.
      invalidateCartTaxCache();
      setPendingDelete(null);
      setPendingDeleteCounts(null);
      setLoadingDeleteCounts(false);
      pendingDeleteIdRef.current = null;
      await loadAll();
    } catch (err) {
      // F1 debt: the delete guard refuses when the rate is the last row
      // covering a live tier — the backend's remedy is "author a replacement
      // first", so the dialog offers exactly that path instead of a toast.
      if (parseAppError(err)?.kind === 'invalid') {
        setDeleteRefusal(true);
      } else {
        addToast({ message: requiredLocalized(l10n, 'tax-config-delete-error'), type: 'error' });
        setPendingDelete(null);
        setPendingDeleteCounts(null);
        setLoadingDeleteCounts(false);
        pendingDeleteIdRef.current = null;
      }
    } finally {
      setDeleting(null);
    }
  }, [pendingDelete, sessionToken, loadAll, l10n, addToast]);

  // F1: leave the refusal, open the create dialog for the replacement rate.
  const replaceAfterRefusal = useCallback(() => {
    setDeleteRefusal(false);
    setPendingDelete(null);
    setPendingDeleteCounts(null);
    setLoadingDeleteCounts(false);
    pendingDeleteIdRef.current = null;
    openCreate();
  }, [openCreate]);

  // ── Category tax rates ──────────────────────────────────────────

  const openCatEdit = useCallback((cat: CategoryDto) => {
    setEditingCatId(cat.id);
    setEditingCatName(cat.name);
    setSelectedCatRateIds(catTaxRates.get(cat.id) ?? []);
    setShowCatModal(true);
  }, [catTaxRates]);

  const handleSaveCat = useCallback(async () => {
    if (!editingCatId) return;
    setSavingCat(true);
    try {
      await setCategoryTaxRatesScoped(sessionToken, {
        categoryId: editingCatId,
        taxRateIds: selectedCatRateIds,
      });
      // F2-8: category↔rate assignment changes which rates a cart
      // resolves to — same staleness class as a rate write.
      invalidateCartTaxCache();
      setShowCatModal(false);
      await loadAll();
    } catch {
      addToast({ message: requiredLocalized(l10n, 'tax-config-cat-save-error'), type: 'error' });
    } finally {
      setSavingCat(false);
    }
  }, [editingCatId, selectedCatRateIds, sessionToken, loadAll, l10n, addToast]);

  const toggleCatRate = useCallback((rateId: string) => {
    setSelectedCatRateIds((prev) =>
      prev.includes(rateId)
        ? prev.filter((id) => id !== rateId)
        : [...prev, rateId],
    );
  }, []);

  // Disable the category save button until the assignment actually changes,
  // so an untouched "Save" can't round-trip a no-op IPC write.
  const catSaveDisabled = useMemo(() => {
    if (!editingCatId) return true;
    const original = catTaxRates.get(editingCatId) ?? [];
    if (original.length !== selectedCatRateIds.length) return false;
    const a = [...original].sort();
    const b = [...selectedCatRateIds].sort();
    return a.every((id, i) => id === b[i]);
  }, [catTaxRates, editingCatId, selectedCatRateIds]);

  return (
    <div className="tax-config">
      <div className="tax-config-header">
        <Localized id="tax-config-title">
          <h1 className="tax-config-title">Tax Configuration</h1>
        </Localized>
        <Localized id="tax-config-add">
          <Button onClick={openCreate}>Add Tax Rate</Button>
        </Localized>
      </div>

      {loadError ? (
        <div className="tax-config-load-error" role="alert">
          <Localized id="tax-config-load-error">
            <p>Failed to load tax configuration.</p>
          </Localized>
          <Localized id="tax-config-load-retry">
            <Button variant="secondary" onClick={loadAll}>Retry</Button>
          </Localized>
        </div>
      ) : loading ? (
        <div className="tax-config-loading-skeleton" aria-hidden="true">
          {/* Header skeleton: title + button */}
          <div className="tax-config-header">
            <Skeleton variant="block" width="14rem" height="1.75rem" />
            <Skeleton variant="block" width="8rem" height="2.25rem" />
          </div>
          {/* Table skeleton: header + 4 rows with 5 columns */}
          <div className="tax-config-table-wrap">
            <table className="tax-config-table" aria-hidden="true">
              <thead>
                <tr>
                  {['Name', 'Rate (%)', 'Type', 'Default', ''].map((_, i) => (
                    <th key={i}>
                      <Skeleton variant="text" width={i < 4 ? '4rem' : '3rem'} height="0.75rem" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{[0, 1, 2, 3].map((r) => (
                  <tr key={r}>
                    <td><Skeleton variant="text" width="6rem" height="0.875rem" /></td>
                    <td><Skeleton variant="text" width="3rem" height="0.875rem" /></td>
                    <td><Skeleton variant="block" width="5rem" height="1.25rem" style={{ borderRadius: 'var(--radius-sm)' }} /></td>
                    <td><Skeleton variant="text" width="2.5rem" height="0.875rem" /></td>
                    <td className="tax-config-cell-actions">
                      <Skeleton variant="block" width="3.5rem" height="1.375rem" />
                    </td>
                  </tr>
                ))}</tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          {/* ── Tax Rates Table ────────────────────────────────────── */}
          {rates.length === 0 ? (
            <Card shadow="sm">
              <div className="tax-config-empty">
                <Localized id="tax-config-empty">
                  <p>No tax rates configured</p>
                </Localized>
                <Localized id="tax-config-add">
                  <Button variant="secondary" onClick={openCreate}>Add Tax Rate</Button>
                </Localized>
              </div>
            </Card>
          ) : (
            <div className="tax-config-table-wrap">
              <table className="tax-config-table" aria-label={l10n.getString('tax-config-table-aria')}>
                <thead>
                  <tr>
                    <Localized id="tax-config-col-name"><th>Name</th></Localized>
                    <Localized id="tax-config-col-rate"><th>Rate (%)</th></Localized>
                    <Localized id="tax-config-col-type"><th>Type</th></Localized>
                    <Localized id="tax-config-col-default"><th>Default</th></Localized>
                    <Localized id="tax-config-col-actions" attrs={{ "aria-label": true }}>
                      <th> </th>
                    </Localized>
                  </tr>
                </thead>
                <tbody>{rates.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.name}
                        {r.is_default && (
                          <Badge variant="info" size="sm" style={{ marginLeft: 'var(--space-2)' }}>
                            <Localized id="tax-config-default-badge">
                              <span>Default</span>
                            </Localized>
                          </Badge>
                        )}
                        {(() => {
                          // F1: provenance from the Option-B side-channel join.
                          // A null scope entry is the tenant-global tier — the
                          // resolver walk Location → Legal entity → Global ends
                          // there, and unconfigured = no tax is a legitimate
                          // state (the global tier is deliberately unguarded).
                          const s = r.scope?.scope;
                          const label = s === 'location'
                            ? l10n.getString('tax-config-scope-location', { id: r.scope?.locationId ?? '' })
                            : s === 'legal_entity'
                              ? l10n.getString('tax-config-scope-legal-entity', { id: r.scope?.legalEntityId ?? '' })
                              : l10n.getString('tax-config-scope-global');
                          return (
                            <Badge variant="default" size="sm" style={{ marginLeft: 'var(--space-2)' }}>
                              {label}
                            </Badge>
                          );
                        })()}
                        {(() => {
                          // E1-8: effective rounding provenance. A statutory
                          // directive (half_up/truncate) shows as its own badge;
                          // null = the preference applies, and the badge states
                          // WHICH preference value is in effect instead of
                          // inventing a per-row directive that was never stored.
                          const mode = roundingModes[r.id] ?? null;
                          const label = mode
                            ? l10n.getString('tax-config-rounding-statutory', { mode })
                            : l10n.getString('tax-config-rounding-preference', { mode: preferenceMode });
                          return (
                            <Badge variant="default" size="sm" style={{ marginLeft: 'var(--space-2)' }}>
                              {label}
                            </Badge>
                          );
                        })()}
                      </td>
                      <td>{r.display_rate}</td>
                      <td>
                        <span className={`tax-config-type-badge ${r.is_inclusive ? 'tax-config-type--inclusive' : 'tax-config-type--exclusive'}`}>
                          <Localized id={r.is_inclusive ? 'tax-config-type-inclusive' : 'tax-config-type-exclusive'}>
                            <span>{r.is_inclusive ? 'Inclusive' : 'Exclusive'}</span>
                          </Localized>
                        </span>
                      </td>
                      <td>{r.is_default ? l10n.getString('tax-config-yes') : '\u2014'}</td>
                      <td className="tax-config-cell-actions">
                        <Localized id="tax-config-edit-aria" attrs={{ "aria-label": true }} vars={{ name: r.name }}>
                        <button
                          type="button"
                          className="tax-config-action-btn"
                          onClick={() => openEdit(r)}
                        >
                          <Localized id="tax-config-edit">
                            <span>Edit</span>
                          </Localized>
                        </button>
                        </Localized>
                        <Localized id="tax-config-delete-aria" attrs={{ "aria-label": true }} vars={{ name: r.name }}>
                        <button
                          type="button"
                          className="tax-config-action-btn tax-config-action-btn--danger"
                          onClick={() => requestDelete(r)}
                          disabled={deleting === r.id}
                        >
                          <Localized id="tax-config-btn-delete">
                            <span>Delete</span>
                          </Localized>
                        </button>
                        </Localized>
                      </td>
                    </tr>
                  ))}</tbody>
              </table>
            </div>
          )}

          {/* ── Category Tax Rates Section ──────────────────────────── */}
          <div className="tax-config-section">
            <Localized id="tax-config-cat-title">
              <h2 className="tax-config-section-title">Category Tax Rates</h2>
            </Localized>
            <Localized id="tax-config-cat-desc">
              <p className="tax-config-section-desc">
                Assign default tax rates to product categories. Products inherit their
                category&rsquo;s tax rates unless overridden at the product level.
              </p>
            </Localized>

            {categories.length === 0 ? (
              <Localized id="tax-config-no-categories">
                <p className="tax-config-loading">No categories available.</p>
              </Localized>
            ) : (
              <div className="tax-config-table-wrap">
              <table className="tax-config-table" aria-label={l10n.getString('tax-config-cat-table-aria')}>
                  <thead>
                    <tr>
                      <Localized id="tax-config-col-category"><th>Category</th></Localized>
                      <Localized id="tax-config-col-assigned"><th>Assigned Tax Rates</th></Localized>
                      <Localized id="tax-config-col-actions" attrs={{ "aria-label": true }}>
                        <th> </th>
                      </Localized>
                    </tr>
                  </thead>
                  <tbody>{categories.map((cat) => {
                      const assignedIds = catTaxRates.get(cat.id) ?? [];
                      const assignedNames = assignedIds
                        .map((id) => rates.find((r) => r.id === id))
                        .filter(Boolean)
                        .map((r) => r!.name);
                      return (
                        <tr key={cat.id}>
                          <td>
                            <span className="tax-config-cat-name">
                              <span
                                className="tax-config-cat-swatch"
                                style={{ background: cat.colour }}
                                aria-hidden="true"
                              />
                              {cat.name}
                            </span>
                          </td>
                          <td>
                            {assignedNames.length > 0 ? (
                              <span className="tax-config-cat-badges">
                                {assignedNames.map((n) => (
                                  <Badge key={n} variant="default" size="sm">{n}</Badge>
                                ))}
                              </span>
                            ) : (
                              <Localized id="tax-config-no-rates-assigned">
                                <span className="tax-config-muted">No rates assigned</span>
                              </Localized>
                            )}
                          </td>
                          <td className="tax-config-cell-actions">
                            <Localized id="tax-config-cat-edit-aria" attrs={{ "aria-label": true }} vars={{ name: cat.name }}>
                            <button
                              type="button"
                              className="tax-config-action-btn"
                              onClick={() => openCatEdit(cat)}
                            >
                              <Localized id="tax-config-edit">
                                <span>Edit</span>
                              </Localized>
                            </button>
                            </Localized>
                          </td>
                        </tr>
                      );
                    })}</tbody>
              </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Tax Rate Form Modal ──────────────────────────────────── */}
      <SettingsPopup
        open={showModal}
        onClose={() => setShowModal(false)}
        title={l10n.getString('tax-config-modal-title', { editing: editingId !== null ? 'true' : 'false' })}
        saving={saving}
        onSave={handleSave}
        saveLabel={l10n.getString('tax-config-btn-save')}
        saveDisabled={!form.name.trim() || !form.rateBps.trim()}
        cancelLabel={l10n.getString('tax-config-btn-cancel')}
      >
        <div className="tax-config-field tax-config-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
          <label htmlFor="tax-field-name" className="tax-config-label">
            <Localized id="tax-config-field-name">
              <span>Tax Name</span>
            </Localized>
          </label>
          <input
            className="tax-config-input"
            type="text"
            id="tax-field-name"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder={l10n.getString('tax-config-field-name-placeholder')}
          />
        </div>

        <div className="tax-config-field tax-config-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
          <label htmlFor="tax-field-rate" className="tax-config-label">
            <Localized id="tax-config-field-rate">
              <span>Rate (BPS)</span>
            </Localized>
          </label>
          <div className="tax-config-field-input-wrap">
            <input
              className="tax-config-input"
              type="number"
              id="tax-field-rate"
              min="0"
              value={form.rateBps}
              onChange={(e) => setForm((prev) => ({ ...prev, rateBps: e.target.value }))}
              placeholder={l10n.getString('tax-config-field-rate-placeholder')}
              max={String(MAX_RATE_BPS)}
            />
            <Localized id="tax-config-rate-hint">
              <span className="tax-config-hint">Enter rate in basis points (e.g. 825 = 8.25%)</span>
            </Localized>
          </div>
        </div>

        {/* Inclusive / Exclusive toggle */}
        <div className="tax-config-field tax-config-field--horizontal">
          <Localized id="tax-config-tax-type">
            <span className="tax-config-label">Tax Type</span>
          </Localized>
          <div className="tax-config-toggle-group" role="radiogroup" aria-label={l10n.getString('tax-config-tax-type-aria')}>
            <button
              type="button"
              role="radio"
              ref={exclusiveRadioRef}
              tabIndex={!form.isInclusive ? 0 : -1}
              aria-checked={!form.isInclusive}
              aria-label={l10n.getString('tax-config-type-exclusive-label')}
              className={`tax-config-toggle-btn ${!form.isInclusive ? 'tax-config-toggle-btn--active' : ''}`}
              onClick={() => setForm((prev) => ({ ...prev, isInclusive: false }))}
              onKeyDown={handleTaxTypeKeyDown}
            >
              <Localized id="tax-config-type-exclusive-label">
                <span>Exclusive</span>
              </Localized>
              <Localized id="tax-config-type-exclusive-desc">
                <span className="tax-config-toggle-desc">Added at checkout</span>
              </Localized>
            </button>
            <button
              type="button"
              role="radio"
              ref={inclusiveRadioRef}
              tabIndex={form.isInclusive ? 0 : -1}
              aria-checked={form.isInclusive}
              aria-label={l10n.getString('tax-config-type-inclusive-label')}
              className={`tax-config-toggle-btn ${form.isInclusive ? 'tax-config-toggle-btn--active' : ''}`}
              onClick={() => setForm((prev) => ({ ...prev, isInclusive: true }))}
              onKeyDown={handleTaxTypeKeyDown}
            >
              <Localized id="tax-config-type-inclusive-label">
                <span>Inclusive</span>
              </Localized>
              <Localized id="tax-config-type-inclusive-desc">
                <span className="tax-config-toggle-desc">Included in price</span>
              </Localized>
            </button>
          </div>
        </div>

        {/* E1-6: statutory rounding authoring. Editable only on the
            tenant-global arm — scoped/hub-authored rows are read-only
            here (D8); their directive arrives from the hub instead. */}
        <div className="tax-config-field tax-config-field--horizontal">
          <Localized id="tax-config-rounding-label">
            <span className="tax-config-label">Rounding Mode</span>
          </Localized>
          <select
            className="tax-config-input"
            id="tax-field-rounding"
            aria-label={l10n.getString('tax-config-rounding-aria')}
            value={form.roundingMode}
            disabled={!isGlobalRoundingArm}
            onChange={(e) => setForm((prev) => ({ ...prev, roundingMode: e.target.value as RoundingModeKey | '' }))}
          >
            <option value="">{l10n.getString('tax-config-rounding-preference-option', { mode: preferenceMode })}</option>
            <option value="half_up">half_up</option>
            <option value="truncate">truncate</option>
          </select>
          {!isGlobalRoundingArm && (
            <Localized id="tax-config-rounding-scoped-readonly">
              <span className="tax-config-hint">Scoped rates are authored at the hub — rounding is read-only here.</span>
            </Localized>
          )}
        </div>

        <label className="tax-config-checkbox">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => setForm((prev) => ({ ...prev, isDefault: e.target.checked }))}
          />
          {l10n.getString('tax-config-set-default')}
        </label>

        {/* F1: scope + validity window (both optional — omit = global tier / unbounded) */}
        <div className="tax-config-field tax-config-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
          <label htmlFor="tax-field-legal-entity" className="tax-config-label">
            <Localized id="tax-config-field-legal-entity">
              <span>Legal entity id</span>
            </Localized>
          </label>
          <input
            className="tax-config-input"
            type="text"
            id="tax-field-legal-entity"
            value={form.legalEntityId}
            onChange={(e) => setForm((prev) => ({ ...prev, legalEntityId: e.target.value, locationId: '' }))}
            placeholder={l10n.getString('tax-config-field-legal-entity-placeholder')}
          />
        </div>
        <div className="tax-config-field tax-config-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
          <label htmlFor="tax-field-location" className="tax-config-label">
            <Localized id="tax-config-field-location">
              <span>Location id</span>
            </Localized>
          </label>
          <input
            className="tax-config-input"
            type="text"
            id="tax-field-location"
            value={form.locationId}
            onChange={(e) => setForm((prev) => ({ ...prev, locationId: e.target.value, legalEntityId: '' }))}
            placeholder={l10n.getString('tax-config-field-location-placeholder')}
          />
          <Localized id="tax-config-scope-hint">
            <span className="tax-config-hint">Fill one scope arm — or neither for the tenant-global tier.</span>
          </Localized>
        </div>
        <div className="tax-config-field tax-config-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
          <label htmlFor="tax-field-from" className="tax-config-label">
            <Localized id="tax-config-field-from">
              <span>Effective from</span>
            </Localized>
          </label>
          <input
            className="tax-config-input"
            type="date"
            id="tax-field-from"
            value={form.effectiveFrom}
            onChange={(e) => setForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
          />
        </div>
        <div className="tax-config-field tax-config-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
          <label htmlFor="tax-field-to" className="tax-config-label">
            <Localized id="tax-config-field-to">
              <span>Effective to (exclusive)</span>
            </Localized>
          </label>
          <input
            className="tax-config-input"
            type="date"
            id="tax-field-to"
            value={form.effectiveTo}
            onChange={(e) => setForm((prev) => ({ ...prev, effectiveTo: e.target.value }))}
          />
        </div>
        {editingId !== null && originalScopeRef.current !== null && (
          <p className="tax-config-tier-warning" role="alert">
            {(() => {
              const nowE = form.legalEntityId.trim();
              const nowL = form.locationId.trim();
              const wasE = originalScopeRef.current.legalEntityId;
              const wasL = originalScopeRef.current.locationId;
              if (nowE === wasE && nowL === wasL) return null;
              return l10n.getString('tax-config-tier-change-warning');
            })()}
          </p>
        )}
      </SettingsPopup>

      {/* ── Delete confirmation (TAX-03/07) ──────────────────────── */}
      <ConfirmDialog
        open={pendingDelete !== null && !loadingDeleteCounts}
        onCancel={() => {
          pendingDeleteIdRef.current = null;
          setPendingDelete(null);
          setPendingDeleteCounts(null);
          setLoadingDeleteCounts(false);
        }}
        onConfirm={confirmDelete}
        title={
          pendingDeleteCounts && pendingDeleteCounts.sale_lines > 0
            ? l10n.getString('tax-config-delete-blocked-title', { name: pendingDelete?.name ?? '' })
            : l10n.getString('tax-config-delete-confirm-title', { name: pendingDelete?.name ?? '' })
        }
        message={
          pendingDeleteCounts && pendingDeleteCounts.sale_lines > 0 ? (
            l10n.getString('tax-config-delete-blocked-message', {
              name: pendingDelete?.name ?? '',
              count: String(pendingDeleteCounts.sale_lines),
            })
          ) : (
            <>
              {l10n.getString('tax-config-delete-confirm-message', { name: pendingDelete?.name ?? '' })}
              {pendingDeleteCounts &&
                (pendingDeleteCounts.products > 0 || pendingDeleteCounts.categories > 0) && (
                  <span className="tax-config-delete-deps">
                    {l10n.getString('tax-config-delete-deps-products', {
                      count: String(pendingDeleteCounts.products),
                    })}
                    {' \u00b7 '}
                    {l10n.getString('tax-config-delete-deps-categories', {
                      count: String(pendingDeleteCounts.categories),
                    })}
                  </span>
                )}
            </>
          )
        }
        variant="danger"
        loading={deleting !== null}
        disabled={(pendingDeleteCounts?.sale_lines ?? 0) > 0}
        confirmLabel={l10n.getString('tax-config-btn-delete')}
        cancelLabel={l10n.getString('tax-config-btn-cancel')}
      />

      {/* ── Delete refusal (F1: last-covering-row guard remedy) ──── */}
      <ConfirmDialog
        open={deleteRefusal && pendingDelete !== null}
        onCancel={() => {
          setDeleteRefusal(false);
          setPendingDelete(null);
          setPendingDeleteCounts(null);
          setLoadingDeleteCounts(false);
          pendingDeleteIdRef.current = null;
        }}
        onConfirm={replaceAfterRefusal}
        title={l10n.getString('tax-config-delete-refusal-title', { name: pendingDelete?.name ?? '' })}
        message={l10n.getString('tax-config-delete-refusal-message', { name: pendingDelete?.name ?? '' })}
        variant="warning"
        confirmLabel={l10n.getString('tax-config-delete-refusal-replace')}
        cancelLabel={l10n.getString('tax-config-btn-cancel')}
      />

      {/* ── Tier-move consent (F1 debt; replaces the native confirm) ── */}
      <ConfirmDialog
        open={pendingTierMove !== null}
        onCancel={() => setPendingTierMove(null)}
        onConfirm={() => void confirmTierMove()}
        title={l10n.getString('confirm')}
        message={l10n.getString('tax-config-tier-change-warning')}
        variant="warning"
        confirmLabel={l10n.getString('tax-config-btn-save')}
        cancelLabel={l10n.getString('tax-config-btn-cancel')}
        loading={saving}
      />

      {/* ── Category Tax Rates Modal ─────────────────────────────── */}
      <SettingsPopup
        open={showCatModal}
        onClose={() => setShowCatModal(false)}
        title={l10n.getString('tax-config-cat-modal-title', { name: editingCatName })}
        saving={savingCat}
        onSave={handleSaveCat}
        saveDisabled={catSaveDisabled}
        saveLabel={l10n.getString('tax-config-btn-save')}
        cancelLabel={l10n.getString('tax-config-btn-cancel')}
        size="sm"
      >
        <Localized id="tax-config-cat-modal-desc">
          <p className="tax-config-section-desc">
            Select the tax rates that apply to all products in this category.
          </p>
        </Localized>

        {rates.length === 0 ? (
          <Localized id="tax-config-no-rates">
            <p className="tax-config-loading">
              No tax rates available. Create one first.
            </p>
          </Localized>
        ) : (
          <div className="tax-config-cat-rate-list">
            {rates.map((r) => {
              const checked = selectedCatRateIds.includes(r.id);
              return (
                <label
                  key={r.id}
                  className={`tax-config-cat-rate-item ${checked ? 'tax-config-cat-rate-item--checked' : ''}`}
                  htmlFor={"tax-cat-rate-" + r.id}
                  aria-label={r.name}
                >
                  <input
                    type="checkbox"
                    id={"tax-cat-rate-" + r.id}
                    checked={checked}
                    onChange={() => toggleCatRate(r.id)}
                  />
                  <div className="tax-config-cat-rate-info">
                    <span className="tax-config-cat-rate-name">{r.name}</span>
                    <span className="tax-config-cat-rate-meta">
                      {r.display_rate}
                      {' \u00b7 '}
                      {l10n.getString(r.is_inclusive ? 'tax-config-type-inclusive' : 'tax-config-type-exclusive')}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </SettingsPopup>
    </div>
  );
}

