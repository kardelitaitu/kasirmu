import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/Button';
import { Localized, useLocalization } from '@fluent/react';
import { useToast } from '@/frontend/shared/Toast';
import { requiredLocalized } from '@/frontend/shared';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { l10nErrorMessage } from '@/utils/app-error';
import { transactionTypeLabel } from './transactionTypeLabel';
import {
  startInventoryShift,
  endInventoryShift,
  getActiveInventoryShift,
  listInventoryLocations,
  listInventoryTransactionsForShift,
  type InventoryShift,
  type InventoryLocation,
  type InventoryTransaction,
} from '@/api/inventory';
import './ShiftBar.css';

interface ShiftBarProps {
  onShiftChange?: (shift: InventoryShift | null) => void;
}

export default function ShiftBar({ onShiftChange }: ShiftBarProps) {
  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  // Date/number formatting follows the active Fluent locale.
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const { session } = useAuth();
  const { sessionToken } = useWorkspace();
  const { addToast } = useToast();

  const [activeShift, setActiveShift] = useState<InventoryShift | null>(null);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [notes, setNotes] = useState('');
  
  // Timer state
  const [elapsedText, setElapsedText] = useState('00:00:00');
  
  // Summary modal state
  const [showSummary, setShowSummary] = useState(false);
  const [shiftSummaryTxs, setShiftSummaryTxs] = useState<InventoryTransaction[]>([]);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Exit-animation-pattern: hold the modal in the DOM through a mirrored
  // fade-out before unmounting (exit-animation-pattern skill; timing
  // matches the 200ms entry animation of .shift-summary-overlay).
  const summaryExit = useExitAnimation(showSummary, () => setShowSummary(false), 200);
  const trapActive = summaryExit.shouldRender && !summaryExit.exiting;

  // A11Y-02: complete dialog semantics for the shift-summary modal.
  // Focus trap suspends while the exit fade plays (trapActive == !exiting).
  useFocusTrap(summaryRef, trapActive, summaryExit.requestClose);

  // Load locations and active shift
  useEffect(() => {
    if (!sessionToken || !session?.user_id) return;

    listInventoryLocations(sessionToken)
      .then(locs => {
        const activeLocs = locs.filter(l => l.is_active);
        setLocations(activeLocs);
        if (activeLocs.length > 0) {
          setSelectedLocationId(activeLocs[0]!.id);
        }
      })
      .catch(() => {
        addToast({ message: requiredLocalized(l10nRef.current, 'inv-shift-error-locations'), type: 'error' });
      });

    getActiveInventoryShift(sessionToken)
      .then(shift => {
        setActiveShift(shift);
        onShiftChange?.(shift);
      })
      .catch(() => {
        addToast({ message: requiredLocalized(l10nRef.current, 'inv-shift-error-active'), type: 'error' });
      });
  }, [sessionToken, session?.user_id, onShiftChange, addToast]); // l10n via ref — stable dep chain

  // Handle timer tick
  useEffect(() => {
    if (activeShift) {
      const updateTimer = () => {
        const start = new Date(activeShift.started_at).getTime();
        const now = Date.now();
        const diff = Math.max(0, now - start);
        
        const hrs = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        
        const pad = (n: number) => n.toString().padStart(2, '0');
        setElapsedText(`${pad(hrs)}:${pad(mins)}:${pad(secs)}`);
      };

      updateTimer();
      timerRef.current = setInterval(updateTimer, 1000);
    } else {
      setElapsedText('00:00:00');
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeShift]);

  const handleStartShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionToken || !session?.user_id || !selectedLocationId) return;

    try {
      const shift = await startInventoryShift(sessionToken, selectedLocationId, notes);
      setActiveShift(shift);
      setNotes('');
      if (onShiftChange) onShiftChange(shift);
    } catch (err) {
      addToast({ message: l10nErrorMessage(err, l10nRef.current, 'inv-shift-error-start'), type: 'error' });
    }
  };

  const handleEndShift = async () => {
    if (!sessionToken || !activeShift) return;

    try {
      // Fetch transactions server-side for this shift window.
      const since = activeShift.started_at;
      const filtered = await listInventoryTransactionsForShift(
        sessionToken, activeShift.location_id, since,
      );

      await endInventoryShift(sessionToken, activeShift.id);
      setShiftSummaryTxs(filtered);
      setShowSummary(true);
      setActiveShift(null);
      if (onShiftChange) onShiftChange(null);
    } catch (err) {
      addToast({ message: l10nErrorMessage(err, l10nRef.current, 'inv-shift-error-end'), type: 'error' });
    }
  };

  const activeLocationName = locations.find(l => l.id === activeShift?.location_id)?.name ?? activeShift?.location_id ?? '';

  return (
    <>
      <div className="inventory-shift-bar" data-testid="shift-bar" role="region" aria-label={requiredLocalized(l10n, 'inv-shift-bar-aria')}>
        {activeShift ? (
          <div className="shift-status-active" aria-live="polite">
            <div className="status-indicator" />
            <span className="shift-info-text">
              <Localized
                id="inv-shift-active-info"
                vars={{
                  user: session?.display_name ?? '',
                  location: activeLocationName ?? '',
                  time: elapsedText,
                }}
              >
                <span>Active Shift</span>
              </Localized>
            </span>
            <Button variant="danger" size="sm" className="shift-btn shift-btn-danger" onClick={handleEndShift}>
              <Localized id="inv-shift-end-btn">
                <span>End Shift</span>
              </Localized>
            </Button>
          </div>
        ) : (
          <form className="shift-start-form" onSubmit={handleStartShift}>
            <span className="shift-form-title">
              <Localized id="inv-shift-start-title">
                <span>Start Inventory Shift</span>
              </Localized>
            </span>
            
            <select
              className="shift-select"
              value={selectedLocationId}
              onChange={e => setSelectedLocationId(e.target.value)}
              aria-label={requiredLocalized(l10n, 'inv-shift-location-aria')}
            >
              {locations.map(loc => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>

            <Localized id="inv-shift-notes-placeholder" attrs={{ placeholder: true }}>
              <input
                className="shift-input"
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Shift Notes"
                aria-label={requiredLocalized(l10n, 'inv-shift-notes-aria')}
              />
            </Localized>

            <Button type="submit" variant="primary" size="sm" className="shift-btn shift-btn-primary">
              <Localized id="inv-shift-start-btn">
                <span>Start Shift</span>
              </Localized>
            </Button>
          </form>
        )}
      </div>

      {summaryExit.shouldRender && (
        <div className={`shift-summary-overlay${summaryExit.exiting ? ' shift-summary-overlay--exiting' : ''}`}>
          <div className={`shift-summary-modal${summaryExit.exiting ? ' shift-summary-modal--exiting' : ''}`} ref={summaryRef} role="dialog" aria-modal="true">
            <Localized id="inv-shift-summary-title">
              <h3>Shift Summary</h3>
            </Localized>
            <Localized id="inv-shift-summary-performed">
              <p>Transactions performed during this shift:</p>
            </Localized>
            
            <ul className="summary-list">
              {shiftSummaryTxs.length > 0 ? (
                shiftSummaryTxs.map(tx => (
                  <li key={tx.id} className="summary-item">
                    <span className="summary-item-type">
                      {transactionTypeLabel(l10n, tx.type)}
                    </span>
                    <span>{new Date(tx.created_at).toLocaleTimeString(numLocale)}</span>
                  </li>
                ))
              ) : (
                <Localized id="inv-shift-no-transactions">
                  <li className="summary-item summary-item-empty">
                    No transactions recorded.
                  </li>
                </Localized>
              )}
            </ul>

            <Button variant="primary" size="sm" className="shift-btn shift-btn-primary summary-close-btn" onClick={summaryExit.requestClose}>
              <Localized id="inv-cancel">
                <span>Close</span>
              </Localized>
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
