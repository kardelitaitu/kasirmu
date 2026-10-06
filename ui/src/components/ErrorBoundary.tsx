import { Component, type ErrorInfo, type ReactNode } from 'react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization } from '@fluent/react';
import { reportClientCrash } from '@/utils/crashReporter';
import './ErrorBoundary.css';

// Static bundle for ErrorBoundary (class component can't use hooks).
// This is the *emergency* fallback used only when no localized strings are
// injected from a wrapper (e.g. when LocaleProvider itself failed to mount).
// Prefer `LocalizedErrorBoundary` inside the locale tree so users see copy
// in the active language. Keys live in shared.ftl / shared.id.ftl.
const _ebBundle = new FluentBundle('en-US');
_ebBundle.addResource(new FluentResource(`
error-boundary-title = Something went wrong
error-boundary-retry = Try Again
`));
const _ebL10n = new ReactLocalization([_ebBundle]);

interface Props {
  children: ReactNode;
  /**
   * Called after the user clicks "Try Again" — replaces the default hard
   * reload with a scoped recovery. When omitted, the button hard-refreshes
   * the app (`window.location.reload()`).
   */
  onReset?: () => void;
  /**
   * When the fallback is shown, auto-reload the page after this many
   * milliseconds (self-healing). Only set this on full-page boundaries;
   * embedded card-level boundaries should leave it unset so a scoped
   * failure never reloads the whole app.
   */
  autoRefreshMs?: number;
  /** Pre-localized fallback title (injected by LocalizedErrorBoundary). */
  title?: string;
  /** Pre-localized retry label (injected by LocalizedErrorBoundary). */
  retryLabel?: string;
}

interface State {
  error: Error | null;
}

/**
 * React class-based error boundary that catches render errors and
 * displays a fallback UI with the error message and a "Try Again"
 * button.
 *
 * "Try Again" hard-refreshes the app (`window.location.reload()`) by
 * default — the safest recovery for an app that just failed to render.
 * Pass `onReset` to replace that with a scoped recovery (e.g. an
 * embedded card that can safely remount its own children). When
 * `autoRefreshMs` is set (full-page boundaries only), the fallback also
 * self-heals by reloading automatically.
 *
 * ERR-02: layout and colors come from token-backed CSS classes
 * (ErrorBoundary.css) instead of inline styles, so the fallback follows
 * the active brand theme, dark mode, and forced-colors overrides.
 *
 * Because class components cannot use hooks, localization is injected via
 * the optional `title`/`retryLabel` props (see `LocalizedErrorBoundary`).
 * The module-level English bundle is a locale-independent emergency
 * fallback for the case where localization itself is unavailable.
 */
export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    reportClientCrash({
      kind: 'react_error_boundary',
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    });
  }

  override componentDidMount() {
    if (this.state.error) {
      this.scheduleAutoReload();
    }
  }

  override componentDidUpdate(_prevProps: Props, prevState: State) {
    // Start the self-heal timer the moment the fallback appears.
    if (!prevState.error && this.state.error) {
      this.scheduleAutoReload();
    }
  }

  override componentWillUnmount() {
    this.clearAutoReload();
  }

  private scheduleAutoReload() {
    if (!this.props.autoRefreshMs || this.props.autoRefreshMs <= 0) return;
    this.clearAutoReload();
    this.reloadTimer = setTimeout(() => {
      window.location.reload();
    }, this.props.autoRefreshMs);
  }

  private clearAutoReload() {
    if (this.reloadTimer !== null) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  private handleReset = () => {
    this.clearAutoReload();
    if (this.props.onReset) {
      this.setState({ error: null });
      this.props.onReset();
      return;
    }
    // Default recovery: a hard refresh. The app just failed to render,
    // so remounting children in place is less trustworthy than a clean
    // reload of the whole process.
    window.location.reload();
  };

  override render() {
    if (this.state.error) {
      return (
        <div role="alert" className="error-boundary">
          <div className="error-boundary__card">
            <h2 className="error-boundary__title">
              {this.props.title ?? _ebL10n.getString('error-boundary-title')}
            </h2>
            <p className="error-boundary__message">{this.state.error.message}</p>
            <button
              type="button"
              className="error-boundary__retry"
              onClick={this.handleReset}
            >
              {this.props.retryLabel ?? _ebL10n.getString('error-boundary-retry')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
