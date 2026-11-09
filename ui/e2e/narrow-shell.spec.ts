import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loginAs, selectWorkspace, navigateTo, WORKSPACES } from './helpers';

/**
 * E2E: the NARROW SHELL — the <=640px content slot ADR-0001's T1/T2 mechanism
 * was built for, proven in a real browser.
 *
 * The two existing projects are desktop 1366x768 and tablet 1024x1366, so
 * neither ever exercised the case the orientation work targets. Every test
 * below sets its OWN viewport with `page.setViewportSize` (the pattern already
 * used by segmented-tabs-geometry.spec.ts) and asserts the RENDERED box /
 * computed style — never CSS text — so both projects run the same geometry.
 *
 * What is asserted, and why each assertion can fail:
 *
 *   1. NO HORIZONTAL OVERFLOW at 480x800 and 360x640 (both below every tier)
 *      on the retail POS screen and on Sales History, whose sheet carries a
 *      `@container (max-width: 640px)` tier. Measured on the documentElement
 *      AND on the screen's own root box, because the workspace shells clip at
 *      the root (`.workspace-fullscreen` and `.app-content` both hide
 *      overflow-x) — a document-only check can stay at 0 while the page paints
 *      past its own box.
 *
 *   2. THE NARROW TIERS ACTUALLY ENGAGE. Each property is asserted at 1366
 *      (every tier inert) and at 1024x1366 (the 880px tiers fire, the 640px
 *      ones must NOT), then at 480/360 (the 640px tiers fire). The wide/1024
 *      half of each pair is what makes these proofs of the TIER rather than
 *      assertions on a constant:
 *        - retail  @container (max-width: 640px)  (RetailPosScreen.css:3042)
 *            .retail-col-stock      display: table-cell -> none
 *            .retail-product-table  table-layout: auto  -> fixed
 *            .retail-fn-bar         flex-wrap: nowrap   -> wrap
 *        - history @container (max-width: 640px)  (SalesHistoryScreen.css:783)
 *            .sales-history-cell-receipt  display: table-cell -> none
 *            .sales-history-filter-input  min-width: 175px -> 0px, and the
 *              input then takes the whole row it wraps onto.
 *
 *   3. THE PORTRAIT SIDEBAR OVERLAY (AppLayout.css:679, T1). At 480x800 the
 *      expanded sidebar is `position: absolute` over the content and the scrim
 *      paints viewport-wide; clicking it collapses the rail while the page stays
 *      mounted, and so does Escape. At 1366x768 (landscape) the same node is
 *      mounted but `display: none` and the sidebar is an in-flow 220px lane —
 *      the base state, not a fallback.
 *
 *   4. ESCAPE OWNS THE OVERLAY, NOT THE WORKSPACE. AppLayout binds its
 *      overlay-Escape listener on `document` in the CAPTURE phase
 *      (AppLayout.tsx) so it runs before AppShell's workspace-Escape bubble
 *      handler; AppShell's handler additionally yields while
 *      `isSidebarOverlayPresented()`. The Escape test pins the two facts that
 *      distinguish this from the pre-6102537b7 behaviour (where AppShell's
 *      consumeShortcut() stopPropagation() swallowed the key and Escape exited
 *      the workspace instead):
 *        - localStorage['app-sidebar-collapsed'] becomes "true" (the rail
 *          actually collapsed; the broken branch left it "false");
 *        - the workspace did NOT exit — the shell page stays mounted and the
 *          workspace picker stays hidden (the broken branch unmounted the
 *          page and showed the picker).
 *      The wider invariant (the overlay stops covering the page) is still
 *      asserted too, so a regression that left the scrim painted fails there.
 *
 * MEASURED DEFECT this spec found but does NOT assert (the spec must be green;
 * reported in FINDINGS):
 *   - At 360x640 the history table is 416px inside a 332px wrap, i.e. it still
 *     needs a horizontal scroll at the narrowest width. The page root does not
 *     overflow (asserted below); the scroller is the designed escape.
 */

interface NarrowViewport {
  width: number;
  height: number;
  label: string;
}

