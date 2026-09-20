// ProductThumb — the content-addressed image tile.
//
// This file exists because the component had NO tests, and two defects survived
// in it that both present as "the image never updates":
//
//  1. `mountedRef` is initialised `true` and only ever set `false`, by an
//     effect cleanup that never restores it. React StrictMode — which
//     `ui/src/main.tsx` enables — runs every mount effect's cleanup once
//     immediately, so `mountedRef.current` is permanently `false` in dev and
//     the `.then()` that assigns `imgSrc` always early-returns. The tile then
//     renders the initials fallback for the whole life of the component.
//  2. `loadError` is reset only on the `!hash` branch. One failed load pins the
//     fallback tile forever: with `loadError` true no `<img>` is mounted, so no
//     later hash can ever attempt a load.
//
// Case /1 pins (1) — it renders under StrictMode, as the real app does.
// Case /2 pins (2) — a hash change after a failed load must retry.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react';
import { ProductThumb } from '@/components/ProductThumb';

const { mockGetAppCacheDir, mockConvertFileSrc } = vi.hoisted(() => ({
  mockGetAppCacheDir: vi.fn(),
  mockConvertFileSrc: vi.fn(),
}));

vi.mock('@/api/cache', () => ({
  getAppCacheDir: () => mockGetAppCacheDir(),
}));

vi.mock('@/api/tauri', () => ({
  convertFileSrc: (path: string) => mockConvertFileSrc(path),
}));

const HASH = 'ee8365d192209899';

beforeEach(() => {
  mockGetAppCacheDir.mockReset().mockResolvedValue('C:/cache');
  mockConvertFileSrc
    .mockReset()
    .mockImplementation((path: string) => `asset://localhost/${path}`);
});

describe('ProductThumb', () => {
  it('renders the photo — not the fallback tile — under StrictMode', async () => {
    const { container } = render(
      <StrictMode>
        <ProductThumb hash={HASH} name="owner" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(container.querySelector('img')).not.toBeNull();
    });

    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      `asset://localhost/C:/cache/images/${HASH}.webp`,
    );
  });

  it('retries the load when the hash changes after a failed load', async () => {
    const { container, rerender } = render(
      <ProductThumb hash="aaaaaaaaaaaaaaaa" name="owner" />,
    );

    // First hash resolves, then the image fails to decode.
    await waitFor(() => {
      expect(container.querySelector('img')).not.toBeNull();
    });
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    await waitFor(() => {
      expect(container.querySelector('img')).toBeNull();
    });

    // A NEW hash arrives — it must be attempted, not masked by the stale error.
    rerender(<ProductThumb hash="bbbbbbbbbbbbbbbb" name="owner" />);

    await waitFor(() => {
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        'asset://localhost/C:/cache/images/bbbbbbbbbbbbbbbb.webp',
      );
    });
  });
});
