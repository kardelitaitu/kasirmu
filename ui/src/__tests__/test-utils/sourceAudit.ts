// ── Shared source-audit scanner ────────────────────────────────────
//
// Static source-scanning primitives for drift-guard audits
// (topologyHistoryEntryAudit, …): comment/string stripping with an
// original-index map, balanced updater-body extraction, line numbers, and
// the recursive whole-tree file walk. Audits that scan source text should
// use these instead of re-implementing their own stripper/extractor, so
// every audit shares one (unit-tested) scanner.
//
// Usage:
//   import { scanUpdaters, lineNumberAt } from '@/__tests__/test-utils/sourceAudit';

import { readdirSync } from 'fs';
import { join } from 'path';
//
//   const src = readFileSync(file, 'utf-8');
//   const sites = scanUpdaters(src).filter((s) => s.body.includes('...prev'));
//   // sites[i].index is an ORIGINAL-source index — use lineNumberAt(src, i).

/** One `set<…>((prev) => …)` updater occurrence. */
export interface UpdaterSite {
  /** The setter's name (e.g. `setHistory`, `setRedo`). */
  setter: string;
  /** The updater body — everything after `((prev) => ` up to its close. */
  body: string;
  /** ORIGINAL-source index of the setter's first character. */
  index: number;
}

/**
 * True when a `/` at `i` starts a REGEX literal rather than a division operator.
 *
 * JS has no token to disambiguate, so this uses the standard heuristic: a `/` opens
 * a regex where an EXPRESSION may begin (after `(`, `,`, `=`, an operator, a
 * keyword like `return`, or at the very start), and is division after something that
 * can END an expression (identifier, number, `)`, `]`, string).
 *
 * Without this, a regex containing a slash — `window.location.hash.replace(/^#\//, '')`
 * — was read as the start of a `//` comment, silently discarding the REST OF THAT
 * LINE. Measured on `StaffManagementScreen.tsx`: `.split('?')[0]`, which trails the
 * regex on the same line, was present in the source and absent from the stripped
 * output, so every audit scanning that file was blind to it.
 */
function slashStartsRegex(src: string, i: number): boolean {
  // Walk back over whitespace to the previous significant character.
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j]!)) j -= 1;
  if (j < 0) return true; // start of file — an expression is expected
  const prev = src[j]!;
  // `</div>`, `</p>`, `</>` — a JSX/markup closing tag, never a regex. Without this
  // arm, `<` fell through to the "expression expected" default and the scanner treated
  // `</div>` as a regex literal, swallowing every character up to the next unescaped
  // `/` — which in JSX is the next closing tag. Measurement: the single line
  // `x = 1; </div> {flag} </p> tail` stripped to `x = 1; <> tail`, losing `{flag}`.
  // That is a REGRESSION introduced with the regex arm itself (round 26); every audit
  // over JSX was silently dropping code between closing tags.
  if (prev === '<') return false;
  // After a value-ending token, `/` is division.
  if (/[A-Za-z0-9_$)\]'"`]/.test(prev)) {
    // …unless that word is a keyword after which an expression begins.
    if (/[A-Za-z0-9_$]/.test(prev)) {
      let k = j;
      while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k]!)) k -= 1;
      const word = src.slice(k + 1, j + 1);
      return /^(return|typeof|instanceof|in|of|new|delete|void|do|else|case|yield|await)$/.test(word);
    }
    return false;
  }
  return true;
}

/** Remove comments and string literals so structural scanning cannot be
 *  unbalanced by prose parens inside comments or string content. Also
 *  returns origIndexAt[i] — the ORIGINAL source index of the i-th emitted
 *  char — so scan positions can be mapped back for accurate line numbers. */
export function stripCommentsAndStrings(src: string): { stripped: string; origIndexAt: number[] } {
  let out = '';
  const origIndexAt: number[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '/' && n !== '/' && n !== '*' && slashStartsRegex(src, i)) {
      // A regex literal: skip to its unescaped closing '/', honouring [class] where
      // '/' needs no escaping, then any flags.
      i += 1;
      let inClass = false;
      while (i < src.length) {
        const rc = src[i]!;
        if (rc === '\\') { i += 2; continue; }
        if (rc === '[') inClass = true;
        else if (rc === ']') inClass = false;
        else if (rc === '/' && !inClass) { i += 1; break; }
        else if (rc === '\n') break; // unterminated — treat as division instead
        i += 1;
      }
      while (i < src.length && /[a-z]/.test(src[i]!)) i += 1; // flags
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
    } else if (c === '"' || c === "'") {
      const q = c;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') i += 2;
        else if (src[i] === q) {
          i += 1;
          break;
        } else i += 1;
      }
    } else if (c === '`') {
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') i += 2;
        else if (src[i] === '`') {
          i += 1;
          break;
        } else if (src[i] === '$' && src[i + 1] === '{') {
          // An interpolation is CODE, not string content, so emit it rather than
          // skipping it. The previous version advanced past the whole `${...}`
          // without emitting anything, so a reference that lives only inside one
          // vanished from the stripped output — measurement: Button.tsx reads
          // `spinnerExiting` at :135 inside a template interpolation, and the
          // unread-state guard reported the flag as SET-BUT-NEVER-READ purely
          // because of this. Anything scanning for an identifier, a class name or a
          // call site was blind to interpolated code.
          //
          // Emitted verbatim, braces included, so bracket-balancing over the result
          // still sees a matched pair. Nested template literals inside the
          // interpolation are handled by this same loop's recursion via the outer
          // while, because each emitted char is appended in order.
          out += '${';
          origIndexAt.push(i, i + 1);
          i += 2;
          let d = 1;
          while (i < src.length && d > 0) {
            const ic = src[i]!;
            if (ic === '{') d += 1;
            else if (ic === '}') d -= 1;
            out += ic;
            origIndexAt.push(i);
            i += 1;
          }
        } else i += 1;
      }
    } else {
      out += c;
      origIndexAt.push(i);
      i += 1;
    }
  }
  return { stripped: out, origIndexAt };
}

/** Extract every `set<…>((prev) => …)` updater body via balanced
 *  delimiters. Works on comment/string-stripped source (see
 *  stripCommentsAndStrings); `index` is a stripped-source index. */
export function extractUpdaterBodies(src: string): UpdaterSite[] {
  const out: UpdaterSite[] = [];
  const re = /(set[A-Za-z0-9_$]*)\(\(prev\)\s*=>\s*/g;
  for (const m of src.matchAll(re)) {
    const start = m.index! + m[0].length;
    let depth = 0;
    let i = start;
    for (; i < src.length; i += 1) {
      const c = src[i]!;
      if (c === '(' || c === '{' || c === '[') depth += 1;
      else if (c === ')' || c === '}' || c === ']') {
        depth -= 1;
        if (depth < 0) break;
      }
    }
    out.push({ setter: m[1]!, body: src.slice(start, i), index: m.index! });
  }
  return out;
}

/** One-stop scan of a raw source file: strip comments/strings, extract the
 *  updater bodies, and map every site's index back to the ORIGINAL source
 *  (so lineNumberAt reports true lines). */
export function scanUpdaters(src: string): UpdaterSite[] {
  const { stripped, origIndexAt } = stripCommentsAndStrings(src);
  return extractUpdaterBodies(stripped).map((u) => ({
    ...u,
    index: origIndexAt[u.index] ?? u.index,
  }));
}

/** 1-based line number of `index` in the original `src`. */
export function lineNumberAt(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

/** Recursively collect production .ts/.tsx sources under `dir` (tests and
 *  build artifacts excluded — audits target application code). */
export function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
      out.push(...collectSourceFiles(full));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}
