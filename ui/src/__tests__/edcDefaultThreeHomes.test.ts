// ── Guard: the "Default EDC" choice has THREE homes and works in none (F49) ──
//
// The payments screen and the terminal-preferences card both offer a "Default EDC"
// select. Choosing a terminal writes to two places at once, and a third exists that
// nothing touches at all:
//
//   1. the register hardware pref  `hw.updateLocalPrefs({ defaultEdcTerminalId })`
//      — set, then LOST on reload: `toHardwareSettingsDto` omits it, the UI DTO has no
//        field, the bridge DTO has none, `TerminalProfile` has none (F28, pinned by
//        `edcDefaultLoss.test.ts`)
//
//   2. the card rail parameter     `updateRailParams('card', { defaultTerminalId })`
//      — persisted, but READ BY NOTHING: `useEdcTenderPhase:135` would prefer it and no
//        caller passes the prop (F49, pinned by `edcDefaultPropCaller.test.ts`)
//
//   3. the settings key            `edc.default_terminal`
//      — declared in `keys.rs:209` and referenced by no layer at all (F27)
//
// So an operator picks a preferred terminal, the screen confirms it, and the POS opens
// whichever terminal the backend lists first — after a reload the selection is not even
// shown back to them.
//
// ⚠️ This guard exists because the three findings were recorded SEPARATELY. Each is
// accurate alone, and read together they say something none says: there is no single
// source of truth to consolidate TO, so a fix must CHOOSE one rather than wire the
// nearest. It pins the shape so a partial repair — which would leave two homes live —
// fails here.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(process.cwd(), 'src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

const ROOT = (() => {
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (fs.existsSync(path.join(dir, 'todo-restaurant-pos-reliability.md'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the repo root from ' + process.cwd());
})();

describe('the Default EDC choice has no single source of truth (F49)', () => {
  it('both writes still happen, which is what makes it two homes', () => {
    const screen = read('features/restaurant/screens/RestaurantPaymentsScreen.tsx');
    const chooser = screen.slice(screen.indexOf('data-testid="edc-default-select"'));
    const body = chooser.slice(0, chooser.indexOf('options='));
    expect(
      body.includes('setDefaultEdcTerminalId'),
      'the screen stopped setting the hardware pref — F49 changed shape, re-measure',
    ).toBe(true);
    expect(
      body.includes("updateRailParams('card', { defaultTerminalId"),
      'the screen stopped writing the rail param — F49 changed shape, re-measure',
    ).toBe(true);
  });

  it('the hardware pref still cannot round-trip, which is home 1 being broken', () => {
    const hook = read('hooks/useTerminalHardware.ts');
    const dto = hook.slice(hook.indexOf('function toHardwareSettingsDto'));
    const body = dto.slice(0, dto.indexOf('\n}'));
    expect(
      body.includes('defaultEdcTerminalId'),
      'toHardwareSettingsDto now carries defaultEdcTerminalId — the round trip was FIXED, ' +
        'so flip edcDefaultLoss.test.ts to assert the round trip and re-measure F49: the ' +
        'hardware pref may now be the right single source',
    ).toBe(false);
  });

  it('the settings key still has no production Rust reader, which is home 3', () => {
    // Home 3 is the decoy: a key that LOOKS like the storage and is read by nothing.
    const keys = fs.readFileSync(path.join(ROOT, 'platform/core/src/settings/keys.rs'), 'utf-8');
    expect(
      keys.includes('EDC_DEFAULT_TERMINAL'),
      'EDC_DEFAULT_TERMINAL vanished from keys.rs — if F49 was resolved by DELETING the ' +
        'declaration, delete this case rather than leaving it green over nothing',
    ).toBe(true);

    const rust: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (['target', 'node_modules', '.git'].includes(e.name)) continue;
          walk(full);
        } else if (e.name.endsWith('.rs')) {
          const rel = path.relative(ROOT, full).split(path.sep).join('/');
          if (/_tests\.rs$|\/tests\//.test(rel)) continue;
          if (rel.endsWith('settings/keys.rs')) continue;
          rust.push(fs.readFileSync(full, 'utf-8'));
        }
      }
    };
    for (const d of ['platform', 'crates', 'apps', 'modules', 'foundation']) {
      const full = path.join(ROOT, d);
      if (fs.existsSync(full)) walk(full);
    }
    const readers = rust.filter(
      (t) => t.includes('EDC_DEFAULT_TERMINAL') || t.includes('"edc.default_terminal"'),
    );
    expect(
      readers.length,
      'edc.default_terminal gained a production reader — F27/F49 is resolved for home 3, ' +
        'and the three-homes story needs re-measuring before the plan repeats it',
    ).toBe(0);
  });
});
