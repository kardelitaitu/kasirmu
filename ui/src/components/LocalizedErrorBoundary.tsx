import type { ReactNode } from 'react';
import { useLocalization } from '@fluent/react';
import ErrorBoundary from './ErrorBoundary';
import { requiredLocalized } from '@/components/requiredLocalized';

interface LocalizedErrorBoundaryProps {
  children: ReactNode;
  /** Called after the user clicks "Try Again" — replaces the default hard reload. */
  onReset?: () => void;
  /** Auto-reload the fallback after this many ms (full-page boundaries only). */
  autoRefreshMs?: number;
}

/**
 * Locale-aware wrapper around `ErrorBoundary` (ERR-02).
 *
 * The class-based boundary cannot use hooks, so this functional wrapper
 * resolves the fallback copy through the active Fluent locale and injects
 * it via the `title`/`retryLabel` props. Keep a plain `<ErrorBoundary>`
 * at the very root (outside LocaleProvider) as the emergency fallback for
 * the case where localization itself is unavailable.
 */
export function LocalizedErrorBoundary({
  children,
  onReset,
  autoRefreshMs,
}: LocalizedErrorBoundaryProps) {
  const { l10n } = useLocalization();
  return (
    <ErrorBoundary
      title={requiredLocalized(l10n, 'error-boundary-title')}
      retryLabel={requiredLocalized(l10n, 'error-boundary-retry')}
      {...(onReset ? { onReset } : {})}
      {...(autoRefreshMs ? { autoRefreshMs } : {})}
    >
      {children}
    </ErrorBoundary>
  );
}
