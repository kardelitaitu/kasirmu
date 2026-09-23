// ── Mock-factory surface conformance ────────────────────────────────
//
// Mocks drift in two directions and only one of them is loud.
//
//   MISSING export  — the code calls something the mock does not define. Vitest
//                     reports this ("No "X" export is defined on the "..." mock"),
//                     and if the caller has a catch the run still goes green.
//   DEAD key        — the mock defines something the real module no longer
//                     exports. Completely silent. A test that arranges a response
//                     on a dead name configures nothing, and the component then
//                     reads a different, live function and gets the factory's
//                     default instead. The test asserts on data it believes it
//                     supplied.
//
// The dead direction is what this file catches, and it is not hypothetical: the
// ADR #7 scoped-command migration replaced `getShiftReport` with
// `getShiftReportScoped` and friends, and the shared factories kept the legacy
// names. ShiftManagementScreen.test.tsx still wires `getShiftReport` and
// `createCashPayout` -- both dead -- while the screen imports
// `createCashPayoutScoped`, which that file's mock does not define at all.
//
// RetailPosScreenInteractions.test.tsx had the same shape one step earlier: its
// factory returned 1 of @/api/kds's 21 exports, and the doc comment asserted the
// opposite of the truth ("RetailPosScreen only calls createKdsOrderFromSale",
// when PaymentModal calls the Scoped variant twice and the unscoped one zero
// times). Fixed in 0c60af50 by spreading the real module.
//
// Coverage is deliberately NOT asserted here. A factory that implements 9 of 24
// report functions is fine as long as nothing under test calls the other 15, and
// running the whole suite (418 files, 7885 tests) produces zero
// "export is defined" errors today. Requiring completeness would fail on
// perfectly working code and teach everyone to widen the assertion instead of
// fixing the mock. Dead keys, by contrast, are always wrong: they can never be
// reached.
//
// Run: cd ui && npx vitest run src/__tests__/mockFactorySurface.test.ts

import { describe, expect, it } from 'vitest';

import * as currencyApi from '@/api/currency';
import * as customersApi from '@/api/customers';
import * as giftCardsApi from '@/api/giftCards';
import * as hardwareApi from '@/api/hardware';
import * as kdsApi from '@/api/kds';
import * as loyaltyApi from '@/api/loyalty';
import * as productsApi from '@/api/products';
import * as reportsApi from '@/api/reports';
import * as salesApi from '@/api/sales';
import * as settingsApi from '@/api/settings';
import * as shiftsApi from '@/api/shifts';

import {
  createGiftCardsApiMock,
  createHardwareApiMock,
  createKdsApiMock,
  createLoyaltyApiMock,
  createProductsApiMock,
  createReportsApiMock,
  createSalesApiMock,
  createSettingsApiMock,
  createShiftsApiMock,
} from '@/__tests__/test-utils/mocks/api';
import {
  createRetailCurrencyApiMock,
  createRetailCustomersApiMock,
  createRetailKdsApiMock,
  createRetailProductsApiMock,
} from '@/__tests__/test-utils/mocks/retailPos';

/**
 * `actual` is what each site passes at runtime. The retail KDS factory is
 * complete by construction because its callers spread the real module into it,
 * so the standalone call below has to model that same arrangement -- otherwise
 * this file would report the fix as a 19-key deficit, which is the mistake the
 * first version of the audit script made before it learned to look for spreads.
 */
interface SurfaceCase {
  label: string;
  real: Record<string, unknown>;
  mock: Record<string, unknown>;
}

