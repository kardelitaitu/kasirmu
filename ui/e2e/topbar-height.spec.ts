import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES, navigateTo } from './helpers';

/**
 * E2E + CSS contract: ONE top bar height.
 *
 * The settings hub's top bar and the staff management header are two different
 * sheets that must render the SAME bar height, linked only by `--topbar-height`
 * (tokens.css), DERIVED from `--touch-target-min`, `--space-2` vertical padding
 * and the 1px bottom border both bars carry — so a change to the touch floor
 * moves both bars together instead of desyncing them.
 *
 * Both halves are needed. The geometry half proves the value that actually
 * renders; the source half proves the token is still DERIVED rather than a
 * hand-written px literal that merely happens to match today.
 *
 * The resolved height is 59px, NOT the 61px a naive read of the token suggests:
 * `--space-2` is 0.5rem and the root font-size is 14px, so it is 7px, and
 * 44 + 2*7 + 1 = 59. Hence this file asserts RELATIONS, never a hardcoded
 * height — a magic number would be wrong the moment the root font-size or the
 * touch floor changes.
 */

// ESM: this spec is loaded as a module, so __dirname does not exist.
const uiRoot = fileURLToPath(new URL('..', import.meta.url));
const readUi = (relativePath: string): string => readFileSync(join(uiRoot, relativePath), 'utf8');

type BarMetrics = { height: number; minHeight: number };
const measure = (el: Element): BarMetrics => ({
  height: el.getBoundingClientRect().height,
  minHeight: getComputedStyle(el).minHeight,
});

test.describe('Top bar height — geometry', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    await selectWorkspace(page, WORKSPACES.ADMIN);
  });

  test('the settings top bar and the staff header render one height, governed by the token', async ({ page }) => {
    await navigateTo(page, 'settings');
    const settingsBar = page.locator('.settings-topbar');
    await expect(settingsBar).toBeVisible({ timeout: 10_000 });
    const settings = await settingsBar.evaluate(measure);

    await navigateTo(page, 'staff');
    const staffHeader = page.locator('.staff-mgmt-header');
    await expect(staffHeader).toBeVisible({ timeout: 10_000 });
    const staff = await staffHeader.evaluate(measure);

    const touchFloor = await page.evaluate(() =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--touch-target-min'),
      ),
    );
    const settingsMin = Number.parseFloat(settings.minHeight);
    const staffMin = Number.parseFloat(staff.minHeight);

    console.log(
      `topbar: settings=${settings.height}px (min ${settings.minHeight}) staff=${staff.height}px ` +
        `(min ${staff.minHeight}) floor=${touchFloor}px`,
    );

    // 1. One height across two independent sheets.
    expect(
      Math.abs(settings.height - staff.height),
      `settings ${settings.height}px vs staff ${staff.height}px`,
    ).toBeLessThan(0.5);

    // 2. The TOKEN governs both bars: each renders exactly its own min-height,
    //    so the content fits inside and the shared definition is what decides.
    expect(settings.height, 'the settings bar renders its min-height').toBeCloseTo(settingsMin, 1);
    expect(staff.height, 'the staff header renders its min-height').toBeCloseTo(staffMin, 1);
    expect(settingsMin, 'both bars take their min-height from the same token').toBeCloseTo(staffMin, 1);

    // 3. The bar can host the tallest mandatory child (the documented touch floor).
    expect(settingsMin, 'the bar must be at least as tall as the touch floor').toBeGreaterThanOrEqual(touchFloor);
  });
});

test.describe('Top bar height — CSS contract', () => {
  test('the token is DERIVED from the touch floor and declared exactly once', () => {
    const tokens = readUi('src/theme/tokens.css');

    const declarations = tokens.match(/--topbar-height\s*:/g) ?? [];
    expect(declarations, '--topbar-height must be declared exactly once').toHaveLength(1);
    expect(tokens, '--topbar-height must be derived from the touch floor, not a literal').toMatch(
      /--topbar-height:\s*calc\(\s*var\(--touch-target-min\)\s*\+\s*2\s*\*\s*var\(--space-2\)\s*\+\s*1px\s*\)/,
    );

    for (const [sheet, selector] of [
      ['src/features/settings/SettingsPage.css', '.settings-topbar'],
      ['src/features/staff/StaffManagementScreen.css', '.staff-mgmt-header'],
    ] as const) {
      const css = readUi(sheet);
      const body = css.slice(css.indexOf(`${selector} {`));
      expect(body, `${selector} must consume var(--topbar-height)`).toContain(
        'min-height: var(--topbar-height)',
      );
    }
  });
});
