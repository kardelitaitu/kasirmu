// ── Cash tender quick-shortcut contract ──────────────────────────────
//
// A quick-tender preset rounds the payable UP to the next multiple of the
// denomination. When the payable is already a multiple — Rp 6.250.000 against
// the built-in Rp 5.000 / 10.000 / 50.000 notes — every one of those presets
// used to render the identical "Rp 6.250.000" button, so the row offered the
// payable three times over and repeated what "Exact" already does. This pins
// the rule that replaced it: every rendered shortcut is strictly above the
// payable, and no two shortcuts are the same amount.
import { describe, it, expect } from 'vitest';
import salesFtl from '@/locales/sales.ftl?raw';
import { renderWithFluentSync } from './test-utils/render';
import { formatMoney, type Money } from '@/types/domain';
import CashTenderPanel from '@/features/sales/payment/CashTenderPanel';

const noop = () => {};

const renderPanel = (total: Money, tenderPresets?: number[]) =>
  renderWithFluentSync(
    <CashTenderPanel
      tendered=""
      onTenderedChange={noop}
      total={total}
      tenderPresets={tenderPresets}
      sufficient={false}
      change={null}
      locale="id-ID"
    />,
    salesFtl,
  );

/** Labels of the preset buttons only — the trailing Exact key is separate. */
const presetLabels = () =>
  Array.from(document.querySelectorAll('.payment-quick-btn'))
    .map((button) => button.textContent ?? '')
    .filter((text) => text !== 'Exact');

const idr = (minorUnits: number): Money => ({ minor_units: minorUnits, currency: 'IDR' });

describe('CashTenderPanel quick-tender shortcuts', () => {
  it('drops shortcuts that only repeat the payable, keeping the round-ups', () => {
    renderPanel(idr(6_250_000));
    const labels = presetLabels();
    // 5.000 / 10.000 / 50.000 all round up to the payable itself → dropped,
    // leaving the two denominations that genuinely round past it.
    expect(labels).toEqual([
      formatMoney(idr(6_260_000), 'id-ID'),
      formatMoney(idr(6_300_000), 'id-ID'),
    ]);
  });

  // One test per payable: each render needs its own cleanup, and a loop inside
  // a single test would read the previous render's buttons too.
  it.each([6_250_000, 3_500, 100_000, 0, 1])('never repeats an amount (payable %i)', (payable) => {
    renderPanel(idr(payable));
    const labels = presetLabels();
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain(formatMoney(idr(payable), 'id-ID'));
  });

  it('keeps every built-in note when the payable is below them all', () => {
    renderPanel(idr(3_500));
    const labels = presetLabels();
    expect(labels).toHaveLength(5);
    expect(labels[0]).toBe(formatMoney(idr(5_000), 'id-ID'));
    expect(labels[4]).toBe(formatMoney(idr(100_000), 'id-ID'));
  });

  it('collapses repeated custom presets to one shortcut', () => {
    renderPanel(idr(3_500), [10_000, 10_000, 20_000]);
    const labels = presetLabels();
    expect(labels).toEqual([formatMoney(idr(10_000), 'id-ID'), formatMoney(idr(20_000), 'id-ID')]);
  });
});
