import { useState, useCallback, useRef } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Localized, useLocalization } from '@fluent/react';
import { createStockCount, type StockCountDto } from '@/api/inventoryCounts';
import { l10nErrorMessage } from '@/utils/app-error';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import './StockCountForm.css';

interface Props {
  onCreated: (count: StockCountDto) => void;
  onCancel: () => void;
}

/** New stock count creation form — select count type (full, cyclic, or spot) and add optional notes before creating. */
export default function StockCountForm({ onCreated, onCancel }: Props) {
  const [countType, setCountType] = useState<'full' | 'cyclic' | 'spot'>('full');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { l10n } = useLocalization();
  const { sessionToken: rawSessionToken } = useWorkspace();
  const sessionToken = rawSessionToken ?? '';

  // Re-entry guard for the count create. `setSaving(true)` is STATE -- React commits it on
  // its next render, after the second submit of a real double tap. MEASURED: two clicks in
  // one act() batch both reach the handler (StockCountForm.test.tsx 'creates one stock
  // count for a double submit'), and both are SENT.
  //
  // The backend does NOT refuse the replay, and the reason is worth stating precisely: the
  // UI sends only {countType, notes}, the bridge mints `uuid::Uuid::now_v7()` per call
  // (inventory_counts.rs:301) and allocates the next number atomically inside the INSERT
  // (create_stock_count_with_next_number), so each call gets its own id AND its own
  // count_number. `stock_counts` has no UNIQUE constraint that could collapse them --
  // count_number is unique precisely BECAUSE it is freshly allocated, which is what makes
  // two calls produce CNT-001 and CNT-002 instead of conflicting. Two draft counts that
  // nobody asked for, and a count number skipped for no reason.
  const submitPendingRef = useRef(false);
  const handleSubmit = useCallback(async () => {
    if (submitPendingRef.current) return;
    submitPendingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (!sessionToken) {
        throw new Error(l10n.getString('sc-error-session'));
      }
      const result = await createStockCount(sessionToken, {
        countType,
        notes,
      });
      onCreated(result);
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'sc-error-create'));
    } finally {
      submitPendingRef.current = false;
      setSaving(false);
    }
  }, [countType, notes, onCreated, l10n, sessionToken]);

  const typeOptions: Array<{ value: 'full' | 'cyclic' | 'spot' }> = [
    { value: 'full' },
    { value: 'cyclic' },
    { value: 'spot' },
  ];

  return (
    <div className="sc-form-screen">
      <div className="sc-form-header">
        <h1 className="sc-title">
          <Localized id="sc-new-count-title">
            <span>New Stock Count</span>
          </Localized>
        </h1>
      </div>

      <Card shadow="sm" className="sc-form-card">
        <div className="sc-form-field" role="radiogroup" aria-label={l10n.getString('sc-type-aria')}>
          <div className="sc-form-label">
            <Localized id="sc-type-label">
              <span>Count Type</span>
            </Localized>
          </div>
          <div className="sc-type-options">
            {typeOptions.map((opt) => (
               
              <button
                key={opt.value}
                type="button"
                className={`sc-type-btn ${countType === opt.value ? 'sc-type-btn--active' : ''}`}
                onClick={() => setCountType(opt.value)}
                role="radio"
                aria-checked={countType === opt.value}
              >
                <Localized id={`sc-type-${opt.value}`}>
                  <span>{opt.value}</span>
                </Localized>
              </button>
            ))}
          </div>
        </div>

        <div className="sc-form-field">
          <div className="sc-form-label">
            <Localized id="sc-notes-label">
              <span>Notes (optional)</span>
            </Localized>
          </div>
          <textarea
            id="sc-notes"
            className="sc-form-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={l10n.getString('sc-notes-placeholder')}
            rows={3}
            aria-label={l10n.getString('sc-notes-label')}
          />
        </div>

        {error && (
          <div className="sc-form-error" role="alert">
            {error}
          </div>
        )}

        <div className="sc-form-actions">
          <Button variant="ghost" onClick={onCancel}>
            <Localized id="sc-cancel">
              <span>Cancel</span>
            </Localized>
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={saving}>
            <Localized id="sc-start-count">
              <span>Start Count</span>
            </Localized>
          </Button>
        </div>
      </Card>
    </div>
  );
}
