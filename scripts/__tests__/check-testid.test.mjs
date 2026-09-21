import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze,
  appendHole,
  dedupeRecords,
  EXIT,
  extractAlternative,
  FIXTURES,
  isExcluded,
  parseSource,
  runCheck,
  splitAlternatives,
} from '../check-testid.mjs';

/* Spec section 6: every fixture row is asserted here too, so the parser's
 * handling of all five hard shapes is checked by `npm run test:scripts`. */

test('C1/C2: each section-6 fixture parses to its expected literals', () => {
  for (const fx of FIXTURES) {
    const got = parseSource(fx.input, 'synthetic.tsx').map((r) => r.normalized);
    assert.deepEqual(got, fx.expect, fx.src + ' -> ' + JSON.stringify(got));
  }
});

test('C2: synthetic R1 violations are not kebab-case', () => {
  for (const bad of ['Foo_Bar', 'foo--bar', 'foo-bar-']) {
    const res = analyze([{ normalized: bad, file: 'ui/src/x.tsx', line: 1 }], { max_duplicate_contracts: 1, contracts: [] });
    assert.equal(res.exit, EXIT.FINDINGS, bad + ' must fail R1');
    assert.ok(res.findings.some((f) => f.startsWith('R1')), bad + ' must be reported as R1');
  }
});

test('normalization rule 3: the placeholder is appended AFTER the hyphen', () => {
  assert.equal(appendHole('security-trail-outcome-'), 'security-trail-outcome-hole');
  assert.equal(appendHole('kds-order-card'), 'kds-order-card-hole');
  assert.equal(appendHole(''), 'hole');
  assert.equal(extractAlternative("'security-trail-outcome-' + chip.value"), 'security-trail-outcome-hole');
  assert.equal(extractAlternative('`kds-order-card-${id}`'), 'kds-order-card-hole');
});

test('2.4b: ALL alternatives, not just the first', () => {
  const alts = splitAlternatives('column.zone ? `kds-expo-station-${column.zone}` : \'kds-expo-station-none\'');
  assert.equal(alts.length, 2);
  assert.deepEqual(alts.map(extractAlternative), ['kds-expo-station-hole', 'kds-expo-station-none']);
  assert.deepEqual(splitAlternatives("'a' || 'b'").map(extractAlternative), ['a', 'b']);
});

test('2.4c: bare identifiers and member expressions are SKIPPED', () => {
  assert.equal(extractAlternative('dataTestId'), null);
  assert.equal(extractAlternative('props.testId'), null);
  assert.equal(extractAlternative('makeId(x)'), null);
});

test('C5: repeats inside one file collapse to one R2 record', () => {
  const records = parseSource('data-testid="product-grid-scroll"\ndata-testid="product-grid-scroll"', 'ui/src/a.tsx');
  assert.equal(records.length, 2);
  assert.equal(dedupeRecords(records).length, 1);
});

test('C3/R2: two producers with no contracts row fails and names both files', () => {
  const records = [
    { normalized: 'dup-x', file: 'ui/src/a/A.tsx', line: 1 },
    { normalized: 'dup-x', file: 'ui/src/b/B.tsx', line: 1 },
  ];
  const res = analyze(records, { max_duplicate_contracts: 1, contracts: [] });
  assert.equal(res.exit, EXIT.FINDINGS);
  assert.ok(res.findings[0].includes('A.tsx') && res.findings[0].includes('B.tsx'));
});

test('C4: R2 keys on the FULL literal, never a prefix', () => {
  const records = [
    { normalized: 'cart-line', file: 'ui/src/a/A.tsx', line: 1 },
    { normalized: 'cart-line-item', file: 'ui/src/b/B.tsx', line: 1 },
  ];
  assert.equal(analyze(records, { max_duplicate_contracts: 1, contracts: [] }).exit, EXIT.OK);
});

test('C9/B4.1: a contracts row with no live contract is an ERROR', () => {
  const records = [{ normalized: 'live-one', file: 'ui/src/a/A.tsx', line: 1 }];
  const res = analyze(records, { max_duplicate_contracts: 1, contracts: [{ literal: 'gone-now', files: ['ui/src/a/A.tsx'] }] });
  assert.equal(res.exit, EXIT.FINDINGS);
  assert.ok(res.findings.some((f) => f.startsWith('STALE')));
});

test('B4.4: a third producer of an allowed literal fails', () => {
  const records = [
    { normalized: 'dup-x', file: 'ui/src/a/A.tsx', line: 1 },
    { normalized: 'dup-x', file: 'ui/src/b/B.tsx', line: 1 },
    { normalized: 'dup-x', file: 'ui/src/c/C.tsx', line: 1 },
  ];
  const baseline = { max_duplicate_contracts: 1, contracts: [{ literal: 'dup-x', files: ['ui/src/a/A.tsx', 'ui/src/b/B.tsx'] }] };
  assert.equal(analyze(records, baseline).exit, EXIT.FINDINGS);
  assert.equal(analyze(records.slice(0, 2), baseline).exit, EXIT.OK);
});

test('C6: consumers produce nothing', () => {
  for (const call of ['querySelector', 'querySelectorAll', 'getByTestId', 'findByTestId', 'getAllByTestId']) {
    assert.equal(parseSource("const n = x." + call + "('[data-testid=\"some-id\"]');", 'ui/src/a.tsx').length, 0, call);
  }
});

test('C8: an empty corpus exits 2, never 0', () => {
  const res = runCheck([]);
  assert.equal(res.exit, EXIT.CANNOT_RUN);
  assert.ok(res.lines[0].includes('0 files scanned'));
});

test('C11: section 3 exclusion set', () => {
  assert.equal(isExcluded('ui/src/__tests__/A.test.tsx'), true);
  assert.equal(isExcluded('ui/src/a/A.test.ts'), true);
  assert.equal(isExcluded('ui/src/a/A.spec.tsx'), true);
  assert.equal(isExcluded('ui/src/test-setup.ts'), true);
  assert.equal(isExcluded('ui/src/dev-mock/tauri-api.ts'), true);
  assert.equal(isExcluded('ui/e2e/sale.spec.ts'), true);
  assert.equal(isExcluded('ui/src/a/A.css'), true);
  assert.equal(isExcluded('ui/src/features/a/A.tsx'), false);
});
