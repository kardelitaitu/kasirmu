import { useEffect, useState } from 'react';
import AdminLockedFeature from '@/components/AdminLockedFeature';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Localized, useLocalization } from '@fluent/react';
import { printSalesReceipt } from '@/api/sales';
import { getLowStockAlerts, type LowStockAlert } from '@/api/reports';
import { formatMoney } from '@/types/domain';
import { buildCsv, downloadCsv } from './csv';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { requiredLocalized } from '@/components';
import { useToast } from '@/components/Toast';
import './InventoryReportScreen.css';

/** Inventory report screen — view and export low-stock alerts with configurable threshold, CSV download, and print support. */
/** §B administrative gate — Reports lock while the subscription is not `active`. */
export default function InventoryReportScreen() {
  const { locked } = useAdminGate();
  if (locked) return <AdminLockedFeature />;
  return <InventoryReportScreenContent />;
}

function InventoryReportScreenContent() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  // R36-07: read the token through the useWorkspace() hook rather than the
// raw context object. The global test harness mocks the hook, not the
// context, so the direct form silently yielded an empty token and skipped
// every token-gated effect. AppProviders wraps the routed tree in the
// provider, so the hook's throw-outside-provider path is unreachable here.
const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<LowStockAlert[]>([]);
  const [threshold, setThreshold] = useState(10);

  useEffect(() => {
    setLoading(true);
    getLowStockAlerts(threshold, sessionToken)
      .then(setItems)
      .catch((e) => setError(e.message ?? String(e)))
      .finally(() => setLoading(false));
  }, [threshold, sessionToken]);

  const exportCsv = () => {
    const headers = [
      l10n.getString('inv-report-csv-header-sku'),
      l10n.getString('inv-report-csv-header-product'),
      l10n.getString('inv-report-csv-header-stock'),
      l10n.getString('inv-report-csv-header-threshold'),
      l10n.getString('inv-report-csv-header-unit-price'),
      l10n.getString('inv-report-csv-header-unit-cost'),
      l10n.getString('inv-report-csv-header-unit-margin'),
      l10n.getString('inv-report-csv-header-margin'),
      l10n.getString('inv-report-csv-header-stock-value'),
    ];
    const rows = items.map((i) => {
      const money = { minor_units: i.price_minor, currency: i.currency };
      const unitMargin = i.price_minor - i.cost_minor;
      const marginPct = i.price_minor > 0
        ? `${((unitMargin / i.price_minor) * 100).toFixed(1)}%`
        : '0.0%';
      return [
        i.sku,
        i.name,
        String(i.current_qty),
        String(i.threshold),
        formatMoney(money),
        formatMoney({ minor_units: i.cost_minor, currency: i.currency }),
        formatMoney({ minor_units: unitMargin, currency: i.currency }),
        marginPct,
        formatMoney({ minor_units: i.cost_minor * i.current_qty, currency: i.currency }),
      ];
    });
    const csv = buildCsv(headers, rows);
    downloadCsv(csv, `inventory-report-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const printReport = async () => {
    await printSalesReceipt(sessionToken, {
      date: new Date().toISOString().slice(0, 10),
      receiptNumber: `INV-${Date.now()}`,
      items: items.map((i) => ({
        name: i.name,
        quantity: i.current_qty,
        unitPrice: { minorUnits: 0, currency: 'USD' },
        totalPrice: { minorUnits: 0, currency: 'USD' },
      })),
      subtotal: { minorUnits: 0, currency: 'USD' },
      total: { minorUnits: 0, currency: 'USD' },
      payments: [{ method: 'Report', amount: { minorUnits: 0, currency: 'USD' }, change: null }],
    }).catch((printErr) => {
      // This call had no catch at all, so the rejection escaped to the global
      // handler and surfaced to the cashier as "Unexpected error" -- on the Android
      // shell that was every tap, since the tablet registers no printer driver and
      // the command always rejects with "no receipt printer registered".
      console.error('inventory report print failed', printErr);
      addToast({
        message: requiredLocalized(l10n, 'payment-toast-print-failed'),
        type: 'warning',
      });
    });
  };

  if (loading) {
    return (
      <div className="inventory-report-loading-skeleton" aria-hidden="true">
        {/* Header: title + controls */}
        <div className="inventory-report-header">
          <Skeleton width="10rem" height="1.75rem" />
          <div className="inventory-report-controls">
            <Skeleton width="4rem" height="2rem" />
            <Skeleton width="4rem" height="2rem" />
            <Skeleton width="6rem" height="2rem" />
          </div>
        </div>
        {/* Table card */}
        <Card shadow="sm" className="inventory-report-table-card">
          <div className="inventory-report-table-header">
            <Skeleton width="5rem" height="0.75rem" />
            <Skeleton width="4rem" height="0.75rem" />
            <Skeleton width="3rem" height="0.75rem" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="inventory-report-row">
              <Skeleton width="4rem" height="0.875rem" />
              <Skeleton width="7rem" height="0.875rem" />
              <Skeleton width="2rem" height="0.875rem" />
            </div>
          ))}
        </Card>
      </div>
    );
  }

  return (
    <div className="inventory-report" role="region" aria-label={l10n.getString('inv-report-region-aria')}>
      <div className="inventory-report-header">
        <Localized id="inv-report-title">
          <h1 className="inventory-report-title">Inventory Report</h1>
        </Localized>
        <div className="inventory-report-controls">
          <Localized id="inv-report-threshold">
            <label htmlFor="threshold-input" className="inventory-report-label">
              Threshold
            </label>
          </Localized>
          <input
            id="threshold-input"
            type="number"
            min={0}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="inventory-report-input"
            aria-label={l10n.getString('inv-report-threshold-aria')}
          />
          <Button
            variant="secondary"
            onClick={printReport}
            aria-label={l10n.getString('inv-report-print-aria')}
          >
            <Localized id="print">Print</Localized>
          </Button>
          <Button
            variant="secondary"
            onClick={exportCsv}
            aria-label={l10n.getString('inv-report-export-aria')}
          >
            <Localized id="inv-report-export-csv">Export CSV</Localized>
          </Button>
        </div>
      </div>

      {error && <p className="inventory-report-error">{error}</p>}

      <Card shadow="sm" className="inventory-report-table-card">
        <div className="inventory-report-table">
          <div className="inventory-report-table-header">
            <span>
              <Localized id="inv-report-sku">SKU</Localized>
            </span>
            <span>
              <Localized id="inv-report-product">Product</Localized>
            </span>
            <span>
              <Localized id="inv-report-current-stock">Stock</Localized>
            </span>
          </div>
          {items.length === 0 ? (
            <div className="inventory-report-empty">
              <Localized id="inv-report-no-results">
                <p>No results found</p>
              </Localized>
            </div>
          ) : (
            items.map((item) => {
              const qty = item.current_qty;
              const isCritical = qty === 0;
              const isLow = qty > 0 && qty <= threshold;
              return (
                <div
                  key={item.product_id}
                  className={`inventory-report-row ${isCritical ? 'critical' : isLow ? 'low' : ''}`}
                >
                  <span className="inventory-report-sku">{item.sku}</span>
                  <span className="inventory-report-name">{item.name}</span>
                  <span
                    className={`inventory-report-qty ${isCritical ? 'critical' : isLow ? 'low' : ''}`}
                  >
                    {qty}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
