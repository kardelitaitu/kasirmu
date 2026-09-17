#!/usr/bin/env node
/**
 * Regression tests for verify-architecture-boundaries.py.
 *
 * Each test copies the checker into a temporary fixture repository so the
 * checker exercises the same root-relative behavior used in CI without
 * depending on the live Cargo graph.
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECKER = resolve(ROOT, 'scripts', 'verify-architecture-boundaries.py');
const fixtures = [];

function fixture({ packages = [], uiFiles = {}, baseline = { entries: [] }, metadata = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'oz-boundaries-'));
  fixtures.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'ui', 'src'), { recursive: true });
  copyFileSync(CHECKER, join(dir, 'scripts', 'verify-architecture-boundaries.py'));

  for (const [relative, content] of Object.entries(uiFiles)) {
    const path = join(dir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  const packageEntries = packages.map(({ name, manifest = `crates/${name}/Cargo.toml`, dependencies = [] }) => {
    const manifestPath = join(dir, manifest);
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `[package]\nname = "${name}"\n`);
    return {
      name,
      manifest_path: manifestPath,
      dependencies: dependencies.map(({ name: depName, path, kind = null }) => ({
        name: depName,
        path: join(dir, path ?? `crates/${depName}/Cargo.toml`),
        kind,
      })),
    };
  });
  for (const packageEntry of packageEntries) {
    for (const dependency of packageEntry.dependencies) {
      const dependencyPath = dependency.path;
      if (dependencyPath.endsWith('Cargo.toml')) {
        mkdirSync(dirname(dependencyPath), { recursive: true });
        if (!readFileSafe(dependencyPath)) writeFileSync(dependencyPath, '[package]\n');
      } else {
        mkdirSync(join(dependencyPath), { recursive: true });
        writeFileSync(join(dependencyPath, 'Cargo.toml'), '[package]\n');
      }
    }
  }
  const metadataPayload = metadata ?? { packages: packageEntries };
  writeFileSync(join(dir, 'scripts', 'metadata.json'), JSON.stringify(metadataPayload, null, 2));
  writeFileSync(join(dir, 'scripts', 'architecture-boundaries-baseline.json'), JSON.stringify(baseline, null, 2));
  return dir;
}

function readFileSafe(path) {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

function run(dir, args = []) {
  try {
    const stdout = execFileSync(
      process.platform === 'win32' ? 'python' : 'python3',
      ['scripts/verify-architecture-boundaries.py', '--metadata-file', 'scripts/metadata.json', ...args],
      { cwd: dir, encoding: 'utf8', stdio: 'pipe', timeout: 30_000 },
    );
    return { code: 0, output: stdout };
  } catch (error) {
    return {
      code: error.status ?? 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

function baselineEntry(rule, path, target, overrides = {}) {
  return {
    rule,
    path,
    target,
    reason: 'Fixture transitional debt',
    owner: 'test-owner',
    introduced: '2026-08-06',
    expires: '2099-12-31',
    ...overrides,
  };
}

after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

describe('verify-architecture-boundaries.py', () => {
  it('passes a clean fixture and excludes API, comments, tests, and dev mocks', () => {
    const dir = fixture({
      packages: [{ name: 'foundation' }],
      uiFiles: {
        'ui/src/api/allowed.ts': "import { invoke } from '@tauri-apps/api/core'; invoke('allowed');",
        'ui/src/comments.ts': "// invoke('comment')\nconst text = 'invoke(\\\"string\\\")';",
        'ui/src/__tests__/screen.test.tsx': "invoke('test');",
        'ui/src/dev-mock/tauri.ts': "invoke('mock');",
      },
    });
    const result = run(dir);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /0 new\/expired blocking/);
  });

  it('reports a production module-to-module dependency', () => {
    const dir = fixture({
      packages: [{ name: 'modules-sales', dependencies: [{ name: 'modules-inventory' }] }, { name: 'modules-inventory' }],
    });
    const result = run(dir);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /module-to-module/);
  });

  it('reports oz-core upward dependencies', () => {
    const dir = fixture({
      packages: [{ name: 'oz-core', dependencies: [{ name: 'modules-sales' }] }, { name: 'modules-sales' }],
    });
    const result = run(dir);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /core-upward-dependency/);
  });

  it('matches Cargo dependency paths reported as package directories', () => {
    const dir = fixture({
      packages: [
        { name: 'modules-sales', dependencies: [{ name: 'modules-inventory', path: 'crates/modules-inventory' }] },
        { name: 'modules-inventory', manifest: 'crates/modules-inventory/Cargo.toml' },
      ],
    });
    const result = run(dir);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /module-to-module/);
  });

  it('allows platform-startup composition and ignores dev dependencies', () => {
    const dir = fixture({
      packages: [
        { name: 'platform-startup', dependencies: [{ name: 'modules-sales' }] },
        { name: 'modules-sales' },
        { name: 'modules-reporting', dependencies: [{ name: 'modules-sales', kind: 'dev' }] },
      ],
    });
    const result = run(dir);
    assert.equal(result.code, 0, result.output);
  });

  it('reports direct production UI invoke outside the API boundary', () => {
    const dir = fixture({ uiFiles: { 'ui/src/hooks/useBad.ts': "import { invoke } from '@tauri-apps/api/core';\nawait invoke('bad');" } });
    const result = run(dir);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /ui-direct-invoke/);
    assert.match(result.output, /useBad\.ts:2/);
  });

  it('recognizes generic, aliased, namespace, and import-only Tauri usage', () => {
    const dir = fixture({
      uiFiles: {
        'ui/src/generic.ts': "import { invoke } from '@tauri-apps/api/core';\nawait invoke<string>('generic');",
        'ui/src/alias.ts': "import { invoke as call } from '@tauri-apps/api/core';\nawait call('alias');",
        'ui/src/namespace.ts': "import * as core from '@tauri-apps/api/core';\nawait core.invoke('namespace');",
        'ui/src/import-only.ts': "import { invoke } from '@tauri-apps/api/core';\nexport const unused = true;",
      },
    });
    const result = run(dir);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /generic/);
    assert.match(result.output, /alias/);
    assert.match(result.output, /namespace/);
    assert.match(result.output, /import-only\.ts/);
  });

  it('does not report an unrelated local invoke function', () => {
    const dir = fixture({ uiFiles: { 'ui/src/local.ts': "function invoke(value: string) { return value; }\ninvoke('local');" } });
    const result = run(dir);
    assert.equal(result.code, 0, result.output);
  });

  it('suppresses a known finding but keeps it visible as tracked debt', () => {
    const dir = fixture({
      uiFiles: { 'ui/src/hooks/useKnown.ts': "import { invoke } from '@tauri-apps/api/core';\nawait invoke('known');" },
      baseline: { entries: [baselineEntry('ui-direct-invoke', 'ui/src/hooks/useKnown.ts', 'known')] },
    });
    const result = run(dir);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /tracked transitional finding/);
    assert.match(result.output, /ui-direct-invoke/);
  });

  it('fails when a new finding is added beside a tracked one', () => {
    const dir = fixture({
      uiFiles: {
        'ui/src/hooks/useKnown.ts': "await invoke('known');",
        'ui/src/hooks/useNew.ts': "await invoke('new');",
      },
      baseline: { entries: [baselineEntry('ui-direct-invoke', 'ui/src/hooks/useKnown.ts', 'known')] },
    });
    const result = run(dir);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /new.*ui-direct-invoke/s);
  });

  it('fails for expired and stale baseline entries', () => {
    const dir = fixture({
      uiFiles: { 'ui/src/hooks/useKnown.ts': "await invoke('known');" },
      baseline: {
        entries: [
          baselineEntry('ui-direct-invoke', 'ui/src/hooks/useKnown.ts', 'known', { introduced: '2019-01-01', expires: '2020-01-01' }),
          baselineEntry('ui-direct-invoke', 'ui/src/hooks/gone.ts', 'gone'),
        ],
      },
    });
    mkdirSync(join(dir, 'ui', 'src', 'hooks'), { recursive: true });
    writeFileSync(join(dir, 'ui', 'src', 'hooks', 'gone.ts'), 'export {};');
    const result = run(dir);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /expired|stale/);
  });

  it('fails closed on malformed metadata', () => {
    const dir = fixture({ metadata: { packages: 'not-an-array' } });
    const result = run(dir);
    assert.equal(result.code, 2, result.output);
    assert.match(result.output, /malformed|invalid|no valid/);
  });

  it('normalizes Windows-style baseline paths and emits stable JSON', () => {
    const dir = fixture({
      uiFiles: { 'ui/src/hooks/useKnown.ts': "import { invoke } from '@tauri-apps/api/core';\nawait invoke('known');" },
      baseline: { entries: [baselineEntry('ui-direct-invoke', 'ui\\src\\hooks\\useKnown.ts', 'known')] },
    });
    const result = run(dir, ['--json']);
    assert.equal(result.code, 0, result.output);
    const json = JSON.parse(result.output);
    assert.equal(json.summary.tracked, 1);
    assert.equal(json.summary.blocking, 0);
    assert.equal(json.tracked_transitional[0].rule, 'ui-direct-invoke');
    assert.equal(json.tracked_transitional[0].path, 'ui/src/hooks/useKnown.ts');
  });

  it('accepts a toolkit-free oz-bridge and ignores the crate own purity comments', () => {
    const dir = fixture({
      uiFiles: {
        'crates/kasirmu-bridge/Cargo.toml': '[package]\nname = "oz-bridge"\n\n[dependencies]\nserde = "1"\n',
        'crates/kasirmu-bridge/src/lib.rs': '// depends on no tauri, gtk or webkit type\npub struct Ctx;\n',
      },
    });
    const result = run(dir);
    assert.equal(result.code, 0, result.output);
  });

  it('reports a UI toolkit dependency or reference inside oz-bridge', () => {
    const dir = fixture({
      uiFiles: {
        'crates/kasirmu-bridge/Cargo.toml': '[package]\nname = "oz-bridge"\n\n[dependencies]\ntauri = "2"\n',
        'crates/kasirmu-bridge/src/lib.rs': '// no tauri here\nuse tauri::Manager;\n',
      },
    });
    const result = run(dir);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /bridge-toolkit-purity/);
    assert.match(result.output, /Cargo\.toml:5/);
    assert.match(result.output, /lib\.rs:2/);
  });

  it('reports renderer vocabulary in an application-layer doc comment', () => {
    const dir = fixture({
      uiFiles: {
        'crates/kasirmu-core/src/lib.rs': '/// Rendered by `Row.tsx` and styled in `row.css`.\npub struct Row;\n',
      },
    });
    const result = run(dir);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /ui-framework-vocabulary/);
    assert.match(result.output, /\.tsx/);
    assert.match(result.output, /lib\.rs:1/);
  });

  it('ignores the same vocabulary inside a string literal', () => {
    const dir = fixture({
      uiFiles: {
        'crates/kasirmu-core/src/exts.rs': 'pub const EXTS: [&str; 2] = [".tsx", ".css"];\n',
      },
    });
    const result = run(dir);
    assert.equal(result.code, 0, result.output);
    assert.doesNotMatch(result.output, /ui-framework-vocabulary/);
  });

  it('does not let a lone lifetime apostrophe swallow the comments after it', () => {
    const dir = fixture({
      uiFiles: {
        'crates/kasirmu-core/src/lifetime.rs': "pub fn name() -> &'static str { NAME }\n/// Cited as `Row.tsx`.\npub struct Row;\n",
      },
    });
    const result = run(dir);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /ui-framework-vocabulary/);
    assert.match(result.output, /lifetime\.rs:2/);
  });

  it('scans block comments, including the text after a nested close', () => {
    const dir = fixture({
      uiFiles: {
        'crates/kasirmu-core/src/block.rs': '/* outer /* inner */ still outer: `Row.tsx` */\npub struct Row;\n',
      },
    });
    const result = run(dir);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /ui-framework-vocabulary/);
    assert.match(result.output, /block\.rs:1/);
  });

  it('report-only returns zero for blocking findings', () => {
    const dir = fixture({ uiFiles: { 'ui/src/hooks/useBad.ts': "await invoke('bad');" } });
    const result = run(dir, ['--report-only']);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /new\/expired blocking/);
  });

  // Root-independence, 2026-09-15. The live defect: a finding keyed off a
  // SIBLING checkout (<base>/0.0.35/oz-pos, the multi-root layout) had its "../"
  // prefix destroyed by lstrip("./"), so it printed as a repo-relative path, all
  // eight live suppressions read stale, and --strict exited 1 with nothing in the
  // repo changed. Entry paths and finding paths now share one normalizer.
  function baselineFor(dir, entries) {
    writeFileSync(join(dir, 'scripts', 'architecture-boundaries-baseline.json'), JSON.stringify({ entries }, null, 2));
    return dir;
  }
  const CORE_CRM = {
    packages: [
      { name: 'oz-core', dependencies: [{ name: 'modules-crm', path: 'crates/modules-crm' }] },
      { name: 'modules-crm', manifest: 'crates/modules-crm/Cargo.toml' },
    ],
  };

  it('tracks a suppression recorded under a different spelling of the same root', () => {
    const dir = fixture(CORE_CRM);
    // Same file, spelled through a redundant ".." and as an absolute path.
    baselineFor(dir, [baselineEntry('core-upward-dependency', join(dir, 'crates', '..', 'crates', 'oz-core', 'Cargo.toml'), 'modules-crm')]);
    const result = run(dir, ['--strict', '--json']);
    assert.equal(result.code, 0, result.output);
    const json = JSON.parse(result.output);
    assert.equal(json.summary.tracked, 1, result.output);
    assert.equal(json.summary.stale, 0, 'a differently-spelled root must not orphan a live suppression');
    assert.equal(json.summary.blocking, 0, result.output);
    assert.equal(json.tracked_transitional[0].path, 'crates/kasirmu-core/Cargo.toml');
  });

  it('tracks a ./-prefixed suppression against an absolute finding', () => {
    const dir = fixture(CORE_CRM);
    baselineFor(dir, [baselineEntry('core-upward-dependency', './crates/kasirmu-core/Cargo.toml', 'modules-crm')]);
    const result = run(dir, ['--strict', '--json']);
    assert.equal(result.code, 0, result.output);
    assert.equal(JSON.parse(result.output).summary.tracked, 1, result.output);
  });

  // Fallback-cache guard, 2026-09-15: the tracked
  // scripts/architecture-cargo-metadata.json carried workspace_root from a
  // sibling checkout, so ANY transient cargo failure made the gate score this
  // tree against another worktree and call eight live suppressions stale.
  function runWithoutMetadataFile(dir, args = []) {
    try {
      const stdout = execFileSync(
        process.platform === 'win32' ? 'python' : 'python3',
        ['scripts/verify-architecture-boundaries.py', ...args],
        { cwd: dir, encoding: 'utf8', stdio: 'pipe', timeout: 60_000 },
      );
      return { code: 0, output: stdout };
    } catch (error) {
      return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  }

  it('refuses to substitute the cached cargo graph when cargo metadata fails', () => {
    const dir = fixture({ packages: [{ name: 'oz-core' }] });
    // A manifest cargo cannot read, plus a cache that names ANOTHER root.
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = \"broken this is not valid toml\n');
    writeFileSync(
      join(dir, 'scripts', 'architecture-cargo-metadata.json'),
      JSON.stringify({ workspace_root: join(dir, '..', 'some-other-checkout'), packages: [], version: 1 }, null, 2),
    );
    const result = runWithoutMetadataFile(dir, ['--strict']);
    assert.equal(result.code, 2, 'must fail closed, never score a borrowed graph: ' + result.output);
    // Names the cargo error AND the supported way in; no root arithmetic,
    // because the implicit route that needed it is gone (same root would also
    // refuse - the cache is never opened at all).
    assert.match(result.output, /cargo metadata failed/, result.output);
    assert.match(result.output, /does not substitute a cached one/, result.output);
    assert.match(result.output, /--metadata-file/, 'must name the supported way in: ' + result.output);
    assert.doesNotMatch(result.output, /stale baseline entry/, 'it must not report stale entries it never verified');
    assert.doesNotMatch(result.output, /0 tracked transitional/, result.output);
  });


  it("refuses a graph whose declared workspace_root is not the tree it scores", () => {
    // The hole two passes walked past: the tracked architecture-cargo-metadata.json
    // names a NESTED sibling checkout, so relative_path() rendered its findings as
    // plausible repo-relative paths with no "../" in them and the escape check never
    // fired. Equality on resolved roots is the only comparison that sees it, and
    // containment must NOT be accepted here -- release checkouts live inside this
    // root by design. The second half proves the honest case still passes: a fixture
    // that declares its own mkdtemp directory is exactly what --metadata-file is for.
    const foreign = fixture({ packages: [{ name: 'oz-core', dependencies: [{ name: 'modules-crm', kind: 'normal' }] }] });
    const sibling = join(foreign, '..', '0.0.35', 'oz-pos');
    writeFileSync(join(foreign, 'scripts', 'metadata.json'), JSON.stringify({ workspace_root: sibling, packages: [] }, null, 2));
    const refused = run(foreign, ['--strict']);
    assert.equal(refused.code, 2, 'a sibling-checkout graph must be refused outright: ' + refused.output);
    assert.match(refused.output, /workspace_root/, refused.output);
    assert.match(refused.output, /cannot score this one/, 'the message must say why: ' + refused.output);
    assert.doesNotMatch(refused.output, /stale baseline entry/, 'it must not report findings it never verified: ' + refused.output);
    const own = fixture({ packages: [{ name: 'oz-core', dependencies: [{ name: 'modules-crm', kind: 'normal' }] }] });
    const ownMeta = JSON.parse(readFileSync(join(own, 'scripts', 'metadata.json'), 'utf8'));
    ownMeta.workspace_root = own;
    writeFileSync(join(own, 'scripts', 'metadata.json'), JSON.stringify(ownMeta, null, 2));
    const accepted = run(own, ['--strict']);
    assert.equal(accepted.code, 0, 'a fixture-rooted graph must be scored, not refused: ' + accepted.output);
    assert.match(accepted.output, /tracked transitional finding\(s\)/, 'the refusal must not replace the normal report: ' + accepted.output);
    assert.doesNotMatch(accepted.output, /refusing to score/, 'equal roots are not a conflict: ' + accepted.output);
  });

  it('does NOT let an escaped ../ entry silence a repo-relative finding', () => {
    // Before the repair this entry normalized to 'crates/kasirmu-core/Cargo.toml' and
    // matched the finding, so a suppression naming a file OUTSIDE the repo
    // silenced a violation INSIDE it. Equality on normalized paths refuses it,
    // and the entry stays visible as stale rather than vanishing.
    const dir = fixture(CORE_CRM);
    baselineFor(dir, [baselineEntry('core-upward-dependency', '../crates/kasirmu-core/Cargo.toml', 'modules-crm')]);
    const result = run(dir, ['--strict', '--json']);
    assert.equal(result.code, 1, 'an unmatched finding must still block: ' + result.output);
    const json = JSON.parse(result.output);
    assert.equal(json.summary.blocking, 1, result.output);
    assert.equal(json.summary.tracked, 0, 'the escaped entry must not be reported as matching');
    assert.equal(json.new_blocking[0].path, 'crates/kasirmu-core/Cargo.toml');
    assert.equal(json.summary.stale, 1, 'the foreign entry is reported stale, not silently useful');
  });
});
