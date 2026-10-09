// ── The tablet drops local prefs the desktop carries (F29) ────────────
//
// `TerminalPreferencesCard` renders four operator controls — sound volume, dark
// mode, scale auto-zero, and a default EDC terminal. All four are LOST, but by
// DIFFERENT causes, and that distinction is the finding:
//
//   · soundVolume / darkMode / scaleAutoZero — the DTO carries them and the bridge
//     persists them (dto.rs:252-254), but the TABLET command hand-builds its profile
//     from five fields plus `..Default::default()`
//     (apps/mobile-tauri/src/commands/settings.rs:685-692), so the operator's values
//     are replaced by the struct defaults — volume 80, dark off, auto-zero on.
//   · defaultEdcTerminalId — absent from every layer (F28).
//
// The tablet's READ is worse: `get_hardware_settings_scoped` (:649-655) returns five
// hardcoded store settings and NEVER READS the profile JSON it just wrote. So even a
// correctly-stored profile would not come back.
//
// THE TWO SHELLS DISAGREE. The bridge's `From<HardwareSettingsDto> for TerminalProfile`
// (dto.rs:237-257) carries all three local prefs, and its read goes through
// `HardwareSettingsDto::from(profile)` (settings.rs:314). Desktop therefore keeps the
// values; tablet resets them. Same DTO, same table, two behaviours.
//
// Why it is invisible: `handleSave` clears the dirty flag on resolve
// (TerminalPreferencesCard.tsx:146-147), so the screen says saved and the slider looks
// applied until the next load. That is the F18 shape — a control that reports success
// while the runtime discards the value.
//
// PINNED, NOT FIXED: repairing it changes what the tablet persists, which needs an owner
// call on whether register-local prefs belong in the terminal profile at all.
// INVERT each case when that is settled.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = ['apps/mobile-tauri/src/commands/settings.rs', 'crates/kasirmu-bridge/src/settings/dto.rs'];
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

const TABLET = 'apps/mobile-tauri/src/commands/settings.rs';
const DTO = 'crates/kasirmu-bridge/src/settings/dto.rs';

/** The body of a `pub async fn <name>` up to the next top-level `}` line. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf('pub async fn ' + name);
  if (start < 0) return '';
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

describe('tablet hardware settings carry the local prefs (F29)', () => {
  it('the bridge DOES carry them (guards the premise of the finding)', () => {
    // If the bridge stopped carrying them, the two shells would agree and this whole
    // file would be pinning a shared bug rather than a disagreement.
    const dto = read(DTO);
    const from = dto.slice(dto.indexOf('impl From<HardwareSettingsDto> for TerminalProfile'));
    expect(from).toContain('sound_volume: dto.sound_volume');
    expect(from).toContain('dark_mode: dto.dark_mode');
    expect(from).toContain('scale_auto_zero: dto.scale_auto_zero');
  });

  it('the tablet WRITE discards them via ..Default::default()', () => {
    const body = fnBody(read(TABLET), 'set_hardware_settings_scoped');
    expect(body, 'the tablet write function was not found — extraction has drifted')
      .not.toBe('');
    expect(body).toContain('..platform_core::terminal_profile::TerminalProfile::default()');
    for (const f of ['sound_volume', 'dark_mode', 'scale_auto_zero']) {
      expect(
        body,
        `the tablet write now sets ${f} — the shell disagreement is fixed; invert this pin`,
      ).not.toContain(f + ':');
    }
  });

  it('the tablet READ never consults the profile it wrote', () => {
    const body = fnBody(read(TABLET), 'get_hardware_settings_scoped');
    expect(body).not.toBe('');
    for (const f of ['sound_volume', 'dark_mode', 'scale_auto_zero', 'profile_json']) {
      expect(body, `the tablet read now returns ${f} — invert this pin`).not.toContain(f);
    }
  });
});