// ── A bare token guard must be a LOAD, and loads are named ───────────────
//
// The defect shape:
//
//     const handleSave = useCallback(async () => {
//       if (!sessionToken) return;                        // <-- silent
//       try { ... } catch (err) {
//         addToast({ ... l10nErrorMessage(err, ...) });   // <-- reports only here
//       }
//     });
//
// The handler reports on success and error, so the no-token branch is the one mute
// path: the modal stays open, the button looks dead, and the operator cannot tell
// "session lapsed" from "the till is stuck".
//
// Rounds 42-65 fixed this one file at a time — StockShortfallDialog (0b9e88694), the
// restaurant screens (22d42992d), the EDC cards (20ea5627), TableManagementScreen
// (b3eb795ee) — each by NAME, which is why the shape kept appearing somewhere new.
//
// ── Why this counts files rather than classifying handlers ──
//
// The obvious rule is "a bare guard inside an action must report", and it needs the
// enclosing function's name. That extraction is not reliable: searching backwards for
// the nearest \`const\`/\`function\` finds NESTED declarations (a \`trapActive\` helper, an
// inner \`load\`) rather than the handler that owns the guard, so the classification is
// wrong often enough that a pass means nothing. Two earlier drafts of this file proved
// exactly that by reporting zero offenders against 152 real matches.
//
// So the rule is inverted: count the bare guards per FILE and require the set of files
// with any to be exactly this allowlist. Silence is legitimate only in a load, and a
// load is a property of the whole file rather than of one statement, which is what makes
// this checkable without the extraction.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const SRC = resolve(REPO, 'ui/src');

/** The shape, built from a string so no regex-literal escaping is involved. */
const BARE_GUARD = new RegExp('if \\([^)]*!sessionToken[^)]*\\) return;', 'g');

/** Every production .ts/.tsx under ui/src, minus tests and dev mocks. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'dev-mock' || e.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(SRC);

/**
 * The debt: files that still carry a bare guard.
 *
 * NOT a claim that every guard in every one of these is a defect. The set is the
 * census, and separating a load from an action inside a file needs the enclosing
 * function, which is not reliably recoverable from source (see the header). So the
 * list is the honest unit: each file either still has the shape or does not, and a
 * fix deletes its row.
 */
// SHRINKS BY HAND. 63 -> 62 (round 67, RestaurantMenuEditorScreen) and 62 -> 61 (round 69,
// SalesHistoryScreen's three invoice actions). The second entry is the same loop: the
// guard failed on the stale row and named the file.
// SHRINKS BY HAND. 63 -> 62 on 2026-10-13 (round 67), when RestaurantMenuEditorScreen's
// three handlers were given a reporting guard and this ledger told me to delete the row.
// That is the intended loop: the guard fails on a stale entry, so a fix cannot leave the
// count wrong.
const DECLARED: string[] = [
  'components/OrgSwitcher.tsx',
  'components/StockAlertBell.tsx',
  'contexts/CurrencyWorkspaceSync.tsx',
  'features/audit/AuditLogScreen.tsx',
  'features/audit/SecurityTrailScreen.tsx',
  'features/design/DevToolbar.tsx',
  'features/inventory/ShiftBar.tsx',
  'features/inventory/ThresholdConfigScreen.tsx',
  'features/inventory/TransactionLogScreen.tsx',
  'features/kds/ExpoScreen.tsx',
  'features/kds/KdsCompletedView.tsx',
  'features/kds/KdsScreen.tsx',
  'features/kds/components/KdsDeviceStatusIndicator.tsx',
  'features/kds/hooks/useKdsPreferences.ts',
  'features/locations/MultiStoreDashboardScreen.tsx',
  'features/locations/TopologyScreen.tsx',
  'features/locations/topologyBranchLocationFields.tsx',
  'features/loyalty/LoyaltyManagementScreen.tsx',
  'features/memo/MemosScreen.tsx',
  'features/memo/useMemos.ts',
  'features/products/RecipeEditorModal.tsx',
  'features/restaurant/RestaurantMenu.tsx',
  'features/restaurant/screens/RestaurantPaymentsScreen.tsx',
  'features/restaurant/screens/RestaurantReceiptsScreen.tsx',
  'features/restaurant/screens/RestaurantSettingsScreen.tsx',
  'features/retail/EditProductModal.tsx',
  'features/retail/RetailPosScreen.tsx',
  'features/retail/hooks/useRetailColumnPrefs.ts',
  'features/sales/PaymentModal.tsx',
  'features/sales/PosScreen.tsx',
  'features/sales/hooks/usePosCartActions.ts',
  'features/sales/hooks/usePosHeldCarts.ts',
  'features/sales/payment/useAutoQr.ts',
  'features/sales/payment/useEdcTenderPhase.ts',
  'features/sales/useBarcodeScanner.ts',
  'features/sales/useCustomerDisplay.ts',
  'features/tables/TableManagementScreen.tsx',
  'features/settings/OverQuotaCard.tsx',
  'features/settings/SettingsPage.tsx',
  'features/settings/SyncConflictsPanel.tsx',
  'features/settings/components/EdcTerminalsCard.tsx',
  'features/settings/hooks/useDataSyncDraft.ts',
  'features/settings/screens/CreditFacilityCard.tsx',
  'features/settings/screens/DiagnosticExportCard.tsx',
  'features/settings/screens/LocalPaymentSettingsCard.tsx',
  'features/settings/screens/ReceiptFormatSettingsCard.tsx',
  'features/settings/screens/RegionalSettingsCard.tsx',
  'features/settings/screens/StatutoryNumberingCard.tsx',
  'features/settings/screens/UpdateSettingsCard.tsx',
  'features/settings/sections/DiagnosticsSection.tsx',
  'features/settings/sections/GeneralSection.tsx',
  'features/settings/sections/LocalApiSection.tsx',
  'features/settings/workspace-cards/TerminalPreferencesCard.tsx',
  'features/staff/components/RoleAuthoringPanel.tsx',
  'features/staff/components/StaffTrashPanel.tsx',
  'features/stock-transfers/StockTransfersScreen.tsx',
  'features/warehouse/WarehouseConsole.tsx',
  'features/warehouse/WarehouseCountFlow.tsx',
  'features/warehouse/useWarehouseScanner.ts',
  'hooks/useSessionKeepalive.ts',
  'hooks/useStoreTimezone.ts',
];

