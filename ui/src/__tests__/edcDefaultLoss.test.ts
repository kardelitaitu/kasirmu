// ── The EDC default is set, saved and lost (F28) ──────────────────────
//
// `TerminalPreferencesCard` renders a "Default EDC" select with a Test Connection button
// (`:114-117`). Choosing a terminal calls
//
//     hw.updateLocalPrefs({ defaultEdcTerminalId: v || undefined })
//
// which sets the field in memory. It is then NEVER PERSISTED, at any layer:
//
//   · `toHardwareSettingsDto` (useTerminalHardware.ts:110-128) omits it
//   · `fromHardwareSettingsDto` (:131-173) does not restore it
//   · the UI's `HardwareSettingsDto` (ui/src/api/settings.ts:103-119) has no field
//   · the bridge's `HardwareSettingsDto` (crates/kasirmu-bridge/src/settings/dto.rs:147)
//     has no field either
//   · `TerminalProfile` (platform/core/src/terminal_profile.rs:55) has none
//
// So the operator picks a default terminal, the connection test SUCCEEDS, and the
// choice is gone after a reload. Worse, the settings key that LOOKS like its storage —
// `edc.default_terminal` — is declared and read by nothing (F27), and
// `docs/plans/_active/owner-question-2026-09-28-r4-r6-r7.md:51` states the value is
// "stored in register LocalPrefs (terminal_profile.json)", which no layer implements.
//
// PINNED, NOT FIXED. Carrying the value end to end is a five-layer change (UI type, both
// DTOs, the profile struct, and a migration for existing profiles), and it touches the
// desktop shell whose hardware commands are already flagged as an F-008/F-050 parity gap
// (api/settings.ts:128-132). That is a planned change, not a drive-by repair. What this
// file does is make the loss VISIBLE and stop the doc's claim being read as true.
//
// INVERT, DO NOT DELETE: when the field is carried, each case below flips to asserting
// the round trip, and this file becomes the proof the fix landed.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = ['ui/src/hooks/useTerminalHardware.ts', 'crates/kasirmu-bridge/src/settings/dto.rs'];
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (markers.every((m) => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the repo root from ' + process.cwd());
}

const ROOT = findRoot();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const HOOK = 'ui/src/hooks/useTerminalHardware.ts';
const UI_DTO = 'ui/src/api/settings.ts';
const BRIDGE_DTO = 'crates/kasirmu-bridge/src/settings/dto.rs';
const PROFILE = 'platform/core/src/terminal_profile.rs';

describe('the EDC default cannot survive a save/load (F28)', () => {
  it('the operator CAN set it (so this is a real control, not dead markup)', () => {
    // Guards the premise: if the control is removed, the finding is moot and this whole
    // file should go rather than keep pinning a lost field.
    expect(read('ui/src/features/settings/workspace-cards/TerminalPreferencesCard.tsx'))
      .toContain('defaultEdcTerminalId');
  });

  it('the write mapper drops it', () => {
    const hook = read(HOOK);
    const fn = hook.slice(hook.indexOf('function toHardwareSettingsDto'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body, 'toHardwareSettingsDto now sends defaultEdcTerminalId — the field is ' +
      'being persisted; flip this pin to a round-trip assertion').not.toContain('defaultEdcTerminalId');
  });

  it('the read mapper drops it', () => {
    const hook = read(HOOK);
    const fn = hook.slice(hook.indexOf('function fromHardwareSettingsDto'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).not.toContain('defaultEdcTerminalId');
  });

  it('no DTO layer has a field to carry it', () => {
    for (const f of [UI_DTO, BRIDGE_DTO]) {
      expect(read(f).toLowerCase(), f + ' now carries an EDC default').not.toContain('edc');
    }
    expect(read(PROFILE).toLowerCase()).not.toContain('edc');
  });
});