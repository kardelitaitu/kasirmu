// ── Dev-mock scoped-name aliasing ─────────────────────────────────
//
// The ADR #7 migration moved the api layer to the `_scoped` spelling of commands
// while the dev-mock kept registering the unscoped names. The mock had a curated
// SCOPED_ALIASES list (7 store-profile pairs) rather than a rule, so every scoped
// command outside that list fell through to `return null` with a console.warn.
//
// That is the exact defect invokeCoverage.ts documents for hand-written mock chains
// (R36-02): the component swallows the null, the test still passes, and the
// assertion is quietly about the failure state instead of the data path. Measured on
// the tree, 217 calls across 4 commands were landing there -- including
// get_hardware_settings_scoped, which the terminal-hardware hook began calling in
// 1fbcc8a0, so ~78 test invocations were exercising the catch-and-default branch
// while the tests read as if the DTO had loaded.
//
// These pin the general policy, not just the four names that happened to be caught.

import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

// The four that were observed unhandled on the current tree.
const OBSERVED = [
  'get_hardware_settings_scoped',
  'list_displays_scoped',
  'offline_queue_status_summary_scoped',
  'get_setting_scoped',
];

// A pair outside the curated SCOPED_ALIASES list whose base IS registered, so passing
// it proves the fix is a rule rather than more hand-added entries. If a future change
// reverts to a curated list, this is the case that fails. Two earlier drafts of this
// control were wrong: list_store_profiles_scoped is curated, and get_brand_settings_scoped
// is registered directly -- both passed against the broken code and proved nothing.
// 115 such gaps exist on the current tree; this asserts one.
const UNLISTED_CONTROL = 'check_license_status_scoped';

async function resolvesToData(cmd: string) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const value = await invoke(cmd, { sessionToken: 'preview-token' });
    const unhandled = warn.mock.calls.some((c) =>
      String(c[0] ?? '').includes('Unhandled command'));
    return { value, unhandled };
  } finally {
    warn.mockRestore();
    log.mockRestore();
  }
}

describe('dev-mock scoped command aliasing', () => {
  it.each(OBSERVED)('%s is answered from its unscoped twin, not null', async (cmd) => {
    const { value, unhandled } = await resolvesToData(cmd);
    // The warn is the load-bearing assertion: a handler that legitimately returns null
    // would pass `value !== null` by accident of nothing else.
    expect(unhandled).toBe(false);
    expect(value).not.toBeNull();
  });

  it('aliases any scoped name whose base is registered, not just a curated list', async () => {
    // Asserts only that a handler was found: the policy guarantees aliasing, not that
    // every base returns non-null. Requiring data here would test the base's stub, not
    // the rule.
    const { unhandled } = await resolvesToData(UNLISTED_CONTROL);
    expect(unhandled).toBe(false);
  });

  it('still warns for a scoped command with no twin anywhere', async () => {
    // The rule must not become "answer everything": a genuinely unknown command has to
    // stay loud, which is the whole point of the dev-mock's warn.
    const { unhandled } = await resolvesToData('this_command_does_not_exist_scoped');
    expect(unhandled).toBe(true);
  });
});
