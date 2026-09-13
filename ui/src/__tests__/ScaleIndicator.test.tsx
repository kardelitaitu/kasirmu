// ── ScaleIndicator tests ───────────────────────────────────────────
//
// Covers: idle state (no scale), error state, stable/unstable
// readings, weigh-target add/clear buttons, and weight formatting.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Sku } from '@/types/domain';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScaleIndicator from '@/features/retail/ScaleIndicator';
import type { WeightReading } from '@/api/hardware';
// ── Mocks ──────────────────────────────────────────────────────────

const mockReadScaleWeight = vi.fn();
const mockReadScaleWeightScoped = vi.fn();

// readScaleWeightScoped was missing here. ScaleIndicator.tsx:30 picks its API by token
//   const readWeight = sessionToken ? () => readScaleWeightScoped(sessionToken) : readScaleWeight;
// added by 403030ad ("migrate remaining frontend components to scoped APIs"), which did not
// touch this file. With the mock exporting only the unscoped half, any test that passed a
// sessionToken called undefined and threw -- so the scoped branch was unrenderable rather
// than merely uncovered, and all ten render sites below pass no token. Third instance of
// this after WeightScaleWidget (65971d0f) and useBarcodeScanner (0b7f9e18).
vi.mock('@/api/hardware', () => ({
  readScaleWeight: () => mockReadScaleWeight(),
  readScaleWeightScoped: (token: string) => mockReadScaleWeightScoped(token),
}));

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: {
      getString: (id: string, vars?: Record<string, string>) => {
        if (vars?.['name']) return `Weigh & add ${vars['name']}`;
        return id;
      },
    },
  }),
  Localized: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Test data ──────────────────────────────────────────────────────

const testSku = 'TEST-001' as Sku;

const stableReading: WeightReading = { weightGrams: 500, stable: true };
const unstableReading: WeightReading = { weightGrams: 320, stable: false };

// ── Tests ──────────────────────────────────────────────────────────

