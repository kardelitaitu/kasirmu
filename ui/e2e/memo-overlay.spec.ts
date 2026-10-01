import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES, navigateTo } from './helpers';

/**
 * E2E: the fixed memo stack must never cover a control the merchant can SEE.
 *
 * The stack is pointer-events: none, but .memo-banner-open re-enables it
 * (MemoBanner.css:247-266) because the bubble's whole body IS that one button, so
 * a bubble over a control makes it unclickable to a real user and Playwright
 * refuses the click as intercepted.
 *
 * THE CONTRACT: at the DEFAULT scroll position, no interactive element the merchant
 * can actually see may have something else on top of it.
 *
 * CAN SEE is the load-bearing qualifier, and it is where the earlier version of
 * this file was wrong. It tested only the VIEWPORT, so it reported nav rows at
 * y=526-685 as covered on a 768px desktop -- rows sitting 168px BELOW the bottom of
 * their own scroll container (the sidebar nav ends at 458, overflow-y auto). They
 * are scrolled out of the scrollport, clipped by it, and invisible. An element
 * clipped out of its own overflow box is not a defect, and counting it as one is
 * what made this gate red against a surface that is actually correct.
 * clippedByScrollport() below is the fix, and it is why this file tests the
 * sidebar at all.
 *
 * WHY IT TOOK SEVEN ROUNDS. Earlier formulations passed with the clearance REMOVED,
 * because mockMemos is module state whose acknowledgements persist
 * (dev-mock/handlers/locations.ts:105) and resetMockDatabase() EMPTIES the stack
 * rather than restoring it -- so no test could make its own precondition true. The
 * ?memos=N seam there is what made it measurable; read that comment before changing
 * it. sessionStorage is used rather than the query string because loginAs navigates
 * to plain '/', which drops a query string.
 *
 * The skip-to-content link is excluded BY CONSTRUCTION, not by name: its
 * clip: rect(0,0,0,0) clips painting only, so its 149x32 box still exists
 * geometrically under the topbar (AppLayout.css:518, tablet.css:280).
 *
 * READ THIS BEFORE TRUSTING IT - the premise moved (2026-10-01). This file was
 * built against the pre-wizard flow, where the tool grid reached the bottom of
 * the viewport and the stack covered it. `185bccb69` made provisioning a true
 * three-step wizard, which changed both surfaces' geometry, and the collision no
 * longer reproduces: with the clearance bands stashed this file passes 4/4. So at
 * HEAD it is a REGRESSION GUARD for a defect that is currently ABSENT, not proof
 * that the bands are load-bearing. The bands remain worth keeping - they are the
 * clearance this file asserts - but their necessity is now UNPROVEN, and a reader
 * who wants that answer should remove them and check rather than trust this file.
 */

const MEMO_COUNT_KEY = 'oz-dev-mock:memo-count';
const SEL = 'button, a[href], input, select, textarea, [role="tab"], [role="menuitem"]';

async function coveredControls(page: Page): Promise<{ text: string; hit: string }[]> {
  return page.evaluate((sel) => {
    const clippedByScrollport = (el: HTMLElement): boolean => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        const clipsY = cs.overflowY !== 'visible';
        const clipsX = cs.overflowX !== 'visible';
        if (!clipsY && !clipsX) continue;
        const r = p.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        if ((clipsY && (b.bottom <= r.top || b.top >= r.bottom)) || (clipsX && (b.right <= r.left || b.left >= r.right))) {
          return true;
        }
      }
      return false;
    };

    const out: { text: string; hit: string }[] = [];
    for (const el of Array.from(document.querySelectorAll(sel)) as HTMLElement[]) {
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      if (b.top < 0 || b.bottom > window.innerHeight) continue;
      if (clippedByScrollport(el)) continue;
      const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      if (!top || top === el || el.contains(top) || top.contains(el)) continue;
      const label = (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 30);
      if (/skip to main content/i.test(label)) continue;
      out.push({ text: label, hit: top.tagName + '.' + (top.className || '').toString().slice(0, 34) });
    }
    return out;
  }, SEL);
}

/** Seed an exact pending stack. MUST run before loginAs -- see the header. */
async function seedMemos(page: Page, count: number): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ([k, v]) => window.sessionStorage.setItem(k as string, String(v)),
    [MEMO_COUNT_KEY, count] as [string, number],
  );
  await loginAs(page, 'owner', '1234');
  await expect(
    page.locator('.memo-banner-open'),
    'the ?memos seam did not take -- this test would otherwise pass vacuously',
  ).toHaveCount(count, { timeout: 10_000 });
}

