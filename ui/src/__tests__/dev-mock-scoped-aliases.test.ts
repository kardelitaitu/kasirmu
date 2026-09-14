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

import { readFileSync, readdirSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';
import { handlers } from '@/dev-mock/core/mockDispatcher';

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

// ── Registry integrity over the REAL registry (moved-set review) ───────────
//
// The static review of b27fad9ba said registration order cannot invert today and
// named this the highest value-per-line gap: applyScopedAliases() is the last
// statement in tauri-api.ts, every moved key has one registration site, the pass
// skips any name ending in _scoped (core/mockDispatcher.ts:85) and writes a twin
// only while it is absent (:91). True — and covered by nothing: the cases above
// drive invoke() and assert only "a handler answered", which a SHADOWED twin also
// satisfies. These cases read the registry object itself (the same module instance
// tauri-api.ts populates) and the source it is built from.


const REGISTRY_DIR = normalize(join(__dirname, '..', 'dev-mock'));
const ENTRY_FILE = 'tauri-api.ts';
const registrySources: string[] = [
  ENTRY_FILE,
  ...readdirSync(REGISTRY_DIR + "/handlers").filter((f) => f.endsWith(".ts")).map((f) => "handlers/" + f),
];

interface Site { readonly name: string; readonly file: string; readonly line: number }

const SITES: Site[] = (() => {
  const out: Site[] = [];
  for (const rel of registrySources) {
    const text = readFileSync(REGISTRY_DIR + "/" + rel, "utf8");
    text.split(/\r?\n/).forEach((raw, i) => {
      // Command names are not all bare snake_case: the updater plugin lane
      // registers 'plugin:updater|check', and a narrower class silently loses it.
      const key = /^\s*'([A-Za-z0-9_|:.-]+)'\s*:/.exec(raw);
      const patch = /^\s*handlers\[.([A-Za-z0-9_|:.-]+).\]\s*=/.exec(raw);
      const name = key?.[1] ?? patch?.[1];
      if (name) out.push({ name, file: rel, line: i + 1 });
    });
  }
  return out;
})();

const PASS_LINE = readFileSync(REGISTRY_DIR + "/" + ENTRY_FILE, "utf8")
  .split(/\r?\n/).findIndex((l) => /^applyScopedAliases\(\);/.test(l)) + 1;

// Only names the registry actually carries. The literal scan also trips over seed
// object keys like '12h' and '30d', which are not commands.
const REGISTERED = new Set(Object.keys(handlers));
const COMMAND_SITES = SITES.filter((s) => REGISTERED.has(s.name));

const siteNames = COMMAND_SITES.map((s) => s.name);
const explicitTwins = new Set(siteNames.filter((n) => n.endsWith("_scoped")));
const bases = [...new Set(siteNames.filter((n) => !n.endsWith("_scoped")))];
const synthesized = bases.filter((b) => !explicitTwins.has(b + "_scoped"));

describe("dev-mock registry alias integrity (real registry, not a fixture)", () => {
  it("the source scan is faithful to the runtime registry", () => {
    // If this stops matching, the parser drifted from the registry and every
    // identity case below has quietly become vacuous.
    const expected = [...explicitTwins, ...bases, ...synthesized.map((b) => b + "_scoped")].sort();
    const actual = Object.keys(handlers).sort();
    // Set equality, not an arithmetic count: a parser that stops seeing a
    // registration names it here instead of cancelling out in a total.
    expect(expected).toEqual(actual);
    expect(actual.length).toBeGreaterThan(500);
  });

  it("every command has exactly ONE registration site", () => {
    const seen = new Map<string, string[]>();
    for (const s of SITES) seen.set(s.name, [...(seen.get(s.name) ?? []), s.file + ":" + s.line]);
    const doubled = [...seen.entries()].filter(([, where]) => where.length > 1)
      .map(([n, w]) => n + " @ " + w.join(" + "));
    // A second site for one name is not a compile error and not a warn: the later
    // Object.assign wins and the first handler becomes dead code that still reads
    // as live in the file it lives in.
    expect(doubled).toEqual([]);
  });

  it("applyScopedAliases() runs after every registration in the entry file", () => {
    const entrySites = SITES.filter((s) => s.file === ENTRY_FILE);
    const late = entrySites.filter((s) => s.line > PASS_LINE)
      .map((s) => s.name + " @ :" + s.line + " > pass :" + PASS_LINE);
    // The pass sees only what exists when it runs; a base registered after it gets
    // no twin, and the api layer calls the twin.
    expect(late).toEqual([]);
    expect(PASS_LINE).toBeGreaterThan(Math.max(...entrySites.map((s) => s.line)));
  });

  it("every base has a twin in the registry — no name is left unaliased", () => {
    const missing = bases.filter((b) => handlers[b + "_scoped"] === undefined).map((b) => b + "_scoped");
    expect(missing).toEqual([]);
  });

  it("every twin the rule synthesized IS the base function object", () => {
    // Identity, not "answers something": the rule copies the reference
    // (handlers[scoped] = twin, mockDispatcher.ts:92), so a twin that is a DIFFERENT
    // object came from somewhere other than the rule.
    const divergent = synthesized.filter((b) => handlers[b + "_scoped"] !== handlers[b]).map((b) => b + "_scoped");
    expect(divergent).toEqual([]);
    expect(synthesized.length).toBeGreaterThan(100);
  });

  it("the explicitly registered settings twins were NOT overwritten", () => {
    // Re-measured, not copied: handlers/settings.ts carries 8 explicit _scoped twins
    // (:52 :56 :63 :70 :72 :79 :83 :93), reaching the registry through the
    // ...settingsHandlers spread at :538 and registerHandlers(settingsWriteHandlers)
    // at :810. The :485 license spread carries no _scoped key at all.
    const settingsTwins = SITES.filter((s) => s.file === "handlers/settings.ts" && s.name.endsWith("_scoped"))
      .map((s) => s.name).sort();
    expect(settingsTwins).toEqual([
      "get_receipt_settings_scoped", "get_store_settings_scoped", "set_credit_settings_scoped",
      "set_hardware_settings_scoped", "set_receipt_settings_scoped", "set_setting_scoped",
      "set_settings_scoped", "set_store_settings_scoped",
    ]);

    // An overwritten twin would BE the base function object — the exact failure the
    // handlers[scoped] === undefined guard at mockDispatcher.ts:91 prevents.
    const clobbered = settingsTwins.filter((t) => handlers[t] === handlers[t.slice(0, -"_scoped".length)]);
    expect(clobbered).toEqual([]);
  });

  it("a twin kept by the guard answers its OWN stub, not the base", async () => {
    // Behavioural face of the case above: set_setting answers true (settings.ts:91),
    // set_setting_scoped answers null (:72). Had the alias clobbered the twin, both
    // would answer true.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const unscoped = await invoke<unknown>("set_setting", { key: "k", value: "v", userId: "u" });
      const twin = await invoke<unknown>("set_setting_scoped", { sessionToken: "t", key: "k", value: "v" });
      expect(unscoped).toBe(true);
      expect(twin).toBeNull();
    } finally {
      log.mockRestore();
    }
  });
});

