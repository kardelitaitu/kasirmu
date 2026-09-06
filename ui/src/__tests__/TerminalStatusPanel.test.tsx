import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import TerminalStatusPanel from '@/features/locations/TerminalStatusPanel';
import type { TerminalDto } from '@/api/terminals';

const { mockListTerminals } = vi.hoisted(() => ({
  mockListTerminals: vi.fn(),
}));

// Stable l10n object — defined in hoisted scope so useLocalization mock
// returns the same reference on every render (avoids effect re-triggers).
const { stableL10n } = vi.hoisted(() => ({
  stableL10n: {
    bundles: [],
    getString: (key: string, args?: Record<string, unknown>) => {
      const lookup: Record<string, string> = {
        'terminal-status-never': 'Never',
        'terminal-status-just-now': 'Just now',
        'terminal-status-minutes-ago': `${args?.['n'] ?? '?'}m ago`,
        'terminal-status-hours-ago': `${args?.['n'] ?? '?'}h ago`,
        'terminal-status-error-load': 'Failed to load terminals',
        'terminal-status-list-aria': 'Terminal statuses',
        'terminal-status-online': 'Online',
        'terminal-status-offline': 'Offline',
        'terminal-status-online-count': `${args?.['online'] ?? '?'} / ${args?.['total'] ?? '?'} online`,
        'terminal-status-title': 'Terminal Status',
        'terminal-status-empty': 'No terminals registered.',
      };
      return lookup[key] ?? key;
    },
  },
}));

vi.mock('@/api/terminals', () => ({
  listTerminals: () => mockListTerminals(),
  listTerminalsScoped: () => mockListTerminals(),
}));

// Mock @fluent/react to bypass Fluent variable interpolation issues in JSDOM.
// Localized just renders children, useLocalization().l10n.getString() returns
// the fallback text or a simple lookup for terminal-specific keys.
vi.mock('@fluent/react', async () => {
  const actual = await vi.importActual('@fluent/react');
  return {
    ...actual,
    Localized: ({ children }: { children: React.ReactNode }) => children,
    useLocalization: () => ({ l10n: stableL10n }),
  };
});

// ── Helpers ─────────────────────────────────────────────────────────

function renderPanel(refreshTrigger: number = 0) {
  return render(<TerminalStatusPanel refreshTrigger={refreshTrigger} />);
}

