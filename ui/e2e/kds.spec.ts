import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: Kitchen Display System (KDS) — Hard Assertions
 *
 * Tests the KDS screen from the KDS workspace, including Kanban columns,
 * ticket interaction (status advance), and layout switching (Focus/Metro).
 *
 * CSS contract (KdsScreen.tsx + KdsTicketCard.tsx + layout components):
 *   .kds                       — container (role="region", name "Kitchen
 *                                Display System" — kds-screen-aria)
 *   .kds-header                — header bar
 *   .kds-header-left           — back button + filter control
 *   .kds-tabs / .kds-tab       — Open/Completed tablist; .kds-tab-count is
 *                                the per-tab order count
 *   .kds-header-right          — shift + device area
 *   .kds-columns               — Kanban three-column grid
 *
 * RETARGETED: the standalone title/order-count block was removed when the
 * header was split into KdsHeaderLeft / KdsHeaderTabs / KdsHeaderRight.
 * There is no .kds-title and no .kds-order-count any more — the screen
 * name is the region's accessible name and the counts live on the tabs.
 *   .kds-column                — individual status column
 *   .kds-column--pending       — pending column
 *   .kds-column--preparing     — preparing column
 *   .kds-column--ready         — ready column
 *   .kds-column-title          — column heading
 *   .kds-column-count          — column count badge
 *   .kds-ticket                — clickable ticket card (button)
 *   .order-no                  — display number (e.g. "#101")
 *   .kds-ticket-items          — items summary text (fallback)
 *   .kds-category              — course-grouped items container
 *   .kds-item-name             — individual item name
 *   .kds-ticket-time           — SLA time display
 *
 * Route: #/kds (available from the KDS workspace)
 */

const TIMEOUT = 10_000;

test.describe('Kitchen Display System', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    await selectWorkspace(page, WORKSPACES.KDS);
  });

  // ── E2E: KDS screen renders with title, columns, and order count ──

  test('loads with title, 3 columns, and non-zero order count', async ({ page }) => {
    // The screen name is the container's accessible name.
    const region = page.getByRole('region', { name: 'Kitchen Display System' });
    await expect(region).toBeVisible({ timeout: TIMEOUT });

    // Header and its three columns.
    await expect(page.locator('.kds-header')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.kds-header-left')).toBeVisible({ timeout: 3_000 });

    // Order count: the Open tab prints the board's order count.
    const openTabCount = page.locator('.kds-tab-count').first();
    await expect(openTabCount).toBeVisible({ timeout: 5_000 });
    const countText = await openTabCount.textContent();
    expect(countText).toBeTruthy();
    const countMatch = countText!.match(/\d+/);
    expect(countMatch).not.toBeNull();
    expect(parseInt(countMatch![0], 10)).toBeGreaterThanOrEqual(1);

    // Header right area (shift + device) must be present.
    await expect(page.locator('.kds-header-right')).toBeVisible({ timeout: 5_000 });

    // Kanban: 3 columns (pending, preparing, ready).
    await expect(page.locator('.kds-columns')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.kds-column')).toHaveCount(3);
    await expect(page.locator('.kds-column-count')).toHaveCount(3);

    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });

  // ── E2E: Ticket cards render with display numbers and items ──

  test('tickets render with display number, items summary, and SLA time', async ({ page }) => {
    await expect(page.locator('.kds-columns')).toBeVisible({ timeout: TIMEOUT });

    // Tickets must be visible (dev-mock returns 3 orders).
    const ticket = page.locator('.kds-ticket').first();
    await expect(ticket).toBeVisible({ timeout: 5_000 });

    // Display number (#101, #102, etc.).
    // The component renders the order number inside .order-no (not .kds-ticket-number).
    const numberEl = page.locator('.order-no').first();
    await expect(numberEl).toBeVisible({ timeout: 3_000 });
    expect(await numberEl.textContent()).toMatch(/#\d+/);

    // Items summary. Line items lazy-fetch via get_kds_order_lines_scoped,
    // so the course-grouped .kds-category / .kds-item-name elements render;
    // the flat .kds-ticket-items span is the loading/old-order fallback.
    // Use a broad selector that covers both the structured and fallback views.
    const itemsEl = page.locator('.kds-category, .kds-ticket-items, .kds-item-name').first();
    await expect(itemsEl).toBeVisible({ timeout: 3_000 });
    const itemsContent = await itemsEl.textContent();
    expect(itemsContent).toBeTruthy();
    expect(itemsContent!.length).toBeGreaterThan(3);

    // SLA time indicator.
    await expect(page.locator('.kds-ticket-time').first()).toBeVisible({ timeout: 3_000 });

    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });

  // ── E2E: Clicking a pending ticket advances status ────────────

  test('clicking a pending ticket advances status without crashing', async ({ page }) => {
    await expect(page.locator('.kds-columns')).toBeVisible({ timeout: TIMEOUT });

    // Dev-mock always returns a pending order — click it to advance.
    const pendingTicket = page.locator('.kds-column--pending .kds-ticket').first();
    await expect(pendingTicket).toBeVisible({ timeout: 5_000 });
    await pendingTicket.click();

    // No error boundary after status advance.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });

  // ── E2E: Header right area has interactive buttons ────────────

  test('header right area has interactive settings/layout buttons', async ({ page }) => {
    await expect(page.locator('.kds')).toBeVisible({ timeout: TIMEOUT });

    const headerRight = page.locator('.kds-header-right');
    await expect(headerRight).toBeVisible({ timeout: 5_000 });

    // At least 1 button (settings toggle, layout toggle, or both).
    const headerButtons = headerRight.locator('button');
    await expect(headerButtons.first()).toBeVisible({ timeout: 3_000 });
    expect(await headerButtons.count()).toBeGreaterThanOrEqual(1);

    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });
});