/** Genuinely narrow: below every tier in the migrated sheets (720/480, 880/640). */
const NARROW_VIEWPORTS: readonly NarrowViewport[] = [
  { width: 480, height: 800, label: '480x800' },
  { width: 360, height: 640, label: '360x640' },
];

/** The widest existing project viewport — every tier is inert here. */
const WIDE: NarrowViewport = { width: 1366, height: 768, label: '1366x768' };

/** Tablet project viewport: the 880px tiers fire, the 640px ones must not. */
const TABLET: NarrowViewport = { width: 1024, height: 1366, label: '1024x1366' };

/** The narrow portrait case itself. */
const NARROW_PORTRAIT: NarrowViewport = { width: 480, height: 800, label: '480x800' };

/**
 * Set the viewport and wait for layout without a magic sleep: two rAF ticks
 * flush the style/layout pass the resize triggers (container queries
 * re-evaluate synchronously on layout, so no timer is needed).
 */
async function resizeTo(page: Page, vp: NarrowViewport): Promise<void> {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

interface OverflowMetrics {
  innerWidth: number;
  docScrollWidth: number;
  rootClientWidth: number;
  rootScrollWidth: number;
  rootRight: number;
}

/** Overflow of the document AND of the given root box. */
async function measureOverflow(page: Page, rootSelector: string): Promise<OverflowMetrics> {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector) as HTMLElement | null;
    if (!root) throw new Error(`missing ${selector}`);
    return {
      innerWidth: window.innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      rootRight: root.getBoundingClientRect().right,
    };
  }, rootSelector);
}

interface RetailTierMetrics {
  stockDisplay: string;
  tableLayout: string;
  fnBarWrap: string;
}

/** The three properties the retail 640px tier changes. */
async function measureRetailTier(page: Page): Promise<RetailTierMetrics> {
  return page.evaluate(() => {
    const q = (s: string) => document.querySelector(s) as HTMLElement | null;
    const stock = q('.retail-col-stock');
    const table = q('.retail-product-table');
    const fnBar = q('.retail-fn-bar');
    if (!stock || !table || !fnBar) throw new Error('retail tier surfaces missing');
    return {
      stockDisplay: getComputedStyle(stock).display,
      tableLayout: getComputedStyle(table).tableLayout,
      fnBarWrap: getComputedStyle(fnBar).flexWrap,
    };
  });
}

interface HistoryTierMetrics {
  /** The receipt lane - deliberately KEPT at every tier (see the 640px rule comment). */
  receiptDisplay: string;
  /** One of the two lanes the 640px tier folds: ITEMS (nth-child 4). */
  itemsDisplay: string;
  /** The other folded lane: PAYMENT (nth-child 6). */
  paymentDisplay: string;
  /** A lane the 640px tier must NOT fold, as a control against over-folding. */
  statusDisplay: string;
  inputMinWidth: string;
  inputWidth: number;
  /** The input wrapper - the successor to the deleted .sales-history-filter-group. */
  searchGroupWidth: number;
  /** The compact bar: nowrap + overflow-x auto is what the 640px tier is for. */
  barFlexWrap: string;
  barOverflowX: string;
  barClientWidth: number;
  barScrollWidth: number;
}

/**
 * The properties the Sales History 640px container tier changes.
 *
 * RETARGETED 2026-10-18. This helper used to query `.sales-history-filter-group` and assert the
 * search input took the whole filter row. BOTH premises were removed by f5772454c ("compact
 * 1-row sales history filter bar with right-aligned search", Oct 11): the class no longer exists
 * anywhere in ui/src (its successor is .sales-history-search-group), min-width: 0 was replaced
 * by a 9rem floor, and the bar now scrolls internally instead of wrapping. The case therefore
 * could not pass against ANY rendering of the shipped screen - it was chasing a deleted
 * selector, not reporting a regression.
 *
 * The assertions below are the MEASURED shipped behaviour at 360/480/1024/1366. The lane checks
 * use the real column order (receipt 1, date 2, total 3, ITEMS 4, status 5, PAYMENT 6,
 * cashier 7) and the 640px rule comment - receipt, date, total, status and the actions stay -
 * so the kept lanes are asserted as kept rather than assumed.
 */
