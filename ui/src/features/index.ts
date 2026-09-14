import { registerSalesFeature } from './sales/register';
import { registerProductsFeature } from './products/register';
import { registerInventoryFeature } from './inventory/register';
import { registerCustomersFeature } from './customers/register';
import { registerGiftCardsFeature } from './gift-cards/register';
import { registerLoyaltyFeature } from './loyalty/register';
import { registerStaffFeature } from './staff/register';
import { registerTerminalsFeature } from './terminals/register';
import { registerStoresFeature } from './locations/register';
import { registerSettingsFeature } from './settings/register';
import { registerTaxFeature } from './tax/register';
import { registerCurrencyFeature } from './currency/register';
import { registerCategoriesFeature } from './categories/register';
import { registerAuditFeature } from './audit/register';
import { registerOfflineFeature } from './offline/register';
import { registerShiftsFeature } from './shifts/register';
import { registerReportsFeature } from './reports/register';
import { registerAnalyticsFeature } from './analytics/register';
import { registerDesignFeature } from './design/register';
import { registerKdsFeature } from './kds/register';
import { registerKioskFeature } from './kiosk/register';
import { registerTablesFeature } from './tables/register';
import { registerPromotionsFeature } from './promotions/register';
import { registerPurchasingFeature } from './purchasing/register';
import { registerStockTransfersFeature } from './stock-transfers/register';
import { registerWarehouseFeature } from './warehouse/register';
import { registerMemoFeature } from './memo/register';

/**
 * Register all UI features, pages, navigation items, and widgets.
 *
 * Eight feature directories have NO register.ts/tsx. That is not one reason
 * but four, and the difference matters to anyone deciding whether a directory
 * is dead. Reproduce the set before trusting this sentence:
 *   for d in src/features/*; do [ -d "$d" ] || continue; [ -f "$d/register.tsx" ] || [ -f "$d/register.ts" ] || echo "$d"; done
 *   (the -d guard is load-bearing: without it src/features/index.ts itself
 *   matches and the list reads nine)
 *
 * (1) Five are NOT navigable pages — AppShell renders them directly, as gate
 *     screens, workspace-specific layouts, or pre-condition flows:
 *
 *   auth/       — StaffLoginScreen, SessionLockScreen, LicenseActivationScreen,
 *                 CreatePinScreen: gate screens rendered before page routing.
 *   restaurant/ — RestaurantMenu: sub-component used inside PosScreen,
 *                 not a standalone navigable page.
 *   retail/     — RetailPosScreen: rendered by AppShell for store-pos
 *                 workspace, not through the page registry.
 *   setup/      — SetupWizard: rendered by AppShell before setup is
 *                 completed, never a navigable route.
 *   workspaces/ — WorkspaceHome: rendered by AppShell when no workspace
 *                 is selected; it is the workspace picker, not a page.
 *
 * (2) pos/ holds NO screen, so it can never gain a register.tsx — there is no
 *     route, nav item, or page to register. It is the shared-primitive home
 *     for the two POS stacks, consumed by features/sales/PosScreen.tsx and
 *     features/retail/RetailPosScreen.tsx. Today it holds exactly one file,
 *     components/CartTaxWatcher.tsx (keyed cart-tax watcher: four props,
 *     renders null). Rule for anything under pos/: consumer-only, shared by
 *     both stacks, so a change to a pos/ file is its OWN commit by one named
 *     owner and is never bundled with a sales or retail edit.
 *
 * (3) sync/ is a live screen reached the lazy way: SettingsPage.tsx:51
 *     lazy(() => import('../sync/SyncConflictReviewScreen')) and renders it at
 *     :667 as a settings section. It has no register because it is not a
 *     top-level page. This is the case a bare "no register" reading gets
 *     backwards — see AGENTS.md, "Is this screen dead code? needs three greps".
 *
 * (4) marketplace/ is the one entry this file cannot close: AddonsMarketplace.tsx
 *     has no register.tsx and, on the three greps above (component name,
 *     route: '<x>', lazy import path), no importer outside its own file and its
 *     tests. Recorded as UNRESOLVED, not as dead code — that distinction is the
 *     whole point of item (3), and a false "not routed, delete it" reading has
 *     already cost this repo a review pass. Whoever owns it should either
 *     register it or say so here.
 */
export function registerAllFeatures() {
  registerSalesFeature();
  registerProductsFeature();
  registerInventoryFeature();
  registerCustomersFeature();
  registerGiftCardsFeature();
  registerLoyaltyFeature();
  registerStaffFeature();
  registerTerminalsFeature();
  registerStoresFeature();
  registerSettingsFeature();
  registerTaxFeature();
  registerCurrencyFeature();
  registerCategoriesFeature();
  registerAuditFeature();
  registerOfflineFeature();
  registerShiftsFeature();
  registerReportsFeature();
  registerAnalyticsFeature();
  registerDesignFeature();
  registerKdsFeature();
  registerKioskFeature();
  registerTablesFeature();
  registerPromotionsFeature();
  registerPurchasingFeature();
  registerStockTransfersFeature();
  registerWarehouseFeature();
  registerMemoFeature();
}
