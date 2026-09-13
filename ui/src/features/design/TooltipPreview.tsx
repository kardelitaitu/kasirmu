import Tooltip from '@/frontend/shell/Tooltip';
import ThemeToggle from '@/frontend/shell/ThemeToggle';
import { useLocalization } from '@fluent/react';
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
  return (
    <div className="tp-page">
      <header className="tp-header">
        <h1>Tooltip Preview</h1>
        <ThemeToggle />
      </header>

      <div className="tp-layout">
        {/* ════════════════════════════════════════════════════════
            Section 1: Positions
           ════════════════════════════════════════════════════════ */}
        <section className="tp-section">
          <h2 className="tp-section-title">Positions</h2>
          <p className="tp-section-desc">
            Tooltips can be positioned on any side of the trigger element.
            The default is <code>right</code>.
          </p>

          <div className="tp-position-grid">
            <div className="tp-position-cell">
              <Tooltip content="Tooltip on the right (default)" position="right">
                <button type="button" className="tp-trigger tp-trigger--primary">
                  Right
                </button>
              </Tooltip>
              <span className="tp-position-label">position=&quot;right&quot;</span>
            </div>

            <div className="tp-position-cell">
              <Tooltip content="Tooltip above the trigger" position="top">
                <button type="button" className="tp-trigger tp-trigger--primary">
                  Top
                </button>
              </Tooltip>
              <span className="tp-position-label">position=&quot;top&quot;</span>
            </div>

            <div className="tp-position-cell">
              <Tooltip content="Tooltip below the trigger" position="bottom">
                <button type="button" className="tp-trigger tp-trigger--primary">
                  Bottom
                </button>
              </Tooltip>
              <span className="tp-position-label">position=&quot;bottom&quot;</span>
            </div>

            <div className="tp-position-cell">
              <Tooltip content="Tooltip on the left of the trigger" position="left">
                <button type="button" className="tp-trigger tp-trigger--primary">
                  Left
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
          <h2 className="tp-section-title">Show / Hide Delay</h2>
          <p className="tp-section-desc">
            The show delay prevents tooltips from flashing during cursor passes.
            Default is 400ms show, 100ms hide.
          </p>

          <div className="tp-demo-row">
            <Tooltip content="Instant show (0ms delay, 100ms hide)" showDelay={0}>
              <button type="button" className="tp-trigger">Instant</button>
            </Tooltip>

            <Tooltip content="Fast show (200ms delay, 50ms hide)" showDelay={200} hideDelay={50}>
              <button type="button" className="tp-trigger">200ms</button>
            </Tooltip>

            <Tooltip content="Default show (400ms delay, 100ms hide)" showDelay={400} hideDelay={100}>
              <button type="button" className="tp-trigger tp-trigger--primary">Default (400ms)</button>
            </Tooltip>

            <Tooltip content="Slow reveal (800ms delay)" showDelay={800}>
              <button type="button" className="tp-trigger">800ms</button>
            </Tooltip>

            <Tooltip content="Very slow (1200ms delay)" showDelay={1200}>
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
          <h2 className="tp-section-title">Max Width</h2>
          <p className="tp-section-desc">
            Control the tooltip bubble width with the <code>maxWidth</code> prop.
            Default is 280px. Content wraps automatically.
          </p>

          <div className="tp-demo-row">
            <Tooltip content="Narrow tooltip — 160px max" maxWidth="160px">
              <button type="button" className="tp-trigger">160px</button>
            </Tooltip>

            <Tooltip content="Default width — 280px max. This is the standard tooltip width used throughout the app.">
              <button type="button" className="tp-trigger tp-trigger--primary">Default (280px)</button>
            </Tooltip>

            <Tooltip content="Wide tooltip — 400px max. Useful for longer descriptions that need more horizontal space to read comfortably." maxWidth="400px">
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
          <h2 className="tp-section-title">Multi-line Content</h2>
          <p className="tp-section-desc">
            Tooltip text wraps naturally with <code>white-space: normal</code>.
            Use <code>{'\n'}</code> in strings or JSX line breaks for structured content.
          </p>

          <div className="tp-demo-columns">
            <div className="tp-demo-col">
              <Tooltip
                content={`Short description — ideal for nav items and icon labels.`}
                position="right"
              >
                <button type="button" className="tp-trigger tp-trigger--primary">Short</button>
              </Tooltip>
              <span className="tp-demo-col-label">Single line</span>
            </div>

            <div className="tp-demo-col">
              <Tooltip
                content={`Medium description that wraps to multiple lines when the content is longer than the max width allows for natural readability.`}
                position="right"
              >
                <button type="button" className="tp-trigger">Wrapping</button>
              </Tooltip>
              <span className="tp-demo-col-label">Auto-wrapping</span>
            </div>

            <div className="tp-demo-col">
              <Tooltip
                content={`Line one: Order ID #2847\nLine two: 4 items • $42.50\nLine three: Priority: High`}
                maxWidth="220px"
                position="right"
              >
                <button type="button" className="tp-trigger">Structured</button>
              </Tooltip>
              <span className="tp-demo-col-label">{'With \\n breaks'}</span>
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
          <h2 className="tp-section-title">Content Types</h2>
          <p className="tp-section-desc">
            The <code>content</code> prop accepts any ReactNode — plain text,
            formatted strings, or JSX elements.
          </p>

          <div className="tp-demo-row">
            <Tooltip content="Plain text tooltip — the most common use case.">
              <button type="button" className="tp-trigger">Text</button>
            </Tooltip>

            <Tooltip
              content={
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  Info: Gateway is online
                </span>
              }
            >
              <button type="button" className="tp-trigger tp-trigger--primary">JSX</button>
            </Tooltip>

            <Tooltip
              content={
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.8125rem' }}>Status Details</span>
                  <span style={{ opacity: 0.85, fontSize: '0.75rem' }}>
                    Online · Last sync: 2s ago · Queue: 0
                  </span>
                </span>
              }
              maxWidth="200px"
            >
              <button type="button" className="tp-trigger">Rich</button>
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
          <h2 className="tp-section-title">Edge Cases</h2>
          <p className="tp-section-desc">
            Tooltips work with any focusable element — buttons, icon-only
            buttons, inline text, spans, and custom components.
          </p>

          <div className="tp-demo-row">
            <Tooltip content="Icon button — collapse sidebar" position="bottom">
              <button type="button" className="tp-trigger tp-trigger--icon" aria-label={l10n.getString('collapse-aria')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </Tooltip>

            <Tooltip content="Icon button — notifications" position="bottom">
              <button type="button" className="tp-trigger tp-trigger--icon" aria-label={l10n.getString('notifications-aria')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </button>
            </Tooltip>

            <Tooltip content="Icon button — settings" position="bottom">
              <button type="button" className="tp-trigger tp-trigger--icon" aria-label={l10n.getString('settings-aria')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </Tooltip>

            <Tooltip content="Small badge with tooltip" position="bottom">
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
                Beta
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
</Tooltip>`}</code>
        </section>

        {/* ════════════════════════════════════════════════════════
            Section 7: Production Usage
           ════════════════════════════════════════════════════════ */}
        <section className="tp-section">
          <h2 className="tp-section-title">Production Usage</h2>
          <p className="tp-section-desc">
            This is how Tooltip is used in the app sidebar — nav items wrapped
            with Tooltip, showing labels on hover in collapsed mode.
          </p>

          <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
            {/* Collapsed sidebar simulation */}
            <div>
              <div className="tp-section-subtitle" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-fg-tertiary)', marginBottom: 'var(--space-3)', fontFamily: 'var(--font-mono)' }}>
                Collapsed sidebar (60px)
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
                Expanded sidebar (220px)
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
                Status Bar elements
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', height: 28 }}>
                <Tooltip content="Backend connected" position="top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-success)', boxShadow: '0 0 4px var(--color-success)', display: 'inline-block' }} />
                    <span style={{ fontSize: '0.625rem', fontWeight: 600, color: 'var(--color-fg-secondary)' }}>OZ-POS v0.0.37</span>
                  </div>
                </Tooltip>

                <span style={{ width: 1, height: 14, background: 'var(--color-border)', opacity: 0.5, display: 'inline-block' }} />

                <Tooltip content="Switch Workspace" position="top">
                  <button type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', height: 22, border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-fg-tertiary)', fontSize: '0.625rem', cursor: 'pointer' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                    <span>Workspace</span>
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
