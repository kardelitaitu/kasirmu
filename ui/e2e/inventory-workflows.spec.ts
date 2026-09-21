import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES, navigateTo } from './helpers';

/**
 * E2E: Inventory Workflows — Stock Counts, Transfers, Purchase Orders
 *
 * Covers inventory operations with zero prior E2E coverage.
 * All tests use hard assertions — no soft guards.
 *
 * Routes (all accessible from Inventory workspace):
 *   #/stock-counts      → StockCountsScreen (.sc-screen)
 *   #/stock-transfers   → StockTransfersScreen (.stock-transfers)
 *   #/purchase-orders   → PurchaseOrdersScreen (.po-screen)
 *   #/suppliers         → SuppliersScreen (.suppliers-screen)
 *
 * Mock data: all lists return empty arrays — screens render
 * with empty-state placeholders.
 */

test.describe('Inventory Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    await selectWorkspace(page, WORKSPACES.INVENTORY);
  });

  // ── Stock Counts ────────────────────────────────────────

  test('stock counts screen renders container', async ({ page }) => {
    await navigateTo(page, 'stock-counts');

    await expect(page.locator('.sc-screen')).toBeVisible({ timeout: 8_000 });
  });

  // ── Stock Transfers ─────────────────────────────────────

  test('stock transfers screen renders with title', async ({ page }) => {
    await navigateTo(page, 'stock-transfers');

    await expect(page.locator('.stock-transfers')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.stock-transfers-title')).toContainText('Stock Transfer');
  });

  // ── Purchase Orders ─────────────────────────────────────

  test('purchase orders screen renders container', async ({ page }) => {
    await navigateTo(page, 'purchase-orders');

    await expect(page.locator('.po-screen')).toBeVisible({ timeout: 8_000 });
  });

  // ── Suppliers ───────────────────────────────────────────

  test('suppliers screen renders with table', async ({ page }) => {
    await navigateTo(page, 'suppliers');

    await expect(page.locator('.suppliers-screen')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.suppliers-title')).toContainText('Supplier');

    // Table must render (even if empty).
    await expect(page.locator('.suppliers-table')).toBeVisible({ timeout: 5_000 });
  });
});

// ── E2E-34 through E2E-36: Inventory workflow tests ───────────
//
// CSS contract:
//   Inventory Adjustment:  .inv-adjust, .inv-adjust-search,
//     .inv-adjust-product-item, .inv-adjust-selected-product,
//     #inv-field-qty, #inv-field-reason, .inv-adjust-actions,
//     .inv-adjust-type-btn (add/remove toggle)
//   Purchase Orders:       .po-screen, .po-table,
//     .po-form-overlay, .po-form-modal, .po-form-input,
//     .po-form-select, .po-form-lines-table, .po-form-actions
//   Stock Transfers:       .stock-transfers, .stock-transfers-table,
//     .stock-transfers-overlay, #st-source-location,
//     #st-dest-location, .stock-transfers-line-sku,
//     .stock-transfers-line-qty

const WF_TIMEOUT = 8_000;

