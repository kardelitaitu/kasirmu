// ── Screen CSS extraction integrity tests ─────────────────────────
//
// SCOPE — read this before quoting a green run. This is a
// REGISTRATION guard over an explicit list, NOT a sweep of the tree.
// Each of the three checks below runs once per entry in the SCREENS
// array and reads only the files THAT ENTRY names: `tsx` plus
// `additionalTsx` for the used-class walk, `css` for the
// defined-rule walk. There is no readdir, no glob, no default entry.
// A screen that is not registered here is invisible to all three
// checks — it cannot fail, so it cannot be counted as clean.
//
// One case breaks that rule, deliberately: `stylesheet coverage` near the
// foot of this file DOES readdir, and its whole question is "did anyone
// claim this sheet?" — it walks the tree only to ask whether a path is
// named, never what any class in it means. Every assertion ABOUT a class
// still reads only the files an entry names.
//
// The same limit is stated in the plan this file serves, at
// todo-refactor-kds-agents-merged.md:121, and the contrast it draws
// there is the one a reader needs next to the mechanism:
//
//   `screenExtraction.test.ts` is a **REGISTRATION** guard — it checks
//   only the files a screen's `additionalTsx` list names. Skip the
//   step and it says NOTHING: the moved classes read as dead CSS while
//   the suite stays green. **SILENT failure mode**; the bullet above it
//   exists because of this one.
//   `nativeTooltipCompliance.test.ts` is an **AUTO-WALKING** guard —
//   `collectTsxFiles` at :47 sweeps every `.tsx` under `ui/src`, with
//   `__tests__` filtered at the call site (`:115`), so there is **no
//   registration step to forget**. A new file is caught on sight and
//   the run goes **LOUD** the moment markup moves. **The opposite
//   failure mode: it cannot be skipped, only answered.**
//
// Measured against this file, not against that sentence: SCREENS holds
// 83 entries while `find ui/src/features -name '*Screen.tsx' | wc -l`
// counts 66 *Screen.tsx files — and the two numbers are not even the
// same kind of thing, since several entries are modals, panels and
// shared placeholder sheets rather than screens. A large share of the
// tree is therefore read by none of the three checks. The cleanest
// statement of what that costs is the one this header used to be
// missing, and it is now the statement that had to be RETIRED: the
// guard used to read none of the sales tender surface — every
// className used has a CSS rule, and the dead-class check alike —
// because sales/PaymentModal.tsx (1,912 lines) over
// sales/PaymentModal.css (1,165 lines) was unregistered. It is
// registered now, with its five tender panels, and the note in the
// Sales section records what the two findings were and which commits
// paid them off. The general point stands: a screen not listed here is
// invisible to all three checks, so it cannot fail and cannot be clean.
//
// CASE ARITHMETIC, so the total is never read as code health. Keep the
// FORM, never a substitution of it:
//     cases = (3 x entries) + (4 extractor self-tests) + (2 coverage-block cases)
// Substitute the LIVE entry count, because the total is a property of
// this list and moves with it — quoting a number instead of a formula
// made SIX lines of this header go stale three times in one night —
// 61/188/54 before 101b4869e, 65/200/50 after it, 66/203/49 after
// 902e07678, 83/255/27 after 319a18e41, 83/255/26 after 338c15c01, and 84/258/25 after 1adf4ba6c, and 85/261/24 after 79466dc63, and 86/264/23 as of this edit: (3 x 86) + 4 + 2 = 264,
// which is what the run reads. If a total is quoted anywhere in this
// file, it is a dated observation and the form above is the truth. The
// number
// moves when the LIST moves and never when the tree's CSS health changes:
// a registration adds three green cases whether or not anything got
// better. Read the entry count for coverage and the failures for health.
// Coverage-block cases are the exception to the 3x, and they are fixed in
// number: the block is TWO cases over the whole tree, whatever they grow to
// CHECK. The first case carries three structural assertions now — an uncited
// stylesheet, a parentCss path that escapes src/features without naming a
// theme sheet, and a BASELINE_UNCITED line that is paid-off or a ghost — and
// the second enforces that a citation earns its place. A case count is not a
// claim-count; adding a check to either one moves nothing in the 3x formula. The
// total stops being a health signal in exactly one direction and starts
// carrying a named failure in the other.
//
// For each REGISTERED entry we assert:
//   1. Every className used in its TSX has a CSS rule defined  (HARD)
//   2. No className is duplicated across its CSS files         (HARD)
//   3. No dead classes (CSS rule with no reference in the walked
//      TSX) — reported via `expect.soft`, and soft is soft in NAME
//      only: a soft failure still fails the run.
//
// Add a new screen by appending an entry to the SCREENS array below;
// when markup moves OUT of a registered screen, append the receiving
// component to that entry's `additionalTsx` in the same change-set and
// prove the line is load-bearing by deleting it and re-running (see
// todo-refactor-kds-agents-merged.md:115).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  extractClassSelectors,
  extractUsedClassNames,
  resolveComposedClassNames,
} from './screenExtraction.utils';

// ── File layout ───────────────────────────────────────────────────
// This test lives at  ui/src/__tests__/screenExtraction.test.ts
// Screens + CSS live at ui/src/features/*/

const FEATURES_DIR = path.resolve(process.cwd(), 'src', 'features');

interface ScreenEntry {
  /** Display name for the test suite (e.g. "ProductLookupScreen"). */
  name: string;
  /** Path to the TSX file, relative to src/features/. */
  tsx: string;
  /** Path(s) to companion CSS files, relative to src/features/. */
  css: string[];
  /**
   * Shared "parent" stylesheets this entry INHERITS from but does not own
   * — a sheet a whole family of entries cites, e.g. the settings scaffolds'
   * `screens/screens-placeholder.css`.
   *
   * The two directions are deliberately NOT symmetric: the used-vs-defined
   * check resolves against `css` UNION `parentCss`, while the duplicate check
   * and the dead-class check keep walking `css` ALONE. Why, at the two maps
   * in the runner below.
   *
   * Paths are relative to src/features/, same as `css` — with ONE widened
   * exception, and it is narrow on purpose: a sheet that lives OUTSIDE
   * src/features but is loaded GLOBALLY may be named as
   * `../frontend/themes/<sheet>.css`, and nothing else may ever appear
   * there. So `parentCss` has exactly two legal shapes — a sheet this
   * family of entries inherits inside src/features (e.g.
   * `settings/SettingsPage.css`, cited by the four settings cards), or a
   * theme sheet both shells import. `../frontend/themes/components.css`
   * is the live case for the second shape: it defines `.sr-only` at :1492
   * and `.skeleton` at :1296, and is imported by BOTH entry points
   * (main.tsx:7 desktop, main.tablet.tsx:20 tablet), so those utilities
   * really are provided at the element the class sits on.
   *
   * Before that exception, the only way to keep a global utility from
   * failing case 1 was to mute it in `knownDynamicFragments` — which
   * asserts the name is COMPOSED AT RUNTIME. For `sr-only` that is false,
   * and the false claim then travels into case 3: a muted name is never
   * reported dead anywhere. Citing the sheet that defines it says what is
   * true instead, and says it in a field the guard can check.
   *
   * Why only case 1 may reach out: cases 2 and 3 still walk `css` ALONE
   * (the two maps in the runner below), so a theme sheet is never graded
   * for duplicate or dead rules through the entry that cites it — grading
   * 219 globally shared classes once per citing entry is how a shared
   * sheet becomes unsatisfiable, which is the same reason a parent's own
   * honesty belongs to its owner and not to its children.
   *
   * The exception is policed, not trusted: the guard reads no import edge
   * at all, so the prefix rule and the "the cited sheet must actually
   * define what it is cited for" rule both live in the coverage block.
   */
  parentCss?: string[];
  /**
   * Class-name prefixes whose BEM‑like modifiers are constructed
   * at runtime via template literals or returned from helper
   * functions.  The static analysis cannot extract the full
   * modifier class names, so these prefixes are excluded from the
   * dead‑class check.
   *
   * Example: `['kds-column--', 'inv-adjust-stock--']`
   * would acknowledge classes like `kds-column--pending` and
   * `inv-adjust-stock--ok` as reachable at runtime even though
   * they never appear verbatim in the TSX source.
   */
  dynamicClassPrefixes?: string[];
  /**
   * Class names that are legitimately referenced in companion CSS
   * but belong to child / imported components rather than the
   * screen's own TSX. These are excluded from the dead‑class check.
   *
   * Example: `['card', 'tab-list']` for a page that uses a <Card>
   * component rendering a `.card` class internally.
   */
  externalClasses?: string[];
  /**
   * String values that the static `extractUsedClassNames` parser
   * falsely extracts as CSS class names because they appear inside
   * template-literal interpolations (e.g. `flashRows.has('backup')`).
   * Unlike `dynamicClassPrefixes` (which handles BEM-like dynamic
   * modifiers), these fragments are NOT real CSS classes — they are
   * function arguments, comparison values, or other string literals
   * that happen to look like class names to the regex parser.
   *
   * Entries here are excluded from the "used but not defined" check.
   */
  knownDynamicFragments?: string[];
  /**
   * Additional TSX files (beyond the primary `tsx` file) to scan for
   * used class names. Useful when a screen's inline JSX has been
   * extracted into sub-components that share the same CSS file.
   *
   * Paths are relative to src/features/, same as `tsx`.
   */
  additionalTsx?: string[];
  /**
   * Names that exist to be SELECTED and not styled — a class some ui/e2e spec
   * queries so a test can find an element, with no rule styling it anywhere.
   *
   * This is the one device in this file that is GRADED rather than believed.
   * `externalClasses`, `dynamicClassPrefixes` and `knownDynamicFragments` are all
   * taken on the author's word: nothing re-tests that the name really belongs to a
   * child component, that the prefix really composes, or that the string really is a
   * parser artifact — which is how a prefix can keep granting on a family the
   * extractor cannot even see. A name listed here must satisfy TWO static proofs,
   * both re-read from disk on every run, and a failure is reported against the ENTRY:
   *   1. a locator in ui/e2e/*.spec.ts reads `.name` — a `page.locator(...)` /
   *      `querySelector(...)` / `getByTestId(...)` line, so prose in a spec's header
   *      comment does not count;
   *   2. a production `.tsx`/`.ts` under the entry's OWN feature dir names it as a
   *      string literal, i.e. somebody really builds it.
   *
   * What it deliberately is NOT: it does not feed the used set (a name only a locator
   * reads stays invisible to `used`, which is why the array blindness this works
   * around stays pinned rather than quietly repaired); it exempts nothing from the
   * used-vs-defined report unless both proofs hold, and an unproven claim then simply
   * fails that report like any other missing name; and it never rescues a dead rule —
   * a declared name that DOES have a rule of its own is reported by the third case
   * below, because a rule whose only consumer is a locator is the thing worth deleting.
   */
  selectorOnlyClasses?: string[];
}

