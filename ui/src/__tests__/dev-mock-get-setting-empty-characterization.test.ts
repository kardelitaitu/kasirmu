// ── CHARACTERIZATION test — dev-mock generic settings read ─────────────────
//
// This file does NOT ask for a fix and does NOT assert correct behaviour. It pins
// what the mock does today, so the divergence is a measured fact on disk instead of
// a claim in a work order, and so a future "improvement" to handlers/settings.ts
// cannot move it silently.
//
// THE DIVERGENCE (read off the source, not inferred):
//   Real, unset key -> None -> JSON null.
//     platform/core/src/settings/raw.rs:29-33   `match rows.next() { ... None => Ok(None) }`
//     crates/oz-bridge/src/settings.rs:438-446  `run_get_setting -> Result<Option<String>, _>`
//     apps/desktop-client/src/commands/settings.rs:241-246
//         "/// Returns \`None\` when the key does not exist."  -> Result<Option<String>, AppError>
//     apps/tablet-client/src/commands/settings.rs:458-463   same shape in the other shell
//   Already pinned twice on the Rust side, both named get_setting_returns_none_for_missing_key:
//     crates/oz-bridge/src/settings_tests.rs:336   apps/tablet-client/src/commands/settings_tests.rs:415
//   Real, a key SET to the empty string -> Some("") -> JSON "". So production DOES
//   distinguish unset from set-empty, and the TS contract says so too:
//   ui/src/api/settings.ts:208-213 documents "Returns null when the key has never
//   been written" and types it Promise<string | null>.
//   ui/src/dev-mock/handlers/settings.ts:71 answers \`''\` for every key and cannot.
//
// WHY THE FIX IS A DECISION, NOT A DRIVE-BY — test 3 proves the divergence is
// currently unobservable, and this proves a naive fix is not free: the four workspace
// cards never call \`get_setting\` — they call getSettingScoped (ui/src/api/settings.ts:263),
// which the dev-mock serves from THIS same handler via applyScopedAliases
// (ui/src/dev-mock/core/mockDispatcher.ts:84-94; \`get_setting_scoped\` is registered nowhere).
// Changing the handler to \`() => null\` would mirror production AND break the
// currently-green assertion at ui/src/__tests__/dev-mock-scoped-aliases.test.ts:81,
// \`expect(value).not.toBeNull()\`, which lists 'get_setting_scoped' among its OBSERVED names
// (:24-29). Whoever fixes it must resolve that collision on purpose.
//
// jsdom has no window.__TAURI_INTERNALS__, so invoke() routes to the mock — the same
// path a browser preview takes.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const wasUnhandled = () =>
  vi.mocked(console.warn).mock.calls.some((c) => String(c[0] ?? '').includes('Unhandled command'));

describe('CHARACTERIZATION: dev-mock get_setting answers empty string', () => {
  it('returns "" for an unset key, where production returns null (bug present)', async () => {
    const value = await invoke<string | null>('get_setting', { key: 'never.written.in.preview' });

    // Asserting that the divergence IS here. If a later pass makes the mock honest,
    // this line goes red on purpose and this file is deleted with the change.
    expect(value).toBe('');
    expect(value).not.toBeNull();
    expect(wasUnhandled()).toBe(false);
  });

  it('leaks the same answer onto get_setting_scoped, the name the cards call', async () => {
    // get_setting_scoped is registered nowhere; applyScopedAliases mirrors it onto the
    // base handler. So WorkspaceKdsSettings / WorkspaceInventorySettings /
    // WorkspaceRestaurantPosSettings / EmailReportSettings all read '' in preview.
    const value = await invoke<string | null>('get_setting_scoped', {
      sessionToken: 'preview-token',
      key: 'kds.density',
    });

    expect(wasUnhandled()).toBe(false);
    expect(value).toBe('');
  });

  it('is unobservable: every consumer predicate maps "" and null to one verdict', async () => {
    // Guards copied from their call sites —
    //   UpdateBanner.tsx:145                  prev && prev !== ver
    //   EmailReportSettings.tsx:91            if (raw) { JSON.parse(raw) }
    //   WorkspaceKdsSettings.tsx:92           sound !== 'false'
    //   WorkspaceKdsSettings.tsx:93           parseInt(yellow ?? '', 10) || DEFAULT
    //   WorkspaceInventorySettings.tsx:76     preferWhRaw === 'true'
    //   WorkspaceRestaurantPosSettings.tsx:78 raw === 'true'
    const empty = await invoke<string | null>('get_setting', { key: 'x' });
    const missing: string | null = null; // what production sends for an unset key
    const ver = '0.0.37';

    const truthyGuard = (v: string | null) => Boolean(v && v !== ver);
    const jsonGuard = (v: string | null) => (v ? 'parses' : 'skips');
    const notFalse = (v: string | null) => v !== 'false';
    const isTrue = (v: string | null) => v === 'true';
    const unparsable = (v: string | null) => Number.isNaN(parseInt(v ?? '', 10));

    for (const predicate of [truthyGuard, jsonGuard, notFalse, isTrue, unparsable]) {
      expect(predicate(empty)).toBe(predicate(missing));
    }
    // The collapse above is a measurement, not a tautology: the two values differ.
    expect(empty).not.toBe(missing);
  });
});

describe('CHARACTERIZATION: dev-mock settings writes answer two shapes', () => {
  it('pins true-vs-null per command name against a surface that has only one shape', async () => {
    const setSetting = await invoke<unknown>('set_setting', { key: 'a', value: 'b', userId: 'u' });
    const setSettings = await invoke<unknown>('set_settings', { entries: {} });
    const setSettingsScoped = await invoke<unknown>('set_settings_scoped', {
      sessionToken: 't',
      entries: {},
    });
    const setSettingScoped = await invoke<unknown>('set_setting_scoped', {
      sessionToken: 't',
      key: 'a',
      value: 'b',
    });
    const setStore = await invoke<unknown>('set_store_settings_scoped', { sessionToken: 't', args: {} });
    const setReceipt = await invoke<unknown>('set_receipt_settings_scoped', { sessionToken: 't', args: {} });
    const setHardware = await invoke<unknown>('set_hardware_settings_scoped', { sessionToken: 't', args: {} });
    const setCredit = await invoke<unknown>('set_credit_settings_scoped', { sessionToken: 't', args: {} });

    // What the mock does: handlers/settings.ts:91-93 answer true, :56 :68 :72 :79 :83 answer null.
    expect([setSetting, setSettings, setSettingsScoped]).toEqual([true, true, true]);
    expect([setSettingScoped, setStore, setReceipt, setHardware, setCredit]).toEqual([
      null, null, null, null, null,
    ]);

    // The true half is INVENTED. Every one of these commands is Result<(), AppError> on
    // the real surface — apps/desktop-client/src/commands/settings.rs:279 (set_setting),
    // :296 (set_setting_scoped), :315 (set_settings_scoped), :99, :61, :125, :200 — and
    // () serializes to null. Production has ONE shape for all eight; the mock has two.
    // Harmless because the api layer types them all Promise<void>
    // (ui/src/api/settings.ts:229, :243, :278) and no call site captures the value.
  });
});
