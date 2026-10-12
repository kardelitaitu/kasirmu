/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── Dev-mock: the setting store is ONE store across every spelling ───────
//
// Follow-up to __tests__/dev-mock-setting-persistence.test.ts (bb449a598).
//
// api/settings.ts keeps setSetting and setSettingScoped as deliberate twins that
// write DIFFERENT databases for device-global keys — the unscoped command locks
// the bridge's global identity connection, the scoped one writes the store's own
// database (see the doc comment at api/settings.ts:299-311). The mock models one
// store, so the two spellings MUST agree; what matters is that whichever one a
// component calls, the other can read it back.
//
// This exists because the get_setting pair is the one the scoped-alias rule
// synthesizes (get_setting -> get_setting_scoped), while the set_setting pair is
// explicitly registered in two different maps (settingsHandlers and
// settingsWriteHandlers). Those are two independent routes to the store, so a
// future edit that touches only one of them would leave the pair disagreeing
// again — silently, because each half still returns something truthy.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const read = (key: string): Promise<string | null> =>
  invoke<string | null>('get_setting_scoped', { sessionToken: 't', key });

describe('dev-mock setting store is shared across spellings', () => {
  it('set_setting is readable through the scoped getter', async () => {
    const key = `cross.unscoped.write.${Date.now()}`;
    await invoke('set_setting', { key, value: 'from-unscoped', userId: 'u1' });
    expect(
      await read(key),
      'an unscoped set_setting write must be visible to get_setting_scoped — ' +
        'the mock models one store, so a component using either spelling must ' +
        'see the same value',
    ).toBe('from-unscoped');
  });

  it('set_setting_scoped is readable through the unscoped getter', async () => {
    const key = `cross.scoped.write.${Date.now()}`;
    await invoke('set_setting_scoped', { sessionToken: 't', key, value: 'from-scoped' });
    const viaUnscoped = await invoke<string | null>('get_setting', { key });
    expect(
      viaUnscoped,
      'a scoped write must be visible to the unscoped getter too',
    ).toBe('from-scoped');
  });

  it('the batch writer lands in the same store as the single writer', async () => {
    const stamp = Date.now();
    const a = `batch.a.${stamp}`;
    const b = `batch.b.${stamp}`;
    await invoke('set_settings_scoped', {
      sessionToken: 't',
      entries: { [a]: 'A', [b]: 'B' },
    });
    expect(await read(a)).toBe('A');
    expect(await read(b)).toBe('B');

    // And a single write after a batch must not drop the batch.
    await invoke('set_setting_scoped', { sessionToken: 't', key: `batch.c.${stamp}`, value: 'C' });
    expect(await read(a), 'a later single write must not clear a batched key').toBe('A');
    expect(await read(`batch.c.${stamp}`)).toBe('C');
  });

  it('keeps an explicitly empty value distinct from an unset key', async () => {
    // api/settings.ts:321 — "Pass an empty string to store an empty value."
    // Callers use this to CLEAR a key while still marking it written.
    const key = `empty.value.${Date.now()}`;
    await invoke('set_setting_scoped', { sessionToken: 't', key, value: '' });
    expect(await read(key), 'an empty string is a value, not an absence').toBe('');
    expect(await read(`unset.${Date.now()}`), 'an unwritten key is null').toBeNull();
  });
});
