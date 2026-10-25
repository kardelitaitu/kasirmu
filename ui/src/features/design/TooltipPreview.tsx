import { Localized, useLocalization } from '@fluent/react';
import Tooltip from '@/app/Tooltip';
import ThemeToggle from '@/app/ThemeToggle';
import { useVersionStatus } from '@/hooks/useVersionStatus';
import { formatDisplayVersion } from '@/build-id';
import './TooltipPreview.css';

/**
 * Tooltip Preview — interactive showcase of every Tooltip variant.
 *
 * Sections:
 *   1. Positions — right, top, bottom, left
 *   2. Delays — custom show/hide timing
 *   3. MaxWidth — narrow, default, wide
 *   4. Multi-line content
 *   5. Content types — plain text, formatted, JSX
 *   6. Edge cases — icon buttons, inline triggers, disabled elements
 *   7. Production usage — sidebar simulation
 */
export default function TooltipPreview() {
  const { l10n } = useLocalization();
  // Show the real version: this surface renders a mock status pill, and a
  // hardcoded one advertised a stale version on the design page.
  const { currentVersion, buildId } = useVersionStatus();
  return (
    <div className="tp-page">
      <header className="tp-header">
        <Localized id="tp-page-title">
          <h1>Tooltip Preview</h1>
        </Localized>
        <ThemeToggle />
      </header>

      <div className="tp-layout">
        {/* ════════════════════════════════════════════════════════
            Section 1: Positions
           ════════════════════════════════════════════════════════ */}
        <section className="tp-section">
          <Localized id="tp-section-positions">
            <h2 className="tp-section-title">Positions</h2>
          </Localized>
          <p className="tp-section-desc">
            <Localized id="tp-section-positions-desc">
              <span>Tooltips can be positioned on any side of the trigger element. The default is right.</span>
            </Localized>
          </p>

          <div className="tp-position-grid">
            <div className="tp-position-cell">
              <Tooltip content={l10n.getString('tp-tooltip-right')} position="right">
                <button type="button" className="tp-trigger tp-trigger--primary">
                  <Localized id="tp-position-right">
                    <span>Right</span>
                  </Localized>
                </button>
              </Tooltip>
              <span className="tp-position-label">position=&quot;right&quot;</span>
            </div>

            <div className="tp-position-cell">
              <Tooltip content={l10n.getString('tp-tooltip-top')} position="top">
                <button type="button" className="tp-trigger tp-trigger--primary">
                  <Localized id="tp-position-top">
                    <span>Top</span>
                  </Localized>
                </button>
              </Tooltip>
              <span className="tp-position-label">position=&quot;top&quot;</span>
            </div>

            <div className="tp-position-cell">
              <Tooltip content={l10n.getString('tp-tooltip-bottom')} position="bottom">
                <button type="button" className="tp-trigger tp-trigger--primary">
                  <Localized id="tp-position-bottom">
                    <span>Bottom</span>
                  </Localized>
                </button>
              </Tooltip>
              <span className="tp-position-label">position=&quot;bottom&quot;</span>
            </div>

            <div className="tp-position-cell">
              <Tooltip content={l10n.getString('tp-tooltip-left')} position="left">
                <button type="button" className="tp-trigger tp-trigger--primary">
                  <Localized id="tp-position-left">
                    <span>Left</span>
                  </Localized>
                </button>
              </Tooltip>
              <span className="tp-position-label">position=&quot;left&quot;</span>
            </div>
          </div>

          <code className="tp-code">{`<Tooltip content="..." position="right">
  <button>Trigger</button>
</Tooltip>`}</code>
        </section>

        {/* ════════════════════════════════════════════════════════
            Section 2: Delays
           ════════════════════════════════════════════════════════ */}
        <section className="tp-section">
          <Localized id="tp-section-delay">
            <h2 className="tp-section-title">Show / Hide Delay</h2>
          </Localized>
          <p className="tp-section-desc">
            <Localized id="tp-section-delay-desc">
              <span>The show delay prevents tooltips from flashing during cursor passes. Default is 400ms show, 100ms hide.</span>
            </Localized>
          </p>

          <div className="tp-demo-row">
            <Tooltip content={l10n.getString('tp-tooltip-instant')} showDelay={0}>
              <button type="button" className="tp-trigger">
                <Localized id="tp-trigger-instant"><span>Instant</span></Localized>
              </button>
            </Tooltip>

            <Tooltip content={l10n.getString('tp-tooltip-fast')} showDelay={200} hideDelay={50}>
              <button type="button" className="tp-trigger">200ms</button>
            </Tooltip>

            <Tooltip content={l10n.getString('tp-tooltip-default-ms')} showDelay={400} hideDelay={100}>
              <button type="button" className="tp-trigger tp-trigger--primary">
                <Localized id="tp-trigger-default-ms"><span>Default (400ms)</span></Localized>
              </button>
            </Tooltip>

            <Tooltip content={l10n.getString('tp-tooltip-slow')} showDelay={800}>
              <button type="button" className="tp-trigger">800ms</button>
            </Tooltip>

            <Tooltip content={l10n.getString('tp-tooltip-very-slow')} showDelay={1200}>
              <button type="button" className="tp-trigger">1200ms</button>
            </Tooltip>
          </div>

          <code className="tp-code">{`{/* Default (400ms show, 100ms hide) */}
<Tooltip content="...">
  <button>Trigger</button>
</Tooltip>

{/* Instant / fast */}
<Tooltip content="..." showDelay={0}>
  <button>Trigger</button>
</Tooltip>

{/* Slow reveal */}
<Tooltip content="..." showDelay={800}>
  <button>Trigger</button>
</Tooltip>`}</code>
        </section>

        {/* ════════════════════════════════════════════════════════
            Section 3: MaxWidth
           ════════════════════════════════════════════════════════ */}
        <section className="tp-section">
          <Localized id="tp-section-maxwidth">
            <h2 className="tp-section-title">Max Width</h2>
          </Localized>
          <p className="tp-section-desc">
            <Localized id="tp-section-maxwidth-desc">
              <span>Control the tooltip bubble width with the maxWidth prop. Default is 280px. Content wraps automatically.</span>
            </Localized>
          </p>

          <div className="tp-demo-row">
            <Tooltip content={l10n.getString('tp-tooltip-160')} maxWidth="160px">
              <button type="button" className="tp-trigger">160px</button>
            </Tooltip>

            <Tooltip content={l10n.getString('tp-tooltip-280')}>
              <button type="button" className="tp-trigger tp-trigger--primary">
                <Localized id="tp-trigger-280"><span>Default (280px)</span></Localized>
              </button>
            </Tooltip>

            <Tooltip content={l10n.getString('tp-tooltip-400')} maxWidth="400px">
              <button type="button" className="tp-trigger">400px</button>
            </Tooltip>
          </div>

          <code className="tp-code">{`{/* Default (280px) */}
<Tooltip content="...">
  <button>Trigger</button>
</Tooltip>

{/* Narrow */}
<Tooltip content="..." maxWidth="160px">
  <button>Trigger</button>
</Tooltip>

{/* Wide */}
<Tooltip content="..." maxWidth="400px">
  <button>Trigger</button>
</Tooltip>`}</code>
        </section>

        {/* ════════════════════════════════════════════════════════
            Section 4: Multi-line Content
           ════════════════════════════════════════════════════════ */}
        <section className="tp-section">
          <Localized id="tp-section-multiline">
            <h2 className="tp-section-title">Multi-line Content</h2>
          </Localized>
          <p className="tp-section-desc">
            <Localized id="tp-section-multiline-desc">
              <span>Tooltip text wraps naturally with white-space: normal. Use an escaped newline in strings or JSX line breaks for structured content.</span>
            </Localized>
          </p>

          <div className="tp-demo-columns">
            <div className="tp-demo-col">
              <Tooltip content={l10n.getString('tp-tooltip-short')} position="right">
                <button type="button" className="tp-trigger tp-trigger--primary">
                  <Localized id="tp-trigger-short"><span>Short</span></Localized>
                </button>
              </Tooltip>
              <Localized id="tp-label-single-line">
                <span className="tp-demo-col-label">Single line</span>
              </Localized>
            </div>

            <div className="tp-demo-col">
              <Tooltip content={l10n.getString('tp-tooltip-wrapping')} position="right">
                <button type="button" className="tp-trigger">
                  <Localized id="tp-trigger-wrapping"><span>Wrapping</span></Localized>
                </button>
              </Tooltip>
              <Localized id="tp-label-auto-wrapping">
                <span className="tp-demo-col-label">Auto-wrapping</span>
              </Localized>
            </div>

            <div className="tp-demo-col">
              <Tooltip
                content={[
                  l10n.getString('tp-tooltip-structured-line1'),
                  l10n.getString('tp-tooltip-structured-line2', { amount: '$42.50' }),
                  l10n.getString('tp-tooltip-structured-line3'),
                ].join('\n')}
                maxWidth="220px"
                position="right"
              >
                <button type="button" className="tp-trigger">
                  <Localized id="tp-trigger-structured"><span>Structured</span></Localized>
                </button>
              </Tooltip>
              <Localized id="tp-label-with-breaks">
                <span className="tp-demo-col-label">With newline breaks</span>
              </Localized>
            </div>
          </div>

          <code className="tp-code">{`{/* Multi-line with escaped newlines */}
<Tooltip content={"Line one\\nLine two\\nLine three"}>
  <button>Trigger</button>
</Tooltip>`}</code>
        </section>

        {/* ════════════════════════════════════════════════════════
            Section 5: Content Types
           ════════════════════════════════════════════════════════ */}
        <section className="tp-section">
          <Localized id="tp-section-content-types">
            <h2 className="tp-section-title">Content Types</h2>
          </Localized>
          <p className="tp-section-desc">
            <Localized id="tp-section-content-types-desc">
              <span>The content prop accepts any ReactNode — plain text, formatted strings, or JSX elements.</span>
            </Localized>
          </p>

          <div className="tp-demo-row">
            <Tooltip content={l10n.getString('tp-tooltip-plain')}>
              <button type="button" className="tp-trigger">
                <Localized id="tp-trigger-text"><span>Text</span></Localized>
              </button>
            </Tooltip>

            <Tooltip
              content={
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  {l10n.getString('tp-tooltip-jsx')}
                </span>
              }
            >
              <button type="button" className="tp-trigger tp-trigger--primary">
                <Localized id="tp-trigger-jsx"><span>JSX</span></Localized>
              </button>
            </Tooltip>

            <Tooltip
              content={
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.8125rem' }}>
                    {l10n.getString('tp-tooltip-rich-title')}
                  </span>
                  <span style={{ opacity: 0.85, fontSize: '0.75rem' }}>
                    {l10n.getString('tp-tooltip-rich-body')}
                  </span>
                </span>
              }
              maxWidth="200px"
            >
              <button type="button" className="tp-trigger">
                <Localized id="tp-trigger-rich"><span>Rich</span></Localized>
              </button>
            </Tooltip>
          </div>

          <code className="tp-code">{`{/* Plain text */}
<Tooltip content="Plain text tooltip">
  <button>Trigger</button>
</Tooltip>

{/* JSX content */}
<Tooltip content={<span><Icon /> Gateway is online</span>}>
  <button>Trigger</button>
</Tooltip>

{/* Rich formatted content */}
<Tooltip
  content={
    <div>
      <strong>Status Details</strong>
      <span>Online · Last sync: 2s ago</span>
    </div>
  }
>
  <button>Trigger</button>
</Tooltip>`}</code>
        </section>

        {/* ════════════════════════════════════════════════════════
            Section 6: Edge Cases
           ════════════════════════════════════════════════════════ */}
        <section className="tp-section">
          <Localized id="tp-section-edge">
            <h2 className="tp-section-title">Edge Cases</h2>
          </Localized>
          <p className="tp-section-desc">
            <Localized id="tp-section-edge-desc">
              <span>Tooltips work with any focusable element — buttons, icon-only buttons, inline text, spans, and custom components.</span>
            </Localized>
          </p>

          <div className="tp-demo-row">
            <Tooltip content={l10n.getString('tp-tooltip-icon-collapse')} position="bottom">
              <button type="button" className="tp-trigger tp-trigger--icon" aria-label={l10n.getString('collapse-aria')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </Tooltip>

            <Tooltip content={l10n.getString('tp-tooltip-icon-bell')} position="bottom">
              <button type="button" className="tp-trigger tp-trigger--icon" aria-label={l10n.getString('notifications-aria')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </button>
            </Tooltip>

            <Tooltip content={l10n.getString('tp-tooltip-icon-settings')} position="bottom">
              <button type="button" className="tp-trigger tp-trigger--icon" aria-label={l10n.getString('settings-aria')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </Tooltip>

            <Tooltip content={l10n.getString('tp-tooltip-badge')} position="bottom">
              <button
                type="button"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 8px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--color-accent-fg)',
                  background: 'var(--color-accent)',
                  borderRadius: 'var(--radius-full)',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  lineHeight: 'inherit',
                }}
                aria-label={l10n.getString('badge-tooltip-aria')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <Localized id="tp-trigger-beta"><span>Beta</span></Localized>
              </button>
            </Tooltip>

            {/* Inline text trigger. The section's own description above names
                "inline text, spans, and custom components", and the sheet has
                carried a complete .tp-trigger--inline rule (:164, with its :hover
                at :176) since the page was written — but no demo ever applied it,
                so the rule read as dead CSS. This is the demo the copy promises:
                a <button>, because a tooltip trigger must be focusable, styled by
                the sheet rather than by an inline style object so the rule is
                exercised rather than duplicated. */}
            <Tooltip content={l10n.getString('tp-tooltip-inline')} position="bottom">
              <button type="button" className="tp-trigger tp-trigger--inline">
                <Localized id="tp-trigger-inline"><span>inline trigger</span></Localized>
              </button>
            </Tooltip>
          </div>

          <code className="tp-code">{`{/* Icon button */}
<Tooltip content="Collapse sidebar">
  <button aria-label={l10n.getString('collapse-aria')}>
    <ChevronLeftIcon />
  </button>
</Tooltip>

{/* Badge trigger */}
<Tooltip content="Beta feature">
  <span tabIndex={0} role="button">Beta</span>
</Tooltip>

{/* Inline text trigger */}
<Tooltip content="Inline text trigger">
  <button className="tp-trigger tp-trigger--inline">inline trigger</button>
</Tooltip>`}</code>
        </section>

        {/* ════════════════════════════════════════════════════════
            Section 7: Production Usage
           ════════════════════════════════════════════════════════ */}
        <section className="tp-section">
          <Localized id="tp-section-production">
            <h2 className="tp-section-title">Production Usage</h2>
          </Localized>
          <p className="tp-section-desc">
            <Localized id="tp-section-production-desc">
              <span>This is how Tooltip is used in the app sidebar — nav items wrapped with Tooltip, showing labels on hover in collapsed mode.</span>
            </Localized>
          </p>

          <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
            {/* Collapsed sidebar simulation */}
            <div>
              <div className="tp-section-subtitle" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-fg-tertiary)', marginBottom: 'var(--space-3)', fontFamily: 'var(--font-mono)' }}>
                <Localized id="tp-label-collapsed"><span>Collapsed sidebar (60px)</span></Localized>
              </div>
              <div style={{ width: 60, padding: 'var(--space-2)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[
                  { icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', label: 'Dashboard' },
                  { icon: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', label: 'POS' },
                  { icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', label: 'Products' },
                  { icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', label: 'Shifts' },
                ].map((item) => (
                  <Tooltip key={item.label} content={item.label} position="right">
                    <button
                      type="button"
                      className="tp-sidebar-item"
                      style={{ justifyContent: 'center', padding: 'var(--space-2)' }}
                      aria-label={item.label}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
                        <path d={item.icon} />
                      </svg>
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* Expanded sidebar simulation */}
            <div>
              <div className="tp-section-subtitle" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-fg-tertiary)', marginBottom: 'var(--space-3)', fontFamily: 'var(--font-mono)' }}>
                <Localized id="tp-label-expanded"><span>Expanded sidebar (220px)</span></Localized>
              </div>
              <div className="tp-sidebar-sim">
                {[
                  { icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', label: 'Dashboard' },
                  { icon: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', label: 'POS', active: true },
                  { icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', label: 'Products' },
                  { icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', label: 'Shifts' },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={`tp-sidebar-item${item.active ? ' tp-sidebar-item--active' : ''}`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
                      <path d={item.icon} />
                    </svg>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Status bar simulation */}
            <div>
              <div className="tp-section-subtitle" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-fg-tertiary)', marginBottom: 'var(--space-3)', fontFamily: 'var(--font-mono)' }}>
                <Localized id="tp-label-status-bar"><span>Status Bar elements</span></Localized>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', height: 28 }}>
                <Tooltip content={l10n.getString('tp-tooltip-connected')} position="top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-success)', boxShadow: '0 0 4px var(--color-success)', display: 'inline-block' }} />
                    <span style={{ fontSize: '0.625rem', fontWeight: 600, color: 'var(--color-fg-secondary)' }}>{`kasir.mu ${formatDisplayVersion(currentVersion, null, buildId)}`}</span>
                  </div>
                </Tooltip>

                <span style={{ width: 1, height: 14, background: 'var(--color-border)', opacity: 0.5, display: 'inline-block' }} />

                <Tooltip content={l10n.getString('tp-tooltip-switch-workspace')} position="top">
                  <button type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', height: 22, border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-fg-tertiary)', fontSize: '0.625rem', cursor: 'pointer' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                    <Localized id="tp-label-workspace"><span>Workspace</span></Localized>
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
