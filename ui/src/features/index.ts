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
 * Five feature directories intentionally have NO register.ts/tsx because
 * they are NOT navigable pages — they are rendered directly by AppShell
 * as gate screens, workspace-specific layouts, or pre-condition flows:
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
