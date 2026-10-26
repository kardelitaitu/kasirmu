// ── Restaurant source comments cite paths that exist (round 153) ──────
//
// Round 151 rewrote `RestaurantMenu.tsx`'s storage-tiers note and round 152 found the
// rewrite still cited `.agents/resto-pos-ui-review.md`, which had moved to
// `.agents/reviews/`. `check-dead-refs.py` polices this for DOCS, so nothing caught it — all
// three were source comments.
//
// A first version of this guard was written in round 152 and DELETED. It walked the whole
// `ui/src/__tests__` tree and fired on six citations, five of which the matcher should have
// skipped: a glob (`shared-ui/locales/*.ftl`), two templates (`<feature>/register.tsx`,
// `x/X.css`), a deliberately-deleted path (`SetupWizard.css:625`, whose absence IS the
// claim), and its own file. Four exemptions for six hits is a baseline with extra steps.
//
// The scope was the error, not the idea. Scoping to `ui/src/features` — where a comment
// names a file the reader will open — the same finder had **zero** false positives. Test
// traffic is full of synthetic shapes by construction; feature comments are not.
//
// SCOPE: `.ts`/`.tsx`/`.css` under `ui/src/features`, matching repo-relative prefixes.
// Globs and templates are rejected on shape; a reference whose surrounding line says
// `deleted`/`removed` is skipped, because the absence is the claim there.
//
// EXTENDED 2026-10-14: the backtick-only finder below is now joined by a BARE-prefix pass,
// which closes the gap round 153 recorded and then proved open by re-introducing the defect
// un-quoted. See `barePrefixed()` for the discriminator and its measured false-positive rate.
// The two passes are kept separate because they answer different questions — backticked is
// unambiguous, bare is shape-inferred — and a bug in one should not silence the other.
//
// ⚠️ WRITING ABOUT A LINE NUMBER (added 2026-10-19, after this defect was introduced by three
// separate "fix" commits in one session): a colon-number ANYWHERE in a comment is a live
// citation to this guard, including one describing the past. "The note said :1474" is read as a
// claim about line 1474 right now — so the historical note becomes the next stale citation, and
// fails the moment the cited line moves. Write **line 1474** instead. This file's own count
// went UP twice for that reason before it started going down.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = ['.agents/reviews/resto-pos-ui-review.md', 'ui/src/features/sales/PosScreen.tsx'];
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
const FEATURES = path.join(ROOT, 'ui/src/features');

/** A citation whose surrounding text carries one of these points at a REVISION, not
 *  at the working tree. Added 2026-10-27 (round 39); see the use site for why the
 *  exemption is required rather than convenient. */
const HISTORICAL_STAMP = /AS OF\s+[0-9a-f]{7,}|fix(?:ed)?\s+[0-9a-f]{7,}/;
/** Repo-relative prefixes worth resolving. Anything else is prose. */
const PREFIXES = ['.agents/', 'ui/src/', 'crates/', 'docs/', 'scripts/', 'shared-ui/'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css)$/.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * Paths a feature file's comments name, as they would be written from the repo root.
 *
 * Backticks are this tree's convention for a path in a comment, so the match is anchored
 * on them: `ui/src/api/settings.ts:198-202` yields `ui/src/api/settings.ts` once the trailing
 * `:line` is stripped.
 *
 * ⚠️ A BARE PATH IS INVISIBLE. Round 153 killed this guard by re-introducing the defect with
 * the path un-quoted — `// .agents/resto-pos-ui-review.md §F5 finding` — and it PASSED. Round
 * 151's own comment had written the path bare, so that defect shape is not hypothetical, and
 * this finder will not catch it.
 *
 * Two ways to close it, neither chosen here:
 *   * match bare paths too — but then every prose mention of a path becomes a citation, and
 *     the false-positive rate that killed round 152's version returns;
 *   * lint the two files that matter — a shell `grep` for the handful of review citations.
 *
 * So this guard covers the CONVENTIONAL spelling (backticked), which is what the three
 * dangling references round 152 found used and what round 151's fix used. Recorded rather
 * than hidden, so the next reader does not test the bare case and conclude the guard works.
 */
function citedPaths(source: string): string[] {
  return [...new Set([...backticked(source), ...barePrefixed(source)])];
}

/**
 * The CONVENTIONAL spelling: a repo-relative path in backticks.
 *
 * Round 153's version, unchanged. Kept as its own pass because the two shapes differ in
 * what they can mean: a backticked token is unambiguously a citation, including one the
 * author wrote to point at a *deleted* file.
 */
function backticked(source: string): string[] {
  const found = new Set<string>();
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const raw = m[1]!;
      if (!PREFIXES.some((p) => raw.startsWith(p))) continue;
      const cleaned = raw.replace(/:\d+(-\d+)?$/, '').replace(/[.,;]$/, '');
      if (!/\.[a-z]{2,4}$/.test(cleaned)) continue;   // needs a file extension
      if (/[*<>]/.test(cleaned)) continue;            // a glob or a template
      // A deliberately-deleted reference is a claim that the file is gone.
      const context = [lines[index - 1] ?? '', line].join(' ').toLowerCase();
      if (/deleted|removed/.test(context)) continue;
      found.add(cleaned);
    }
  });
  return [...found];
}

