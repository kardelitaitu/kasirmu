/**
 * @file eodReportExportPermissionDrift.test.ts
 * @description KNOWN HAZARD, pinned — the EOD-report route is armed one
 * permission weaker than the command its screen calls.
 *
 * The two tokens, as measured at commit c85bae9ef:
 *   · front end arms the screen on  `reports:view`   — ui/src/features/sales/register.tsx:48
 *       registerPage({ route: 'eod-report', …, requiredPermission: 'reports:view' })
 *   · the command refuses without   `reports:export` — apps/tablet-client/src/commands/history.rs:428
 *       (export_eod_report_scoped → require_permission_for_user(…, permissions::REPORTS_EXPORT);
 *        the daily-summary twin at :380 and the sales-by-hour twin at :404 check the SAME constant)
 *
 * BOTH DECLARATIONS, not one: the screen is armed twice in that file — the page
 * gate at register.tsx:48 and the nav-item gate at :49-57 (token on :53) — and
 * both say reports:view, so this pin covers the second declaration rather than
 * resolving the hazard; flipping one and not the other is a half-fix and goes
 * red here.
 *
 * The role that makes it user-visible, also measured, not inferred:
 * platform/core/src/rbac_presets.rs — `Auditor` (builtin_roles::AUDITOR, the permission list at
 * :266) holds REPORTS_VIEW and does NOT hold REPORTS_EXPORT. Manager (:81-83) and Admin
 * (:195-197) hold both, so only Auditor sees the mismatch. An Auditor can OPEN
 * `/eod-report` and then cannot use the one action on it — the export at
 * ui/src/features/sales/EodReportScreen.tsx:402 — and gets a refusal instead of a
 * button. Same class as the Stripe pill fixed in e15ae8a93: a control the session
 * holding the narrower token cannot make work.
 *
 * WHY THIS IS A PIN AND NOT A FIX. Arming the route on reports:export makes the
 * WHOLE screen vanish for a session that can today open it — a navigation change,
 * which is a morning owner decision, not a five-thirty one. The other shape,
 * button-granular gating, needs a new primitive: the registry carries
 * requiredPermission on pages and on widgets and at nothing finer. So this file
 * makes the mismatch VISIBLE and fails if either half moves alone.
 *
 * INVERT, DO NOT DELETE. If the route token and the command token ever agree,
 * every known_hazard_* case below goes red — that is the resolution being
 * announced, and the fix is to INVERT each into a drift_pin asserting they stay
 * equal (the screen may never again be armed below its own command). Deleting a
 * red known_hazard_ case hides the half-fix that caused it. Nothing here changes
 * runtime behaviour: no import of the module under test, no page registration,
 * no gate. Read the sources, report what they say.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Repo root, found by walking up until both anchor files exist — never anchored
 * to a checkout path, and not via `import.meta.url`: under this suite's jsdom
 * environment that URL is not a `file:` scheme, so `fileURLToPath` rejects it.
 */
function findRoot(): string {
  const markers = ['ui/src/features/sales/register.tsx', 'apps/tablet-client/src/commands/history.rs'];
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (markers.every((m) => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the repo root from ' + process.cwd());
}

const ROOT = findRoot();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const REGISTER_TSX = 'ui/src/features/sales/register.tsx';
const EOD_SCREEN = 'ui/src/features/sales/EodReportScreen.tsx';
const API_SALES = 'ui/src/api/sales.ts';
const TABLET_HISTORY = 'apps/tablet-client/src/commands/history.rs';
const RBAC = 'platform/core/src/rbac.rs';
const PRESETS = 'platform/core/src/rbac_presets.rs';

/** The registerPage(...) call that declares `route: '<name>'`. */
function registerCall(src: string, route: string): string {
  const at = src.indexOf(`route: '${route}'`);
  if (at < 0) throw new Error(`no registerPage for route '${route}' — the declaration moved`);
  const start = src.lastIndexOf('registerPage(', at);
  const end = src.indexOf('});', at);
  return src.slice(start < 0 ? at : start, end < 0 ? at + 400 : end);
}

/**
 * Every declaration that arms one route - a screen is declared TWICE here: once
 * as a page (registerPage, the route gate) and once as a nav item
 * (registerNavItem, the entry point), each carrying its own
 * requiredPermission. For eod-report both say reports:view - register.tsx:48 is
 * the page declaration, :49-57 the nav item with the token on :53 - so this
 * returns EVERY block rather than the first one: arming the page while
 * forgetting the nav item, or the reverse, is a half-fix that reads as whole.
 */
function declarationsFor(src: string, route: string): { kind: string; block: string }[] {
  const needle = "route: '" + route + "'";
  const found: { kind: string; block: string }[] = [];
  for (let at = src.indexOf(needle); at >= 0; at = src.indexOf(needle, at + 1)) {
    const pageAt = src.lastIndexOf('registerPage(', at);
    const navAt = src.lastIndexOf('registerNavItem(', at);
    const isNav = navAt > pageAt;
    const start = isNav ? navAt : pageAt;
    const end = src.indexOf('});', at);
    found.push({
      kind: isNav ? 'registerNavItem' : 'registerPage',
      block: src.slice(start < 0 ? at : start, end < 0 ? at + 400 : end),
    });
  }
  return found;
}

const armToken = (block: string): string | undefined =>
  /requiredPermission: '([^']+)'/.exec(block)?.[1];

