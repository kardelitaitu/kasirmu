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

const usd = (minorUnits: number): Money => ({ minor_units: minorUnits, currency: 'USD' });

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

  // ── The same presets in a 2-exponent currency ─────────────────────────
  //
  // Every case above is IDR (exponent 0), where the preset value and the major
  // units coincide. They do NOT in a 2-exponent currency: the panel computes
  // `denomMinor = amount * 10^exp` (CashTenderPanel.tsx:87), so the built-in
  // 5000 means Rp 5.000 in IDR and $5,000 in USD.
  //
  // This pins the USD rendering so the default set's currency sensitivity is
  // visible. The defaults are not currency-tuned — a USD store is offered
  // $5,000-$500,000 shortcuts — which is a product decision to make deliberately
  // rather than discover in the field.
  it('renders the built-in presets at the currency exponent, not as minor units', () => {
    // $7.00 payable, below every built-in, so all five render.
    renderPanel(usd(700));
    const labels = presetLabels();
    expect(labels).toHaveLength(5);
    expect(labels[0]).toBe(formatMoney(usd(500_000), 'id-ID')); // 5000 * 10^2
    expect(labels[4]).toBe(formatMoney(usd(10_000_000), 'id-ID')); // 100000 * 10^2
  });

  it('a USD store may supply its own presets, which are honoured unchanged', () => {
    // The escape hatch: the presets key is per-device localStorage, so a USD
    // store can replace the IDR-shaped defaults.
    renderPanel(usd(700), [10, 20, 50]);
    const labels = presetLabels();
    expect(labels).toEqual([
      formatMoney(usd(1_000), 'id-ID'),
      formatMoney(usd(2_000), 'id-ID'),
      formatMoney(usd(5_000), 'id-ID'),
    ]);
  });

  it('renders Exact button with payment-quick-btn--exact class', () => {
    renderPanel(idr(50_000));
    const exactBtn = document.querySelector('.payment-quick-btn--exact');
    expect(exactBtn).not.toBeNull();
    expect(exactBtn?.textContent).toContain('Exact');
  });

  it('renders sufficient change with payment-change-amount--sufficient and locale formatting', () => {
    renderWithFluentSync(
      <CashTenderPanel
        tendered="100000"
        onTenderedChange={noop}
        total={idr(75_000)}
        sufficient={true}
        change={idr(25_000)}
        locale="id-ID"
        tenderPresets={undefined}
      />,
      salesFtl,
    );
    const changeEl = document.querySelector('.payment-change-amount--sufficient');
    expect(changeEl).not.toBeNull();
    expect(changeEl?.textContent).toBe(formatMoney(idr(25_000), 'id-ID'));
  });
});