async function measureHistoryTier(page: Page): Promise<HistoryTierMetrics> {
  return page.evaluate(() => {
    const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
    const receipt = q('.sales-history-cell-receipt');
    const input = q('.sales-history-filter-input');
    const group = q('.sales-history-search-group');
    const bar = q('.sales-history-filters');
    if (!receipt || !input || !group || !bar) throw new Error('sales-history tier surfaces missing');
    const cellAt = (n: number) => {
      const cell = document.querySelector(`.sales-history-table tbody td:nth-child(${n})`) as HTMLElement | null;
      return cell ? getComputedStyle(cell).display : 'ABSENT';
    };
    const barStyle = getComputedStyle(bar);
    return {
      receiptDisplay: getComputedStyle(receipt).display,
      itemsDisplay: cellAt(4),
      paymentDisplay: cellAt(6),
      statusDisplay: cellAt(5),
      inputMinWidth: getComputedStyle(input).minWidth,
      inputWidth: Math.round(input.getBoundingClientRect().width),
      searchGroupWidth: Math.round(group.getBoundingClientRect().width),
      barFlexWrap: barStyle.flexWrap,
      barOverflowX: barStyle.overflowX,
      barClientWidth: bar.clientWidth,
      barScrollWidth: bar.scrollWidth,
    };
  });
}

interface ScrimMetrics {
  scrimMounted: boolean;
  scrimDisplay: string;
  scrimWidth: number;
  scrimHeight: number;
  sidebarPosition: string;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  contentMounted: boolean;
}

async function measureScrim(page: Page): Promise<ScrimMetrics> {
  return page.evaluate(() => {
    const scrim = document.querySelector('.app-sidebar-scrim') as HTMLElement | null;
    const sidebar = document.querySelector('.app-sidebar') as HTMLElement | null;
    if (!sidebar) throw new Error('sidebar missing');
    const scrimRect = scrim?.getBoundingClientRect();
    return {
      scrimMounted: scrim !== null,
      scrimDisplay: scrim ? getComputedStyle(scrim).display : 'unmounted',
      scrimWidth: scrimRect ? Math.round(scrimRect.width) : -1,
      scrimHeight: scrimRect ? Math.round(scrimRect.height) : -1,
      sidebarPosition: getComputedStyle(sidebar).position,
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
      sidebarCollapsed: sidebar.classList.contains('collapsed'),
      contentMounted: document.querySelector('.sales-history') !== null,
    };
  });
}

/** Enter the store-pos workspace and wait for the retail grid to be live. */
async function openRetailPos(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.STORE_POS);
  await expect(page.locator('.retail-fn-bar')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.retail-product-table')).toBeVisible({ timeout: 10_000 });
}

/**
 * Enter Sales History — a shell slot (sidebar + `.app-content`), NOT a
 * fullscreen workspace, and one of the migrated sheets with a 640px tier.
 * Waits for the real rows (the loading skeleton has no receipt lane).
 */
async function openSalesHistory(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.INVENTORY);
  await navigateTo(page, 'sales-history');
  await expect(page.locator('.sales-history')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.sales-history-table')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.sales-history-cell-receipt').first()).toBeVisible({ timeout: 10_000 });
}

