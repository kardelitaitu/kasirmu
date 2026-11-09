/**
 * @vitest-environment node
 *
 * Source-level guard: every `gatewayStatus` the UI writes must be inside the
 * ADR-64 D4 closed set. The whole import graph here is `fs` + `path` only, so it
 * needs no jsdom window (see tenderValueSingleSource.test.ts for the same reasoning).
 */
// ── Guard: `gatewayStatus` values stay inside the CHECK vocabulary ───────────
//
// The defect this pins: `useEdcTenderPhase` wrote `'captured'` and `useGatewayQr`
// wrote `'completed'` into `paymentSplits[].gatewayStatus`, which
// `payments.rs:122` inserts verbatim into the CHECK-constrained
// `payments.gateway_status`. Neither spelling is in the vocabulary, so an EDC charge
// or a confirmed QRIS raised a CHECK violation and failed the whole checkout
// transaction — AFTER the customer had paid.
//
// WHY STATIC AND NOT BEHAVIOURAL. A behavioural test asserts whatever value the
// code happens to produce, which is how `'captured'` survived: the EDC case in
// PaymentModalSaleFlow.test.tsx asserted `'captured'` and stayed green for exactly
// as long as the code wrote it. Only a check against an INDEPENDENT list of legal
// values can notice the vocabulary itself is wrong. The list below is transcribed
// from migration 20261018_gateway_status_adr64_vocabulary.sql, whose enforcement
// test (migrations_tests.rs:3756-3796) pins the same nine as the only accepted set
// and explicitly pins `'chargeback'` as rejected.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/** The vocabulary, transcribed from the migration. NOT imported from the UI type —
 *  importing it would make this test agree with the code by construction, which is
 *  the failure mode that let the old values through in the first place. */
const ADR64_GATEWAY_STATUSES = [
  'pending',
  'authorized',
  'confirmed',
  'settled',
  'failed',
  'voided',
  'refunded',
  'disputed',
  'unconfirmed',
] as const;

const TENDER_SITES = [
  'src/features/sales/PaymentModal.tsx',
  'src/features/sales/payment/useAutoQr.ts',
  'src/features/sales/payment/useEdcTenderPhase.ts',
  'src/features/sales/payment/useGatewayQr.ts',
];

describe('gatewayStatus stays inside the ADR-64 vocabulary', () => {
  const offenders: string[] = [];

  for (const rel of TENDER_SITES) {
    const file = path.resolve(process.cwd(), rel);
    const source = fs.readFileSync(file, 'utf-8');
    const lines = source.split(/\r?\n/);

    lines.forEach((line, i) => {
      // Only WRITE sites: `gatewayStatus: 'x'`. A type declaration
      // (`gatewayStatus: string`, or the union in api/types/payment.ts) is not a
      // value and would report every legal status as an offender.
      const m = /gatewayStatus\s*:\s*'([^']+)'/.exec(line);
      if (!m?.[1]) return;
      const value = m[1];
      if (!(ADR64_GATEWAY_STATUSES as readonly string[]).includes(value)) {
        offenders.push(`${rel}:${i + 1}  gatewayStatus: '${value}'`);
      }
    });
  }

  it('writes no gatewayStatus outside the CHECK vocabulary', () => {
    expect(
      offenders,
      [
        'A gatewayStatus value the payments.gateway_status CHECK rejects is being',
        'written. It reaches payments.rs:122 unvalidated, so the INSERT fails and',
        'the whole checkout transaction is rolled back -- after the gateway has',
        'already taken the money. The legal set is ' +
          ADR64_GATEWAY_STATUSES.join(', ') + '.',
      ].join(' '),
    ).toEqual([]);
  });

  it('the guarded vocabulary is non-trivially small enough to fail', () => {
    // Guard-the-guard: an empty legal set would make the check above pass for
    // everything, and a set containing every possible string would make it pass
    // for anything. Both are worth failing loudly.
    expect(ADR64_GATEWAY_STATUSES.length).toBeGreaterThan(4);
    expect(ADR64_GATEWAY_STATUSES.length).toBeLessThan(15);
    // 'captured' and 'completed' -- the two offenders -- must be OUTSIDE the set,
    // or the migration they were violating is not the one being modelled.
    expect(ADR64_GATEWAY_STATUSES).not.toContain('captured');
    expect(ADR64_GATEWAY_STATUSES).not.toContain('completed');
  });
});