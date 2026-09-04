import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';

// Mock useFeatures to always return enabled=true for any feature.
vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({
    isEnabled: vi.fn(() => true),
    enabled: new Set(['usb-scale']),
    loading: false,
    loaded: true,
    error: null,
    filterRoutes: (routes: string[]) => routes,
  }),
  FEATURES: {
    USB_SCALE: 'usb-scale',
  },
}));

// Mock the hardware API.
//
// readScaleWeightScoped was MISSING here. 403030ad ("migrate remaining frontend
// components to scoped APIs") added the branch at WeightScaleWidget.tsx:52
//   const readWeight = sessionToken ? () => readScaleWeightScoped(sessionToken) : readScaleWeight;
// and did not touch this file. So the mock kept only the unscoped half, which made the
// scoped branch not merely untested but unrenderable: passing sessionToken would call
// undefined and throw "readScaleWeightScoped is not a function". That is the ADR #7
// pattern again -- the migration moved call sites and left the mock surface behind -- and
// it is why every one of the ten render sites below passes no token.
vi.mock('@/api/hardware', () => ({
  readScaleWeight: vi.fn(),
  readScaleWeightScoped: vi.fn(),
}));

// Mock the toast hook.
vi.mock('@/frontend/shared/Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

import { WeightScaleWidget } from '@/features/sales/WeightScaleWidget';
import { readScaleWeight, readScaleWeightScoped } from '@/api/hardware';

const mockReadScaleWeight = readScaleWeight as ReturnType<typeof vi.fn>;
const mockReadScaleWeightScoped = readScaleWeightScoped as ReturnType<typeof vi.fn>;

const scaleFtl = `
weight-scale-aria = Weight Scale
weight-scale-weigh = Weigh
weight-scale-weighing = Weighing…
weight-scale-weigh-aria = Read weight from scale
weight-scale-stable = Stable reading
weight-scale-unstable = Unstable reading
weight-scale-idle = —
weight-scale-error = Scale error
`;



describe('WeightScaleWidget', () => {
  it('renders the weigh button and idle display when feature is enabled', () => {
    renderWithFluentSync(<WeightScaleWidget />, scaleFtl);
    expect(screen.getByRole('button', { name: /read weight/i })).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('does not crash and renders the region aria-label', () => {
    renderWithFluentSync(<WeightScaleWidget />, scaleFtl);
    expect(screen.getByRole('region', { name: 'Weight Scale' })).toBeInTheDocument();
  });

  it('calls readScaleWeight on weigh click', async () => {
    mockReadScaleWeight.mockResolvedValueOnce({ weightGrams: 500, stable: true });
    renderWithFluentSync(<WeightScaleWidget />, scaleFtl);

    await userEvent.click(screen.getByRole('button', { name: /read weight/i }));
    expect(mockReadScaleWeight).toHaveBeenCalledTimes(1);
  });

  // ── The scoped branch (WeightScaleWidget.tsx:52) ───────────────
  //
  // Added by the ADR #7 migration in 403030ad and covered by nothing until now, because
  // the mock did not export readScaleWeightScoped -- see the note at the vi.mock above.

  it('reads through the scoped API when given a session token', async () => {
    mockReadScaleWeightScoped.mockResolvedValueOnce({ weightGrams: 500, stable: true });
    renderWithFluentSync(<WeightScaleWidget sessionToken="tok-1" />, scaleFtl);

    await userEvent.click(screen.getByRole('button', { name: /read weight/i }));
    // The token has to reach the command, or the backend cannot resolve a store.
    expect(mockReadScaleWeightScoped).toHaveBeenCalledWith('tok-1');
    // And the unscoped path must NOT be taken: it reads the ambient store, which is the
    // exact thing the scoped migration exists to prevent.
    expect(mockReadScaleWeight).not.toHaveBeenCalled();
  });

  it('falls back to the unscoped read when no token is supplied', async () => {
    mockReadScaleWeight.mockResolvedValueOnce({ weightGrams: 250, stable: true });
    renderWithFluentSync(<WeightScaleWidget />, scaleFtl);

    await userEvent.click(screen.getByRole('button', { name: /read weight/i }));
    expect(mockReadScaleWeight).toHaveBeenCalledTimes(1);
    expect(mockReadScaleWeightScoped).not.toHaveBeenCalled();
  });

  it('displays weight after successful read', async () => {
    mockReadScaleWeight.mockResolvedValueOnce({ weightGrams: 500, stable: true });
    renderWithFluentSync(<WeightScaleWidget />, scaleFtl);

    await userEvent.click(screen.getByRole('button', { name: /read weight/i }));

    await vi.waitFor(() => {
      expect(screen.getByText('500.0 g')).toBeInTheDocument();
    });
  });

  it('displays kilograms for weights >= 1000g', async () => {
    mockReadScaleWeight.mockResolvedValueOnce({ weightGrams: 2500, stable: true });
    renderWithFluentSync(<WeightScaleWidget />, scaleFtl);

    await userEvent.click(screen.getByRole('button', { name: /read weight/i }));

    await vi.waitFor(() => {
      expect(screen.getByText('2.500 kg')).toBeInTheDocument();
    });
  });

  it('shows stable indicator when reading is stable', async () => {
    mockReadScaleWeight.mockResolvedValueOnce({ weightGrams: 100, stable: true });
    renderWithFluentSync(<WeightScaleWidget />, scaleFtl);

    await userEvent.click(screen.getByRole('button', { name: /read weight/i }));

    await vi.waitFor(() => {
      expect(screen.getByTitle('Stable reading')).toBeInTheDocument();
    });
  });

  it('shows unstable indicator when reading is not stable', async () => {
    mockReadScaleWeight.mockResolvedValueOnce({ weightGrams: 432, stable: false });
    renderWithFluentSync(<WeightScaleWidget />, scaleFtl);

    await userEvent.click(screen.getByRole('button', { name: /read weight/i }));

    await vi.waitFor(() => {
      expect(screen.getByTitle('Unstable reading')).toBeInTheDocument();
      expect(screen.getByText('432.0 g')).toBeInTheDocument();
    });
  });

  it('shows error when read fails', async () => {
    mockReadScaleWeight.mockRejectedValueOnce(new Error('Device not found'));
    renderWithFluentSync(<WeightScaleWidget />, scaleFtl);

    await userEvent.click(screen.getByRole('button', { name: /read weight/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/scale error/i)).toBeInTheDocument();
    });
  });

  it('calls onWeightObtained callback after successful read', async () => {
    const reading = { weightGrams: 750, stable: true };
    mockReadScaleWeight.mockResolvedValueOnce(reading);
    const onWeightObtained = vi.fn();

    renderWithFluentSync(<WeightScaleWidget onWeightObtained={onWeightObtained} />, scaleFtl);

    await userEvent.click(screen.getByRole('button', { name: /read weight/i }));

    await vi.waitFor(() => {
      expect(onWeightObtained).toHaveBeenCalledWith(reading);
    });
  });

  it('disables button while weighing', async () => {
    // Never resolve — keeps weighing=true
    mockReadScaleWeight.mockReturnValueOnce(new Promise(() => {}));
    renderWithFluentSync(<WeightScaleWidget />, scaleFtl);

    await userEvent.click(screen.getByRole('button', { name: /read weight/i }));

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /read weight/i })).toBeDisabled();
      expect(screen.getByText('Weighing…')).toBeInTheDocument();
    });
  });
});
