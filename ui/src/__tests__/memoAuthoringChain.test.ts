// ── The memo authoring surface is desktop-only BY RULING, not by accident ──
//
// `list_authored_memos_scoped` sits on the tablet allowlist in
// scripts/ipc-parity-allowlist.json as a recorded product choice: Memo AUTHORING
// is a back-office manager action, and the tablet's Memo surface is the display
// banner. `verify-scoped-reads.py --shell tablet` reports it every run, which is
// correct and will keep being correct until the ruling changes.
//
// The ruling is only honest while the DESKTOP half is genuinely live. If MemosScreen
// were untangled from the feature registry -- or registerMemoFeature stopped being
// called -- then the desktop half would be dead too, and the allowlist entry would
// be shielding an orphan while still reading as a deliberate asymmetry. Those are
// very different debts, and the difference is invisible to a command-name grep.
//
// So this file pins the CHAIN, hop by hop. It reads source rather than importing,
// because the claim is about wiring and a passing import proves nothing about
// whether anything calls the function.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string =>
  readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('memo authoring chain (the tablet exemption rests on it)', () => {
  it('MemosScreen calls the authored-memos read', () => {
    const src = read('features/memo/MemosScreen.tsx');
    expect(src).toMatch(/await listAuthoredMemosScoped\(sessionToken\)/);
  });

  it('the memo feature registers a page with a memo:write requirement', () => {
    const src = read('features/memo/register.tsx');
    expect(src).toMatch(/registerPage\(\{/);
    expect(src).toMatch(/route: 'memos'/);
    expect(src).toMatch(/requiredPermission: 'memo:write'/);
  });

  it('registerAllFeatures calls registerMemoFeature', () => {
    expect(read('features/index.ts')).toMatch(/^\s*registerMemoFeature\(\);$/m);
  });

  it('the desktop entry reaches registerAllFeatures', () => {
    // App.tsx imports it and calls it at module scope.
    const app = read('App.tsx');
    expect(app).toMatch(/import \{ registerAllFeatures \} from '@\/features'/);
    expect(app).toMatch(/^registerAllFeatures\(\);$/m);
    // main.mobile.tsx is the OTHER entry and must register too, or the tablet
    // would lose the whole registry rather than just the memo route.
    expect(read('main.mobile.tsx')).toMatch(/registerAllFeatures\(\)/);
  });

  it('the tablet shell resolves routes through the shared page registry', () => {
    // If it did not, the exemption sentence ('the tablet has no management
    // surface') would be true for a different reason than the one recorded.
    expect(read('app/tablet/TabletAppShell.tsx')).toMatch(/getPage\(currentRoute\)/);
  });
});