function offenders(): string[] {
  const out: string[] = [];
  for (const abs of files) {
    const rel = relative(SRC, abs).replace(/\\/g, '/');
    // No filtering here: the ledger comparison below is what decides, and a filter
    // inside the census would hide a file from BOTH directions of the check.
    void rel;
    const src = readFileSync(abs, 'utf-8');
    const n = (src.match(new RegExp(BARE_GUARD.source, 'g')) || []).length;
    if (n > 0) out.push(rel + ' (' + n + ')');
  }
  return out;
}

describe('a bare sessionToken guard is a load, not a silent action', () => {
  it('the set of files with a bare guard is exactly the declared debt', () => {
    // A DECLARED ledger, not a pass. 63 files carry 152 bare guards and the sweep is
    // not done, so the file states which ones rather than pretending the shape is gone.
    //
    // It fails in BOTH directions, which is what makes it a ledger rather than a
    // snapshot: a NEW file with the shape is a regression, and a FILE THAT IS FIXED must
    // be deleted from the list or the entry goes stale. Fixing is the only way this
    // number falls, and it must fall by hand — which is the point.
    const found = offenders().map((o) => o.replace(/ \(\d+\)$/, '')).sort();
    const declared = [...DECLARED].sort();
    expect(
      found.filter((f) => !declared.includes(f)),
      'NEW file(s) returning silently on a missing sessionToken. If the guard is in a LOAD ' +
        '(an effect, a fetch helper) add the file to DECLARED with the reason. If it is in a ' +
        'handler the user calls, report instead: ' +
        "if (!sessionToken) { addToast({ message: requiredLocalized(l10n, " +
        "'pos-toast-auth-required'), type: 'warning' }); return; }",
    ).toEqual([]);
    expect(
      declared.filter((f) => !found.includes(f)),
      'These files no longer have a bare guard — delete them from DECLARED so the ledger ' +
        'keeps telling the truth about what is left.',
    ).toEqual([]);
  });

  it('the scan is not vacuous', () => {
    // The reason this case exists: two drafts of this guard reported zero offenders
    // against a tree with 152 real matches, because the pattern had drifted and because
    // the classification was wrong. A count that cannot see the shape is not a check.
    expect(files.length).toBeGreaterThan(500);
    const total = files.reduce((acc, abs) => {
      const src = readFileSync(abs, 'utf-8');
      return acc + (src.match(new RegExp(BARE_GUARD.source, 'g')) || []).length;
    }, 0);
    expect(
      total,
      'the pattern no longer matches anything in the tree — it has drifted from the shape ' +
        'it is supposed to find, and the case above is passing for the wrong reason.',
    ).toBeGreaterThan(0);
    // And the allowlist must be a real, bounded set rather than everything.
    expect(DECLARED.length).toBeLessThan(files.length);
    expect(DECLARED.length).toBeLessThan(files.length);
  });
});
