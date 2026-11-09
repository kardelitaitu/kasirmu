// ── The warehouse console must not invoke a command its shell lacks ────────
//
// Measured 2026-10-25: `list_warehouse_products_at_location` is registered by
// apps/desktop-tauri alone (lib.rs:1613). apps/mobile-tauri registers only
// `list_warehouse_products_scoped` (lib.rs:1381), which takes NO location id -- so it is
// not a twin: the console shows stock AT the bound warehouse, and the tablet command
// cannot answer that. Substituting it would put wrong numbers on a counting screen.
//
// The route IS live on the tablet (warehouse/register.tsx:7 runs from features/index.ts:102
// on both entries, and TabletAppShell renders any registered page), so before this fix
// every tablet visit to Warehouse invoked the missing command on mount, landed in the
// catch, and rendered 'failed to load' over an empty grid -- a failure state for a shell
// that simply has no answer.
//
// Two facts are pinned: the tab list withholds Count, and the module names the shell.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const shell = vi.hoisted(() => ({ tablet: false }));
vi.mock('@/utils/shellKind', () => ({
  isTabletShell: () => shell.tablet,
  isDesktopShell: () => !shell.tablet,
  getShellKind: () => (shell.tablet ? 'tablet' : 'desktop'),
  setShellKind: () => {},
}));

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('warehouse console shell split', () => {
  it('withholds the Count mode on the tablet', () => {
    const src = read('features/warehouse/WarehouseConsole.tsx');
    expect(src).toMatch(/function warehouseModeAvailable/);
    expect(src).toMatch(/mode === 'count' && isTabletShell\(\)/);
    // The tab list must go through the predicate, not a bare array literal, or the
    // function above would be dead code that reads as a guard.
    expect(src).toMatch(/items=\{WAREHOUSE_MODES\.filter\(warehouseModeAvailable\)/);
  });

  it('guards the product load with the positive/else shape the gate reads', () => {
    const src = read('features/warehouse/WarehouseConsole.tsx');
    const at = src.indexOf('const loadProducts');
    const body = src.slice(at, src.indexOf('}, [sessionToken, locationId, l10n]);', at));
    expect(body).toMatch(/if \(isTabletShell\(\)\) \{/);
    expect(body).toMatch(/setLoadUnavailable\(true\)/);
    expect(body).toMatch(/\} else \{/);
  });

  it('guards the counting flow so the invoke cannot fire from a shell without it', () => {
    const src = read('features/warehouse/WarehouseCountFlow.tsx');
    const at = src.indexOf('listWarehouseProductsAtLocation(sessionToken');
    expect(at).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, at - 900), at);
    expect(before).toMatch(/if \(isTabletShell\(\)\) \{/);
  });
});