const CASES: SurfaceCase[] = [
  { label: '@/api/shifts   <- createShiftsApiMock', real: shiftsApi, mock: createShiftsApiMock() },
  { label: '@/api/sales    <- createSalesApiMock', real: salesApi, mock: createSalesApiMock() },
  { label: '@/api/settings <- createSettingsApiMock', real: settingsApi, mock: createSettingsApiMock() },
  { label: '@/api/products <- createProductsApiMock', real: productsApi, mock: createProductsApiMock() },
  { label: '@/api/kds      <- createKdsApiMock', real: kdsApi, mock: createKdsApiMock() },
  { label: '@/api/reports  <- createReportsApiMock', real: reportsApi, mock: createReportsApiMock() },
  { label: '@/api/hardware <- createHardwareApiMock', real: hardwareApi, mock: createHardwareApiMock() },
  { label: '@/api/giftCards <- createGiftCardsApiMock', real: giftCardsApi, mock: createGiftCardsApiMock() },
  { label: '@/api/loyalty  <- createLoyaltyApiMock', real: loyaltyApi, mock: createLoyaltyApiMock() },
  {
    label: '@/api/products <- createRetailProductsApiMock',
    real: productsApi,
    mock: createRetailProductsApiMock(),
  },
  {
    label: '@/api/currency <- createRetailCurrencyApiMock',
    real: currencyApi,
    mock: createRetailCurrencyApiMock(),
  },
  {
    label: '@/api/customers <- createRetailCustomersApiMock',
    real: customersApi,
    mock: createRetailCustomersApiMock(),
  },
  {
    label: '@/api/kds      <- createRetailKdsApiMock (with the real module spread)',
    real: kdsApi,
    mock: createRetailKdsApiMock(kdsApi),
  },
];

/**
 * Frozen baseline of dead keys, captured from the first run of this file.
 *
 * Almost all of these are legacy unscoped names left behind by the ADR #7
 * scoped-command migration (`getShiftReport` -> `getShiftReportScoped` and
 * friends). Two are not: `finalizeSaleScoped` and `voidPendingSaleScoped` are
 * *Scoped* names the sales module does not export either, so they are either a
 * typo or a command that was removed -- worth a look, but not by deleting them
 * blind, since a test that arranges on a dead name is already not arranging.
 *
 * They cause no live defect today -- no component can call a function its api
 * module does not export -- so removing all 42 in one pass is not worth the diff:
 * `mocks/api.ts` is imported by most of the UI suite and several agents commit to
 * this branch concurrently.
 *
 * What this baseline does instead is stop the debt growing. The assertion below
 * requires the dead set to equal this map EXACTLY, so:
 *   * adding a new dead key fails, and
 *   * deleting one also fails, with the message telling you to shrink this map.
 * The second direction is deliberate. A plain allowlist lets the baseline rot
 * unnoticed once the cleanup that shrinks it lands; equality makes every
 * reduction visible and turns cleanup into a tracked, self-documenting edit.
 *
 * Generated from the runtime, not transcribed -- 42 names is exactly the surface
 * on which a hand-typed baseline enforces a set that never existed.
 */
const KNOWN_DEAD: Record<string, string[]> = {
  '@/api/shifts   <- createShiftsApiMock': [
    'closeShift', 'createCashPayout', 'getActiveShift', 'getShift',
    'getShiftReport', 'listShifts', 'openShift',
  ],
  '@/api/sales    <- createSalesApiMock': [
    'addLine', 'completeSale', 'deleteHeldCart', 'finalizeSaleScoped',
    'getHeldCart', 'holdCart', 'listHeldCarts', 'listRefunds',
    'processRefund', 'setCartDiscount', 'startSale', 'voidPendingSaleScoped',
    'voidSale',
  ],
  '@/api/settings <- createSettingsApiMock': [
    'getCreditSettings', 'getReceiptSettings', 'getStoreSettings', 'getUserPreferences',
    'listCreditSales', 'setCreditSettings', 'setReceiptSettings', 'setStoreSettings',
    'setUserPreferences', 'settleCredit',
    // `getSetupStatus` left this list with the ADR #56 §2.2 retirement: the
    // module no longer exports it, so a mock defining it would be dead, and
    // the factory was cleaned in the same pass.
  ],
  '@/api/products <- createProductsApiMock': [
    'createCategory', 'deleteCategory', 'updateCategory',
  ],
  '@/api/hardware <- createHardwareApiMock': [
    'displayClear', 'displayShow', 'listDisplays',
  ],
  '@/api/products <- createRetailProductsApiMock': [
    'createCategory', 'deleteCategory', 'updateCategory',
  ],
  '@/api/currency <- createRetailCurrencyApiMock': [
    'listCurrencies', 'listExchangeRates',
  ],
};

