import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DesignSystem from '@/features/design/DesignSystem';

// ── Mocks ────────────────────────────────────────────────────────

vi.mock('@/components/Localized', () => ({
  Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/app/ThemeToggle', () => ({
  default: () => <div data-testid="theme-toggle">ThemeToggle</div>,
}));

vi.mock('@/components/Badge', () => ({
  Badge: ({ children, variant, size }: { children: React.ReactNode; variant?: string; size?: string }) => (
    <span className={`badge badge--${variant} badge--${size || 'md'}`}>{children}</span>
  ),
}));

vi.mock('@/components/Spinner', () => ({
  Spinner: ({ size, label }: { size?: string; label?: string }) => (
    <div data-testid="spinner" data-size={size}>{label}</div>
  ),
}));

vi.mock('@/components/Skeleton', () => ({
  Skeleton: ({ variant, width, height }: { variant?: string; width?: string; height?: string }) => (
    <div data-testid="skeleton" data-variant={variant} style={{ width, height }} />
  ),
}));

vi.mock('@/components/EmptyState', () => ({
  EmptyState: ({ title, description }: { title?: string; description?: string; action?: { label: string; onClick: () => void } }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
}));

vi.mock('@/components/ErrorState', () => ({
  ErrorState: ({ title, message }: { title?: string; message?: string; onRetry?: () => void; retryLabel?: string }) => (
    <div data-testid="error-state">
      <span>{title}</span>
      <span>{message}</span>
    </div>
  ),
}));

const mockAddToast = vi.fn();
const mockRemoveToast = vi.fn();
const mockClearToasts = vi.fn();

vi.mock('@/components/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: mockRemoveToast,
    clearToasts: mockClearToasts,
  }),
}));

vi.mock('@/components/Button', () => ({
  Button: ({
    children,
    onClick,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
  }) => (
    <button onClick={onClick} className={`btn btn--${variant || 'primary'}`}>
      {children}
    </button>
  ),
}));

// ── Tests ────────────────────────────────────────────────────────

describe('DesignSystem', () => {
  // ── Rendering ─────────────────────────────────────────────────

  it('renders without crashing', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Design System')).toBeInTheDocument();
  });

  it('renders ThemeToggle component', () => {
    render(<DesignSystem />);
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
  });

  // ── Colors section ────────────────────────────────────────────

  it('renders Colors section', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Colors')).toBeInTheDocument();
  });

  it('renders color swatch rows with Neutral label', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Neutral')).toBeInTheDocument();
    expect(screen.getByText('Primary (Emerald)')).toBeInTheDocument();
    expect(screen.getByText('Semantic')).toBeInTheDocument();
  });

  // ── Typography section ────────────────────────────────────────

  it('renders Typography section', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Typography')).toBeInTheDocument();
  });

  it('renders font weight samples', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Weight:')).toBeInTheDocument();
  });

  // ── Spacing section ───────────────────────────────────────────

  it('renders Spacing section', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Spacing')).toBeInTheDocument();
  });

  // ── Shadows section ───────────────────────────────────────────

  it('renders Shadows section with shadow tokens', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Shadows')).toBeInTheDocument();
    // Each shadow token shows its name
    expect(screen.getByText('--shadow-sm')).toBeInTheDocument();
    expect(screen.getByText('--shadow-md')).toBeInTheDocument();
  });

  // ── Border Radius section ─────────────────────────────────────

  it('renders Border Radius section', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Border Radius')).toBeInTheDocument();
    expect(screen.getByText('md')).toBeInTheDocument();
    expect(screen.getByText('full')).toBeInTheDocument();
  });

  // ── Buttons section ───────────────────────────────────────────

  it('renders Buttons section with all variants', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Buttons')).toBeInTheDocument();
    // Several button labels also appear as Swatch labels elsewhere —
    // use getAllByText for those, getByText for unique ones.
    expect(screen.getAllByText('Primary').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Secondary').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Danger').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Ghost')).toBeInTheDocument();
    expect(screen.getAllByText('Disabled').length).toBeGreaterThanOrEqual(2);
  });

  // ── Form Elements section ─────────────────────────────────────

  it('renders Form Elements section', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Form Elements')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Placeholder text')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Write something…')).toBeInTheDocument();
  });

  // ── Badges section ────────────────────────────────────────────

  it('renders Badges section with all variants', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Badges')).toBeInTheDocument();
    // 'Default', 'Success', 'Warning', 'Danger', 'Info' appear as both
    // Swatch labels and Badge text — use getAllByText for all.
    expect(screen.getAllByText('Default').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Success').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Warning').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Danger').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Info').length).toBeGreaterThanOrEqual(2);
  });

  // ── Spinners section ──────────────────────────────────────────

  it('renders Spinners section', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Spinners')).toBeInTheDocument();
    // Spinner mock renders data-testid
    const spinners = screen.getAllByTestId('spinner');
    expect(spinners.length).toBeGreaterThanOrEqual(3);
  });

  // ── Skeleton section ──────────────────────────────────────────

  it('renders Skeleton section', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Skeleton Loading')).toBeInTheDocument();
    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });

  // ── Toast section ─────────────────────────────────────────────

  it('renders Toast section with trigger buttons', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Toast Notifications')).toBeInTheDocument();
    expect(screen.getByText('Show Success')).toBeInTheDocument();
    expect(screen.getByText('Show Error')).toBeInTheDocument();
    expect(screen.getByText('Show Warning')).toBeInTheDocument();
    expect(screen.getByText('Show Info')).toBeInTheDocument();
  });

  it('calls addToast with success when Show Success is clicked', async () => {
    const user = userEvent.setup();
    render(<DesignSystem />);

    await user.click(screen.getByText('Show Success'));

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Operation completed successfully',
      }),
    );
  });

  it('calls addToast with error when Show Error is clicked', async () => {
    const user = userEvent.setup();
    render(<DesignSystem />);

    await user.click(screen.getByText('Show Error'));

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Something went wrong',
      }),
    );
  });

  it('calls addToast with warning when Show Warning is clicked', async () => {
    const user = userEvent.setup();
    render(<DesignSystem />);

    await user.click(screen.getByText('Show Warning'));

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        message: 'Please check your input',
      }),
    );
  });

  it('calls addToast with info when Show Info is clicked', async () => {
    const user = userEvent.setup();
    render(<DesignSystem />);

    await user.click(screen.getByText('Show Info'));

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'info',
        message: 'This is an informational message',
      }),
    );
  });

  // ── Empty State section ───────────────────────────────────────

  it('renders Empty State section', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Empty State')).toBeInTheDocument();
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  // ── Error State section ───────────────────────────────────────

  it('renders Error State section', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Error State')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
