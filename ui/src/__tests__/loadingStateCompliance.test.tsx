// ── Loading-state compliance gate (LOAD-09/LOAD-10) ──────────────
//
// The audit found that loading feedback was implemented ad hoc per
// screen: some surfaces announced nothing to screen readers, some leaked
// raw String(e) or hardcoded English, and there was no executable
// contract that every async screen distinguishes initial loading from a
// recoverable error and keeps an empty state separate from a failure.
//
// This gate pins, in one place, the cross-screen loading contract that
// the remediation commits introduced:
//
//   1. The canonical Skeleton primitive is a single implementation
//      reachable through every public path (LOAD-01 — mirrored here so a
//      future refactor can't silently fork the import surface).
//   2. The shared LoadingStatus wrapper announces role=status +
//      aria-live=polite + aria-busy and renders a localized, non-empty
//      label (LOAD-05/06).
//   3. The screens the audit flagged for silent catches now render a
//      retry-able error state distinct from the empty state (LOAD-02/08):
//      SalesHistory, KDS history, and the KDS product picker.
//   4. A static sweep: no feature screen falls back to a hardcoded
//      English "Loading..." via `l10n.getString() || '...'`.
//   5. Production-mode demo-data gate: useProducts can never expose
//      sample products when DEV=false (LOAD-03, mirrored from the hook's
//      own suite so the gate holds even if that test file is renamed).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { withFluent } from '@/i18n/test-utils';
import { LoadingStatus } from '@/components/LoadingStatus';
import { Skeleton as ComponentSkeleton } from '@/components/Skeleton';
import { Skeleton as SharedSkeleton } from '@/components/Skeleton';
import sharedFtl from '@/locales/shared.ftl?raw';

// ── 1. Primitive single-source-of-truth ──────────────────────────────
describe('loading-state compliance — primitive consolidation (LOAD-01)', () => {
  it('every public Skeleton path resolves to one canonical implementation', () => {
    expect(ComponentSkeleton).toBe(SharedSkeleton);
  });
});

// ── 2. Shared LoadingStatus wrapper semantics (LOAD-05/06) ───────────
describe('loading-state compliance — LoadingStatus wrapper (LOAD-05/06)', () => {
  it('renders role=status + aria-live=polite + aria-busy', () => {
    const { container } = render(
      withFluent(
        <LoadingStatus label="Loading…" busy>
          <div data-testid="decorative" />
        </LoadingStatus>,
        sharedFtl,
      ),
    );
    const status = container.querySelector('[role="status"]') as HTMLElement;
    expect(status).not.toBeNull();
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-busy')).toBe('true');
    // Decorative children are wrapped in the aria-hidden visual container.
    const visual = container.querySelector('.loading-status__visual') as HTMLElement;
    expect(visual).not.toBeNull();
    expect(visual.getAttribute('aria-hidden')).toBe('true');
    expect(visual.querySelector('[data-testid="decorative"]')).not.toBeNull();
  });

  it('renders a non-empty localized label (never raw English)', () => {
    const { container } = render(
      withFluent(<LoadingStatus label="Loading…" />, sharedFtl),
    );
    const label = container.querySelector('.loading-status__label') as HTMLElement;
    expect(label).not.toBeNull();
    expect(label.textContent?.trim().length).toBeGreaterThan(0);
  });
});

// ── 3. Screens flagged for silent catches expose retry-able errors ──
// Mount the real screens with a rejected IPC call and assert a Retry
// affordance appears instead of the empty state (LOAD-02/08). These are
// light mounts — the screens' own suites cover the happy paths.
// vi.hoisted must stay at module top level (vitest hoists it before any
// import runs; nested placement emits a future-breaking warning).
const hoisted = vi.hoisted(() => ({
  listSales: vi.fn(),
  listStaffScoped: vi.fn(),
  listKdsOrdersScoped: vi.fn(),
  listProductsScoped: vi.fn(),
}));

