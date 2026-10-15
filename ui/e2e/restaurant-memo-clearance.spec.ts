import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// THE SPECIFICATION, written before the CSS it will grade.
//
// Rounds 249-253 produced five records that disagree with each other, because each measured a
// different thing: a mid-transition page (249), a reverted change (250), the rail's skeleton
// (251), a scroll-end position (252), and a 6px residual at one profile (253). Round 253 named
// the remedy: **state what must be true, assert it at BOTH profiles, and let the CSS answer to
// it.** This file is that statement.
//
// THE PROPERTY: with the memo stack present and a surface's CONTENT loaded, no interactive
// control in the surface's scrollable region may have its CENTRE hit-test to a memo node.
//
// Two clauses that rounds 249-253 each got wrong, and are therefore made explicit here:
//
//   1. CONTENT-LOADED. `toBeVisible()` on a container proves nothing about its height when the
//      children that give it height arrive later (round 251 measured a 128px skeleton and
//      withdrew a real defect). Each assertion waits for a named control, not a wrapper.
//   2. AT REST. An operator meets the screen at the initial scroll position. A clearance rule
//      that only lifts a control once the page has been scrolled to its end (rounds 248, 252)
//      does not satisfy this and must not pass it.
//
// Measured stack geometry, 2 bubbles pending (`p0.0.41`): desktop 1366x768 -> y 610..747, h 137;
// tablet 1024x1366 -> y 1141..1282, h 141. The 215px constant the existing rules use is the
// THREE-bubble height, so both over-reserve and neither closes the gap.

const TIMEOUT = 20_000;

/** Controls whose centre hit-tests to a memo node, at the current scroll position. */
async function occludedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const stack = document.querySelector('.memo-stack');
    if (!stack) return [];
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('button, input, select'))) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
      // ⚠️ A CONTROL CLIPPED BY ITS OWN SCROLL CONTAINER IS NOT OCCLUDED. `getBoundingClientRect`
      // reports LAYOUT positions, including for a button scrolled out of a `overflow-y: auto` box —
      // measured 2026-10-15: the rail's last three categories sit at y 649/696/744 while its own box
      // ends at 614, and all three hit-tested to the stack below it. They are not covered; they are
      // outside their container, and an operator scrolls the rail to reach them.
      //
      // Only a control inside every clipping ancestor's box can be occluded by anything.
      let clipped = false;
      for (let n = el.parentElement; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue;
        const nr = n.getBoundingClientRect();
        if (r.top >= nr.bottom - 1 || r.bottom <= nr.top + 1) { clipped = true; break; }
      }
      if (clipped) continue;
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!t) continue;
      const cls = String((t as HTMLElement).className);
      if (!cls.includes('memo-')) continue;
      // The stack's own dismiss control hit-testing to itself is correct, not a finding.
      const id = el.getAttribute('data-testid');
      if (id === 'memo-banner-open') continue;
      out.push(id || (el.textContent || el.tagName).trim().slice(0, 30));
    }
    return out;
  });
}

async function openSurface(page: Page, row: string, anchor: string): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  const sb = page.locator('.restaurant-sidebar-btn');
  if ((await sb.count()) > 0) await sb.first().click();
  const item = page.locator('[data-testid="restaurant-sidebar-' + row + '"]');
  if ((await item.count()) > 0) await item.click();
  // CLAUSE 1: wait for CONTENT, then let layout settle.
  await expect(page.locator('[data-testid="' + anchor + '"]').first()).toBeVisible({
    timeout: TIMEOUT,
  });
  await page.waitForTimeout(1200);
  // CLAUSE 2: assert at the initial scroll position. Nothing here scrolls.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (el.scrollTop > 0) el.scrollTop = 0;
    }
  });
  await page.waitForTimeout(400);
}

test('the kitchen chit button is clear of the memo stack on the receipts screen', async ({
  page,
}) => {
  await openSurface(page, 'receipts', 'restaurant-receipts-preview-test-chit-btn');

  // Round 248's rule reserves the stack's height on the scroller, which lifts these only at the
  // scroll END. This asserts what an operator meets, and expects the rule to answer for it.
  const occluded = await occludedControls(page);
  expect(
    occluded.filter((id) => id.includes('receipts')),
    'receipts controls must be clear of the memo stack at rest',
  ).toEqual([]);
});

test('the category rail controls are clear of the memo stack', async ({ page }) => {
  await openSurface(page, 'menu-editor', 'restaurant-menu-editor-cat-edit-cat-snack');

  const occluded = await occludedControls(page);
  expect(
    occluded.filter((id) => id.includes('menu-editor')),
    'menu editor controls must be clear of the memo stack at rest',
  ).toEqual([]);
});