const SCREENS: ScreenEntry[] = [
  // ── Products ──────────────────────────────────────────
  {
    name: 'ProductLookupScreen',
    tsx: 'products/ProductLookupScreen.tsx',
    css: ['products/ProductLookupScreen.css'],
    // product-card--added and --disabled are not a foreign sheet's rules: this entry
    // composes them itself at features/products/ProductLookupScreen.tsx:496-497, where
    // cardClass gains ' product-card--disabled' when the product is out of stock and
    // ' product-card--added' when it was just added. One prefix states the composition
    // rule where two mutes stated two guesses about somebody else's sheet.
    // Both values struck 2026-09-16 · DSH · prefix-only waivers the widened matcher made empty:
    // each names a class its own sheet defines (ProductLookupScreen.css) and each is now reached
    // WITHOUT the mute -- resolveComposedClassNames composes product-card--added / --disabled from
    // the ternary sites, so neither appears in the walker's PREFIX-RESCUED list, which is the
    // membership proof (cd ui && npx vitest run src/__tests__/screenExtraction.test.ts 2>&1 | grep -c 'RESCUED  ProductLookupScreen' -> 0 before the strike and 0 after; the 18 RESCUED lines name KdsScreen x16 and FeatureToggleScreen x2, never this entry).
    // Nothing newly dead: DEAD stayed 0 pair(s). Seven values struck across three entries, so
    // graded 107 -> 100 and credited moved with it, 107 -> 100; inert and residual stayed 0.
    externalClasses: ['product-card'],
  },
  {
    name: 'ProductManagementScreen',
    tsx: 'products/ProductManagementScreen.tsx',
    css: ['products/ProductManagementScreen.css'],
    // Four variants exist, not an open family: the name is composed at
    // features/products/ProductManagementScreen.tsx:448 as
    // `product-mgmt-type--${p.productType}`, and productType is the closed union at
    // src/types/domain.ts:106 -- retail | restaurant | both | service -- which is exactly
    // the four rules in products/ProductManagementScreen.css:94 / :99 / :103 / :108. Each is
    // named whole, so this entry now asserts which variants are real: a fifth rule in the
    // sheet with no fifth union member reads dead instead of being excused by a catch-all.
    dynamicClassPrefixes: [
      'product-mgmt-type--retail',
      'product-mgmt-type--restaurant',
      'product-mgmt-type--both',
      'product-mgmt-type--service',
    ],
    // Classes used by child StockAlertPanel component rendered inside drawer
    externalClasses: ['stock-alert-panel'],
  },
  {
    name: 'BundleManagementScreen',
    tsx: 'products/BundleManagementScreen.tsx',
    css: ['products/BundleManagementScreen.css'],
  },

  // ── Staff ─────────────────────────────────────────────
  {
    name: 'StaffManagementScreen',
    tsx: 'staff/StaffManagementScreen.tsx',
    css: ['staff/StaffManagementScreen.css'],
    // The Agent 3 extraction moved the table/drawer/assignment JSX into
    // components/*.tsx; they share the screen's stylesheet (global classes).
    additionalTsx: [
      'staff/components/StaffListTable.tsx',
      'staff/components/StaffDetailDrawer.tsx',
      'staff/components/RoleAssignmentMatrix.tsx',
    ],
  },

  // ── Setup ─────────────────────────────────────────────
  {
    name: 'SetupWizard',
    tsx: 'setup/SetupWizard.tsx',
    css: ['setup/SetupWizard.css'],
  },

  // ── Customers ─────────────────────────────────────────
  {
    name: 'CustomerManagementScreen',
    tsx: 'customers/CustomerManagementScreen.tsx',
    css: ['customers/CustomerManagementScreen.css'],
  },

  // ── Inventory ─────────────────────────────────────────
  {
    name: 'InventoryAdjustmentScreen',
    tsx: 'inventory/InventoryAdjustmentScreen.tsx',
    css: ['inventory/InventoryAdjustmentScreen.css'],
    dynamicClassPrefixes: [ 'inv-adjust-stock--ok', 'inv-adjust-stock--low', 'inv-adjust-stock--out'],
  },

  // ── Auth ──────────────────────────────────────────────
  {
    name: 'StaffLoginScreen',
    tsx: 'auth/StaffLoginScreen.tsx',
    css: ['auth/StaffLoginScreen.css'],
    // 'staff-login-logo-img' and 'staff-login-card--pin' struck 2026-09-16 · DSH · both are WHOLE
    // names the markup spells verbatim, so `used` already carries them and the mute shields no
    // rule: the census printed 18 PREFIX-RESCUED names before this edit and 18 after, and
    // `grep -c 'RESCUED  StaffLoginScreen'` on that print is 0 both ways.
    // 'staff-login-logo--small' is the SAME class of empty waiver — the resolver composes it, so
    // it is not in the RESCUED set either — and it is KEPT anyway, for a stated reason rather than
    // by oversight: striking it would take graded to 99, under this arm's own magnitude floor of
    // 100, and the floor is not re-taken from inside a strike box. It is named here so the next
    // lane sees a documented hold, not a mute nobody looked at.
    // '--shake' stays on its own merit: a classList toggle the walker cannot reach at all.
    dynamicClassPrefixes: ['staff-login-logo--small', 'staff-login-card--shake'],
    // Cited, not muted: .skeleton is defined in frontend/themes/components.css:1296,
    // a sheet both entry points import (main.tsx:7, main.tablet.tsx:20). The mute
    // claimed a runtime-composed name; the cite says what is true.
    parentCss: ['../frontend/themes/components.css'],
    // These classes are defined in StaffLoginScreen.css but are used by the
    // StatusBar component (imported and rendered inside StaffLoginScreen).
    externalClasses: [
      'connection-status',
      'status-indicator',
      'checking',
      'online',
      'offline',
      'connection-label',
      'connection-latency',
    ],
  },

  // ── Audit ─────────────────────────────────────────────
  {
    name: 'AuditLogScreen',
    tsx: 'audit/AuditLogScreen.tsx',
    css: ['audit/AuditLogScreen.css'],
    dynamicClassPrefixes: [ 'audit-log-badge--success', 'audit-log-badge--failure', 'audit-log-badge--info'],
  },

  // ── Categories ────────────────────────────────────────
  {
    name: 'CategoryManagementScreen',
    tsx: 'categories/CategoryManagementScreen.tsx',
    css: ['categories/CategoryManagementScreen.css'],
  },

  // ── Currency ──────────────────────────────────────────
  {
    name: 'ExchangeRateScreen',
    tsx: 'currency/ExchangeRateScreen.tsx',
    css: ['currency/ExchangeRateScreen.css'],
  },

  // ── KDS ───────────────────────────────────────────────
  {
    name: 'KdsScreen',
    tsx: 'kds/KdsScreen.tsx',
    css: ['kds/KdsScreen.css', 'kds/KdsCompletedView.css', 'kds/components/ModifierBadge.css'],
    // Cited, not muted: .sr-only is defined in frontend/themes/components.css:1492
    // and that sheet is imported by both entry points (main.tsx:7, main.tablet.tsx:20),
    // so the class is provided to this screen. Case 1 resolves it here; cases 2 and 3
    // never grade the theme sheet through this entry.
    parentCss: ['../frontend/themes/components.css'],
    dynamicClassPrefixes: [
      // ── HEADER (rewritten 2026-09-16 · DSH) ── what the arm asserts is an IDENTITY, never a
      // size: graded = credited + inert + residual, and this line describes that identity as the
      // run prints it NOW — 100 graded = 100 credited + 0 inert + 0 residual, sum check 100=100,
      // the 100 the FLOOR asserts being a floor and not this line's business (it is asserted at
      // the foot of this file, with its own baseline literal, and is not stated here as a target).
      // Every term is zero-or-equal except graded/credited, which move together when a value is
      // struck. Re-derive instead of trusting this sentence:
      //   cd ui && npx vitest run src/__tests__/screenExtraction.test.ts 2>&1 | grep 'prefix arm arithmetic'
      // WHY a rewrite and not another dated line: this note read "108 graded = 107 credited +
      // 0 inert + 1 residual" — the state BEFORE fffc4672f struck 'kds-column--' — and the
      // residual term went FALSE in that very commit. It survived two later passes of this file
      // unnoticed because nothing asserts over a comment: a stale header is invisible to a suite
      // that never reads it, which is exactly how a count that is no longer true gets cited as if
      // it were. History stays below, labelled as history.
      //
      // 'kds-column--' STRUCK 2026-09-16 · DSH (fffc4672f) · the dated read at that strike was
      // 108 graded = 107 credited + 0 inert + 1 residual, the one residual printed as
      // `KdsScreen :: kds-column-- [own citation resolved to 441 class name(s) from 4 of 4
      // cited path(s) — citation resolved, so this is a site-only pass, NOT a lookup miss]`.
      // Read that label: a mute that credits NOTHING inside the entry's own reach and survives
      // only because some source string contains it. That is not a pass; it is the ledger
      // asserting a dynamic family that does not exist.
      //
      // Why it is fictional as a DYNAMIC prefix (three shapes checked, all three grepped):
      //   1. no template literal — `grep -rn 'kds-column' ui/src --include='*.tsx'` finds no
      //      `kds-column--${x}` anywhere. The names are written COMPLETE, as three whole
      //      string literals in one array: `const statusClasses = ['kds-column--pending',
      //      'kds-column--preparing', 'kds-column--ready']` at features/kds/KdsLayoutMasonry.tsx:74,
      //      reaching className by INDEX — `kds-col kds-column ${statusClasses[ci] ?? ''}` at :79.
      //      Nothing composes a modifier from a runtime value, so the field's own contract
      //      ("modifiers constructed at runtime via template literals or returned from helper
      //      functions") is false here. Same category as the struck 'gift-card-status--' in the
      //      GiftCardsScreen entry ("written COMPLETE in the id map... a mute that waives nothing
      //      is not a claim") and 'kds-main-pane--' in the REMOVED block of THIS entry ("both
      //      uses are complete static literals, not dynamic"). Named rather than line-numbered:
      //      this note moved every pointer below it by 45 lines.
      //   2. not a sheet-citation gap — 0 rules match it in ANY of the 170 index keys, not
      //      merely in the 4 this entry cites (re-derive: `grep -rn 'kds-column--' ui/src --include='*.css'`
      //      returns only the comment text at kds/KdsScreen.css:1801-1805). So `parentCss`
      //      cannot earn it and no cite can be added: there is nothing to cite.
      //   3. not a dist-only name either — the bundle hits are the Fluent ID `kds-column-count`
      //      and its message text, not a class.
      //
      // What it was excusing: nothing, in either direction. The dead-class census reads
      // PREFIX-RESCUED 18 names and not one of them is a kds-column--* name, because the
      // extractor cannot see a class arriving through an array index — blindness pinned on
      // purpose at screenExtraction.utils.test.ts:267-268 — so the three names never entered
      // `used` and never needed saving. Striking it therefore moves no finding. The counts that
      // box recorded — 270 passed, 2 pre-existing RestaurantMenu failures from another session's
      // uncommitted features/restaurant edits, outside this fence — are a DATED working-tree
      // reading, not a fact about any commit, and they are the other half of what went stale here:
      // the same scoped run on this tree now prints 272 passed and no failures, and no cause is
      // claimed for the delta. What witnesses the strike is membership, not either count: the
      // PREFIX-RESCUED set it cited, 18 names, is the same 18 names this file prints today, none
      // of them a kds-column--* name.
      //
      // Why NOT the "earn it" route: defining the three variants in KdsScreen.css would buy
      // the credit with empty rules. The sheet says the variants carry no extra visual rules
      // BY DESIGN (they exist so Playwright can query a status bucket), and the graded case
      // `no selectorOnlyClasses name is silently excusing a rule that still styles it` exists
      // to reject exactly that — so earning it here means fabricating CSS that asserts a
      // styling difference which does not exist. The honest record of these three names is
      // already present and GRADED below, in `selectorOnlyClasses`.
      //
      // Effect AT THAT COMMIT (dated read, superseded as live state by the header above):
      // graded 108 -> 107, credited stays 107, inert stays 0, residual 1 -> 0; sum check
      // 107 = 107 + 0 + 0. A credit gained by removing a debt would have left graded unchanged —
      // this is a removal. The chain from that read to the live one is 107 -> 100, every link a
      // strike of values the census never credited as a sole claim, and every link closed the
      // same way with inert and residual both still 0. 100 is the arithmetic result of those
      // strikes, not a target: the size that guards this population is the floor asserted at the
      // foot of this file, with its own baseline literal, and no line in this note moves it.
      // `kds-ticket kds-ticket--${level}` in KdsTicketCard.tsx:271.
      'kds-ticket',
      // Whole names, was the stem 'kds-workspace' (2026-09-15 · DSH): its 2 census
      // credits were .kds-workspace-header and .kds-workspace-back, and
      // git grep -rn kds-workspace -- ui/src names ONLY this sheet (:2134/:2141/:2149)
      // -- not AppShell.tsx, the stale claim that stood here before.
      'kds-workspace', 'kds-workspace-header', 'kds-workspace-back',
      // Was stem 'status--'. The composition that comment cited (KdsTicketCard.tsx:307) no longer names a bare status-- in any .tsx, so these 2 rules are the whole family and a third variant must read dead.
      'status--preparing', 'status--ready',
      // `kds-main-track active-${activeTab}` at components/KdsMainContent.tsx:127 -- the old pointer,
      // KdsScreen.tsx:627, is stale. Both real rules named whole, so a third variant reads dead:
      'active-open', 'active-completed',
      // REMOVED, with the orphaned rules they were hiding:
      //   'kds-shortcut-', 'kds-shortcuts-'  -- the shortcuts popover was deleted
      //     from the markup in ccc932c4; nothing in ui/src names either prefix, so
      //     these muted five unreachable rules. A prefix entry suppresses BOTH
      //     directions of the check, so one matching nothing is a permanent mute
      //     over that whole name family.
      //   'kds-history-card-status--' -- 0 CSS rules and 0 references outside
      //     this test file: an entry that outlived the code it excused.
      //   'kds-main-pane--' -- both uses are complete static literals, not
      //     dynamic, so this was the wrong category; and a28edfda added the CSS,
      //     so the classes are genuinely styled and need no exemption.
    ],
    externalClasses: [
      // `document.body.classList.toggle('no-anim', …)` at KdsScreen.tsx:127. A
      // body class is outside the component subtree the parser walks, and seven
      // rules are keyed on it.
      'no-anim',
      // REMOVED: 'leaving' and 'kds-moving' were listed as "defined in another
      // stylesheet", but both were defined in THIS one and applied by nothing --
      // the wrong category used to silence a real finding. `leaving` in
      // particular is a trap: a substring search returns 16 non-test hits, all of
      // them `const [leaving, setLeaving] = useState(false)` in
      // features/sales/PaymentModal.tsx plus prose, none of them a className.
    ],
    knownDynamicFragments: [ 'active-', // 2026-09-15 · DSH: the ONE live fragment here, from active-${activeTab} at components/KdsMainContent.tsx:127. 'status--' was tried and dropped: no .tsx composes a bare status-- (git grep -n status-- -- "ui/src/**/*.tsx" returns only longer families like po-status--/qris-status--/gift-card-status--), so shielding it would assert a composition that does not exist.
      'completed',
      'dark',
      'light',
      // Members of `useState<'all' | 'dinein' | 'takeaway'>` at
      // KdsScreen.tsx:111 -- TypeScript string-literal TYPES, never class names.
      'dinein',
      'takeaway',
      'active-',
      // `kds--${settings.density}` conditional density class.
      'compact',
      // Ternary COMPARISON values inside ModifierBadge.tsx's className
      // template (`tone === 'removal' ? ' kds-modifier-badge--removal' : …`).
      // The parser fishes every quoted string out of a className template,
      // so the bare tone names read as class names. Same category as the
      // 'dinein'/'takeaway' entries above: data, not selectors.
      'removal',
      'addition',
    ],
    additionalTsx: [
      'kds/KdsLayoutMasonry.tsx',
      'kds/components/KdsTicketCard.tsx',
      'kds/components/ModifierBadge.tsx',
      'kds/KdsCompletedView.tsx',
      'kds/KdsHamburgerPanel.tsx',
      'kds/KdsScreenFooter.tsx',
      // Slice 1: the four notice banners moved out of KdsScreen.tsx:967-1081.
      // All ten classes they use (kds-error-banner + text/retry/dismiss, and
      // kds-offline-banner with its storage/deadletter variants + text/retry/
      // dismiss) are still styled by kds/KdsScreen.css above, so this entry is
      // what keeps them reachable — without it the guard would call them dead.
      'kds/components/KdsNoticeBanners.tsx',
      'kds/components/KdsHeaderLeft.tsx',
      // Zone-chips slice: the three kds-zone-chip* classes moved out of
      // KdsScreen.tsx:818-847 into components/KdsZoneChips.tsx. They are still
      // styled by kds/KdsScreen.css, which this entry already lists, so this
      // line is what keeps them reachable — drop it and the guard reads all
      // three as dead CSS while every other suite stays green.
      'kds/components/KdsZoneChips.tsx',
      'kds/components/KdsHeaderRight.tsx',
      // Phase 2.1 (Agent-2 plan, 2026-09-16): the line-item row and the SLA
      // time+urgent badge moved out of components/KdsTicketCard.tsx into
      // their own files. Their classes (kds-item*, kds-ticket-item-status*,
      // kds-ticket-modifiers; kds-ticket-time*, kds-ticket-urgent-badge)
      // remain styled by kds/KdsScreen.css — these two entries are what
      // keeps them reachable; drop either and the guard reads those classes
      // as dead CSS with every behaviour suite still green.
      'kds/components/KdsTicketLineItem.tsx',
      'kds/components/KdsTimerBadge.tsx',
      'kds/components/KdsHeaderTabs.tsx',
      'kds/components/KdsMainContent.tsx',
    ],
    // Three names that exist ONLY to be selected: string literals in the
    // `statusClasses` array at features/kds/KdsLayoutMasonry.tsx:74, read back as
    // `.kds-column--pending` at e2e/e2e-kds-critical-path.spec.ts:75, --preparing at
    // :96 and --ready at :107, and asserted via toHaveClass at
    // KdsLayoutMasonry.test.tsx:116-118. No rule anywhere styles them — the only CSS
    // text is the comment at features/kds/KdsScreen.css:1801-1805 saying they carry no
    // extra visual difference. They are invisible to the used-vs-defined report today
    // because the extractor cannot see an array index (the blindness
    // `still does not see a class that arrives through an array variable` pins on
    // purpose), which is why the `kds-column--` entry that used to stand in
    // dynamicClassPrefixes above was STRUCK rather than left granting on a family nothing
    // can see (the full measurement is on the strike note there). This declaration is its
    // replacement, and it needed no extractor change to be the replacement: it grades the
    // two things that are already true — a locator reads the name, a production literal
    // builds it — which is the whole claim the mute was making on trust. Graded, not
    // believed: drop any one of these three names and the
    // locator half or the markup half reports it against this entry.
    selectorOnlyClasses: ['kds-column--pending', 'kds-column--preparing', 'kds-column--ready'],
  },
  {
    name: 'ExpoScreen',
    tsx: 'kds/ExpoScreen.tsx',
    css: ['kds/ExpoScreen.css'],
    // The station selector shares the Expo sheet (global classes), same
    // arrangement the StaffManagementScreen/RestaurantMenu entries use.
    additionalTsx: [
      'kds/components/StationSelectorModal.tsx',
    ],
  },
  {
    // Routing-rules editor (todo-kds-agents-1 UI follow-up) — mounted by
    // KdsHamburgerPanel but styled entirely from its own sheet, so the
    // classes are checked against THIS entry, not the KdsScreen one.
    name: 'KdsRoutingRulesEditor',
    tsx: 'kds/components/KdsRoutingRulesEditor.tsx',
    css: ['kds/components/KdsRoutingRulesEditor.css'],
  },
  {
    // Product picker modal (498 lines of markup over a 490-line sheet) —
    // mounted by kds/KdsScreen.tsx:27,:544, so reachable, and a self-contained
    // closure like KdsRoutingRulesEditor above: it imports its own sheet at :8
    // and WALK A (entry alone, no additionalTsx) came back clean — 0 undefined,
    // 0 dead. No parentCss, no prefixes, no external classes, nothing muted.
    name: 'KdsProductPickerModal',
    tsx: 'kds/components/KdsProductPickerModal.tsx',
    css: ['kds/components/KdsProductPickerModal.css'],
  },

  // ── Loyalty ───────────────────────────────────────────
  {
    name: 'LoyaltyManagementScreen',
    tsx: 'loyalty/LoyaltyManagementScreen.tsx',
    css: ['loyalty/LoyaltyManagementScreen.css'],
    dynamicClassPrefixes: [ 'loyalty-txn-type--earn', 'loyalty-txn-type--redeem', 'loyalty-txn-type--adjust'],
  },

  // ── Offline ───────────────────────────────────────────
  {
    name: 'OfflineQueueScreen',
    tsx: 'offline/OfflineQueueScreen.tsx',
    css: ['offline/OfflineQueueScreen.css'],
    // Three complete names, not an open family: statusClass() returns exactly
    // 'status-pending', 'status-synced' and 'status-failed' at
    // features/offline/OfflineQueueScreen.tsx:43,:45,:47 and the sheet defines exactly
    // those three rules at offline/OfflineQueueScreen.css:380,:385,:390. The field read
    // ['status-'] until 2026-09-15 · DSH · and the census says it was excusing nothing:
    // this entry reports no prefix-rescued rule, because the resolver already reaches all
    // three through the sink at :534. What a bare prefix does instead of naming them is
    // grant on every future .status-* rule and on every used-but-undefined name that
    // begins with those seven characters -- and it never even reached the
    // offline-queue-status-* strings at :56,:58,:60,:62, which begin with 'offline-' and
    // are Fluent label ids rather than classes, so the shape was wrong in both
    // directions. A fourth variant in this sheet now reads dead instead of being waived.
    // All three struck 2026-09-16 · DSH · the same class of empty waiver. Each is a WHOLE class
    // name, not a prefix, and each is composed at a ternary the resolver now reaches -- so the
    // mute is not the only claim on any rule: the census printed 18 PREFIX-RESCUED names before
    // this edit and none of them is a status-* name (RESCUED  OfflineQueueScreen -> 0 lines),
    // and it prints 18 after. Nothing newly dead (DEAD stayed 0 pair(s)).
    knownDynamicFragments: ['free'],
  },

  // ── Promotions ────────────────────────────────────────
  {
    name: 'PromotionManagementScreen',
    tsx: 'promotions/PromotionManagementScreen.tsx',
    css: ['promotions/PromotionManagementScreen.css'],
  },

  // ── Settings ──────────────────────────────────────────
  {
    name: 'SettingsPage',
    tsx: 'settings/SettingsPage.tsx',
    css: ['settings/SettingsPage.css'],
    additionalTsx: [
      'settings/sections/GeneralSection.tsx',
      'settings/sections/AppearanceSection.tsx',
      'settings/sections/ReceiptSection.tsx',
      'settings/sections/SyncSection.tsx',
      'settings/sections/AboutSection.tsx',
      // SettingsFooter.tsx carries the settings-footer-* markup (theme switch,
      // version, Ctrl+S hint, date/clock), moved out of SettingsPage.tsx by the
      // settings lane footer slice; unregistered, the guard reads those six
      // classes as dead CSS.
      'settings/components/SettingsFooter.tsx',
      // SettingsTopbar.tsx carries the settings-topbar-* / settings-save-* markup (back
      // button, breadcrumb, search field, revert+save bar) plus the ContextMenu it
      // now owns; every one is styled by SettingsPage.css, so skipping this
      // registration reads nine of them as dead CSS (the other four are still
      // rendered by the page's loading-skeleton header).
      'settings/components/SettingsTopbar.tsx',
      // SettingsLoadChrome.tsx carries the loading-skeleton shell (the settings-topbar /
      // __col--brand / -icon / -name header mock and settings-loading-card) and the
      // fatal-load settings-error card, moved out of SettingsPage.tsx by the
      // settings lane's load-chrome slice. This registration is load-bearing in
      // the loud direction: with the markup gone from the page, dropping the line
      // fails the dead-class check on settings-loading, settings-loading-card and
      // settings-error (verified: 1 failed | 186 passed, exit 1).
      'settings/components/SettingsLoadChrome.tsx',
    ],
    knownDynamicFragments: [
      // Object-key strings inside template-literal interpolations that
      // the static class-name parser falsely extracts as CSS classes.
      'store-name',
      'address',
      'tax-id',
      'branch',
      'settings-sync-token-actions',
      'settings-sync-status-text',
      'topology',
      'free',
    ],
    // All three are composed at runtime by files THIS entry already walks -- SettingsPage
    // registers settings/components/SettingsTopbar.tsx and settings/sections/SyncSection.tsx
    // as additionalTsx -- yet they still never enter the used set, because each arrives as
    // the conditional tail of a template literal (SettingsTopbar.tsx:187 settings-save-dot
    // + --hidden, :193 settings-btn-revert + --hidden, SyncSection.tsx:333 settings-sync-dot
    // + --ok / --err by syncResult) and the extractor strips interpolations. So the claim
    // is composition inside this feature, not ownership by a foreign sheet: one prefix per
    // family, in the shape the badge modifiers took at 7e893bc2c.
    externalClasses: [
      'card',
      'tooltip-content',
      'feature-toggle',
      'data-mgmt',
      'staff-mgmt',
      'terminal-mgmt',
      'multi-store-dashboard',
      'audit-log',
      'offline-queue-screen',
      'shift-mgmt',
      'tax-config',
      'exchange-rate-config',
      'promo-mgmt',
      'mobile-open',
      'visible',
      'settings-topology-container',
      // Visibility-hidden modifier classes for revert button & save-dot.
      // These are constructed via template-literal class toggling in
      // SettingsPage.tsx, so the static parser can't extract them.
      // Sync status classes used in SettingsPage.tsx
    ],
    // These three modifiers are not another component's classes -- this entry's own
    // code composes them. features/settings/sections/SyncSection.tsx:296 renders one
    // span whose className is a single template literal emitting
    // `settings-sync-expiry-badge` plus `settings-sync-expiry-badge--` and an
    // interpolated tone, tone is a closed union of exactly good/warn/critical declared
    // at :22, produced by the ternary at :40-41 with the matching literals at :31, :35
    // and :51, and the three rules are real -- SettingsPage.css:1010, :1015, :1020. So
    // they were live-by-composition while sitting in a field whose stated warrant is
    // that the name belongs to ANOTHER sheet: the device for runtime composition is
    // dynamicClassPrefixes, and one value replaces three. The verdict does not change
    // tonight -- the extractor strips the interpolation and keeps only the base, which
    // means case 1 can never see the composed name and so can never flag it, while
    // case 3 sees three defined rules with no reference and needs SOME shield; any
    // shield states the wrong thing, and this is the one that can be checked by
    // deleting it.
    dynamicClassPrefixes: [ 'settings-sync-expiry-badge--good', 'settings-sync-expiry-badge--warn', 'settings-sync-expiry-badge--critical'],
  },
  {
    name: 'DataManagementScreen',
    tsx: 'settings/DataManagementScreen.tsx',
    css: ['settings/DataManagementScreen.css'],
    // BackupSection.tsx carries the data-mgmt-backup-* markup and its flash modifier,
    // moved out of the screen in DataManagement slice 3; unregistered, the guard
    // reads those classes as dead CSS.
    additionalTsx: ['settings/components/BackupSection.tsx', 'settings/components/ImportSection.tsx', 'settings/components/ExportSection.tsx'],
    // dynamicClassPrefixes: ['data-mgmt-toast--'] struck 2026-09-15 · DSH · an inert allowance, retired with evidence rather than quietly deleted: the family it muted was removed by f16c7ead5 (2026-07-09, 0 inserted / 38 deleted on settings/DataManagementScreen.css), and today 0 rules match it in 137 sheets and 0 composition sites exist in any walked source. The strings that survive as data-mgmt-toast-* in useBackupStatus.ts, useExportWizard.ts, useImportWizard.ts and settings.ftl are Fluent message IDs with ONE dash, not class names. Re-derive: git grep -n data-mgmt-toast-- -- ui/src ui/e2e (1 hit, this comment). Graded by the prefix arm at the foot of this file.
    knownDynamicFragments: [
      // Template-literal parameters inside flashRows.has() that the
      // static class-name parser falsely extracts as class names.
      'import-preview',
      'backup',
    ],
  },
  {
    name: 'FeatureToggleScreen',
    tsx: 'settings/FeatureToggleScreen.tsx',
    css: ['settings/FeatureToggleScreen.css'],
    dynamicClassPrefixes: [ 'feature-toggle-item', 'feature-toggle-item--flash-enabled', 'feature-toggle-item--flash-disabled', 'feature-toggle-checkmark--enabled', 'feature-toggle-checkmark--disabled' ], // 2026-09-15 · DSH: 'feature-toggle-item' stood here TWICE in one field -- a repeated value waives no extra rule and only made the field read wider than it is. What it hid: nothing. Both flash rules are named now (:258, :262 of FeatureToggleScreen.css), so the stem's 2 credits became 2 whole names and a third variant reads dead.
  },

  // ── Shifts ────────────────────────────────────────────
  {
    name: 'ShiftManagementScreen',
    tsx: 'shifts/ShiftManagementScreen.tsx',
    css: ['shifts/ShiftManagementScreen.css'],
    dynamicClassPrefixes: [ 'shift-mgmt-status-badge--open', 'shift-mgmt-status-badge--closed', 'shift-mgmt-close-info'],
  },

  {
    name: 'SettingsSelect',
    tsx: 'settings/SettingsSelect.tsx',
    css: ['settings/SettingsSelect.css'],
    // Cited, not muted: this component's markup uses .sr-only, which is defined in
    // frontend/themes/components.css:1492, a sheet both entry points import (main.tsx:7
    // desktop, main.tablet.tsx:20 tablet). It is not composed at runtime, so a
    // knownDynamicFragments entry here would assert something false and then hide the
    // name from case 3 forever. No additionalTsx either: all nine ssel-* names have
    // exactly one consumer, this component -- measured with the guard's own extractors,
    // dead-against-own 0, dead-against-features/settings 0, dead tree-wide 0 -- and
    // locations/TopologyScreen.tsx, the only other file that names the component at :28,
    // renders <SettingsSelect> at :747 and :918 without using a single ssel-* class.
    // A sibling that merely shares a surface is not what that field claims.
    parentCss: ['../frontend/themes/components.css'],
  },

  {
    name: 'DiagnosticsSection',
    tsx: 'settings/sections/DiagnosticsSection.tsx',
    css: ['settings/sections/DiagnosticsSection.css'],
    // Shape #1: this component's markup leans on the settings scaffold it renders
    // inside, and every leaner is backed. It uses 12 names, its own sheet defines 7,
    // and the 5 remaining -- settings-section-title (:90), settings-form (:94),
    // settings-hint (:95, :111) -- are defined at SettingsPage.css:514, :521 and :765
    // respectively, with settings-field and settings-field--horizontal both at :410.
    // No other sheet in src/ defines any of the five, so the cite is what check (iii)
    // asks for: a complete backing, not a partial one, and no name dropped into
    // externalClasses to dodge it (that field is filtered OUT of the leaner set, so a
    // name parked there is proved by nothing). Dead-rule check walks the sheet alone:
    // all 7 of its rules are referenced here, so 0 findings. The sibling row
    // The row this entry nearly refused for the wrong reasons is registered below, and
    // two of the three reasons given at 79466dc63 were mine and were wrong: server-status is
    // not a class but the argument of triggerFlash('server-status') at LicenseSettings.tsx:156
    // and :230, read back at :423 and :473 through flashRows.has('server-status') -- the parser
    // false positive knownDynamicFragments documents -- and the four settings-license-value--tier-
    // rules are not dead but composed at :352 and :478 in a template literal, which is what
    // dynamicClassPrefixes is for. Only the first reason stood: settings-license-row--warning
    // at :526 had no rule anywhere. A cite is all-or-nothing under check (iii), so the row could
    // not land on a partial backing and the sheet could not be cited for a name no sheet defines;
    // the define and the devices now land together, which is what paid it off.
    parentCss: ['settings/SettingsPage.css'],
  },

  {
    name: 'LicenseSettings',
    tsx: 'settings/LicenseSettings.tsx',
    css: ['settings/LicenseSettings.css'],
    // Shape #1 again, and it is complete: the component uses 31 names, its own sheet defines
    // 30 and 26 of those are the same, leaving 5 leaners -- settings-section-title (:288, :344),
    // settings-form (:345) and settings-error, at SettingsPage.css:514, :521 and :835. No other
    // sheet defines any of the three. The two that are not classes at all go to their own fields
    // rather than being muted into nothing: server-status is a flash-row KEY passed to
    // triggerFlash at :156 and :230 and compared at :423 and :473, never a selector, and
    // settings-license-value--tier-free/pro/premium/enterprise are built at :352 and :478 as
    // `settings-license-value--tier-${payload.tier_key}`, so the prefix is cited for what it is
    // and the four rules stay graded for every other name. The fifth leaner was real CSS debt:
    // settings-license-row--warning at :526 had no rule in this repo, so the row rendered
    // unstyled; it is defined in this sheet at :194 beside its sibling --status modifier, from
    // which it takes the single-declaration shape, and the register could not have landed without
    // that define because check (iii) grades a cite all-or-nothing.
    parentCss: ['settings/SettingsPage.css'],
    dynamicClassPrefixes: [ 'settings-license-value--tier-free', 'settings-license-value--tier-pro', 'settings-license-value--tier-premium', 'settings-license-value--tier-enterprise'], // settings-license-value--tier-plus struck 2026-09-15 · DSH · 0 rules (LicenseSettings.css defines -free/-pro/-premium/-enterprise at :244/:249/:254/:259) and 0 composition sites; the name is built as settings-license-value--tier- plus payload.tier_key, so if a plus tier is ever real the missing piece is the CSS rule, not this mute. Graded by the prefix arm at the foot of this file.
    knownDynamicFragments: ['server-status'],
  },

  // ── Locations (moved from stores/ in the Store→Location rename) ──
  {
    name: 'MultiStoreDashboardScreen',
    tsx: 'locations/MultiStoreDashboardScreen.tsx',
    css: ['locations/MultiStoreDashboardScreen.css'],
  },
  {
    name: 'TerminalStatusPanel',
    tsx: 'locations/TerminalStatusPanel.tsx',
    css: ['locations/TerminalStatusPanel.css'],
  },

  // ── Tables ────────────────────────────────────────────
  {
    name: 'TableManagementScreen',
    tsx: 'tables/TableManagementScreen.tsx',
    css: ['tables/TableManagementScreen.css'],
    dynamicClassPrefixes: [ 'tables-table--circle', 'tables-table--rectangle', 'tables-table--available', 'tables-table--occupied', 'tables-table--cleaning', 'tables-table--reserved'],
  },

  // ── Tax ───────────────────────────────────────────────
  {
    name: 'TaxConfigurationScreen',
    tsx: 'tax/TaxConfigurationScreen.tsx',
    css: ['tax/TaxConfigurationScreen.css'],
  },

  // ── Terminals ─────────────────────────────────────────
  {
    name: 'TerminalManagementScreen',
    tsx: 'terminals/TerminalManagementScreen.tsx',
    css: ['terminals/TerminalManagementScreen.css'],
  },

  // ── Workspaces ────────────────────────────────────────
  {
    name: 'WorkspaceHome',
    tsx: 'workspaces/WorkspaceHome.tsx',
    css: ['workspaces/WorkspaceHome.css'],
    // The ToolCard/ToolsCategoryGrid extraction (agents-2, 09-13): the
    // workspace-tool-* classes moved WITH the JSX into these children —
    // the styles still live in the screen's CSS, so the reachability
    // walk must read the children to see them.
    additionalTsx: [
      'workspaces/components/ToolsCategoryGrid.tsx',
      'workspaces/components/ToolCard.tsx',
    ],
    dynamicClassPrefixes: [ 'ws-color-admin', 'ws-color-kds', 'ws-color-restaurant-pos', 'ws-color-store-pos', 'ws-color-warehouse', 'role-badge--owner', 'role-badge--manager', 'role-badge--staff', 'role-badge--auditor', 'role-badge--custom', 'role-badge--default'],
    externalClasses: [
      'workspace-card--active',
      'workspace-card-ripple',
    ],
  },

  // ── Kiosk ─────────────────────────────────────────────
  {
    name: 'KioskScreen',
    tsx: 'kiosk/KioskScreen.tsx',
    css: ['kiosk/KioskScreen.css'],
  },

  // ── Sales (those with a single companion CSS) ─────────
  {
    name: 'SalesDashboardScreen',
    tsx: 'sales/SalesDashboardScreen.tsx',
    css: ['sales/SalesDashboardScreen.css'],
  },
  {
    name: 'SalesHistoryScreen',
    tsx: 'sales/SalesHistoryScreen.tsx',
    css: ['sales/SalesHistoryScreen.css'],
  },
  {
    name: 'VoidOrdersScreen',
    tsx: 'sales/VoidOrdersScreen.tsx',
    css: ['sales/VoidOrdersScreen.css'],
  },
  {
    name: 'EodReportScreen',
    tsx: 'sales/EodReportScreen.tsx',
    css: ['sales/EodReportScreen.css'],
  },
  {
    name: 'RefundModal',
    tsx: 'sales/RefundModal.tsx',
    css: ['sales/RefundModal.css'],
  },
  {
    name: 'PriceOverrideModal',
    tsx: 'sales/PriceOverrideModal.tsx',
    css: ['sales/PriceOverrideModal.css'],
    dynamicClassPrefixes: [ 'price-override-pin-dot--filled'],
  },
  {
    // Item modifier modal — a self-contained stylesheet closure, the same
    // shape as KdsRoutingRulesEditor and PriceOverrideModal above: its sheet
    // (sales/components/ItemModifierModal.css) holds 45 rules / 36 distinct
    // class names and the ONLY consumer of any of them is this one .tsx,
    // which imports its own sheet at :7. Verified by walking every .tsx
    // under src/features: no other file names a class the sheet defines.
    // It is mounted by retail/RetailPosScreen.tsx (import :16, render :1770),
    // NOT by sales/PosScreen.tsx, whose own markup contains zero modifier-
    // literals — which is why this is its own unit and not a line inside the
    // PosScreen entry. No parentCss: all 31 className sites are modifier-*.
    // No dynamicClassPrefixes either: the six state names are complete quoted
    // literals at :293,:321 and :322, so the parser reaches them unaided.
    // It could not be registered until 0265b84b8 gave modifier-price-label
    // (:300) and modifier-price-value (:309) their base rules — an earlier
    // trial of this exact entry went red on case 1 with those two names and
    // was reverted rather than muted; see the PosScreen bullet below.
    name: 'ItemModifierModal',
    tsx: 'sales/components/ItemModifierModal.tsx',
    css: ['sales/components/ItemModifierModal.css'],
  },
  {
    name: 'PosScreen',
    tsx: 'sales/PosScreen.tsx',
    // The fence of this measurement is the screen's own import block:
    // PosScreen.tsx:46-52, seven sheets, 2,562 lines of CSS, and no other
    // .css in the tree shares a single class name with them (measured: 149
    // distinct names across the seven, zero appearing in two of them).
    css: [
      'sales/PosScreen.css',
      'sales/CartPanel.css',
      'sales/CartPanelLineItem.css',
      'sales/CartPanelFooterTotals.css',
      'sales/CartPanelActions.css',
      'sales/CartPanel.brand.css',
      'sales/CartPanelCourseBar.css',
    ],
    // Each of these seven is imported by PosScreen.tsx or by CartPanel.tsx, none
    // imports a stylesheet of its own, and all are styled from the seven
    // sheets above — which is what additionalTsx exists for.
    additionalTsx: [
      'sales/components/CartPanel.tsx',
      'sales/components/CartLineItem.tsx',
      'sales/components/CartFooterTotals.tsx',
      'sales/components/CartActionBar.tsx',
      'sales/components/CourseSelectorBar.tsx',
      'sales/components/ShiftModals.tsx',
      'sales/components/OpenBillModals.tsx',
    ],
  },
  {
    name: 'PaymentModal',
    tsx: 'sales/PaymentModal.tsx',
    css: ['sales/PaymentModal.css'],
    dynamicClassPrefixes: [ 'payment-overlay--enter', 'payment-overlay--exit', 'payment-modal--enter', 'payment-modal--exit'],
    additionalTsx: [
      'sales/payment/CashTenderPanel.tsx',
      'sales/payment/CardTenderPanel.tsx',
      'sales/payment/QrisTenderPanel.tsx',
      'sales/payment/SplitTenderRows.tsx',
      'sales/payment/LoyaltyTenderPanel.tsx',
      // payment-customer-* markup left PaymentModal.tsx in 2b456338b. The
      // receiving file imports no sheet of its own — its own :40 comment names
      // ../PaymentModal.css, which the modal imports once for the whole
      // surface — so without this line the guard calls all six rules dead:
      // todo-refactor-kds-agents-merged.md:115 firing on a live extraction,
      // measured here as 1 failed | 211 passed before the line was added.
      'sales/components/PaymentModalCustomerBadge.tsx',
    ],
  },
  // PaymentModal WAS deliberately NOT registered, and this note is what
  // kept that gap from being silent. Its companion sheet
  // (sales/PaymentModal.css, 1,165 lines) and its 1,912-line TSX were
  // read by NO check in this file — precisely the blind spot the header
  // describes. The entry ABOVE closes it, twelve commits later; what
  // follows stays as the record of why it could not be landed when it
  // was measured, and each finding is marked with what paid it off.
  // Attempting the entry that pass — tsx + css + the four extracted
  // tender panels (payment/CashTenderPanel, CardTenderPanel,
  // QrisTenderPanel, SplitTenderRows) — produced two findings, and
  // neither was a runtime-composed modifier that dynamicClassPrefixes
  // could excuse:
  //   1. HARD, case "every className used in PaymentModal has a CSS rule
  //      defined": payment-method-name (PaymentModal.tsx:1544,:1581),
  //      payment-qris-upgrade (payment/QrisTenderPanel.tsx:57) and
  //      payment-qris-btn--dynamic (same file,:90) were static
  //      classNames with NO rule in any .css in the repo (verified that
  //      pass:
  //      git grep '\\.(payment-method-name|payment-qris-upgrade|payment-qris-btn--dynamic)'
  //      over ui/src returned 0 css hits). Unstyled markup, not parser
  //      blindness — and dynamicClassPrefixes cannot reach this check
  //      anyway, since a prefix only suppresses the dead-class walk.
  //      PAID OFF, all three, in this same sheet: 448839397 put
  //      .payment-method-name at PaymentModal.css:180 and the checked
  //      variant at :184; 4ea4f482b put .payment-qris-upgrade at :638,
  //      .payment-qris-btn--dynamic at :681 with :697 and :707 behind it.
  //      Re-grepped before this entry landed: 6 hits, all in
  //      PaymentModal.css. Case 1 now passes with no exemption at all.
  //   2. SOFT-BUT-FAILING, case "every className defined in CSS is
  //      reachable from PaymentModal": the twelve payment-loyalty-*
  //      rules. These are NOT debt: payment/LoyaltyTenderPanel.tsx
  //      renders them (mounted at PaymentModal.tsx:36,:1703 since
  //      6ddf49f1e). They are the rule at
  //      todo-refactor-kds-agents-merged.md:115 firing exactly as
  //      designed — markup left the screen, the extraction did not
  //      append its new file to this list, so ten-plus live classes
  //      read as dead CSS.
  // Both steps are now done, and neither was taken inside a test file:
  // step 1 by the two sales commits named above, step 2 by this entry,
  // which lists all five panels in additionalTsx plus the extracted
  // customer badge (2b456338b) — including
  // payment/LoyaltyTenderPanel.tsx, whose twelve payment-loyalty-*
  // rules finding 2 named. The prefix pair the pass predicted is exactly
  // what the entry carries: 'payment-overlay--' and 'payment-modal--',
  // each covering the enter/exit pair and nothing else
  // (PaymentModal.css:17,:21,:49,:53). Nothing was swallowed to get
  // green — the two prefixes are the only exemption this entry holds.
  //
  // MEASURED, not asserted. With the entry in: 209 passed (209), exit
  // 0, from 206 — three cases, one per entry, per the CASE ARITHMETIC
  // form at the head of this file (68 entries now). Load-bearing proof
  // for the fifth panel, done the way the header asks: deleting the
  // single line 'sales/payment/LoyaltyTenderPanel.tsx' from additionalTsx
  // and re-running gave 1 failed | 208 passed (209) with 'Dead classes:
  // payment-loyalty-section, payment-loyalty-balance, payment-loyalty-
  // label, payment-loyalty-value, payment-loyalty-redeem-btn, ...' — all
  // twelve, i.e. finding 2 firing exactly as designed. Restored, 209.
  // sales/PaymentModal.css left BASELINE_UNCITED in the same commit, so
  // the array reads 48 -> 47 and the coverage case stays green.
  //
  // THREE OTHER CANDIDATES WERE MEASURED ON THAT PASS, and they have come
  // apart three different ways since: one landed, one was a FALSE finding
  // born of a scoping error, one is not reachable at all.
  //   - memo/MemosScreen.tsx — **LANDED**, at the foot of this list. What
  //     blocked it here was real and got PAID rather than muted: the
  //     registration failed case 1 on two genuinely undefined classes,
  //     bare memos-form and memos-field, which no .css defined — measured
  //     live, not by probe: 1 failed | 189 passed (190), "MemosScreen:
  //     className(s) used but not defined: memos-form, memos-field".
  //     69324986e then deleted both bare names from the markup (the form
  //     element and its onSubmit survived at MemosScreen.tsx:315; the four
  //     grid children kept the real layout name memos-field--full at
  //     :318,:379) and e9162a84 ran five memo suites green over it. The
  //     one prefix 'memos-badge--' stays load-bearing, for the four
  //     runtime-composed states at MemosScreen.css:289,:294,:299,:304.
  //     Re-measured with the entry in: 203 passed (203), zero failures.
  //   - sales/PosScreen.tsx — **LANDED**, and measured twice on a clean
  //     denominator before it did. The two numbers this bullet used to
  //     carry were both wrong: the 34 undefined modifier-* was a SCOPING
  //     ERROR (that trial appended components/ItemModifierModal.tsx to
  //     additionalTsx, a subtree with its own sheet, mounted by
  //     retail/RetailPosScreen :16,:1770 and never by PosScreen — whose
  //     markup holds zero modifier- literals, grep -c = 0), and the
  //     '55 dead + 1 undefined' it cites has NEVER reproduced: measured
  //     against the screen's own import fence (PosScreen.tsx:46-52 = seven
  //     sheets, 2,562 CSS lines, 149 distinct class names, none shared
  //     between two of the seven), walk A — PosScreen.tsx alone, 749
  //     lines, no additionalTsx — gave **0 undefined and 148 dead**, and
  //     every one of the 148 is a pos-cart-*/pos-shift-*/pos-hold-*/
  //     pos-held-*/pos-close-shift-* name belonging to a component that
  //     shares these sheets, i.e. todo-refactor-kds-agents-merged.md:115
  //     firing as designed, not debt. Walk B — the same seven sheets with
  //     those seven components in additionalTsx, each named above — gave
  //     **0 undefined, 0 dead**, 212 passed (212), exit 0. No rule was
  //     deleted and no class muted to get there; the only exemptions the
  //     entry holds are none — no parentCss, no prefixes, no external
  //     classes. Seven BASELINE_UNCITED paths left with it (47 -> 40):
  //     that is coverage, not arithmetic — case 3 grades all seven sheets
  //     on every run, so a dead rule in any of them fails this entry.
  //   - inventory/TransactionLogScreen.tsx — NOT REACHABLE: the only
  //     importers are in __tests__ (inventory/register.tsx mounts
  //     InventoryAdjustmentScreen and StockCountsFlow, never this; no
  //     route names it). Registering it would have bought a green over
  //     markup no user can reach, which is a worse outcome than the
  //     blind spot it closes. It stays out until someone shows the
  //     mount.

  // ── Reports ───────────────────────────────────────────
  {
    name: 'DashboardScreen',
    tsx: 'reports/DashboardScreen.tsx',
    css: ['reports/DashboardScreen.css'],
    // `card`/`card-body` belong to the global Card component stylesheet;
    // `dashboard-kpi-delta--` modifiers are built via template literal.
    externalClasses: ['card', 'card-body'],
    dynamicClassPrefixes: [ 'dashboard-kpi-delta--down'], // dashboard-kpi-delta--up struck 2026-09-15 · DSH · 0 rules (DashboardScreen.css defines only --down at :212) and 0 composition sites; the three sites at DashboardScreen.tsx:494/:509/:516 append --down only, so an up-delta renders unstyled rather than excused. Graded by the prefix arm at the foot of this file.
  },
  {
    name: 'InventoryReportScreen',
    tsx: 'reports/InventoryReportScreen.tsx',
    css: ['reports/InventoryReportScreen.css'],
  },
  {
    name: 'SalesReportScreen',
    tsx: 'reports/SalesReportScreen.tsx',
    css: ['reports/SalesReportScreen.css'],
  },

  // ── Gift Cards ─────────────────────────────────────────
  {
    name: 'GiftCardsScreen',
    tsx: 'gift-cards/GiftCardsScreen.tsx',
    css: ['gift-cards/GiftCardsScreen.css'],
    dynamicClassPrefixes: [ 'gift-card-txn-type--issue', 'gift-card-txn-type--topup', 'gift-card-txn-type--redeem', 'gift-card-txn-type--refund' ], // 2026-09-15 · DSH: struck the stem 'gift-card-status--' -- it credited 0 pairs and excused 0 dead names, because all four variants are written COMPLETE in the id map at features/gift-cards/GiftCardsScreen.tsx:24-27 and each owns a rule (:126/:131/:136/:142). A mute that waives nothing is not a claim, and it would have waived a fifth status silently.
    // The 11 gift-cards-modal-* values lived in externalClasses as another
    // component's work, and the file that does that work is real markup in this
    // feature: IssueGiftCardModal.tsx, which named none of the 11 in the screen file
    // and was not read by this entry at all -- grep for it in this file returned zero
    // occurrences before this line. additionalTsx is the device that says what the
    // mute only assumed: the walk now includes the file, so all 11 resolve through
    // the used-vs-defined check as names actually used, with no exemption and no
    // shield, and a future deletion of that markup will be reported instead of being
    // excused by a list nobody re-tests.
    additionalTsx: ['gift-cards/IssueGiftCardModal.tsx'],
  },

  // ── Stock Counting ─────────────────────────────────────
  {
    name: 'StockCountsScreen',
    tsx: 'inventory/StockCountsScreen.tsx',
    // 2026-09-16 · DSH · the badge family moved to inventory/StockCountBadge.css and THIS entry
    // cites it in `css`, not as parentCss: it is the family's owner, and it has no static leaner to
    // earn a parent cite -- its only use of the base is the class-builder local at
    // features/inventory/StockCountsScreen.tsx:56 (`const cls = \`sc-badge sc-badge--${status}\``),
    // applied bare at :142, a shape extractUsedClassNames cannot reach, so a trial parentCss here
    // was refused RED by the citation case with "citation is vacuous -- nothing this entry uses needs
    // it". Ownership says what is true instead: the four prefixes stay credited inside this entry's
    // own reach, and the base is still seen by the dead walk -- not through externalClasses, which is
    // struck here because the rule is now IN this citation, so the mute would claim the opposite --
    // but through resolveComposedClassNames, which credits the literal on the assigning line.
    // Detail and History, whose markup really does carry 'sc-badge' statically, cite the same sheet
    // as parentCss instead of borrowing it through StockCountsFlow.tsx's static import of the list.
    css: ['inventory/StockCountsScreen.css', 'inventory/StockCountBadge.css'],
    dynamicClassPrefixes: [ 'sc-badge--draft', 'sc-badge--in_progress', 'sc-badge--completed', 'sc-badge--cancelled'],
  },
  {
    name: 'StockCountDetail',
    tsx: 'inventory/StockCountDetail.tsx',
    css: ['inventory/StockCountDetail.css'],
    // Four sc-badge--* values struck 2026-09-16 · DSH · they were a copy of the sibling
    // screen's claim, not this entry's own. Evidence, all three citation shapes tried:
    // (a) inventory/StockCountDetail.css defines .sc-badge at :14 and ZERO sc-badge--* rules
    // (grep 'sc-badge' on that sheet returns the one line), so in the dead-class walk — which
    // reads ownIndex only, :1738 — the four prefixes excused nothing and the resolveComposed
    // call at :1680 could not compose them, since it composes against own sheet keys;
    // (b) citing inventory/StockCountsScreen.css as parentCss went RED at :2053 with
    // "citation is vacuous — nothing this entry uses needs it", because every name the detail
    // uses statically resolves in its own sheet (42 used, 37 own, 0 leaners);
    // (c) citing it in css went RED twice over — .sc-badge is then defined in two cited files
    // (case 2) and 17 of that sheet's list-screen rules became dead classes of this entry.
    // And the reach the prefix claimed is not there either: StockCountDetail.tsx:22 imports
    // './StockCountDetail.css' and nothing else; the family lives in StockCountsScreen.css
    // :116-119, imported by StockCountsScreen.tsx:14, credited by THAT entry above. So these
    // four muted another screen's classes — a hole in the ledger, not a finding about the tree.
    // What survives is what this sheet actually owns: sc-add-line-item-- (x1) and sc-diff- (x2).
    // Graded moves 108 -> 104; the floor at :2421 is untouched and 104 > 100.
    // The four sc-badge--* values are BACK at 2026-09-16 · DSH, and they are back as an OWNED
    // credit rather than a borrowed mute: the family now lives in inventory/StockCountBadge.css,
    // which this entry cites, so all four resolve inside this entry's own reach (css UNION
    // parentCss) and `sc-badge` is a real static leaner on that cite at StockCountDetail.tsx:243
    // -- the vacuous-citation guard has nothing to refuse. Graded climbs 104 -> 108.
    parentCss: ['inventory/StockCountBadge.css'],
    dynamicClassPrefixes: [ 'sc-badge--draft', 'sc-badge--in_progress', 'sc-badge--completed', 'sc-badge--cancelled', 'sc-add-line-item--', 'sc-diff-'],
    knownDynamicFragments: [
      // String-interpolated fragments in the skeleton table header that
      // the static class-name parser falsely extracts as CSS classes.
      // These are template-literal substrings like 'sc-lines-col-' + suffix.
      'sc-lines-col-',
      'sku',
      'name',
      'expected',
      'counted',
      'diff',
    ],
  },
  {
    name: 'StockCountForm',
    tsx: 'inventory/StockCountForm.tsx',
    css: ['inventory/StockCountForm.css'],
    // One composed variant, named whole: the only ternary is
    // `sc-type-btn ${countType === opt.value ? 'sc-type-btn--active' : ''}` at
    // features/inventory/StockCountForm.tsx:74, and inventory/StockCountForm.css carries
    // .sc-type-btn (:38), .sc-type-btn:focus-visible (:50) and .sc-type-btn--active
    // (:55) -- no second variant, so the bare 'sc-type-btn--' struck 2026-09-15 · DSH ·
    // excused a shape rather than a name: it would have waived a --pending or --done
    // rule the day someone added one, and .sc-type-btn itself never needed it, since a
    // name does not start with a longer prefix than itself.
    dynamicClassPrefixes: ['sc-type-btn--active'],
  },
  {
    name: 'StockCountHistory',
    tsx: 'inventory/StockCountHistory.tsx',
    css: ['inventory/StockCountHistory.css'],
    // One composed variant, named whole: 'sc-hist-item--sel' is the only interpolation
    // at features/inventory/StockCountHistory.tsx:157 and the only rule under the old
    // prefix at inventory/StockCountHistory.css:60. The sheet's other three names are
    // whole literals, not children of a family: .sc-hist-item at :47 (also :119, inside
    // the media block) and :84, -number at :65 and :160, -date at :69 and :164 -- none
    // of them was ever rescued by 'sc-hist-item--', which is why replacing it with one
    // name costs nothing and struck 2026-09-15 · DSH · removes an open grant.
    // This screen paints the same family at StockCountHistory.tsx:161 and declared none of
    // it -- a silent borrower whose badges were styled only through the flow's static import of
    // the list screen. The cite makes that dependency named; 'sc-badge' is its static leaner.
    parentCss: ['inventory/StockCountBadge.css'],
    dynamicClassPrefixes: ['sc-hist-item--sel'],
  },

  // ── Stock Transfers ────────────────────────────────────
  {
    name: 'StockTransfersScreen',
    tsx: 'stock-transfers/StockTransfersScreen.tsx',
    css: ['stock-transfers/StockTransfersScreen.css'],
    dynamicClassPrefixes: [ 'stock-transfers-badge--draft', 'stock-transfers-badge--pending', 'stock-transfers-badge--in_transit', 'stock-transfers-badge--received', 'stock-transfers-badge--cancelled'],

  },

  // ── Purchasing ─────────────────────────────────────────
  {
    name: 'SuppliersScreen',
    tsx: 'purchasing/SuppliersScreen.tsx',
    css: ['purchasing/SuppliersScreen.css'],
    dynamicClassPrefixes: [ 'suppliers-badge--active', 'suppliers-badge--inactive'],
  },
  {
    name: 'PurchaseOrdersScreen',
    tsx: 'purchasing/PurchaseOrdersScreen.tsx',
    css: ['purchasing/PurchaseOrdersScreen.css'],
    dynamicClassPrefixes: [ 'po-status--draft', 'po-status--pending', 'po-status--approved', 'po-status--received', 'po-status--cancelled'],
  },
  {
    name: 'PurchaseOrderForm',
    tsx: 'purchasing/PurchaseOrderForm.tsx',
    css: ['purchasing/PurchaseOrderForm.css'],
  },

  // ── Restaurant ─────────────────────────────────────────
  {
    name: 'RestaurantMenu',
    tsx: 'restaurant/RestaurantMenu.tsx',
    css: ['restaurant/RestaurantMenu.css'],
    dynamicClassPrefixes: [
      'restaurant-hamburger-item--',
      'restaurant-card--added',
      'restaurant-card--disabled',
      'restaurant-card--pinned',
    ],
    // Trusted child component, named whole: the pin badge's Tooltip renders
    // `tooltip-wrapper` + `tooltip-wrapper--inline` (Tooltip.tsx:225), defined
    // by frontend/shell/Tooltip.css:3,12 — OUTSIDE the grammar parentCss
    // allows (only ../frontend/themes/ escapes src/features, :120-123), so
    // this is the externalClasses shape, not a sheet cite. A bare `tooltip-`
    // prefix would excuse any future Tooltip class; the two whole names keep
    // a third one reading dead. (Folded with the Agent-3-era 'restaurant-card'
    // above into one list rather than a duplicate key — duplicate keys are
    // legal JS but the second silently wins, which would have dropped the
    // original.)
    externalClasses: [
      'restaurant-card',
      'tooltip-wrapper',
      'tooltip-wrapper--inline',
    ],
    // The Agent 3 extraction moved the tile/tab-strip/grid/overlay JSX into
    // components/*.tsx; they share the screen's stylesheet (global classes).
    additionalTsx: [
      'restaurant/components/MenuItemTile.tsx',
      'restaurant/components/MenuCategoryTabBar.tsx',
      'restaurant/components/MenuItemGrid.tsx',
      'restaurant/components/MenuItemContextMenu.tsx',
      'restaurant/components/MenuPreferencesMenu.tsx',
      'restaurant/components/MenuSearchBar.tsx',
    ],
    // Cited, not muted: the sr-only span the menu card's "Add" label moved into
    // is styled by frontend/themes/components.css:1492, which both entry points
    // import (main.tsx:7, main.tablet.tsx:20) — so the name is global, not
    // runtime-composed, and the cite is checkable by the coverage block.
    parentCss: ['../frontend/themes/components.css'],
    // Trusted child component, named whole: the pin badge's Tooltip renders
    // `tooltip-wrapper` + `tooltip-wrapper--inline` (Tooltip.tsx:225), defined
    // by frontend/shell/Tooltip.css:3,12 — OUTSIDE the grammar parentCss
    // allows (only ../frontend/themes/ escapes src/features, :120-123), so
    // this is the externalClasses shape, not a sheet cite. A bare `tooltip-`
    // prefix would excuse any future Tooltip class; the two whole names keep
    // a third one reading dead.
    externalClasses: ['restaurant-card', 'tooltip-wrapper', 'tooltip-wrapper--inline'],
  },

  // ── Appearance Settings ────────────────────────────────
  {
    name: 'AppearanceSettings',
    tsx: 'settings/AppearanceSettings.tsx',
    // Its OWN sheet only. SettingsPage.css was listed here as css, which put a
    // 1,090-line shared sheet into this entry's dead-class walk -- and 94 of its 98
    // selectors were then reachable only because 13 prefixes excused them. As parentCss
    // the same sheet still answers the used-vs-defined question (that check resolves
    // against css UNION parentCss) and stops being graded for deadness here at all,
    // which is what the field is for and what the four settings cards already do.
    // Verified value by value, not by count: none of the 13 matches a SINGLE one of
    // this entry's own 18 selectors -- zero of those 18 even begin with settings- --
    // so every one of them existed to excuse the parent and all 13 go with the move.
    // tooltip-content was worse than that: it matched nothing here, nothing in the
    // parent, and nothing in the markup, a grant for a name no sheet defines.
    css: ['settings/AppearanceSettings.css'],
    parentCss: ['settings/SettingsPage.css'],
    knownDynamicFragments: [
      // Card component classes (defined in frontend/themes/components.css)
      // that are used inline in AppearanceSettings.tsx but not present
      // in the screen's own CSS files.
      'card--padding-md',
      'card--shadow-sm',
      'card-header',
    ],
    externalClasses: [
      'card',
      'collapsed',
      'mobile-open',
      'visible',
      'section-loading',
    ],
  },

  // ── Settings cards ─────────────────────────────────────────
  // Four real settings surfaces (1,486 lines of markup between them) that
  // grew under settings/screens/ while the scaffolds below stayed blank.
  // Each owns its own sheet and borrows exactly ONE name from the settings
  // scaffold — settings-section-title, defined only at
  // settings/SettingsPage.css:514 — which is what parentCss is for: case 1
  // resolves it through css UNION parentCss, while cases 2 and 3 keep
  // walking the card's own sheet alone. Listing SettingsPage.css in css:
  // instead would grade its whole class inventory against one card and make
  // the entry unsatisfiable, the way the 13 placeholder entries are not.
  // Every one of these four paths was removed from BASELINE_UNCITED as it
  // was cited here: the array went 54 -> 50, four lines, one per entry.
  {
    name: 'ReceiptFormatSettingsCard',
    tsx: 'settings/screens/ReceiptFormatSettingsCard.tsx',
    css: ['settings/screens/ReceiptFormatSettingsCard.css'],
    parentCss: ['settings/SettingsPage.css'],
  },
  {
    // 13 classes, audited clean at 9836cf960: fiscalnum-overview-title keeps
    // living as an id=/aria-labelledby= pair (StatutoryNumberingCard.tsx:345,
    // :347), not as a className token, and fiscalnum-error is rendered by the
    // card's own markup as well as asserted by the SettingsPage.test marker
    // list — so this entry grades both without any exemption.
    name: 'StatutoryNumberingCard',
    tsx: 'settings/screens/StatutoryNumberingCard.tsx',
    css: ['settings/screens/StatutoryNumberingCard.css'],
    parentCss: ['settings/SettingsPage.css'],
  },
  {
    // 12 classes, audited at zero orphans; regional-settings-empty is both the
    // card's rendered empty state and a SettingsPage.test.tsx marker, and the
    // markup carries no className={{ expression for the parser to trip over.
    name: 'RegionalSettingsCard',
    tsx: 'settings/screens/RegionalSettingsCard.tsx',
    css: ['settings/screens/RegionalSettingsCard.css'],
    parentCss: ['settings/SettingsPage.css'],
  },
  {
    // 19 classes, audited at zero orphans, and the largest of the four by
    // borrowed-name risk: settings-section-title at :165 is the only name in
    // its markup that its own sheet does not define.
    name: 'LocalPaymentSettingsCard',
    tsx: 'settings/screens/LocalPaymentSettingsCard.tsx',
    css: ['settings/screens/LocalPaymentSettingsCard.css'],
    parentCss: ['settings/SettingsPage.css'],
  },

  // ── Settings screen scaffolds (rebuild) ────────────────────
  // Blank placeholders under features/settings/screens/, one file per screen.
  // They share screens-placeholder.css, so each entry lists that single
  // companion sheet. The duplicate-class check is scoped to the css list of
  // one entry, so sharing one stylesheet across entries stays clean.
  // Each scaffold is swapped for the migrated screen during the settings
  // campaign, at which point its entry points at that screen's own sheet.
  {
    name: 'GeneralScreen',
    tsx: 'settings/screens/GeneralScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'LicenseSubscriptionScreen',
    tsx: 'settings/screens/LicenseSubscriptionScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'DevicesConnectivityScreen',
    tsx: 'settings/screens/DevicesConnectivityScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'BusinessDefaultsScreen',
    tsx: 'settings/screens/BusinessDefaultsScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'FeaturesModulesScreen',
    tsx: 'settings/screens/FeaturesModulesScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'SecurityAccountScreen',
    tsx: 'settings/screens/SecurityAccountScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'DataSyncScreen',
    tsx: 'settings/screens/DataSyncScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'DataManagementScreen (placeholder)',
    tsx: 'settings/screens/DataManagementScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'SyncStatusScreen',
    tsx: 'settings/screens/SyncStatusScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'OfflineQueueScreen',
    tsx: 'settings/screens/OfflineQueueScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'TaxConfigurationScreen',
    tsx: 'settings/screens/TaxConfigurationScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'ExchangeRatesScreen',
    tsx: 'settings/screens/ExchangeRatesScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'SystemDiagnosticsScreen',
    tsx: 'settings/screens/SystemDiagnosticsScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },

  // ── Memo ───────────────────────────────────────────────
  {
    // Migrated memo manager, reachable at route 'memos' (memo/register.tsx:
    // lazy import + registerPage + registerNavItem). Its one dynamic family
    // is the status badge: MemosScreen.tsx:47-50 returns each complete name
    // from a helper and :513 interpolates the RESULT, so no quoted token
    // survives at the className site and the four rules at
    // MemosScreen.css:289,:294,:299,:304 read as dead without the prefix.
    // ONE prefix, not four names: it covers exactly the four states and
    // nothing else. The two bare classNames this entry used to fail on
    // (memos-form, memos-field) were deleted from the markup at 69324986e.
    // Citing memo/MemosScreen.css here also retires its BASELINE_UNCITED line:
    // the array went 50 -> 49, which is all the array is for.
    name: 'MemosScreen',
    tsx: 'memo/MemosScreen.tsx',
    css: ['memo/MemosScreen.css'],
    dynamicClassPrefixes: [ 'memos-badge--draft', 'memos-badge--published', 'memos-badge--muted', 'memos-badge--stopped'],
  },

  // ── Landed from the array: each entry below is one sheet that no check
  // read, registered only after its own walk came back 0 undefined / 0 dead.
  {
    // 673-line screen over a 350-line sheet; lazy-registered page, so the
    // mount is proven by reports/register.tsx:8 and the registerPage route
    // 'menu-engineering' at :45. Owns its sheet (:33) and no other .tsx in
    // the tree references a name from it, so the entry needs no parentCss,
    // no prefix, no externalClasses.
    name: 'MenuEngineeringScreen',
    tsx: 'reports/MenuEngineeringScreen.tsx',
    css: ['reports/MenuEngineeringScreen.css'],
  },
  {
    // 280-line preview over a 292-line sheet, own import at :5. Mounted by the
    // already-registered PaymentModal: sales/PaymentModal.tsx:26, JSX at :1376.
    // No other .tsx references a name from this sheet, so the entry is own-sheet
    // only - no parentCss, no prefix, no externalClasses, no additionalTsx.
    name: 'ReceiptPreview',
    tsx: 'sales/ReceiptPreview.tsx',
    css: ['sales/ReceiptPreview.css'],
  },
  {
    // 509-line dialog over a 313-line sheet, own import at :8. Same host as the
    // preview above - sales/PaymentModal.tsx:25, JSX at :1256 - and zero consumers
    // outside the file, which is why nothing was appended to additionalTsx here.
    name: 'StockShortfallDialog',
    tsx: 'sales/StockShortfallDialog.tsx',
    css: ['sales/StockShortfallDialog.css'],
  },
  {
    // 447-line picker over a 221-line sheet, own import at :10. Two hosts, both
    // registered already - products/ProductManagementScreen.tsx:32 (JSX :336) and
    // warehouse/WarehouseConsole.tsx:32 - and neither references a name from this
    // sheet, so each stays in its own entry and no name is graded twice.
    name: 'LocationPicker',
    tsx: 'inventory/LocationPicker.tsx',
    css: ['inventory/LocationPicker.css'],
  },
  {
    // 213-line panel over a 251-line sheet, own import at :9. Mounted by
    // products/ProductManagementScreen.tsx:30 (JSX :766); zero outside consumers,
    // so the entry is own-sheet only.
    name: 'StockAlertPanel',
    tsx: 'inventory/StockAlertPanel.tsx',
    css: ['inventory/StockAlertPanel.css'],
  },
  {
    // 491-line modal over its own 334-line sheet (import at :12), mounted by
    // kds/KdsScreen.tsx:29 and rendered at :586. This is the entry that was blocked
    // all evening by two names: kds-enrollment-station-input-wrap, which a rules lane
    // wrote, and kds-enrollment-success-icon, deleted by 6c33ae7c24. Its variant
    // classes are complete quoted strings inside the className template, which
    // extractUsedClassNames sees, so NO prefix was needed.
    name: 'KdsEnrollmentModal',
    tsx: 'kds/components/KdsEnrollmentModal.tsx',
    css: ['kds/components/KdsEnrollmentModal.css'],
  },
  {
    // 193-line indicator over a 127-line sheet (import :10), mounted by
    // kds/components/KdsHeaderRight.tsx:39, JSX :115. Case 1 is clean unaided:
    // case 3 was red on kds-device-status--connected/--disconnected/--stale, which
    // are literals in the table at :49/:53/:57 but reach the DOM only through the
    // interpolated local at :143, so the sheet-level prefix below is the honest
    // shape - it is NOT the PromotionsModal case, where a value in a comparison
    // position never becomes a class at all and needs knownDynamicFragments instead.
    name: 'KdsDeviceStatusIndicator',
    tsx: 'kds/components/KdsDeviceStatusIndicator.tsx',
    css: ['kds/components/KdsDeviceStatusIndicator.css'],
    dynamicClassPrefixes: [ 'kds-device-status--connected', 'kds-device-status--disconnected', 'kds-device-status--stale'],
  },
  {
    // Locations apply-confirmation panel; imports its own sheet at :30. Mounted
    // by locations/NodeTopologyEditor.tsx:2465 (import :13) — and that parent's
    // reachability is a HASH DEEP LINK, not a route: nothing in ui/src binds
    // `route: 'topology'` and there is no register.tsx entry, so the only way in
    // is MultiStoreDashboardScreen.tsx:149/:156 pushing `#/settings/topology?…`.
    // Registered because its markup renders, not because a page is routed; no
    // claim here that a registered page exists.
    //
    // Walk A came back 0 undefined / 0 dead UNAAIDED, so this entry carries NO
    // parentCss: a trial cite of ../frontend/themes/components.css was refused RED
    // by the citation case as vacuous (nothing this sheet's markup uses is missing
    // from it). The dossier's `--selected` orphan is not in the tree any more —
    // case-insensitive `selected` is 0 hits in both files at a8bc36269.
    name: 'TopologyApplyConfirm',
    tsx: 'locations/TopologyApplyConfirm.tsx',
    css: ['locations/TopologyApplyConfirm.css'],
  },
  {
    // Gate screen, strong mount: AppShell.tsx:27 imports it and renders it BEFORE
    // routing (features/index.ts:43 names the class of thing — "gate screens
    // rendered before page routing"), opened by the user-count check at
    // AppShell.tsx:112/:200. It imports its own sheet at :7 and resolves against
    // it unaided — all eight base names (create-pin-container / -card / -header /
    // -form-group / -input / -submit-btn / -error-banner and spinner) live in
    // this entry's own sheet — so it carries NO parentCss either: a trial
    // cite of ../frontend/themes/components.css came back RED from the citation case
    // as vacuous. The new assertion refused a cite the queue had assumed.
    name: 'CreatePinScreen',
    tsx: 'auth/CreatePinScreen.tsx',
    css: ['auth/CreatePinScreen.css'],
  },
  {
    // Second auth gate screen, strong mount and the same shape as CreatePinScreen:
    // AppShell.tsx:26 imports it and renders it at :758, before any route exists,
    // and features/index.ts:42 files it with the auth gates. It imports its own
    // sheet at :13 and resolves against it UNAAIDED — walk A came back 0 undefined
    // and 0 dead with no parentCss, no prefix and no fragment, so none was added:
    // the citation case would refuse a theme cite here as vacuous exactly as it
    // refused two tonight already. Its own claim re-derived rather than accepted:
    // 17 distinct class names spread over 30 selector rules (grep the leading
    // \.. tokens, sort -u), so "17 of 17" was true of this sheet and the run
    // agrees with it — 0 undefined, 0 dead.
    name: 'LicenseActivationScreen',
    tsx: 'auth/LicenseActivationScreen.tsx',
    css: ['auth/LicenseActivationScreen.css'],
  },
  {
    // Routed reports screen, strong mount, all three surfaces checked rather than
    // inferred from one import grep: reports/register.tsx:9 lazy-imports it, :57
    // registerPage binds route 'custom-report' (label 'Custom Report',
    // requiredRole 'manager', requiredPermission 'reports:view'), :59/:63
    // registerNavItem carries i18nKey 'nav-custom-report' — and the third grep, every
    // `route: 'custom-report'` in ui/src, returns those two lines and NO workspace
    // card, so it is nav-linked and not carded. Own sheet imported at :13.
    // Walk A is clean with NO exemption at all, which is the dossier's claim and now
    // the run's: 0 undefined / 0 dead over 35 distinct class names in 46 selector
    // rules, no prefix line, no fragment line, and a trial parentCss of
    // ../frontend/themes/components.css refused RED by the citation case as vacuous.
    // Note `.custom-report-col-item--selected` is both defined and used here — the
    // --selected name TopologyApplyConfirm's dossier called an orphan belongs to THIS
    // sheet, where it is honest, and 0 case-insensitive `selected` hits remain there.
    name: 'CustomReportScreen',
    tsx: 'reports/CustomReportScreen.tsx',
    css: ['reports/CustomReportScreen.css'],
  },
  {
    // Promotion-picker modal. Mount evidence is a JSX site, not a route: it imports
    // its own sheet at :9 and is rendered by sales/PosScreen.tsx:42 (import) at
    // :677. It claims NO page of its own — the route 'promotions' bound at
    // promotions/register.tsx:8/:10 belongs to PromotionManagementScreen, and the two
    // cards naming that route (setup/components/LiveSetupPreview.tsx:84,
    // workspaces/tools.tsx:161) are that screen's, so nothing here says a registered
    // page exists for the modal.
    //
    // Its seventh name is a decision, not a coverage win: promo-picker-item is a real
    // single-token class on the li at :151, and 8db5d0900 gave it an EMPTY rule on the
    // argument that .promo-picker-list owns the list-style/margin/padding/gap and the
    // row's box is drawn by .promo-picker-item-btn — the author refused the available
    // min-width: 0 because shrinking the li does not wrap the span that overflows. The
    // class is declared and styled-by-inheritance; case 3 keeps it honest.
    //
    // knownDynamicFragments carries exactly ONE string, MEASURED not inherited: walk A
    // without it came back red, `PromotionsModal: className(s) used but not defined:
    // eligible`, so extractUsedClassNames does put that token in this entry's used set.
    // It is a comparison right-hand side inside an interpolation at :154
    // (`promo-picker-item-btn${kind === 'eligible' ? …}`), never a class on an element
    // — the same value appears again at :155 as `disabled={kind !== 'eligible'}`, which
    // is not a className at all. dynamicClassPrefixes would be the wrong field here:
    // there is no composed name, only a harvested literal.
    // Falsifiable in both directions, so the exemption can be contradicted: if the
    // interpolation harvest at screenExtraction.utils.ts:170-176 is narrowed to skip
    // comparison operands, `eligible` leaves the used set and this line becomes vacuous
    // — deleting it must then keep the run green. If instead someone puts eligible ON an
    // element, removing this line makes case 1 red again and a real rule is owed.
    name: 'PromotionsModal',
    tsx: 'sales/PromotionsModal.tsx',
    css: ['sales/PromotionsModal.css'],
    knownDynamicFragments: ['eligible'],
    // NO parentCss: the nine names components.css re-defines (sr-only, spinner, card,
    // btn, badge, status-indicator, kds-workspace, shift-status-active,
    // settings-footer-shortcut) occur 0 times as a rule in this sheet (measured by
    // grep -cE over the seven-name alternation), and case 1 is clean against the own
    // sheet alone, so a theme cite here would be both vacuous and unresolvable.
  },
  {
    // Scale readout chip. MOUNTED and deep in a live path, but NOT a routed page:
    // retail/RetailProductGrid.tsx:9 imports it and renders it at :603-604 under
    // isScaleEnabled, which is retail/RetailPosScreen.tsx:1552's
    // isEnabled(FEATURES.USB_SCALE) — a flag a manager can light in a shipped build
    // from the Hardware group of settings/FeatureToggleScreen.tsx. There is no route
    // to claim here: features/retail has no register.tsx at all, and RetailPosScreen
    // reaches both shells through frontend/shell/AppShell.tsx and
    // frontend/shell/tablet/TabletAppShell.tsx. The sheet is imported by its own
    // component at :2, which is what makes it loadable at all.
    //
    // CITED BECAUSE THE MARKUP IS LIVE, NOT BECAUSE THE FEATURE WORKS — the styled
    // surface is real and the data is not: crates/oz-hal/src/drivers/scale.rs:57 says
    // HidWeightScale::read_weight reports Unsupported deliberately (it used to say
    // NotFound, which told an operator to check a cable on a driver that was never
    // written), registry.rs:4 records that no caller invokes register_scale() — the
    // three textual hits are that sentence, the pub fn at :116 and a comment in this
    // sheet — and bootstrap.rs:4 states the wiring is blocked on the driver. So
    // read_scale_weight_scoped resolves a missing scale to Ok(None): the chip re-polls
    // every 2000 ms (ScaleIndicator.tsx:40) and parks in scale-indicator--idle, which
    // is the only one of its four state classes (--idle / --stable / --unstable /
    // --error) a shipped build can currently reach. 19 rules over 17 names, so a few
    // rules style states no device can produce today; that is a driver gap, and this
    // entry neither hides it nor certifies the feature.
    //
    // NO parentCss: grep over the nine names frontend/themes/components.css re-defines
    // (sr-only, spinner, card, btn, badge, status-indicator, kds-workspace,
    // shift-status-active, settings-footer-shortcut) returns 0 rules here, and case 1
    // resolves all 17 names against this sheet alone — no exemption of any kind added.
    // ScaleIndicator.test.tsx queries .scale-indicator--idle/--error/--stable/--unstable
    // and -clear-btn, but jsdom applies no CSS, so that suite is not evidence about this
    // sheet and this entry does not lean on it.
    name: 'ScaleIndicator',
    tsx: 'retail/ScaleIndicator.tsx',
    css: ['retail/ScaleIndicator.css'],
  },
];

// ── The selector-only contract's two evidence sources ─────────────
// Both maps are read from disk on every run, so a claim cannot age quietly:
// `locatorReadNames` walks the specs as TEXT (a spec is not imported and not
// executed here — Playwright never runs in this suite), and `classBuildingSites`
// walks production files in ONE feature dir, tests excluded, because a test that
// asserts a class is not proof that production builds it.
const E2E_DIR = path.resolve(process.cwd(), 'e2e');

function locatorReadNames(): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  if (!fs.existsSync(E2E_DIR)) return hits;
  for (const f of fs.readdirSync(E2E_DIR)) {
    if (!f.endsWith('.spec.ts')) continue;
    const lines = fs.readFileSync(path.join(E2E_DIR, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/(page\.locator|\.locator\(|querySelector\(|getByTestId\()/.test(line)) return;
      for (const m of line.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
        const cls = m[1];
        if (!cls) continue; // noUncheckedIndexedAccess: a match group is string | undefined
        hits.set(cls, [...(hits.get(cls) ?? []), `${f}:${i + 1}`]);
      }
    });
  }
  return hits;
}

function classBuildingSites(featureDir: string): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  const root = path.join(FEATURES_DIR, featureDir);
  if (!fs.existsSync(root)) return hits;
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.tsx') && !e.name.endsWith('.ts')) continue;
      if (e.name.endsWith('.test.tsx') || e.name.endsWith('.spec.ts')) continue;
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/['"`]([a-z][a-z0-9_-]*(?:--[a-z0-9-]+)?)['"`]/g)) {
          const cls = m[1];
          if (!cls) continue;
          const rel = path.relative(FEATURES_DIR, full).split(path.sep).join('/');
          hits.set(cls, [...(hits.get(cls) ?? []), `${rel}:${i + 1}`]);
        }
      });
    }
  };
  walk(root);
  return hits;
}

