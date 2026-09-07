import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/frontend/shell/ThemeProvider';
import { BrandProvider } from '@/contexts/BrandContext';
import { DevToolbar } from '@/features/design/DevToolbar';

// ── Module mocks for the spawn-memo flow ──────────────────────────

const { mockCreate, mockPublish, mockLocations } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockPublish: vi.fn(),
  mockLocations: vi.fn(),
}));

vi.mock('@/api/memos', () => ({
  createMemoScoped: (...args: unknown[]) => mockCreate(...args),
  publishMemoScoped: (...args: unknown[]) => mockPublish(...args),
}));

vi.mock('@/api/locations', () => ({
  listLocationsScoped: (...args: unknown[]) => mockLocations(...args),
}));

// The component reads the session from WorkspaceContext; the harness
// default (test-setup.ts) serves a non-null token. Tests that need the
// logged-out state override this with mockReturnValue.
const mockUseWorkspace = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: (...args: unknown[]) => mockUseWorkspace(...args),
}));

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: {
      getString: (id: string) => {
        const map: Record<string, string> = {
          'developer-tools-aria': 'Developer tools',
          'theme-selector-aria': 'Theme selector',
        };
        return map[id] || id;
      },
    },
  }),
  Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
  LocalizationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactLocalization: class {},
}));

// ── Wrapper with ThemeProvider ─────────────────────────────────────

function renderToolbar() {
  return render(
    <BrandProvider>
      <ThemeProvider>
        <DevToolbar />
      </ThemeProvider>
    </BrandProvider>,
  );
}

// If the test file's matchMedia mock hasn't been set up globally, provide one.
function mockMatchMedia() {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('DevToolbar', () => {
  beforeAll(() => {
    mockMatchMedia();
    // Suppress "Test <name> is not wrapped in act" warnings
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspace.mockReturnValue({ sessionToken: 'tok' });
    mockCreate.mockResolvedValue({ id: 'memo-1' });
    mockPublish.mockResolvedValue({ id: 'memo-1' });
    mockLocations.mockResolvedValue([{ id: 'loc-1', name: 'Main' }]);
  });

  it('renders without crashing', () => {
    const { container } = renderToolbar();
    expect(container.querySelector('.dev-toolbar')).not.toBeNull();
  });

  it('renders two theme buttons', () => {
    renderToolbar();
    expect(screen.getByLabelText('Light theme')).toBeInTheDocument();
    expect(screen.getByLabelText('Dark theme')).toBeInTheDocument();
  });

  it('renders the active theme badge', () => {
    renderToolbar();
    const badge = document.querySelector('.dev-toolbar-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toMatch(/light|dark/i);
  });

  it('switches theme when a theme button is clicked', () => {
    renderToolbar();
    const lightBtn = screen.getByLabelText('Light theme');
    fireEvent.click(lightBtn);
    expect(lightBtn).toHaveAttribute('aria-checked', 'true');
  });

  it('shows colour swatches matching the current theme', () => {
    renderToolbar();
    const swatches = document.querySelectorAll('.dev-toolbar-swatch');
    expect(swatches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders with correct ARIA role and label', () => {
    renderToolbar();
    expect(screen.getByRole('toolbar', { name: /developer tools/i })).toBeInTheDocument();
  });

  it('allows switching between themes and back', () => {
    renderToolbar();
    const lightBtn = screen.getByLabelText('Light theme');
    const darkBtn = screen.getByLabelText('Dark theme');

    fireEvent.click(lightBtn);
    expect(lightBtn).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(darkBtn);
    expect(darkBtn).toHaveAttribute('aria-checked', 'true');
    expect(lightBtn).not.toHaveAttribute('aria-checked', 'true');
  });

  // ── Spawn memo ─────────────────────────────────────────────────

  it('renders the spawn-memo buttons enabled with a session', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: /spawn an organization memo/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /spawn a location memo/i })).toBeEnabled();
  });

  it('spawn buttons are disabled without a session', () => {
    mockUseWorkspace.mockReturnValue({ sessionToken: null });
    renderToolbar();
    expect(screen.getByRole('button', { name: /spawn an organization memo/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /spawn a location memo/i })).toBeDisabled();
  });

  it('spawning an Organization memo drafts, publishes, and refreshes the banners', async () => {
    const refreshHandler = vi.fn();
    window.addEventListener('memos:refresh', refreshHandler);
    renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: /spawn an organization memo/i }));

    await waitFor(() => expect(mockPublish).toHaveBeenCalledWith('tok', 'memo-1'));
    expect(mockCreate).toHaveBeenCalledWith('tok', expect.objectContaining({
      locationIds: [],
      title: expect.stringContaining('Organization'),
      duration: '12h',
    }));
    await waitFor(() => expect(refreshHandler).toHaveBeenCalled());
    window.removeEventListener('memos:refresh', refreshHandler);
  });

  it('spawning a Location memo targets the first served location', async () => {
    renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: /spawn a location memo/i }));

    await waitFor(() => expect(mockPublish).toHaveBeenCalled());
    expect(mockLocations).toHaveBeenCalledWith('tok');
    expect(mockCreate).toHaveBeenCalledWith('tok', expect.objectContaining({
      locationIds: ['loc-1'],
      title: expect.stringContaining('Location'),
    }));
  });

  it('spawned durations cycle the display-duration ladder', async () => {
    renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: /spawn an organization memo/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /spawn an organization memo/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));

    // The index is module-level state, so the absolute values depend on how
    // many prior tests in this file spawned — assert the CONTRACT instead:
    // consecutive spawns advance one step through the ladder (wrapping).
    const ladder = ['12h', '24h', '3d', '7d', '30d'];
    const durations = mockCreate.mock.calls.map(
      (call) => (call[1] as { duration: string }).duration,
    );
    const firstIdx = ladder.indexOf(durations[0]!);
    expect(durations[1]).toBe(ladder[(firstIdx + 1) % ladder.length]);
  });

  it('a failed spawn is logged and never reaches publish', async () => {
    mockCreate.mockRejectedValue(new Error('backend down'));
    renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: /spawn an organization memo/i }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockPublish).not.toHaveBeenCalled();
    const { getDevLog } = await import('@/utils/devLog');
    await waitFor(() =>
      expect(getDevLog().some((entry) => entry.source === 'dev-toolbar' && entry.level === 'error')).toBe(true),
    );
  });
});
