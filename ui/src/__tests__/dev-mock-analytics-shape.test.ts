/**
 * @vitest-environment node
 *
 * Contract check between the dev-mock and the DECLARED api return types.
 *
 * WHY THIS EXISTS. RefundsCard crashed on open with "rows.reduce is not a function"
 * because `get_voided_sales_summary_scoped` answered a bare OBJECT while every owner of
 * the contract declares an array — `getVoidedSalesSummary(): Promise<VoidedSummaryRow[]>`
 * (api/reports.ts:330), `Result<Vec<VoidedSummaryRow>>` in Rust
 * (kasirmu-core/.../sales_summary.rs:239), and the Rust test
 * `voided_sales_summary_groups_by_currency` asserting `rows.len() == 2` across two
 * currencies. Only the mock disagreed.
 *
 * The existing `dev-mock-dto-conformance.test.ts` covers this class for the setup/auth
 * surfaces (7 commands); the analytics surface was not among them, which is how this
 * shipped. This closes that surface.
 *
 * WHY IT TESTS THE RAW API, NOT THE CARD LOADER. `CARD_LOADERS` are transformers: they
 * build a fresh, always-well-formed shape (see `loadRevenue` zero-filling into
 * `Bucket[]`), so a loader can never return a payload its own validator rejects and a
 * test built on it is vacuous. That was measured, not assumed: an earlier version of this
 * file drove `CARD_LOADERS` and passed 17/17 even with the refunds defect restored.
 * The raw call is the layer where the mock's answer is still visible.
 */
import { describe, it, expect, vi } from 'vitest';
vi.unmock('@tauri-apps/api/event');
import * as reports from '@/api/reports';

const FROM = '2026-10-01';
const TO = '2026-10-31';
const TOK = 'tok';

type Container = 'array' | 'object';
type RawFn = () => Promise<unknown>;

/**
 * Every analytics reader whose declared return passes through the dev-mock.
 * The container column is read from the `Promise<...>` in `api/reports.ts`.
 */
const CASES: { name: string; call: RawFn; container: Container }[] = [
  { name: 'getDailyRevenue',        call: () => reports.getDailyRevenue(FROM, TO, TOK),                 container: 'array' },
  { name: 'getWeeklyRevenue',       call: () => reports.getWeeklyRevenue(FROM, TO, TOK),                container: 'array' },
  { name: 'getMonthlyRevenue',      call: () => reports.getMonthlyRevenue(FROM, TO, TOK),               container: 'array' },
  { name: 'getTopProducts',         call: () => reports.getTopProducts(FROM, TO, 10, TOK),                  container: 'array' },
  { name: 'getCategoryPopularity',  call: () => reports.getCategoryPopularity(TOK),           container: 'array' },
  { name: 'getCategoryPopularityTrend', call: () => reports.getCategoryPopularityTrend(TOK, FROM, TO, 'daily'),   container: 'array' },
  { name: 'getHourlyHeatmap',       call: () => reports.getHourlyHeatmap(FROM, TO, TOK),                container: 'array' },
  { name: 'getLowStockAlerts',      call: () => reports.getLowStockAlerts(10, TOK),                     container: 'array' },
  { name: 'getCategoryBreakdown',   call: () => reports.getCategoryBreakdown(FROM, TO, TOK),            container: 'array' },
  { name: 'getPaymentMethodBreakdown', call: () => reports.getPaymentMethodBreakdown(FROM, TO, TOK),    container: 'array' },
  // The defect this file exists for.
  { name: 'getVoidedSalesSummary',  call: () => reports.getVoidedSalesSummary(FROM, TO, TOK),           container: 'array' },
  { name: 'getVoidedItems',         call: () => reports.getVoidedItems(FROM, TO, TOK, 5),               container: 'array' },
  { name: 'getBasketSize',          call: () => reports.getBasketSize(FROM, TO, TOK),                  container: 'object' },
  { name: 'getBasketSizeTrend',     call: () => reports.getBasketSizeTrend(FROM, TO, TOK),              container: 'array' },
  { name: 'getCustomerSplit',       call: () => reports.getCustomerSplit(FROM, TO, TOK),                container: 'object' },
  { name: 'getDiscountsSummary',    call: () => reports.getDiscountsSummary(FROM, TO, TOK),             container: 'object' },
  { name: 'getInventoryTurnover',   call: () => reports.getInventoryTurnover(FROM, TO, TOK, 'loc-1'),  container: 'object' },
  { name: 'getInventoryTrend',      call: () => reports.getInventoryTrend(FROM, TO, TOK),               container: 'array' },
  { name: 'getTableTurnover',       call: () => reports.getTableTurnover(FROM, TO, TOK),               container: 'array' },
  { name: 'getHourlyOccupancy',     call: () => reports.getHourlyOccupancy(FROM, TO, TOK),              container: 'array' },
  { name: 'getCategoryForecast',    call: () => reports.getCategoryForecast(TOK, FROM, TO, 'daily'),     container: 'array' },
  { name: 'getMenuEngineering',     call: () => reports.getMenuEngineering(FROM, TO, TOK),              container: 'object' },
];

function containerOf(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object' && v !== null) return 'object';
  return typeof v;
}

describe('dev-mock answers the container each analytics return type declares', () => {
  it('the case list is not empty', () => {
    expect(CASES.length).toBeGreaterThan(15);
  });

  it.each(CASES)('$name', async ({ name, call, container }) => {
    const payload = await call();
    expect(
      containerOf(payload),
      `${name} declares Promise<${container === 'array' ? 'X[]' : 'X'}> but the dev-mock answered ${containerOf(payload)}: ${JSON.stringify(payload)?.slice(0, 160)}`,
    ).toBe(container);
  });
});