function featureDirOf(tsx: string): string {
  // src/features/<dir>/... — the one feature dir a selector-only claim may be built
  // in. Written as a slice, not as split('/')[0], because noUncheckedIndexedAccess
  // makes that expression string | undefined and tsc refuses it.
  const i = tsx.indexOf('/');
  return i > 0 ? tsx.slice(0, i) : tsx;
}

function ownSheetSelectors(entry: ScreenEntry): Set<string> {
  const out = new Set<string>();
  for (const c of entry.css) {
    const file = c.startsWith('../')
      ? path.resolve(FEATURES_DIR, c)
      : path.join(FEATURES_DIR, c);
    if (!fs.existsSync(file)) continue;
    for (const cls of extractClassSelectors(fs.readFileSync(file, 'utf8'))) out.add(cls);
  }
  return out;
}

// ── Tests ─────────────────────────────────────────────────────────

// The per-entry cases below compute their findings but PRINT them only when
// they fail, so a green tip printed nothing at all: the dead count quoted in
// the ledger came from a throwaway script that reconstructed this population,
// and nobody running the suite tomorrow can reproduce it. This accumulator
// turns it into a print. Module-level on purpose -- Vitest gives one file one
// worker and runs every case against one module instance, so a finding is
// recorded once per run; a setup that sharded a file across workers would
// double it, which is why the census prints how many entries it saw.
// UNIT: NAME-AND-ENTRY PAIRS, not names. One class defined in two registered
// screens' own css is two rows here, because each entry grades only its own
// sheet; the distinct-name count is printed beside it so a pair count can
// never be read as a population, or the other way round, without a comment.
const CENSUS: {
  dead: Array<[string, string]>;
  credit: Array<[string, string, string]>;
  undefined: Array<[string, string]>;
  seen: Set<string>;
  runs: number;
} = { dead: [], credit: [], undefined: [], seen: new Set(), runs: 0 };

