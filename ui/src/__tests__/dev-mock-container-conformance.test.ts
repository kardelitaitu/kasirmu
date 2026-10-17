/**
 * @vitest-environment node
 *
 * Contract check between the dev-mock and the DECLARED api return types, for the
 * families the analytics guard (`dev-mock-analytics-shape.test.ts`) does not cover.
 *
 * WHY THIS FILE EXISTS, AND HOW IT DIFFERS FROM THE DEMO-MOCK DTO SUITE.
 * `dev-mock-dto-conformance.test.ts` pairs 7 setup/auth commands with typed fixtures and
 * compares KEY SETS. That catches a missing or renamed field. It cannot catch the other
 * half of the problem: a handler that answers the right keys inside the WRONG CONTAINER.
 * That is precisely how the Analytics screen crashed on open — `get_voided_sales_summary_scoped`
 * answered `{ void_count, void_total_minor }` where every declaration says
 * `VoidedSummaryRow[]`, so `rows.reduce(...)` threw and the screen fell to its error
 * boundary. Key-set comparison would have passed it: the keys were right, the container
 * was not.
 *
 * So this file grades the CONTAINER only — array vs object — against the `Promise<...>` in
 * the api module, which is the declaration the Rust side implements.
 *
 * WHY ONLY THESE COMMANDS. The scope is the readers whose result a screen iterates
 * directly. Many commands declare objects, and an object-shaped answer for an
 * object-shaped declaration cannot produce this failure. The commands below are the ones
 * where the declared type is an ARRAY and a consumer calls an array method on the result.
 *
 * WHAT IT DOES NOT CLAIM. A green run here does not prove any payload is CORRECT — only
 * that its container matches its declared type. Field-level drift is the DTO suite's job,
 * and neither proves behaviour.
 */
import { describe, it, expect, vi } from 'vitest';
vi.unmock('@tauri-apps/api/event');
import * as inventory from '@/api/inventory';
import * as stockTransfers from '@/api/stockTransfers';
import * as localPayment from '@/api/local-payment';
import * as settings from '@/api/settings';

const TOK = 'tok';

interface Case {
  /** The api function's name, for the failure message. */
  name: string;
  /** Calls the reader exactly as a screen does. */
  call: () => Promise<unknown>;
  /** The container the declaration uses: `Promise<X[]>` -> 'array', `Promise<X>` -> 'object'. */
  container: 'array' | 'object';
}

const CASES: Case[] = [
  // ── Inventory: the readers a screen iterates directly ────────────────
  // LocationPicker.tsx:108 does `data.filter(...)` on listInventoryLocations.
  { name: 'listInventoryLocations', call: () => inventory.listInventoryLocations(TOK), container: 'array' },
  // StockAlertPanel.tsx:66 does `data.slice(...)` on getActiveStockAlerts.
  { name: 'getActiveStockAlerts', call: () => inventory.getActiveStockAlerts(TOK, 'loc-1'), container: 'array' },
  { name: 'listInventoryShifts', call: () => inventory.listInventoryShifts(TOK), container: 'array' },
  { name: 'listInventoryTransactions', call: () => inventory.listInventoryTransactions(TOK), container: 'array' },
  { name: 'getStockThresholds', call: () => inventory.getStockThresholds(TOK, null), container: 'array' },
  { name: 'getLowStockAlertsAtLocation', call: () => inventory.getLowStockAlertsAtLocation(TOK, 'loc-1', 10), container: 'array' },
  // `getInventoryTransaction` declares a TUPLE-or-null, so it is graded as array-or-null.
  { name: 'getWorkspaceInventoryLocations', call: () => inventory.getWorkspaceInventoryLocations(TOK, 'inst-1'), container: 'array' },

  // ── Stock transfers: WarehouseConsole.tsx:161 does `list.map(...)` ──
  { name: 'listInTransitTransfers', call: () => stockTransfers.listInTransitTransfers(TOK), container: 'array' },
  { name: 'listStockTransfers', call: () => stockTransfers.listStockTransfers(TOK), container: 'array' },
  { name: 'getStockTransferLines', call: () => stockTransfers.getStockTransferLines(TOK, 'tr-1'), container: 'array' },

  // ── Local payment: LocalPaymentSettingsCard.tsx:86 does `rows.map(...)` ──
  { name: 'getLocalPaymentMethodsScoped', call: () => localPayment.getLocalPaymentMethodsScoped(TOK, 'loc-1'), container: 'array' },

  // ── Settings: RetailPosScreen.tsx:1637 does `list.filter(...)` ──────
  { name: 'listCreditSalesScoped', call: () => settings.listCreditSalesScoped(TOK), container: 'array' },
];

function containerOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  return typeof v;
}

describe('dev-mock container conformance (inventory, transfers, local payment, credit)', () => {
  it('the case list is not empty', () => {
    expect(CASES.length).toBeGreaterThan(8);
  });

  it.each(CASES)('$name', async ({ name, call, container }) => {
    const payload = await call();
    expect(
      containerOf(payload),
      `${name} declares Promise<${container === 'array' ? 'X[]' : 'X'}> but the dev-mock answered ${containerOf(payload)}: ${JSON.stringify(payload)?.slice(0, 160)}`,
    ).toBe(container);
  });
});
