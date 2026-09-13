// ── Cross-screen error-policy compliance test (ERR-10) ────────────
//
// The audit found primitive error tests were strong but application-wide
// failure paths were thin: a new screen could silently swallow load errors
// or render a raw backend message while all primitive tests pass. Phase 2
// (ERR-04/05) swept ~50 screens through the user-safe error mapper.
//
// This test is the architectural drift guard. It statically scans feature,
// hook, context, and component code for:
//   1. Raw `err.message` leak sites (raw backend text rendered to users)
//      outside the explicitly whitelisted functional-parse sites in
//      PaymentModal (error classification + PartialStockResult detection).
//   2. Truly empty catch blocks (silent swallows) in feature code.
//
// If a new screen renders raw errors or swallows them silently, this test
// fails and points at the exact file/line.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// NB: vitest's `__dirname` points at the compiled test output, not the
// repo layout — follow the cartExtraction.test.ts convention and resolve
// against the working directory (ui/ when vitest runs from ui/).
const SRC = path.resolve(process.cwd(), 'src');
const SCAN_DIRS = ['features', 'hooks', 'contexts', 'components', 'frontend'];
const ALLOWED_EXT = ['.ts', '.tsx'];

// Intentional functional-parse sites that READ raw messages for logic but
// never display them: PaymentModal's error classification + PartialStockResult
// extraction. Everything rendered goes through l10nErrorMessage/userErrorMessage.
//
// Anchored by CONTENT (the leak line plus a discriminating context line within
// the next few) rather than by line number — the old numeric pins drifted
// silently whenever an edit above the sites shifted the file (MONEY-01/02 hit
// exactly that: 150→183, 992→1055 with the reviewed sites unchanged).
const WHITELISTED_RAW_PARSE: Array<{ file: string; anchor: RegExp; context: RegExp }> = [
  {
    // classifyError: captures err.message ONLY to hand it to the mappers on
    // the following lines — the retry decision delegated to classifyRetry()
    // (the old errMsg.toLowerCase() keyword sniff died in that refactor) and
    // the surfaced text goes through plainErrorMessage (ERR-05).
    file: path.join(SRC, 'features/sales/PaymentModal.tsx'),
    anchor: /err instanceof Error \? err\.message : String\(err\)/,
    context: /plainErrorMessage\(err, errMsg\)/,
  },
  {
    // complete() catch: reads err.message to JSON-detect PartialStockResult;
    // never displayed. Non-stock errors are classified for display below.
    file: path.join(SRC, 'features/sales/PaymentModal.tsx'),
    anchor: /err instanceof Error \? err\.message : String\(err\)/,
    context: /tryParsePartialStockResult/,
  },
];

/** 1-based line numbers whitelisted for `file` (anchor + context match). */
function whitelistedLines(file: string): Set<number> {
  const cached = WHITELIST_CACHE.get(file);
  if (cached) return cached;
  const entries = WHITELISTED_RAW_PARSE.filter((w) => w.file === file);
  const set = new Set<number>();
  if (entries.length > 0) {
    const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const e of entries) {
        if (!e.anchor.test(line)) continue;
        const window = lines.slice(i + 1, i + 4).join('\n');
        if (e.context.test(window)) set.add(i + 1);
      }
    });
  }
  WHITELIST_CACHE.set(file, set);
  return set;
}
const WHITELIST_CACHE = new Map<string, Set<number>>();

function collectFiles(): string[] {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) {
    const root = path.join(SRC, dir);
    if (!fs.existsSync(root)) continue;
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          // Skip test dirs and extracted sub-files that are covered elsewhere.
          if (entry.name === '__tests__' || entry.name === 'dev-mock') continue;
          walk(full);
        } else if (ALLOWED_EXT.includes(path.extname(entry.name))) {
          files.push(full);
        }
      }
    };
    walk(root);
  }
  return files;
}

function isWhitelisted(file: string, line: number): boolean {
  return whitelistedLines(file).has(line);
}

describe('error-policy compliance (ERR-10)', () => {
  const files = collectFiles();

  it('scans a meaningful set of source files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no raw err.message leak sites outside the whitelist', () => {
    const leaks: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
      lines.forEach((line, i) => {
        const n = i + 1;
        // Raw error text rendered to users (display leak). The helper
        // functions in utils/app-error.ts are the allowed normalizers.
        if (/err\s+instanceof\s+Error\s+\?\s+err\.message/.test(line) && !isWhitelisted(file, n)) {
          leaks.push(`${path.relative(SRC, file)}:${n}`);
        }
        // Legacy pattern: direct `error.message` assigned into a UI error
        // string, bypassing the mapper. (Some hook lines legitimately read
        // .message to *build* a classified error — those are rare and reviewed.)
        if (
          /(setError|message:\s*)(\s*\(?.*\)?\s*instanceof\s+Error|\w+\.message)/.test(line) &&
          !/l10nErrorMessage|userErrorMessage|plainErrorMessage|requiredLocalized/.test(line) &&
          /\.message/.test(line) &&
          /setError|set.*Error\(|message:/.test(line)
        ) {
          // Conservative: only flag when a raw .message is consumed without
          // passing through an error mapper in the same expression.
          const rawConsumed =
            /err\.message|error\.message|e\.message|ex\.message/.test(line);
          const mapped =
            /l10nErrorMessage|userErrorMessage|plainErrorMessage|normalizeError|requiredLocalized/.test(line);
          if (rawConsumed && !mapped) {
            leaks.push(`${path.relative(SRC, file)}:${n}`);
          }
        }
      });
    }
    expect(leaks).toEqual([]);
  });

  it('has no truly empty catch blocks in feature code', () => {
    const emptyCatches: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const m = (lines[i] ?? '').match(/catch\s*(\([^)]*\))?\s*\{\s*$/);
        if (!m) continue;
        // Look at the next line: a pure close brace with nothing between
        // (allow a single comment on the closing line, e.g. `} // ignore`).
        const next = lines[i + 1];
        if (next !== undefined && /^\s*}\s*(\/\/.*)?$/.test(next)) {
          emptyCatches.push(`${path.relative(SRC, file)}:${i + 1}`);
        }
      }
    }
    expect(emptyCatches).toEqual([]);
  });

  it('flags nothing in the whitelisted PaymentModal parse sites (sanity)', () => {
    // Every whitelist entry must resolve to at least one real site — an
    // entry that matches nothing is stale (the code it whitelisted moved
    // or died) and must be updated or removed, not left to silently
    // widen the hole.
    for (const w of WHITELISTED_RAW_PARSE) {
      const lines = fs.readFileSync(w.file, 'utf-8').split(/\r?\n/);
      const hit = lines.some(
        (l, i) => w.anchor.test(l) && w.context.test(lines.slice(i + 1, i + 4).join('\n')),
      );
      expect(hit, `${w.file} ${String(w.context)}`).toBe(true);
    }
  });
});