describe.each(SCREENS)(
  'CSS class integrity — $name',
  ({ name, tsx, css, parentCss, dynamicClassPrefixes, externalClasses, knownDynamicFragments, additionalTsx, selectorOnlyClasses }: ScreenEntry) => {
    const tsxPath = path.join(FEATURES_DIR, tsx);
    let tsxContent = fs.readFileSync(tsxPath, 'utf8');

    // Also scan additional TSX files (e.g. extracted section components)
    if (additionalTsx) {
      for (const extraTsx of additionalTsx) {
        const extraPath = path.join(FEATURES_DIR, extraTsx);
        tsxContent += fs.readFileSync(extraPath, 'utf8');
      }
    }

    const used = extractUsedClassNames(tsxContent);

    // ── Two reverse maps (className -> [file, ...]), split by DIRECTION ──
    //
    // The asymmetry IS the mechanism, so it gets stated rather than guessed:
    //
    //   case 1 (used -> defined)  walks own css UNION parentCss
    //   cases 2 and 3            walk own css ONLY
    //
    // Case 1 asks "can this class resolve at all?", and a shared parent sheet
    // really does provide it to this screen, so resolving short of the parent
    // would invent a missing-class failure for markup that renders fine.
    //
    // Cases 2 and 3 ask "is THIS ENTRY's sheet honest?", and answering them
    // over a union breaks. Grading case 3 (dead classes) against the union is
    // precisely what makes a shared sheet unsatisfiable: a parent's classes
    // are consumed across the whole family of children, never necessarily by
    // one of them, so every child would report the siblings' classes dead.
    // The mirror is measured, not hypothetical — screens-placeholder.css is
    // cited by 13 entries and all 13 screens use all 3 of its classes, which
    // is why those 13 case-3 bodies are provably empty today: scoped to the
    // citing entry's own css, that sheet has nothing left to call dead.
    // Scoping is also what keeps case 2 meaningful — see the note above the
    // scaffold entries.
    const ownIndex = new Map<string, string[]>();
    const definedIndex = new Map<string, string[]>();

    // Track unique files to avoid counting the same path twice
    // when the same class appears in the same file via compound selectors.
    const cssPaths = css.map((c) => path.join(FEATURES_DIR, c));
    // `css` resolves inside src/features, always. A `parentCss` path may
    // escape it only under ../frontend/themes/ — see the field's
    // docstring — and the coverage block refuses anything else, so this
    // branch cannot be reached by a sibling feature sheet posing as a
    // parent. Anything else stays joined as before.
    const parentPaths = (parentCss ?? []).map((c) =>
      c.startsWith('../frontend/themes/') ? path.resolve(FEATURES_DIR, c) : path.join(FEATURES_DIR, c),
    );

    const index = (target: Map<string, string[]>, cssPath: string) => {
      for (const cls of extractClassSelectors(fs.readFileSync(cssPath, 'utf8'))) {
        if (!target.has(cls)) {
          target.set(cls, []);
        }
        target.get(cls)!.push(cssPath);
      }
    };
    for (const cssPath of cssPaths) {
      index(ownIndex, cssPath);
      index(definedIndex, cssPath);
    }
    for (const cssPath of parentPaths) {
      index(definedIndex, cssPath);
    }

    // Class names the two readers cannot see because the value is composed first
    // and applied second -- an accumulator local, a conditional in a template held
    // in a local, a function returning literals, a map indexed in a template. Its
    // predicate is THIS entry's own sheet, never the parent union, and the result
    // is deliberately kept out of `used` below: a name only this resolver reaches
    // must not be able to satisfy the used-but-not-defined case. That confines the
    // widening to the dead-class case, where it can only REMOVE a finding. It is
    // still a permissive change, and the count it moves is in this commit body.
    const composed = resolveComposedClassNames(tsxContent, new Set(ownIndex.keys()));

    it(`every className used in ${name} has a CSS rule defined`, () => {
      const fragments = new Set(knownDynamicFragments ?? []);
      // The selector-only contract withholds a name from THIS report only when both
      // proofs hold; an unproven claim stays in `missing` like any other undefined
      // name, and nothing here is added to `used`. It is never a rescue from case 3.
      const provenSelectorOnly = new Set(
        (selectorOnlyClasses ?? []).filter(
          (n) => locatorReadNames().has(n) && classBuildingSites(featureDirOf(tsx)).has(n),
        ),
      );
      const missing: string[] = [];
      for (const cls of used) {
        // Resolves against own css UNION parentCss — see the two maps above.
        if (!definedIndex.has(cls) && !fragments.has(cls) && !provenSelectorOnly.has(cls)) {
          missing.push(cls);
        }
      }
      CENSUS.undefined.push(...missing.map((cls) => [name, cls] as [string, string]));
      expect(
        missing,
        `${name}: className(s) used but not defined: ${missing.join(', ')}`,
      ).toEqual([]);
    });

    it(`no className is defined in more than one CSS file for ${name}`, () => {
      const duplicates: string[] = [];
      // Own css ONLY: a parent sheet is shared, so a duplicate inside it is
      // the parent's owner's finding, not this entry's.
      for (const [cls, files] of ownIndex) {
        // Only flag if the class appears in multiple unique files
        const uniqueFiles = [...new Set(files)];
        if (uniqueFiles.length > 1 && used.has(cls)) {
          duplicates.push(
            `${cls} -> ${uniqueFiles.map((f) => path.basename(f)).join(', ')}`,
          );
        }
      }
      expect(
        duplicates,
        `${name}: className(s) duplicated across files:\n${duplicates.join('\n')}`,
      ).toEqual([]);
    });

    it(`every className defined in CSS is reachable from ${name} (no dead classes)`, () => {
      const prefixes = dynamicClassPrefixes ?? [];
      const external = new Set(externalClasses ?? []);
      const dead: string[] = [];
      // Own css ONLY — grading this over the union would make every shared
      // parent sheet unsatisfiable. See the two maps above.
      //
      // `composed` joins the excusal list here and nowhere else. Before it, a name
      // like role-badge--owner survived only because the prefix `role-badge--`
      // covered it -- a whole family excused by a string prefix, which is the same
      // shape as the file-wide reduced-motion amnesty. After it, the name survives
      // because a literal in this file reaches a className sink. Nothing is added to
      // `used`, so a name the resolver cannot see stays exactly as dead as it was.
      for (const [cls] of ownIndex) {
        if (
          !used.has(cls) &&
          !composed.has(cls) &&
          !external.has(cls) &&
          !prefixes.some((p) => cls.startsWith(p))
        ) {
          dead.push(cls);
        }
      }
      // Soft in NAME only. `expect.soft` does NOT "log a warning
      // rather than hard-fail" — it records a real failed assertion and
      // the run exits non-zero, so a dead class here fails the suite as
      // surely as cases 1 and 2 do. What soft actually buys is
      // sequencing: it lets this case report every dead class (and lets
      // the other two cases in this entry still run) instead of
      // aborting the file on the first one. The `console.warn` below is
      // the informative half; this line is the gate. Do not read the
      // word "soft", or that warn, as "advisory".
      CENSUS.seen.add(name);
      CENSUS.runs += 1;
      for (const cls of dead) CENSUS.dead.push([name, cls]);
      // The other half of the number, and the half the suite cannot fail on:
      // names for which a PREFIX is the only claim that they are used. These
      // are not findings today -- a dynamicClassPrefixes entry is a legal
      // claim -- but they are precisely what the guard stopped calling dead,
      // and no deletion is defensible while they stay invisible. A whole-name
      // entry (p === cls) is not a credit here: it is graded by name in the
      // externalClasses/ledger cases instead. UNIT: name-and-entry pairs.
      for (const [cls] of ownIndex) {
        if (used.has(cls) || composed.has(cls) || external.has(cls)) continue;
        const by = prefixes.find((p) => p !== cls && cls.startsWith(p));
        if (by) CENSUS.credit.push([name, cls, by]);
      }
      if (dead.length > 0) {
        console.warn(
          `[WARN] ${name}: className(s) defined in CSS but never referenced ` +
            `(consider removing if unused elsewhere):\n  ${dead.join('\n  ')}`,
        );
        expect.soft(dead, `Dead classes: ${dead.join(', ')}`).toEqual([]);
      }
    });
  },
);

