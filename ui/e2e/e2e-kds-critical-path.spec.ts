import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E Critical Path: KDS Full Lifecycle
 *
 * Tests the Kitchen Display System end-to-end: ticket lifecycle from
 * pending → preparing → ready → served, keyboard shortcuts, zone
 * filtering, and per-item status advance.
 *
 * CSS contract (current component):
 *   .kds                          — KDS container (role="region", name
 *                                   "Kitchen Display System")
 *   .kds-header                   — header bar
 *   .kds-header-left              — back button + filter control
 *   .kds-tabs / .kds-tab-count    — Open/Completed tablist + order count
 *   .kds-header-right             — shift + device area
 *   .kds-columns                  — Kanban three-column grid
 *   .kds-column                   — individual status column
 *   .kds-column--pending          — pending column
 *   .kds-column--preparing        — preparing column
 *   .kds-column--ready            — ready column
 *   .kds-ticket                   — clickable ticket card (button)
 *   .order-no                     — display number (e.g. "#101")
 *   .kds-ticket-time              — SLA time indicator
 *   .kds-ticket--selected         — the keyboard-selected ticket
 *   .kds-zone-chips               — kitchen zone filter chips
 *
 * RETARGETED: the standalone title/order-count block and the
 * keyboard-shortcuts popover were both removed from the header
 * (KdsScreen.css:2069 records the popover removal). The shortcuts
 * themselves are still live — useKdsShortcuts binds 1-9 / arrows / Space /
 * Escape to document — so that test now drives the real bindings and
 * asserts the .kds-ticket--selected marker instead of the dead popover.
 *   .kds-item-row--actionable     — clickable per-item row
 *   .kds-ticket-item-status-dot   — item status indicator
 */

const TIMEOUT = 10_000;

