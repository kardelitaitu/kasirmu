import { useLocalization } from '@fluent/react';
import { Localized } from '@/components/Localized';
import ThemeToggle from '@/app/ThemeToggle';
import { Badge } from '@/components/Badge';
import { Spinner } from '@/components/Spinner';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { ToastProvider, useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
// The showcase's own sheet. Without this line the page renders UNSTYLED: it writes
// 28 ds-* classes (ds-page, ds-section, ds-radius-grid, ds-shadow-card, …) and every
// one of them is defined in features/design/DesignSystem.css and nowhere else, so the
// sheet was loadable by no route and referenced by no file — only test baselines named
// it. Both sibling pages in this feature import their own sheet (TooltipPreview.tsx:6,
// DevToolbar.tsx:16); this one did not. Found by the screenExtraction coverage check
// while closing BASELINE_UNCITED, where the sheet's absence of an importer was the
// signal that it could not honestly be cited from any entry.
import './DesignSystem.css';

/**
 * Design System showcase — visual reference of every token category.
 *
 * Renders colour swatches, typography scale, spacing, shadows,
 * semantic buttons, and form elements so developers can inspect
 * the active theme at a glance.
 *
 * This screen is intended for development only and can be gated
 * behind a feature flag or stripped in production builds.
 */
export default function DesignSystem() {
  const { l10n } = useLocalization();
  return (
    <div className="ds-page">
      <header className="ds-header">
        <h1>
          <Localized id="ds-title">
            <span>Design System</span>
          </Localized>
        </h1>
        <ThemeToggle />
      </header>

      <div className="ds-layout">
        {/* ── Colors ────────────────────────────── */}
        <Section title="ds-section-colors">
          <SwatchRow label="ds-swatch-row-neutral">
            {([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const).map((n) => (
              <Swatch key={n} colour={`var(--neutral-${n})`} label={`${n}`} />
            ))}
          </SwatchRow>

          <SwatchRow label="ds-swatch-row-primary">
            {([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const).map((n) => (
              <Swatch key={n} colour={`var(--primary-${n})`} label={`${n}`} />
            ))}
          </SwatchRow>

          <SwatchRow label="ds-swatch-row-semantic">
            <Swatch colour="var(--color-success)" label="ds-swatch-success" />
            <Swatch colour="var(--color-warning)" label="ds-swatch-warning" />
            <Swatch colour="var(--color-danger)" label="ds-swatch-danger" />
            <Swatch colour="var(--color-info)" label="ds-swatch-info" />
          </SwatchRow>

          <SwatchRow label="ds-swatch-row-backgrounds">
            <Swatch colour="var(--color-bg)" label="ds-swatch-bg" />
            <Swatch colour="var(--color-bg-elevated)" label="ds-swatch-bg-elevated" />
            <Swatch colour="var(--color-bg-surface)" label="ds-swatch-bg-surface" />
            <Swatch colour="var(--color-bg-input)" label="ds-swatch-bg-input" />
          </SwatchRow>

          <SwatchRow label="ds-swatch-row-text">
            <Swatch colour="var(--color-fg-primary)" label="ds-swatch-fg-primary" />
            <Swatch colour="var(--color-fg)" label="ds-swatch-fg-body" />
            <Swatch colour="var(--color-fg-secondary)" label="ds-swatch-fg-secondary" />
            <Swatch colour="var(--color-fg-tertiary)" label="ds-swatch-fg-tertiary" />
            <Swatch colour="var(--color-fg-disabled)" label="ds-swatch-fg-disabled" />
          </SwatchRow>

          <SwatchRow label="ds-swatch-row-borders">
            <Swatch colour="var(--color-border)" label="ds-swatch-border" />
            <Swatch colour="var(--color-border-hover)" label="ds-swatch-border-hover" />
            <Swatch colour="var(--color-border-strong)" label="ds-swatch-border-strong" />
            <Swatch colour="var(--color-border-focus)" label="ds-swatch-border-focus" />
          </SwatchRow>

          <SwatchRow label="ds-swatch-row-accent">
            <Swatch colour="var(--color-accent)" label="ds-swatch-accent" />
            <Swatch colour="var(--color-accent-hover)" label="ds-swatch-accent-hover" />
            <Swatch colour="var(--color-accent-active)" label="ds-swatch-accent-active" />
            <Swatch colour="var(--color-accent-subtle)" label="ds-swatch-accent-subtle" />
          </SwatchRow>
        </Section>

        {/* ── Typography ────────────────────────── */}
        <Section title="ds-section-typography">
          <div className="ds-type-grid">
            <TypeSample tag="h1" token="text-2xl" value="1.5rem">
              <Localized id="ds-type-pangram"><span>The quick brown fox jumps over the lazy dog</span></Localized>
            </TypeSample>
            <TypeSample tag="h2" token="text-xl" value="1.25rem">
              <Localized id="ds-type-pangram"><span>The quick brown fox jumps over the lazy dog</span></Localized>
            </TypeSample>
            <TypeSample tag="h3" token="text-lg" value="1.125rem">
              <Localized id="ds-type-pangram"><span>The quick brown fox jumps over the lazy dog</span></Localized>
            </TypeSample>
            <TypeSample token="text-base" value="0.875rem">
              <Localized id="ds-type-body-14"><span>The quick brown fox jumps over the lazy dog — 14px body</span></Localized>
            </TypeSample>
            <TypeSample token="text-sm" value="0.75rem">
              <Localized id="ds-type-body-12"><span>The quick brown fox jumps over the lazy dog — 12px small</span></Localized>
            </TypeSample>
            <TypeSample token="text-xs" value="0.625rem">
              <Localized id="ds-type-body-10"><span>The quick brown fox jumps over the lazy dog — 10px extra small</span></Localized>
            </TypeSample>
          </div>

          <div className="ds-type-styles">
            <p><strong>{l10n.getString('ds-type-weight')}</strong> {l10n.getString('ds-type-weight-list')}</p>
            <p><strong>{l10n.getString('ds-type-mono')}</strong> <code>const x: string = &quot;hello&quot;;</code></p>
            <p><strong>{l10n.getString('ds-type-link')}</strong> <a href="https://example.com">{l10n.getString('ds-type-link-text')}</a></p>
          </div>
        </Section>

        {/* ── Spacing ──────────────────────────── */}
        <Section title="ds-section-spacing">
          <div className="ds-space-grid">
            {([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 16, 20, 24] as const).map((s) => {
              const name = s === Math.floor(s) ? `${s}` : `${s}`.replace('.', '_');
              return (
                <div key={name} className="ds-space-item">
                  <div
                    className="ds-space-bar"
                    style={{ width: `var(--space-${name})` }}
                  />
                  <span className="ds-space-label">
                    --space-{name} <br />({s > 0 ? `${s}rem` : '0'})
                  </span>
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── Shadows ──────────────────────────── */}
        <Section title="ds-section-shadows">
          <div className="ds-shadow-grid">
            {(['xs', 'sm', 'md', 'lg', 'xl', '2xl', 'inner'] as const).map((s) => (
              <div
                key={s}
                className="ds-shadow-card"
                style={{ boxShadow: `var(--shadow-${s})` }}
              >
                <code>--shadow-{s}</code>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Border radius ────────────────────── */}
        <Section title="ds-section-radius">
          <div className="ds-radius-grid">
            {(['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full'] as const).map((r) => (
              <div
                key={r}
                className="ds-radius-box"
                style={{ borderRadius: `var(--radius-${r})` }}
              >
                <span>{r}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Buttons ──────────────────────────── */}
        <Section title="ds-section-buttons">
          <div className="ds-button-row">
            <button type="button" className="btn btn--primary">{l10n.getString('ds-btn-primary')}</button>
            <button type="button" className="btn btn--secondary">{l10n.getString('ds-btn-secondary')}</button>
            <button type="button" className="btn btn--danger">{l10n.getString('ds-btn-danger')}</button>
            <button type="button" className="btn btn--ghost">{l10n.getString('ds-btn-ghost')}</button>
            <button type="button" className="btn btn--primary" disabled>{l10n.getString('ds-btn-disabled')}</button>
          </div>
        </Section>

        {/* ── Form elements ────────────────────── */}
        <Section title="ds-section-forms">
          <div className="ds-form-grid">
            <label className="ds-field">
              <span>{l10n.getString('ds-form-text-input')}</span>
              <input type="text" placeholder={l10n.getString('ds-form-placeholder')} />
            </label>
            <label className="ds-field">
              <span>{l10n.getString('ds-form-select')}</span>
              <select>
                <option>{l10n.getString('ds-form-option-1')}</option>
                <option>{l10n.getString('ds-form-option-2')}</option>
                <option>{l10n.getString('ds-form-option-3')}</option>
              </select>
            </label>
            <label className="ds-field">
              <span>{l10n.getString('ds-form-textarea')}</span>
              <textarea rows={3} placeholder={l10n.getString('ds-form-textarea-placeholder')} />
            </label>
          </div>
        </Section>

        {/* ── Badges ───────────────────────────── */}
        <Section title="ds-section-badges">
          <div className="ds-section-subtitle">{l10n.getString('ds-badge-variants-md')}</div>
          <div className="ds-button-row" style={{ marginBottom: 'var(--space-4)' }}>
            <Badge variant="default">{l10n.getString('ds-badge-default')}</Badge>
            <Badge variant="success">{l10n.getString('ds-badge-success')}</Badge>
            <Badge variant="warning">{l10n.getString('ds-badge-warning')}</Badge>
            <Badge variant="danger">{l10n.getString('ds-badge-danger')}</Badge>
            <Badge variant="info">{l10n.getString('ds-badge-info')}</Badge>
          </div>
          <div className="ds-section-subtitle">{l10n.getString('ds-badge-sizes-sm')}</div>
          <div className="ds-button-row">
            <Badge variant="default" size="sm">{l10n.getString('ds-badge-default')}</Badge>
            <Badge variant="success" size="sm">{l10n.getString('ds-badge-success')}</Badge>
            <Badge variant="warning" size="sm">{l10n.getString('ds-badge-warning')}</Badge>
            <Badge variant="danger" size="sm">{l10n.getString('ds-badge-danger')}</Badge>
            <Badge variant="info" size="sm">{l10n.getString('ds-badge-info')}</Badge>
          </div>
        </Section>

        {/* ── Spinners ─────────────────────────── */}
        <Section title="ds-section-spinners">
          <div className="ds-section-subtitle">{l10n.getString('ds-spinner-sizes')}</div>
          <div className="ds-button-row" style={{ marginBottom: 'var(--space-4)' }}>
            <Spinner size="sm" />
            <Spinner size="md" />
            <Spinner size="lg" />
          </div>
          <div className="ds-section-subtitle">{l10n.getString('ds-spinner-with-label')}</div>
          <div className="ds-button-row">
            <Spinner size="sm" label={l10n.getString('ds-spinner-loading')} />
            <Spinner size="md" label={l10n.getString('ds-spinner-saving')} />
          </div>
        </Section>

        {/* ── Skeleton ─────────────────────────── */}
        <Section title="ds-section-skeleton">
          <div className="ds-section-subtitle">{l10n.getString('ds-skeleton-variants')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Skeleton variant="circle" width="40px" height="40px" />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="40%" />
              </div>
            </div>
            <Skeleton variant="block" width="100%" height="80px" />
          </div>
        </Section>

        {/* ── Toast ────────────────────────────── */}
        <Section title="ds-section-toasts">
          <ToastProvider>
            <ToastSection />
          </ToastProvider>
        </Section>

        {/* ── Empty State ──────────────────────── */}
        <Section title="ds-section-empty">
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
            <EmptyState
              icon={
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
              }
              title={l10n.getString('ds-empty-title')}
              description={l10n.getString('ds-empty-desc')}
              action={{ label: l10n.getString('ds-empty-action'), onClick: () => {} }}
            />
          </div>
        </Section>

        {/* ── Error State ──────────────────────── */}
        <Section title="ds-section-error">
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
            <ErrorState
              icon={
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              }
              title={l10n.getString('ds-error-title')}
              message={l10n.getString('ds-error-message')}
              onRetry={() => {}}
              retryLabel={l10n.getString('ds-error-retry')}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

// ── Toast demo sub-component (needs provider context) ──────────────

function ToastSection() {
  const { addToast } = useToast();
  const { l10n } = useLocalization();

  return (
    <div className="ds-toast-demo">
      <div className="ds-section-subtitle">{l10n.getString('ds-toast-trigger')}</div>
      <div className="ds-button-row">
        <Button variant="primary" onClick={() => addToast({ type: 'success', message: l10n.getString('ds-toast-success-msg') })}>
          {l10n.getString('ds-toast-show-success')}
        </Button>
        <Button variant="danger" onClick={() => addToast({ type: 'error', message: l10n.getString('ds-toast-error-msg') })}>
          {l10n.getString('ds-toast-show-error')}
        </Button>
        <Button variant="secondary" onClick={() => addToast({ type: 'warning', message: l10n.getString('ds-toast-warning-msg') })}>
          {l10n.getString('ds-toast-show-warning')}
        </Button>
        <Button variant="ghost" onClick={() => addToast({ type: 'info', message: l10n.getString('ds-toast-info-msg') })}>
          {l10n.getString('ds-toast-show-info')}
        </Button>
      </div>
    </div>
  );
}

// ── Internal sub-components ────────────────────────────────────────

// ── Why the label props are Fluent KEYS, not text ─────────────────
//
// Every label below is rendered through <Localized>, which REPLACES its wrapped
// child with the message value. A prop carrying DISPLAY text would therefore be
// a string no message could reach: the call site would keep English copy in the
// props while the JSX fallback sat in a message that is never rendered — a shape
// that looks localized and reads English.
//
// So the props are Fluent keys, and the fallback text stays inline as the
// element's child exactly where it is displayed. `ds-` is this page's namespace.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ds-section">
      <Localized id={title}>
        <h2 className="ds-section-title">{title}</h2>
      </Localized>
      {children}
    </section>
  );
}

function Swatch({ colour, label }: { colour: string; label: string }) {
  return (
    <div className="ds-swatch">
      <div className="ds-swatch-box" style={{ background: colour }} />
      <Localized id={label}>
        <span className="ds-swatch-label">{label}</span>
      </Localized>
    </div>
  );
}

function SwatchRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ds-swatch-row">
      <Localized id={label}>
        <span className="ds-swatch-row-label">{label}</span>
      </Localized>
      <div className="ds-swatch-group">{children}</div>
    </div>
  );
}

function TypeSample({
  tag,
  token,
  value,
  children,
}: {
  tag?: 'h1' | 'h2' | 'h3';
  token: string;
  value: string;
  children: React.ReactNode;
}) {
  const style = {
    fontSize: `var(--${token})`,
    margin: 0,
  } as React.CSSProperties;

  const Tag = tag ?? 'p';
  return (
    <div className="ds-type-sample">
      <Tag style={style}>{children}</Tag>
      <span className="ds-type-meta">
        {token} / {value}
      </span>
    </div>
  );
}