/**
 * The BARE spelling, which round 153's docblock recorded as blind and then PROVED blind
 * by re-introducing the defect with the path un-quoted — the guard passed.
 *
 * Round 152 had tried closing this by matching every path-shaped token in a comment and
 * was killed by false positives: 568 comment lines under ui/src/features name a file
 * (measured 2026-10-14), and the overwhelming majority are a NAME, not a citation —
 * `\`components.css\``, `AnalyticsScreen.css`, `<feature>/register.tsx`.
 *
 * The discriminator that makes this pass cheap: **a bare token only counts when it carries a
 * repo-relative prefix**. `.agents/`, `ui/src/`, `crates/`, `docs/`, `scripts/`,
 * `shared-ui/` — the same PREFIXES list the backticked pass uses. A bare filename with no
 * prefix is prose about a sibling; a bare token with a prefix is the author writing a path
 * from the repo root, which is the only shape that can dangle by a file MOVING.
 *
 * Measured on the whole features tree at 2026-10-14: 81 distinct prefixed tokens, **78
 * resolve and 3 do not** — all three real dangling citations the backticked pass could not
 * see. That 3.7% miss rate is the number that makes this pass safe; it is recorded because
 * a future refactor that raises it means the shape assumption has broken.
 */
function barePrefixed(source: string): string[] {
  const found = new Set<string>();
  // COMMENT STATE, not a line-local test. A `/* */` block's continuation lines carry no marker
  // at all — `ScaleIndicator.css`'s citation sits on such a line, six lines into a block whose
  // `/*` is at the top — so a per-line `indexOf` sees prose and skips a real citation. Found by
  // running the first version of this pass: it caught 1 of the 3 known dangling paths.
  let inBlock = false;
  const allLines = source.split('\n');
  for (let li = 0; li < allLines.length; li += 1) {
    const line = allLines[li]!;
    let comment = '';
    if (inBlock) {
      const end = line.indexOf('*/');
      comment = end === -1 ? line : line.slice(0, end);
      if (end !== -1) inBlock = false;
    } else {
      const lineAt = line.indexOf('//');
      const blockAt = line.indexOf('/*');
      if (blockAt !== -1 && (lineAt === -1 || blockAt < lineAt)) {
        const end = line.indexOf('*/', blockAt + 2);
        comment = end === -1 ? line.slice(blockAt) : line.slice(blockAt, end);
        if (end === -1) inBlock = true;
      } else if (lineAt !== -1) {
        comment = line.slice(lineAt);
      }
    }
    if (!comment) continue;
    if (/[*<>]/.test(comment)) continue;   // a glob or a template
    // The SAME exemption the backticked pass carries, and it is load-bearing here rather
    // than decorative: a deleted predecessor is a claim that the file is GONE, which no
    // `existsSync` can satisfy. `ScaleIndicator.css`'s note is exactly that shape — the
    // sentence reads "since deleted (338c15c01, …)" on the line AFTER the path, so the
    // window has to look forward as well as back.
    const window = [allLines[li - 1] ?? '', line, allLines[li + 1] ?? ''].join(' ');
    if (/deleted|removed|retired/.test(window)) continue;
    for (const m of comment.matchAll(/((\.agents|ui\/src|crates|docs|scripts|shared-ui)\/[A-Za-z0-9_.\/-]+)/g)) {
      const raw = m[1]!;
      const cleaned = raw.replace(/[:\d].*$/, '').replace(/[.,;)]$/, '');
      if (!/\.[a-z]{2,4}$/.test(cleaned)) continue;   // needs a file extension
      found.add(cleaned);
    }
  }
  return [...found];
}


/**
 * Same-file line citations (`:914-918`, `usePosHeldCarts :426`) and whether the cited
 * line plausibly still holds what the comment says.
 *
 * WHY A SEPARATE CHECK. The two passes above answer 'does the FILE exist'; they
 * explicitly strip the `:line` suffix, so a citation whose LINE drifted passes.
 * Measured in round 131 on PosScreen.tsx alone: 22 same-file citations, and the three
 * that name a handler (`handlePrintBill` :914-918, `handleSendToKitchen` :1189-1198,
 * `handleConfirmSplitBill` :964) had drifted by 68, 146 and 80 lines. Others point at
 * `tableNumber,`, `category: l.category,` or an `import` line.
 *
 * A stale LINE is worse than a stale path: the file is still open, so the reference
 * reads as verified, and the reader concludes the guard ran. That is the shape that
 * hid a false claim in round 126.
 *
 * THE HEURISTIC, stated because it is a heuristic. A citation is judged IN RANGE when
 * the cited line mentions any identifier the comment names in backticks or camelCase.
 * That is not proof the comment is right — it cannot be, from the outside — but it
 * catches the dominant failure: the file grew and the citation now lands on an
 * unrelated line. Reported with the comment text so a human resolves it, never fixed
 * by rewriting the comment automatically.

 * ── CROSS-FILE LINE CITATIONS (`name.ts:NN`), THE THIRD PASS ─────────────────
 *
 * The other two passes each cover half of a cross-file citation and together
 * cover NEITHER of its parts:
 *
 *   * the same-file pass SKIPS anything carrying a `name.ts:` prefix (see its own
 *     `re` guard) — the token is treated as a claim about ANOTHER file, correctly;
 *   * the path pass resolves the FILE and stops there.
 *
 * So `CartPanel.tsx:898` was verified to name a file that exists, and the number was
 * never checked by anything. Measured 2026-10-18 (round 184): scanning every
 * comment line under `features/` for a resolvable `name.ext:NN` token found **113**
 * such citations and **9** pointing at a line that is blank, punctuation-only, or
 * past EOF. Three of the nine were the SAME drifted target (CartPanel.tsx:898,
 * an unrelated `}}` — see round 183 for the first), which is what a citation looks
 * like once the file it points into grows and nothing re-checks the number.
 *
 * WHAT IS ENFORCED is deliberately only the no-false-positive subset, exactly as
 * the same-file pass concluded: a line that is BLANK or PAST EOF cannot be the
 * thing any comment means to cite. Those nine are fixed; this pass keeps them fixed.
 *
 * WHAT IS EXEMPT, and why each exemption is not a loophole:
 *
 *   * A HISTORICAL reference — "Moved verbatim out of KdsScreen.tsx:913-923" — is a
 *     claim about the past. It must not resolve, and does not. Detected with the
 *     same word list the same-file pass uses.
 *   * A SECTION ANCHOR may name the comment banner above a symbol rather than the
 *     symbol. `data.rs:33` is the `── Commands ──` line directly above
 *     `get_backup_status` at :34, and the citing comment says so by naming the
 *     banner. Requiring an exact symbol line would flag a correct citation, so a
 *     line that CONTAINS text is accepted however near it lands.
 *   * A cite into a file OUTSIDE the repo (a vendored path, a URL) cannot resolve
 *     and is skipped rather than failed.
 */
