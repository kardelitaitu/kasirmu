import { useState, useCallback, useEffect, useRef } from 'react';
import AdminLockedFeature from '@/components/AdminLockedFeature';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import { Localized, useLocalization } from '@fluent/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  listPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  type Promotion,
  type CreatePromotionArgs,
} from '@/api/promotions';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { useToast } from '@/components/Toast';
import { requiredLocalized, EmptyState } from '@/components';
import { NoPromotionsIcon } from '@/components/EmptyStateIllustrations';
import { l10nErrorMessage } from '@/utils/app-error';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import './PromotionManagementScreen.css';

type ModalMode = 'add' | 'edit' | null;

const PROMO_TYPES = ['percentage', 'fixed_amount', 'buy_x_get_y'] as const;

const PROMO_TYPE_LABELS: Record<string, string> = {
  percentage: 'promotions-percentage',
  fixed_amount: 'promotions-fixed-amount',
  buy_x_get_y: 'promotions-buy-x-get-y',
};

/** Short readable date in the active locale (guards invalid ISO strings). */
function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale);
}

const emptyForm = (): Promotion => ({
  id: '',
  name: '',
  description: '',
  promo_type: 'percentage',
  value_minor: 0,
  min_qty: null,
  trigger_sku: null,
  reward_sku: null,
  reward_qty: null,
  starts_at: null,
  ends_at: null,
  min_order_minor: 0,
  category_id: null,
  active: true,
  created_at: '',
  updated_at: '',
});

/**
 * §B administrative gate (todo-global-saas-1.md): promotion management is
 * an administrative SaaS feature — it locks while the subscription is not
 * `active` while POS operational runtime continues through grace.
 */
export default function PromotionManagementScreen() {
  const { locked } = useAdminGate();
  if (locked) return <AdminLockedFeature />;
  return <PromotionManagementScreenContent />;
}

