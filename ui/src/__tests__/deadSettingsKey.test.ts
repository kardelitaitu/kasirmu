// ── Guard: a settings key must have a reader, or be declared dead ────
//
// Finding F1 in todo-restaurant-pos-reliability.md. A `restaurant.*` key that the
// settings screen WRITES but nothing READS is not merely dead code: the toggle makes
// a promise in its own description and the app does not keep it. `restaurant.
// hold_order` says "Allow cashier to park or temporarily hold in-progress orders" when
// no hold action reads it; `sound_chime` says "Play an audible confirmation chime" when
// the only chime in the tree is KDS-side and takes no restaurant-settings input.
//
// ── WHY A PIN AND NOT A FIX ──
//
// The plan's P1 rule is "do not leave a control that writes a dead key", and the owner
// chose REMOVAL for the one key this happened to before (`restaurant.table_number`,
// option C). But wiring these three means INVENTING the features they name — a KOT-send
// path and an order-sent chime. That is not a reliability repair and should not ride in
// on one, so the decision stays open and this file records it rather than guessing.
//
// What the pin buys meanwhile: the set is now STATED in code. Adding a fourth dead key
// fails, and giving one of these a reader fails until its entry is deleted — so the
// list cannot quietly drift out of date, and the next reader sees the exact debt.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(process.cwd(), 'src');

/**
 * Keys the settings screen owns but NOTHING reads, and what would fix each.
 *
 * An entry whose key GAINS a reader fails the third case below, so this list cannot
 * outlive the condition it records — the same discipline `baselineLoadSignal.test.ts`
 * and `disabledFlagLatch.test.ts` use for their own exemptions.
 */
const DECLARED_DEAD: Array<{ key: string; wouldNeed: string }> = [
  {
    key: 'restaurant.hold_order',
    wouldNeed:
      'a restaurant-side hold/park action. Re-measured: the only `bill_type: hold` in ' +
      'the UI is RetailPosScreen.tsx:1282 (the retail POS, which does not read ' +
      'restaurant.*); restaurant POS parks as `open_bill`, which `save_tab` covers.',
  },
  {
    key: 'restaurant.auto_print_kitchen',
    wouldNeed:
      'a KOT-send path on save/hold. The only auto-print in the tree is KDS-side ' +
      '(kasirmu-bridge/src/kds.rs, try_auto_print_kds_chit_jobs) and already automatic.',
  },
  {
    key: 'restaurant.sound_chime',
    wouldNeed:
      'an order-sent chime in the POS. `useSound` exists but is KDS-only ' +
      '(KdsScreen, ExpoScreen, KdsTicketCard); nothing in the sales path calls it.',
  },
];

/** Production source under src/, minus tests and dev mocks. */
function collectFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'dev-mock') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
}

/**
 * Keys whose CONSUMER reads a DIFFERENT name, reached through the F6 mirror.
 *
 * The settings screen persists `restaurant.interaction_sound` and then mirrors it into
 * `pos.interaction_sound`, which is what `utils/interaction.ts` actually reads at
 * runtime. So the key is live, but a search for its own name finds only the writer and
 * the model — the same "one field, two names" shape as the rail-code divergence in
 * round 24. Mapped explicitly rather than waved through, so the reason is auditable.
 */
const MIRRORED_CONSUMERS: Record<string, string> = {
  'restaurant.interaction_sound': 'pos.interaction_sound',
  'restaurant.interaction_vibration': 'pos.interaction_vibration',
};

/**
 * The files that read `key`, EXCLUDING the two that define the setting surface:
 * `RestaurantSettingsScreen` (the writer) and `restaurantSettingsModel` (the spec).
 *
 * A key in `MIRRORED_CONSUMERS` is searched for under its CONSUMED name instead.
 */
function readersOf(key: string): string[] {
  const searched = MIRRORED_CONSUMERS[key] ?? key;
  const re = new RegExp(searched.replace('.', '\\.'));
  return collectFiles()
    .filter((f) => !/[\\/](RestaurantSettingsScreen|restaurantSettingsModel)\.tsx?$/.test(f))
    .filter((f) => re.test(fs.readFileSync(f, 'utf-8')))
    .map((f) => path.relative(SRC, f));
}

describe('a restaurant settings key must be read, or declared dead (F1)', () => {
  it('has no UNDECLARED dead key: every key the screen writes has a reader', () => {
    const screen = fs.readFileSync(
      path.join(SRC, 'features/restaurant/screens/RestaurantSettingsScreen.tsx'),
      'utf-8',
    );
    // Every `'restaurant.<name>': String(...)` in the save payload.
    const written = [...screen.matchAll(/'(restaurant\.\w+)':/g)].map((m) => m[1]!);
    expect(written.length).toBeGreaterThanOrEqual(10);
    const declared = new Set(DECLARED_DEAD.map((d) => d.key));
    const undeclared = written
      .filter((k) => !declared.has(k))
      .filter((k) => readersOf(k).length === 0);
    expect(
      undeclared,
      'These keys are WRITTEN by the settings screen and read by NOTHING outside ' +
        'it, and are not in DECLARED_DEAD. A toggle whose key no code reads promises ' +
        'behaviour the app does not deliver (F1). Either wire it to a consumer, remove ' +
        'the control, or add it here with what wiring it would need.',
    ).toEqual([]);
  });

  it('still reports each declared-dead key as read by nothing', () => {
    const revived = DECLARED_DEAD
      .filter((d) => readersOf(d.key).length > 0)
      .map((d) => d.key + '  (now read by ' + readersOf(d.key).join(', ') + ')');
    expect(
      revived,
      'A declared-dead key now HAS a reader — delete its DECLARED_DEAD entry so the ' +
        'list keeps describing the real debt.',
    ).toEqual([]);
  });
});