// ── The ORDER-TYPE-DEPENDENT VALUE rule, asserted field-agnostically ────────
//
// THE HISTORY THAT PRODUCED THIS FILE
//
// Rounds 40-48 fixed thirteen sites where a value only meaningful for a DINE-IN
// order reached a consumer unconditionally: the table claim, the release, the
// open-bill payload, the cart banner, the pax field, the split tab, the
// send-to-kitchen tab, the held-cart hook, the printed check, the portrait bar,
// the portrait sheet, the kitchen chit, the split dialog. Round 49 found the SAME
// class on the sibling field `guestCount` — a party size persisted onto a
// takeaway, and restored by a recall.
//
// Every one of those was found by a sweep keyed to a FIELD. That is the weakness
// this file removes: a field-keyed sweep finds the field you name, and round 49
// happened only because someone chose to look next door. The rule is not about a
// field:
//
//     A value only meaningful for a DINE-IN order must not reach a consumer
//     unless the order type permits it.
//
// THE FIELD SET IS CLOSED, AND THAT WAS CHECKED — not assumed
//
// The persisted payloads write: lines, discountPercent, discountLabel,
// tableNumber, customerName, guestCount, tipPercent, serviceChargeEnabled,
// serviceChargePercent, orderType. Exactly TWO are dine-in-only:
//
//   tableNumber  — a table exists only for a dine-in order       (rounds 40-48)
//   guestCount   — "SEATED GUESTS PER TABLE" (products.ftl:105)   (round 49)
//
// The rest are deliberately NOT restricted, each for a reason: a discount and a
// tip apply to any order; a service charge can; and customerName is asserted
// unrestricted below because a takeaway still names its customer.
//
// BOTH GATE SHAPES ARE NOW DETECTED, AND THE DETECTOR WAS BUILT TEST-FIRST
//
// The rule reaches a derivation in two legitimate ways:
//
//   1. ON THE DERIVATION  const trimmedTable = orderType === 'dine_in' ? … : …
//   2. ON AN ENCLOSING BLOCK  if (… orderType === 'dine_in') { const x = tableNumber … }
//
// Round 10 shipped only shape 1 and named shape 2 as a hand-written allowance,
// because two attempted detectors were wrong — a 16-line lookback (excused a
// reverted guard when a NEIGHBOURING line carried the rule) and a brace-depth walk
// (mis-read PosScreen:766, where the nested .then() never returns depth to zero).
//
// Both reported a fix as a failure or a failure as a fix, which is why this round
// built the DETECTOR AGAINST KNOWN ANSWERS FIRST. Eight hand-built cases — including
// the two shapes that defeated the earlier attempts — were scored before the real
// tree was touched, and the model that scored 8/8 uses a brace STACK to compute the
// set of blocks still open at the target, then asks two different questions:
//
//   * on the target line: does the rule appear at all? (a ternary IS the guard)
//   * on an enclosing opener: is it an \`if (…)\` carrying the rule? (only an if opens)
//
// Verified on the real tree: 0 false positives, and it fires on every reverted guard
// (6 / 2 / 1 offenders in the three files) AND on a newly injected ungated consumer.
// An earlier draft of THIS round's file also failed that last test — a detector that
// cannot see a new instance of the thing it guards is the round-4 blindness again.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const UI_SRC = resolve(__dirname, '..');

/**
 * The POS roots the rule governs.
 *
 * DISCOVERED, not listed. An earlier version of this file named four sources by
 * hand and silently missed three more that reference `orderType` —
 * CartActionBar, SplitBillModal and payment/types. All three turned out to hold a
 * gate or a type rather than a derivation, so the verdict was right, but it was
 * right by ACCIDENT of the list: the guard would have stayed green if any of them
 * had carried an ungated derivation. That is the round-4 blindness (a list cannot
 * notice what is missing from it) and it is fixed the same way here.
 */
const ROOTS = ['features/sales', 'features/restaurant', 'features/tables'];

