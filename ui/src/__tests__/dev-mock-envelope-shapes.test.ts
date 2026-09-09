// ── Dev-mock envelope shapes ─────────────────────────────────────────────────
//
// Precondition for the 8-site dedup (switching the duplicated
// `(args as { args?: X })?.args ?? (args as X)` reads onto mockHandlerPayload).
// Those eight handlers are reached in TWO different ways, and the two are
// different code paths, so a dedup that gets the fallback wrong changes
// behaviour without failing any existing test:
//
//   - enveloped: ui/src/api/sales.ts sends { sessionToken, args } for
//     add_line_scoped (:136), complete_sale_scoped (:181),
//     preview_promoted_total_scoped (:217) and process_refund_scoped (:642).
//     invoke() unwraps { args } before dispatch, so the handler sees the flat
//     payload -- the `?? (args as X)` fallback is what saves these.
//   - flat: ui/src/api/promotions.ts:77/:109 calls get_sale_promotions_scoped
//     with { sessionToken, saleId } -- no envelope at all, so the handler must
//     read its fields off the object it was handed.
//
// process_refund* is the one pair whose result is fully observable with no
// seeded state: it sums payload.lines[].lineTotalMinor and echoes it back. A
// handler that ignores its input returns 0, which is what the 2500 below
// exists to catch -- that is the same failure mode as the args.args bug fixed
// in 3da6a6226, one step earlier on the pipeline.
//
// jsdom has no window.__TAURI_INTERNALS__, so invoke() routes to the mock -- the
// path a browser preview takes.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

type RefundResult = { refundId: string; totalMinor: number };

const LINES = [
  { lineTotalMinor: 1000 },
  { lineTotalMinor: 1500 },
];

describe('dev-mock refund handlers across both payload shapes', () => {
  it('sums an enveloped payload (the api/sales.ts call shape)', async () => {
    const res = await invoke<RefundResult>('process_refund_scoped', {
      sessionToken: 'mock-token',
      args: { lines: LINES },
    });
    // 2500, not 0: proves the payload was read through the unwrap rather than
    // dropped on the floor.
    expect(res.totalMinor).toBe(2500);
    expect(typeof res.refundId).toBe('string');
  });

  it('sums a flat payload (the shape a non-enveloping wrapper sends)', async () => {
    const res = await invoke<RefundResult>('process_refund_scoped', {
      sessionToken: 'mock-token',
      lines: LINES,
    });
    expect(res.totalMinor).toBe(2500);
  });

  it('behaves the same on the unscoped twin, whose wrapper is not in api/', async () => {
    // process_refund has no caller in ui/src/api (grep found none), so nothing
    // else pins it. Recorded rather than assumed dead: the desktop/tablet
    // allowlists decide reachability, not the mock.
    const res = await invoke<RefundResult>('process_refund', {
      sessionToken: 'mock-token',
      args: { lines: LINES },
    });
    expect(res.totalMinor).toBe(2500);
  });
});