/** The body of a Rust `pub async fn <name>(`, up to its closing brace at column 0. */
function rustFn(src: string, name: string): string {
  const sig = `pub async fn ${name}(`;
  const at = src.indexOf(sig);
  if (at < 0) throw new Error(`${name} no longer exists in that file`);
  const rest = src.slice(at);
  const end = rest.indexOf('\n}');
  return end < 0 ? rest : rest.slice(0, end);
}

/** Resolve a permissions::CONST to its wire string AT THE PRODUCER (rbac.rs). */
function tokenOf(constName: string): string {
  const m = new RegExp('pub const ' + constName + ': &str = "([^"]+)"').exec(read(RBAC));
  const token = m?.[1];
  if (!token) throw new Error(`permissions::${constName} is no longer declared in ${RBAC}`);
  return token;
}

/** The permission constant a scoped export command actually checks, or null. */
function checkedPermission(fnName: string): string | null {
  const m = /permissions::([A-Z_]+)/.exec(
    rustFn(read(TABLET_HISTORY), fnName).match(/require_permission_for_user\([^)]*\)/)?.[0] ?? '',
  );
  return m?.[1] ?? null;
}

/** The permission constants one built-in role preset holds. */
function presetGrants(presetIdConst: string): string[] {
  const src = read(PRESETS);
  const at = src.indexOf(`id: builtin_roles::${presetIdConst},`);
  if (at < 0) throw new Error(`preset ${presetIdConst} is gone from ${PRESETS}`);
  const list = src.slice(src.indexOf('permissions: &[', at), src.indexOf('],', src.indexOf('permissions: &[', at)));
  return [...list.matchAll(/permissions::([A-Z_]+)/g)].map((m) => m[1] ?? '');
}

describe('EOD-report arm token vs the export command gate', () => {
  it('known_hazard_route_is_armed_one_permission_weaker_than_its_own_command', () => {
    const uiCall = registerCall(read(REGISTER_TSX), 'eod-report');
    const uiToken = /requiredPermission: '([^']+)'/.exec(uiCall)?.[1];
    const gate = checkedPermission('export_eod_report_scoped');

    expect(gate, 'export_eod_report_scoped must still name a permission gate').not.toBeNull();
    // Today, exactly:
    expect(uiToken).toBe(tokenOf('REPORTS_VIEW'));
    expect(gate).toBe('REPORTS_EXPORT');
    // The hazard itself: the two halves do not match, and the route is the
    // weaker of the two — so the screen opens for a session the command refuses.
    expect(uiToken).not.toBe(tokenOf(gate!));
    expect(tokenOf(gate!)).toBe('reports:export');
  });

  it('known_hazard_all_three_export_commands_share_the_refusing_token', () => {
    for (const fn of ['export_daily_summary_scoped', 'export_sales_by_hour_scoped', 'export_eod_report_scoped']) {
      expect(checkedPermission(fn), `${fn} no longer gates on REPORTS_EXPORT`).toBe('REPORTS_EXPORT');
    }
  });

  it('known_hazard_both_declarations_of_the_surface_carry_the_same_view_token', () => {
    // The route gate and the nav gate are two declarations of one screen, and
    // tonight only the first was attributed. Both arm reports:view, so both
    // stand in front of the same export-gated command, and a fix that flips one
    // and not the other leaves the entry point and the gate disagreeing. This
    // case covers the SECOND declaration; it resolves nothing.
    const decls = declarationsFor(read(REGISTER_TSX), 'eod-report');
    const kinds = decls.map((d) => d.kind).sort();
    expect(kinds, 'eod-report must still be declared as both a page and a nav item').toEqual([
      'registerNavItem',
      'registerPage',
    ]);
    const tokens = decls.map((d) => armToken(d.block));
    expect(tokens).toEqual([tokenOf('REPORTS_VIEW'), tokenOf('REPORTS_VIEW')]);
    const gate = checkedPermission('export_eod_report_scoped');
    for (const t of tokens) {
      expect(t, `a declaration of eod-report was armed on ${t}, not the measured view token`).not.toBe(
        tokenOf(gate!),
      );
    }
  });

  it('auditor_holds_reports_view_without_reports_export_measured_not_inferred', () => {
    const auditor = presetGrants('AUDITOR');
    expect(auditor).toContain('REPORTS_VIEW');
    expect(auditor, 'Auditor gained reports:export — the hazard above is now a refusal it can hit').not.toContain('REPORTS_EXPORT');
    // The two roles that can use the screen whole, for the record.
    expect(presetGrants('MANAGER')).toContain('REPORTS_EXPORT');
    expect(presetGrants('ADMIN')).toContain('REPORTS_EXPORT');
  });

  it('the_screen_really_reaches_the_command_through_the_named_wrapper', () => {
    // If this goes red the mismatch has moved, not disappeared: either the
    // screen stopped exporting, or the wrapper was repointed at another command.
    const screen = read(EOD_SCREEN);
    expect(screen).toContain('exportEodReportScoped');
    const api = read(API_SALES);
    const wrapper = /exportEodReportScoped[\s\S]{0,200}?loggedInvoke<[^>]*>\('([a-z_]+)'/.exec(api);
    expect(wrapper?.[1]).toBe('export_eod_report_scoped');
  });

  it('tokens_are_resolved_at_the_producer_not_retyped_here', () => {
    expect(tokenOf('REPORTS_VIEW')).toBe('reports:view');
    expect(tokenOf('REPORTS_EXPORT')).toBe('reports:export');
    expect(tokenOf('REPORTS_VIEW')).not.toBe(tokenOf('REPORTS_EXPORT'));
  });
});
