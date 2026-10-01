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

    expect(await coveredControls(page), 'a control visible on the settings route is covered by the memo stack').toEqual([]);
  });
});
