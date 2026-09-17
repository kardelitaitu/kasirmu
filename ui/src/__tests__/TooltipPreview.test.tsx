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
