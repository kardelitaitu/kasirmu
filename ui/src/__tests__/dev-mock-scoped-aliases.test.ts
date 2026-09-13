// ── Dev-mock scoped-name aliasing ─────────────────────────────────
//
// The ADR #7 migration moved the api layer to the `_scoped` spelling of commands
// while the dev-mock kept registering the unscoped names. The mock had a curated
// SCOPED_ALIASES list — 34 pairs, not the 7 visible at the top of it, a count an
// earlier draft of this comment got wrong by reading only the first block — rather
// than a rule, so every scoped command outside that list fell through to
// `return null` with a console.warn. The list is now deleted in favour of the rule.
//
// That is the exact defect invokeCoverage.ts documents for hand-written mock chains
// (R36-02): the component swallows the null, the test still passes, and the
// assertion is quietly about the failure state instead of the data path. Measured on
// the tree, 217 calls across 4 commands were landing there -- including
// get_hardware_settings_scoped, which the terminal-hardware hook began calling in
// 1fbcc8a0, so ~78 test invocations were exercising the catch-and-default branch
// while the tests read as if the DTO had loaded.
//
// These pin the general policy, not just the four names that happened to be caught.

import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

// The four that were observed unhandled on the current tree.
const OBSERVED = [
  'get_hardware_settings_scoped',
  'list_displays_scoped',
  'offline_queue_status_summary_scoped',
  'get_setting_scoped',
];

// A pair outside the curated SCOPED_ALIASES list whose base IS registered, so passing
// it proves the fix is a rule rather than more hand-added entries. If a future change
// reverts to a curated list, this is the case that fails. One earlier draft of this
// control was wrong: get_brand_settings_scoped
// is registered directly -- it passed against the broken code and proved nothing.
// 115 such gaps exist on the current tree; this asserts one.
const UNLISTED_CONTROL = 'check_license_status_scoped';

// Every pair the curated SCOPED_ALIASES list used to hold, transcribed before it was
// deleted. These are the regression net for that deletion: they passed via the list
// before, and must pass via the general rule after. All are of the form
// (X_scoped, X) with X registered -- verified, not assumed -- which is what lets the
// rule subsume them. Two of them (set_settings_scoped, update_kds_order_items_scoped)
// also carry a direct stub, so they additionally pin that the rule does not clobber an
// explicit handler: the curated loop ran before the stubs and the stub overwrote it,
// while the rule runs last and skips them. Same end state, different path.
// (The seven store-profile pairs were removed with the commands themselves when the
// Store → Location alias family retired — todo-global-saas-1.md slice 1c/1d.)
const FORMERLY_CURATED = [
  'get_daily_revenue_scoped', 'get_weekly_revenue_scoped', 'get_monthly_revenue_scoped',
  'get_top_products_scoped', 'get_category_popularity_scoped', 'get_category_popularity_trend_scoped',
  'get_category_forecast_scoped', 'get_hourly_heatmap_scoped', 'get_category_breakdown_scoped',
  'get_menu_engineering_scoped', 'build_custom_report_scoped', 'get_low_stock_alerts_scoped',
  'create_stock_count_scoped', 'get_stock_count_scoped', 'list_stock_counts_scoped',
  'get_count_lines_scoped', 'add_count_line_scoped', 'update_count_line_scoped',
  'remove_count_line_scoped', 'complete_stock_count_scoped', 'update_stock_count_status_scoped',
  'create_category_scoped', 'update_category_scoped', 'delete_category_scoped',
  'create_customer_scoped', 'update_customer_scoped', 'delete_customer_scoped',
];

async function resolvesToData(cmd: string) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const value = await invoke(cmd, { sessionToken: 'preview-token' });
    const unhandled = warn.mock.calls.some((c) =>
      String(c[0] ?? '').includes('Unhandled command'));
    return { value, unhandled };
  } finally {
    warn.mockRestore();
    log.mockRestore();
  }
}

describe('dev-mock scoped command aliasing', () => {
  it.each(OBSERVED)('%s is answered from its unscoped twin, not null', async (cmd) => {
    const { value, unhandled } = await resolvesToData(cmd);
    // The warn is the load-bearing assertion: a handler that legitimately returns null
    // would pass `value !== null` by accident of nothing else.
    expect(unhandled).toBe(false);
    expect(value).not.toBeNull();
  });

  it('aliases any scoped name whose base is registered, not just a curated list', async () => {
    // Asserts only that a handler was found: the policy guarantees aliasing, not that
    // every base returns non-null. Requiring data here would test the base's stub, not
    // the rule.
    const { unhandled } = await resolvesToData(UNLISTED_CONTROL);
    expect(unhandled).toBe(false);
  });

  it('still warns for a scoped command with no twin anywhere', async () => {
    // The rule must not become "answer everything": a genuinely unknown command has to
    // stay loud, which is the whole point of the dev-mock's warn.
    const { unhandled } = await resolvesToData('this_command_does_not_exist_scoped');
    expect(unhandled).toBe(true);
  });

  it.each(FORMERLY_CURATED)(
    'general rule covers formerly-curated %s',
    async (cmd) => {
      // Only "a handler was found" is asserted. Several of these bases legitimately
      // return null -- 'get_stock_count' and 'delete_category' are literally
      // `() => null` in the mock -- so asserting data would conflate "aliased" with
      // "returns something", and the rule guarantees only the first. That mistake made
      // six of these thirty-four fail on the first run, against unmodified code.
      const { unhandled } = await resolvesToData(cmd);
      expect(unhandled).toBe(false);
    },
  );
});
