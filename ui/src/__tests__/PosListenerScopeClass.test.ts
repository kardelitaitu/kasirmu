// ── Class guard: a listener effect must not close over a scoped loader ──────
//
// The round-1 defect (e6276fb45) was one row of a CLASS: an effect that
// registers a Tauri/DOM listener, calls a loader reading a store-scoped value
// (`sessionToken`, `section`), and declares an EMPTY dependency array. The
// handler is built once, on mount, and keeps that render's token -- so after a
// store switch the next event reads or writes the WRONG STORE, silently.
//
// The correct shape already exists in this tree, deliberately: ExpoScreen.tsx
// subscribes to `kds:orders-changed` and calls `loadRef.current()`, a ref holding
// the latest loader. A ref is immune because it is re-assigned every render while
// the subscription stays put. So this guard looks for a BARE call, not for
// `x.current()`.
//
// WHAT MAKES THE ZERO MEAN SOMETHING
// A negative is only worth anything if the check can fail. This file was run
// against the PRE-FIX TableManagementScreen: it fires (`line 210: loadTables`)
// on `e6276fb45^` and reports nothing on the current tree. The clean result is
// measured, not assumed.
//
// It is a SOURCE check, not a render test, for the reason recorded in
// TableManagementFloorSyncScope.test.ts: proving which token reached a scoped
// read needs a scaffolding the production code does not have.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const UI_SRC = resolve(__dirname, '..');
const ROOTS = ['features/sales', 'features/restaurant', 'features/tables', 'features/kds'];

function collect(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!/__tests__|node_modules/.test(e.name)) collect(full, out);
    } else if (e.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

// Names re-assigned every render, so a closure is not stale in them.
const REF_SAFE = /^(fn)$/;

/** How many empty-deps listener effects the scan actually inspected. */
let examined = 0;

describe('POS listener effects do not close over a scoped loader', () => {
  it('every empty-deps listener effect calls through a ref, or names its deps', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of collect(join(UI_SRC, root))) {
        const src = readFileSync(file, 'utf-8').split(/\r?\n/);
        src.forEach((line, i) => {
          if (!/useEffect\(/.test(line)) return;
          let depth = 0;
          let end = -1;
          for (let k = i; k < src.length && k < i + 120; k++) {
            for (const ch of src[k] ?? '') {
              if (ch === '{') depth++;
              else if (ch === '}') depth--;
            }
            if (depth === 0 && k > i) { end = k; break; }
          }
          if (end === -1) return;
          const body = src.slice(i, end + 1).join('\n');
          // The deps array is read as the LAST bracketed group, not by matching
          // `}, [...]);` — the close brace and the array sit on separate lines
          // whenever a comment precedes the deps, and a regex keyed to the layout
          // reports a FIXED guard as a failure. That is the round-8 misfire this
          // session already made once; it is not repeated here.
          const open = body.lastIndexOf('[');
          if (open === -1) return;
          const deps = body.slice(open, body.indexOf(']', open) + 1);
          if (deps.trim() !== '[]') return;
          if (!/listen[<(]|addEventListener/.test(body)) return;
          examined++;
          const bare = [...body.matchAll(/void\s+([a-zA-Z_$][\w$]*)\s*\(/g)]
            .map((m) => m[1] ?? '')
            .filter((c) => !REF_SAFE.test(c));
          if (bare.length) {
            const rel = file.slice(UI_SRC.length + 1).split('\\').join('/');
            offenders.push(rel + ':' + (i + 1) + ' calls ' + [...new Set(bare)].join(', '));
          }
        });
      }
    }
    const why = [
      'A listener effect with an EMPTY deps array calls a loader directly, so it',
      'keeps the mount-time store token and silently acts on the wrong store after',
      'a switch. Either list the loader in the deps (it re-subscribes; the cleanup',
      'unregisters the previous generation), or call through a ref the way',
      'ExpoScreen.tsx:241 does.',
    ].join(' ');
    expect(offenders, why).toEqual([]);
    // Non-vacuity, asserted AFTER the offenders so a real finding still fails first.
    // A scan that matches nothing reports exactly what a clean tree reports, and
    // this guard scans for a shape (`useEffect` + empty deps + a listener) whose
    // rename would silently blind it — the file was built without this assertion,
    // which is the weakness docs/records/audits/guard-authoring-practice.md records.
    expect(
      examined,
      'the scan inspected no empty-deps listener effect at all, so the clean result ' +
        'above proves nothing. Re-point the scan (a rename of useEffect, of the ' +
        'listener call, or of the directory list would all do this).',
    ).toBeGreaterThanOrEqual(1);
  });
});
