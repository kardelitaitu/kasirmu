// ── Each shell registers ONE product-images door, and the screen must pick it ──
//
// Measured 2026-10-25: `open_product_images_scoped` has ZERO registrations under
// apps/mobile-tauri (lib.rs registers `open_product_images` at :1204), and
// `open_product_images` has ZERO under apps/desktop-tauri (lib.rs registers the
// scoped twin at :1632). Neither shell registers both.
//
// RetailPosScreen called the scoped twin unconditionally, so on the tablet every
// View-images tap threw and the catch degraded to a search on the raw SKU -- a
// worse query than the name+brand the backend builds, and silent.
//
// Two facts are pinned, and they are different:
//   1. each wrapper invokes ITS OWN command with the args that command takes;
//   2. the screen guards the site and routes each shell to its own wrapper.
// Fact 1 alone would pass while the screen called the wrong door; fact 2 alone
// would pass while a wrapper named the wrong command.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokes = vi.hoisted(() => ({ calls: [] as Array<{ cmd: string; args: unknown }> }));
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: async (cmd: string, args: unknown) => {
    invokes.calls.push({ cmd, args });
    return undefined;
  },
}));
vi.mock('@/api/tauri', () => ({ isTauriWebview: () => false }));

import { openProductImagesOnTablet, openProductImagesScoped } from '@/api/browser';

describe('product images: one door per shell', () => {
  beforeEach(() => {
    invokes.calls.length = 0;
  });

  it('the desktop door invokes the store-scoped command with the token', async () => {
    await openProductImagesScoped('tok', 'SKU-1');
    expect(invokes.calls.map((c) => c.cmd)).toEqual(['open_product_images_scoped']);
    expect(invokes.calls[0]?.args).toEqual({ sessionToken: 'tok', sku: 'SKU-1' });
  });

  it('the tablet door invokes the command the tablet actually registers', async () => {
    await openProductImagesOnTablet('SKU-1');
    expect(invokes.calls.map((c) => c.cmd)).toEqual(['open_product_images']);
    // No session token: the tablet command takes only the sku. Asserting its
    // ABSENCE is what stops a future "unify the signatures" edit re-breaking this.
    expect(invokes.calls[0]?.args).toEqual({ sku: 'SKU-1' });
  });

  it('the screen guards the site and routes each shell to its own door', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/retail/RetailPosScreen.tsx'),
      'utf8',
    );
    const at = src.indexOf('const handleViewProductImages');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('}, [sessionToken]);', at));
    expect(body).toMatch(/if \(isTabletShell\(\)\) \{\s*\n\s*openProductImagesOnTablet\(/);
    expect(body).toMatch(/\} else \{\s*\n\s*openProductImagesScoped\(/);
  });
});
