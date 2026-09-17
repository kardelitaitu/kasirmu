/* eslint-disable react-refresh/only-export-components */import {
  createContext,
  useContext,
  useCallback,
  useState,
  type ReactNode,
} from 'react';
import { useLocalization } from '@fluent/react';
import { useAnimatedToastQueue } from '@/hooks/useAnimatedToastQueue';

// ── Types ──────────────────────────────────────────────────────────

/** Visual variant for a toast notification in the animated queue. */
export type ToastType = 'success' | 'error' | 'warning' | 'info';

/** A single toast in the animated queue with auto-dismiss support. */
export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  /** Optional bold headline above the message. @default none */
  title?: string;
  /** Auto-dismiss duration in ms. 0 = persistent. @default 4000 */
  duration?: number;
  /** Expandable detail text (error codes, stack traces, diagnostics). Shown behind a toggle on error toasts. */
  detail?: string;
  /** Unix timestamp (ms) when the toast was created. Shown in the detail section. */
  timestamp?: number;
}

interface ToastContextValue {
  addToast: (toast: Omit<Toast, 'id'> & { id?: string }) => string;
  removeToast: (id: string) => void;
  /**
   * Race-safe dismiss-all with coordinated exit fade. Items
   * enqueued during the fade (whose ids are not in the snapshot)
   * survive. Useful for "reset / restart" UX or any action that
   * needs to clear the entire notification queue in one go.
   */
  clearToasts: () => void;
}

// ── Context ────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ── Hook ────────────────────────────────────────────────────────────

/** Access the animated toast context. Must be used within a `<ToastProvider>`. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

// ── ID generator ────────────────────────────────────────────────────

let toastCounter = 0;
function generateId(): string {
  toastCounter += 1;
  return `toast-${toastCounter}-${Date.now()}`;
}

// ── Stable identity helpers (extracted to module scope so
// useAnimatedToastQueue receives === stable function refs;
// inline arrow props would recreate on every render and
// destabilise the enqueue/dismiss/clearAll callbacks.)
const getToastId = (t: Toast) => t.id;
const getToastAutoDismissMs = (t: Toast) => t.duration ?? 4000;

// ── Provider ────────────────────────────────────────────────────────

/**
 * ToastProvider — owns the animated toast queue, centralised timer
 * cleanup, and per-item isExiting state via `useAnimatedToastQueue`.
 *
 * Each toast added via `addToast()` schedules an auto-dismiss timer
 * (default 4000 ms, or the per-item `duration`). User-initiated
 * dismissal (× click) OR auto-expiry both flow through `removeToast`
 * → `queue.dismiss(id)` → adds the id to `exitingIds` → 200 ms
 * mirror CSS fade → final unmount.
 *
 * `clearToasts()` triggers the race-safe collective fade: snapshots
 * current ids, fades them all, and on the timer fire removes only
 * snapshot ids. Items enqueued DURING the fade (not in snapshot)
 * survive, matching the undo-pill's race-safety contract.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { enqueue, dismiss: queueDismiss, clearAll: queueClearAll, items, exitingIds } =
    useAnimatedToastQueue<Toast>({
      getId: getToastId,
      getAutoDismissMs: getToastAutoDismissMs,
    });

  const addToast = useCallback(
    (t: Omit<Toast, 'id'> & { id?: string }) => {
      const id = t.id ?? generateId();
      enqueue({ ...t, id, timestamp: t.timestamp ?? Date.now() });
      return id;
    },
    [enqueue],
  );

  const removeToast = useCallback(
    (id: string) => {
      queueDismiss(id);
    },
    [queueDismiss],
  );

  const clearToasts = useCallback(() => {
    queueClearAll();
  }, [queueClearAll]);

  return (
    <ToastContext.Provider value={{ addToast, removeToast, clearToasts }}>
      {children}
      <ToastContainer
        items={items}
        exitingIds={exitingIds}
        onDismiss={removeToast}
      />
    </ToastContext.Provider>
  );
}

// ── Variant icon ─────────────────────────────────────────────────

/**
 * 16px stroke icon per toast variant, matching the Design Language
 * alert icons (Feedback: "never colour alone — every tone carries its
 * icon"). Coloured via `currentColor` from `.toast__icon` so the
 * variant CSS owns the tint.
 */
function ToastIcon({ type }: { type: ToastType }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  } as const;

  switch (type) {
    case 'success':
      return (
        <svg {...common}>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case 'error':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    case 'warning':
      return (
        <svg {...common}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case 'info':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
  }
}

// ── Individual Toast ────────────────────────────────────────────────

function ToastItem({
  toast,
  isExiting,
  onDismiss,
}: {
  toast: Toast;
  isExiting: boolean;
  onDismiss: (id: string) => void;
}) {
  const { l10n } = useLocalization();
  const { id, type, title, message, detail, timestamp } = toast;
  const [detailOpen, setDetailOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const parts = [
      `Toast: ${type.toUpperCase()}`,
      `Time: ${timestamp ? new Date(timestamp).toISOString() : 'unknown'}`,
      `Message: ${message}`,
      title ? `Title: ${title}` : null,
      detail ? `Detail: ${detail}` : null,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(parts.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in restricted contexts
    }
  }, [type, timestamp, message, title, detail]);

  const formattedTime = timestamp
    ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div
      className={`toast toast--${type}${isExiting ? ' toast--exiting' : ''}`}
      role="alert"
      aria-live="assertive"
      aria-busy={isExiting}
      data-toast-id={id}
    >
      <div className="toast__icon" aria-hidden="true">
        <ToastIcon type={type} />
      </div>
      <div className="toast__body">
        {title !== undefined && title !== '' && (
          <div className="toast__title">{title}</div>
        )}
        <div className="toast__message">{message}</div>
        {detail && (
          <>
            <button
              type="button"
              className="toast__detail-toggle"
              onClick={() => setDetailOpen((o) => !o)}
              aria-expanded={detailOpen}
            >
              {detailOpen
                ? l10n.getString('toast-hide-detail', null, 'Hide detail')
                : l10n.getString('toast-show-detail', null, 'Show detail')}
            </button>
            {detailOpen && (
              <pre className="toast__detail">
                {detail}
              </pre>
            )}
          </>
        )}
        {formattedTime && (
          <div className="toast__timestamp">
            {formattedTime}
          </div>
        )}
      </div>
      <div className="toast__actions">
        {detail && (
          <button
            type="button"
            className="toast__action-btn"
            onClick={handleCopy}
            aria-label={l10n.getString('toast-copy-aria', null, 'Copy error details')}
          >
            {copied
              ? l10n.getString('toast-copied', null, 'Copied!')
              : l10n.getString('toast-copy', null, 'Copy')}
          </button>
        )}
        <button
          type="button"
          className="toast__dismiss"
          onClick={() => onDismiss(id)}
          disabled={isExiting}
          aria-label={l10n.getString('toast-dismiss-aria')}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Toast Container ─────────────────────────────────────────────────

function ToastContainer({
  items,
  exitingIds,
  onDismiss,
}: {
  items: readonly Toast[];
  exitingIds: ReadonlySet<string>;
  onDismiss: (id: string) => void;
}) {
  const { l10n } = useLocalization();
  if (items.length === 0) return null;

  return (
    <div className="toast-container" aria-label={l10n.getString('toast-notifications-aria')}>
      {items.map((t) => (
        <ToastItem
          key={t.id}
          toast={t}
          isExiting={exitingIds.has(t.id)}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