function PromotionManagementScreenContent() {
  const { l10n } = useLocalization();
  // Dates follow the active Fluent locale (not the browser default).
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const deleteModalRef = useRef<HTMLDivElement>(null);
  const promoModalRef = useRef<HTMLDivElement>(null);
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [form, setForm] = useState<Promotion>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const { addToast } = useToast();

  const deleteExit = useExitAnimation(!!deleteTarget, () => setDeleteTarget(null));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listPromotions(sessionToken);
      setPromotions(items);
    } catch {
      addToast({ message: requiredLocalized(l10n, 'promotions-error-load'), type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [l10n, addToast, sessionToken]);

  useEffect(() => { load(); }, [load]);

  const openAdd = useCallback(() => {
    setForm(emptyForm());
    setModalMode('add');
  }, []);

  const openEdit = useCallback((p: Promotion) => {
    setForm({ ...p });
    setModalMode('edit');
  }, []);

  const closeModal = useCallback(() => {
    setModalMode(null);
  }, []);

  const modalExit = useExitAnimation(!!modalMode, closeModal);

  useFocusTrap(deleteModalRef, deleteExit.shouldRender && !deleteExit.exiting, deleteExit.requestClose);
  useFocusTrap(promoModalRef, modalExit.shouldRender && !modalExit.exiting, modalExit.requestClose);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (modalMode === 'add') {
        const args: CreatePromotionArgs = {
          name: form.name,
          description: form.description,
          promo_type: form.promo_type,
          value_minor: form.value_minor,
          min_qty: form.min_qty,
          trigger_sku: form.trigger_sku,
          reward_sku: form.reward_sku,
          reward_qty: form.reward_qty,
          starts_at: form.starts_at,
          ends_at: form.ends_at,
          min_order_minor: form.min_order_minor,
          category_id: form.category_id,
        };
        await createPromotion(sessionToken, args);
      } else {
        await updatePromotion(sessionToken, form);
      }
      closeModal();
      await load();
    } catch (err) {
      addToast({ message: l10nErrorMessage(err, l10n, 'promotions-error-save'), type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [form, modalMode, load, closeModal, addToast, l10n, sessionToken]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(deleteTarget.id);
    setDeleteTarget(null);
    try {
      await deletePromotion(sessionToken, deleteTarget.id);
      await load();
    } catch (err) {
      addToast({ message: l10nErrorMessage(err, l10n, 'promotions-error-delete'), type: 'error' });
    } finally {
      setDeleting(null);
    }
  }, [deleteTarget, load, addToast, l10n, sessionToken]);

  const toggleActive = useCallback(async (p: Promotion) => {
    try {
      await updatePromotion(sessionToken, { ...p, active: !p.active });
      await load();
    } catch (err) {
      addToast({ message: l10nErrorMessage(err, l10n, 'promotions-error-toggle'), type: 'error' });
    }
  }, [load, addToast, l10n, sessionToken]);

  return (
    <div className="promo-mgmt">
      <div className="promo-mgmt-header">
        <Localized id="promotions-title">
          <h1 className="promo-mgmt-title">Promotions</h1>
        </Localized>
        <Localized id="promotions-add">
          <Button onClick={openAdd}>Add Promotion</Button>
        </Localized>
      </div>

      {loading ? (
        <div className="promo-mgmt-loading-skeleton" aria-hidden="true">
          <div className="promo-mgmt-header">
            <Skeleton variant="block" width="10rem" height="1.75rem" />
            <Skeleton variant="block" width="9rem" height="2.25rem" />
          </div>
          <div className="promo-mgmt-table-wrap">
            <table className="promo-mgmt-table" aria-hidden="true">
              <thead>
                <tr>
                  {['Name', 'Type', 'Value', 'Active', 'Starts', 'Ends', ''].map((_, i) => (
                    <th key={i}><Skeleton variant="text" width={i < 6 ? '4rem' : '3rem'} height="0.75rem" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>{[0, 1, 2, 3].map((r) => (
                  <tr key={r}>
                    <td><Skeleton variant="text" width="7rem" height="0.875rem" /></td>
                    <td><Skeleton variant="text" width="5rem" height="0.875rem" /></td>
                    <td><Skeleton variant="text" width="3rem" height="0.875rem" /></td>
                    <td><Skeleton variant="block" width="2.5rem" height="1.375rem" style={{ borderRadius: 'var(--radius-full)' }} /></td>
                    <td><Skeleton variant="text" width="5rem" height="0.75rem" /></td>
                    <td><Skeleton variant="text" width="5rem" height="0.75rem" /></td>
                    <td className="promo-mgmt-actions">
                      <Skeleton variant="block" width="3rem" height="1.375rem" />
                      <Skeleton variant="block" width="3rem" height="1.375rem" />
                    </td>
                  </tr>
                ))}
</tbody>
            </table>
          </div>
        </div>
      ) : promotions.length === 0 ? (
        <Card shadow="sm">
          <EmptyState
            region="table"
            icon={<NoPromotionsIcon />}
            title={requiredLocalized(l10n, 'promotions-no-promotions')}
          />
        </Card>
      ) : (
        <div className="promo-mgmt-table-wrap">
          <table className="promo-mgmt-table" role="grid" aria-label={l10n.getString('promotions-table-label')}>
            <thead>
              <tr>
                <Localized id="promotions-name"><th>Name</th></Localized>
                <Localized id="promotions-type"><th>Type</th></Localized>
                <Localized id="promotions-value"><th>Value</th></Localized>
                <Localized id="promotions-active"><th>Active</th></Localized>
                <Localized id="promotions-starts-at"><th>Starts</th></Localized>
                <Localized id="promotions-ends-at"><th>Ends</th></Localized>
                <th aria-label={l10n.getString('promotions-table-actions')}> </th>
              </tr>
            </thead>
            <tbody>{promotions.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <Localized id={PROMO_TYPE_LABELS[p.promo_type] ?? 'promotions-percentage'}>
                      <span>{p.promo_type}</span>
                    </Localized>
                  </td>
                  <td>{p.promo_type === 'percentage' ? `${p.value_minor}%` : p.value_minor}</td>
                  <td>
                    <label className="promo-mgmt-toggle" aria-label={l10n.getString('promotions-toggle-active', { name: p.name })}>
                      <input
                        type="checkbox"
                        checked={p.active}
                        onChange={() => toggleActive(p)}
                      />
                      <span className="promo-mgmt-toggle-slider" />
                    </label>
                  </td>
                  <td>{p.starts_at ? formatDate(p.starts_at, numLocale) : '—'}</td>
                  <td>{p.ends_at ? formatDate(p.ends_at, numLocale) : '—'}</td>
                  <td className="promo-mgmt-actions">
                    <Localized id="promotions-edit">
                      <button type="button" className="promo-mgmt-btn" onClick={() => openEdit(p)} aria-label={l10n.getString('promotions-edit-label', { name: p.name })}>Edit</button>
                    </Localized>
                    <Localized id="promotions-delete">
                      <button type="button" className="promo-mgmt-btn promo-mgmt-btn--danger" onClick={() => setDeleteTarget({ id: p.id, name: p.name })} aria-label={l10n.getString('promotions-delete-label', { name: p.name })}>Delete</button>
                    </Localized>
                  </td>
                </tr>
              ))}
</tbody>
          </table>
        </div>
      )}

      {/* ── Delete confirmation modal ── */}
      {deleteExit.shouldRender && deleteTarget && (
        <div className={`promo-mgmt-overlay${deleteExit.exiting ? ' promo-mgmt-overlay--exiting' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('promotions-modal-delete-label')}>
          <div ref={deleteModalRef} className={`promo-mgmt-modal${deleteExit.exiting ? ' promo-mgmt-modal--exiting' : ''}`}>
            <div className="promo-mgmt-modal-header">
              <Localized id="promotions-delete-confirm-title">
                <h2 className="promo-mgmt-modal-title">Delete Promotion</h2>
              </Localized>
              <button type="button" className="promo-mgmt-modal-close" onClick={deleteExit.requestClose} aria-label={l10n.getString('close')}>&times;</button>
            </div>
            <div className="promo-mgmt-modal-body">
              <Localized id="promotions-delete-confirm" vars={{ name: deleteTarget.name }}>
                <p>Are you sure you want to delete &quot;{deleteTarget.name}&quot;?</p>
              </Localized>
            </div>
            <div className="promo-mgmt-modal-actions">
              <Localized id="cancel">
                <Button variant="ghost" onClick={deleteExit.requestClose} disabled={deleting !== null}>Cancel</Button>
              </Localized>
              <Localized id="delete">
                <Button variant="danger" loading={deleting !== null} onClick={confirmDelete}>Delete</Button>
              </Localized>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit modal ── */}
      {modalExit.shouldRender && modalMode && (
        <div className={`promo-mgmt-overlay${modalExit.exiting ? ' promo-mgmt-overlay--exiting' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString(modalMode === 'add' ? 'promotions-modal-add-label' : 'promotions-modal-edit-label')}>
          <div ref={promoModalRef} className={`promo-mgmt-modal promo-mgmt-modal--wide${modalExit.exiting ? ' promo-mgmt-modal--exiting' : ''}`}>
            <div className="promo-mgmt-modal-header">
              <Localized id={modalMode === 'add' ? 'promotions-add' : 'promotions-edit'}>
                <h2 className="promo-mgmt-modal-title">{modalMode === 'add' ? 'Add Promotion' : 'Edit Promotion'}</h2>
              </Localized>
              <button type="button" className="promo-mgmt-modal-close" onClick={modalExit.requestClose} aria-label={l10n.getString('close')}>&times;</button>
            </div>

            <div className="promo-mgmt-modal-body">
              <div className="promo-mgmt-form">
                <div className="promo-mgmt-field promo-mgmt-field--horizontal">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                  <label htmlFor="promo-field-name"><Localized id="promotions-name"><span>Name</span></Localized></label>
                  <input id="promo-field-name" type="text" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} required aria-label={l10n.getString('promotions-field-name')} />
                </div>

                <div className="promo-mgmt-field promo-mgmt-field--horizontal">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                  <label htmlFor="promo-field-type"><Localized id="promotions-type"><span>Type</span></Localized></label>
                  <select id="promo-field-type" value={form.promo_type} onChange={(e) => setForm((prev) => ({ ...prev, promo_type: e.target.value }))} aria-label={l10n.getString('promotions-field-type')}>
                    {PROMO_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {requiredLocalized(l10n, PROMO_TYPE_LABELS[t] ?? 'promotions-percentage')}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="promo-mgmt-field promo-mgmt-field--horizontal">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                  <label htmlFor="promo-field-value"><Localized id="promotions-value"><span>Value</span></Localized></label>
                  <input id="promo-field-value" type="number" min={0} value={form.value_minor} onChange={(e) => {
                    // Whole number only — ignore fractional in-progress input
                    // instead of silently truncating it via parseInt.
                    const v = Number(e.target.value);
                    if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                      setForm((prev) => ({ ...prev, value_minor: e.target.value === '' ? 0 : v }));
                    }
                  }} aria-label={l10n.getString('promotions-field-value')} />
                </div>

                {form.promo_type === 'buy_x_get_y' && (
                  <>
                    <div className="promo-mgmt-field promo-mgmt-field--horizontal">
                      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                      <label htmlFor="promo-field-min-qty"><Localized id="promotions-min-qty"><span>Min Qty</span></Localized></label>
                      <input id="promo-field-min-qty" type="number" min={0} value={form.min_qty ?? ''} onChange={(e) => {
                        // Whole number only — ignore fractional in-progress input
                        // instead of silently truncating it via parseInt.
                        const v = Number(e.target.value);
                        if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                          setForm((prev) => ({ ...prev, min_qty: e.target.value === '' ? null : v }));
                        }
                      }} aria-label={l10n.getString('promotions-field-min-qty')} />
                    </div>
                    <div className="promo-mgmt-field promo-mgmt-field--horizontal">
                      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                      <label htmlFor="promo-field-trigger-sku"><Localized id="promotions-trigger-sku"><span>Trigger SKU</span></Localized></label>
                      <input id="promo-field-trigger-sku" type="text" value={form.trigger_sku ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, trigger_sku: e.target.value || null }))} aria-label={l10n.getString('promotions-field-trigger-sku')} />
                    </div>
                    <div className="promo-mgmt-field promo-mgmt-field--horizontal">
                      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                      <label htmlFor="promo-field-reward-sku"><Localized id="promotions-reward-sku"><span>Reward SKU</span></Localized></label>
                      <input id="promo-field-reward-sku" type="text" value={form.reward_sku ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, reward_sku: e.target.value || null }))} aria-label={l10n.getString('promotions-field-reward-sku')} />
                    </div>
                    <div className="promo-mgmt-field promo-mgmt-field--horizontal">
                      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                      <label htmlFor="promo-field-reward-qty"><Localized id="promotions-reward-qty"><span>Reward Qty</span></Localized></label>
                      <input id="promo-field-reward-qty" type="number" min={0} value={form.reward_qty ?? ''} onChange={(e) => {
                        // Whole number only — ignore fractional in-progress input
                        // instead of silently truncating it via parseInt.
                        const v = Number(e.target.value);
                        if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                          setForm((prev) => ({ ...prev, reward_qty: e.target.value === '' ? null : v }));
                        }
                      }} aria-label={l10n.getString('promotions-field-reward-qty')} />
                    </div>
                  </>
                )}

                <div className="promo-mgmt-field promo-mgmt-field--horizontal">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                  <label htmlFor="promo-field-starts-at"><Localized id="promotions-field-starts-at"><span>Starts At</span></Localized></label>
                  <input id="promo-field-starts-at" type="datetime-local" value={form.starts_at ? form.starts_at.substring(0, 16) : ''} onChange={(e) => setForm((prev) => ({ ...prev, starts_at: e.target.value ? new Date(e.target.value).toISOString() : null }))} aria-label={l10n.getString('promotions-field-starts-at')} />
                </div>
                <div className="promo-mgmt-field promo-mgmt-field--horizontal">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                  <label htmlFor="promo-field-ends-at"><Localized id="promotions-field-ends-at"><span>Ends At</span></Localized></label>
                  <input id="promo-field-ends-at" type="datetime-local" value={form.ends_at ? form.ends_at.substring(0, 16) : ''} onChange={(e) => setForm((prev) => ({ ...prev, ends_at: e.target.value ? new Date(e.target.value).toISOString() : null }))} aria-label={l10n.getString('promotions-field-ends-at')} />
                </div>

                <div className="promo-mgmt-field promo-mgmt-field--horizontal">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                  <label htmlFor="promo-field-min-order"><Localized id="promotions-min-order"><span>Min Order</span></Localized></label>
                  <input id="promo-field-min-order" type="number" min={0} value={form.min_order_minor} onChange={(e) => {
                    // Whole number only — ignore fractional in-progress input
                    // instead of silently truncating it via parseInt.
                    const v = Number(e.target.value);
                    if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                      setForm((prev) => ({ ...prev, min_order_minor: e.target.value === '' ? 0 : v }));
                    }
                  }} aria-label={l10n.getString('promotions-field-min-order')} />
                </div>

                <div className="promo-mgmt-field promo-mgmt-field--horizontal">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                  <label htmlFor="promo-field-category"><Localized id="promotions-category"><span>Category</span></Localized></label>
                  <input id="promo-field-category" type="text" value={form.category_id ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, category_id: e.target.value || null }))} aria-label={l10n.getString('promotions-field-category')} />
                </div>
              </div>
            </div>

            <div className="promo-mgmt-modal-actions">
              <Localized id="cancel">
                <Button variant="ghost" onClick={modalExit.requestClose} disabled={saving}>Cancel</Button>
              </Localized>
              <Localized id="save">
                <Button variant="primary" loading={saving} disabled={!form.name.trim()} onClick={handleSave}>Save</Button>
              </Localized>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