function sameFileCitations(source: string): Array<{ at: number; from: number; to: number; line: string }> {
  const found: Array<{ at: number; from: number; to: number; line: string }> = [];
  const lines = source.split('\n');
  // `:NNN` or `:NNN-MMM`, NOT preceded by a filename/extension or a digit — so
  // `CartPanel.test.tsx:316/:324` and `usePosHeldCarts :426` are cross-file and skipped.
  const re = /(^|[^A-Za-z0-9_.]):(\d{2,4})(?:-(\d{2,4}))?/g;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t.startsWith('//') && !t.startsWith('*')) return;
    // A citation to another FILE is out of scope here by definition. Two spellings:
    //   * `name.ts:NN` — the path and the number on one token;
    //   * a bare `:NN` whose COMMENT BLOCK names the file (`ReceiptConfig`
    //     (receipt.rs:175-198) ... field (:193)), which receiptLogic.ts uses. The
    //     second was a measured false positive: cited :193 resolves to
    //     `pub grouping: ThousandSeparator` in receipt.rs, exactly as claimed.
    if (/[A-Za-z0-9_/-]+\.[a-z]{2,4}\s*:\s*\d/.test(line)) return;
    if (/\.[a-z]{2,4}[):,]/.test(line)) return;
    // A line naming OTHER components/files by prose (`ProductLookupScreen at :91,
    // PosScreen at :143 and RestaurantMenu at :185`) cites THEIR lines, not this file's.
    // `[A-Z][A-Za-z]+(Screen|Modal|Card|Panel|View|Menu)` is the house naming convention.
    const foreignNames = line.match(/[A-Z][A-Za-z]+(?:Screen|Modal|Card|Panel|View|Menu|Settings)/g) ?? [];
    if (foreignNames.length >= 1) return;
    // A table row about a FOREIGN TYPE — `| knob | ReceiptConfig field | ... |` — cites
    // that type's file, not this one. `ReceiptConfig` is a Rust struct in receipt.rs and
    // the cited :193 resolves to `pub grouping: ThousandSeparator` there (verified).
    // Detected as a `|`-delimited row naming a PascalCase identifier in a `field` column.
    if (t.startsWith('* |') || t.startsWith('|')) {
      if (/\|[^|]*\b[A-Z][A-Za-z]+\b[^|]*\|/.test(t)) return;
      // The ROW may name no type while the HEADER does — receiptLogic.ts's
      // `| grouping | :193 \`grouping\` | ... |` sits under `| knob | ReceiptConfig field |`.
      // Walk up to the header row and apply the same test.
      for (let up = 1; up <= 6 && i - up >= 0; up += 1) {
        const hdr = lines[i - up]!.trim();
        if (!hdr.startsWith('* |') && !hdr.startsWith('|')) break;
        if (/\|[^|]*\b[A-Z][A-Za-z]+\b[^|]*\|/.test(hdr) && /field|type|struct|config/i.test(hdr)) return;
      }
    }
    // The surrounding comment BLOCK names a foreign file. receiptLogic.ts's knob table
    // names `receipt.rs` on one line and cites its fields as `(:193)` on the next, and
    // cited :193 resolves to `pub grouping: ThousandSeparator` there — verified. Walk
    // up to the block's start (a blank line or a non-comment line ends it).
    for (let up = 1; up <= 12 && i - up >= 0; up += 1) {
      const prev = lines[i - up]!.trim();
      // Table rows (`| knob | field |`) carry no comment marker, so they must not
      // break the walk: receiptLogic.ts's knob table cites `(:193)` on a row whose
      // header names `receipt.rs` three lines up.
      const isTableRow = prev.startsWith('|') || prev.startsWith('* |');
      if (prev === '') break;
      if (!isTableRow && !prev.startsWith('//') && !prev.startsWith('*') && !prev.startsWith('/*')) break;
      if (/\.[a-z]{2,4}[):,]/.test(prev) || /[A-Za-z0-9_/-]+\.[a-z]{2,4}\s*:\s*\d/.test(prev)) return;
    }
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      const from = Number(m[2]);
      const to = m[3] ? Number(m[3]) : from;
      if (from < 1 || to > lines.length) continue;   // points past EOF
      found.push({ at: i + 1, from, to, line: t.slice(0, 110) });
    }
  });
  return found;
}

