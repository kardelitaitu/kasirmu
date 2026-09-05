//! Shift Management Screen
//!
//! Displays the active shift status, a list of all shifts with
//! reconciliation details, and allows opening/closing shifts.

import { useState, useCallback, useEffect, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/frontend/shared/Toast';
import { requiredLocalized } from '@/frontend/shared';
import { l10nErrorMessage } from '@/utils/app-error';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useAnimatedModal } from '@/hooks/useAnimatedModal';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { EmptyState } from '@/frontend/shared';
import { NoShiftsIcon } from '@/components/EmptyStateIllustrations';
import { Skeleton } from '@/components/Skeleton';
import { formatMoney } from '@/types/domain';
import {
  listShiftsScoped,
  openShiftScoped,
  closeShiftScoped,
  getActiveShiftScoped,
  getShiftReportScoped,
  createCashPayoutScoped,
  type ShiftDto,
  type ShiftReportDto,

} from '@/api/shifts';
import './ShiftManagementScreen.css';

// ── Format helper ───────────────────────────────────────────────────

const fmt = (minor: number, currency = 'USD') =>
  formatMoney({ minor_units: minor, currency });

// ── Component ───────────────────────────────────────────────────────

/** Shift management screen — view active shift status, open and close shifts, record cash payouts, and display reconciliation reports. */
export default function ShiftManagementScreen() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const { currency } = useCurrency();
  const [shifts, setShifts] = useState<ShiftDto[]>([]);
  const [activeShift, setActiveShift] = useState<ShiftDto | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Modals ────────────────────────────────────────────────────────
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState<ShiftDto | null>(null);
  const [shiftReport, setShiftReport] = useState<ShiftReportDto | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('');
  const [closingBalance, setClosingBalance] = useState('');
  const [shiftNotes, setShiftNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closedShiftSummary, setClosedShiftSummary] = useState<ShiftDto | null>(null);

  // ── Payout modal state ─────────────────────────────
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutReason, setPayoutReason] = useState('');

  // ── Load data ─────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [allShifts, active] = await Promise.all([
        listShiftsScoped(sessionToken),
        getActiveShiftScoped(sessionToken).catch(() => null),
      ]);
      setShifts(allShifts);
      setActiveShift(active);
    } catch {
      addToast({ message: requiredLocalized(l10n, 'shift-load-error'), type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [sessionToken, l10n, addToast]);

  useEffect(() => { load(); }, [load]);

  // Load shift report when detail modal opens.
  useEffect(() => {
    if (!showDetailModal) {
      setShiftReport(null);
      return;
    }
    setReportLoading(true);
    getShiftReportScoped(sessionToken, showDetailModal.id)
      .then(setShiftReport)
      .catch(() => setShiftReport(null))
      .finally(() => setReportLoading(false));
  }, [showDetailModal, sessionToken]);

  // ── Open shift ────────────────────────────────────────────────────

  const handleOpenShift = useCallback(async () => {
    // SHIFT-03: opening balance is integer minor units — reject fractional
    // input instead of silently truncating it via parseInt.
    const balance = openingBalance.trim() === '' ? 0 : Number(openingBalance);
    if (!Number.isInteger(balance) || balance < 0) {
      setError(requiredLocalized(l10n, 'shift-invalid-opening-balance'));
      return;
    }
    const safeBalance = balance;

    setSaving(true);
    setError(null);
    try {
      await openShiftScoped(sessionToken, safeBalance);
      setShowOpenModal(false);
      setOpeningBalance('');
      await load();
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'shift-open-error'));
    } finally {
      setSaving(false);
    }
  }, [openingBalance, sessionToken, load, l10n]);

  // ── Close shift ───────────────────────────────────────────────────

  const handleCloseShift = useCallback(async () => {
    if (!activeShift) return;
    const balance = Number(closingBalance);
    if (!Number.isInteger(balance) || balance < 0) {
      setError(requiredLocalized(l10n, 'shift-invalid-balance'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const closed = await closeShiftScoped(
        sessionToken,
        activeShift.id,
        balance,
        shiftNotes.trim() || null,
      );
      setShowCloseModal(false);
      setClosedShiftSummary(closed);
      setActiveShift(null);
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'shift-close-error'));
    } finally {
      setSaving(false);
    }
  }, [activeShift, closingBalance, shiftNotes, sessionToken, l10n]);


  const dismissCloseSummary = useCallback(async () => {
    setClosedShiftSummary(null);
    setShowCloseModal(false);
    setClosingBalance('');
    setShiftNotes('');
    setError(null);
    await load();
  }, [load]);

  // ── Create payout ─────────────────────────────────────────────────

  const handleCreatePayout = useCallback(async () => {
    if (!activeShift) return;
    const amount = Number(payoutAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError(requiredLocalized(l10n, 'shift-invalid-payout-amount'));
      return;
    }
    const reason = payoutReason.trim() || 'safe drop';

    setSaving(true);
    setError(null);
    try {
      await createCashPayoutScoped(sessionToken, activeShift.id, amount, reason);
      setShowPayoutModal(false);
      setPayoutAmount('');
      setPayoutReason('');
      await load();
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'shift-payout-error'));
    } finally {
      setSaving(false);
    }
    // sessionToken is read at :182 by createCashPayoutScoped -- this moves cash out of a shift,
    // so it is the most consequential of the remaining sites. With the token missing, a payout
    // submitted after a cashier hot-swap presented the destroyed session: the write failed and
    // surfaced as a generic retryable error, so the operator would press Save again on a form
    // that could not succeed until the screen remounted. :186 also awaits load(), which now
    // refreshes against the same session as the write.
  }, [activeShift, payoutAmount, payoutReason, load, l10n, sessionToken]);

  // ── Format time/date helpers ───────────────────────────────────────

  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(numLocale, { hour: '2-digit', minute: '2-digit' });

  const dateTime = (iso: string) =>
    new Date(iso).toLocaleString(numLocale, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  // ── Modal animation states ────────────────────────
  const { mounted: mOpen, exiting: eOpen } = useAnimatedModal(showOpenModal);
  const { mounted: mPayout, exiting: ePayout } = useAnimatedModal(showPayoutModal);
  const { mounted: mClose, exiting: eClose } = useAnimatedModal(showCloseModal);
  const { mounted: mClosedSum, exiting: eClosedSum } = useAnimatedModal(!!closedShiftSummary);
  const { mounted: mDetail, exiting: eDetail } = useAnimatedModal(!!showDetailModal);

  // ── Focus trap refs ───────────────────────────────
  const openPanelRef = useRef<HTMLDivElement>(null);
  const payoutPanelRef = useRef<HTMLDivElement>(null);
  const closePanelRef = useRef<HTMLDivElement>(null);
  const closedSumPanelRef = useRef<HTMLDivElement>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(openPanelRef, mOpen && !eOpen, () => { setShowOpenModal(false); setError(null); });
  useFocusTrap(payoutPanelRef, mPayout && !ePayout, () => { setShowPayoutModal(false); setPayoutAmount(''); setPayoutReason(''); setError(null); });
  useFocusTrap(closePanelRef, mClose && !eClose, () => { setShowCloseModal(false); setClosingBalance(''); setShiftNotes(''); setError(null); });
  useFocusTrap(closedSumPanelRef, mClosedSum && !eClosedSum, dismissCloseSummary);
  useFocusTrap(detailPanelRef, mDetail && !eDetail, () => setShowDetailModal(null));

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="shift-mgmt">
      <div className="shift-mgmt-header">
        <Localized id="shift-title">
          <h1 className="shift-mgmt-title">Shift Management</h1>
        </Localized>
      </div>

      {loading && (
        <div className="shift-mgmt-loading-skeleton">
          {/* Active shift card skeleton */}
          <Card shadow="md" className="shift-mgmt-active-card">
            <div className="shift-mgmt-active-header">
              <Skeleton variant="block" width="7rem" height="1.25rem" />
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Skeleton variant="block" width="7rem" height="2rem" />
                <Skeleton variant="block" width="7rem" height="2rem" />
              </div>
            </div>
            <div className="shift-mgmt-active-details">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="shift-mgmt-active-stat">
                  <Skeleton variant="text" width="3rem" />
                  <Skeleton variant="text" width="5rem" />
                </div>
              ))}
            </div>
          </Card>

          {/* Table skeleton */}
          <Card shadow="sm" className="shift-mgmt-table-card">
            <Skeleton variant="block" width="8rem" height="1.25rem" style={{ marginBottom: 'var(--space-3)' }} />
            <div className="shift-mgmt-table-wrap">
              <table className="shift-mgmt-table" aria-hidden="true">
                <thead>
                  <tr>
                    <Localized id="shift-table-status"><th>Status</th></Localized>
                    <Localized id="shift-table-opened"><th>Opened</th></Localized>
                    <Localized id="shift-table-closed"><th>Closed</th></Localized>
                    <Localized id="shift-table-opening"><th>Opening</th></Localized>
                    <Localized id="shift-table-counted"><th>Counted</th></Localized>
                    <Localized id="shift-table-expected"><th>Expected</th></Localized>
                    <Localized id="shift-table-diff"><th>Diff</th></Localized>
                    <Localized id="shift-table-sales"><th>Sales</th></Localized>
                    <Localized id="shift-table-actions"><th>Actions</th></Localized>
                  </tr>
                </thead>
                <tbody>{Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      <td><Skeleton variant="block" width="3.5rem" height="1.25rem" /></td>
                      <td><Skeleton variant="text" width="7rem" /></td>
                      <td><Skeleton variant="text" width="7rem" /></td>
                      <td><Skeleton variant="text" width="4rem" /></td>
                      <td><Skeleton variant="text" width="4rem" /></td>
                      <td><Skeleton variant="text" width="4rem" /></td>
                      <td><Skeleton variant="text" width="4rem" /></td>
                      <td><Skeleton variant="text" width="4rem" /></td>
                      <td><Skeleton variant="block" width="2.5rem" height="1.25rem" /></td>
                    </tr>
                  ))}
</tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {!loading && (
        <>
          {/* ── Active shift card ──────────────────────── */}
          {activeShift && !closedShiftSummary && (
            <Card shadow="md" className="shift-mgmt-active-card">
              <div className="shift-mgmt-active-header">
                <div className="shift-mgmt-active-info">
                  <span className="shift-mgmt-active-dot" />
                  <Localized id="shift-active-label">
                    <span className="shift-mgmt-active-label">Active Shift</span>
                  </Localized>
                </div>
                <div className="shift-mgmt-active-actions">
                  <Localized id="shift-btn-payout">
                    <button
                      type="button"
                      className="shift-mgmt-payout-btn"
                      onClick={() => {
                        setPayoutAmount('');
                        setPayoutReason('');
                        setError(null);
                        setShowPayoutModal(true);
                      }}
                      aria-label={l10n.getString('shift-btn-payout-label')}
                    >
                      Record Payout
                    </button>
                  </Localized>
                  <Localized id="shift-btn-close">
                    <button
                      type="button"
                      className="shift-mgmt-close-btn"
                      onClick={() => {
                        setClosingBalance('');
                        setShiftNotes('');
                        setError(null);
                        setShowCloseModal(true);
                      }}
                      aria-label={l10n.getString('shift-btn-close-label')}
                    >
                      Close Shift
                    </button>
                  </Localized>
                </div>
              </div>
              <div className="shift-mgmt-active-details">
                <div className="shift-mgmt-active-stat">
                  <Localized id="shift-stat-since">
                    <span className="shift-mgmt-stat-label">Since</span>
                  </Localized>
                  <span className="shift-mgmt-stat-value">
                    {time(activeShift.openedAt)}
                  </span>
                </div>
                <div className="shift-mgmt-active-stat">
                  <Localized id="shift-opening-balance">
                    <span className="shift-mgmt-stat-label">Opening Balance</span>
                  </Localized>
                  <span className="shift-mgmt-stat-value">
                    {fmt(activeShift.openingBalanceMinor, currency)}
                  </span>
                </div>
                <div className="shift-mgmt-active-stat">
                  <Localized id="shift-stat-sales">
                    <span className="shift-mgmt-stat-label">Sales</span>
                  </Localized>
                  <span className="shift-mgmt-stat-value">
                    {fmt(activeShift.totalSalesMinor, currency)}
                  </span>
                </div>
                <div className="shift-mgmt-active-stat">
                  <Localized id="shift-stat-cash-sales">
                    <span className="shift-mgmt-stat-label">Cash Sales</span>
                  </Localized>
                  <span className="shift-mgmt-stat-value">
                    {fmt(activeShift.totalCashMinor, currency)}
                  </span>
                </div>
                <div className="shift-mgmt-active-stat">
                  <Localized id="shift-stat-card-sales">
                    <span className="shift-mgmt-stat-label">Card Sales</span>
                  </Localized>
                  <span className="shift-mgmt-stat-value">
                    {fmt(activeShift.totalCardMinor, currency)}
                  </span>
                </div>
                <div className="shift-mgmt-active-stat">
                  <Localized id="shift-stat-transactions">
                    <span className="shift-mgmt-stat-label">Transactions</span>
                  </Localized>
                  <span className="shift-mgmt-stat-value">
                    <Localized id={activeShift.totalSalesMinor > 0 ? 'shift-stat-active' : 'shift-stat-none'}>{activeShift.totalSalesMinor > 0 ? 'Active' : 'None'}</Localized>
                  </span>
                </div>
              </div>
            </Card>
          )}

          {/* ── No active shift banner ──────────────────── */}
          {!activeShift && !closedShiftSummary && (
            <Card shadow="sm" className="shift-mgmt-no-active">
              <div className="shift-mgmt-no-active-content">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div>
                  <Localized id="shift-no-active-title">
                    <p className="shift-mgmt-no-active-title">No active shift</p>
                  </Localized>
                  <Localized id="shift-no-active-sub">
                    <p className="shift-mgmt-no-active-sub">
                      Open a shift to start tracking cashier sessions.
                    </p>
                  </Localized>
                </div>
                <Localized id="shift-btn-open">
                  <Button onClick={() => { setOpeningBalance(''); setError(null); setShowOpenModal(true); }}>
                    Open Shift
                  </Button>
                </Localized>
              </div>
            </Card>
          )}

          {/* ── Shifts table ────────────────────────────── */}
          <Card shadow="sm" className="shift-mgmt-table-card">
            <Localized id="shift-table-title">
              <h2 className="shift-mgmt-table-title">Shift History</h2>
            </Localized>

            {shifts.length === 0 ? (
              <div className="shift-mgmt-empty">
                <EmptyState
                  icon={<NoShiftsIcon />}
                  title={requiredLocalized(l10n, 'shift-empty')}
                />
              </div>
            ) : (
              <div className="shift-mgmt-table-wrap">
                <table className="shift-mgmt-table" aria-label={l10n.getString('shift-table-label')}>
                  <thead>
                    <tr>
                      <Localized id="shift-table-status"><th>Status</th></Localized>
                      <Localized id="shift-table-opened"><th>Opened</th></Localized>
                      <Localized id="shift-table-closed"><th>Closed</th></Localized>
                      <Localized id="shift-table-opening"><th>Opening</th></Localized>
                      <Localized id="shift-table-counted"><th>Counted</th></Localized>
                      <Localized id="shift-table-expected"><th>Expected</th></Localized>
                      <Localized id="shift-table-diff"><th>Diff</th></Localized>
                      <Localized id="shift-table-sales"><th>Sales</th></Localized>
                      <Localized id="shift-table-actions"><th>Actions</th></Localized>
                    </tr>
                  </thead>
                  <tbody>{shifts.map((s) => {
                      const diff = s.cashDifferenceMinor;
                      const diffClass =
                        diff !== null && diff < 0
                          ? 'shift-mgmt-diff--negative'
                          : diff !== null && diff > 0
                            ? 'shift-mgmt-diff--positive'
                            : '';
                      return (
                        <tr key={s.id} className={s.status === 'open' ? 'shift-mgmt-row--open' : ''}>
                          <td>
                            <span className={`shift-mgmt-status-badge shift-mgmt-status-badge--${s.status}`}>
                              <Localized id={s.status === 'open' ? 'shift-status-open' : 'shift-status-closed'}>
                                <span>{s.status === 'open' ? 'Open' : 'Closed'}</span>
                              </Localized>
                            </span>
                          </td>
                          <td className="shift-mgmt-cell-date">{dateTime(s.openedAt)}</td>
                          <td className="shift-mgmt-cell-date">
                            {s.closedAt ? dateTime(s.closedAt) : '—'}
                          </td>
                          <td className="shift-mgmt-cell-mono">{fmt(s.openingBalanceMinor, currency)}</td>
                          <td className="shift-mgmt-cell-mono">
                            {s.closingBalanceMinor !== null ? fmt(s.closingBalanceMinor, currency) : '—'}
                          </td>
                          <td className="shift-mgmt-cell-mono">
                            {s.expectedCashMinor !== null ? fmt(s.expectedCashMinor, currency) : '—'}
                          </td>
                          <td className={`shift-mgmt-cell-mono ${diffClass}`}>
                            {diff !== null ? fmt(diff, currency) : '—'}
                            {diff !== null && diff !== 0 && (
                              <span className="shift-mgmt-tag">
                                <Localized id={diff > 0 ? 'shift-tag-over' : 'shift-tag-short'}>
                                  <span>{diff > 0 ? 'Over' : 'Short'}</span>
                                </Localized>
                              </span>
                            )}
                          </td>
                          <td className="shift-mgmt-cell-mono">{fmt(s.totalSalesMinor, currency)}</td>
                          <td>
                            <Localized id="shift-btn-view">
                              <button
                                type="button"
                                className="shift-mgmt-view-btn"
                                onClick={() => setShowDetailModal(s)}
                                aria-label={l10n.getString('shift-btn-view')}
                              >
                                View
                              </button>
                            </Localized>
                          </td>
                        </tr>
                      );
                    })}
</tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── Open Shift Modal ──────────────────────────── */}
      {mOpen && (
        <div className={`shift-mgmt-overlay${eOpen ? ' shift-overlay-exit' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('shift-modal-open-label')}>
          <div ref={openPanelRef} className={`shift-mgmt-modal${eOpen ? ' shift-modal-exit' : ''}`}>
            <div className="shift-mgmt-modal-header">
              <Localized id="shift-modal-open-title">
                <h2>Open Shift</h2>
              </Localized>
              <button
                type="button"
                className="shift-mgmt-modal-close"
                onClick={() => setShowOpenModal(false)}
                aria-label={l10n.getString('close')}
                disabled={saving}
              >
                &times;
              </button>
            </div>
            <div className="shift-mgmt-modal-body">
              {error && (
                <div className="shift-mgmt-modal-error" role="alert">{error}</div>
              )}
              <div className="shift-mgmt-field shift-mgmt-field--horizontal">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
                <label htmlFor="open-balance" className="shift-mgmt-label">
                  <Localized id="shift-open-balance-label">
                    <span>Opening balance (minor units)</span>
                  </Localized>
                </label>
                <Localized id="shift-open-balance-placeholder" attrs={{ placeholder: true }}>
                  <input
                    id="open-balance"
                    type="number"
                    className="shift-mgmt-input"
                    min="0"
                    placeholder="e.g. 500 for $5.00"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                    aria-label={l10n.getString('shift-field-opening-balance')}
                    disabled={saving}
                  />
                </Localized>
              </div>
            </div>
            <div className="shift-mgmt-modal-actions">
              <Localized id="shift-btn-cancel">
                <Button variant="ghost" onClick={() => setShowOpenModal(false)} disabled={saving}>
                  Cancel
                </Button>
              </Localized>
              <Localized id="shift-btn-open">
                <Button variant="primary" onClick={handleOpenShift} loading={saving}>
                  Open Shift
                </Button>
              </Localized>
            </div>
          </div>
        </div>
      )}

      {/* ── Payout Modal ─────────────────────────────── */}
      {mPayout && activeShift && (
        <div className={`shift-mgmt-overlay${ePayout ? ' shift-overlay-exit' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('shift-modal-payout-label')}>
          <div ref={payoutPanelRef} className={`shift-mgmt-modal${ePayout ? ' shift-modal-exit' : ''}`}>
            <div className="shift-mgmt-modal-header">
              <Localized id="shift-modal-payout-title">
                <h2>Record Cash Payout</h2>
              </Localized>
              <button
                type="button"
                className="shift-mgmt-modal-close"
                onClick={() => setShowPayoutModal(false)}
                aria-label={l10n.getString('close')}
                disabled={saving}
              >
                &times;
              </button>
            </div>
            <div className="shift-mgmt-modal-body">
              {error && (
                <div className="shift-mgmt-modal-error" role="alert">{error}</div>
              )}
              <Localized id="shift-payout-hint">
                <p className="shift-mgmt-payout-hint">
                  Record cash removed from the drawer (safe drop, manager pickup, etc.).
                </p>
              </Localized>
              <div className="shift-mgmt-field shift-mgmt-field--horizontal">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
                <label htmlFor="payout-amount" className="shift-mgmt-label">
                  <Localized id="shift-payout-amount-label">
                    <span>Amount (minor units)</span>
                  </Localized>
                </label>
                <Localized id="shift-payout-amount-placeholder" attrs={{ placeholder: true }}>
                  <input
                    id="payout-amount"
                    type="number"
                    className="shift-mgmt-input"
                    min="1"
                    placeholder="e.g. 20000 for $200.00"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    aria-label={l10n.getString('shift-field-payout-amount')}
                    disabled={saving}
                  />
                </Localized>
              </div>
              <div className="shift-mgmt-field shift-mgmt-field--horizontal">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
                <label htmlFor="payout-reason" className="shift-mgmt-label">
                  <Localized id="shift-payout-reason-label">
                    <span>Reason</span>
                  </Localized>
                </label>
                <Localized id="shift-payout-reason-placeholder" attrs={{ placeholder: true }}>
                  <input
                    id="payout-reason"
                    type="text"
                    className="shift-mgmt-input"
                    placeholder="e.g. bank drop, manager pickup"
                    value={payoutReason}
                    onChange={(e) => setPayoutReason(e.target.value)}
                    aria-label={l10n.getString('shift-field-payout-reason')}
                    disabled={saving}
                  />
                </Localized>
              </div>
            </div>
            <div className="shift-mgmt-modal-actions">
              <Localized id="shift-btn-cancel">
                <Button variant="ghost" onClick={() => setShowPayoutModal(false)} disabled={saving}>
                  Cancel
                </Button>
              </Localized>
              <Localized id="shift-btn-payout">
                <Button
                  variant="primary"
                  onClick={handleCreatePayout}
                  loading={saving}
                  disabled={!payoutAmount || !Number.isInteger(Number(payoutAmount)) || Number(payoutAmount) <= 0}
                >
                  Record Payout
                </Button>
              </Localized>
            </div>
          </div>
        </div>
      )}

      {/* ── Close Shift Modal ─────────────────────────── */}
      {mClose && activeShift && (
        <div className={`shift-mgmt-overlay${eClose ? ' shift-overlay-exit' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('shift-modal-close-label')}>
          <div ref={closePanelRef} className={`shift-mgmt-modal shift-mgmt-modal--wide${eClose ? ' shift-modal-exit' : ''}`}>
            <div className="shift-mgmt-modal-header">
              <Localized id="shift-modal-close-title">
                <h2>Close Shift</h2>
              </Localized>
              <button
                type="button"
                className="shift-mgmt-modal-close"
                onClick={() => setShowCloseModal(false)}
                aria-label={l10n.getString('close')}
                disabled={saving}
              >
                &times;
              </button>
            </div>
            <div className="shift-mgmt-modal-body">
              {error && (
                <div className="shift-mgmt-modal-error" role="alert">{error}</div>
              )}

              {/* Reconciliation breakdown */}
              <div className="shift-mgmt-recon">
                <Localized id="shift-recon-title">
                  <h3 className="shift-mgmt-recon-title">Cash Reconciliation</h3>
                </Localized>
                <div className="shift-mgmt-recon-row">
                  <Localized id="shift-recon-opening">
                    <span>Opening balance</span>
                  </Localized>
                  <span className="shift-mgmt-cell-mono">{fmt(activeShift.openingBalanceMinor, currency)}</span>
                </div>
                <div className="shift-mgmt-recon-row">
                  <Localized id="shift-recon-cash-sales">
                    <span>+ Cash sales</span>
                  </Localized>
                  <span className="shift-mgmt-cell-mono">{fmt(activeShift.totalCashMinor, currency)}</span>
                </div>
                <div className="shift-mgmt-recon-row">
                  <Localized id="shift-recon-payouts">
                    <span>− Payouts</span>
                  </Localized>
                  <span className="shift-mgmt-cell-mono">−{fmt(activeShift.totalPayoutsMinor, currency)}</span>
                </div>
                <div className="shift-mgmt-recon-row shift-mgmt-recon-row--total">
                  <Localized id="shift-recon-expected">
                    <span>Expected in drawer</span>
                  </Localized>
                  <span className="shift-mgmt-cell-mono">
                    {fmt(activeShift.openingBalanceMinor + activeShift.totalCashMinor - activeShift.totalPayoutsMinor, currency)}
                  </span>
                </div>
                <div className="shift-mgmt-recon-divider" />
                <div className="shift-mgmt-close-info-row">
                  <Localized id="shift-recon-opened">
                    <span>Shift opened</span>
                  </Localized>
                  <span>{dateTime(activeShift.openedAt)}</span>
                </div>
                <div className="shift-mgmt-close-info-row">
                  <Localized id="shift-recon-sales">
                    <span>Sales this shift</span>
                  </Localized>
                  <span>{fmt(activeShift.totalSalesMinor, currency)}</span>
                </div>
              </div>

              <div className="shift-mgmt-field shift-mgmt-field--horizontal">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
                <label htmlFor="close-balance" className="shift-mgmt-label">
                  <Localized id="shift-close-counted-label">
                    <span>Counted cash in drawer (minor units)</span>
                  </Localized>
                </label>
                <Localized id="shift-close-counted-placeholder" attrs={{ placeholder: true }}>
                  <input
                    id="close-balance"
                    type="number"
                    className="shift-mgmt-input"
                    min="0"
                    placeholder="e.g. 15000 for $150.00"
                    value={closingBalance}
                    onChange={(e) => setClosingBalance(e.target.value)}
                    aria-label={l10n.getString('shift-field-closing-balance')}
                    disabled={saving}
                  />
                </Localized>
              </div>

              <div className="shift-mgmt-field shift-mgmt-field--horizontal">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
                <label htmlFor="close-notes" className="shift-mgmt-label">
                  <Localized id="shift-close-notes-label">
                    <span>Notes (optional)</span>
                  </Localized>
                </label>
                <Localized id="shift-close-notes-placeholder" attrs={{ placeholder: true }}>
                  <textarea
                    id="close-notes"
                    className="shift-mgmt-textarea"
                    rows={2}
                    placeholder="Any notes about this shift…"
                    value={shiftNotes}
                    onChange={(e) => setShiftNotes(e.target.value)}
                    aria-label={l10n.getString('shift-field-notes')}
                    disabled={saving}
                  />
                </Localized>
              </div>
            </div>
            <div className="shift-mgmt-modal-actions">
              <Localized id="shift-btn-cancel">
                <Button variant="ghost" onClick={() => setShowCloseModal(false)} disabled={saving}>
                  Cancel
                </Button>
              </Localized>
              <Localized id="shift-btn-close">
                <Button
                  variant="primary"
                  onClick={handleCloseShift}
                  loading={saving}
                  disabled={!closingBalance || !Number.isInteger(Number(closingBalance)) || Number(closingBalance) < 0}
                >
                  Close Shift
                </Button>
              </Localized>
            </div>
          </div>
        </div>
      )}

      {/* ── Closed Shift Summary ──────────────────────── */}
      {mClosedSum && closedShiftSummary && (
        <div className={`shift-mgmt-overlay${eClosedSum ? ' shift-overlay-exit' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('shift-modal-closed-label')}>
          <div ref={closedSumPanelRef} className={`shift-mgmt-modal${eClosedSum ? ' shift-modal-exit' : ''}`}>
            <div className="shift-mgmt-modal-header">
              <Localized id="shift-modal-closed-title">
                <h2>Shift Closed</h2>
              </Localized>
            </div>
            <div className="shift-mgmt-modal-body">
              {(() => {
                if (!closedShiftSummary) return null;
                const s = closedShiftSummary;
                return (
                  <>
              <div className="shift-mgmt-summary-grid">
                <div className="shift-mgmt-summary-item">
                  <Localized id="shift-summary-total-sales">
                    <span className="shift-mgmt-summary-label">Total Sales</span>
                  </Localized>
                  <span className="shift-mgmt-summary-value">{fmt(s.totalSalesMinor, currency)}</span>
                </div>
                <div className="shift-mgmt-summary-item">
                  <Localized id="shift-summary-cash-sales">
                    <span className="shift-mgmt-summary-label">Cash Sales</span>
                  </Localized>
                  <span className="shift-mgmt-summary-value">{fmt(s.totalCashMinor, currency)}</span>
                </div>
                <div className="shift-mgmt-summary-item">
                  <Localized id="shift-summary-card-sales">
                    <span className="shift-mgmt-summary-label">Card Sales</span>
                  </Localized>
                  <span className="shift-mgmt-summary-value">{fmt(s.totalCardMinor, currency)}</span>
                </div>
                <div className="shift-mgmt-summary-item">
                  <Localized id="shift-summary-expected-cash">
                    <span className="shift-mgmt-summary-label">Expected Cash</span>
                  </Localized>
                  <span className="shift-mgmt-summary-value">
                    {s.expectedCashMinor !== null ? fmt(s.expectedCashMinor, currency) : '—'}
                  </span>
                </div>
                <div className="shift-mgmt-summary-item">
                  <Localized id="shift-summary-counted">
                    <span className="shift-mgmt-summary-label">Counted</span>
                  </Localized>
                  <span className="shift-mgmt-summary-value">
                    {s.closingBalanceMinor !== null ? fmt(s.closingBalanceMinor, currency) : '—'}
                  </span>
                </div>
                <div className="shift-mgmt-summary-item">
                  <Localized id="shift-summary-difference">
                    <span className="shift-mgmt-summary-label">Difference</span>
                  </Localized>
                  <span className={`shift-mgmt-summary-value ${
                    s.cashDifferenceMinor !== null && s.cashDifferenceMinor < 0
                      ? 'shift-mgmt-diff--negative'
                      : s.cashDifferenceMinor !== null && s.cashDifferenceMinor > 0
                        ? 'shift-mgmt-diff--positive'
                        : ''
                  }`}>
                    {s.cashDifferenceMinor !== null ? fmt(s.cashDifferenceMinor, currency) : '—'}
                    {s.cashDifferenceMinor !== null && s.cashDifferenceMinor !== 0 && (
                      <span className="shift-mgmt-tag">
                        <Localized id={s.cashDifferenceMinor > 0 ? 'shift-tag-over' : 'shift-tag-short'}>
                          <span>{s.cashDifferenceMinor > 0 ? 'Over' : 'Short'}</span>
                        </Localized>
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {s.notes && (
                <div className="shift-mgmt-summary-notes">
                  <Localized id="shift-summary-notes">
                    <span className="shift-mgmt-summary-label">Notes</span>
                  </Localized>
                  <p>{s.notes}</p>
                </div>
              )}
                  </>
                );
              })()}
            </div>
            <div className="shift-mgmt-modal-actions">
              <Localized id="shift-btn-done">
                <Button variant="primary" onClick={dismissCloseSummary}>
                  Done
                </Button>
              </Localized>
            </div>
          </div>
        </div>
      )}

      {/* ── Shift Detail Modal ────────────────────────── */}
      {mDetail && showDetailModal && (() => {
        if (!showDetailModal) return null;
        const s = showDetailModal;
        return (
        <div className={`shift-mgmt-overlay${eDetail ? ' shift-overlay-exit' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('shift-modal-detail-label')}>
          <div ref={detailPanelRef} className={`shift-mgmt-modal shift-mgmt-modal--wide${eDetail ? ' shift-modal-exit' : ''}`}>
            <div className="shift-mgmt-modal-header">
              <Localized id="shift-modal-detail-title">
                <h2>Shift Details</h2>
              </Localized>
              <button
                type="button"
                className="shift-mgmt-modal-close"
                onClick={() => setShowDetailModal(null)}
                aria-label={l10n.getString('close')}
              >
                &times;
              </button>
            </div>
            <div className="shift-mgmt-modal-body">
              <div className="shift-mgmt-detail-grid">
                <div className="shift-mgmt-detail-row">
                  <Localized id="shift-detail-status">
                    <span>Status</span>
                  </Localized>
                  <span className={`shift-mgmt-status-badge shift-mgmt-status-badge--${s.status}`}>
                    <Localized id={s.status === 'open' ? 'shift-status-open' : 'shift-status-closed'}>
                      <span>{s.status === 'open' ? 'Open' : 'Closed'}</span>
                    </Localized>
                  </span>
                </div>
                <div className="shift-mgmt-detail-row">
                  <Localized id="shift-detail-opened">
                    <span>Opened</span>
                  </Localized>
                  <span>{dateTime(s.openedAt)}</span>
                </div>
                <div className="shift-mgmt-detail-row">
                  <Localized id="shift-detail-closed">
                    <span>Closed</span>
                  </Localized>
                  <span>{s.closedAt ? dateTime(s.closedAt) : '—'}</span>
                </div>
                <div className="shift-mgmt-detail-row">
                  <Localized id="shift-detail-opening-balance">
                    <span>Opening Balance</span>
                  </Localized>
                  <span className="shift-mgmt-cell-mono">{fmt(s.openingBalanceMinor, currency)}</span>
                </div>
                <div className="shift-mgmt-detail-row">
                  <Localized id="shift-detail-closing-balance">
                    <span>Closing Balance</span>
                  </Localized>
                  <span className="shift-mgmt-cell-mono">
                    {s.closingBalanceMinor !== null ? fmt(s.closingBalanceMinor, currency) : '—'}
                  </span>
                </div>
                <div className="shift-mgmt-detail-row">
                  <Localized id="shift-detail-expected-cash">
                    <span>Expected Cash</span>
                  </Localized>
                  <span className="shift-mgmt-cell-mono">
                    {s.expectedCashMinor !== null ? fmt(s.expectedCashMinor, currency) : '—'}
                  </span>
                </div>
                <div className="shift-mgmt-detail-row">
                  <Localized id="shift-detail-difference">
                    <span>Difference</span>
                  </Localized>
                  <span className={`shift-mgmt-cell-mono ${
                    s.cashDifferenceMinor !== null && s.cashDifferenceMinor < 0
                      ? 'shift-mgmt-diff--negative'
                      : s.cashDifferenceMinor !== null && s.cashDifferenceMinor > 0
                        ? 'shift-mgmt-diff--positive'
                        : ''
                  }`}>
                    {s.cashDifferenceMinor !== null ? fmt(s.cashDifferenceMinor, currency) : '—'}
                    {s.cashDifferenceMinor !== null && s.cashDifferenceMinor !== 0 && (
                      <span className="shift-mgmt-tag">
                        <Localized id={s.cashDifferenceMinor > 0 ? 'shift-tag-over' : 'shift-tag-short'}>
                          <span>{s.cashDifferenceMinor > 0 ? 'Over' : 'Short'}</span>
                        </Localized>
                      </span>
                    )}
                  </span>
                </div>
                <div className="shift-mgmt-detail-row">
                  <Localized id="shift-detail-total-sales">
                    <span>Total Sales</span>
                  </Localized>
                  <span className="shift-mgmt-cell-mono">{fmt(s.totalSalesMinor, currency)}</span>
                </div>
                <div className="shift-mgmt-detail-row">
                  <Localized id="shift-detail-cash-sales">
                    <span>Cash Sales</span>
                  </Localized>
                  <span className="shift-mgmt-cell-mono">{fmt(s.totalCashMinor, currency)}</span>
                </div>
                <div className="shift-mgmt-detail-row">
                  <Localized id="shift-detail-card-sales">
                    <span>Card Sales</span>
                  </Localized>
                  <span className="shift-mgmt-cell-mono">{fmt(s.totalCardMinor, currency)}</span>
                </div>
                <div className="shift-mgmt-detail-row">
                  <Localized id="shift-detail-other-sales">
                    <span>Other Sales</span>
                  </Localized>
                  <span className="shift-mgmt-cell-mono">{fmt(s.totalOtherMinor, currency)}</span>
                </div>
                <div className="shift-mgmt-detail-row">
                  <Localized id="shift-detail-voids">
                    <span>Voids</span>
                  </Localized>
                  <span className="shift-mgmt-cell-mono">{fmt(s.totalVoidsMinor, currency)}</span>
                </div>
                <div className="shift-mgmt-detail-row">
                  <Localized id="shift-detail-refunds">
                    <span>Refunds</span>
                  </Localized>
                  <span className="shift-mgmt-cell-mono">{fmt(s.totalRefundsMinor, currency)}</span>
                </div>
              </div>

              {/* ── Shift Report sections ──────────────── */}
              {reportLoading && (
                <div className="shift-mgmt-report-skeleton" aria-hidden="true">
                  <Skeleton variant="block" width="8rem" height="0.875rem" style={{ marginBottom: 'var(--space-2)' }} />
                  {Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="shift-mgmt-report-skeleton-row">
                      <Skeleton width="40%" height="0.75rem" />
                      <Skeleton width="30%" height="0.75rem" />
                    </div>
                  ))}
                </div>
              )}

              {shiftReport && !reportLoading && (
                <>
                  {/* Payment breakdown */}
                  {shiftReport.paymentBreakdown.length > 0 && (
                    <div className="shift-mgmt-report-section">
                      <Localized id="shift-report-payment-breakdown">
                        <h3 className="shift-mgmt-report-title">Payment Breakdown</h3>
                      </Localized>
                      <div className="shift-mgmt-report-table">
                        <div className="shift-mgmt-report-table-header">
                          <Localized id="shift-report-col-method">
                            <span>Method</span>
                          </Localized>
                          <Localized id="shift-report-col-transactions">
                            <span>Transactions</span>
                          </Localized>
                          <Localized id="shift-report-col-total">
                            <span>Total</span>
                          </Localized>
                        </div>
                        {shiftReport.paymentBreakdown.map((pmt) => (
                          <div key={pmt.method} className="shift-mgmt-report-row">
                            <span>{pmt.method.charAt(0).toUpperCase() + pmt.method.slice(1)}</span>
                            <span className="shift-mgmt-cell-mono">{pmt.count}</span>
                            <span className="shift-mgmt-cell-mono">{fmt(pmt.totalMinor, currency)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Hourly breakdown */}
                  {shiftReport.hourlyBreakdown.length > 0 && (
                    <div className="shift-mgmt-report-section">
                      <Localized id="shift-report-hourly-sales">
                        <h3 className="shift-mgmt-report-title">Hourly Sales</h3>
                      </Localized>
                      <div className="shift-mgmt-report-table">
                        <div className="shift-mgmt-report-table-header">
                          <Localized id="shift-report-col-hour">
                            <span>Hour</span>
                          </Localized>
                          <Localized id="shift-report-col-sales">
                            <span>Sales</span>
                          </Localized>
                          <Localized id="shift-report-col-total">
                            <span>Total</span>
                          </Localized>
                        </div>
                        {shiftReport.hourlyBreakdown.map((h) => (
                          <div key={h.hour} className="shift-mgmt-report-row">
                            <span>{String(h.hour).padStart(2, '0')}:00</span>
                            <span className="shift-mgmt-cell-mono">{h.saleCount}</span>
                            <span className="shift-mgmt-cell-mono">{fmt(h.totalMinor, currency)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Counts summary */}
                  {(shiftReport.saleCount > 0 || shiftReport.voidCount > 0 || shiftReport.refundCount > 0) && (
                    <div className="shift-mgmt-report-section">
                      <Localized id="shift-report-transaction-summary">
                        <h3 className="shift-mgmt-report-title">Transaction Summary</h3>
                      </Localized>
                      <div className="shift-mgmt-report-table">
                        <div className="shift-mgmt-report-table-header">
                          <Localized id="shift-report-col-type">
                            <span>Type</span>
                          </Localized>
                          <Localized id="shift-report-col-count">
                            <span>Count</span>
                          </Localized>
                        </div>
                        <div className="shift-mgmt-report-row">
                          <Localized id="shift-report-completed-sales">
                            <span>Completed sales</span>
                          </Localized>
                          <span className="shift-mgmt-cell-mono">{shiftReport.saleCount}</span>
                        </div>
                        <div className="shift-mgmt-report-row">
                          <Localized id="shift-report-voids">
                            <span>Voids</span>
                          </Localized>
                          <span className="shift-mgmt-cell-mono">{shiftReport.voidCount}</span>
                        </div>
                        <div className="shift-mgmt-report-row">
                          <Localized id="shift-report-refunds">
                            <span>Refunds</span>
                          </Localized>
                          <span className="shift-mgmt-cell-mono">{shiftReport.refundCount}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Gross profit summary (HPP) */}
                  {shiftReport.saleCount > 0 && (
                    <div className="shift-mgmt-report-section">
                      <Localized id="shift-report-gross-profit">
                        <h3 className="shift-mgmt-report-title">Gross Profit</h3>
                      </Localized>
                      <div className="shift-mgmt-report-table">
                        <div className="shift-mgmt-report-table-header">
                          <Localized id="shift-report-col-metric">
                            <span>Metric</span>
                          </Localized>
                          <Localized id="shift-report-col-total">
                            <span>Total</span>
                          </Localized>
                        </div>
                        <div className="shift-mgmt-report-row">
                          <Localized id="shift-report-cogs">
                            <span>Cost of Goods Sold (HPP)</span>
                          </Localized>
                          <span className="shift-mgmt-cell-mono">{fmt(shiftReport.cogsMinor, currency)}</span>
                        </div>
                        <div className="shift-mgmt-report-row">
                          <Localized id="shift-report-gross-profit-value">
                            <span>Gross Profit</span>
                          </Localized>
                          <span className={`shift-mgmt-cell-mono${shiftReport.grossProfitMinor < 0 ? ' shift-mgmt-cell-negative' : ''}`}>{fmt(shiftReport.grossProfitMinor, currency)}</span>
                        </div>
                        <div className="shift-mgmt-report-row">
                          <Localized id="shift-report-gross-margin-pct">
                            <span>Gross Margin</span>
                          </Localized>
                          <span className="shift-mgmt-cell-mono">{shiftReport.grossMarginPercent.toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Cash payouts */}
                  {shiftReport.cashPayouts.length > 0 && (
                    <div className="shift-mgmt-report-section">
                      <Localized id="shift-report-cash-payouts">
                        <h3 className="shift-mgmt-report-title">Cash Payouts (Safe Drops)</h3>
                      </Localized>
                      <div className="shift-mgmt-report-table">
                        <div className="shift-mgmt-report-table-header">
                          <Localized id="shift-report-col-amount">
                            <span>Amount</span>
                          </Localized>
                          <Localized id="shift-report-col-reason">
                            <span>Reason</span>
                          </Localized>
                          <Localized id="shift-report-col-time">
                            <span>Time</span>
                          </Localized>
                        </div>
                        {shiftReport.cashPayouts.map((p) => (
                          <div key={p.id} className="shift-mgmt-report-row">
                            <span className="shift-mgmt-cell-mono">{fmt(p.amountMinor, currency)}</span>
                            <span>{p.reason}</span>
                            <span className="shift-mgmt-cell-date">{time(p.createdAt)}</span>
                          </div>
                        ))}
                        <div className="shift-mgmt-report-row shift-mgmt-report-row--total">
                          <span className="shift-mgmt-cell-mono">
                            <Localized id="shift-report-total">
                              <strong>Total: </strong>
                            </Localized>
                            {fmt(
                              shiftReport.cashPayouts.reduce((s, p) => s + p.amountMinor, 0),
                              currency,
                            )}
                          </span>
                          <span />
                          <span />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {s.notes && (
                <div className="shift-mgmt-summary-notes">
                  <Localized id="shift-detail-notes">
                    <span className="shift-mgmt-summary-label">Notes</span>
                  </Localized>
                  <p>{s.notes}</p>
                </div>
              )}
            </div>
            <div className="shift-mgmt-modal-actions">
              <Localized id="close">
                <Button variant="ghost" onClick={() => setShowDetailModal(null)}>
                  Close
                </Button>
              </Localized>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