test.describe('Memo stack never covers a visible control', () => {
  test('the workspace picker keeps every tool card clickable', async ({ page }) => {
    await seedMemos(page, 3);
    await expect(page.getByTestId('workspace-home')).toBeVisible({ timeout: 15_000 });
    // The load-bearing one: this card is the ONLY route into the admin workspace
    // (WorkspaceHome.tsx filters type_key 'admin' out of the card grid).
    await expect(page.getByTestId('workspace-tool-card').filter({ hasText: /settings|pengaturan/i })).toHaveCount(1);

    expect(await coveredControls(page), 'a control visible in the picker is covered by the memo stack').toEqual([]);
  });

  test('the settings route keeps every control clickable', async ({ page }) => {
    await seedMemos(page, 3);
    await selectWorkspace(page, WORKSPACES.ADMIN);
    await navigateTo(page, 'settings');
    await page.waitForSelector('[data-testid="settings-sidebar"]', { timeout: 15_000 });
    await expect(page.locator('.settings-nav-item').filter({ hasText: 'System Diagnostics' })).toHaveCount(1);

    // A fixed settle, NOT expect.poll. Polling was tried here because the case
    // passed 2 of 4 on a --repeat-each=2 — and it removed the flake by removing
    // the assertion's teeth: with the clearance bands stashed, the polling version
    // passed 4/4. A test that passes with the fix removed is the false assurance
    // this file exists to avoid, so the strict single sample stands and the
    // instability is reported instead. The cause is a layout race: the bands are
    // gated on :has(.memo-stack) and the footer lays out when the stack arrives,
    // so the sample can read a pre-reflow frame.
    await page.waitForTimeout(500);

    expect(await coveredControls(page), 'a control visible on the settings route is covered by the memo stack').toEqual([]);
  });

  /**
   * The relation the clearance bands actually uphold: they RESERVE SCROLL ROOM for
   * the stack's strip. They do not lift the region above it.
   *
   * The hit-test cases above are census-shaped and can be green with every band
   * stashed -- measured 2026-10-01, all of them passed with the bands removed. So they
   * are a regression guard for the current layout, not proof the bands do work.
   *
   * An earlier version of this case asserted the stack sat BELOW the clearing region.
   * That is not what the band does: measured on 1366x768 with 3 bubbles, the stack is
   * y=538-747 and .workspace-home bottom=768, so the stack sits inside the region by
   * construction. It failed on both projects for the right reason -- it was measuring
   * the wrong relation, and that failure is what pointed at the right one.
   *
   * What the band buys is measurable and falsifiable: padding-bottom on the box that
   * SIZES a scroller adds the stack's strip to that scroller's range, so the LAST
   * rows can be scrolled into a clear strip. Without the band the range is short by
   * exactly that amount. That difference is what this case pins.
   *
   * BOTH surfaces are asserted. The picker half existed first and the settings half
   * was added the same round after a probe showed removing `.settings-body`'s band
   * still passed 6/6 -- one of the two surfaces this file covers was unguarded.
   */
  test('the clearance bands reserve scroll room for the memo stack strip', async ({ page }) => {
    await seedMemos(page, 3);

    /** padding on the given box vs the stack's measured height */
    const band = (selector: string) =>
      page.evaluate((sel) => {
        const stack = document.querySelector('.memo-stack');
        const box = document.querySelector(sel);
        if (!stack || !box) return null;
        return {
          strip: Math.round(stack.getBoundingClientRect().height),
          pad: parseFloat(getComputedStyle(box).paddingBottom) || 0,
        };
      }, selector);

    // Picker: .ws-main is the scroller; the band is on the box that sizes it.
    await expect(page.getByTestId('workspace-home')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    const picker = await band('.ws-main');
    expect(picker, 'the picker clearance band (.ws-main) was not found').not.toBeNull();
    expect(
      picker!.pad,
      `the picker's clearance band is ${picker!.pad}px but the memo stack is ${picker!.strip}px tall -- the WorkspaceHome.css band is gone, or shorter than the strip it reserves`,
    ).toBeGreaterThanOrEqual(picker!.strip);

    // Settings: .settings-body sizes the sidebar and content scrollers, so its
    // padding-bottom is the band there.
    await selectWorkspace(page, WORKSPACES.ADMIN);
    await navigateTo(page, 'settings');
    await page.waitForSelector('[data-testid="settings-sidebar"]', { timeout: 15_000 });
    await page.waitForTimeout(500);
    const settings = await band('.settings-body');
    expect(settings, 'the settings clearance band (.settings-body) was not found').not.toBeNull();
    expect(
      settings!.pad,
      `the settings clearance band is ${settings!.pad}px but the memo stack is ${settings!.strip}px tall -- the SettingsNavTree.css band is gone, or shorter than the strip it reserves`,
    ).toBeGreaterThanOrEqual(settings!.strip);
  });
});