// Declared after the describe.each above, so Vitest's declaration order runs
// it last and the accumulator is complete.
it('dead-class census: what the guard calls dead, and what a prefix rescues', () => {
  // Printed on the GREEN path. A count that only appears when the suite is
  // already red cannot license a deletion, which is the whole use of it.
  // The floor is why a zero may be believed: an entry that never ran and an
  // entry with nothing dead look identical otherwise.
  expect(
    CENSUS.runs,
    `dead-class census ran ${CENSUS.runs} of ${SCREENS.length} entries (over ${CENSUS.seen.size} distinct names -- two entries share a name) -- so the count below is not a blank`,
  ).toBe(SCREENS.length);
  const distinct = new Set(CENSUS.dead.map(([, cls]) => cls));
  const rescued = new Set(CENSUS.credit.map(([, cls]) => cls));
  console.log(
    `dead-class census (${CENSUS.runs} graded entries / ${CENSUS.seen.size} distinct names): ` +
      `DEAD ${CENSUS.dead.length} pair(s) / ${distinct.size} distinct name(s); ` +
      `PREFIX-RESCUED ${CENSUS.credit.length} pair(s) / ${rescued.size} distinct name(s); ` +
      `USED-BUT-NOT-DEFINED ${CENSUS.undefined.length} pair(s)`,
  );
  for (const [entry, cls] of CENSUS.dead) console.log(`  DEAD  ${entry}: ${cls}`);
  for (const [entry, cls, by] of CENSUS.credit)
    console.log(`  RESCUED  ${entry}: ${cls} (only claim: prefix '${by}')`);
  for (const [entry, cls] of CENSUS.undefined)
    console.log(`  UNDEFINED  ${entry}: ${cls}`);
});


