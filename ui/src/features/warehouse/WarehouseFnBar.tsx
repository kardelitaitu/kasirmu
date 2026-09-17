// ── ui/src/features/warehouse/WarehouseFnBar.tsx ─────────────────────────
// Function key bar (F1–F12) for the warehouse console.
// Pure presentational — all callbacks are wired in the parent.
// Self-contained copy of RetailFnBar.tsx — no shared imports.

import { requiredLocalized } from '@/components';
import { useLocalization } from '@fluent/react';
import { getWarehouseShortcut } from './warehouseShortcuts';

function fnKey(action: string): string {
  return getWarehouseShortcut(action)?.key ?? action;
}

interface WarehouseFnBarProps {
  onReceive: () => void;
  onSend: () => void;
  onCount: () => void;
  onStock: () => void;
  onPrint: () => void;
  onToggleFullscreen: () => void;
  onShowHelp: () => void;
}

export default function WarehouseFnBar({
  onReceive,
  onSend,
  onCount,
  onStock,
  onPrint,
  onToggleFullscreen,
  onShowHelp,
}: WarehouseFnBarProps) {
  const { l10n } = useLocalization();

  return (
    <div className="warehouse-fn-bar" role="toolbar" aria-label={requiredLocalized(l10n, 'warehouse-fn-bar-aria')}>
      <button type="button" className="warehouse-fn-btn" onClick={onReceive} aria-keyshortcuts={fnKey('receive-popup')}>
        <span className="warehouse-fn-key">{fnKey('receive-popup')}</span>
        <span className="warehouse-fn-label">{requiredLocalized(l10n, 'warehouse-fn-receive')}</span>
      </button>
      <button type="button" className="warehouse-fn-btn" onClick={onSend} aria-keyshortcuts={fnKey('send-popup')}>
        <span className="warehouse-fn-key">{fnKey('send-popup')}</span>
        <span className="warehouse-fn-label">{requiredLocalized(l10n, 'warehouse-fn-send')}</span>
      </button>
      <button type="button" className="warehouse-fn-btn" onClick={onCount} aria-keyshortcuts={fnKey('count-popup')}>
        <span className="warehouse-fn-key">{fnKey('count-popup')}</span>
        <span className="warehouse-fn-label">{requiredLocalized(l10n, 'warehouse-fn-count')}</span>
      </button>
      <button type="button" className="warehouse-fn-btn" onClick={onStock} aria-keyshortcuts={fnKey('stock')}>
        <span className="warehouse-fn-key">{fnKey('stock')}</span>
        <span className="warehouse-fn-label">{requiredLocalized(l10n, 'warehouse-fn-stock')}</span>
      </button>
      <button type="button" className="warehouse-fn-btn" onClick={onPrint} aria-keyshortcuts={fnKey('print')}>
        <span className="warehouse-fn-key">{fnKey('print')}</span>
        <span className="warehouse-fn-label">{requiredLocalized(l10n, 'warehouse-fn-print')}</span>
      </button>

      {/* Placeholder buttons F6–F12 — rendered, no handler */}
      {['F6', 'F7', 'F8', 'F9', 'F10'].map((k) => (
        <button key={k} type="button" className="warehouse-fn-btn warehouse-fn-btn--placeholder" disabled tabIndex={-1} aria-hidden="true">
          <span className="warehouse-fn-key">{k}</span>
          <span className="warehouse-fn-label">{requiredLocalized(l10n, 'warehouse-fn-reserved', { key: k })}</span>
        </button>
      ))}

      <button type="button" className="warehouse-fn-btn" onClick={onToggleFullscreen} aria-keyshortcuts={fnKey('fullscreen')}>
        <span className="warehouse-fn-key">{fnKey('fullscreen')}</span>
        <span className="warehouse-fn-label">{requiredLocalized(l10n, 'warehouse-fn-fullscreen')}</span>
      </button>

      <button type="button" className="warehouse-fn-btn warehouse-fn-btn--placeholder" disabled tabIndex={-1} aria-hidden="true">
        <span className="warehouse-fn-key">F12</span>
        <span className="warehouse-fn-label">{requiredLocalized(l10n, 'warehouse-fn-reserved', { key: 'F12' })}</span>
      </button>

      <div className="warehouse-fn-spacer" />

      <button type="button" className="warehouse-fn-btn warehouse-fn-btn--help" onClick={onShowHelp} aria-keyshortcuts={fnKey('shortcut-list')}>
        <span className="warehouse-fn-key">{fnKey('shortcut-list')}</span>
      </button>
    </div>
  );
}