describe('feature-source comments cite same-file lines that still hold', () => {
  it('no same-file line citation lands on an unrelated line', () => {
    const files = walk(FEATURES);
    expect(files.length, 'no files scanned — FEATURES is wrong').toBeGreaterThan(100);

    // BASELINE, MEASURED NOT ASSUMED. First run on the whole features tree at
    // 2026-10-18 (round 131) reported the total and the in-range total, and BOTH
    // numbers are asserted: the second is what stops a future refactor from
    // shrinking the extractor until 'zero offenders' is vacuous.
    let total = 0;
    let inRange = 0;
    const suspicious: string[] = [];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf-8');
      const lines = source.split('\n');
      for (const cite of sameFileCitations(source)) {
        total += 1;
        // Identifiers the comment names, which the cited line must mention.
        const named = new Set<string>();
        for (const m of cite.line.matchAll(/`([^`]+)`/g)) {
          for (const id of m[1]!.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? []) named.add(id);
        }
        for (const id of cite.line.match(/[A-Za-z_$][A-Za-z0-9_$]{6,}/g) ?? []) named.add(id);
        named.delete('function'); named.delete('return'); named.delete('undefined');

        const window = lines.slice(cite.from - 1, cite.to).join('\n');
        // Broaden: identifiers from the WHOLE comment line, deduped, plus the named set.
        for (const id of cite.line.match(/[A-Za-z_$][A-Za-z0-9_$]{4,}/g) ?? []) named.add(id);
        const hits = [...named].filter((n) => window.includes(n));
        if (hits.length > 0) inRange += 1;
        else {
          suspicious.push(
            `${path.relative(ROOT, file).split(path.sep).join('/')}:${cite.at} cites :${cite.from}` +
              `${cite.to !== cite.from ? '-' + cite.to : ''}, which reads: ` +
              (lines[cite.from - 1] ?? '<EOF>').trim().slice(0, 70),
          );
        }
      }
    }

    console.info(`[featureCommentPaths] same-file citations: ${total} total, ${inRange} in range, ${total - inRange} to review`);
    // ⚠️ THE REPORT MUST ACTUALLY BE PRINTED. `suspicious` was filled and never read
    // (round 132): the summary line above ran, the list below did not, so the guard
    // silently claimed a report it never emitted — and the round-131 record described
    // that non-existent report. A dead accumulator is worse than none.
    if (suspicious.length > 0) {
      console.info('[featureCommentPaths] same-file citations to review:\n  ' + suspicious.join('\n  '));
    }
    expect(total, 'no same-file line citations found — the extractor is wrong').toBeGreaterThan(5);

    // ── WHAT IS ENFORCED, AND WHAT IS ONLY REPORTED ──────────────────────────
    //
    // The identifier heuristic above is a SIGNAL, not a test: it cannot distinguish
    // 'the citation drifted' from 'the comment paraphrases and names no identifier the
    // line carries'.
    //
    // ⚠️ THE FLAGGED SET IS UNCLASSIFIED. DO NOT READ IT AS A DEFECT LIST, AND DO NOT
    // TURN IT INTO A BURNDOWN TARGET.
    //
    // Two hand samples disagree, which is the whole finding:
    //
    //   * 2026-10-18 (round 131) checked four and all four were genuinely drifted —
    //     `setActiveWorkspace(null)` cited at :363 on `tableNumber,`; `printed args` at
    //     :232 on `category: l.category,`; `setActiveOpenBillId(null)` at :993 on `});`.
    //   * 2026-10-18 (round 178) checked six more and all six were CORRECT. The cited
    //     line was the opening line of the construct the comment names — PosScreen's
    //     `handleAddProduct,` at :573, the first element of its destructuring, and
    //     RetailPosScreen's `setProducts(` at :591 whose body is :592 — or one of the
    //     sites the comment enumerates: RestaurantPaymentsScreen has exactly two
    //     `originalsRef.current.drafts =` assignments, at :408 and :543, precisely the
    //     'success path' and the 'finally' its comment claims.
    //
    // A sample of four does not set a rate, and neither does a sample of six. The class
    // is real (round 131 proved it) and the signal is unreliable (round 178 proved it).
    // Round 178 also measured HOW it misfires, which is the useful part: the heuristic
    // reads a comment that DISCUSSES a foreign identifier as citing one. The printout
    // itself carries the evidence — a citation is reported as reading
    // `originalsRef.current.drafts = draftsRef.current.map(...)` and called unrelated
    // in the same line of output. A line cannot be both the named construct and
    // unrelated to it, and the checker cannot see that because it only asks whether the
    // cited line mentions a token from the comment.
    //
    // So it is reported, never enforced. Failing the suite on ~150 pre-existing
    // citations would make this guard noise and teach the tree to ignore it.
    //
    // ENFORCED is the subset that cannot be a paraphrase, because the cited line does
    // not exist as content at all: the range runs past EOF, or every line in it is
    // blank. No comment can be citing a blank line correctly. That is a true invariant
    // with no false positives, and it is the half that grows monotonically — a file
    // that SHRINKS turns correct citations into dangling ones.
    const dangling: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf-8');
      const lines = source.split('\n');
      for (const cite of sameFileCitations(source)) {
        // A HISTORICAL reference is a claim about the past, not a pointer: the
        // `deleted|removed|retired` exemption the two path passes already carry, extended
        // to line numbers. EodReportScreen.tsx:27 reads 'was :154 and :187 at tip
        // b2247947e' — those were never meant to resolve here.
        const context = [lines[cite.at - 2] ?? '', lines[cite.at - 1] ?? ''].join(' ').toLowerCase();
        if (/\b(was|were|formerly|previously|used to|at tip)\b/.test(context)) continue;
        // PUNCTUATION-ONLY is the second no-false-positive class: no comment can be
        // citing a line whose whole content is `}` or `});`. Measured 2026-10-18
        // (round 132): 7 of the 154 heuristic candidates land on exactly that, and all
        // seven were genuinely drifted; the other 147 stay only reported.
        const punctuationOnly = (from: number, to: number) => {
          const s = lines.slice(from - 1, to);
          return s.length > 0 && s.every((l) => /^[\s)\]};,]*$/.test(l));
        };
        // `slice.every(... === '')` used to sit here beside `punctuationOnly` and was
        // fully subsumed by it: a blank line is whitespace, and `/^[\s)\];,]*$/` matches
        // whitespace. Two spellings of one test, and the redundant one read as though it
        // covered a class the other did not.
        if (cite.from > lines.length || punctuationOnly(cite.from, cite.to)) {
          dangling.push(
            `${path.relative(ROOT, file).split(path.sep).join('/')}:${cite.at} cites :${cite.from}` +
              `${cite.to !== cite.from ? '-' + cite.to : ''} — ${cite.line}`,
          );
        }
      }
    }
    expect(
      dangling.sort(),
      `feature comment(s) cite a line that is blank or past the end of the file. The ` +
        `file shrank and the citation now points at nothing:\n  ${dangling.join('\n  ')}`,
    ).toEqual([]);
  });
});

/** A resolvable `name.ext:NN` or `name.ext:NN-MM` token inside a comment line. */
function crossFileCitations(source: string): Array<{ at: number; file: string; from: number; to: number; line: string }> {
  const found: Array<{ at: number; file: string; from: number; to: number; line: string }> = [];
  const lines = source.split(String.fromCharCode(10));
  // Extensions worth resolving. A token without one (`:NN`) is the same-file pass.
  // EXTENSIONS WIDENED 2026-10-26 (round 26). `.go`, `.mjs` and `.yml` were absent, so a
  // citation into the Go license server or a website config was invisible — and one was
  // already wrong: `features/index.ts` cited `SignedSubscriptionPayload` in main.go, a
  // name that exists ONLY inside a comment there. The struct is `SubscriptionPayload`.
  // A citation can fail in two ways: the LINE moved (graded above) and the SYMBOL is not
  // there (graded only by being extracted at all). Adding the extensions is what lets the
  // second kind reach the pass below.
  const re = /([A-Za-z0-9_./-]+\.(?:tsx?|css|rs|py|sh|json|sql|md|ftl|toml|html|go|mjs|cjs|ya?ml))\s*:\s*(\d{2,4})(?:-(\d{2,4}))?/g;
  let blockDepth = 0;
  lines.forEach((line, i) => {
    const openedHere = (line.match(/\/\*/g) ?? []).length;
    const closedHere = (line.match(/\*\//g) ?? []).length;
    const wasInBlock = blockDepth > 0;
    blockDepth = Math.max(0, blockDepth + openedHere - closedHere);
    const tr = line.trim();
    // CSS BLOCK COMMENTS (added 2026-10-27, round 43). A `/* ... */` comment's
    // CONTINUATION lines begin with bare prose, so the `//`/`*` test skipped them —
    // and that is exactly where tokens.css keeps its citation list ("and it is used
    // as a border ... (CartPanel.css:228/:239, ..."). Adding `ui/src/theme` to the
    // walk therefore changed nothing at first: the file was scanned, its citations
    // were not extracted. The test is now "inside an open block comment", tracked by
    // counting /* and */ above the line, so prose lines in a .css file count and code
    // does not.
    // BLOCK-COMMENT STATE IS CARRIED, NOT RECOMPUTED. The first version walked
    // back to line 0 for every line, which made the whole scan quadratic and took
    // this case past vitest's 10s timeout (measured: 11.4s). `blockDepth` is threaded
    // forward through forEach instead — one pass, same answer.
    const isComment = tr.startsWith("//") || tr.startsWith("*") || wasInBlock || openedHere > 0;
    if (!isComment) return;
    // A HISTORICAL reference is a claim about the past, not a pointer. Same word
    // list as the same-file pass, widened to the comment BLOCK (the marker can sit
    // a line or two above the token), because both measured instances read that way:
    // "Moved verbatim out of KdsScreen.tsx:913-923" and the saveDiff block.
    let blockStart = i;
    for (let up = 1; up <= 12 && i - up >= 0; up += 1) {
      const prev = lines[i - up]!.trim();
      if (prev === "") break;
      if (!prev.startsWith("//") && !prev.startsWith("*") && !prev.startsWith("/*")) break;
      blockStart = i - up;
    }
    const block = lines.slice(blockStart, i + 1).join(" ").toLowerCase();
    // HISTORY WORDS ARE READ ON THE CITE LINE ONLY (2026-10-26, round 26).
    //
    // This used to search the whole 12-line block, and `was`/`were` are far too common
    // for that: measured over the widened population, 150 of 390 citations were dropped
    // on the block scan, and **113 of them for a history word in an unrelated sentence**
    // (one whole paragraph in `features/index.ts` was ungraded because a neighbouring
    // clause said "was implied to be the add-on"). Six of the rescued set were genuinely
    // stale -- PosScreen.tsx:891 pointed at `),`, PaymentModal.tsx:1630 at a blank line --
    // which is the same drift the pass exists to catch.
    //
    // The measured cases this exemption was written FOR still work: "Moved verbatim out
    // of KdsScreen.tsx:913-923" carries its verb on the cite line, as does "Two sites
    // BUILT this string by hand" (graded by the past-tense arm below). The `AS OF <sha>`
    // test stays block-wide on purpose -- its anchor is a commit, not a verb, and it can
    // legitimately sit in the header above the token.
    // The tense is read from the cite line AND from the one line above it, because a
    // citation is often a LIST ITEM under a header that carries the verb:
    //   *   Two sites BUILT this string by hand, identically:
    //   *     PaymentModal.tsx:1113   (the hold on the payment path)
    // One line, not the block: the block scan is what dropped 113 unrelated citations,
    // and every measured historical case spells its verb within one line of the token.
    const citeLine = ((lines[i - 1] ?? "") + " " + tr).toLowerCase();
    if (/\b(moved|was|were|formerly|previously|used to|at tip|deleted|removed|retired)\b/.test(citeLine)) return;
    // `AS OF <sha>^` is the SECOND historical spelling, and the word list alone does
    // NOT cover it. Measured 2026-10-18 (round 185): the eight KDS extractee headers
    // read "Extracted verbatim from KdsScreen.tsx:718-855 AS OF 7d0dc4d60^" — three of
    // them contain none of the words above, so a word-list-only exemption would flag
    // correct citations. The anchor is what makes them historical: a range pinned to a
    // commit that is COUNTERFACTUAL by construction (`^` = the parent), so it is
    // SUPPOSED not to resolve against the working tree.
    if (/\bas of\b/.test(block) && /\b[0-9a-f]{7,}\b/.test(block)) return;
    // PAST-TENSE PROSE ABOUT REMOVED CODE is the third spelling, and it is the one
    // that looks most like a defect. `tableLabel.ts` explains why the helper exists:
    //
    //   "Two sites BUILT this string by hand, identically:
    //      PaymentModal.tsx:1113 ..."
    //
    // Those two sites no longer build it — that is the whole point of the note — so the
    // numbers are correct precisely by NOT resolving. Present tense is the tell, and it
    // is the discriminating test the two `tableLabel.ts` comments passed differently in
    // round 185: :12 reads "Both places that render it ALSO add the word" (present) and
    // its :648 WAS stale; :45 reads "Two sites built this string by hand" (past) and its
    // :1113 is correctly un-resolvable.
    //
    // Deliberately narrow: only verbs that cannot be present tense about live code.
    if (/\b(built|constructed|interpolated|duplicated|hand-built)\b/.test(citeLine)) return;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      found.push({
        at: i + 1,
        file: m[1]!,
        from: Number(m[2]),
        to: m[3] ? Number(m[3]) : Number(m[2]),
        line: tr.slice(0, 110),
      });
    }
  });
  return found;
}