// ── Stylesheet coverage ──────────────────────────────────────────
//
// The three per-entry cases above only read what an entry NAMES, so the
// guard cannot see a stylesheet nobody cited. This one case auto-walks
// src/features/**/*.css and asks the single whole-tree question a
// registration guard can answer honestly: is every sheet claimed?
//
// BASELINE_UNCITED is a BASELINE, not a MUTE, and the difference is the
// whole point. `knownDynamicFragments` excuses a FINDING — the extractor
// read real markup on a registered screen and produced a claim about it,
// and this list says that claim is wrong. A path here postpones a CLAIM
// about a file nobody has read yet: nothing in it is asserted false, and
// every one of its 23 entries is a named path, not a prefix, not a
// pattern, not a directory. So the array can only shrink — registering a
// sheet (slice 2) or deleting one removes a line, and NOTHING here is a
// place to put a new one: not a rename, not a sheet that "will be
// registered next sprint", not the 28th line a lane adds because the
// coverage case turned red on its file. A NEW stylesheet has exactly one
// legal landing — its css, its tsx and its SCREENS entry in the SAME
// commit — and there is no third state, because a state a lane can fall
// into is the mute-shaped hole in another shape. The sequence that bought
// this sentence: 604ff27ad added retail/ScaleIndicator.css with its import
// line and no entry, and HEAD stayed red on the coverage case until
// c06450022 registered it — the gap between those two SHAs is a broken
// tree that reads as somebody else's fault, which is the whole reason the
// rule is written here rather than remembered.
//
// The other half of that law was prose-only, and the prose was the WRONG
// sentence: it called a paid-off line "inert" and its deletion "the
// courtesy, not the requirement". A cited sheet left listed is not inert —
// it goes back to ungraded the day its entry is removed, with no red to say
// so — and a listed path whose file is gone is a line that can never shrink,
// which makes the length of this array a lie about remaining debt either
// way. So both directions are now asserted, as the third check inside the
// coverage case below. The reason this half moved rather than the sibling's:
// themeTokenCompliance.test.ts:940-944 already enforces both directions of
// its own list and describes THIS array as the model for the phrase
// "shrink-only naming" — the analogy was being paid to a file that only
// policed one of them. Where the two lists genuinely differ, it is in what
// a stale line means there (a name whose miss was fixed, so the debt is
// paid) and here (a rename or a vanished file, so the claim was never about
// this tree) — and both readings still say the line must go.
//
// Why a baseline instead of asserting the whole tree today: the repo
// already chose this shape for the same problem. `verify-ftl-orphans.py`
// runs `--staged-only` as a HARD gate and `--census` as informational,
// because a whole-tree blocker is unusable — 93 honest candidates, of
// which an unknown fraction are detection gaps, means the first red run
// gets the gate disabled rather than the debt paid. Same here: blocking
// on 54 unread sheets would buy nothing, so the list was frozen at 54 —
// it has shrunk to 23 since, one line per sheet a landed entry cited, and
// every NEW sheet fails loud with its own filename.
// Every stylesheet under src, keyed the way SCREENS names it: a feature sheet loses its
// features/ prefix, anything else keeps its path from src (frontend/themes/components.css
// and friends). This is the universe the externalClasses case grades against, because a
// mute makes a claim about a sheet and a sheet outside the entry can only be found by
// walking sheets rather than by believing the list.
// Keys, not files: every sheet outside src/features sits in the map TWICE (bare key and
// parent-relative key), so any print that says "N sheets" must say which of the two it means.
function indexFileCount(index: Map<string, Set<string>>): number {
  let n = 0;
  for (const key of index.keys()) if (!key.startsWith('../')) n += 1;
  return n;
}

function allSheetIndex(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const root = path.resolve(process.cwd(), 'src');
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === '__tests__' || ent.name === 'node_modules') continue;
        walk(full);
      } else if (ent.name.endsWith('.css')) {
        const rel = path.relative(root, full).replace(/\\/g, '/');
        const key = rel.startsWith('features/') ? rel.slice('features/'.length) : rel;
        const classes = new Set(extractClassSelectors(fs.readFileSync(full, 'utf8')));
        out.set(key, classes);
        // SAME FILE, BOTH SPELLINGS, ONE SET OBJECT. A cite for a sheet outside src/features is
        // written '../frontend/themes/<sheet>.css' — the grammar the citation case resolves at
        // :1653 and :2050 — while the key above is 'frontend/themes/<sheet>.css'. Two grammars
        // naming one file, and an equality lookup could only ever see one of them, so the prefix
        // arm graded those entries WITHOUT the shared sheet they had cited. Rewriting the DATA is
        // not safe: probeB proved the bare form throws ENOENT in the extractor case. So the index
        // resolves both, and the drift case at the foot of this file holds the two identical.
        if (!rel.startsWith('features/')) out.set('../' + rel, classes);
      }
    }
  };
  walk(root);
  return out;
}

// An exemption ledger, not a mute list: every externalClasses value the structural case
// below finds defined only inside its declaring entry must appear here WITH ITS REASON,
// and a member whose violation has gone away fails the case itself, so the ledger shrinks
// when the tree does rather than accreting decoration. Seeded from measurement, each
// citation re-read from source. The three names the last two boxes called candidate dead
// rules are deliberately NOT listed: staff-login-connection-group
// (auth/StaffLoginScreen.css), restaurant-pill-dot (restaurant/RestaurantMenu.css) and
// workspace-home-user (workspaces/WorkspaceHome.css) were each tested for a composition
// site and have none, so they are either live-and-unspeakable or dead rules, and both
// answers are a stylesheet question rather than an exemption this file may grant.
// 2026-09-15 ANSWERED -- all three were proven dead and deleted, each as ONE change (rule +
// entry value + open-question member together, because the staleness check below grades both
// lists in both directions). The list is now empty and the 4-member ledger above is the whole
// exemption surface. Dead proofs, five shapes each, all failing to exist outside the rule: JSX
// className, imperative/classList (the shape that saved workspace-card-ripple and restaurant-card
// here), template stem (a prefix cannot cover a shorter base, which is why the bare
// workspace-home-user died while -profile/-avatar/-avatar-inner/-info/-name/-role live at
// WorkspaceHome.tsx:239-247), string selector in any sheet or test, and ui/e2e locator (0 hits
// for all three). Relatives that look like references are Fluent message IDs, not classes:
// staff.ftl:146-150 and shared.ftl:344. restaurant-pill-dot had a second rule naming it, the
// compound .restaurant-category-pill--active .restaurant-pill-dot, which went in the same edit:
// a descendant selector for a class nothing can carry is the same dead rule, not a live site.
const EXTERNAL_CLASS_OPEN_QUESTIONS: { entry: string; value: string; question: string }[] = [
];

const EXTERNAL_CLASS_LEDGER: { entry: string; value: string; reason: string }[] = [
  {
    entry: 'SettingsPage',
    value: 'settings-topology-container',
    reason: 'cross-consumer: defined at settings/SettingsPage.css:501, read by a literal className at features/locations/TopologyScreen.tsx:716; the only device pointing at a consumer, additionalTsx, was measured to cost 13 new used-but-undefined findings',
  },
  {
    entry: 'WorkspaceHome',
    value: 'workspace-card-ripple',
    reason: 'non-JSX: assigned imperatively at features/workspaces/WorkspaceHome.tsx:488, so it never enters the used set; removing its mute printed Dead classes and the value was restored',
  },
  {
    entry: 'RestaurantMenu',
    value: 'restaurant-card',
    reason: 'non-JSX: the base is assigned to a local at features/restaurant/components/MenuItemTile.tsx:189 (let cardClass of the literal) and only the composed value reaches className, so the extractor never sees the base; its entry already carries a restaurant-card-- prefix which cannot cover the base either',
  },
  {
    entry: 'KdsScreen',
    value: 'no-anim',
    reason: 'non-JSX: applied to document.body by classList.toggle at features/kds/KdsScreen.tsx:93-94, outside every component JSX and every prefix shape',
  },
];