/**
 * Sources excluded from the rule, each with EVIDENCE that it is a value-handler
 * rather than a decision-maker.
 *
 * The rule is about a DECISION — does this record/consumer apply to a non-dine-in
 * order? A pure formatter makes no such decision, so its CALLER owns the rule and
 * gating it here would gate nothing.
 *
 * Declared ABOVE SOURCES because SOURCES filters by it; an evidence entry whose
 * file gains an `orderType` reference fails the case that reads this list, so the
 * exclusion cannot silently widen.
 */
const VALUE_HANDLERS: Array<{ rel: string; why: string }> = [
  {
    rel: 'features/sales/utils/tableLabel.ts',
    why: 'display-only formatter — takes a table value, returns a label',
  },
];

function collect(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!/__tests__|node_modules/.test(e.name)) collect(full, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

/** The dine-in-only state values, and why each is dine-in-only. */
const DINE_IN_ONLY: Array<{ state: string; why: string }> = [
  { state: 'tableNumber', why: 'a table exists only for a dine-in order' },
  { state: 'guestCount', why: 'the setting reads SEATED GUESTS PER TABLE (products.ftl:105)' },
];

/** The rule, anywhere on a line — on a derivation this IS the guard (a ternary). */
const GATE_ON_LINE = /orderType === 'dine_in'/;

/** The rule as a BLOCK CONDITION — only an \`if (…)\` opens a scope we can be inside. */
const GATE_AS_IF = /\bif\s*\(.*orderType === 'dine_in'/;

/**
 * The lines whose \`{\` is still open at \`target\` — i.e. the blocks that enclose it.
 *
 * A brace STACK, not a depth counter. Depth alone cannot say WHICH line opened the
 * scope we are in, and that is the question: an enclosed gate is legal only if the
 * enclosing opener carries the rule.
 */
function enclosingOpeners(lines: string[], target: number): number[] {
  const stack: number[] = [];
  for (let i = 0; i < target; i++) {
    for (const ch of lines[i] ?? '') {
      if (ch === '{') stack.push(i);
      else if (ch === '}') stack.pop();
    }
  }
  return [...stack];
}

/** Is this derivation gated — on its own line, or by a block that encloses it? */
function isGated(lines: string[], target: number): boolean {
  if (GATE_ON_LINE.test(lines[target] ?? '')) return true;
  return enclosingOpeners(lines, target).some((i) => GATE_AS_IF.test(lines[i] ?? ''));
}

function offenders(src: string): string[] {
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  lines.forEach((text, i) => {
    const reads = DINE_IN_ONLY.find((d) =>
      new RegExp('const\\s+\\w+\\s*=[^=]*\\b' + d.state + '\\b').test(text),
    );
    if (!reads) return;
    if (isGated(lines, i)) return;
    out.push((i + 1) + ': ' + text.trim() + '   [' + reads.why + ']');
  });
  return out;
}

/** Every discovered source that references a protected state, with its text. */
const SOURCES: Array<[string, string]> = ROOTS.flatMap((root) =>
  collect(join(UI_SRC, root))
    .map((abs) => {
      const text = readFileSync(abs, 'utf-8');
      const rel = relative(UI_SRC, abs).split('\\').join('/');
      return [rel, text] as [string, string];
    })
    .filter(([, text]) => DINE_IN_ONLY.some((d) => new RegExp('\\b' + d.state + '\\b').test(text)))
    .filter(([rel]) => !VALUE_HANDLERS.some((v) => v.rel === rel)),
);

describe('the value-handler exclusions are still true', () => {
  it.each(VALUE_HANDLERS)('$rel makes no order-type decision', ({ rel, why }) => {
    const text = readFileSync(join(UI_SRC, rel), 'utf-8');
    // The reason has to be checkable, or the exclusion is a silent bypass.
    expect(
      /\borderType\b/.test(text),
      rel + ' now references orderType, so it IS a decision site and must not be ' +
        'excluded. Reason given for excluding it: ' + why,
    ).toBe(false);
  });
});

describe('a dine-in-only value is gated at every derivation', () => {
  it.each(SOURCES)('%s gates every derivation of tableNumber/guestCount', (_name, src) => {
    expect(
      offenders(src),
      'These derive an order-type-dependent value unconditionally. Gate the ' +
        'derivation on the order type (the same rule the sibling lines apply), or ' +
        'add the field to DINE_IN_ONLY with its reason.',
    ).toEqual([]);
  });

  it('finds the derivations, so the cases above cannot pass vacuously', () => {
    // A rename of either state or of the derivation shape would leave the scan
    // matching nothing — and an empty offender list reads exactly like success.
    // Measured at time of writing: 8 line-gated derivations across the four files.
    const gated = SOURCES.reduce((n, [, src]) => {
      const m = src.match(/const\s+\w+\s*=[^=]*\borderType === 'dine_in'/g);
      return n + (m ? m.length : 0);
    }, 0);
    expect(gated, 'no derivation carrying the rule was found — the scan is blind').toBeGreaterThanOrEqual(6);
  });

  // ── The DETECTOR is guarded too, against known answers ──────────────────────
  //
  // Round 10 shipped two detectors that were both wrong, and neither was caught
  // because only the whole-tree result was asserted — and an empty offender list
  // reads the same whether the tree is clean or the scan is blind. These cases pin
  // the detector's behaviour directly, including the two shapes that defeated the
  // earlier attempts: a gate reached THROUGH a nested callback, and a gate that
  // must NOT apply because the block it opened was already closed.
  const CASES: Array<{ name: string; src: string[]; gated: boolean }> = [
    { name: 'ternary on the derivation line', gated: true, src: [
      "const t = orderType === 'dine_in' ? tableNumber : '';",
    ] },
    { name: 'bare derivation', gated: false, src: [
      "const t = (tableNumber ?? '').trim();",
    ] },
    { name: 'enclosing if, no nesting', gated: true, src: [
      "if (sessionToken && orderType === 'dine_in') {",
      "  const t = (tableNumber ?? '').trim();",
      "}",
    ] },
    { name: 'enclosing if through a NESTED callback', gated: true, src: [
      "if (tableNumber && orderType === 'dine_in') {",
      "  void list().then(async (tables) => {",
      "    if (x) {",
      "      return;",
      "    }",
      "    const t = (tableNumber ?? '').trim();",
      "  });",
      "}",
    ] },
    { name: 'gate present but its block already closed', gated: false, src: [
      "if (sessionToken && orderType === 'dine_in') {",
      "  doThing();",
      "}",
      "const t = (tableNumber ?? '').trim();",
    ] },
    { name: 'enclosed two levels deep', gated: true, src: [
      "if (orderType === 'dine_in') {",
      "  if (a) {",
      "    if (b) {",
      "      const t = tableNumber;",
      "    }",
      "  }",
      "}",
    ] },
    { name: 'a sibling block is NOT an enclosing block', gated: false, src: [
      "if (orderType === 'dine_in') {",
      "  doThing();",
      "}",
      "if (other) {",
      "  const t = tableNumber;",
      "}",
    ] },
    { name: 'ternary on the line AND enclosed', gated: true, src: [
      "if (other) {",
      "  const t = orderType === 'dine_in' ? tableNumber : '';",
      "}",
    ] },
  ];

  it.each(CASES)('detector: $name -> gated=$gated', ({ src, gated }) => {
    const target = src.findIndex((l) => /const t =/.test(l));
    expect(target, 'no target line in this case — fix the fixture').toBeGreaterThanOrEqual(0);
    expect(isGated(src, target), 'the detector disagreed with a known answer').toBe(gated);
  });

  it('customerName stays deliberately unrestricted', () => {
    // The counter-case, kept so a tidy pass cannot "fix" it by symmetry: a
    // takeaway still has a customer to name on the ticket.
    const cartPanel = readFileSync(join(UI_SRC, 'features/sales/components/CartPanel.tsx'), 'utf-8');
    const gate = cartPanel.match(/setCustomerName && customerNameEnabled !== false && \(/g) ?? [];
    expect(gate.length, 'the customer-name render gate must NOT carry an order-type condition').toBe(1);
  });
});
