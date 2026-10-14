import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: Product Management — Hard Assertions (E2E-16 through E2E-19)
 *
 * Tests the inventory product management screen with deterministic
 * assertions. All `if` guards removed — tests hard-fail on regressions.
 *
 * Dev-mock returns 18 products (MOCK_PRODUCTS in tauri-api.ts).
 *
 * CSS contract (ProductManagementScreen.tsx):
 *   .product-mgmt               — container
 *   .product-mgmt-table         — product table
 *   .product-mgmt-cell-sku      — SKU cell
 *   .product-mgmt-cell-price    — price cell
 *   .product-mgmt-header-actions — header with Add Product button
 *   .product-mgmt-overlay       — create/edit modal backdrop
 *   .product-mgmt-modal         — modal panel
 *   .product-mgmt-input         — form text/number inputs
 *   #product-field-sku          — SKU input
 *   #product-field-name         — name input
 *   #product-field-price        — price input
 */

test.describe('Product Management', () => {
  // ⚠️ EVERY test below is `test.fixme`, and as of round 146 none of them can be enabled.
  //
  // They drive `ProductManagementScreen`, which is ARCHIVED: `features/products/register.tsx:18-22`
  // says *"ARCHIVED: 'inventory' route ... no longer registered as a navigable route"*, and the
  // ONLY import of that component anywhere in `ui/src` is its own unit test. The selectors below
  // (`.product-mgmt`, `.product-mgmt-table`, `.product-mgmt-cell-sku`) survive in
  // `VariantManagementScreen.tsx:170/207/261` — a CHILD of the archived page — so they resolve in
  // the source and not in a running app.
  //
  // `selectWorkspace(page, WORKSPACES.INVENTORY)` lands on the warehouse workspace, which now
  // mounts `WarehouseScreen`. So `page.waitForSelector('.product-mgmt')` would time out rather
  // than assert anything.
  //
  // Re-pointing these at the live screen, or deleting them, is a decision for whoever owns the
  // products surface — see `docs/records/audits/archived-product-screen-still-graded.md`, which
  // records the three questions to answer first. Left in place so the intent is not lost.

  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    await selectWorkspace(page, WORKSPACES.INVENTORY);
  });

  // ── E2E-16: Assert product list loads ──────────────────────

  test.fixme('product list loads with at least 1 row', async ({ page }) => {
    // Wait for product management container.
    await page.waitForSelector('.product-mgmt', { timeout: 10_000 });

    // Product table must have at least 1 data row (dev-mock returns 18).
    const rows = page.locator('.product-mgmt-table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 5_000 });

    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // ── E2E-17: Assert product content is correct ──────────────

  test.fixme('product table contains expected mock products', async ({ page }) => {
    await page.waitForSelector('.product-mgmt', { timeout: 10_000 });

    // First product should be "AMD Ryzen 7 7800X3D" (SKU: CPU-R7-7800X3D).
    const firstSku = page.locator('.product-mgmt-cell-sku').first();
    await expect(firstSku).toBeVisible({ timeout: 5_000 });
    await expect(firstSku).toHaveText('CPU-R7-7800X3D');

    // Table should contain product names from the mock.
    const tableText = await page.locator('.product-mgmt-table').textContent();
    expect(tableText).toContain('Ryzen 7');
    expect(tableText).toContain('Core i7');
  });

  // ── E2E-18: Open create product modal ─────────────────────

  test.fixme('opens create product modal with form fields', async ({ page }) => {
    await page.waitForSelector('.product-mgmt', { timeout: 10_000 });

    // Click "Add Product" button.
    const addBtn = page.locator('button:has-text("Add Product"), button:has-text("Tambah")');
    await addBtn.click();

    // Modal must appear.
    const modal = page.locator('.product-mgmt-overlay');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Modal must contain form inputs: SKU, name, price.
    const skuInput = page.locator('#product-field-sku');
    const nameInput = page.locator('#product-field-name');
    const priceInput = page.locator('#product-field-price');

    await expect(skuInput).toBeVisible();
    await expect(nameInput).toBeVisible();
    await expect(priceInput).toBeVisible();

    // Cancel button must dismiss the modal.
    const cancelBtn = page.locator('button:has-text("Cancel"), button:has-text("Batal")');
    await cancelBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
  });

  // ── Bonus: Edit product opens modal with pre-filled data ────

  test.fixme('edit product opens modal with pre-filled fields', async ({ page }) => {
    await page.waitForSelector('.product-mgmt', { timeout: 10_000 });

    // Wait for product table rows.
    const rows = page.locator('.product-mgmt-table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 5_000 });

    // Click "Edit" on the first product row.
    const editBtn = page.locator('.product-mgmt-action-btn').filter({ hasText: 'Edit' }).first();
    await editBtn.click();

    // Edit modal must appear.
    await expect(page.locator('.product-mgmt-overlay')).toBeVisible({ timeout: 5_000 });

    // SKU field must be disabled (editing mode).
    const skuInput = page.locator('#product-field-sku');
    await expect(skuInput).toBeDisabled();

    // Name field must be pre-filled.
    const nameInput = page.locator('#product-field-name');
    const nameValue = await nameInput.inputValue();
    expect(nameValue.length).toBeGreaterThan(0);

    // Close the modal.
    await page.locator('button:has-text("Cancel"), button:has-text("Batal")').click();
    await expect(page.locator('.product-mgmt-overlay')).not.toBeVisible({ timeout: 5_000 });
  });

  // ── E2E-19: Create product form validation ────────────────

  test.fixme('create form shows disabled save when fields are empty', async ({ page }) => {
    await page.waitForSelector('.product-mgmt', { timeout: 10_000 });

    // Open create modal.
    const addBtn = page.locator('button:has-text("Add Product"), button:has-text("Tambah")');
    await addBtn.click();
    await expect(page.locator('.product-mgmt-overlay')).toBeVisible({ timeout: 5_000 });

    // Save/Create button must be disabled when SKU and name are empty.
    const saveBtn = page.locator(
      '.product-mgmt-modal-actions button:has-text("Create"), .product-mgmt-modal-actions button:has-text("Save")',
    ).first();

    // The button should be disabled (no SKU, no name).
    await expect(saveBtn).toBeDisabled({ timeout: 3_000 });

    // Fill in required fields.
    await page.locator('#product-field-sku').fill('TEST-SKU');
    await page.locator('#product-field-name').fill('Test Product');
    await page.locator('#product-field-price').fill('500');

    // Button should now be enabled.
    await expect(saveBtn).toBeEnabled({ timeout: 2_000 });
  });
});
