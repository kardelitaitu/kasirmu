import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TooltipPreview from '@/features/design/TooltipPreview';

// ── Mocks ────────────────────────────────────────────────────────
vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: {
      getString: (id: string) => {
        const map: Record<string, string> = {
          'collapse-aria': 'Collapse sidebar',
          'notifications-aria': 'Notifications',
          'settings-aria': 'Settings',
          'badge-tooltip-aria': 'Badge with tooltip',
          'tp-label-auto-wrapping': 'Auto-wrapping',
          'tp-label-collapsed': 'Collapsed sidebar (60px)',
          'tp-label-expanded': 'Expanded sidebar (220px)',
          'tp-label-single-line': 'Single line',
          'tp-label-status-bar': 'Status Bar elements',
          'tp-label-with-breaks': 'With newline breaks',
          'tp-label-workspace': 'Workspace',
          'tp-page-title': 'Tooltip Preview',
          'tp-position-bottom': 'Bottom',
          'tp-position-left': 'Left',
          'tp-position-right': 'Right',
          'tp-position-top': 'Top',
          'tp-section-content-types': 'Content Types',
          'tp-section-content-types-desc': 'The content prop accepts any ReactNode — plain text, formatted strings, or JSX elements.',
          'tp-section-delay': 'Show / Hide Delay',
          'tp-section-delay-desc': 'The show delay prevents tooltips from flashing during cursor passes. Default is 400ms show, 100ms hide.',
          'tp-section-edge': 'Edge Cases',
          'tp-section-edge-desc': 'Tooltips work with any focusable element — buttons, icon-only buttons, inline text, spans, and custom components.',
          'tp-section-maxwidth': 'Max Width',
          'tp-section-maxwidth-desc': 'Control the tooltip bubble width with the maxWidth prop. Default is 280px. Content wraps automatically.',
          'tp-section-multiline': 'Multi-line Content',
          'tp-section-multiline-desc': 'Tooltip text wraps naturally with white-space: normal. Use an escaped newline in strings or JSX line breaks for structured content.',
          'tp-section-positions': 'Positions',
          'tp-section-positions-desc': 'Tooltips can be positioned on any side of the trigger element. The default is right.',
          'tp-section-production': 'Production Usage',
          'tp-section-production-desc': 'This is how Tooltip is used in the app sidebar — nav items wrapped with Tooltip, showing labels on hover in collapsed mode.',
          'tp-tooltip-160': 'Narrow tooltip — 160px max',
          'tp-tooltip-280': 'Default width — 280px max. This is the standard tooltip width used throughout the app.',
          'tp-tooltip-400': 'Wide tooltip — 400px max. Useful for longer descriptions that need more horizontal space to read comfortably.',
          'tp-tooltip-badge': 'Small badge with tooltip',
          'tp-tooltip-bottom': 'Tooltip below the trigger',
          'tp-tooltip-connected': 'Backend connected',
          'tp-tooltip-default-ms': 'Default show (400ms delay, 100ms hide)',
          'tp-tooltip-fast': 'Fast show (200ms delay, 50ms hide)',
          'tp-tooltip-icon-bell': 'Icon button — notifications',
          'tp-tooltip-icon-collapse': 'Icon button — collapse sidebar',
          'tp-tooltip-icon-settings': 'Icon button — settings',
          'tp-tooltip-inline': 'Inline text trigger — dotted underline',
          'tp-tooltip-instant': 'Instant show (0ms delay, 100ms hide)',
          'tp-tooltip-jsx': 'Info: Gateway is online',
          'tp-tooltip-left': 'Tooltip on the left of the trigger',
          'tp-tooltip-plain': 'Plain text tooltip — the most common use case.',
          'tp-tooltip-rich-body': 'Online · Last sync: 2s ago · Queue: 0',
          'tp-tooltip-rich-title': 'Status Details',
          'tp-tooltip-right': 'Tooltip on the right (default)',
          'tp-tooltip-short': 'Short description — ideal for nav items and icon labels.',
          'tp-tooltip-slow': 'Slow reveal (800ms delay)',
          'tp-tooltip-structured-line1': 'Line one: Order ID #2847',
          'tp-tooltip-structured-line2': 'Line two: 4 items · {amount}',
          'tp-tooltip-structured-line3': 'Line three: Priority: High',
          'tp-tooltip-switch-workspace': 'Switch Workspace',
          'tp-tooltip-top': 'Tooltip above the trigger',
          'tp-tooltip-very-slow': 'Very slow (1200ms delay)',
          'tp-tooltip-wrapping': 'Medium description that wraps to multiple lines when the content is longer than the max width allows for natural readability.',
          'tp-trigger-280': 'Default (280px)',
          'tp-trigger-beta': 'Beta',
          'tp-trigger-default-ms': 'Default (400ms)',
          'tp-trigger-inline': 'inline trigger',
          'tp-trigger-instant': 'Instant',
          'tp-trigger-jsx': 'JSX',
          'tp-trigger-rich': 'Rich',
          'tp-trigger-short': 'Short',
          'tp-trigger-structured': 'Structured',
          'tp-trigger-text': 'Text',
          'tp-trigger-wrapping': 'Wrapping',
        };
        return map[id] || id;
      },
    },
  }),
  Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
  LocalizationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactLocalization: class {},
}));

