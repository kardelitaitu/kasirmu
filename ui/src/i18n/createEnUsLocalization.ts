// shared-ui/locales/index.ts — Barrel that creates the en-US FluentBundle
// from all domain .ftl files.
//
// Import this in main.tsx to get a ready-to-use ReactLocalization.
// Tests import only the domain modules they need via test-utils.tsx.

import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization } from '@fluent/react';

// Inline Vite ?raw imports — these resolve to raw string content at build time.
// If your bundler doesn't support ?raw, replace with a direct string literal.
import sharedFtl from '@/locales/shared.ftl?raw';
import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';
import staffFtl from '@/locales/staff.ftl?raw';
import customersFtl from '@/locales/customers.ftl?raw';
import taxFtl from '@/locales/tax.ftl?raw';
import currencyFtl from '@/locales/currency.ftl?raw';
import inventoryFtl from '@/locales/inventory.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import terminalsFtl from '@/locales/terminals.ftl?raw';
import offlineFtl from '@/locales/offline.ftl?raw';
import syncFtl from '@/locales/sync.ftl?raw';
import bundlesFtl from '@/locales/bundles.ftl?raw';
import promotionsFtl from '@/locales/promotions.ftl?raw';
import kdsFtl from '@/locales/kds.ftl?raw';
import kioskFtl from '@/locales/kiosk.ftl?raw';
import loyaltyFtl from '@/locales/loyalty.ftl?raw';
import shiftsFtl from '@/locales/shifts.ftl?raw';
import reportsFtl from '@/locales/reports.ftl?raw';
import analyticsFtl from '@/locales/analytics.ftl?raw';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import stockTransfersFtl from '@/locales/stock-transfers.ftl?raw';
import stockCountingFtl from '@/locales/stock-counting.ftl?raw';
import purchasingFtl from '@/locales/purchasing.ftl?raw';
import giftCardsFtl from '@/locales/gift-cards.ftl?raw';
import subscriptionFtl from '@/locales/subscription.ftl?raw';

const ALL_FTL = [
  sharedFtl,
  salesFtl,
  productsFtl,
  settingsFtl,
  staffFtl,
  customersFtl,
  taxFtl,
  currencyFtl,
  inventoryFtl,
  tablesFtl,
  terminalsFtl,
  offlineFtl,
  syncFtl,
  bundlesFtl,
  promotionsFtl,
  kdsFtl,
  kioskFtl,
  loyaltyFtl,
  shiftsFtl,
  reportsFtl,
  analyticsFtl,
  multiStoreFtl,
  stockTransfersFtl,
  stockCountingFtl,
  purchasingFtl,
  giftCardsFtl,
  subscriptionFtl,
].join('\n');

let _bundle: ReactLocalization | null = null;

/** Create (or return cached) en-US ReactLocalization from all domain .ftl files. */
export function createEnUsLocalization(): ReactLocalization {
  if (_bundle) return _bundle;

  const bundle = new FluentBundle('en-US');
  bundle.addResource(new FluentResource(ALL_FTL));
  _bundle = new ReactLocalization([bundle]);
  return _bundle;
}