/**
 * Resolve a `name.ext` token as written in a comment to a real file on disk.
 *
 * Three spellings are in use and all three resolve: relative to the CITING file
 * (`./x.ts`), relative to `ui/` (the common `features/...` form), and relative to
 * the repo root (`crates/...`, `apps/...`). Anything else is prose or a vendored
 * path and returns null — the caller skips it rather than failing.
 */
function resolveCitedFile(fromFile: string, ref: string): string | null {
  const candidates = [
    path.resolve(path.dirname(fromFile), ref),
    path.resolve(ROOT, "ui", ref),
    path.resolve(ROOT, ref),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}


/**
 * Repo-wide basename index, for BARE-filename citations (`CartPanel.tsx:898`).
 *
 * A citation may spell its target three ways, and only two resolve by path:
 *
 *   * a relative or repo-relative path (`./x.ts`, `crates/...`) — resolved by
 *     `resolveCitedFile`;
 *   * a BARE basename with no directory component. This is the common form in prose
 *     ("renders on restaurant POS unconditionally (CartPanel.tsx:898)") and it can only
 *     be resolved by name. Measured 2026-10-18 (round 185): 121 distinct bare basenames,
 *     resolving to 111 single-match citations, 14 ambiguous and 2 unknown.
 *
 * TEST FILES ARE EXCLUDED from the index. A production comment citing `X.test.tsx` is
 * citing a test by name, and resolving it to the test would let a `:NN` in a test-path
 * citation be graded — a different question, and one this pass does not ask.
 */
function repoBasenameIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const skip = /(node_modules|\\target\\|\\coverage\\|\.git\\|dist)/;
  const extensions = /\.(tsx?|css|rs|py|sh|json|sql|md|ftl|toml|html)$/;
  const visit = (dir: string, depth: number): void => {
    if (depth > 8 || skip.test(dir)) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;   // unreadable directory: skip it rather than fail the suite
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        visit(full, depth + 1);
      } else if (extensions.test(e.name) && !/\.(test|spec)\./.test(e.name)) {
        const bucket = index.get(e.name) ?? [];
        bucket.push(full);
        index.set(e.name, bucket);
      }
    }
  };
  visit(ROOT, 0);
  return index;
}