function makeTerminal(overrides: Partial<TerminalDto> = {}): TerminalDto {
  return {
    id: 't-1',
    name: 'Register 1',
    deviceId: 'reg-001',
    isActive: true,
    lastSeenAt: new Date().toISOString(),
    metadata: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('TerminalStatusPanel', () => {
  beforeEach(() => {
    mockListTerminals.mockResolvedValue([]);
  });

  // ── States ─────────────────────────────────────────────────────

  it('shows loading skeleton initially', () => {
    mockListTerminals.mockReturnValue(new Promise(() => {}));
    const { container } = renderPanel();
    const skeleton = container.querySelector('.terminal-status-loading-skeleton');
    expect(skeleton).toBeTruthy();
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByText('Loading terminals…')).toBeNull();
  });

  it('shows error state on failure', async () => {
    mockListTerminals.mockRejectedValue(new Error('Network error'));
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Failed to load terminals')).toBeDefined();
    });
  });

  it('shows empty state when no terminals', async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('No terminals registered.')).toBeDefined();
    });
  });

  // ── Terminal list ──────────────────────────────────────────────

  it('renders terminal names and device IDs', async () => {
    mockListTerminals.mockResolvedValue([
      makeTerminal({ name: 'Front Desk', deviceId: 'dev-001' }),
      makeTerminal({ id: 't-2', name: 'Kitchen', deviceId: 'dev-002' }),
    ]);
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Front Desk')).toBeDefined();
      expect(screen.getByText('dev-001')).toBeDefined();
      expect(screen.getByText('Kitchen')).toBeDefined();
      expect(screen.getByText('dev-002')).toBeDefined();
    });
  });

  it('shows online/offline count in header', async () => {
    // Terminal seen just now → online
    const online = makeTerminal({ name: 'Online', lastSeenAt: new Date().toISOString() });
    // Terminal seen 10 minutes ago → offline (threshold is 5 min)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const offline = makeTerminal({
      id: 't-2',
      name: 'Offline',
      lastSeenAt: tenMinAgo,
    });

    mockListTerminals.mockResolvedValue([online, offline]);
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('1 / 2 online')).toBeDefined();
    });
  });

  // ── Online/offline dots ───────────────────────────────────────

  it('renders online dot for recently seen terminals', async () => {
    mockListTerminals.mockResolvedValue([makeTerminal()]);
    renderPanel();

    await waitFor(() => {
      const dot = document.querySelector('.terminal-status-dot--online');
      expect(dot).toBeTruthy();
    });
  });

  it('renders offline dot for stale terminals', async () => {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    mockListTerminals.mockResolvedValue([makeTerminal({ lastSeenAt: hourAgo })]);
    renderPanel();

    await waitFor(() => {
      const dot = document.querySelector('.terminal-status-dot--offline');
      expect(dot).toBeTruthy();
    });
  });

  it('renders offline dot for null lastSeenAt', async () => {
    mockListTerminals.mockResolvedValue([makeTerminal({ lastSeenAt: null })]);
    renderPanel();

    await waitFor(() => {
      const dot = document.querySelector('.terminal-status-dot--offline');
      expect(dot).toBeTruthy();
    });
  });

  it('online/offline dots have aria-labels', async () => {
    const online = makeTerminal();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const offline = makeTerminal({ id: 't-2', lastSeenAt: hourAgo });

    mockListTerminals.mockResolvedValue([online, offline]);
    renderPanel();

    await waitFor(() => {
      expect(screen.getByLabelText('Online')).toBeDefined();
      expect(screen.getByLabelText('Offline')).toBeDefined();
    });
  });

  // ── Last seen formatting ──────────────────────────────────────

  it('shows "Just now" for <1 minute ago', async () => {
    const thirtySecAgo = new Date(Date.now() - 30_000).toISOString();
    mockListTerminals.mockResolvedValue([makeTerminal({ lastSeenAt: thirtySecAgo })]);
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Just now')).toBeDefined();
    });
  });

  it('shows minutes ago for 1-60 minutes', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    mockListTerminals.mockResolvedValue([makeTerminal({ lastSeenAt: fiveMinAgo })]);
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('5m ago')).toBeDefined();
    });
  });

  it('shows hours ago for 1-24 hours', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    mockListTerminals.mockResolvedValue([makeTerminal({ lastSeenAt: threeHoursAgo })]);
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('3h ago')).toBeDefined();
    });
  });

  it('shows date for >24 hours ago', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    mockListTerminals.mockResolvedValue([makeTerminal({ lastSeenAt: twoDaysAgo })]);
    renderPanel();

    await waitFor(() => {
      const expectedDate = new Date(twoDaysAgo).toLocaleDateString();
      expect(screen.getByText(expectedDate)).toBeDefined();
    });
  });

  it('shows "Never" for null lastSeenAt', async () => {
    mockListTerminals.mockResolvedValue([makeTerminal({ lastSeenAt: null })]);
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Never')).toBeDefined();
    });
  });

  // ── ARIA ───────────────────────────────────────────────────────

  it('renders terminal list with role=list and listitems', async () => {
    mockListTerminals.mockResolvedValue([makeTerminal()]);
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Terminal statuses' })).toBeDefined();
      expect(screen.getByRole('listitem')).toBeDefined();
    });
  });

  // ── Refresh trigger ───────────────────────────────────────────

  it('re-fetches terminals when refreshTrigger changes', async () => {
    const { rerender } = renderPanel(1);

    await waitFor(() => {
      expect(mockListTerminals).toHaveBeenCalledTimes(1);
    });

    rerender(<TerminalStatusPanel refreshTrigger={2} />);

    await waitFor(() => {
      expect(mockListTerminals).toHaveBeenCalledTimes(2);
    });
  });
});