/**
 * The direction this file never asked, added 2026-09-16 while it was green and the
 * suite was red.
 *
 * KNOWN_DEAD answers "what does the mock define that the module does not export?" --
 * a stale key, which fails SILENTLY because nothing calls it. The defect that day was
 * the mirror image: `PosScreen` started calling `getSettingScoped`, `@/api/settings`
 * has exported it since `6190dda4e` (2026-08-29), and `createSettingsApiMock` never
 * defined it. Every suite routing through that factory threw at render time -- 125
 * tests in four files -- and this file, whose whole subject is mock-vs-module surface,
 * stayed green, because it only ever looked for EXTRA keys in the mock.
 *
 * Note the asymmetry that makes this worth pinning: a mock that is MISSING a key fails
 * LOUDLY at the first call, and a mock carrying a DEAD key fails QUIETLY forever. The
 * existing case listens for the quiet one only.
 *
 * Baseline generated from the runtime rather than transcribed, for the reason at
 * :138, and asserted by EQUALITY for the reason at :130-:136: a plain allowlist rots
 * the moment a gap closes, equality makes every change in either direction an explicit
 * edit. A name belongs OUT of this map when the factory gains it, not when someone
 * remembers to remove it.
 */
const KNOWN_GAPS: Record<string, string[]> = {
  // 3 names.
  '@/api/shifts   <- createShiftsApiMock': [
    'createCashPayoutScoped', 'getShiftReportScoped', 'getShiftScoped',
  ],
  // 6 names. `completeSaleWithResolvedShortfalls` is the one the retail cart calls
  // on a shortfall, so a suite routing through this factory cannot exercise it.
  '@/api/sales    <- createSalesApiMock': [
    'completeSaleWithResolvedShortfalls', 'lookupSaleByReceiptBarcodeScoped',
    'overrideCartDeductionLocation', 'overrideLinePriceScoped',
    'previewPromotedTotalFromLinesScoped', 'previewPromotedTotalScoped',
  ],
  // 9 names. This is the family that broke today: the scoped setters/getter exist in
  // the module and not in the factory, so PosScreen's new read threw. `getSettingScoped`
  // itself is now OUT of this list because the factory defines it -- which is the
  // deletion direction this map is designed to force a visible edit for.
  // 9 names. ADR #56 §2.1/§2.2 replaced `getSetupStatus`/`dismissSetupWizard`
  // with `getFirstRunState`/`provisionDevice`, and the factory was brought
  // forward in the same pass, so those two are mocked rather than listed here —
  // the deletion direction this map is designed to force a visible edit for.
  '@/api/settings <- createSettingsApiMock': [
    'getCreditSettingsScoped', 'getDeploymentInfo', 'getHardwareSettingsScoped',
    'getSetting', 'onSettingsUpdated', 'seedDefaultRolesScoped',
    'setSetting', 'setSettingScoped', 'setSettingsScoped',
  ],
  // 10 names.
  '@/api/products <- createProductsApiMock': [
    'createCategoryScoped', 'deleteCategoryScoped', 'deleteProductVariantScoped',
    'getProductTrackSerialScoped', 'listWarehouseProductsAtLocation',
    'productsClearImageScoped', 'productsListImagesScoped', 'productsSetImageScoped',
    'recordProductSearchScoped', 'updateCategoryScoped',
  ],
  // 14 names, including `publishCourseFiredScoped` -- the publish half of today's
  // coursing feature is also unmocked here, so only the read half was caught.
  '@/api/kds      <- createKdsApiMock': [
    'ackKdsOrderScoped', 'deactivateKdsDeviceScoped', 'getKdsDeviceScoped',
    'getKdsOrderLinesScoped', 'getKdsRoutingRulesScoped', 'listKdsDevicesScoped',
    'printKdsChitScoped', 'publishCourseFiredScoped', 'registerKdsDeviceScoped',
    'resolveKdsTargetsScoped', 'saveKdsRoutingRulesScoped',
    'updateKdsDeviceStatusScoped', 'updateKdsLineItemStatusScoped',
    'updateKdsOrderItemsScoped',
  ],
  // 15 names. Every report reader in this repo mocks a module whose reports surface
  // is mostly absent -- which is why a report suite can be green while reading
  // nothing but the five shapes the factory happens to define.
  '@/api/reports  <- createReportsApiMock': [
    'getBasketSize', 'getBasketSizeTrend', 'getCategoryForecast',
    'getCategoryPopularity', 'getCategoryPopularityTrend', 'getCustomerSplit',
    'getDiscountsSummary', 'getHourlyOccupancy', 'getInventoryTrend',
    'getInventoryTurnover', 'getPaymentMethodBreakdown', 'getSaleLineMarginsScoped',
    'getTableTurnover', 'getVoidedItems', 'getVoidedSalesSummary',
  ],
  // 13 names. `ScannerError` is a class, and `readScaleWeight` / `getCurrencyInfo`
  // style helpers are value exports; a `typeof x === 'function'` audit would have
  // missed all three, which is why this counts keys, not functions.
  '@/api/hardware <- createHardwareApiMock': [
    'ScannerError', 'discoverHardwareScoped', 'displayClearScoped',
    'displayShowScoped', 'listDisplaysScoped', 'listScannersScoped',
    'openCashDrawerScoped', 'printReceiptScoped', 'printSalesReceiptScoped',
    'readScaleWeight', 'readScaleWeightScoped', 'startScannerScoped',
    'stopScannerScoped',
  ],
  // 8 names.
  '@/api/products <- createRetailProductsApiMock': [
    'createCategoryScoped', 'deleteCategoryScoped', 'deleteProductVariantScoped',
    'listWarehouseProductsAtLocation', 'productsClearImageScoped',
    'productsListImagesScoped', 'productsSetImageScoped', 'updateCategoryScoped',
  ],
  // 10 names, of which four are pure helpers, not IPC calls.
  '@/api/currency <- createRetailCurrencyApiMock': [
    'convertMinorUnits', 'createExchangeRateScoped', 'deleteExchangeRateScoped',
    'exchangeRateToDecimal', 'formatExchangeRate', 'getCurrencyInfo',
    'getLatestExchangeRateScoped', 'reciprocalMillionths', 'setDefaultCurrency',
    'setDefaultCurrencyScoped',
  ],
  // 2 names -- both of them the scoped customer lookups the POS cart depends on.
  '@/api/customers <- createRetailCustomersApiMock': [
    'getCustomerHistoryScoped', 'searchCustomersScoped',
  ],
  // No entry for '@/api/giftCards', '@/api/loyalty' or the retail-KDS case: they
  // measured ZERO gaps, which is the empty baseline this map's `?? []` already
  // asserts. retail-KDS is complete by construction (`:70`-`:76`, callers spread
  // the real module), and the other two are simply small.
};