test.describe('Narrow shell (<=640px content slot)', () => {
  test('retail POS: no horizontal overflow at 480x800 and 360x640', async ({ page }) => {
    await openRetailPos(page);

    for (const vp of NARROW_VIEWPORTS) {
      await resizeTo(page, vp);
      const m = await measureOverflow(page, '.retail-pos');

      expect(m.innerWidth, `viewport did not reach ${vp.label}`).toBe(vp.width);
      expect(
        m.docScrollWidth,
        `document scrolls horizontally at ${vp.label} (${m.docScrollWidth} > ${m.innerWidth})`,
      ).toBeLessThanOrEqual(m.innerWidth);
      expect(
        m.rootScrollWidth,
        `.retail-pos content overflows its own box at ${vp.label} (${m.rootScrollWidth} > ${m.rootClientWidth})`,
      ).toBeLessThanOrEqual(m.rootClientWidth);
      expect(m.rootRight, `.retail-pos paints past the right edge at ${vp.label}`).toBeLessThanOrEqual(
        m.innerWidth + 0.5,
      );
    }
  });

  test('retail POS: the 640px container tier engages (stock lane folds, fn bar wraps, table sized)', async ({
    page,
  }) => {
    await openRetailPos(page);

    // Tier inert: the wide POS terminal keeps its stock lane, content-sized
    // table and single-line function bar.
    await resizeTo(page, WIDE);
    const wide = await measureRetailTier(page);
    expect(wide.stockDisplay, `stock lane folded at ${WIDE.label}`).toBe('table-cell');
    expect(wide.tableLayout, `table sized at ${WIDE.label}`).toBe('auto');
    expect(wide.fnBarWrap, `fn bar wrapped at ${WIDE.label}`).toBe('nowrap');

    // 880px tier only: the 640px tier must NOT fire here. This is the boundary
    // that proves the assertions below come from the 640px tier and not from
    // "the window got smaller".
    await resizeTo(page, TABLET);
    const tablet = await measureRetailTier(page);
    expect(tablet.stockDisplay, `640px tier fired at ${TABLET.label}`).toBe('table-cell');
    expect(tablet.tableLayout, `640px tier fired at ${TABLET.label}`).toBe('auto');
    expect(tablet.fnBarWrap, `640px tier fired at ${TABLET.label}`).toBe('nowrap');

    for (const vp of NARROW_VIEWPORTS) {
      await resizeTo(page, vp);
      const m = await measureRetailTier(page);

      expect(m.stockDisplay, `stock lane still painted at ${vp.label}`).toBe('none');
      expect(m.tableLayout, `product table still content-sized at ${vp.label}`).toBe('fixed');
      expect(m.fnBarWrap, `fn bar did not wrap at ${vp.label}`).toBe('wrap');
    }
  });

  test('sales history (shell slot): no horizontal overflow at 480x800 and 360x640', async ({ page }) => {
    await openSalesHistory(page);

    for (const vp of NARROW_VIEWPORTS) {
      await resizeTo(page, vp);

      const shellPage = await measureOverflow(page, '.sales-history');
      expect(shellPage.innerWidth, `viewport did not reach ${vp.label}`).toBe(vp.width);
      expect(
        shellPage.docScrollWidth,
        `document scrolls horizontally at ${vp.label} (${shellPage.docScrollWidth} > ${shellPage.innerWidth})`,
      ).toBeLessThanOrEqual(shellPage.innerWidth);
      expect(
        shellPage.rootScrollWidth,
        `.sales-history content overflows its own box at ${vp.label} (${shellPage.rootScrollWidth} > ${shellPage.rootClientWidth})`,
      ).toBeLessThanOrEqual(shellPage.rootClientWidth);

      // The shell slot the page is measured against is itself overflow-free.
      const slot = await measureOverflow(page, '.app-content');
      expect(
        slot.rootScrollWidth,
        `the shell slot scrolls horizontally at ${vp.label} (${slot.rootScrollWidth} > ${slot.rootClientWidth})`,
      ).toBeLessThanOrEqual(slot.rootClientWidth);
    }
  });

  test('sales history: the 640px container tier folds items and payment and the bar scrolls', async ({
    page,
  }) => {
    await openSalesHistory(page);

    // ── WIDE: every tier inert, so both folded lanes are painted and the bar fits ──
    await resizeTo(page, WIDE);
    const wide = await measureHistoryTier(page);
    expect(wide.receiptDisplay, `receipt lane folded at ${WIDE.label}`).toBe('table-cell');
    expect(wide.itemsDisplay, `items lane folded at ${WIDE.label}`).toBe('table-cell');
    expect(wide.paymentDisplay, `payment lane folded at ${WIDE.label}`).toBe('table-cell');
    expect(
      wide.barScrollWidth,
      `the bar already overflows at ${WIDE.label} (${wide.barScrollWidth} > ${wide.barClientWidth})`,
    ).toBeLessThanOrEqual(wide.barClientWidth + 1);
    expect(
      parseFloat(wide.inputMinWidth),
      `search input lost its floor at ${WIDE.label} (min-width ${wide.inputMinWidth})`,
    ).toBeGreaterThan(0);

    // ── TABLET (1024): the 880px tiers fire, the 640px ones must NOT ──
    await resizeTo(page, TABLET);
    const tablet = await measureHistoryTier(page);
    expect(tablet.receiptDisplay, `640px tier fired at ${TABLET.label}`).toBe('table-cell');
    expect(
      tablet.itemsDisplay,
      `the 640px tier folded ITEMS at ${TABLET.label}, which is the 880px tier firing early`,
    ).toBe('table-cell');
    expect(
      parseFloat(tablet.inputMinWidth),
      `640px tier fired at ${TABLET.label} (min-width ${tablet.inputMinWidth})`,
    ).toBeGreaterThan(0);

    // ── NARROW: the tier folds exactly two lanes and the bar scrolls instead of wrapping ──
    for (const vp of NARROW_VIEWPORTS) {
      await resizeTo(page, vp);
      const m = await measureHistoryTier(page);

      // The two folded lanes, per the rule at SalesHistoryScreen.css:1195 (items + payment).
      expect(m.itemsDisplay, `items lane still painted at ${vp.label}`).toBe('none');
      expect(m.paymentDisplay, `payment lane still painted at ${vp.label}`).toBe('none');

      // The kept lanes, including the two controls that catch an over-eager fold: the rule
      // comment names receipt and status as staying, and the receipt lane is the row's
      // primary affordance, so a change there is a redesign rather than a tier tweak.
      expect(m.receiptDisplay, `receipt lane folded at ${vp.label}, but it is a KEPT lane`).toBe('table-cell');
      expect(m.statusDisplay, `status lane folded at ${vp.label}, but it is a KEPT lane`).toBe('table-cell');

      // The tier's actual mechanism: a compact bar that scrolls its own content.
      expect(m.barFlexWrap, `the filter bar wrapped at ${vp.label} instead of scrolling`).toBe('nowrap');
      expect(m.barOverflowX, `the filter bar is not a scrollport at ${vp.label}`).toBe('auto');
      expect(
        m.barScrollWidth,
        `the compact bar does not overflow at ${vp.label}, so the scroll it exists for is gone`,
      ).toBeGreaterThan(m.barClientWidth);

      // The input keeps a floor (9rem = 144px at the default root size) rather than
      // collapsing; asserted as > 0 so a root-font change does not break the case.
      expect(
        parseFloat(m.inputMinWidth),
        `search input lost its floor at ${vp.label} (min-width ${m.inputMinWidth})`,
      ).toBeGreaterThan(0);
      expect(m.inputWidth, `search input collapsed at ${vp.label}`).toBeGreaterThan(0);
    }
  });

  test('sidebar overlay: the scrim paints only in the narrow portrait branch and dismisses the overlay', async ({
    page,
  }) => {
    await openSalesHistory(page);

    // Landscape desktop: the scrim node is mounted (the sidebar is expanded)
    // but paints nothing, and the sidebar is an in-flow lane.
    await resizeTo(page, WIDE);
    const wide = await measureScrim(page);
    expect(wide.sidebarCollapsed, 'sidebar unexpectedly collapsed').toBe(false);
    expect(wide.scrimMounted, 'scrim not mounted while the sidebar is expanded').toBe(true);
    expect(wide.scrimDisplay, `scrim painted at ${WIDE.label}`).toBe('none');
    expect(wide.sidebarPosition, `sidebar left the flow at ${WIDE.label}`).toBe('static');
    expect(wide.sidebarWidth, `sidebar is not the 220px lane at ${WIDE.label}`).toBe(220);

    // Narrow portrait: the same node becomes the viewport-wide dismissal surface.
    await resizeTo(page, NARROW_PORTRAIT);
    const narrow = await measureScrim(page);
    expect(narrow.scrimMounted, 'scrim not mounted while the sidebar is expanded').toBe(true);
    expect(narrow.scrimDisplay, `scrim did not paint at ${NARROW_PORTRAIT.label}`).toBe('block');
    expect(narrow.sidebarPosition, `sidebar did not become an overlay at ${NARROW_PORTRAIT.label}`).toBe(
      'absolute',
    );
    expect(narrow.scrimWidth, 'scrim is not viewport-wide').toBeGreaterThanOrEqual(479);
    expect(narrow.scrimHeight, 'scrim is not viewport-tall').toBeGreaterThanOrEqual(799);

    // Click-to-dismiss. The point is top-right: the memo stack is fixed at the
    // bottom-left with a HIGHER z-index (--z-overlay) and would intercept there.
    await expect(page.locator('.app-sidebar-scrim')).toBeVisible();
    await page.locator('.app-sidebar-scrim').click({ position: { x: 440, y: 60 } });

    await expect(page.locator('.app-sidebar')).toHaveClass(/collapsed/);
    await expect(page.locator('.app-sidebar-scrim')).toBeHidden();
    await expect(page.locator('.sales-history')).toBeVisible();

    const collapsed = await measureScrim(page);
    expect(collapsed.scrimMounted, 'scrim stayed mounted after the overlay collapsed').toBe(false);
    expect(collapsed.sidebarCollapsed, 'sidebar did not collapse').toBe(true);
    expect(collapsed.contentMounted, 'dismissing the overlay unmounted the page').toBe(true);
  });

  test('sidebar overlay: Escape stops the overlay covering the page at narrow portrait', async ({ page }) => {
    await openSalesHistory(page);
    await resizeTo(page, NARROW_PORTRAIT);

    const expanded = await measureScrim(page);
    expect(expanded.scrimDisplay, 'scrim not covering the page before Escape').toBe('block');
    expect(expanded.sidebarPosition, 'sidebar is not an overlay before Escape').toBe('absolute');

    await page.keyboard.press('Escape');
    await expect(page.locator('.app-sidebar-scrim')).toBeHidden();

    const after = await page.evaluate(() => {
      const scrim = document.querySelector('.app-sidebar-scrim') as HTMLElement | null;
      const sidebar = document.querySelector('.app-sidebar') as HTMLElement | null;
      return {
        overlayOpen: scrim !== null && getComputedStyle(scrim).display !== 'none',
        sidebarPresent: sidebar !== null,
        sidebarExpanded: sidebar !== null && !sidebar.classList.contains('collapsed'),
        collapsedFlag: localStorage.getItem('app-sidebar-collapsed'),
        shellPageMounted: document.querySelector('.sales-history') !== null,
        pickerMounted: document.querySelector('.workspace-home') !== null,
      };
    });

    // The T1 invariant: the overlay no longer covers the page. Both the
    // "sidebar collapsed" and the "workspace exited" branch satisfy it, and a
    // regression that left the scrim painted fails here. The pins below are
    // what force the "collapsed" branch rather than the workspace exit.
    expect(after.overlayOpen, 'the overlay still covers the page after Escape').toBe(false);
    expect(
      after.sidebarPresent && after.sidebarExpanded,
      'sidebar is still present and expanded after Escape',
    ).toBe(false);

    // FIXED-behaviour pins (commit 6102537b7): Escape collapses the overlay
    // instead of exiting the workspace. Before the fix, AppShell's workspace
    // Escape handler swallowed the key, `app-sidebar-collapsed` stayed
    // "false", and the workspace picker replaced the page.
    expect(
      after.collapsedFlag,
      'Escape did not collapse the sidebar (localStorage "app-sidebar-collapsed" not "true")',
    ).toBe('true');
    expect(
      after.shellPageMounted,
      'the workspace exited on Escape instead of collapsing the overlay',
    ).toBe(true);
    expect(after.pickerMounted, 'the workspace picker appeared on Escape').toBe(false);
    await expect(page.getByTestId('workspace-home')).toBeHidden();
    await expect(page.locator('.sales-history')).toBeVisible();
  });
});
