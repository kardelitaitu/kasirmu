/**
 * @file StatusBarDegraded.test.tsx
 * @description The auth/sync pills must render a degraded service as its own
 * state, not as offline (todo-global-saas-3.md, service health contracts).
 *
 * Covers:
 *   - a degraded auth server paints warn, not bad
 *   - the tooltip names the subsystem the server reported
 *   - a disconnected server still paints bad, so the two did not merge
 *   - the sync pill picks the tone up from the same shared mapping
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import StatusBar from '@/components/StatusBar';
import type { ConnectionHealth } from '@/hooks/connectionHealth';
import sharedFtl from '@/locales/shared.ftl?raw';
// The pill labels come from staff.ftl (staff-login-connection-auth/-sync),
// not shared.ftl — the component is shared with the staff login screen.
import staffFtl from '@/locales/staff.ftl?raw';

const { mockAuth, mockSync, mockVersion } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSync: vi.fn(),
  mockVersion: vi.fn(),
}));

vi.mock('@/hooks/useAuthConnection', () => ({ useAuthConnection: () => mockAuth() }));
vi.mock('@/hooks/useSyncConnection', () => ({ useSyncConnection: () => mockSync() }));
vi.mock('@/hooks/useVersionStatus', () => ({ useVersionStatus: () => mockVersion() }));
// Render the tooltip content alongside the trigger so the message is
// assertable; the real Tooltip only shows it on hover.
vi.mock('@/frontend/shell/Tooltip', () => ({
  default: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
    <>
      {children}
      {content}
    </>
  ),
}));
vi.mock('@/frontend/shared/Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

/** The shape both connection hooks return, and the component consumes. */
interface Conn {
  state: ConnectionHealth;
  latencyMs: number | null;
  cause: string | null;
}

const HEALTHY: Conn = { state: 'connected', latencyMs: 12, cause: null };
const IDLE_VERSION = { state: 'latest', label: 'Up to date' };

function renderBar(auth: Conn = HEALTHY, sync: Conn = HEALTHY) {
  mockAuth.mockReturnValue(auth);
  mockSync.mockReturnValue(sync);
  mockVersion.mockReturnValue(IDLE_VERSION);
  return renderWithFluentSync(<StatusBar />, sharedFtl, staffFtl);
}

beforeEach(() => {
  mockAuth.mockReset();
  mockSync.mockReset();
  mockVersion.mockReset();
});

describe('StatusBar degraded rendering', () => {
  it('paints a degraded auth server warn, not bad', () => {
    renderBar({ state: 'degraded', latencyMs: 12, cause: 'database' });
    const auth = screen.getByLabelText('Auth');
    expect(auth.className).toContain('statusbar-tone--warn');
    expect(auth.className).not.toContain('statusbar-tone--bad');
  });

  it('names the subsystem the server reported', () => {
    // The actionable half of the message. "Degraded" alone tells support
    // nothing; the server said which subsystem and that must survive.
    renderBar({ state: 'degraded', latencyMs: 12, cause: 'database' });
    expect(screen.getByText(/Degraded . database/)).toBeInTheDocument();
  });

  it('still paints a disconnected server bad, so the two states did not merge', () => {
    renderBar({ state: 'disconnected', latencyMs: null, cause: null });
    expect(screen.getByLabelText('Auth').className).toContain('statusbar-tone--bad');
  });

  it('paints a healthy server good', () => {
    renderBar();
    expect(screen.getByLabelText('Auth').className).toContain('statusbar-tone--good');
  });

  it('applies the same mapping to the sync pill', () => {
    // Both indicators read one tone function, so a state handled in one
    // cannot be missed in the other — the failure mode the three duplicated
    // state unions used to allow.
    renderBar(HEALTHY, { state: 'degraded', latencyMs: 30, cause: 'queue backlog' });
    expect(screen.getByLabelText('Sync').className).toContain('statusbar-tone--warn');
  });
});