describe('mock factory surface conforms to the module it replaces', () => {
  it.each(CASES)('$label defines no unexpected key the module lacks', ({ label, real, mock }) => {
    // A type-only namespace member is not a runtime key, so `in` is the right
    // test: it sees exactly what a caller could import and call.
    const dead = Object.keys(mock).filter((k) => !(k in real)).sort();
    expect(
      dead,
      `${label}: dead set changed. A new entry means the mock defines something ` +
      `the module does not export (unreachable, and a test arranging on it is ` +
      `configuring nothing). A removed entry means real cleanup -- delete it from ` +
      `KNOWN_DEAD too.`,
    ).toEqual([...(KNOWN_DEAD[label] ?? [])].sort());
  });

  it.each(CASES)('$label mocks every runtime export the module has, or names the gap', ({ label, real, mock }) => {
    // The mirror image of the case above, added 2026-09-16.
    const missing = Object.keys(real).filter((k) => !(k in mock)).sort();
    expect(
      missing,
      `${label}: gap set changed. A NEW entry means the module exports something this ` +
      `factory does not mock, so any suite routing through it throws at call time. A ` +
      `REMOVED entry means the gap closed -- delete it from KNOWN_GAPS too. ` +
      `Measured gap now: ${JSON.stringify(missing)}`,
    ).toEqual([...(KNOWN_GAPS[label] ?? [])].sort());
  });

  it('every case has at least one live key, so an empty mock cannot pass by defining nothing', () => {
    for (const c of CASES) {
      const live = Object.keys(c.mock).filter((k) => k in c.real);
      expect(live.length, `${c.label} defines no live export at all`).toBeGreaterThan(0);
    }
  });
});
