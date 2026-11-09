import { test, expect } from '@playwright/test';

/**
 * E2E: Tablet Shell Entry (TAB-04)
 *
 * Exercises the REAL tablet entry point (`index.mobile.html` → `main.mobile.tsx`
 * → `TabletAppShell`), unlike `tablet-viewport.spec.ts` which only resized the
 * desktop app's viewport. The shared Vite dev server serves multi-page HTML,
 * so the tablet entry is reachable at `/index.mobile.html` on the same origin.
 *
 * Checks:
 *   - The tablet shell boots (login screen renders)
 *   - No horizontal overflow on the tablet viewport (1024×1366)
 *   - Touch targets are >= 44px on the tablet login screen
 */

test.describe('Tablet Shell Entry (index.mobile.html)', () => {
  test('boots the tablet entry and renders the login screen', async ({ page }) => {
    await page.goto('/index.mobile.html');
    await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });
    await expect(page.locator('.staff-login-screen')).toBeVisible();
  });

  test('no horizontal overflow on the tablet entry', async ({ page }) => {
    await page.goto('/index.mobile.html');
    await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });

    // Viewport-relative: this spec runs in both the desktop (1366px) and
    // tablet (1024px) Playwright projects, so a hardcoded 1024 would fail
    // the desktop run even with zero overflow.
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
  });

  test('touch targets are at least 44px on the tablet entry', async ({ page }) => {
    await page.goto('/index.mobile.html');
    await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });

    const usernameInput = page.locator('.staff-login-input');
    await expect(usernameInput).toBeVisible();
    const inputBox = await usernameInput.boundingBox();
    expect(inputBox).not.toBeNull();
    if (inputBox) {
      // Math.round: getBoundingClientRect can report 43.99997 for a 44px
      // target due to sub-pixel rendering — the CSS-px target is what matters.
      expect(Math.round(inputBox.height)).toBeGreaterThanOrEqual(44);
    }

    // The 44px touch-target rule is scoped to coarse pointers
    // (StaffLoginScreen.css:379). This spec runs in BOTH projects, so key the
    // requirement off the ACTUAL pointer rather than the project name; each
    // branch is a hard assertion.
    const submitBtn = page.locator('.staff-login-submit-btn');
    const btnBox = await submitBtn.boundingBox();
    expect(btnBox).not.toBeNull();
    const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
    if (coarse) {
      expect(Math.round(btnBox!.height)).toBeGreaterThanOrEqual(44);
    } else {
      // Fine pointer: the documented floor is the 40px base rule.
      expect(Math.round(btnBox!.height)).toBeGreaterThanOrEqual(40);
    }
  });

  test('login + workspace picker work on the tablet entry', async ({ page }) => {
    await page.goto('/index.mobile.html');
    await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });

    await page.locator('.staff-login-input').fill('owner');
    await page.locator('.staff-login-submit-btn').click();
    await page.locator('.staff-login-pad').waitFor({ state: 'visible', timeout: 10_000 });

    for (const digit of '1234') {
      await page.locator('.staff-login-pad-key').filter({ hasText: digit }).click();
      await page.waitForTimeout(80);
    }

    await page.waitForSelector('.workspace-home', { timeout: 15_000 });
    await expect(page.locator('.workspace-home')).toBeVisible();

    // Viewport-relative: this spec runs in both the desktop (1366px) and
    // tablet (1024px) Playwright projects, so a hardcoded 1024 would fail
    // the desktop run even with zero overflow.
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
  });

  /**
   * The POS in the TABLET shell — the surface this file previously stopped short of.
   *
   * Everything above ends at the login screen or the workspace picker, so the till itself
   * had never been driven through `index.mobile.html`. That matters here more than
   * anywhere else: the tablet entry is a DIFFERENT shell (`main.mobile.tsx` ->
   * `TabletAppShell`), and the restaurant POS reaches it through a path the desktop never
   * exercises.
   *
   * WHY NO `.tablet-shell` ASSERTION. The wrapper class is absent on this route BY DESIGN
   * and asserting it would be wrong: `main.mobile.tsx:27-35` states that fullscreen routes
   * "render outside TabletAppLayout, so they never carry its `.tablet-shell` class", which
   * is exactly why the shell also sets `document.documentElement.dataset.shell = 'tablet'`
   * as the reliable marker. That marker IS asserted below, and the restaurant CSS keys off
   * neither: its four `.tablet-shell` mentions are all inside comments
   * (RestaurantCartSheet.css:93-95, RestaurantFloatingCartBar.css:195-210).
   *
   * Measured 2026-10-17 on the tablet project (1024x1366): 27 menu cards, the portrait
   * floating cart bar rather than the inline cart, no error boundary, no page errors, and
   * the bar inside the viewport at y 1306-1355 with `--memo-bottom-inset` resolving to the
   * tab-bar clearance.
   */
  test('the restaurant POS runs inside the tablet shell', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto('/index.mobile.html');
    await page.waitForSelector('.staff-login-screen', { timeout: 20_000 });
    await page.locator('.staff-login-input').fill('owner');
    await page.locator('.staff-login-submit-btn').click();
    await page.locator('.staff-login-pad').waitFor({ state: 'visible', timeout: 10_000 });
    for (const digit of '1234') {
      await page.locator('.staff-login-pad-key').filter({ hasText: digit }).click();
      await page.waitForTimeout(80);
    }
    await page.waitForSelector('.workspace-home', { timeout: 15_000 });

    // The tablet marker, which IS the shell contract for fullscreen routes.
    expect(await page.evaluate(() => document.documentElement.dataset['shell'])).toBe('tablet');

    const restaurantCard = page
      .locator('[data-testid="workspace-card"]')
      .filter({ hasText: /restaurant/i })
      .first();
    await expect(restaurantCard, 'the picker must offer the restaurant workspace').toBeVisible({
      timeout: 10_000,
    });
    await restaurantCard.click();

    // The menu must populate — the grid is the till's reason to exist.
    await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('.restaurant-card').count()).toBeGreaterThan(1);

    // CART SURFACE IS ORIENTATION-DEPENDENT, not project-dependent — and this spec runs in
    // BOTH projects, so the branch is keyed off the measured viewport exactly as the
    // touch-target case above is keyed off the measured pointer. Portrait (1024x1366 in the
    // tablet project) puts the cart in the floating bottom bar; landscape (1366x768 in the
    // desktop project) renders it inline. Asserting the portrait shape unconditionally is
    // what made the first version of this case fail on desktop.
    const isPortrait = await page.evaluate(() => window.innerHeight > window.innerWidth);
    const bar = page.locator('.restaurant-floating-cart-trigger');
    if (isPortrait) {
      await expect(bar, 'portrait must use the floating cart bar').toBeVisible({ timeout: 8_000 });
      await expect(page.locator('.pos-cart-panel'), 'and not an inline panel').toHaveCount(0);

      // The bar must sit inside the viewport, clear of the tab bar.
      const box = await bar.boundingBox();
      const viewport = page.viewportSize();
      expect(box, 'the floating cart bar needs a box').not.toBeNull();
      expect(viewport).not.toBeNull();
      if (box && viewport) {
        expect(box.y, 'the bar must not be pushed above the top edge').toBeGreaterThanOrEqual(0);
        expect(
          Math.round(box.y + box.height),
          'the bar must not overflow the bottom edge',
        ).toBeLessThanOrEqual(viewport.height + 1);
      }
    } else {
      await expect(page.locator('.restaurant-card').first()).toBeVisible();
      await expect(bar, 'landscape renders the cart inline instead').toHaveCount(0);
    }

    // Nothing on this screen may be past the edge or under the 44px touch floor.
    const audit = await page.evaluate(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const small: string[] = [];
      const off: string[] = [];
      document.querySelectorAll('button,[role=button]').forEach((el) => {
        const h = el as HTMLElement;
        const r = h.getBoundingClientRect();
        if (!r.width || !r.height) return;
        if (h.offsetParent === null && getComputedStyle(h).position !== 'fixed') return;
        let scrollable = false;
        let n: HTMLElement | null = h.parentElement;
        while (n && n !== document.body) {
          const c = getComputedStyle(n);
          if ((c.overflowY === 'auto' || c.overflowY === 'scroll') && n.scrollHeight > n.clientHeight) { scrollable = true; break; }
          if ((c.overflowX === 'auto' || c.overflowX === 'scroll') && n.scrollWidth > n.clientWidth) { scrollable = true; break; }
          n = n.parentElement;
        }
        const cls = (h.className || '').toString().slice(0, 40);
        if ((r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) && !scrollable) off.push(cls);
        if (r.width < 44 || r.height < 44) small.push(cls + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      return { small, off };
    });
    expect(audit.off, 'no control may be past the viewport with no scroll container').toEqual([]);

    // THE 44px FLOOR IS A COARSE-POINTER RULE, so it is keyed off the MEASURED pointer and
    // not the project name — the same branch this file's touch-target case already makes for
    // the login screen. The floor comes from the `@media (pointer: coarse)` catch-all
    // (theme/components.css:1455), so a fine-pointer run (the desktop project) is not
    // subject to it and asserting it there fails on controls that are deliberately compact
    // for a mouse. Measured 2026-10-17: the desktop project reports 12 controls under 44px,
    // every one of them on a fine pointer.
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      expect(audit.small, 'on a coarse pointer every control must meet the 44px floor').toEqual([]);
    } else {
      expect(audit.small, 'fine pointer: the 44px floor does not apply').toBeDefined();
    }

    // A throw in this shell would be caught by the boundary and hide the till.
    await expect(page.locator('.error-boundary__retry')).toHaveCount(0);
    expect(pageErrors, 'the tablet POS must not throw').toEqual([]);
  });
});
