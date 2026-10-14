import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

/**
 * E2E: the restaurant Receipts screen's two preview documents.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Round 177's sweep found 94 restaurant/tables testids with no e2e reference; the tables
 * block is now covered, the receipts block is the next largest. E2E touched the route and
 * the Save gate, never what the operator actually READS — the two preview documents.
 *
 * The two tabs render genuinely DIFFERENT documents and the difference is the point:
 *
 *   customer — store header, address lines, line items with prices, subtotal / tax / total.
 *   kitchen  — `*** KITCHEN ORDER TICKET ***`, one large table or order number, time /
 *             staff / pax, items GROUPED BY COURSE as `1x Lumpia Goreng`, item notes when
 *             enabled. NO PRICES — a ticket the cook reads, not a bill.
 *
 * A regression that put prices on the chit, or dropped the course grouping, is an
 * operational error: the cook does not need money and the runner needs the course.
 */

const TIMEOUT = 20_000;

async function openReceipts(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'receipts');
  await expect(page.locator('[data-testid="restaurant-receipts-title"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}


test('the customer preview is the priced document', async ({ page }) => {
  await openReceipts(page);

  const customerTab = page.locator('[data-testid="restaurant-preview-tab-customer"]');
  await expect(customerTab).toHaveAttribute('aria-selected', 'true', { timeout: TIMEOUT });

  const paper = page.locator('.resto-receipt-paper');
  await expect(paper).toBeVisible({ timeout: TIMEOUT });

  // The total is what makes it a receipt rather than a list, and it lives ONLY on the
  // customer document — the kitchen chit deliberately carries no money.
  await expect(paper.getByText(/Total/i).first()).toBeVisible({ timeout: TIMEOUT });
  await expect(page.locator('[data-testid="receipt-preview-kitchen-chit"]')).toHaveCount(0);
});

test('the kitchen chit is course-grouped and unpriced', async ({ page }) => {
  await openReceipts(page);

  const kitchenTab = page.locator('[data-testid="restaurant-preview-tab-kitchen"]');
  await expect(kitchenTab).toHaveAttribute('aria-selected', 'false', { timeout: TIMEOUT });
  await kitchenTab.click();
  await expect(kitchenTab).toHaveAttribute('aria-selected', 'true', { timeout: TIMEOUT });

  const chit = page.locator('[data-testid="receipt-preview-kitchen-chit"]');
  await expect(chit).toBeVisible({ timeout: TIMEOUT });

  // The ticket header and terminator frame the document.
  await expect(chit.getByText(/KITCHEN ORDER TICKET/i).first()).toBeVisible({ timeout: TIMEOUT });
  await expect(chit.getByText(/END OF KOT/i).first()).toBeVisible({ timeout: TIMEOUT });

  // Course grouping: courses are headings, not a flat list.
  await expect(chit.getByText(/APPETIZER/i).first()).toBeVisible({ timeout: TIMEOUT });
  await expect(chit.getByText(/MAIN COURSE/i).first()).toBeVisible({ timeout: TIMEOUT });
  await expect(chit.getByText(/BEVERAGE/i).first()).toBeVisible({ timeout: TIMEOUT });

  // Quantities are the cook's unit of work.
  await expect(chit.getByText(/1x/i).first()).toBeVisible({ timeout: TIMEOUT });
  await expect(chit.getByText(/Nasi Goreng Spesial/i).first()).toBeVisible({ timeout: TIMEOUT });

  // THE POINT: the chit carries no money. `Total` appears on the customer document and must
  // not appear here. Matched case-insensitively, since the customer one is a styled label.
  await expect(chit.getByText(/Total/i)).toHaveCount(0);

  // A large table or order number is the one identifier the chit shows.
  await expect(chit.getByText(/TABLE 1|ORDER #42/).first()).toBeVisible({ timeout: TIMEOUT });
});