describe('feature-source comments cite paths that exist', () => {
  it('every repo-relative path in a feature comment resolves', () => {
    const files = walk(FEATURES);
    expect(files.length, 'no files scanned — FEATURES is wrong').toBeGreaterThan(100);
    // Round 153 measured 8 cited paths across the whole of `ui/src/features`, so a
    // threshold above that would fire on a healthy tree. This one is a floor against a
    // future refactor silently shrinking the finder to nothing.

    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const cited of citedPaths(fs.readFileSync(file, 'utf-8'))) {
        checked += 1;
        if (!fs.existsSync(path.join(ROOT, cited))) {
          missing.push(`${path.relative(ROOT, file).split(path.sep).join('/')} -> ${cited}`);
        }
      }
    }

    expect(checked, 'no cited paths found — the matcher is wrong').toBeGreaterThan(5);
    expect(
      missing.sort(),
      `feature comment(s) citing a path that does not exist. A moved file leaves every ` +
        `reference dangling, and these are read as pointers:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });
});
describe('feature-source comments cite OTHER files at a line that holds text', () => {
  it("the resolver is not vacuous — a known-good citation resolves and is accepted", () => {
    // SELF-TEST, run before the population is trusted. A checker that cannot resolve
    // anything reports zero offenders for the same reason a broken probe reports zero
    // executions: an instrument that cannot fire is indistinguishable from a clean
    // tree. So pin a citation that MUST resolve and whose line MUST hold text.
    //
    // The subject is THIS file, so the case cannot go stale by another file moving.
    const synthetic =
      // NOTE the two-digit line: the extractor requires `:NN` (2-4 digits), which is
      // what keeps a bare `:1` in prose from being read as a citation. My first draft
      // of this self-test used `:1` and the case FAILED — the self-test catching the
      // author, which is the whole reason it exists.
      "// the guard lives at " + path.basename(__filename) + ":11 (this very line)";
    const cites = crossFileCitations(synthetic);
    expect(cites.length, "the cross-file extractor found nothing in a known-good line").toBe(1);
    const abs = resolveCitedFile(__filename, cites[0]!.file);
    expect(abs, "a sibling file in the same directory must resolve").not.toBeNull();
    const target = fs.readFileSync(abs!, "utf-8").split(String.fromCharCode(10));
    expect(target[0]!.trim(), "line 1 must hold text or this self-test proves nothing").not.toBe("");
  });

  it("the historical-stamp exemption fires on a revision and not on a live pointer", () => {
    // WHY THIS CASE EXISTS. The exemption above was added to let `AS OF <sha>` and
    // `fixed <sha>` notes keep pinpointing a REVISION. It shipped with no case of
    // its own, and a mutation test proved the gap: disabling the exemption entirely
    // left all four cases GREEN, because nothing currently in scope needs it. An
    // exemption nothing exercises is indistinguishable from an exemption that does
    // not work -- the same cannot-fail shape this file already records twice.
    //
    // These two strings are the shapes the exemption has to separate. The first is
    // a real KDS extraction header; the second is an ordinary live pointer.
    const historical = "Extracted verbatim from KdsScreen.tsx:718-855 AS OF 7d0dc4d60^ by slice 2.";
    const alsoHistorical = "RetailPosScreen.css:3631, a prose glob (fixed 12a54b3d4)";
    const live = "the section renders at DataManagementScreen.tsx:118-125 and the flash map";
    expect(HISTORICAL_STAMP.test(historical), "AS OF <sha> must exempt").toBe(true);
    expect(HISTORICAL_STAMP.test(alsoHistorical), "fixed <sha> must exempt").toBe(true);
    expect(HISTORICAL_STAMP.test(live), "a plain pointer must NOT be exempt").toBe(false);
  });

  it("no cross-file line citation points at a blank or past-EOF line", () => {
    // SCOPE WIDENED 2026-10-26 (round 25). The walk used to be `FEATURES` alone, which
    // left every comment in `ui/src/api`, `hooks`, `components`, `utils` and `app`
    // ungraded — and that blind spot was not theoretical. `components/SwitchToggle.tsx`
    // cited a `features/restaurant/PaymentScreen.tsx` that DOES NOT EXIST, plus two line
    // numbers that had moved; `api/sales.ts` cited `hooks/usePosHeldCarts.ts:188`, a file
    // path that never resolved and a line now holding `}, [loadOpenBills]);`. Widening
    // found two more immediately (SegmentedTabs -> a truncating StoreSwitcher citation,
    // useStoreTimezone -> a test that had moved 213 lines). Resolved citations went
    // 113 -> 192; the floor below was raised with them so a future narrowing fails here.
    // SCOPE WIDENED AGAIN 2026-10-27 (round 39): ui/src/__tests__ was MEASURED and
    // deliberately NOT added. The measurement is the point. Widening the walk to it
    // found 249 citations and 104 of them land on a blank or past-EOF line -- test
    // comments citing production code to explain WHY a case exists, with the numbers
    // drifted. Fixing those is a real backlog, not a one-line scope change, so the
    // scope stays where it is and the backlog is recorded rather than half-done.
    // The one case that started this: SettingsPage.test.tsx cited
    // crates/kasirmu-bridge/src/settings.rs at a line past that file's end, and was
    // re-pointed by hand in the same round.
    // `ui/src/theme` JOINED THE WALK 2026-10-27 (round 43). It was the one
    // first-party directory with no line-citation grading at all, and tokens.css
    // proved the cost: a six-file citation list for --color-warning-border had
    // THREE stale members (SettingsPage.css:1123 for a rule now at :1073,
    // RestaurantSettingsScreens.css:1199 for :1335, CartPanel.css:201/:212 for
    // :228/:239) and nothing could see it. Measured before widening: 15 resolvable
    // citations, 0 bad — so the widening cost no baseline and closed a real gap.
    const extra = [
      'ui/src/api',
      'ui/src/hooks',
      'ui/src/components',
      'ui/src/utils',
      'ui/src/app',
      'ui/src/theme',
    ].flatMap((d) => walk(path.join(ROOT, d)));
    const files = [...walk(FEATURES), ...extra];
    expect(files.length, "no files scanned — FEATURES is wrong").toBeGreaterThan(100);

    const offenders: string[] = [];
    let checked = 0;
    const basenameIndex = repoBasenameIndex();
    for (const file of files) {
      const source = fs.readFileSync(file, "utf-8");
      for (const cite of crossFileCitations(source)) {
        // TWO SPELLINGS, one question. A path form resolves by path; a BARE basename
        // can only resolve by name, so it is looked up in the repo index. Both are
        // graded identically, and either lookup returning nothing means the token is
        // prose (or a vendored path) and is skipped rather than failed.
        let abs = resolveCitedFile(file, cite.file);
        if (abs === null && !cite.file.includes("/")) {
          const matches = basenameIndex.get(path.basename(cite.file)) ?? [];
          // AMBIGUOUS is skipped, not guessed: two files sharing a basename cannot be
          // told apart from the token alone, and picking one would grade the wrong
          // file. Unambiguous is the only case this pass can judge.
          abs = matches.length === 1 ? matches[0]! : null;
        }
        if (abs === null) continue;   // prose, a vendored path, or an ambiguous name
        // HISTORICAL NOTES (added 2026-10-27, round 39). A citation whose own line —
        // or the two lines either side — carries `AS OF <sha>` or `fixed <sha>`
        // points at a REVISION, not at the working tree. The KDS extraction headers
        // are the main population ("Extracted verbatim from KdsScreen.tsx:718-855
        // AS OF 7d0dc4d60^"), and cssCommentBalance.test.ts records four shipped
        // defects each tagged with its fix commit. Requiring those ranges to still
        // fit inside a file that has since been cut in half would demand the
        // opposite of the truth. The stamp is checked on the cite line and its
        // immediate neighbours so a wrapped note still qualifies.
        const citeLines = source.split(String.fromCharCode(10));
        const historyWindow = citeLines
          .slice(Math.max(0, cite.at - 2), cite.at + 2)
          .join(String.fromCharCode(10));
        if (HISTORICAL_STAMP.test(historyWindow)) continue;
        checked += 1;
        const target = fs.readFileSync(abs, "utf-8").split(String.fromCharCode(10));
        // BLANK or PAST EOF — the no-false-positive subset. A line holding only
        // `}` or `});` is punctuation-only and equally cannot be what a comment
        // means to cite. Anything with real text is accepted, including a section
        // banner named by the comment above a symbol (see the header note).
        const slice = target.slice(cite.from - 1, cite.to);
        const blankOrPastEof =
          cite.from > target.length ||
          slice.every((l) => /^[\s)\];},]*$/.test(l));
        if (blankOrPastEof) {
          const reads =
            cite.from > target.length
              ? "<past EOF: " + target.length + " lines>"
              : JSON.stringify((target[cite.from - 1] ?? "").trim().slice(0, 40));
          offenders.push(
            path.relative(ROOT, file).split(path.sep).join("/") + ":" + cite.at +
              " cites " + cite.file + ":" + cite.from +
              (cite.to !== cite.from ? "-" + cite.to : "") + " — reads " + reads,
          );
        }
      }
    }

    // A FLOOR, so a refactor that shrinks the finder to nothing fails here instead of
    // reporting a clean tree. Measured 2026-10-18 (round 184): 113 resolvable over
    // FEATURES alone. Re-measured 2026-10-26 (round 25) after the walk widened to
    // api/hooks/components/utils/app: 192. Re-measured again the same day (round 26)
    // after the history-word scan narrowed to the cite line and the extension list
    // gained go/mjs/cjs/yml/yaml: 258. The floor moves with the population, not with
    // the tree, so it stays a guard on the EXTRACTOR rather than on the repo.
    expect(checked, "no cross-file citations resolved — the extractor is wrong").toBeGreaterThan(200);
    expect(
      offenders.sort(),
      "feature comment(s) cite another file at a line that is blank or past its end. " +
        "The cited file shrank and the number was never re-checked:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });
});
