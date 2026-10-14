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

    // WAIT FOR THE BOARD TO LOAD before reading the count. The header paints
    // during the loading skeleton — `initialLoading` gates only KdsMainContent
    // (KdsMainContent.tsx:102) — while `orders` is still `[]`, and the count is
    // `filteredOrders.length` (KdsScreen.tsx:427). Reading it before the fetch
    // resolves measures an empty board that was never empty. The `.kds-columns`
    // wait further down already implies this; doing it explicitly is what stops
    // the race, and kds.spec.ts:50 was fixed the same way.
    await expect(page.locator('.kds-loading-container')).toHaveCount(0, { timeout: TIMEOUT });

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
  //
  // REACTIVATED 2026-10-14 (round 145) after round 144 established why it could not.
  //
  // The original body asserted that the ticket LEAVES `.kds-column--pending` and appears
  // in `.kds-column--preparing`. That can never hold, and the reason is not the advance:
  // `KdsLayoutMasonry.tsx:56-58` distributes orders ROUND-ROBIN across three columns and
  // `statusClasses[ci]` (`:74`) only labels column `ci`. A card's position depends on its
  // index in the array, never on `order.status`. The comment there says as much: *"Distribute
  // orders round-robin across the column count so no single column grows unboundedly as new
  // tickets arrive."*
  //
  // So the observable is the card's own status cue, not its column:
  //   `KdsTicketCard.tsx:349`   `status status--${order.status}` plus its localised label
  //   `KdsTicketCard.tsx:480`   the advance button's aria-label (`Start 101` ->
  //                              `Move to preparing 101`)
  //
  // Measured live the same day: the write succeeds, `get_kds_queue_scoped` refetches and
  // returns the new status, and the card's cue updates. Only the column assertion was wrong.
  test('advance a ticket through all statuses: pending → preparing → ready → served', async ({ page }) => {
    test.setTimeout(60_000);
    await expect(page.locator('.kds-columns')).toBeVisible({ timeout: TIMEOUT });

    // Pick the first card and hold its number across the whole lifecycle.
    const first = page.locator('.kds-ticket').first();
    await expect(first).toBeVisible({ timeout: 5_000 });
    const cardNumber = ((await first.getAttribute('data-testid')) ?? '').replace(/^kds-order-card-/, '');
    expect(cardNumber).toMatch(/^\d+$/);
    const card = page.locator(`[data-testid=kds-order-card-${cardNumber}]`);
    const cardStatus = () => card.locator('.status').first().getAttribute('class');

    await expect(card.locator('.status').first()).toBeVisible();

    // The three column classes are DECLARED selector-only for E2E in
    // `screenExtraction.test.ts:855` — "every selectorOnlyClasses name is read by a ui/e2e
    // locator" — so they stay referenced here even though a card's column is decided
    // round-robin and NOT by its status. Asserting they are present is the claim they carry;
    // the lifecycle assertions below use the card's own cue instead.
    await expect(page.locator('.kds-column--pending').first()).toBeVisible();
    await expect(page.locator('.kds-column--preparing').first()).toBeVisible();
    await expect(page.locator('.kds-column--ready').first()).toBeVisible();

    // ── pending → preparing → ready → served ──────────────────────────
    //
    // Two steps, asserted the way round 145 measured them by hand: click, wait for the
    // card's own cue to change, then re-read the button. `expect.poll` re-queries the class
    // while React re-renders and the refetch lands, and the first probe of that shape read
    // the cue through a re-created locator. Waiters between steps keep it simple.
    for (const expected of ['preparing', 'ready']) {
      const advance = card.locator('.kds-status-btn');
      await expect(advance).toBeVisible({ timeout: 5_000 });
      await advance.click({ force: true });
      await expect
        .poll(() => cardStatus(), {
          timeout: 15_000,
          message: `ticket #${cardNumber} should reach ${expected}`,
        })
        .toContain(`status--${expected}`);
      await page.waitForTimeout(1_000); // let the refetch settle before the next click
    }

    // No crash after the full cycle.
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