describe('ScaleIndicator', () => {
  beforeEach(() => {
    mockReadScaleWeight.mockResolvedValue(null);
  });

  // ── Idle state ─────────────────────────────────────────────────

  it('shows idle state when no scale is connected', async () => {
    mockReadScaleWeight.mockResolvedValue(null);

    render(
      <ScaleIndicator
        weighTarget={null}
        onWeighAdd={vi.fn()}
        onClearWeighTarget={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('scale-idle')).toBeInTheDocument();
    });

    const container = document.querySelector('.scale-indicator--idle');
    expect(container).toBeInTheDocument();
  });

  // ── Error state ────────────────────────────────────────────────

  it('shows error state when scale read fails', async () => {
    mockReadScaleWeight.mockRejectedValue(new Error('Hardware error'));

    render(
      <ScaleIndicator
        weighTarget={null}
        onWeighAdd={vi.fn()}
        onClearWeighTarget={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('scale-read-error')).toBeInTheDocument();
    });

    const container = document.querySelector('.scale-indicator--error');
    expect(container).toBeInTheDocument();
  });

  // ── Stable reading ─────────────────────────────────────────────

  it('shows stable weight and "Stable" label', async () => {
    mockReadScaleWeight.mockResolvedValue(stableReading);

    render(
      <ScaleIndicator
        weighTarget={null}
        onWeighAdd={vi.fn()}
        onClearWeighTarget={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('500 g')).toBeInTheDocument();
    });

    expect(screen.getByText('scale-stable')).toBeInTheDocument();
    expect(
      document.querySelector('.scale-indicator--stable'),
    ).toBeInTheDocument();
  });

  // ── Unstable reading ───────────────────────────────────────────

  it('shows unstable weight and "…" label', async () => {
    mockReadScaleWeight.mockResolvedValue(unstableReading);

    render(
      <ScaleIndicator
        weighTarget={null}
        onWeighAdd={vi.fn()}
        onClearWeighTarget={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('320 g')).toBeInTheDocument();
    });

    expect(screen.getByText('scale-unstable')).toBeInTheDocument();
    expect(
      document.querySelector('.scale-indicator--unstable'),
    ).toBeInTheDocument();
  });

  // ── Weight formatting ──────────────────────────────────────────

  it('formats weights >= 1000g as kg', async () => {
    mockReadScaleWeight.mockResolvedValue({
      weightGrams: 1500,
      stable: true,
    });

    render(
      <ScaleIndicator
        weighTarget={null}
        onWeighAdd={vi.fn()}
        onClearWeighTarget={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('1.50 kg')).toBeInTheDocument();
    });
  });

  // ── Weigh target actions ───────────────────────────────────────

  it('shows weigh-target actions when reading is stable and positive', async () => {
    mockReadScaleWeight.mockResolvedValue(stableReading);
    const onWeighAdd = vi.fn();
    const onClearWeighTarget = vi.fn();

    render(
      <ScaleIndicator
        weighTarget={{ sku: testSku, name: 'Test Product' }}
        onWeighAdd={onWeighAdd}
        onClearWeighTarget={onClearWeighTarget}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('scale-weigh-add')).toBeInTheDocument();
    });

    expect(screen.getByText('Test Product')).toBeInTheDocument();
  });

  it('calls onWeighAdd when weigh button is clicked', async () => {
    mockReadScaleWeight.mockResolvedValue(stableReading);
    const onWeighAdd = vi.fn();

    render(
      <ScaleIndicator
        weighTarget={{ sku: testSku, name: 'Test Product' }}
        onWeighAdd={onWeighAdd}
        onClearWeighTarget={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('scale-weigh-add')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('scale-weigh-add'));

    expect(onWeighAdd).toHaveBeenCalledWith(testSku, stableReading.weightGrams);
  });

  it('does not show weigh-target actions when reading is unstable', async () => {
    mockReadScaleWeight.mockResolvedValue(unstableReading);

    render(
      <ScaleIndicator
        weighTarget={{ sku: testSku, name: 'Test Product' }}
        onWeighAdd={vi.fn()}
        onClearWeighTarget={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('320 g')).toBeInTheDocument();
    });

    // Actions should NOT appear for unstable readings.
    expect(screen.queryByText('scale-weigh-add')).not.toBeInTheDocument();
  });

  it('calls onClearWeighTarget when clear button is clicked', async () => {
    mockReadScaleWeight.mockResolvedValue(stableReading);
    const onClearWeighTarget = vi.fn();

    render(
      <ScaleIndicator
        weighTarget={{ sku: testSku, name: 'Test Product' }}
        onWeighAdd={vi.fn()}
        onClearWeighTarget={onClearWeighTarget}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('scale-weigh-add')).toBeInTheDocument();
    });

    const clearBtn = document.querySelector('.scale-indicator-clear-btn');
    expect(clearBtn).toBeInTheDocument();
    await userEvent.click(clearBtn!);

    expect(onClearWeighTarget).toHaveBeenCalledTimes(1);
  });

  // ── ARIA ───────────────────────────────────────────────────────

  it('has status role and ARIA label', async () => {
    mockReadScaleWeight.mockResolvedValue(null);

    render(
      <ScaleIndicator
        weighTarget={null}
        onWeighAdd={vi.fn()}
        onClearWeighTarget={vi.fn()}
      />,
    );

    await waitFor(() => {
      const el = document.querySelector('[role="status"]');
      expect(el).toBeInTheDocument();
      expect(el?.getAttribute('aria-label')).toBe('scale-indicator-aria');
    });
  });

  // ── Scoped vs unscoped read (ScaleIndicator.tsx:30) ────────────
  //
  // The component polls every 2s, so both branches need the token to reach the command or
  // the backend cannot resolve which store's scale it is reading.

  it('polls through the scoped API when given a session token', async () => {
    mockReadScaleWeightScoped.mockResolvedValue(stableReading);

    render(
      <ScaleIndicator
        sessionToken="tok-1"
        weighTarget={null}
        onWeighAdd={vi.fn()}
        onClearWeighTarget={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mockReadScaleWeightScoped).toHaveBeenCalledWith('tok-1');
    });
    // The unscoped read uses the ambient store -- exactly what the scoped migration exists
    // to prevent -- so "not called" is the security assertion, not tidiness.
    expect(mockReadScaleWeight).not.toHaveBeenCalled();
  });

  it('falls back to the unscoped read when no token is given', async () => {
    mockReadScaleWeight.mockResolvedValue(stableReading);

    render(
      <ScaleIndicator
        weighTarget={null}
        onWeighAdd={vi.fn()}
        onClearWeighTarget={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mockReadScaleWeight).toHaveBeenCalled();
    });
    expect(mockReadScaleWeightScoped).not.toHaveBeenCalled();
  });
});
