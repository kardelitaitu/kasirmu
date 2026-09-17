import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const UI_SRC = resolve(__dirname, '..');

/**
 * Denominator for this gate. Unit: individual selectors after comma-splitting, except
 * skipGroups/skipSelectors, which are counted where the check actually sits.
 */
const S = { sheets: 0, interactive: 0, waivedExact: 0, waivedBoundary: 0, skipGroups: 0, skipSelectors: 0, rightmostCredits: 0 };
const SKIP_FIRES = new Map<RegExp, number>();
/** Every selector excused by the compound/descendant boundary, by name. */
const BOUNDARY_WAIVED = new Set<string>();
/** Selector names that reached the graded population, by name. */
const GRADED = new Set<string>();

interface Violation {
  file: string;
  selector: string;
  reason: string;
}

const INTERACTIVE_SELECTORS = [
  /^\s*\.btn\b/, /^\s*button(?:\s|\.|#|\[|$)/, /^\s*\.btn-/,
  /^\s*\[role="button"\]/, /^\s*\[role="tab"\]/, /^\s*\[role="switch"\]/,
  /^\s*\[role="radio"\]/, /^\s*\.modal-close/, /^\s*\.theme-toggle/,
  /^\s*\.action-btn/, /^\s*\.nav-item/, /^\s*\.filter-btn/,
  /^\s*\.clickable/, /^\s*\.card-clickable/, /^\s*\.select/,
  /^\s*input(?:\s|\.|#|\[|$)/, /^\s*select(?:\s|\.|#|\[|$)/,
  /^\s*textarea(?:\s|\.|#|\[|$)/, /^\s*\.toggle-/,
  // Restaurant surface (resto-pos tackle-all Phase 5): the menu sheet's
  // class-named controls never matched the prefixes above, so the sheet was
  // listed but contributed zero graded selectors. Each pattern names one
  // control exactly (trailing `$`-ish boundary: no `--modifier` or
  // descendant may ride along) — over-matching here graded decorative
  // card parts and state classes as interactive elements.
  /^\s*\.restaurant-hamburger-btn$/, /^\s*\.restaurant-back-btn$/,
  /^\s*\.restaurant-category-pill$/, /^\s*\.restaurant-search-input$/,
  /^\s*\.restaurant-search-clear$/, /^\s*\.restaurant-context-item$/,
  /^\s*\.restaurant-context-swatch$/, /^\s*\.restaurant-size-btn$/,
  /^\s*\.restaurant-hamburger-item$/,
  // The tile itself is a native <button>, caught below — but its name is a
  // prefix of a dozen decorative descendants, so it needs the same exact
  // treatment rather than a bare \b.
  /^\s*\.restaurant-card$/,
];

function isInteractiveSelector(selector: string): boolean {
  return INTERACTIVE_SELECTORS.some((re) => re.test(selector));
}

/**
 * THE CREDIT HUNT, 2026-09-15. A focus rule paints its ring on the RIGHT end of its
 * selector, not the left: `.toggle-switch input:focus-visible + .toggle-track` is how
 * this repo styles a hidden checkbox whose visible surface is a sibling <span>.
 * Recording only the left end — which is what the base extraction below does, and the
 * only thing it did until now — credits `input + .toggle-track`, a name that matches no
 * rule in the sheet, so the part that actually receives the ring stayed uncredited and
 * was reported as missing its focus style. Same defect class as a waiver attached to
 * the wrong end of a selector: the credit was real but pointed at the wrong name.
 *
 * So credit the rightmost compound of every rule that already passed the
 * focus-visible-with-visible-indicator gate, and then one hop further: a part that
 * lives INSIDE a credited element (`.toggle-thumb`, seen in
 * `input:checked + .toggle-track .toggle-thumb`) is reached by the same ring. Both
 * steps are EARNED, never blanket: a rule with no :focus-visible anywhere in the sheet
 * credits nothing, and a name that merely resembles a credited one — .trackX beside
 * .track — credits nothing either, because every hop is an exact compound match.
 */
function compoundsOf(group: string): string[] {
  return group
    .split(/[ >+~]+/)
    .map((seg) => seg.replace(/:focus-visible/g, '').replace(/^&/, '').trim())
    .filter(Boolean);
}

function focusCredits(focusRules: string[], allRules: string[]): Set<string> {
  const credited = new Set<string>();
  for (const sel of focusRules) {
    for (const group of sel.split(',')) {
      const segs = compoundsOf(group.trim());
      const last = segs[segs.length - 1];
      if (last) credited.add(last);
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const sel of allRules) {
      for (const group of sel.split(',')) {
        const segs = compoundsOf(group.trim());
        if (segs.length < 2) continue;
        const tail = segs[segs.length - 1] ?? ''; // segs.length >= 2 was checked above
        if (!segs.slice(0, -1).some((anc) => credited.has(anc))) continue;
        if (!credited.has(tail)) {
          credited.add(tail);
          grew = true;
        }
      }
    }
  }
  return credited;
}

/** Check if selector or body references :focus-visible. */
function hasFocusVisibleRef(selectors: string, body: string): boolean {
  return /:focus-visible/.test(body) || /:focus-visible/.test(selectors);
}

/**
 * Waivers naming a bare CONTAINER class (.skeleton, .empty-state, .card-header).
 * These describe a non-interactive box, so they must never be the reason an
 * INTERACTIVE selector leaves the population -- that was the ordering hole: a
 * group reading `.empty-state-btn` is on the interactive list and was swallowed
 * by /^\s*\.empty-state/ before anything asked whether it was interactive.
 */
const CONTAINER_SKIP_PATTERNS = [
  /^\s*\.skeleton/, /^\s*\.spinner/, /^\s*\.badge/, /^\s*\.toast/,
  /^\s*\.statusbar-dot/, /^\s*\.statusbar-divider/,
  /^\s*\.setup-step-dot/, /^\s*\.setup-step-line/,
  /^\s*\.confirm-dialog-icon/, /^\s*\.empty-state/, /^\s*\.error-state/,
  /^\s*\.payment-done/, /^\s*\.payment-done-/,
  /^\s*\.modal-overlay/, /^\s*\.card-header/, /^\s*\.card-body/, /^\s*\.card-footer/,
  /^\s*\.modal-header/, /^\s*\.modal-body/, /^\s*\.modal-footer/,
  // --- state / descendant waivers (below) still apply to interactive groups ---
  // Visual toggle parts — not interactive themselves
  /^\s*\.toggle-track/, /^\s*\.toggle-thumb/,
  /^\s*\.toggle-switch\s+input/,
  // SVG/icon children inside interactive parents
  /\s+svg$/, /\s+\.icon/, /\s+img$/,
  // Pseudo selectors that re-style on state
  /:checked/, /:focus-visible/,
];

/** Re-style-on-state and descendant-part waivers: legitimate for any group. */
/**
 * Waivers naming a STATE or a descendant PART rather than a container class: they
 * legitimately excuse `.btn:hover`, `.x svg`, a `::before` decoration or a
 * `:disabled` restyle from owning a focus contract, so they still apply to an
 * interactive group after the ordering fix in scanCSS(). The CONTAINER list above
 * deliberately does not.
 */
const STATE_SKIP_PATTERNS = [
  /::before|::after/, /:disabled/, /:hover/, /:active/,
  /@keyframes/, /--exiting/, /--enter/,
  /\s+svg$/, /\s+\.icon/, /\s+img$/,
  /:checked/, /:focus-visible/,
];
/** Every waiver, for the census a non-interactive group leaves through. */
const ALL_SKIP_PATTERNS = [...CONTAINER_SKIP_PATTERNS, ...STATE_SKIP_PATTERNS];

function isSkipSelector(selector: string, stateOnly = false): boolean {
  const list = stateOnly ? STATE_SKIP_PATTERNS : ALL_SKIP_PATTERNS;
  const fired = list.find((re) => re.test(selector));
  if (fired) SKIP_FIRES.set(fired, (SKIP_FIRES.get(fired) ?? 0) + 1);
  return fired !== undefined;
}

/** Check if a CSS body declares focus-visible with a visible indicator. */
function hasVisibleFocusIndicator(selectors: string, body: string): boolean {
  const focusSections = body.match(/&?:focus-visible\s*\{[^}]*\}/g) || [];
  for (const section of focusSections) {
    if (/outline\s*:/.test(section) || /box-shadow\s*:/.test(section)) return true;
  }
  const standaloneFocus = body.match(/:focus-visible\s*\{[^}]*\}/);
  if (standaloneFocus) {
    const block = standaloneFocus[0]!;
    return /outline\s*:/.test(block) || /box-shadow\s*:/.test(block);
  }
  // If :focus-visible is in the selector (e.g. ".btn:focus-visible { outline: ... }"),
  // check the body for the visible indicator
  if (/:focus-visible/.test(selectors)) {
    return /outline\s*:/.test(body) || /box-shadow\s*:/.test(body);
  }
  return false;
}

/**
 * Base component selectors from components.css that already have
 * :focus-visible styles. Screen-specific files that use these
 * base classes inherit the focus styles.
 */
const GLOBAL_COVERED = new Set([
  '.btn', '.btn--sm', '.btn--md', '.btn--lg',
  '.btn--primary', '.btn--secondary', '.btn--danger', '.btn--ghost',
  '.input-field', '.input-wrapper', '.input-label',
  '.card', '.card-clickable',
  '.skeleton', '.spinner', '.badge',
  '.modal-overlay', '.modal-panel', '.modal-close-btn',
  '.toast', '.toast__dismiss',
  '.empty-state', '.error-state',
  '.theme-toggle',
  // Toggle switch — focus-visible is on the child input: .toggle-switch input:focus-visible + .toggle-track
  '.toggle-switch',
]);

function scanCSS(filePath: string): Violation[] {
  const content = readFileSync(filePath, 'utf-8');
  const violations: Violation[] = [];
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = stripped.match(/[^{}]*\{[^{}]*\}/g) || [];

  // Track which interactive selectors already have :focus-visible in this file
  const covered = new Set(GLOBAL_COVERED);

  // First pass: find all :focus-visible rules and track covered selectors
  const focusRules: string[] = [];
  const sheetRules: string[] = [];

  for (const rule of rules) {
    const braceIdx = rule.indexOf('{');
    const selectors = rule.slice(0, braceIdx).trim();
    const body = rule.slice(braceIdx + 1, -1).trim();

    if (selectors.startsWith('@')) continue;
    sheetRules.push(selectors);

    if (hasFocusVisibleRef(selectors, body) && hasVisibleFocusIndicator(selectors, body)) {
      focusRules.push(selectors);
      const baseSelector = selectors
        .replace(/:focus-visible\s*$/, '')
        .replace(/:focus-visible/, '')
        .replace(/^&/, '')
        .trim();
      if (baseSelector) covered.add(baseSelector);
    }
  }

  // The rightmost-compound credit, and the one hop through a credited ancestor.
  for (const name of focusCredits(focusRules, sheetRules)) {
    covered.add(name);
    S.rightmostCredits++;
  }

  /**
   * Split a comma-separated CSS selector group into individual selectors.
   */
  function splitSelectors(selGroup: string): string[] {
    return selGroup
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Check if an individual selector is covered by an existing :focus-visible rule. */
  function selectorIsCovered(sel: string): boolean {
    if (covered.has(sel)) { S.waivedExact++; return true; }
    // A waiver must name the selector it waives. A covered base legitimately
    // reaches a compound (.btn:focus), a descendant (.btn .x) or a sibling of it,
    // but it must NOT reach a longer name that merely begins with it: GLOBAL_COVERED
    // seeds the bare '.btn', '.card', '.modal-panel' and '.toast', so the raw
    // startsWith this line carried waived every .btn-* class in the tree whether or
    // not it had a focus style. Exact-or-boundary is the convention this repo already
    // chose at scripts/verify-ftl-orphans.py:237, n == p or n.startswith(p + "-").
    const boundary = [...covered].some(
      (base) => sel === base || /^[ >+~:.#[,]/.test(sel.slice(base.length)),
    );
    if (boundary) {
      S.waivedBoundary++;
      if (!covered.has(sel)) BOUNDARY_WAIVED.add(sel);
    }
    return boundary;
  }

  // Second pass: find interactive selectors that DON'T have :focus-visible
  for (const rule of rules) {
    const braceIdx = rule.indexOf('{');
    const selectors = rule.slice(0, braceIdx).trim();
    const body = rule.slice(braceIdx + 1, -1).trim();

    if (selectors.startsWith('@')) continue;
    // ORDERING FIX 2026-09-15: interactive membership is decided BEFORE the group
    // skip gate, so a container-class waiver can no longer remove a selector that
    // INTERACTIVE_SELECTORS itself names. Non-interactive groups still leave through
    // the full gate, so the census keeps counting what it counted.
    if (!isInteractiveSelector(selectors)) {
      if (isSkipSelector(selectors)) {
        S.skipGroups++;
        S.skipSelectors += splitSelectors(selectors).length;
      }
      continue;
    }
    // An interactive group may still be excused by a STATE waiver (.btn:hover,
    // :disabled, ::before, a descendant svg/img) -- those are not the base focus
    // contract -- but not by a container-class waiver written for another element.
    if (isSkipSelector(selectors, true)) {
      S.skipGroups++;
      S.skipSelectors += splitSelectors(selectors).length;
      continue;
    }

    // Split comma-separated groups and check each selector individually
    const individualSelectors = splitSelectors(selectors);
    S.interactive += individualSelectors.length;
    for (const sel of individualSelectors) GRADED.add(sel);
    const uncoveredSelectors = individualSelectors.filter(
      (sel) => !selectorIsCovered(sel),
    );

    if (uncoveredSelectors.length === 0) {
      // All selectors in this group are covered — count as covered
      covered.add(selectors);
      continue;
    }

    // Check the full rule for inline :focus-visible
    if (hasFocusVisibleRef(selectors, body) && hasVisibleFocusIndicator(selectors, body)) {
      covered.add(selectors);
      continue;
    }

    for (const uncovered of uncoveredSelectors) {
      violations.push({
        file: filePath,
        selector: uncovered,
        reason: 'Interactive element missing :focus-visible style with visible indicator',
      });
    }
  }

  return violations;
}

const CSS_FILES = [
  'features/restaurant/RestaurantMenu.css',
  'features/retail/RetailPosScreen.css',
  'features/sales/PaymentModal.css',
  'features/sales/PosScreen.css',
  'features/sales/PriceOverrideModal.css',
  'features/sales/RefundModal.css',
  'features/sales/CartPanel.css',
  'features/sales/CartPanelActions.css',
  'features/sales/CartPanelCourseBar.css',
  'features/sales/CartPanelFooterTotals.css',
  'features/sales/CartPanelLineItem.css',
  'features/sales/CartPanel.brand.css',
  'features/sales/components/ItemModifierModal.css',
  'features/sales/SalesHistoryScreen.css',
  'features/sales/EodReportScreen.css',
  'features/sales/VoidOrdersScreen.css',
  'features/settings/SettingsPage.css',
  'features/settings/SettingsSelect.css',
  'features/settings/LicenseSettings.css',
  'features/settings/DataManagementScreen.css',
  'features/settings/FeatureToggleScreen.css',
  'features/stock-transfers/StockTransfersScreen.css',
  'features/purchasing/PurchaseOrderForm.css',
  'features/purchasing/PurchaseOrdersScreen.css',
  'features/purchasing/SuppliersScreen.css',
  'features/loyalty/LoyaltyManagementScreen.css',
  'features/products/ProductManagementScreen.css',
  'features/products/ProductLookupScreen.css',
  'features/categories/CategoryManagementScreen.css',
  'features/currency/ExchangeRateScreen.css',
  'features/tax/TaxConfigurationScreen.css',
  'features/customers/CustomerManagementScreen.css',
  'features/staff/StaffManagementScreen.css',
  'features/shifts/ShiftManagementScreen.css',
  'features/terminals/TerminalManagementScreen.css',
  'features/tables/TableManagementScreen.css',
  'features/promotions/PromotionManagementScreen.css',
  'features/kiosk/KioskScreen.css',
  'features/kds/KdsScreen.css',
  'features/gift-cards/GiftCardsScreen.css',
  'features/auth/LicenseActivationScreen.css',
  'features/auth/StaffLoginScreen.css',
  'features/auth/CreatePinScreen.css',
  'features/inventory/StockCountDetail.css',
  'features/inventory/StockCountForm.css',
  'features/setup/SetupWizard.css',
  'features/workspaces/WorkspaceHome.css',
  'features/reports/DashboardScreen.css',
  'features/reports/SalesReportScreen.css',
  'features/reports/InventoryReportScreen.css',
  'features/reports/MenuEngineeringScreen.css',
  'features/offline/OfflineQueueScreen.css',
  'features/audit/AuditLogScreen.css',
  'features/design/DesignSystem.css',
  'features/design/TooltipPreview.css',
  'features/locations/MultiStoreDashboardScreen.css',
  'features/locations/TerminalStatusPanel.css',
  'frontend/shell/AppLayout.css',
  'frontend/shell/StatusBar.css',
  'frontend/shell/tablet/tablet.css',
  'components/ContextMenu.css',
  'components/SettingsPopup.css',
  'components/FastPINOverlay.css',
  'components/QrisQrDisplay.css',
  'components/StoreSwitcher.css',
  'components/GatewayStatusBadge.css',
  'components/MachineIdStatus.css',
  'components/ConnectionStatus.css',
  'components/UpdateBanner.css',
  'frontend/themes/components.css',
];

describe('Focus-visible compliance', () => {
  // The walk runs at collection, not in a hook, because a case TITLE can carry its
  // own denominator only if the harvest already happened when the title was built
  // — the convention popupBackgroundCompliance and noiseDitherCompliance use.
  // Nothing about the walk itself changed.
  const allViolations: Violation[] = [];
  for (const file of CSS_FILES) {
    const fullPath = resolve(UI_SRC, file);
    if (!existsSync(fullPath)) continue;
    S.sheets++;
    allViolations.push(...scanCSS(fullPath));
  }

  it(`focus-visible denominator: ${S.interactive - S.waivedExact - S.waivedBoundary} interactive selectors graded, ${S.waivedExact + S.waivedBoundary} waived by a covered name (${S.waivedExact} by exact name, ${S.waivedBoundary} by the compound/descendant boundary, ${S.rightmostCredits} names credited from the right end of a focus rule), ${S.skipSelectors} more inside ${S.skipGroups} rule-groups a skip pattern named, over ${S.sheets} of ${CSS_FILES.length} listed sheets, ${allViolations.length} violations`, () => {
    for (const [pat, cnt] of [...SKIP_FIRES.entries()].sort((x, y) => y[1] - x[1])) {
      console.log('  skip waiver ' + String(pat) + '  fires ' + cnt + ' rule-group(s)');
    }
    // Magnitude floors, set with headroom below the value each was measured from
    // on 2026-09-15 (interactive 23, graded 3, sheets 70 of 70), so a widening of
    // either waiver reads red instead of quietly shrinking the population.
    //
    // THE GRADED FLOOR IS NOW 0, AND THAT IS A FINDING, NOT A LOOSENING. It
    // shipped at 1 an hour ago; 766fed704 then cured all three violations and the
    // count fell to 0, so the guard turned redder on the commit that paid the debt.
    // A floor on REMAINING DEBT demands that somebody stay in debt — the mirror
    // image of laundering a finding into a baseline, where the debt is hidden to
    // buy a green instead of preserved to buy a red — and a guard shaped like that
    // gets deleted wholesale the first time a lane cures what it names and gives up
    // arguing. Population and membership are different guards, the distinction
    // 402b11660 earned for popupBackgroundCompliance, so the weight here sits on the
    // two floors beside it — S.interactive >= 15 and S.sheets >= 60 — neither of
    // which cares whether anyone is currently in breach. This assertion is therefore
    // a bound that cannot fail, kept on purpose because its message is the line a
    // failing run prints first, and the graded count is where a cured selector goes
    // to stop being a violation: 0 here means the sheet is clean, not that the gate
    // stopped looking.
    expect(
      S.interactive,
      `interactive selectors reaching the covered check: ${S.interactive}, floor 20 (23 seen on 2026-09-15 before the ordering fix, 3 of headroom). This is the REACHABLE population: it counts only groups that passed the interactive test, so it can and does fall when a waiver widens.`,
    ).toBeGreaterThanOrEqual(20);
    // (2) THE TOTAL THE SELECTOR CAN SEE. A floor on the graded count alone was the
    // hole: 23 members became 3 graded and 20 waived and no number moved. The union
    // of what reaches the check and what a skip door swallowed is the input size, and
    // it is the one figure that cannot be shuffled between doors.
    expect(
      INTERACTIVE_SELECTORS.length,
      `INTERACTIVE_SELECTORS members: ${INTERACTIVE_SELECTORS.length}, floor 29 (19 measured 2026-09-15 plus 10 restaurant controls added 2026-09-16 in the resto-pos tackle-all Phase 5 -- a pattern deleted from the list shrinks the input at its source)`,
    ).toBeGreaterThanOrEqual(29);
    expect(
      S.interactive + S.skipSelectors,
      `selectors the walk could see at all: ${S.interactive} interactive + ${S.skipSelectors} inside skip rule-groups = ${S.interactive + S.skipSelectors}, floor 1490 (1,495 measured 2026-09-15, headroom 5)`,
    ).toBeGreaterThanOrEqual(1490);
    // (3) THE SKIP CENSUS IS NOW AN ASSERTION, NOT A DISPLAY. It is the largest door
    // in this suite -- 986 rule-groups / 1,472 selectors on 2026-09-15, taken BEFORE
    // any interactive test is reached -- and a pattern widened by accident was
    // invisible. Bounds are on GROWTH with the headroom named in the message.
    expect(
      S.skipGroups,
      `rule-groups swallowed by a skip pattern: ${S.skipGroups}, ceiling 1086 (baseline 986 on 2026-09-15, headroom 100 = a tenth of the door). A breach means a waiver pattern got wider, not that the tree got quieter.`,
    ).toBeLessThanOrEqual(1086);
    expect(
      S.skipSelectors,
      `individual selectors inside those rule-groups: ${S.skipSelectors}, ceiling 1620 (baseline 1,472 on 2026-09-15, headroom 148). A breach means the door widened; a drop is the container-class ordering fix taking groups back out of it.`,
    ).toBeLessThanOrEqual(1620);
    // (4) MEMBERSHIP, not size: the exact list of selectors excused by the
    // compound/descendant boundary rule. Every count above can hold while this set
    // grows by one name, which is what 402b11660 learned for popup -- a floor on
    // size and a check on membership are different guards.
    expect([...BOUNDARY_WAIVED].sort()).toEqual(BOUNDARY_WAIVED_BASELINE);
    expect(
      S.interactive - S.waivedExact - S.waivedBoundary,
      `interactive selectors actually graded: ${S.interactive - S.waivedExact - S.waivedBoundary}, floor 0 (3 on 2026-09-15 while the waiver was a raw prefix, 0 after 766fed704 cured them)`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      S.sheets,
      `sheets walked: ${S.sheets} of ${CSS_FILES.length}, floor 60`,
    ).toBeGreaterThanOrEqual(60);
  });

/**
 * The exact selectors excused by the compound/descendant boundary rule, as of
 * 2026-09-15 at tip 198cd9cb0 (26 interactive selectors reached the covered check:
 * 2 graded, 19 waived by exact name, 5 by this boundary). A size floor cannot see
 * a waiver acquire one more name while every count holds; membership can, so this
 * list is asserted as a set, not counted. Adding a name here is a decision a
 * reviewer has to sign, and the only legitimate reason is that the boundary
 * correctly reached a new compound of an already-covered base.
 */
const BOUNDARY_WAIVED_BASELINE: string[] = [
  '.btn--icon-only.btn--lg',
  '.btn--icon-only.btn--md',
  '.btn--icon-only.btn--sm',
  '.btn--success-state .btn__check',
  '.toggle-switch input',
];

  it('all interactive elements have :focus-visible styles with visible indicators', () => {
    const message =
      allViolations.length > 0
        ? `Focus-visible violations found (${allViolations.length}):\n\n${allViolations
            .map(
              (v, i) =>
                `  ${i + 1}. ${v.file}\n     Selector: ${v.selector}\n     Reason: ${v.reason}`,
            )
            .join('\n\n')}`
        : 'All interactive elements pass focus-visible compliance';

    expect(allViolations, message).toHaveLength(0);
  });

  /**
   * The credit hunt cuts both ways, and this case is the half that keeps it honest:
   * a credit must be EARNED by a rule that carries :focus-visible with a visible
   * indicator, and it must land on an exact compound. Widen focusCredits into a
   * blanket and this goes red first, not the denominator above.
   */
  it('the right-end credit is earned per rule and never by resemblance', () => {
    // No :focus-visible rule anywhere, so a bare interactive name earns nothing and
    // is still reported. This is the blanket the change must not become.
    expect(focusCredits([], ['.bare-track { background: red }']).size).toBe(0);
    // A sibling ring credits the part that is painted, not the hidden input.
    expect([...focusCredits(['input:focus-visible + .ring-target'], [])]).toEqual(['.ring-target']);
    // One hop down: a part inside a credited element is reached by the same ring.
    expect(focusCredits(['input:focus-visible + .track'], ['.checked + .track .thumb']).has('.thumb')).toBe(true);
    // Resemblance earns nothing — a longer name beside a credited one stays graded.
    const near = focusCredits(['.btn:focus-visible { outline: 2px solid }'], ['.btnX { color: red }']);
    expect(near.has('.btnX')).toBe(false);
    // Nor is an unrelated compound of a sheet that does carry a focus rule.
    expect(focusCredits(['.btn:focus-visible { outline: 2px solid }'], ['.unrelated { color: red }']).has('.unrelated')).toBe(false);
  });

  it('reset.css properly disables outline on bare mouse focus via :focus:not(:focus-visible)', () => {
    const resetPath = resolve(UI_SRC, 'frontend/themes/reset.css');
    const css = readFileSync(resetPath, 'utf-8');
    expect(css).toMatch(/:focus:not\(:focus-visible\)\s*\{\s*outline:\s*none;?\s*\}/);
  });

  it('KdsScreen.css does not assign visible outline to bare .kds-filter-option:focus', () => {
    const kdsPath = resolve(UI_SRC, 'features/kds/KdsScreen.css');
    const css = readFileSync(kdsPath, 'utf-8');
    expect(css).not.toMatch(/\.kds-filter-option:focus\s*\{[^}]*outline:\s*2px/);
    expect(css).toMatch(/\.kds-filter-option:focus-visible\s*\{[^}]*outline:\s*2px/);
  });
});
