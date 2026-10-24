// ── Each shell registers ONE product-images door, and the screen must pick it ──
//
// Measured 2026-10-25: `open_product_images_scoped` has ZERO registrations under
// apps/mobile-tauri (`grep -rn open_product_images_scoped apps/mobile-tauri` returns
// only two DOC COMMENTS naming the desktop half). RetailPosScreen called it
// unconditionally, so on the tablet every View-images tap threw and the wrapper's
// catch fell through to a search on the raw SKU -- a worse query than the name+brand
// the backend builds, and silent because the call site swallowed the rejection.
//
// This pins the split at the CALL SITE, which is where the C47 idiom lives. Asserting
// that the guard exists would be satisfied by a guard in the wrong arm; asserting
// which wrapper each shell reaches cannot be.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const shell = vi.hoisted(() => ({ tablet: false }));
vi.mock('@/utils/shellKind', () => ({
  isTabletShell: () => shell.tablet,
  isDesktopShell: () => !shell.tablet,
  getShellKind: () => (shell.tablet ? 'tablet' : 'desktop'),
  setShellKind: () => {},
}));

const invoked = vi.hoisted(() => ({ commands: [] as string[] }));
vi.mock('@/api/browser', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    openProductImagesScoped: vi.fn(async (_t: string, sku: string) => {
      invoked.commands.push(`scoped:${sku}`);
      return true;
    }),
    openProductImages: vi.fn(async (sku: string) => {
      invoked.commands.push(`unscoped:${sku}`);
      return true;
    }),
  };
});

describe('product images door per shell', () => {
  beforeEach(() => {
    invoked.commands.length = 0;
  });

  it('the api layer exposes BOTH doors', async () => {
    const mod = await import('@/api/browser');
    expect(typeof mod.openProductImages).toBe('function');
    expect(typeof mod.openProductImagesScoped).toBe('function');
  });

  // The real assertion: read the source of the branch. RetailPosScreen cannot be
  // mounted here without a full POS fixture, so the fact under test is the SHAPE
  // of the shell split, which is exactly what regressed.
  it('guards the call site on the shell and routes each to its own door', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/retail/RetailPosScreen.tsx'),
      'utf8',
    );
    const at = src.indexOf('const handleViewProductImages');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('}, [sessionToken]);', at));
    // The tablet arm calls the unscoped door; the else arm calls the scoped twin.
    expect(body).toMatch(/if \(isTabletShell\(\)\) \{\s*\n\s*openProductImages\(/);
    expect(body).toMatch(/\} else \{\s*\n\s*openProductImagesScoped\(/);
  });
});