const BASELINE_UNCITED: string[] = [
  'analytics/AnalyticsScreen.css',
  'auth/SessionLockScreen.css',
  'design/DesignSystem.css',
  'design/DevToolbar.css',
  'design/TooltipPreview.css',
  'design/brand-tokens.css',
  'inventory/ShiftBar.css',
  'inventory/ThresholdConfigScreen.css',
  'inventory/TransactionLogScreen.css',
  'inventory/TransitAuditScreen.css',
  'locations/NodeTopologyEditor.css',
  'locations/TopologyRevisionBrowser.css',
  'locations/TopologyScreen.css',
  'marketplace/AddonsMarketplace.css',
  'memo/MemoBanner.css',
  'retail/RetailPosScreen.css',
  'sales/widgets/widgets.css',
  'settings/SettingsNavTree.css',
  'settings/SettingsScopeTag.css',
  'settings/WorkspaceSettingsModal.module.css',
  'setup/components/LiveSetupPreview.css',
  'staff/RoleAuthoringScreen.css',
  'warehouse/WarehouseConsole.css',
];

describe('stylesheet coverage', () => {
  it('every .css under src/features is cited by an entry, or listed in BASELINE_UNCITED', () => {
    const cited = new Set<string>();
    for (const entry of SCREENS) {
      for (const c of entry.css) cited.add(c);
      for (const c of entry.parentCss ?? []) cited.add(c);
    }

    const found: string[] = [];
    const walk = (dir: string) => {
      for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, dirent.name);
        if (dirent.isDirectory()) walk(p);
        else if (dirent.name.endsWith('.css')) {
          found.push(path.relative(FEATURES_DIR, p).split(path.sep).join('/'));
        }
      }
    };
    walk(FEATURES_DIR);

    const offenders = found
      .filter((sheet) => !cited.has(sheet) && !BASELINE_UNCITED.includes(sheet))
      .sort();

    expect(
      offenders,
      `uncited: ${offenders.length} (baseline ${BASELINE_UNCITED.length}) — sheet(s) no entry cites via css or parentCss and no line of BASELINE_UNCITED names: ${offenders.join(', ')} — if this is a NEW sheet, author its entry: a new stylesheet may not join a shrink-only list, so land its css, its tsx and its SCREENS entry in the same commit. Only an existing sheet nobody has read belongs in BASELINE_UNCITED (see the block above).`,
    ).toEqual([]);

    // Second structural check in this same case: WHERE a parent may live.
    // `css` is always inside src/features; `parentCss` may escape it only
    // under the one theme prefix the field's docstring allows. This cannot
    // be derived from imports because the guard reads no import edge at all
    // — it opens the paths the entry itself names — so an escaping path is
    // either a theme sheet or unverifiable prose. `../sales/PaymentModal.css`
    // would resolve, would satisfy case 1, and would still be a lie about
    // who owns the name: a sibling's sheet is not this screen's parent.
    const escaping = SCREENS.flatMap((entry) =>
      (entry.parentCss ?? [])
        .filter((p) => p.split('/').includes('..') && !p.startsWith('../frontend/themes/'))
        .map((p) => `${entry.name}: ${p}`),
    ).sort();
    expect(
      escaping,
      `parentCss: ${escaping.length} citation(s) leave src/features without naming a theme sheet — the only prefix allowed is ../frontend/themes/: ${escaping.join(', ')}`,
    ).toEqual([]);

    // Third structural check in this same case, and the reason the block
    // above can now say "shrink-only" about BOTH directions instead of one:
    // a listed path that an entry already cites is paid-off debt still being
    // counted, and a listed path with no file behind it is a ghost that can
    // never be cleared. Neither is an offender in the first check — a sheet
    // in both sets is by construction not uncited — so the list could rot in
    // either direction while this case stayed green.
    const walked = new Set(found);
    const stale: string[] = [];
    for (const sheet of BASELINE_UNCITED) {
      if (cited.has(sheet)) {
        stale.push(`paid-off: ${sheet} is already cited by an entry — delete the line, the debt is cleared`);
      } else if (!walked.has(sheet)) {
        stale.push(`ghost: ${sheet} is not a stylesheet under src/features anymore — the line can never shrink`);
      }
    }
    const seen = new Set<string>();
    for (const sheet of BASELINE_UNCITED) {
      if (seen.has(sheet)) stale.push(`duplicated: ${sheet} is listed twice`);
      seen.add(sheet);
    }
    stale.sort();
    expect(
      stale,
      `BASELINE_UNCITED: ${stale.length} dishonest line(s) (baseline ${BASELINE_UNCITED.length}) — the list is shrink-only in BOTH directions: a path an entry already cites must be deleted, and a path with no file behind it is a ghost. A NEW sheet never joins this list; author its entry instead. ${stale.join(' | ')}`,
    ).toEqual([]);
  });

  it('every parentCss citation names a sheet that defines what it is cited for', () => {
    // A citation is a claim about provenance, so it has to be checkable
    // rather than declarative: the named sheet must exist, and every name
    // the entry leans on it for must actually be defined in it. "Leans on
    // it for" = used by this entry's markup, NOT defined by the entry's own
    // css, and not already excused by that entry's own declared exemptions
    // (a muted or prefixed name is not being attributed to the parent).
    const findings: string[] = [];
    for (const entry of SCREENS) {
      const parents = entry.parentCss ?? [];
      if (parents.length === 0) continue;

      const parentDefined = new Set<string>();
      for (const p of parents) {
        const file = p.startsWith('../frontend/themes/')
          ? path.resolve(FEATURES_DIR, p)
          : path.join(FEATURES_DIR, p);
        if (!fs.existsSync(file)) {
          findings.push(`${entry.name}: parentCss names a sheet that does not exist: ${p}`);
          continue;
        }
        for (const cls of extractClassSelectors(fs.readFileSync(file, 'utf8'))) {
          parentDefined.add(cls);
        }
      }

      let source = fs.readFileSync(path.join(FEATURES_DIR, entry.tsx), 'utf8');
      for (const extraTsx of entry.additionalTsx ?? []) {
        source += fs.readFileSync(path.join(FEATURES_DIR, extraTsx), 'utf8');
      }
      const ownDefined = new Set<string>();
      for (const c of entry.css) {
        for (const cls of extractClassSelectors(fs.readFileSync(path.join(FEATURES_DIR, c), 'utf8'))) {
          ownDefined.add(cls);
        }
      }
      const fragments = new Set(entry.knownDynamicFragments ?? []);
      const external = new Set(entry.externalClasses ?? []);
      const prefixes = entry.dynamicClassPrefixes ?? [];
      const leaners = [...extractUsedClassNames(source)].filter(
        (u) =>
          !ownDefined.has(u) &&
          !fragments.has(u) &&
          !external.has(u) &&
          !prefixes.some((pre) => u.startsWith(pre)),
      );

      const unbacked = leaners.filter((u) => !parentDefined.has(u)).sort();
      if (unbacked.length > 0) {
        findings.push(
          `${entry.name}: cited parent sheet(s) (${parents.join(', ')}) do not define: ${unbacked.join(', ')}`,
        );
      }
      if (leaners.length === 0) {
        findings.push(
          `${entry.name}: parentCss citation ${parents.join(', ')} is vacuous — nothing this entry uses needs it, so it teaches nothing and hides a stale cite`,
        );
      }
    }
    expect(
      findings,
      `parentCss citation(s) not earning their place: ${findings.length} — ${findings.join(' | ')}`,
    ).toEqual([]);
  });
});

// ── The extractor itself ─────────────────────────────────────────
//
// Everything above tests the SCREENS against the extractor, so a bug in the extractor
// shows up as a false finding about a screen rather than as a failure here. That is how
// the interpolation strip went unnoticed: `body.replace(/\$\{[^}]*\}/g, '')` stopped at
// the first `}` even when that brace belonged to something nested, and KdsHamburgerPanel
// :415 embeds `/^#[0-9a-f]{6}$/i` -- a quantifier brace -- inside `${...}`. The residue
// glued itself to the preceding class name, so `kds-hex-input` was reported DEAD while
// genuinely in use. These cases pin the behaviour directly, so a future regression fails
// here with a message about the extractor instead of a misleading one about a screen.

  it('every externalClasses value names a rule defined outside its declaring entry', () => {
    // The entry's OWN css only: a sheet this entry cites as parentCss counts as OUTSIDE
    // it, because the claim a mute makes is that the rule lives beyond the css this entry
    // owns, and a parent-cited shared sheet satisfies that (ruling one). Written the other
    // way round first, the case went red on AppearanceSettings: section-loading, a value
    // defined in the parent -- an inverted ruling caught by the assertion, not by reading.
    const index = allSheetIndex();
    const definedElsewhere = (entry: ScreenEntry, cls: string) => {
      const own = new Set(entry.css);
      for (const [sheet, classes] of index) {
        if (!own.has(sheet) && classes.has(cls)) return true;
      }
      return false;
    };
    const violations = SCREENS.flatMap((entry) =>
      (entry.externalClasses ?? [])
        .filter((cls) => !definedElsewhere(entry, cls))
        .map((cls) => `${entry.name}: ${cls}`),
    );
    const ledger = new Set(EXTERNAL_CLASS_LEDGER.map((m) => `${m.entry}: ${m.value}`));
    // Count assertion BEFORE any expectation: a case over an empty population reads
    // exactly like a clean tree, which is how three devices in this session landed as a
    // comment without data or as a census of zero.
    const graded = SCREENS.reduce((n, e) => n + (e.externalClasses?.length ?? 0), 0);
    console.log(
      `externalClasses ledger case: ${indexFileCount(index)} sheet files indexed (${index.size} keys), ${graded} values graded, ${violations.length} violation(s), ${EXTERNAL_CLASS_LEDGER.length} ledger member(s)`,
    );
    expect(index.size).toBeGreaterThan(100);
    expect(graded).toBeGreaterThan(0);
    const asked = new Set(EXTERNAL_CLASS_OPEN_QUESTIONS.map((m) => `${m.entry}: ${m.value}`));
    // Graded, not waived: an open question is listed so the check neither agrees with the
    // mute nor turns the tree red for a stylesheet owner's decision, and every member of
    // BOTH lists is still required to have a live violation below, so a resolved question
    // fails the case until it is struck here too.
    console.log(
      `  of which ledgered=${[...ledger].filter((m) => violations.includes(m)).length} open-question=${[...asked].filter((m) => violations.includes(m)).length}`,
    );
    expect(violations.filter((v) => !ledger.has(v) && !asked.has(v))).toEqual([]);
    // No exempt member without a matching violation, so a healed value cannot stay.
    expect([...ledger].filter((m) => !violations.includes(m))).toEqual([]);
    expect([...asked].filter((m) => !violations.includes(m))).toEqual([]);
  });

describe('selector-only class claims', () => {
  // Three structural whole-tree cases, one per half of the contract plus the
  // anti-rescue clause. They grade the DECLARATION, so a wrong claim is a finding
  // against the entry that made it — the property none of the three believed arrays
  // has. Entries and the uncited baseline are untouched by them: the contract adds
  // cases without adding coverage, and that asymmetry is the point.
  const claims = SCREENS.filter((e) => (e.selectorOnlyClasses ?? []).length > 0);

  it('every selectorOnlyClasses name is read by a ui/e2e locator', () => {
    const read = locatorReadNames();
    const findings: string[] = [];
    for (const entry of claims) {
      for (const cls of entry.selectorOnlyClasses ?? []) {
        if (!read.has(cls)) {
          findings.push(`${entry.name}: ${cls} — declared selector-only, no locator in ui/e2e reads it`);
        }
      }
    }
    expect(findings, `Unproven selector-only claims (locator half).\n${findings.join('\n')}`).toEqual([]);
  });

  it('every selectorOnlyClasses name is built by production code in its own feature dir', () => {
    const findings: string[] = [];
    for (const entry of claims) {
      const built = classBuildingSites(featureDirOf(entry.tsx));
      for (const cls of entry.selectorOnlyClasses ?? []) {
        if (!built.has(cls)) {
          findings.push(
            `${entry.name}: ${cls} — declared selector-only, no production file under ` +
              `src/features/${featureDirOf(entry.tsx)}/ names it`,
          );
        }
      }
    }
    expect(findings, `Unproven selector-only claims (markup half).\n${findings.join('\n')}`).toEqual([]);
  });

  it('no selectorOnlyClasses name is silently excusing a rule that still styles it', () => {
    const findings: string[] = [];
    for (const entry of claims) {
      const defined = ownSheetSelectors(entry);
      for (const cls of entry.selectorOnlyClasses ?? []) {
        if (defined.has(cls)) {
          findings.push(
            `${entry.name}: ${cls} — declared selector-only but a rule in its own sheet ` +
              `still styles it; a rule whose only consumer is a locator is delete-candidate debt`,
          );
        }
      }
    }
    expect(findings, `Selector-only claims contradicted by a real rule.\n${findings.join('\n')}`).toEqual([]);
  });
});

describe('extractUsedClassNames', () => {
  it('reads a plain static className', () => {
    expect(extractUsedClassNames('<div className="a b" />')).toEqual(new Set(['a', 'b']));
  });

  it('keeps the base class when an interpolation contains a regex quantifier', () => {
    // The exact shape from KdsHamburgerPanel.tsx:415.
    const src = 'className={`kds-hex-input${hexDraft?.key === key && !/^#[0-9a-f]{6}$/i.test(hexDraft.value) ? \' kds-hex-input--invalid\' : \'\'}`}';
    const got = extractUsedClassNames(src);
    expect(got.has('kds-hex-input')).toBe(true);
    expect(got.has('kds-hex-input--invalid')).toBe(true);
    // The failure mode was residue, so assert the absence explicitly rather than only
    // that "something" was found.
    expect([...got].some((c) => c.includes('0-9a-f'))).toBe(false);
  });

  it('keeps the base class through nested braces and template-in-interpolation', () => {
    const src = 'className={`pos-cart-line-wrap${items.map((i) => ` col-${i.n}`)} x`}';
    const got = extractUsedClassNames(src);
    expect(got.has('pos-cart-line-wrap')).toBe(true);
    expect(got.has('x')).toBe(true);
  });

  it('handles an interpolation that ends the template', () => {
    const got = extractUsedClassNames('className={`a${cond}`}');
    expect(got.has('a')).toBe(true);
  });
});

