import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Localized, useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import { requiredLocalized, LoadingStatus } from '@/components';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { listInTransitTransfers, cancelStockTransfer, type TransferWithLines } from '@/api/stockTransfers';
import { l10nErrorMessage } from '@/utils/app-error';
import './TransitAuditScreen.css';

const TRANSIT_EXPIRY_HOURS = 24;

export default function TransitAuditScreen() {
  const [transfers, setTransfers] = useState<TransferWithLines[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reverseConfirmId, setReverseConfirmId] = useState<string | null>(null);
  const { addToast } = useToast();
  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  // Date formatting follows the active Fluent locale.
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (!sessionToken) {
        throw new Error(requiredLocalized(l10nRef.current, 'inv-transit-error-load'));
      }
      // Single batch request — the backend returns in-transit transfers with
      // their lines in one IPC round-trip (no N+1 line fetches).
      const enriched = await listInTransitTransfers(sessionToken);
      setTransfers(enriched);
    } catch (err) {
      const message = l10nErrorMessage(err, l10nRef.current, 'inv-transit-error-load');
      setLoadError(message);
      addToast({ message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast, sessionToken]);

  useEffect(() => {
    loadTransfers();
  }, [loadTransfers]);

  const handleReverseClick = (id: string) => {
    setReverseConfirmId(id);
  };

  const handleReverseConfirm = async () => {
    if (!reverseConfirmId) return;
    try {
      await cancelStockTransfer(sessionToken, reverseConfirmId);
      setReverseConfirmId(null);
      await loadTransfers();
      addToast({ message: requiredLocalized(l10n, 'inv-transit-reversed-toast'), type: 'success' });
    } catch (err) {
      addToast({ message: l10nErrorMessage(err, l10n, 'inv-transit-error-reverse'), type: 'error' });
    }
  };

  const isOverdue = (sentAt: string | null) => {
    if (!sentAt) return false;
    const sentTime = new Date(sentAt).getTime();
    const now = Date.now();
    const diffHours = (now - sentTime) / 3600000;
    return diffHours > TRANSIT_EXPIRY_HOURS;
  };

  if (loading) {
    return (
      <div className="transit-audit-container">
        {/* LOAD-05: accessible loading region (role=status + aria-live +
            aria-busy) instead of a bare localized text node. */}
        <LoadingStatus className="transit-empty" label={requiredLocalized(l10n, 'inv-loading')} />
      </div>
    );
  }

  return (
    <div className="transit-audit-container">
      <div className="transit-header">
        <Localized id="inv-transit-title">
          <h2 className="transit-title">Transit Stock Audit</h2>
        </Localized>
      </div>

      {loadError ? (
        <div className="transit-error" role="alert">
          <p>{loadError}</p>
          <Button variant="secondary" size="sm" onClick={loadTransfers}>
            <Localized id="retry"><span>Retry</span></Localized>
          </Button>
        </div>
      ) : transfers.length === 0 ? (
        <div className="transit-empty">
          <Localized id="inv-transit-no-overdue">
            <span>No transfers in transit.</span>
          </Localized>
        </div>
      ) : (
        <div className="transit-grid">
          {transfers.map(({ transfer, lines }) => {
            const overdue = isOverdue(transfer.sent_at);
            return (
              <div key={transfer.id} className={`transit-card ${overdue ? 'overdue' : ''}`}>
                <div className="transit-meta">
                  <div>
                    <span><Localized id="inv-transit-transfer-label">Transfer #</Localized></span>
                    <strong>{transfer.transfer_number}</strong>
                  </div>
                  <div>
                    <Localized id="inv-transit-col-source">
                      <span>Source</span>
                    </Localized>
                    : <strong>{transfer.source_location || 'Warehouse'}</strong>
                  </div>
                  <div>
                    <Localized id="inv-transit-col-dest">
                      <span>Destination</span>
                    </Localized>
                    : <strong>{transfer.destination_location || 'Store Front'}</strong>
                  </div>
                  <div>
                    <Localized id="inv-transit-col-sent">
                      <span>Sent At</span>
                    </Localized>
                    : <strong>{transfer.sent_at ? new Date(transfer.sent_at).toLocaleString(numLocale) : (requiredLocalized(l10n, 'inv-transit-unknown'))}</strong>
                  </div>
                </div>

                <table className="transit-lines-table">
                  <thead>
                    <tr>
                      <Localized id="inv-transit-col-sku">
                        <th>SKU</th>
                      </Localized>
                      <Localized id="inv-transit-col-product">
                        <th>Product</th>
                      </Localized>
                      <Localized id="inv-transit-col-qty">
                        <th>Qty</th>
                      </Localized>
                    </tr>
                  </thead>
                  <tbody>{lines.map(line => (
                      <tr key={line.id}>
                        <td>{line.sku}</td>
                        <td>{line.product_name}</td>
                        <td>{line.qty}</td>
                      </tr>
                    ))}
</tbody>
                </table>

                <div className="transit-actions">
                  <Button variant="danger" size="sm" className="reverse-btn" onClick={() => handleReverseClick(transfer.id)}>
                    <Localized id="inv-transit-reverse-btn">
                      <span>Reverse Transfer</span>
                    </Localized>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={reverseConfirmId !== null}
        onCancel={() => setReverseConfirmId(null)}
        onConfirm={handleReverseConfirm}
        title={requiredLocalized(l10n, 'inv-transit-reverse-title')}
        message={requiredLocalized(l10n, 'inv-transit-reverse-message')}
        variant="danger"
        confirmLabel={requiredLocalized(l10n, 'inv-transit-reverse-confirm')}
      />
    </div>
  );
}
