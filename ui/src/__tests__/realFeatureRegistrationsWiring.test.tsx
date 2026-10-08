// Every real registerPage() component is a lazy() thunk. This asserts each one
// still resolves to a real module on disk.
//
// WHY. A registration's component is written `lazy(() => import('./X'))`, and
// nothing in the build or the type-checker catches a thunk whose specifier no
// longer exists: TypeScript resolves the import statically, but the thunk is a
// runtime call, so a renamed or moved screen leaves a registration that looks
// fine until a user navigates to it and gets a blank frame. That is the failure
// class this whole shell investigation has been circling, and it is invisible to
// every existing suite — the shell tests register STUBS, and the component suites
// import their screens directly, so neither touches the wiring between them.
//
// WHAT IT DOES NOT DO: it does not import the modules (that would pull 47 real
// screens, with their IPC and contexts, into one test) and it does not render
// them. It resolves the specifier against the filesystem, which is exactly the
// question a missing file answers.
//
// SCOPE, measured 2026-10-07 and worth stating because a companion suite still
// cites an older figure: 27 feature directories call registerPage, for 47 calls,
// and ALL 47 components are lazy — the gate suite's header says "12 of those
// files carry feature:", which counts a different thing (files passing a feature:
// key) and should not be read as the size of this surface.

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

const FEATURES_DIR = resolve(__dirname, '../features');

interface LazyRegistration {
  /** The register.tsx the call lives in, repo-relative to src/. */
  file: string;
  /** The local const name bound to the lazy component. */
  component: string;
  /** The import specifier inside lazy(() => import('…')). */
  specifier: string;
}

function collectLazyRegistrations(): LazyRegistration[] {
  const out: LazyRegistration[] = [];
  for (const dir of readdirSync(FEATURES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = join(FEATURES_DIR, dir.name, 'register.tsx');
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf-8');
    if (!src.includes('registerPage(')) continue;

    const lazyByName = new Map<string, string>();
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\(['"]([^'"]+)['"]\)\)/g)) {
      lazyByName.set(m[1]!, m[2]!);
    }
    for (const m of src.matchAll(/registerPage\(\{([^}]*)\}/g)) {
      const component = m[1]!.match(/component:\s*(\w+)/)?.[1];
      if (!component) continue;
      const specifier = lazyByName.get(component);
      // A registration whose component is NOT a lazy const is a different shape
      // (an eager import); this guard only claims the lazy ones.
      if (!specifier) continue;
      out.push({ file: `features/${dir.name}/register.tsx`, component, specifier });
    }
  }
  return out;
}

describe('real registerPage components resolve', () => {
  const regs = collectLazyRegistrations();

  // Count assertion BEFORE any expectation: a resolver that silently returns an
  // empty list reads exactly like a clean tree.
  it('finds the lazy registrations it means to grade', () => {
    expect(regs.length).toBeGreaterThanOrEqual(40);
  });

  it('every lazy component specifier resolves to a file on disk', () => {
    const broken = regs.filter((r) => {
      const base = posix.join(posix.dirname(r.file), r.specifier);
      return ![base + '.tsx', base + '.ts', base + '/index.tsx']
        .some((c) => existsSync(resolve(__dirname, '..', c)));
    });
    expect(
      broken.map((b) => `${b.file} -> ${b.specifier} (component ${b.component})`),
      'a lazy() specifier no longer resolves — the route would render a blank frame',
    ).toEqual([]);
  });

  it('every lazy const declared in a register.tsx is actually registered', () => {
    // The converse: an orphaned lazy const means a screen was unregistered but
    // its import left behind, which is dead weight and a rename hazard.
    const orphans: string[] = [];
    for (const dir of readdirSync(FEATURES_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const file = join(FEATURES_DIR, dir.name, 'register.tsx');
      if (!existsSync(file)) continue;
      const src = readFileSync(file, 'utf-8');
      if (!src.includes('registerPage(')) continue;
      const declared = [...src.matchAll(/const\s+(\w+)\s*=\s*lazy\(/g)].map((m) => m[1]!);
      for (const name of declared) {
        // Referenced anywhere as a component: value, i.e. `component: Name`.
        if (!new RegExp(`component:\\s*${name}\\b`).test(src)) {
          orphans.push(`features/${dir.name}/register.tsx -> ${name}`);
        }
      }
    }
    expect(orphans, 'lazy const declared but never passed as a component').toEqual([]);
  });
});
