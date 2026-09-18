import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render } from '@testing-library/react';
import FastPINOverlay from '@/components/FastPINOverlay';

// ── Mock helpers (extracted outside vi.mock for esbuild compat) ────

function MockAuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function MockWorkspaceProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('@/api/staff', () => ({
  staffLogin: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', display_name: 'Test', role_name: 'cashier', role_id: 'r' },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    swapSession: vi.fn(),
    isManager: false,
    isOwner: false,
  }),
  AuthProvider: MockAuthProvider,
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    swapSessionToken: vi.fn(),
    activeWorkspace: 'store-pos',
    activeInstance: null,
    sessionToken: 'token-abc',
    setActiveWorkspace: vi.fn(),
    setActiveInstance: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    error: null,
    retry: vi.fn(),
    lastWorkspace: null,
    switchStore: vi.fn(),
    resolvedStoreId: 'default',
  }),
  useWorkspaceScope: () => ({
    storeId: 'default',
    instanceId: 'default-store-pos',
    typeKey: 'store-pos',
  }),
  WorkspaceProvider: MockWorkspaceProvider,
}));

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: {
      getString: (id: string) => (id === 'staff-login-pin-aria' ? 'PIN: {length}/{max}' : id),
    },
  }),
  Localized: ({ children }: { id: string; children: ReactNode }) => <>{children}</>,
}));

describe('prefers-reduced-motion compliance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('FastPINOverlay animation structure', () => {
    it('renders overlay with animation class when open', () => {
      render(<FastPINOverlay open={true} onClose={vi.fn()} />);

      const overlay = document.querySelector('.fastpin-overlay');
      expect(overlay).not.toBeNull();

      // Verify the overlay has the CSS class that gates the animation
      // via @media (prefers-reduced-motion: no-preference)
      expect(overlay!.classList.contains('fastpin-overlay--exiting')).toBe(false);
    });

    it('renders card with animation class when open', () => {
      render(<FastPINOverlay open={true} onClose={vi.fn()} />);

      const card = document.querySelector('.fastpin-card');
      expect(card).not.toBeNull();
    });

    it('applies --exiting class on backdrop click before unmount', () => {
      render(<FastPINOverlay open={true} onClose={vi.fn()} />);

      const overlay = document.querySelector('.fastpin-overlay') as HTMLElement;
      expect(overlay).not.toBeNull();

      // Click backdrop — wrap in act to flush React state update (setExiting(true))
      act(() => {
        overlay.click();
      });

      // After click, the --exiting class should be applied
      expect(overlay!.classList.contains('fastpin-overlay--exiting')).toBe(true);
    });

    it('calls onClose after exit animation timeout', () => {
      const onClose = vi.fn();
      render(<FastPINOverlay open={true} onClose={onClose} />);

      const overlay = document.querySelector('.fastpin-overlay') as HTMLElement;
      act(() => {
        overlay.click();
      });

      // Component uses animDuration(300) for the exit delay, matching
      // fastpin-fade-out's var(--duration-300) (FastPINOverlay.css:58).
      // 200 was the pre-"smooth 300ms backdrop blur" duration; the timer and the
      // keyframe moved together in that commit, so this advance has to move too.
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose after exit animation completes', () => {
      const onClose = vi.fn();
      render(<FastPINOverlay open={true} onClose={onClose} />);

      const overlay = document.querySelector('.fastpin-overlay') as HTMLElement;
      act(() => {
        overlay.click();
      });

      expect(overlay.classList.contains('fastpin-overlay--exiting')).toBe(true);

      act(() => {
        vi.advanceTimersByTime(300);
      });

      // After close callback, the parent sets open=false, unmounting the component
      expect(onClose).toHaveBeenCalled();
    });

    it('does not render when open=false', () => {
      const { container } = render(<FastPINOverlay open={false} onClose={vi.fn()} />);
      expect(container.querySelector('.fastpin-overlay')).toBeNull();
    });

    it('renders dialog with aria-modal when open', () => {
      render(<FastPINOverlay open={true} onClose={vi.fn()} />);

      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
    });

    it('renders close button with correct aria-label', () => {
      render(<FastPINOverlay open={true} onClose={vi.fn()} />);

      const closeBtn = document.querySelector('.fastpin-close-btn');
      expect(closeBtn).not.toBeNull();
      expect(closeBtn?.getAttribute('aria-label')).toBeTruthy();
    });
  });
});
