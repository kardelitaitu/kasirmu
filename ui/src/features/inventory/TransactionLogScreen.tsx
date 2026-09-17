import { Fragment, useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/Button';
import { Localized, useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { l10nErrorMessage } from '@/utils/app-error';
import { transactionTypeLabel } from './transactionTypeLabel';
import {
  listInventoryTransactions,
  listInventoryLocations,
  getInventoryTransaction,
  type InventoryTransaction,
  type InventoryLocation,
  type InventoryTransactionLine,
} from '@/api/inventory';
import './TransactionLogScreen.css';

export default function TransactionLogScreen() {
  const { sessionToken } = useWorkspace();
  const { addToast } = useToast();
  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  // Date formatting follows the active Fluent locale.
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';

  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Expanded row tracking
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [expandedLines, setExpandedLines] = useState<InventoryTransactionLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);

  // Filters state
  const [filterLocation, setFilterLocation] = useState('');
  const [filterStaff, setFilterStaff] = useState('');
  const [filterType, setFilterType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Durable load with retry (INV-08): the initial failure previously only
  // surfaced a transient toast. Now a persistent error block with a Retry
  // button renders in place of the table until the reload succeeds.
  const load = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [txs, locs] = await Promise.all([
        listInventoryTransactions(sessionToken),
        listInventoryLocations(sessionToken),
      ]);
      setTransactions(txs);
      setLocations(locs);
    } catch (err) {
      setLoadError(l10nErrorMessage(err, l10nRef.current, 'inv-log-error-load'));
      addToast({ message: l10nErrorMessage(err, l10nRef.current, 'inv-log-error-load'), type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [sessionToken, addToast]); // l10n via ref — stable dep chain

  useEffect(() => {
    load();
  }, [load]);

  const handleRowClick = async (txId: string) => {
    if (!sessionToken) return;
    if (expandedTxId === txId) {
      setExpandedTxId(null);
      setExpandedLines([]);
      return;
    }

    setExpandedTxId(txId);
    setLoadingLines(true);
    try {
      const detail = await getInventoryTransaction(sessionToken, txId);
      if (detail) {
        setExpandedLines(detail[1]);
      }
    } catch (err) {
      addToast({ message: l10nErrorMessage(err, l10nRef.current, 'inv-log-error-lines'), type: 'error' });
    } finally {
      setLoadingLines(false);
    }
  };

  // Extract unique staff IDs for filter
  const uniqueStaffIds = Array.from(new Set(transactions.map(tx => tx.staff_id)));

  // Filtered transactions
  const filteredTxs = transactions.filter(tx => {
    if (filterLocation && tx.location_id !== filterLocation) return false;
    if (filterStaff && tx.staff_id !== filterStaff) return false;
    if (filterType && tx.type !== filterType) return false;
    
    if (startDate) {
      const txTime = new Date(tx.created_at).getTime();
      const startTime = new Date(startDate).getTime();
      if (txTime < startTime) return false;
    }
    if (endDate) {
      const txTime = new Date(tx.created_at).getTime();
      // Set end time to the end of that day (23:59:59)
      const endTime = new Date(endDate).getTime() + 86400000 - 1;
      if (txTime > endTime) return false;
    }
    return true;
  });

  return (
    <div className="log-container">
      <div className="log-header">
        <Localized id="inv-log-title">
          <h2 className="log-title">Inventory Transaction Log</h2>
        </Localized>
      </div>

      <div className="log-filters">
        <div className="log-filter-group">
          <Localized id="inv-log-filter-location">
            <label htmlFor="filter-location">Location</label>
          </Localized>
          <select
            id="filter-location"
            className="log-select"
            value={filterLocation}
            onChange={e => setFilterLocation(e.target.value)}
          >
            <Localized id="inv-log-filter-all"><option value="">All</option></Localized>
            {locations.map(loc => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>

        <div className="log-filter-group">
          <Localized id="inv-log-filter-staff">
            <label htmlFor="filter-staff">Staff</label>
          </Localized>
          <select
            id="filter-staff"
            className="log-select"
            value={filterStaff}
            onChange={e => setFilterStaff(e.target.value)}
          >
            <Localized id="inv-log-filter-all"><option value="">All</option></Localized>
            {uniqueStaffIds.map(id => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>

        <div className="log-filter-group">
          <Localized id="inv-log-filter-type">
            <label htmlFor="filter-type">Type</label>
          </Localized>
          <select
            id="filter-type"
            className="log-select"
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
          >
            <Localized id="inv-log-filter-all"><option value="">All</option></Localized>
            <Localized id="inv-log-type-sale"><option value="sale">Sale</option></Localized>
            <Localized id="inv-log-type-void"><option value="void">Void</option></Localized>
            <Localized id="inv-log-type-refund"><option value="refund">Refund</option></Localized>
            <Localized id="inv-log-type-transfer"><option value="transfer">Transfer</option></Localized>
            <Localized id="inv-log-type-po-receive"><option value="purchase-order-receive">PO Receive</option></Localized>
            <Localized id="inv-log-type-stock-count"><option value="stock-count">Stock Count</option></Localized>
            <Localized id="inv-log-type-manual-adjustment"><option value="manual-adjustment">Manual Adjustment</option></Localized>
          </select>
        </div>

        <div className="log-filter-group">
          <Localized id="inv-log-filter-start"><label htmlFor="filter-start-date">Start Date</label></Localized>
          <input
            id="filter-start-date"
            type="date"
            className="log-input"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
        </div>

        <div className="log-filter-group">
          <Localized id="inv-log-filter-end"><label htmlFor="filter-end-date">End Date</label></Localized>
          <input
            id="filter-end-date"
            type="date"
            className="log-input"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
          />
        </div>
      </div>

      {/* LOAD-05: status semantics for AT; text stays <Localized> because
          the string is interpolated through the Fluent overlay. */}
      {loading ? (
        <div className="transit-empty" role="status" aria-live="polite" aria-busy={loading}>
          <Localized id="inv-loading">
            <span>Loading...</span>
          </Localized>
        </div>
      ) : loadError ? (
        <div className="log-error" role="alert">
          <p className="log-error-text">{loadError}</p>
          <Button variant="secondary" size="sm" onClick={load}>
            <Localized id="retry"><span>Retry</span></Localized>
          </Button>
        </div>
      ) : (
        <div aria-live="polite" aria-relevant="additions text">
        <table className="log-table">
          <thead>
            <tr>
              <Localized id="inv-log-col-datetime"><th>Date / Time</th></Localized>
              <Localized id="inv-log-col-type"><th>Type</th></Localized>
              <Localized id="inv-log-col-location"><th>Location</th></Localized>
              <Localized id="inv-log-col-staff"><th>Staff</th></Localized>
              <Localized id="inv-log-col-actions"><th>Action</th></Localized>
            </tr>
          </thead>
          <tbody>{filteredTxs.map(tx => {
              const locationName = locations.find(l => l.id === tx.location_id)?.name || tx.location_id;
              const isExpanded = expandedTxId === tx.id;
              return (
                <Fragment key={tx.id}>
                  <tr
                    className="log-row-expandable"
                    onClick={() => handleRowClick(tx.id)}
                  >
                    <td>{new Date(tx.created_at).toLocaleString(numLocale)}</td>
                    <td>
                      <span className={`badge badge-${tx.type}`}>
                        {transactionTypeLabel(l10n, tx.type)}
                      </span>
                    </td>
                    <td>{locationName}</td>
                    <td>{tx.staff_id}</td>
                    <td>
                      <Button variant="primary" size="sm" className="shift-btn shift-btn-primary log-detail-btn">
                        <Localized id="inv-log-expand-btn">
                          <span>Details</span>
                        </Localized>
                      </Button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="log-row-expanded">
                      <td colSpan={5}>
                        <div className="log-details-container">
                          {tx.notes && (
                            <div className="details-notes">
                              <Localized id="inv-log-notes"><strong>Notes:</strong></Localized> {tx.notes}
                            </div>
                          )}
                          <div aria-live="polite">
                          {loadingLines ? (
                            <Localized id="inv-log-loading-lines"><span>Loading lines...</span></Localized>
                          ) : (
                            <table className="details-table">
                              <thead>
                                <tr>
                                  <Localized id="inv-transit-col-sku">
                                    <th>SKU</th>
                                  </Localized>
                                  <Localized id="inv-transit-col-product">
                                    <th>Product Name</th>
                                  </Localized>
                                  <Localized id="inv-transit-col-qty">
                                    <th>Qty Change</th>
                                  </Localized>
                                  <Localized id="inv-log-col-barcode">
                                    <th>Barcode Scanned</th>
                                  </Localized>
                                </tr>
                              </thead>
                              <tbody>{expandedLines.map(line => (
                                  <tr key={line.id}>
                                    <td>{line.sku}</td>
                                    <td>{line.product_name}</td>                    <td className={line.qty >= 0 ? 'log-qty-positive' : 'log-qty-negative'}>
                      {line.qty >= 0 ? `+${line.qty}` : line.qty}
                    </td>
                                    <td>{line.barcode_scanned || '-'}</td>
                                  </tr>
                                ))}
</tbody>
                            </table>
                          )}
                        </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
</tbody>
        </table>
        </div>
      )}
    </div>
  );
}