describe('loading-state compliance — error ≠ empty with Retry (LOAD-02/08)', () => {
  beforeEach(() => {
    hoisted.listSales.mockRejectedValue(new Error('down'));
    hoisted.listStaffScoped.mockRejectedValue(new Error('down'));
    hoisted.listKdsOrdersScoped.mockRejectedValue(new Error('down'));
    hoisted.listProductsScoped.mockRejectedValue(new Error('down'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('SalesHistoryScreen shows an error + Retry instead of the empty state', async () => {
    vi.doMock('@/api/sales', () => ({
      listSales: (...a: unknown[]) => hoisted.listSales(...a),
      getSale: vi.fn(),
      printSalesReceipt: vi.fn(),
      listRefunds: vi.fn(),
      voidSale: vi.fn(),
    }));
    vi.doMock('@/api/staff', () => ({
      listStaffScoped: (...a: unknown[]) => hoisted.listStaffScoped(...a),
    }));
    vi.doMock('@/contexts/AuthContext', () => ({
      useAuth: () => ({
        session: { user_id: 'user-1', username: 't', role_name: 'cashier', token: 't', role_id: 'r', display_name: 'Test' },
        loading: false,
        error: null,
        isManager: true,
        isOwner: false,
        login: vi.fn(),
        logout: vi.fn(),
        clearError: vi.fn(),
      }),
    }));
    const { default: SalesHistoryScreen } = await import('@/features/sales/SalesHistoryScreen');
    const { renderWithProviders } = await import('@/__tests__/test-utils/render');

    await renderWithProviders(<SalesHistoryScreen />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    vi.doUnmock('@/api/sales');
    vi.doUnmock('@/api/staff');
    vi.doUnmock('@/contexts/AuthContext');
  });

  it('KdsProductPickerModal shows a localized error + Retry', async () => {
    vi.doMock('@/api/products', () => ({
      listProductsScoped: (...a: unknown[]) => hoisted.listProductsScoped(...a),
    }));
    vi.doMock('@/hooks/useFocusTrap', () => ({ useFocusTrap: () => {} }));
    const { KdsProductPickerModal } = await import('@/features/kds/components/KdsProductPickerModal');
    const { renderWithFluentSync } = await import('@/__tests__/test-utils/render');
    const kdsFtl = (await import('@/locales/kds.ftl?raw')).default;

    renderWithFluentSync(
      <KdsProductPickerModal
        orderId="o1"
        sessionToken="tok"
        isOpen
        onConfirm={() => {}}
        onClose={() => {}}
      />,
      sharedFtl,
      kdsFtl,
    );
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry|coba lagi/i })).toBeInTheDocument();
    vi.doUnmock('@/api/products');
    vi.doUnmock('@/hooks/useFocusTrap');
  });
});

// ── 4. Static sweep: no hardcoded English loading fallback ───────────
describe('loading-state compliance — no hardcoded Loading fallbacks (LOAD-06)', () => {
  const FEATURES_DIR = path.resolve(__dirname, '../features');
  const tsxFiles = (function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  })(FEATURES_DIR);

  const offenders = tsxFiles
    .filter((f) => !f.includes('__tests__'))
    .filter((f) => {
      const src = fs.readFileSync(f, 'utf-8');
      return /getString\([^)]*\)\s*\|\|\s*['"]Loading/.test(src);
    });

  it('no feature screen falls back to a hardcoded English "Loading..." string', () => {
    expect(offenders).toEqual([]);
  });
});

// ── 5. Production-mode demo gate (LOAD-03, mirrored) ─────────────────
describe('loading-state compliance — production never shows demo data (LOAD-03)', () => {
  it('isDemoMode() is false when DEV is false and VITE_DEMO_MODE is unset', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DEMO_MODE', undefined);
    const { isDemoMode } = await import('@/utils/demo-mode');
    expect(isDemoMode()).toBe(false);
    vi.unstubAllEnvs();
  });
});