// -- The allowlist grades itself -----------------------------------
//
// Every case above asks what a declared prefix EXCUSES. None asked whether the
// prefix itself still reaches anything, and that is the door this arm closes: an
// allowance matching no rule in any sheet and no site in any walked source is a
// mute over a name family that no longer exists, and it fails quietly forever --
// 'data-mgmt-toast--' sat here for 68 days after f16c7ead5 (2026-07-09, remove
// stale toast CSS; 0 inserted / 38 deleted on settings/DataManagementScreen.css)
// took away the .data-mgmt-toast family it was written to cover, and not one
// printed number in this file moved: 137 sheets, 37 values graded, 4 violations,
// 4 ledger members, 22 prefix-rescued -- all read the same with it or without it.
//
// FAILURE, not a printed count with a floor, on purpose. The census already prints
// how many names a prefix SAVES, so a prefix that saves nothing adds zero to that
// print and hides inside a healthy-looking number; that is the exact shape these
// lines survived in. And the graded population is curated inside this file, so a
// shrinking universe IS the symptom -- a floor over it would be scored by the same
// list it is meant to police.
//
// Both halves are read over the whole walked tree rather than over the declaring
// entry, so the arm cannot call a live stem inert merely because a screen failed to
// register the file that writes it: 'kds-column--' matches no rule in any sheet
// (its three names are carried by selectorOnlyClasses and located from ui/e2e
// instead) and still PASSES here, because features/kds/KdsLayoutMasonry.tsx
// composes the stem. That is the line between inert and out-of-scope, and it is why
// the code half exists at all.
//
// This case sits outside the header formula at :53, which already under-counts
// (3 x 86 entries + 4 extractor + 2 coverage = 264 against the 269 that ran at
// af4b27238). It adds one.
function walkedSourceText(): string {
  const root = path.resolve(process.cwd(), 'src');
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === '__tests__' || ent.name === 'node_modules') continue;
        walk(full);
      } else if (/\.tsx?$/.test(ent.name)) {
        parts.push(fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(root);
  return parts.join('|');
}

// Exact-or-boundary coverage, the convention scripts/verify-ftl-orphans.py:237
// encodes (`n == p or n.startswith(p + '-')`), lifted to class names. A bare
// startsWith lets a WHOLE NAME prefix its own longer siblings, so the ledger
// entry 'sc-badge--draft' would be credited by 'sc-badge--drafting' -- a name
// that was never an allowance -- and the entry would pay no debt while looking
// live. The third clause is not new slack: a prefix that already ends in a
// delimiter (the BEM '--' forms here) has no character left to demand, so its
// boundary IS the prefix.
function prefixCovers(name: string, p: string): boolean {
  if (name === p) return true;
  if (name.startsWith(p + '-')) return true;
  return p.endsWith('-') && name.startsWith(p) && name.length > p.length;
}

it('no dynamicClassPrefixes value is an inert allowance (the prefix arm)', () => {
  const index = allSheetIndex();
  const defined = new Set<string>();
  for (const classes of index.values()) for (const cls of classes) defined.add(cls);
  const names = [...defined];
  const sources = walkedSourceText();
  const inert: string[] = [];
  // A LEDGER HOLE, kept in its own list on purpose: an entry that cites no sheet whose
  // classes are indexed can never produce a hit, so every prefix it declares would land in
  // `inert` looking exactly like a real unowned allowance. A guard that cannot tell missing
  // data from bad data gets blamed on the data, so the hole is named per entry instead.
  const noSheets: string[] = [];
  const credited = new Map<string, string[]>();
  // Graded values whose EVERY credit lives in a parent-cited sheet -- see the split print below.
  // A LIST AND A LINE, nothing more: it feeds no assertion, so it cannot decide which reading of
  // the citation is authoritative. Unit: values, named per value (the census's unit is names).
  const parentOnly: string[] = [];
  // Graded values that passed ONLY because some source string contains the prefix, with no
  // class of their own inside the entry's cited sheets. Printed by name: the identity this
  // line exists to keep auditable is graded = credited + inert + residual, and every term
  // of it is named. Three dated reads of the same identity, each closed: 108 = 103 + 4 + 1
  // while the four StockCountDetail sc-badge--* mutes stood unearned; 104 = 103 + 0 + 1
  // once they were struck at the ledger; 107 = 107 + 0 + 0 once the badge family was hoisted
  // into its own imported sheet and the mutes became credit. This box reads 100 = 100 + 0 + 0
  // -- seven whole-name mutes that the census never credited as a sole claim removed, with
  // inert and residual both still zero, so the shrink is the ledger getting thinner, not a
  // term going missing.
  const uncreditedLive: string[] = [];
  let graded = 0;
  for (const entry of SCREENS) {
    // OWNED sheets only -- the same scoping the dead-class census already uses
    // (:1738 iterates ownIndex, and ruling one at :2116 counts a parent-cited
    // shared sheet as owned). A prefix credited by a class some other screen
    // defined is collecting credit for a family this entry does not own.
    const own = new Set([...entry.css, ...(entry.parentCss ?? [])]);
    const ownClasses: string[] = [];
    // The two halves of that same citation, recorded SIDE BY SIDE and never merged. This exists
    // only for the split print below: `ownClasses` keeps feeding `credited` / `inert` /
    // `residual` / `graded` exactly as before, and no value is re-classified by it.
    // `prefix credit` counts a value that credits any class in css ∪ parentCss; the dead-class
    // walk iterates `ownIndex`, which is fed from `cssPaths` alone at :1794-1797 while
    // `parentPaths` reach only `definedIndex` (:1798-1800) -- the field doc's own sentence at
    // :115-118. Those are two
    // different questions and the file has been answering them in two different ways, so a value
    // can be credited to one half and invisible to the other IN THE SAME RUN. Which half is
    // authoritative is an open question in the plan doc and is NOT ruled here -- the line below
    // just makes the size of the disagreement print itself every run instead of being argued.
    const ownCssPaths = new Set(entry.css);
    const ownCssClasses = new Set<string>();
    const parentSheetOf = new Map<string, string>();
    let sheetsIndexed = 0;
    for (const [sheet, classes] of index) {
      if (!own.has(sheet)) continue;
      sheetsIndexed += 1;
      for (const cls of classes) ownClasses.push(cls);
      if (ownCssPaths.has(sheet)) { for (const cls of classes) ownCssClasses.add(cls); }
      else { for (const cls of classes) if (!parentSheetOf.has(cls)) parentSheetOf.set(cls, sheet); }
    }
    const declared = entry.dynamicClassPrefixes ?? [];
    if (declared.length > 0 && (own.size === 0 || sheetsIndexed === 0 || ownClasses.length === 0)) {
      noSheets.push(
        entry.name + ': declares ' + declared.length + ' dynamicClassPrefixes value(s) but reads 0 class names from its own citation (' + own.size + ' path(s) cited, ' + sheetsIndexed + ' indexed, ' + ownClasses.length + ' class names read; cited: ' + ([...own].join(', ') || 'none') + ') — its prefixes cannot be graded on the rule side at all, so they are reported HERE rather than as inert allowances',
      );
    }
    for (const prefix of entry.dynamicClassPrefixes ?? []) {
      graded += 1;
      const hits = ownClasses.filter((cls) => prefixCovers(cls, prefix)).sort();
      if (hits.length > 0) credited.set(entry.name + ' :: ' + prefix, hits);
      // The split, read off the SAME `hits` -- no second lookup, no re-classification. A value
      // lands here when every class it credits sits in a sheet the entry cites as `parentCss`:
      // credited under this arm's rule, unreachable by the dead walk's. Named in the census's
      // own shape (RESCUED <entry>: <cls> (only claim: prefix 'x')), because a count of this
      // without the membership beside it is exactly the kind of number that gets re-baselined.
      if (hits.length > 0 && !hits.some((cls) => ownCssClasses.has(cls))) {
        const uniq = [...new Set(hits)];
        const via = [...new Set(uniq.map((cls) => parentSheetOf.get(cls) ?? 'unresolved sheet'))].sort();
        parentOnly.push(entry.name + ': ' + prefix + ' (only credit: parentCss ' + via.join('+') + ' x' + uniq.length + ': ' + uniq.join(', ') + ')');
      }
      if (ownClasses.length === 0) continue; // ledger hole: one noSheets finding per entry, not N manufactured inert ones
      const hasRule = hits.length > 0;
      const hasSite = sources.includes(prefix);
      // Annotated with the entry's OWN reach, so the residual is distinguishable from a lookup
      // miss without re-running anything: an entry that reads 0 class names from its own
      // citation is a LEDGER HOLE and is labelled one, never left to read like a clean pass.
      if (hits.length === 0 && hasSite) {
        uncreditedLive.push(
          entry.name + ' :: ' + prefix + ' [own citation resolved to ' + ownClasses.length + ' class name(s) from ' + sheetsIndexed + ' of ' + own.size + ' cited path(s)' + (sheetsIndexed === 0 ? ' — LEDGER HOLE: this entry cites nothing resolvable, so its pass rests on a composition site alone' : ' — citation resolved, so this is a site-only pass, NOT a lookup miss') + ']',
        );
      }
      if (!hasRule && !hasSite) {
        // The message has to be true about the population this arm actually graded. The old
        // wording — "0 rules in 137 sheets" — was FALSE AS PRINTED for the four standing
        // StockCountDetail findings: those four rules exist, in
        // ui/src/features/inventory/StockCountsScreen.css, one of the 137. It told a reader to
        // edit a stylesheet when the gap is a citation in this ledger. So: report the count
        // inside the sheets THIS entry owns, and name the sibling sheet when the family is
        // found there. Same push condition; the population it described is gone. That message
      // stood for exactly four findings, all of them the StockCountDetail sc-badge--* copy of
      // StockCountsScreen's family, and all four were STRUCK AT THE SOURCE 2026-09-16 · DSH —
      // the ledger entry, not the tree (see the note at :1025: 0 rules in this entry's own
      // sheet, a parentCss cite refused as vacuous at :2070, a css cite refused as duplicate+
      // 17 dead). Graded fell 108 -> 104 with this branch now printing 0, which is the point:
      // a mute that credits nothing in the citing entry's own reach is a hole, not a finding.
        const elsewhere: string[] = [];
        for (const [sheet, classes] of index) {
          // Canonical spelling only: since 5cdfcd601 every shared sheet is in the map twice
          // (bare key and ../-key, same Set object), and naming a file twice would read as two
          // places to look. The alias can never hold a name the bare key lacks — one object.
          if (own.has(sheet) || sheet.startsWith('../')) continue;
          let n = 0;
          for (const cls of classes) if (prefixCovers(cls, prefix)) n += 1;
          if (n > 0) elsewhere.push(sheet + ' x' + n);
        }
        inert.push(
          entry.name + ': ' + prefix + ' — 0 of ' + ownClasses.length + ' class name(s) read from this entry\'s ' + sheetsIndexed + ' cited sheet(s) are covered by the prefix, and 0 composition sites in any walked source' + (elsewhere.length > 0 ? '; the family IS defined elsewhere (' + elsewhere.join(', ') + '), outside this citation — so the fix is the ledger cite or the entry, NOT a stylesheet' : '; the prefix matches no rule in any of the ' + index.size + ' indexed sheets'),
        );
      }
    }
  }
  console.log(
    'inert-prefix arm: ' + graded + ' dynamicClassPrefixes values graded against ' + names.length + ' defined class names over ' + indexFileCount(index) + ' sheet FILES (' + index.size + ' index keys: shared sheets are spelled two ways on purpose); ' + inert.length + ' inert; ' + noSheets.length + ' entries cite no indexed sheet; floor 100 of baseline 108',
  );
  // Extended, not replaced: the arm already printed graded/inert; it now also
  // prints how many of those graded values are rescued by a credit, and WHICH
  // prefix and names did the rescuing, so an entry that credits nothing is
  // distinguishable from one that credits a family it does not own.
  console.log(
    'prefix credit: ' + credited.size + ' of ' + graded + ' graded values credit at least one class defined inside the sheets their own entry cites',
  );
  // The split, printed beside the number it splits. `prefix credit` counts css ∪ parentCss; the
  // dead-class walk above takes own `css` alone (`ownIndex` at :1794-1797, `parentPaths` only
  // into `definedIndex` at :1798-1800), so a value can be credited to one reading and invisible
  // to the other in the same run, and until now the only way to find that out was to read both
  // implementations and reason about it -- which is how it became an argument in a plan doc.
  // Measured rather than assumed before this line was written: a probe over today's ledger found
  // exactly 4 such values, all four the StockCountDetail copy of the badge family
  // (sc-badge--draft / --in_progress / --completed / --cancelled), each crediting ONE class, in
  // inventory/StockCountBadge.css, the sheet 960d00568 hoisted out of StockCountsScreen.css;
  // 0 of them in StockCountDetail.css. It also found two values NOT counted here because they
  // credit both halves -- KdsScreen :: kds-ticket (own 40, parent 3) and :: kds-workspace
  // (own 3, parent 1) -- and it did NOT find sc-add-line-item-- (1 own) or sc-diff- (2 own).
  // Neither half is made authoritative: no expect() reads this list, nothing in graded /
  // credited / inert / residual moves, and the number is a print, not a ruling.
  console.log(
    'prefix credit split: PARENT-ONLY-CREDITED ' + parentOnly.length + ' of ' + graded + ' graded value(s) credit a class that exists ONLY in a sheet their entry cites as parentCss — 0 credit in the entry\'s own css, so the dead-class walk never sees them and this arm counts them as credit; neither reading is overruled and both are printed || the other half of the split is ' + (credited.size - parentOnly.length) + ' of ' + graded + ' with at least one own-css class, sum check ' + parentOnly.length + ' + ' + (credited.size - parentOnly.length) + ' = ' + credited.size + ' credited',
  );
  // Named one per line, in the census's own shape (RESCUED <entry>: <cls> (only claim: ...)),
  // because a count of this without the membership beside it is a number somebody will re-take.
  for (const v of parentOnly.slice().sort()) console.log('  PARENT-ONLY  ' + v);
  console.log(
    'prefix arm arithmetic: ' + graded + ' graded = ' + credited.size + ' credited + ' + inert.length + ' inert + ' + uncreditedLive.length + ' residual [site-only pass, no class of their own in the entry\'s own sheets] — ' + (uncreditedLive.join(' ; ') || 'none') + ' || residual=' + uncreditedLive.length + ', of which citing nothing resolvable=' + uncreditedLive.filter((u) => u.includes('LEDGER HOLE')).length + ', sum check ' + (credited.size + inert.length + uncreditedLive.length) + '=' + graded,
  );
  for (const [site, hits] of [...credited.entries()].sort()) {
    console.log('  credit ' + site + ' x' + hits.length + (hits.length <= 6 ? ': ' + hits.join(', ') : ''));
  }
  // Floors, so no green can come from an empty walk or a shrunk population.
  expect(index.size).toBeGreaterThan(100);
  expect(names.length).toBeGreaterThan(100);
  // MAGNITUDE floor, not an existence floor. An existence floor (`> 50`) let a ledger whose
  // arrays were emptied one entry at a time stay green while grading almost nothing, and the
  // arm's own verdict is `inert` toEqual `[]` — an empty against an empty passes on NOTHING,
  // so the failure this arm exists to catch would have read as a clean tree. Headroom is named
  // from the measured value, not invented: `graded` read **108** on 2026-09-15 at tip
  // `766fed704` (`cd ui && npx vitest run src/__tests__/screenExtraction.test.ts` prints it),
  // so 100 is ~7% of slack for a struck inert prefix (this box's own kind of edit struck 0) and
  // fires long before the arm loses the power to disagree with anything.
  expect(graded, 'inert-prefix arm graded only ' + graded + ' dynamicClassPrefixes values against a baseline of 108 (measured 2026-09-15 at 766fed704; floor is 100 with that headroom named in this message) — the population shrank, so a green here would be a toEqual of an empty against an empty grading nothing. Re-take the baseline with the same scoped run and change this number ON PURPOSE.').toBeGreaterThanOrEqual(100);
  // Missing data first, bad data second: a ledger hole is not an allowance, and an entry that
  // cites no sheet must never be allowed to speak for the tree.
  expect(noSheets, noSheets.length + ' dynamicClassPrefixes entr(ies) read 0 class names from their own citation, so their prefixes were NOT graded on the rule side at all (fix the citation, do not strike the prefixes): ' + noSheets.join(' | ')).toEqual([]);
  expect(inert, 'inert dynamicClassPrefixes allowances (each mutes a family nothing can reach; a ledger hole is reported separately above, never here): ' + inert.join(' | ')).toEqual([]);
  // The arithmetic the two prints advertise has to close, or the prints are approximately
  // right and one graded value vanished through a branch nobody named.
  expect(
    credited.size + inert.length + uncreditedLive.length,
    'prefix arm arithmetic does not close: ' + credited.size + ' credited + ' + inert.length + ' inert + ' + uncreditedLive.length + ' site-only = ' + (credited.size + inert.length + uncreditedLive.length) + ' against ' + graded + ' graded — a graded value sits in none of the three lists (or one entry declares the same prefix twice, which the credit Map keys away), so the print is not auditable.',
  ).toBe(graded);
});

// ── Citation resolution for the prefix arm ───────────────────────
//
// allSheetIndex() strips a leading `features/` from every key it writes (:1878), so
// `frontend/themes/components.css` IS a key and `../frontend/themes/components.css` — the
// form this ledger's own parentCss contract at :123 permits — can NEVER be one. The citation
// case resolves that form by hand (:1653, :2050); the prefix arm compares cited paths against
// index keys, so for such an entry the shared sheet is silently absent from ownClasses. A
// wholly-empty set was caught by noSheets; one real sheet plus one unresolvable cite was not,
// and a credit lost that way leaves no trace in any print. This is the check that names it.
it('every sheet a ledger entry cites is an allSheetIndex key the prefix arm can read', () => {
  const index = allSheetIndex();
  const unresolvable: string[] = [];
  let cited = 0;
  for (const entry of SCREENS) {
    for (const p of [...entry.css, ...(entry.parentCss ?? [])]) {
      cited += 1;
      if (index.has(p)) continue;
      const stripped = p.replace(/^(\.\.\/)+/, ''); // ../ is what parentCss may legitimately carry; the key never does
      unresolvable.push(
        entry.name + ': cites ' + p + ' — not a key among the ' + index.size + ' indexed sheets' + (index.has(stripped) ? ' (the same sheet IS indexed as ' + stripped + ', so nothing about the family is missing: only the lookup misses)' : ' (no sheet of that name is indexed at all)') + '; the prefix arm therefore graded this entry WITHOUT that shared sheet in ownClasses. Rewrite the string to the bare key form is NOT the fix — the citation case at :1653/:2050 joins cites onto FEATURES_DIR and special-cases only the ../frontend/themes/ grammar, so the bare key throws ENOENT there. Make the arm resolve a cite the way those two do (or index it under both), and do not strike the prefix.',
      );
    }
  }
  console.log(
    'cited-key arm: ' + SCREENS.length + ' entries, ' + cited + ' cited sheet path(s), ' + unresolvable.length + ' that never match an index key (over ' + indexFileCount(index) + ' sheet files / ' + index.size + ' keys)',
  );
  for (const u of unresolvable) console.log('  uncited ' + u);
  expect(unresolvable, unresolvable.length + ' ledger citation(s) cannot be graded by the prefix arm because the path is not an allSheetIndex key: ' + unresolvable.join(' | ')).toEqual([]);
});

// ── Anti-drift for the two spellings ─────────────────────────────
//
// The citation finding above was closed by making the INDEX resolvable from both spellings,
// not by rewriting the ledger — the data is a cite grammar two other cases depend on, and
// probeB showed the bare form dies on ENOENT in the extractor case. A fix that lives in one
// function is a fix one refactor can undo: dropping the alias line takes the citation case
// back to green-with-4-ungradeable-entries and moves nothing else. So this case derives the
// shared-sheet population from DISK, independently of allSheetIndex, and requires every one of
// them to be present under BOTH keys carrying the SAME class names, plus the same distinct-name
// population whichever spelling a reader walks. 32 shared sheets is the measured count at
// 2026-09-15 (`find src -name '*.css' | grep -vc '^src/features/'` from ui/), so the floor is
// 20 with headroom named from that.
it('every shared sheet is indexed under both its bare key and its parent-relative key', () => {
  const index = allSheetIndex();
  const root = path.resolve(process.cwd(), 'src');
  const shared: string[] = [];
  const collect = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === '__tests__' || ent.name === 'node_modules') continue;
        collect(full);
      } else if (ent.name.endsWith('.css')) {
        const rel = path.relative(root, full).replace(/\\/g, '/');
        if (!rel.startsWith('features/')) shared.push(rel);
      }
    }
  };
  collect(root);
  const missing: string[] = [];
  const drifted: string[] = [];
  const bareNames = new Set<string>();
  const parentNames = new Set<string>();
  for (const rel of shared) {
    const bare = index.get(rel);
    const parent = index.get('../' + rel);
    if (!bare || !parent) {
      missing.push(rel + ' (bare key ' + (bare ? 'present x' + bare.size : 'ABSENT') + ', parent key ' + (parent ? 'present x' + parent.size : 'ABSENT') + ')');
      continue;
    }
    for (const n of bare) bareNames.add(n);
    for (const n of parent) parentNames.add(n);
    if (bare !== parent) {
      const x = [...bare].sort().join(',');
      const y = [...parent].sort().join(',');
      if (x !== y) drifted.push(rel + ' (' + bare.size + ' names via bare key vs ' + parent.size + ' via parent key)');
    }
  }
  console.log(
    'dual-spelling arm: ' + shared.length + ' sheet(s) outside src/features indexed under both spellings, ' + missing.length + ' missing one, ' + drifted.length + ' whose two keys disagree; population ' + bareNames.size + ' distinct class names via bare keys = ' + parentNames.size + ' via parent keys',
  );
  expect(shared.length, 'only ' + shared.length + ' shared sheets found on disk — the walk that defines this population changed, so a two-spelling index cannot be graded against it (baseline 32, floor 20)').toBeGreaterThanOrEqual(20);
  expect(missing, missing.length + ' shared sheet(s) indexed under only ONE spelling, so a cite written the other way resolves to nothing: ' + missing.join(' | ')).toEqual([]);
  expect(drifted, drifted.length + ' shared sheet(s) whose bare and parent keys carry DIFFERENT class names: ' + drifted.join(' | ')).toEqual([]);
  expect(parentNames.size, 'the same sheets read through the two spellings gave different distinct-name populations (bare ' + bareNames.size + ' vs parent ' + parentNames.size + ')').toBe(bareNames.size);
});