test.describe('Inventory Workflows — Full', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    await selectWorkspace(page, WORKSPACES.INVENTORY);
  });

  // ── E2E-34: Stock adjustment flow ───────────────────────

  test('stock adjustment: search product, adjust qty, verify form renders', async ({ page }) => {
    await navigateTo(page, 'inventory-adjustment');

    // Container must render.
    await expect(page.locator('.inv-adjust')).toBeVisible({ timeout: WF_TIMEOUT });
    await expect(page.locator('.inv-adjust-title')).toContainText('Inventory');

    // Search input must be present and functional.
    const searchInput = page.locator('.inv-adjust-search');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Type a search query to find products.
    await searchInput.fill('latte');

    // Product results must appear (mock returns filtered products).
    const productItem = page.locator('.inv-adjust-product-item').first();
    await expect(productItem).toBeVisible({ timeout: 5_000 });

    // Click a product to select it.
    await productItem.click();

    // Selected product section must appear with name and SKU.
    await expect(page.locator('.inv-adjust-selected-product')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.inv-adjust-selected-name')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.inv-adjust-selected-sku')).toBeVisible({ timeout: 3_000 });

    // Adjustment type toggle (add/remove) must be present.
    await expect(page.locator('.inv-adjust-type-toggle')).toBeVisible({ timeout: 3_000 });

    // "Add" type button should be active by default.
    const addBtn = page.locator('.inv-adjust-type-btn--add');
    await expect(addBtn).toBeVisible({ timeout: 3_000 });

    // Quantity input must be visible.
    const qtyInput = page.locator('#inv-field-qty');
    await expect(qtyInput).toBeVisible({ timeout: 3_000 });
    await qtyInput.fill('5');
    expect(await qtyInput.inputValue()).toBe('5');

    // Reason dropdown must be visible.
    const reasonSelect = page.locator('#inv-field-reason');
    await expect(reasonSelect).toBeVisible({ timeout: 3_000 });
    await reasonSelect.selectOption({ index: 1 });

    // Action buttons (Cancel / Apply) must be present.
    const actions = page.locator('.inv-adjust-actions');
    await expect(actions).toBeVisible({ timeout: 3_000 });

    // Click the Apply button to submit the adjustment.
    const applyBtn = actions.locator('button:has-text("Apply"), button:has-text("Terapkan")').first();
    await expect(applyBtn).toBeVisible({ timeout: 3_000 });
    await applyBtn.click();

    // After successful adjustment, the selected product should clear
    // or the screen should remain visible (no crash).
    await expect(page.locator('.inv-adjust')).toBeVisible({ timeout: 5_000 });

    // No error boundary.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });

  // ── E2E-35: Purchase order creation flow ─────────────────

  test('purchase order: create PO with lines and verify form renders', async ({ page }) => {
    await navigateTo(page, 'purchase-orders');

    // Container and title must render.
    await expect(page.locator('.po-screen')).toBeVisible({ timeout: WF_TIMEOUT });
    await expect(page.locator('.po-title')).toContainText('Purchase');

    // Click "New Purchase Order" button.
    const newPoBtn = page.locator('button:has-text("New Purchase Order"), button:has-text("Pesanan")').first();
    await expect(newPoBtn).toBeVisible({ timeout: 5_000 });
    await newPoBtn.click();

    // PO form modal must open.
    await expect(page.locator('.po-form-overlay')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.po-form-modal')).toBeVisible({ timeout: 3_000 });

    // Form must have PO Number input.
    const poInputs = page.locator('.po-form-input');
    const poNumberInput = poInputs.first();
    await expect(poNumberInput).toBeVisible({ timeout: 3_000 });
    await poNumberInput.fill('PO-E2E-001');

    // Supplier dropdown must be present.
    const supplierSelect = page.locator('.po-form-select').first();
    await expect(supplierSelect).toBeVisible({ timeout: 3_000 });
    await supplierSelect.selectOption({ index: 1 });

    // Line items table must be present.
    await expect(page.locator('.po-form-lines-table')).toBeVisible({ timeout: 3_000 });

    // Fill SKU in first line.
    const skuInputs = page.locator('.po-form-lines-table').locator('.po-form-input').first();
    await expect(skuInputs).toBeVisible({ timeout: 3_000 });
    await skuInputs.fill('TEST-SKU');

    // Fill Qty in first line (third .po-form-input in the row: sku, name, qty, cost).
    const lineInputs = page.locator('.po-form-lines-table').locator('.po-form-input');
    const qtyInput = lineInputs.nth(2);
    await expect(qtyInput).toBeVisible({ timeout: 3_000 });
    await qtyInput.fill('10');

    // "+ Add Line" button must be visible.
    const addLineBtn = page.locator('button:has-text("+ Add Line"), button:has-text("+ Tambah")');
    await expect(addLineBtn).toBeVisible({ timeout: 3_000 });

    // Add a second line.
    await addLineBtn.click();

    // Action buttons (Cancel / Create PO) must be present.
    const actions = page.locator('.po-form-actions');
    await expect(actions).toBeVisible({ timeout: 3_000 });

    // Click Create PO to submit the order.
    const createBtn = actions.locator('button:has-text("Create"), button:has-text("Buat")').first();
    await expect(createBtn).toBeVisible({ timeout: 3_000 });
    await createBtn.click();

    // After submission, form should close (or show validation error).
    // Verify the PO table is still visible.
    await expect(page.locator('.po-screen')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.po-table')).toBeVisible({ timeout: 5_000 });

    // No error boundary.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });

  // ── E2E-36: Stock transfer flow ─────────────────────────

  test('stock transfer: create transfer with source/destination and lines', async ({ page }) => {
    await navigateTo(page, 'stock-transfers');

    // Container and title must render.
    await expect(page.locator('.stock-transfers')).toBeVisible({ timeout: WF_TIMEOUT });
    await expect(page.locator('.stock-transfers-title')).toContainText('Stock Transfer');

    // Filter segments must be present. Located by role inside the strip: the
    // per-button class this used to name belongs to the old markup, and the
    // shared segmented control keeps only the track's hook class.
    const filterBtns = page.locator('.stock-transfers-filters').getByRole('tab');
    const filterCount = await filterBtns.count();
    expect(filterCount).toBeGreaterThanOrEqual(2);

    // Table must be visible (may show empty state).
    await expect(page.locator('.stock-transfers-table')).toBeVisible({ timeout: 5_000 });

    // Click "New Transfer" button.
    const newTransferBtn = page.locator('button:has-text("New Transfer"), button:has-text("Transfer Baru")');
    await expect(newTransferBtn).toBeVisible({ timeout: 5_000 });
    await newTransferBtn.click();

    // Create transfer modal must open.
    const overlay = page.locator('.stock-transfers-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // Source location input must be present.
    const sourceInput = page.locator('#st-source-location');
    await expect(sourceInput).toBeVisible({ timeout: 3_000 });
    await sourceInput.fill('Warehouse A');

    // Destination location input must be present.
    const destInput = page.locator('#st-dest-location');
    await expect(destInput).toBeVisible({ timeout: 3_000 });
    await destInput.fill('Store B');

    // SKU input in line items table must be present.
    const lineSkuInput = page.locator('.stock-transfers-line-sku').first();
    await expect(lineSkuInput).toBeVisible({ timeout: 3_000 });
    await lineSkuInput.fill('SKU-001');

    // Qty input in line items must be present.
    const lineQtyInput = page.locator('.stock-transfers-line-qty').first();
    await expect(lineQtyInput).toBeVisible({ timeout: 3_000 });
    await lineQtyInput.fill('3');

    // "Create Transfer" button must be present.
    const createBtn = page.locator('button:has-text("Create Transfer"), button:has-text("Buat")').first();
    await expect(createBtn).toBeVisible({ timeout: 3_000 });

    // Click Create Transfer to submit.
    await createBtn.click();

    // After submission, modal should close and table should remain visible.
    await expect(page.locator('.stock-transfers')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.stock-transfers-table')).toBeVisible({ timeout: 5_000 });

    // No error boundary.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });
});
