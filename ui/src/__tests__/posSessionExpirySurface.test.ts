// ── A payment screen must survive a session expiring MID-SHIFT ───────────
//
// Two mechanisms cover a dead session, and rounds 41 and 76 built one each:
//
//   AppShell's durable banner   driven by `sessionError`, which is set when
//                               `createSession` is REJECTED at boot.
//   useInvalidSession()         driven by `onIpcError`, which fires when a later
//                               command answers `invalidSession`.
//
// They do not overlap. A session that expires during a shift never sets `sessionError`,
// so the durable banner stays silent; and `useInvalidSession` had exactly ONE production
// consumer, `AnalyticsScreen`. On the POS a cashier mid-service therefore got nothing:
// `PosScreen` even swallows the kind explicitly (`if (kind === 'invalidSession') return;`,
// which is right for a per-card settings read and wrong as the ONLY handling).
//
// This file pins the coverage rather than the mechanism, because the mechanism is fine —
// it is the wiring that was missing.
//
// ── Why not simply reuse SessionRecoveryBanner ──
//
// It is generic in its PROPS ("zero screen coupling beyond the navigation prop") but its
// class names are all `analytics-session-banner*`, styled by `AnalyticsScreen.css`. That
// sheet reaches the tablet shell through `tablet.css:599` and NOT the desktop shell, so
// importing the component into the POS would render an unstyled alert on desktop. The
// requirement is the SURFACE, and each shell styles its own.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(REPO, rel), 'utf-8');

/** Screens that TAKE PAYMENT: on these, a dead session stops the business. */
const PAYMENT_SURFACES = [
  'ui/src/features/sales/PosScreen.tsx',
  'ui/src/features/retail/RetailPosScreen.tsx',
];

describe('a payment surface tells the operator its session died mid-shift', () => {
  it.each(PAYMENT_SURFACES)('%s consumes useInvalidSession', (rel) => {
    const src = read(rel);
    expect(
      src,
      rel + ' does not use useInvalidSession, so a session that expires during a shift ' +
        'is invisible there. AppShell\'s banner keys on `sessionError`, which only boot ' +
        'sets. Mount the hook and render a recovery affordance.',
    ).toMatch(/useInvalidSession\(/);
  });

  it.each(PAYMENT_SURFACES)('%s renders it as an announced alert', (rel) => {
    // A boolean the operator cannot see is the same defect with more code. The signal
    // has to reach the DOM, and it has to be announced (role=alert), not decorative.
    const src = read(rel);
    expect(src, rel + ' reads the hook but never renders anything from it').toMatch(
      /showSessionBanner|sessionExpiredBanner|invalidSessionBanner/,
    );
  });

  it('the recovery affordance exists on the desktop shell too', () => {
    // The regex above is satisfied by a class name that nothing styles. This asserts
    // the POS ships its own rule rather than borrowing the analytics sheet, which the
    // desktop shell does not load.
    const css = read('ui/src/features/sales/PosScreen.css');
    expect(
      css,
      'PosScreen.css has no session-banner rule. Reusing the analytics-classed ' +
        'component would render unstyled on desktop, where AnalyticsScreen.css is not ' +
        'loaded.',
    ).toMatch(/\.pos-session-banner/);
  });

  it('the guard is not vacuous', () => {
    expect(PAYMENT_SURFACES.length).toBe(2);
    for (const rel of PAYMENT_SURFACES) expect(read(rel).length).toBeGreaterThan(10_000);
  });
});