vi.mock('@/app/Tooltip', () => ({
  default: ({ children, content }: { children: React.ReactNode; content: unknown; position?: string; showDelay?: number; hideDelay?: number; maxWidth?: string }) => (
    <span data-tooltip-content={typeof content === 'string' ? content : undefined}>
      {children}
    </span>
  ),
}));

vi.mock('@/app/ThemeToggle', () => ({
  default: () => <div data-testid="theme-toggle">ThemeToggle</div>,
}));

// ── Tests ────────────────────────────────────────────────────────

describe('TooltipPreview', () => {
  it('renders without crashing', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('Tooltip Preview')).toBeInTheDocument();
  });

  it('renders ThemeToggle component', () => {
    render(<TooltipPreview />);
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
  });

  // ── Section 1: Positions ──────────────────────────────────────

  it('renders Positions section', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('Positions')).toBeInTheDocument();
  });

  it('renders all position trigger buttons', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('Right')).toBeInTheDocument();
    expect(screen.getByText('Top')).toBeInTheDocument();
    expect(screen.getByText('Bottom')).toBeInTheDocument();
    expect(screen.getByText('Left')).toBeInTheDocument();
  });

  it('renders position labels', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('position="right"')).toBeInTheDocument();
    expect(screen.getByText('position="top"')).toBeInTheDocument();
    expect(screen.getByText('position="bottom"')).toBeInTheDocument();
    expect(screen.getByText('position="left"')).toBeInTheDocument();
  });

  // ── Section 2: Delays ─────────────────────────────────────────

  it('renders Show / Hide Delay section', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('Show / Hide Delay')).toBeInTheDocument();
  });

  it('renders delay variant buttons', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('Instant')).toBeInTheDocument();
    expect(screen.getByText('200ms')).toBeInTheDocument();
    expect(screen.getByText('Default (400ms)')).toBeInTheDocument();
    expect(screen.getByText('800ms')).toBeInTheDocument();
    expect(screen.getByText('1200ms')).toBeInTheDocument();
  });

  // ── Section 3: MaxWidth ───────────────────────────────────────

  it('renders Max Width section', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('Max Width')).toBeInTheDocument();
  });

  it('renders maxWidth variant buttons', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('160px')).toBeInTheDocument();
    expect(screen.getByText('Default (280px)')).toBeInTheDocument();
    expect(screen.getByText('400px')).toBeInTheDocument();
  });

  // ── Section 4: Multi-line Content ─────────────────────────────

  it('renders Multi-line Content section', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('Multi-line Content')).toBeInTheDocument();
  });

  it('renders content type buttons', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('Short')).toBeInTheDocument();
    expect(screen.getByText('Wrapping')).toBeInTheDocument();
    expect(screen.getByText('Structured')).toBeInTheDocument();
  });

  // ── Section 5: Content Types ──────────────────────────────────

  it('renders Content Types section', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('Content Types')).toBeInTheDocument();
  });

  it('renders content type trigger buttons', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('JSX')).toBeInTheDocument();
    expect(screen.getByText('Rich')).toBeInTheDocument();
  });

  // ── Section 6: Edge Cases ─────────────────────────────────────

  it('renders Edge Cases section', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('Edge Cases')).toBeInTheDocument();
  });

  it('renders edge case icon buttons with aria labels', () => {
    render(<TooltipPreview />);
    expect(screen.getByLabelText('Collapse sidebar')).toBeInTheDocument();
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
    expect(screen.getByLabelText('Settings')).toBeInTheDocument();
    // Badge trigger
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  // ── Section 7: Production Usage ───────────────────────────────

  it('renders Production Usage section', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('Production Usage')).toBeInTheDocument();
  });

  it('renders collapsed sidebar nav items', () => {
    render(<TooltipPreview />);
    expect(screen.getByLabelText('Dashboard')).toBeInTheDocument();
    expect(screen.getByLabelText('POS')).toBeInTheDocument();
    expect(screen.getByLabelText('Products')).toBeInTheDocument();
    expect(screen.getByLabelText('Shifts')).toBeInTheDocument();
  });

  it('renders expanded sidebar with text labels', () => {
    render(<TooltipPreview />);
    // Expanded sidebar shows visible text labels
    const dashboards = screen.getAllByText('Dashboard');
    expect(dashboards.length).toBeGreaterThanOrEqual(1);
  });

  it('renders status bar simulation', () => {
    render(<TooltipPreview />);
    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });

  // ── Code snippets ─────────────────────────────────────────────

  it('renders code snippets for documentation', () => {
    render(<TooltipPreview />);
    const codeElements = document.querySelectorAll('.tp-code');
    // At least 5 of the 7 sections include code blocks
    expect(codeElements.length).toBeGreaterThanOrEqual(5);
  });
});
