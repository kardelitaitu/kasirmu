import { useEffect } from 'react';
import { useToast } from '@/components/Toast';
import { useLocalization } from '@fluent/react';
import { parseAppError, redactedDiagnostic, userErrorKey, errorDetail } from '@/utils/app-error';

/**
 * ERR-01 — global async-failure reporting layer.
 *
 * A React error boundary only catches render/lifecycle errors. Rejected
 * promises, timer-callback failures, and event-handler exceptions can still
 * surface as unhandled browser errors with no recovery UI. This component
 * installs `window.error` + `unhandledrejection` listeners that:
 *
 *  - log a redacted diagnostic (never raw SQL / tokens / customer data), and
 *  - surface a recoverable notification toast — but ONLY for unexpected
 *    defects. Expected API failures (parseable `AppError` with a typed
 *    `kind` like validation/permission/session/conflict/hardware) are
 *    handled by the feature screens that invoked the command, so they are
 *    logged but NOT toasted here to avoid double notification.
 *
 * Mount once inside `ToastProvider` (see `AppProviders`).
 */
export function GlobalErrorReporter() {
  const { addToast } = useToast();
  const { l10n } = useLocalization();

  useEffect(() => {
    // Kinds the app handles at the screen level — not globally fatal.
    const EXPECTED_USER_KEYS = new Set([
      'app-error-validation',
      'app-error-permission',
      'app-error-session',
      'app-error-conflict',
      'app-error-not-found',
      'app-error-offline',
      'app-error-hardware',
      'app-error-subscription',
    ]);

    const handleFailure = (err: unknown, source: string) => {
      const typed = parseAppError(err);
      const key = userErrorKey(err);
      // Expected typed API failures: log redacted, let the screen handle UX.
      if (typed && EXPECTED_USER_KEYS.has(key)) {
        console.warn(`[global-error] ${source} expected failure (${key})`, redactedDiagnostic(err));
        return;
      }
      // Unexpected defect: redacted log + recoverable notification.
      console.error(`[global-error] ${source}`, redactedDiagnostic(err));
      // Build diagnostic detail for copy-to-clipboard
      const detailParts = [
        `Source: ${source}`,
        `Time: ${new Date().toISOString()}`,
      ];
      const errDetail = errorDetail(err);
      if (errDetail) detailParts.push(errDetail);

      addToast({
        message: l10n.getString(
          'app-error-global',
          null,
          'Something unexpected happened. If this keeps happening, restart the app.',
        ),
        type: 'error',
        duration: 10000,
        title: l10n.getString('app-error-global-title', null, 'Unexpected error'),
        detail: detailParts.join('\n'),
      });
    };

    const onWindowError = (event: ErrorEvent) => {
      // React boundaries already route render errors; only handle the
      // truly uncaught ones (and never swallow the default handler).
      if (event.defaultPrevented) return;
      handleFailure(event.error ?? event.message, 'window.error');
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault?.();
      // jsdom (and some embedded webviews) may deliver the event without a
      // populated `reason`; fall back to the event itself so the failure is
      // still logged rather than silently dropped.
      handleFailure((event as { reason?: unknown }).reason ?? event, 'unhandledrejection');
    };

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [addToast, l10n]);

  return null;
}
