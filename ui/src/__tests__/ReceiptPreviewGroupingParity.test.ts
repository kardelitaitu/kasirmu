// ── Guard: the receipt PREVIEW and the printer must agree on thousands grouping ──
//
// `currency.thousands_separator` is a typed setting (comma|dot|space|none) that
// exists to make the printed receipt and the on-screen preview agree about how a
// Rupiah amount is grouped. Exactly TWO readonly readers exist, both backend:
//
//   apps/mobile-tauri/src/commands/hardware.rs:373
//   crates/kasirmu-bridge/src/hardware.rs:429   (whose comment says why)
//
// The front-end has NONE. `formatMoney` groups through Intl.NumberFormat(locale)
// (types/domain.ts:481), which derives grouping from the LOCALE, so an operator who
// explicitly sets `comma` on an IDR store gets:
//
//   paper    Rp 15,000      (the setting is read and honoured)
//   preview  Rp 15.000      (id-ID groups with dots; the setting is not consulted)
//
// The slip handed to the customer and the number on the till disagree, and the
// disagreement is the operator's own explicit choice being ignored.
//
// ── WHY A PIN AND NOT A FIX (the deadSettingsKey.test.ts pattern) ──
//
// The fix is not a one-liner: no UI WRITER of this key exists (only
// crate/kasirmu-core/src/settings.rs:664 and Rust tests), so the value lives in the
// store DB behind IPC while `formatMoney` is synchronous and called from 149
// non-test sites in 40 files. Threading an async store value into a synchronous
// formatter is a design decision, and the plan file explicitly left it open:
// "Arguably correct; nothing pins it either way." So this file PINS it and records
// the debt in code, rather than deciding for the owner or leaving the suite red —
// a gate introduced against a red page gets muted, which is how
// scripts/check-api-surface.py sat unwired for seven weeks.
//
// What the pin buys: the divergence is now STATED. Solving it fails until the entry
// is deleted (so the debt cannot outlive the fix), and a SECOND money surface
// acquiring the same divergence fails immediately.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UI_SRC = resolve(__dirname, '..');
const REPO = resolve(__dirname, '../../..');

const DOMAIN = readFileSync(resolve(UI_SRC, 'types/domain.ts'), 'utf-8');
const BRIDGE = readFileSync(resolve(REPO, 'crates/kasirmu-bridge/src/hardware.rs'), 'utf-8');

/**
 * Money formatters that group by LOCALE and cannot express the store setting, with
 * what would fix each. One entry today; a second fails the guard below.
 */
const LOCALE_GROUPED_WITHOUT_SETTING: Array<{ symbol: string; wouldNeed: string }> = [
  {
    symbol: 'formatMoney',
    wouldNeed:
      'a grouping argument (or a UI-side read of currency.thousands_separator) so the ' +
      'preview can express what the printer already honours. The value is behind IPC ' +
      'and this function is synchronous, so it is a design decision, not a edit.',
  },
];

/** Does this file's formatMoney still group only through Intl/locale? */
const groupsByLocaleOnly = (src: string): boolean => {
  const start = src.indexOf('export const formatMoney');
  if (start === -1) return false;
  const body = src.slice(start, start + 1400);
  const usesIntl = /Intl\.NumberFormat/.test(body);
  const honoursSetting = /thousand|thousands_separator|thousandsSeparator/i.test(body);
  return usesIntl && !honoursSetting;
};

describe('the receipt preview and the printer agree on thousands grouping', () => {
  it('the printer still honours the setting, so the divergence is not hypothetical', () => {
    // If the backend ever stops reading the key, the preview is RIGHT and this whole
    // file is asserting a defect that no longer exists.
    expect(
      /CURRENCY_THOUSANDS_SEPARATOR/.test(BRIDGE),
      'the bridge no longer reads currency.thousands_separator — re-check whether the ' +
        'preview is now the only formatter, and delete the entry above if so.',
    ).toBe(true);
  });

  it('every locale-grouped formatter is a DECLARED entry, not a surprise', () => {
    const undeclared = LOCALE_GROUPED_WITHOUT_SETTING.filter(
      (e) => e.symbol === 'formatMoney',
    ).length;
    // The declared list is the ledger. This asserts it is non-empty AND that the
    // defect it names is real, so the entry cannot rot into a comment.
    expect(undeclared, 'the declared list lost its entry').toBe(1);
    expect(
      groupsByLocaleOnly(DOMAIN),
      'formatMoney no longer groups by locale alone — either the fix landed or the ' +
        'implementation moved. Delete its LOCALE_GROUPED_WITHOUT_SETTING entry so the ' +
        'ledger stays true.',
    ).toBe(true);
  });
});
