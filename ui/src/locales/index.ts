// ui/src/locales/index.ts — Barrel that creates the en-US FluentBundle
// from all domain .ftl files.
//
// Import this in main.tsx to get a ready-to-use ReactLocalization.
// Tests import only the domain modules they need via test-utils.tsx.

import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization } from '@fluent/react';

// Inline Vite ?raw imports — these resolve to raw string content at build time.
// If your bundler doesn't support ?raw, replace with a direct string literal.
import sharedFtl from './shared.ftl?raw';
import salesFtl from './sales.ftl?raw';
import productsFtl from './products.ftl?raw';
import settingsFtl from './settings.ftl?raw';
import staffFtl from './staff.ftl?raw';
import customersFtl from './customers.ftl?raw';
import taxFtl from './tax.ftl?raw';
import currencyFtl from './currency.ftl?raw';
import inventoryFtl from './inventory.ftl?raw';
import tablesFtl from './tables.ftl?raw';
import terminalsFtl from './terminals.ftl?raw';
import offlineFtl from './offline.ftl?raw';
import syncFtl from './sync.ftl?raw';
import bundlesFtl from './bundles.ftl?raw';
import promotionsFtl from './promotions.ftl?raw';
import kdsFtl from './kds.ftl?raw';
import kioskFtl from './kiosk.ftl?raw';
import loyaltyFtl from './loyalty.ftl?raw';
import shiftsFtl from './shifts.ftl?raw';
import reportsFtl from './reports.ftl?raw';
import analyticsFtl from './analytics.ftl?raw';
import multiStoreFtl from './multi-location.ftl?raw';
import stockTransfersFtl from './stock-transfers.ftl?raw';
import stockCountingFtl from './stock-counting.ftl?raw';
import purchasingFtl from './purchasing.ftl?raw';
import giftCardsFtl from './gift-cards.ftl?raw';
import subscriptionFtl from './subscription.ftl?raw';

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
