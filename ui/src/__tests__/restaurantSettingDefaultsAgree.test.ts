// ── Guard: an unset key must mean the SAME thing on both surfaces ─────
//
// The settings screen writes a toggle; the POS reads that toggle to decide whether to
// show a field. When a key has NEVER BEEN WRITTEN they must agree, or the screen lies
// about what the POS is doing. That is the F1 shape with the sign flipped: instead of a
// control nothing reads, a control whose OFF position describes a state the POS is not
// in.
//
// MEASURED DIVERGENCE, `restaurant.guest_count`:
//   runtime   PosScreen.tsx:1141  `guestCountEnabled ?? true`  -> an unset key SHOWS pax
//   cart      CartPanel.tsx:759   `guestCountEnabled !== false` -> null/undefined SHOWS
//   settings  DEFAULT_RESTAURANT_SETTINGS.guestCount = false    -> renders the toggle OFF
//
// So a merchant opened Settings, saw Guest Count off, and the POS was showing the
// field. The other nine agree today; this case pins the agreement so one cannot move
// without the other, which is what round 25's KDS-defaults fix established as the
// pattern.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DEFAULT_RESTAURANT_SETTINGS } from '@/features/restaurant/screens/restaurantSettingsModel';

const SRC = path.resolve(process.cwd(), 'src');
const POS = path.join(SRC, 'features/sales/PosScreen.tsx');

/**
 * Each cart-field gate: the POS prop, its `??` fallback, and the settings field the
 * screen renders for the same unset state.
 */
const GATES: Array<{ prop: string; field: keyof typeof DEFAULT_RESTAURANT_SETTINGS }> = [
  { prop: 'customerNameEnabled', field: 'customerName' },
  { prop: 'guestCountEnabled', field: 'guestCount' },
  { prop: 'saveTabEnabled', field: 'saveTab' },
];

describe('an unset restaurant setting means the same on both surfaces (F1)', () => {
  const posLines = fs.readFileSync(POS, 'utf-8').split(/\r?\n/);

  // The runtime's answer for an unset key, read from its `??` default at the CartPanel
  // prop site. If one becomes `?? false` the settings default must flip with it.
  const runtimeDefault = (prop: string): string => {
    const line = posLines.find(
      (l) => new RegExp(`${prop}: ${prop} \\?\\?`).test(l),
    );
    expect(line, `PosScreen no longer maps ${prop} with a ?? default`).toBeDefined();
    return /\?\?\s*(true|false)/.exec(line!)![1]!;
  };

  it.each(GATES)('agrees on the unset default for $field', ({ prop, field }) => {
    expect(
      runtimeDefault(prop),
      `the POS default for an unset ${field} must equal ` +
        'DEFAULT_RESTAURANT_SETTINGS.' + field + ', or the settings screen renders a ' +
        'position the POS is not in. The POS direction is the safe one (a settings ' +
        'outage must not remove a capability), so the SCREEN default is what moves.',
    ).toBe(String(DEFAULT_RESTAURANT_SETTINGS[field]));
  });

  it('covers every cart-field gate the runtime maps', () => {
    // A gate added to PosScreen without an entry here would be unchecked, which is how
    // guest_count stayed wrong. Count the prop sites instead of trusting the list.
    const mapped = posLines
      .filter((l) => /(customerName|guestCount|saveTab)Enabled: \w+Enabled \?\?/.test(l))
      .length;
    expect(GATES.length).toBe(mapped);
  });

  /**
   * The two gates that are NOT `??`-mapped, and why they still have to be pinned.
   *
   * `courseFiring` reads `raw === 'true'`, so an unset key yields an explicit `false`
   * (not `null`), and its settings default is `false` — agreement by a different route.
   * `orderTypePrompt` resolves an unset key to `activeWorkspace === 'restaurant-pos'`,
   * which is `true` for this POS and matches its settings default.
   *
   * They are listed because the agreement is a fact about the PAIR, and either half can
   * move: making course-firing's default `true` in the screen (or its read `raw !== 'false'`)
   * would produce exactly the guest-count bug again.
   */
  const NON_QUERY_GATES: Array<{
    field: keyof typeof DEFAULT_RESTAURANT_SETTINGS;
    readPattern: RegExp;
    unsetMeans: (m: RegExpMatchArray) => string;
  }> = [
    {
      field: 'courseFiring',
      readPattern: /setCourseFiringEnabled\(raw === 'true'\)/,
      unsetMeans: () => 'false',
    },
    {
      field: 'orderTypePrompt',
      readPattern: /setOrderTypePromptEnabled\(raw === null \? ([^:]+) :/,
      unsetMeans: () => 'true', // `activeWorkspace === 'restaurant-pos'`
    },
  ];

  it.each(NON_QUERY_GATES)(
    'agrees on the unset default for $field (read without a ?? fallback)',
    ({ field, readPattern, unsetMeans }) => {
      const line = posLines.find((l) => readPattern.test(l));
      expect(line, `PosScreen no longer reads ${field} as expected`).toBeDefined();
      const m = line!.match(readPattern)!;
      expect(
        unsetMeans(m),
        `${field}: an unset key must mean DEFAULT_RESTAURANT_SETTINGS.${field}. Its read ` +
          'and its screen default are a PAIR — moving one without the other is how ' +
          'guest_count came to describe a POS state that did not exist.',
      ).toBe(String(DEFAULT_RESTAURANT_SETTINGS[field]));
    },
  );
});