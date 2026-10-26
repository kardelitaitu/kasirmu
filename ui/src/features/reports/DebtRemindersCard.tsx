import { useEffect, useState, useCallback } from 'react';
import { Localized } from '@fluent/react';
import { Card } from '@/components/Card';
import { listReceivablesScoped, getArAgingReportScoped, type Receivable } from '@/api/receivables';
import { listPayablesScoped, getApAgingReportScoped, type PayableDto } from '@/api/payables';
import { formatMoney } from '@/types/domain';
import { buildCsv, downloadCsv } from './csv';
import { isTabletShell } from '@/utils/shellKind';

interface DebtRemindersCardProps {
  sessionToken: string;
  currency: string;
}

/**
 * Debt & Credit Reminders card for Dashboard — surfaces overdue and due-soon
 * customer kasbon (AR) and vendor bills (AP) with one-click navigation.
 */
export function DebtRemindersCard({ sessionToken, currency }: DebtRemindersCardProps) {
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [payables, setPayables] = useState<PayableDto[]>([]);
  const [loading, setLoading] = useState(true);
  // AP aging is a desktop-only command (`get_ap_aging_report_scoped` is registered
  // by apps/desktop-tauri alone). Derived into a named const rather than tested
  // inline at the JSX, because a shell-derived BOOLEAN is the form the gates
  // recognise -- verify-scoped-reads.py needs the guard to name the shell, and
  // verify-ipc-parity.py needs the handler's references to sit near it.
  const canExportApAging = !isTabletShell();
  // Per side: the two reads fail independently (see `loadDebts`).
  const [recsFailed, setRecsFailed] = useState(false);
  const [paysFailed, setPaysFailed] = useState(false);
  // An export that fails is not the same as an export that did nothing. The handlers
  // below used to swallow the rejection into `console.error`, so a merchant who
  // clicked Export on a tablet -- where the aging report command is not registered --
  // got NO feedback and no file, which reads as a broken button. Surface it per side.
  const [exportFailed, setExportFailed] = useState<'ar' | 'ap' | null>(null);

  const loadDebts = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    try {
      // `list_payables_scoped` is not registered on the tablet shell -- payables are a
      // desktop-only authoring surface (apps/desktop-tauri/src/commands/payables.rs,
      // and the `payables` note in scripts/ipc-parity-allowlist.json). Invoicing it
      // there rejects with `command not found`, and `allSettled` below turns that
      // into `paysFailed` -- so the card reported a failed AP read for a command
      // the shell was never meant to carry. Read it only where it exists, and
      // leave `paysFailed` false rather than blaming a door the tablet never had.
      // Both reads still go out together, but the payables arm is settled here when
      // the command has no door in this shell: the tablet never registers
      // `list_payables_scoped`, so calling it would reject and `allSettled` would
      // report `paysFailed` for a back-office door the tablet was never given.
      const recsPromise = listReceivablesScoped(sessionToken);
      let paysResult: PromiseSettledResult<PayableDto[]> = { status: 'fulfilled', value: [] };
      if (!isTabletShell()) {
        [paysResult] = await Promise.allSettled([listPayablesScoped(sessionToken)]);
      }
      const [recsResult] = await Promise.allSettled([recsPromise]);
      // A REJECTED ARM IS NOT "NOTHING OWED". `allSettled` was chosen so one read could
      // fail without taking the other down — but the failure was then dropped on the
      // floor, leaving the array at its `[]` initial value. The card turns "no overdue
      // rows" into the affirmative badge "Up to date", so one failed receivables read
      // told the merchant their debtors were settled. Track the failures and say so.
      setRecsFailed(recsResult.status === 'rejected');
      setPaysFailed(paysResult.status === 'rejected');
      if (recsResult.status === 'fulfilled') {
        setReceivables(recsResult.value ?? []);
      }
      if (paysResult.status === 'fulfilled') {
        setPayables(paysResult.value ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    loadDebts();
  }, [loadDebts]);

  if (loading) {
    return null;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const threeDaysFromNow = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

  const activeRecs = receivables.filter((r) => r.status === 'open' || r.status === 'partial');
  const recOverdue = activeRecs.filter((r) => r.isOverdue);
  const recDueSoon = activeRecs.filter(
    (r) => !r.isOverdue && r.dueDate && r.dueDate >= todayStr && r.dueDate <= threeDaysFromNow,
  );
  const recTotalMinor = activeRecs.reduce((sum, r) => sum + (r.balance?.minor_units ?? 0), 0);

  const activePays = payables.filter((p) => p.status === 'open' || p.status === 'partial');
  const payOverdue = activePays.filter((p) => p.is_overdue);
  const payDueSoon = activePays.filter(
    (p) => !p.is_overdue && p.due_date && p.due_date >= todayStr && p.due_date <= threeDaysFromNow,
  );
  const payTotalMinor = activePays.reduce((sum, p) => sum + (p.balance?.minor_units ?? 0), 0);

  const isAllHealthy =
    recOverdue.length === 0 &&
    recDueSoon.length === 0 &&
    payOverdue.length === 0 &&
    payDueSoon.length === 0;

  const fmt = (minor: number) => formatMoney({ minor_units: minor, currency });

  const handleExportArAging = async () => {
    try {
      const report = await getArAgingReportScoped(sessionToken);
      const headers = [
        'Customer Name',
        'Phone',
        'Current (0-30 days)',
        '31-60 days',
        '61-90 days',
        '> 90 days',
        'Total Outstanding',
        'Open Receivables Count',
      ];
      const rows = report.customers.map((c) => [
        c.customerName,
        c.customerPhone ?? '',
        fmt(c.currentMinor),
        fmt(c.days3160Minor),
        fmt(c.days6190Minor),
        fmt(c.daysOver90Minor),
        fmt(c.totalMinor),
        String(c.openCount),
      ]);
      rows.push([
        'TOTAL',
        '',
        fmt(report.summary.currentMinor),
        fmt(report.summary.days3160Minor),
        fmt(report.summary.days6190Minor),
        fmt(report.summary.daysOver90Minor),
        fmt(report.summary.totalOutstandingMinor),
        String(report.customers.reduce((sum, c) => sum + c.openCount, 0)),
      ]);
      const csv = buildCsv(headers, rows);
      downloadCsv(csv, `ar-aging-report-${report.asOfDate}.csv`);
      setExportFailed(null);
    } catch (err) {
      console.error('Failed to export AR aging report', err);
      setExportFailed('ar');
    }
  };

  const handleExportApAging = async () => {
    // TWO guards, at two levels, for two different reasons (measured 2026-10-25).
    //
    // 1. The BUTTON is withheld on the tablet, because get_ap_aging_report_scoped
    //    is registered by the desktop shell alone -- an affordance that cannot
    //    work should not be shown.
    // 2. The CALL is guarded too, in the positive/else form the gates read. An
    //    early `return` inside the try does NOT register as a guard: the walk
    //    needs the call inside the block an `if` opened, and `} else {` keeps the
    //    condition armed for the other arm. Without this, a withheld button still
    //    leaves the invoke looking unconditional to verify-scoped-reads.py -- and
    //    the invoke is what would throw if a refactor ever re-showed the control.
    if (isTabletShell()) {
      return;
    } else {
      try {
      const report = await getApAgingReportScoped(sessionToken);
      const headers = [
        'Vendor / Supplier Name',
        'Current (0-30 days)',
        '31-60 days',
        '61-90 days',
        '> 90 days',
        'Total Outstanding',
        'Open Bills Count',
      ];
      const rows = report.vendors.map((v) => [
        v.vendorName,
        fmt(v.currentMinor),
        fmt(v.days3160Minor),
        fmt(v.days6190Minor),
        fmt(v.daysOver90Minor),
        fmt(v.totalMinor),
        String(v.openCount),
      ]);
      rows.push([
        'TOTAL',
        fmt(report.summary.currentMinor),
        fmt(report.summary.days3160Minor),
        fmt(report.summary.days6190Minor),
        fmt(report.summary.daysOver90Minor),
        fmt(report.summary.totalOutstandingMinor),
        String(report.vendors.reduce((sum, v) => sum + v.openCount, 0)),
      ]);
      const csv = buildCsv(headers, rows);
      downloadCsv(csv, `ap-aging-report-${report.asOfDate}.csv`);
      setExportFailed(null);
    } catch (err) {
      console.error('Failed to export AP aging report', err);
      setExportFailed('ap');
    }
    }
  };

  return (
    <Card shadow="sm" className="dashboard-section" data-testid="dashboard-debt-reminders">
      <div className="dashboard-debt-header">
        <Localized id="dashboard-debt-reminders">
          <h2 className="dashboard-section-title">Debt & Credit Reminders</h2>
        </Localized>
        {isAllHealthy && (
          <span className="dashboard-debt-badge dashboard-debt-badge--ok">
            <Localized id="dashboard-debt-ok">All credit & bills are up to date.</Localized>
          </span>
        )}
      </div>

      <div className="dashboard-debt-grid">
        {/* ── Customer Receivables (Piutang) ───────────────── */}
        <div className="dashboard-debt-panel" data-testid="receivables-reminder-panel">
          <div className="dashboard-debt-panel-header">
            <Localized id="dashboard-receivables-title">
              <h3 className="dashboard-debt-panel-title">Customer Receivables (Piutang)</h3>
            </Localized>
          </div>

          <div className="dashboard-debt-panel-outstanding">
            <Localized id="dashboard-outstanding" vars={{ amount: fmt(recTotalMinor) }}>
              <span>Outstanding: {fmt(recTotalMinor)}</span>
            </Localized>
          </div>

          <div className="dashboard-debt-badges">
            {recOverdue.length > 0 && (
              <span className="dashboard-debt-badge dashboard-debt-badge--danger">
                <Localized id="dashboard-overdue-count" vars={{ count: recOverdue.length }}>
                  <span>{recOverdue.length} overdue</span>
                </Localized>
              </span>
            )}
            {recDueSoon.length > 0 && (
              <span className="dashboard-debt-badge dashboard-debt-badge--warning">
                <Localized id="dashboard-due-soon-count" vars={{ count: recDueSoon.length }}>
                  <span>{recDueSoon.length} due soon</span>
                </Localized>
              </span>
            )}
            {recsFailed ? (
              // "Up to date" is an affirmative claim about the merchant's debtors. It was
              // reachable from a receivables read that never answered.
              <span className="dashboard-debt-badge dashboard-debt-badge--warning" role="alert">
                <Localized id="dashboard-debt-receivables-failed">
                  Could not load receivables
                </Localized>
              </span>
            ) : recOverdue.length === 0 && recDueSoon.length === 0 ? (
              <span className="dashboard-debt-badge dashboard-debt-badge--ok">
                <Localized id="dashboard-debt-panel-ok">Up to date</Localized>
              </span>
            ) : null}
          </div>

          <div className="dashboard-debt-actions">
            <button
              type="button"
              className="dashboard-debt-btn"
              onClick={() => {
                window.location.hash = '#customers';
              }}
            >
              <Localized id="dashboard-view-customers">
                <span>View Customers</span>
              </Localized>
            </button>
            <button
              type="button"
              className="dashboard-debt-btn dashboard-debt-btn--secondary"
              onClick={handleExportArAging}
            >
              <Localized id="dashboard-export-ar-aging">
                <span>Export AR Aging</span>
              </Localized>
            </button>
            {exportFailed === 'ar' && (
              <span
                className="dashboard-debt-badge dashboard-debt-badge--warning"
                role="alert"
                data-testid="ar-aging-export-failed"
              >
                <Localized id="dashboard-export-aging-failed">
                  <span>Export failed</span>
                </Localized>
              </span>
            )}
          </div>
        </div>

        {/* ── Vendor Bills (Hutang) ─────────────────────────── */}
        <div className="dashboard-debt-panel" data-testid="payables-reminder-panel">
          <div className="dashboard-debt-panel-header">
            <Localized id="dashboard-payables-title">
              <h3 className="dashboard-debt-panel-title">Vendor Bills (Hutang)</h3>
            </Localized>
          </div>

          <div className="dashboard-debt-panel-outstanding">
            <Localized id="dashboard-outstanding" vars={{ amount: fmt(payTotalMinor) }}>
              <span>Outstanding: {fmt(payTotalMinor)}</span>
            </Localized>
          </div>

          <div className="dashboard-debt-badges">
            {payOverdue.length > 0 && (
              <span className="dashboard-debt-badge dashboard-debt-badge--danger">
                <Localized id="dashboard-overdue-count" vars={{ count: payOverdue.length }}>
                  <span>{payOverdue.length} overdue</span>
                </Localized>
              </span>
            )}
            {payDueSoon.length > 0 && (
              <span className="dashboard-debt-badge dashboard-debt-badge--warning">
                <Localized id="dashboard-due-soon-count" vars={{ count: payDueSoon.length }}>
                  <span>{payDueSoon.length} due soon</span>
                </Localized>
              </span>
            )}
            {paysFailed ? (
              <span className="dashboard-debt-badge dashboard-debt-badge--warning" role="alert">
                <Localized id="dashboard-debt-payables-failed">
                  Could not load payables
                </Localized>
              </span>
            ) : payOverdue.length === 0 && payDueSoon.length === 0 ? (
              <span className="dashboard-debt-badge dashboard-debt-badge--ok">
                <Localized id="dashboard-debt-panel-ok">Up to date</Localized>
              </span>
            ) : null}
          </div>

          <div className="dashboard-debt-actions">
            <button
              type="button"
              className="dashboard-debt-btn"
              onClick={() => {
                window.location.hash = '#vendor-bills';
              }}
            >
              <Localized id="dashboard-view-vendor-bills">
                <span>View Vendor Bills</span>
              </Localized>
            </button>
            {/* The dashboard is a tablet-reachable route (requiredPermission
                reports:view, and TabletAppShell resolves it through the same page
                registry), but get_ap_aging_report_scoped is registered by the
                DESKTOP shell alone (apps/desktop-tauri/src/lib.rs:1832; there is no
                tablet twin). Unconditional, this button fired a command that does
                not exist on the tablet and surfaced only as an "export failed"
                badge -- a broken affordance rather than an absent one. The AR half
                above still works there, so only this control is withheld. C47 idiom. */}
            {canExportApAging && (
              <button
                type="button"
                className="dashboard-debt-btn dashboard-debt-btn--secondary"
                onClick={handleExportApAging}
              >
                <Localized id="dashboard-export-ap-aging">
                  <span>Export AP Aging</span>
                </Localized>
              </button>
            )}
            {exportFailed === 'ap' && (
              <span
                className="dashboard-debt-badge dashboard-debt-badge--warning"
                role="alert"
                data-testid="ap-aging-export-failed"
              >
                <Localized id="dashboard-export-aging-failed">
                  <span>Export failed</span>
                </Localized>
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