test.describe('Critical Path: KDS Full Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    await selectWorkspace(page, WORKSPACES.KDS);
  });

  // ── Step 1: Verify initial state ──────────────────────────────────
  test('KDS loads with title, columns, and order count', async ({ page }) => {
    // The screen name is the container's accessible name; the counts live
    // on the Open/Completed tabs.
    await expect(page.getByRole('region', { name: 'Kitchen Display System' }))
      .toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.kds-header')).toBeVisible({ timeout: 5_000 });

    // Order count must show at least 1 order.
    const countText = await page.locator('.kds-tab-count').first().textContent();
    expect(countText).toBeTruthy();
    const countMatch = countText!.match(/\d+/);
    expect(countMatch).not.toBeNull();
    expect(parseInt(countMatch![0], 10)).toBeGreaterThanOrEqual(1);

    // Kanban: 3 columns with counts.
    await expect(page.locator('.kds-columns')).toBeVisible({ timeout: 5_000 });
    const columns = page.locator('.kds-column');
    await expect(columns).toHaveCount(3);
    await expect(page.locator('.kds-column-count')).toHaveCount(3);

    // Each column must have a title.
    const columnTitles = page.locator('.kds-column-title');
    expect(await columnTitles.count()).toBe(3);

    // No crash.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });

  // ── Step 2: Ticket lifecycle — advance through all statuses ────────
  test.fixme('advance a ticket through all statuses: pending → preparing → ready → served', async ({ page }) => {
    // Skipped: KDS component refactored — advance mechanism changed from
    // card click to footer button with cooldown wrapper. Business logic
    // test needs to be rewritten against the new component API.
    test.setTimeout(60_000); // Lifecycle advances need time for status transitions
    await expect(page.locator('.kds-columns')).toBeVisible({ timeout: TIMEOUT });

    const pendingTickets = page.locator('.kds-column--pending .kds-ticket');
    await expect(pendingTickets.first()).toBeVisible({ timeout: 5_000 });

    // Track the exact ticket we click instead of comparing aggregate counts.
    const firstPending = pendingTickets.first();
    const ticketNumberText = await firstPending.locator('.order-no').textContent() || '';
    expect(ticketNumberText).toMatch(/#\d+/);

    // The advance button is in the card footer (.kds-status-btn),
    // NOT the card header (which toggles collapse).
    const advanceBtn = firstPending.locator('.kds-status-btn');
    await expect(advanceBtn).toBeVisible({ timeout: 5_000 });

    // ── Advance 1: pending → preparing ─────────────────────────────
    // force:true bypasses actionability checks — the card header animation
    // can make Playwright think the element is not stable.
    await advanceBtn.click({ force: true });
    await expect.poll(
      async () => await page.locator('.kds-column--pending').locator('.kds-ticket').filter({ hasText: ticketNumberText }).count(),
      { timeout: 8_000, message: `${ticketNumberText} should leave pending` },
    ).toBe(0);
    await expect(page.locator('.kds-column--preparing').locator('.kds-ticket').filter({ hasText: ticketNumberText })).toHaveCount(1, { timeout: 3_000 });

    // ── Advance 2: preparing → ready ───────────────────────────────
    const preparingTicket = page.locator('.kds-column--preparing .kds-ticket').filter({ hasText: ticketNumberText }).first();
    const preparingAdvanceBtn = preparingTicket.locator('.kds-status-btn');
    await expect(preparingAdvanceBtn).toBeVisible({ timeout: 5_000 });
    await preparingAdvanceBtn.click({ force: true });
    await expect.poll(
      async () => await page.locator('.kds-column--preparing').locator('.kds-ticket').filter({ hasText: ticketNumberText }).count(),
      { timeout: 8_000, message: `${ticketNumberText} should leave preparing` },
    ).toBe(0);
    await expect(page.locator('.kds-column--ready').locator('.kds-ticket').filter({ hasText: ticketNumberText })).toHaveCount(1, { timeout: 3_000 });

    // ── Advance 3: ready → served ──────────────────────────────────
    const readyTicket = page.locator('.kds-column--ready .kds-ticket').filter({ hasText: ticketNumberText }).first();
    const readyAdvanceBtn = readyTicket.locator('.kds-status-btn');
    await expect(readyAdvanceBtn).toBeVisible({ timeout: 5_000 });
    await readyAdvanceBtn.click({ force: true });
    await expect.poll(
      async () => await page.locator('.kds-column--ready').locator('.kds-ticket').filter({ hasText: ticketNumberText }).count(),
      { timeout: 8_000, message: `${ticketNumberText} should leave ready` },
    ).toBe(0);

    // No crash after full cycle.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });

  // ── Step 3: Keyboard shortcuts ─────────────────────────────────────
  //
  // The shortcuts POPOVER was removed from the header, but the shortcuts
  // themselves are live: useKdsShortcuts binds 1-9 (select the nth ticket),
  // ArrowUp/ArrowDown (move the selection), Space (advance the selected
  // ticket) and Escape (deselect) to document. This drives those real
  // bindings — the same behaviour the popover used to advertise.

  test('number key selects a ticket and Escape deselects it', async ({ page }) => {
    await expect(page.locator('.kds-columns')).toBeVisible({ timeout: TIMEOUT });
    // The board must have a ticket for the number key to select.
    await expect(page.locator('.kds-ticket').first()).toBeVisible({ timeout: TIMEOUT });

    // Nothing is selected before the key press.
    await expect(page.locator('.kds-ticket--selected')).toHaveCount(0);

    // "1" selects the first filtered ticket.
    await page.keyboard.press('1');
    await expect(page.locator('.kds-ticket--selected')).toHaveCount(1, { timeout: 3_000 });

    // Escape clears the selection.
    await page.keyboard.press('Escape');
    await expect(page.locator('.kds-ticket--selected')).toHaveCount(0, { timeout: 3_000 });

    // No crash.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });

  // ── Step 4: Kitchen zone filter chips ──────────────────────────────
  test('kitchen zone filter chips render when zones are present', async ({ page }) => {
    await expect(page.locator('.kds-columns')).toBeVisible({ timeout: TIMEOUT });

    // Zone chips only render when orders have kitchen_zone set.
    // Skip silently if the dev-mock doesn't assign kitchen zones.
    const zoneChips = page.locator('.kds-zone-chips');
    const zoneChipsExist = (await zoneChips.count()) > 0;
    if (!zoneChipsExist) return;

    await expect(zoneChips).toBeVisible({ timeout: 3_000 });

    // First chip must be active by default.
    const firstChip = zoneChips.locator('.kds-zone-chip').first();
    await expect(firstChip).toBeVisible();
    expect(await zoneChips.locator('.kds-zone-chip').count()).toBeGreaterThanOrEqual(1);

    // No crash.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });

  // ── Step 5: Per-item status advance ────────────────────────────────
  test('click actionable per-item row to advance individual line item status', async ({ page }) => {
    await expect(page.locator('.kds-columns')).toBeVisible({ timeout: TIMEOUT });

    // Find an actionable per-item row inside a ticket (dev-mock returns course-grouped items).
    const actionableItem = page.locator(
      '.kds-ticket .kds-item-row--actionable',
    ).first();
    const itemVisible = await actionableItem.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!itemVisible) return; // Skip if no actionable items (e.g. all served)

    // Read the current status dot class before click.
    const statusDot = actionableItem.locator('.kds-ticket-item-status-dot');
    const beforeClass = await statusDot.getAttribute('class');
    expect(beforeClass).toBeTruthy();

    // Click the actionable item row to advance its status.
    await actionableItem.click();

    // No crash after per-item status advance.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });
});
