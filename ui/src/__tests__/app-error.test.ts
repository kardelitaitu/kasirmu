/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  classifyRetry,
  emitIpcError,
  newCorrelationId,
  normalizeError,
  onIpcError,
  parseAppError,
  redactDiagnostic,
  redactedDiagnostic,
  userErrorKey,
  userErrorMessage,
  l10nErrorMessage,
  withCorrelationId,
} from '@/utils/app-error';

/**
 * ERR-05/ERR-06 — typed AppError normalizer contract tests.
 *
 * Pins the audit requirements: internal/DB messages never become the
 * default user-facing copy, retryability comes from the typed kind/subKind
 * (not string sniffing), correlation ids trace failures, and diagnostics
 * are redacted.
 */

describe('parseAppError', () => {
  it('parses a plain AppError object (normal Tauri v2 path)', () => {
    const err = { kind: 'core', subKind: 'Validation', message: 'name required' };
    expect(parseAppError(err)).toEqual(err);
  });

  it('parses a Tauri-wrapped string (prefix + serialized JSON)', () => {
    const wrapped =
      "Error invoking remote method 'create_tax_rate': Error: {\"kind\":\"core\",\"subKind\":\"Validation\",\"message\":\"rate must be positive\"}";
    const parsed = parseAppError(wrapped);
    expect(parsed).toEqual({ kind: 'core', subKind: 'Validation', message: 'rate must be positive' });
  });

  it('parses an Error whose message embeds the JSON payload', () => {
    const e = new Error(
      "Error invoking remote method 'x': {\"kind\":\"permissionDenied\",\"message\":\"owner only\"}",
    );
    expect(parseAppError(e)).toEqual({ kind: 'permissionDenied', message: 'owner only' });
  });

  it('handles all six Rust AppError kinds', () => {
    expect(parseAppError({ kind: 'core', subKind: 'Db', message: 'x' })?.kind).toBe('core');
    expect(parseAppError({ kind: 'hardware', subKind: 'Timeout', message: 'x' })?.kind).toBe('hardware');
    expect(parseAppError({ kind: 'invalid', message: 'x' })?.kind).toBe('invalid');
    expect(parseAppError({ kind: 'permissionDenied', message: 'x' })?.kind).toBe('permissionDenied');
    expect(parseAppError({ kind: 'invalidSession' })?.kind).toBe('invalidSession');
    expect(parseAppError({ kind: 'internal', message: 'x' })?.kind).toBe('internal');
  });

  it('returns null for non-AppError values', () => {
    expect(parseAppError(null)).toBeNull();
    expect(parseAppError(undefined)).toBeNull();
    expect(parseAppError(42)).toBeNull();
    expect(parseAppError(new Error('plain boom'))).toBeNull();
  });
});

describe('classifyRetry', () => {
  it('hardware transport failures are retryable', () => {
    expect(classifyRetry({ kind: 'hardware', subKind: 'Timeout', message: 'device not responding' })).toBe('retryable');
    expect(classifyRetry({ kind: 'hardware', subKind: 'Disconnected', message: 'scanner gone' })).toBe('retryable');
    expect(classifyRetry({ kind: 'hardware', subKind: 'NotFound', message: 'no device' })).toBe('non-retryable');
  });

  it('platform infra failures are retryable; other core kinds are not', () => {
    expect(classifyRetry({ kind: 'core', subKind: 'Platform', message: 'sync infra down' })).toBe('retryable');
    expect(classifyRetry({ kind: 'core', subKind: 'Validation', message: 'bad input' })).toBe('non-retryable');
    expect(classifyRetry({ kind: 'core', subKind: 'Conflict', message: 'dup' })).toBe('non-retryable');
    expect(classifyRetry({ kind: 'core', subKind: 'NotFound', message: 'missing' })).toBe('non-retryable');
  });

  it('validation/permission/session/internal are never retryable', () => {
    expect(classifyRetry({ kind: 'invalid', message: 'x' })).toBe('non-retryable');
    expect(classifyRetry({ kind: 'permissionDenied', message: 'x' })).toBe('non-retryable');
    expect(classifyRetry({ kind: 'invalidSession' })).toBe('non-retryable');
    expect(classifyRetry({ kind: 'internal', message: 'x' })).toBe('non-retryable');
  });

  it('falls back to network-keyword sniffing for unrecognized errors', () => {
    expect(classifyRetry(new Error('Network request failed (etimedout)'))).toBe('retryable');
    expect(classifyRetry(new Error('boom'))).toBe('non-retryable');
  });

  it('untyped fallback carries the checkout vocabulary, terminal wins over transport (R3)', () => {
    // Patterns migrated from PaymentModal's deleted private scanner:
    expect(classifyRetry('Payment service unavailable')).toBe('retryable');
    expect(classifyRetry(new Error('gateway offline'))).toBe('retryable');
    expect(classifyRetry(new Error('enotfound redis.internal'))).toBe('retryable');
    expect(classifyRetry(new Error('upstream 500 server error'))).toBe('retryable');
    // The precedence the private scanner had and the shared one lacked:
    // transport words do NOT invite a re-submit once the message names
    // a terminal condition.
    expect(classifyRetry('connection closed: charge already captured')).toBe('non-retryable');
    expect(classifyRetry('card declined after a network timeout')).toBe('non-retryable');
    // 'try again' is deliberately NOT a retry signal — this module's own
    // non-retryable copy ends with it, so scanning for it once made the
    // checkout offer Retry on the strength of its own fallback text.
    expect(
      classifyRetry('This record was changed by someone else. Refresh and try again.'),
    ).toBe('non-retryable');
  });
});

describe('userErrorKey / userErrorMessage', () => {
  const getString = (key: string, fallback?: string) => fallback ?? key;

  it('maps typed kinds to localized user-safe keys, never raw messages', () => {
    expect(userErrorKey({ kind: 'invalid', message: 'sqlite: bad' })).toBe('app-error-validation');
    expect(userErrorKey({ kind: 'permissionDenied', message: 'owner only' })).toBe('app-error-permission');
    expect(userErrorKey({ kind: 'invalidSession' })).toBe('app-error-session');
    expect(userErrorKey({ kind: 'core', subKind: 'Conflict', message: 'x' })).toBe('app-error-conflict');
    expect(userErrorKey({ kind: 'core', subKind: 'Conflict', message: 'conflict: category already exists (name)' })).toBe('app-error-duplicate');
    expect(userErrorKey({ kind: 'core', subKind: 'Conflict', message: 'conflict: product already exists (sku or barcode)' })).toBe('app-error-duplicate');
    expect(userErrorKey({ kind: 'core', subKind: 'Conflict', message: 'conflict: product already exists (version)' })).toBe('app-error-conflict');
    expect(userErrorKey({ kind: 'core', subKind: 'NotFound', message: 'x' })).toBe('app-error-not-found');
    expect(userErrorKey({ kind: 'core', subKind: 'Validation', message: 'x' })).toBe('app-error-validation');
    expect(userErrorKey({ kind: 'hardware', subKind: 'Timeout', message: 'x' })).toBe('app-error-hardware');
    expect(userErrorKey({ kind: 'internal', message: 'panic: secret' })).toBe('app-error-generic');
  });

  it('resolves a localized user-safe message for every kind', () => {
    expect(userErrorMessage({ kind: 'internal', message: 'sqlite: constraint failed' }, getString)).toBe(
      'Something went wrong. Please try again.',
    );
    expect(userErrorMessage({ kind: 'permissionDenied', message: 'admin required' }, getString)).toBe(
      "You don't have permission to do this.",
    );
  });

  // `l10nErrorMessage` is the wrapper 184 call sites use, and it DELEGATES to
  // `userErrorMessage` (app-error.ts:350). That delegation is the whole reason a screen
  // passing its own fallback key still gets the conflict copy -- and nothing pinned it,
  // so breaking one line in the wrapper would silently stop the app-error-* mapping from
  // reaching every screen that calls it, while the assertions above stayed green.
  //
  // The distinction this exists to keep: a backend that REFUSES a replay (the unique index
  // on suppliers.code, the CAS on stock counts and staff restore) is reported as
  // 'This record was changed by someone else' or '...already exists' -- NOT as the screen's
  // generic save failure. That is the SyncConflictReviewScreen behaviour, and it depends
  // entirely on this delegation holding.
  it('l10nErrorMessage inherits the conflict and duplicate mapping', () => {
    // A stub l10n: `getString(key, fallback)` returns the fallback, which is what
    // userErrorMessage resolves through.
    // Mirror `fluentErrorGetter` (app-error.ts:315-317): Fluent's getString takes
    // (key, args, fallback), so the caller's fallback is the THIRD argument. A stub that
    // reads the second one would make this case fail while the real call sites pass --
    // which is how the first draft of this test was wrong.
    const l10n = {
      getString: (key: string, _args: unknown, fallback?: string) => fallback ?? key,
    } as never;
    expect(l10nErrorMessage({ kind: 'core', subKind: 'Conflict', message: 'x' }, l10n, 'screen-fallback')).toBe(
      'This record was changed by someone else. Refresh and try again.',
    );
    expect(
      l10nErrorMessage(
        { kind: 'core', subKind: 'Conflict', message: 'conflict: category already exists (name)' },
        l10n,
        'screen-fallback',
      ),
    ).toBe('An item or category with this name or code already exists.');
    // The screen's fallback is for an error that is NOT a typed AppError at all. A typed
    // 'internal' error maps to app-error-generic instead (:133), which is why the first two
    // assertions above are meaningful rather than vacuous: a conflict is DISTINGUISHED from
    // a generic internal failure, and both are distinguished from an untyped throw.
    // The screen's fallback key IS reachable -- but only through the real Fluent lookup.
    // `userErrorMessage` passes `USER_ERROR_FALLBACKS[fallbackKey] ?? USER_ERROR_FALLBACKS
    // ['app-error-generic']` as the fallback ARGUMENT (app-error.ts:334), so a stub that
    // returns the argument cannot see the key at all. A real `l10n.getString(key, null,
    // fallback)` resolves the FTL entry for an unknown key to the fallback. Modelling that
    // is the difference between this case passing and proving nothing.
    const realish = {
      getString: (key: string, _args: unknown, fallback?: string) =>
        key === 'screen-fallback' ? 'Could not save the supplier.' : (fallback ?? key),
    } as never;
    expect(
      l10nErrorMessage(new Error('plain network throw'), realish, 'screen-fallback'),
    ).toBe('Could not save the supplier.');
  });
  it('never returns the raw backend message as the user copy', () => {
    const raw = 'sqlite: UNIQUE constraint failed: products.sku';
    const out = userErrorMessage({ kind: 'core', subKind: 'Db', message: raw }, getString);
    expect(out).not.toContain('sqlite');
    expect(out).not.toContain('UNIQUE');
  });
});

describe('redaction (ERR-06)', () => {
  it('redacts license keys, UUIDs, keys, emails, paths, and hex', () => {
    const dirty =
      'license OZ-PRO-ABCD-1234-XYZQ, uuid 550e8400-e29b-41d4-a716-446655440000, ' +
      'sk_live_abcdef1234567890, owner@example.com, C:\\data\\secret.db, 0xdeadbeefcafebabe';
    const clean = redactDiagnostic(dirty);
    expect(clean).not.toContain('ABCD-1234');
    expect(clean).not.toContain('550e8400');
    expect(clean).not.toContain('sk_live');
    expect(clean).not.toContain('owner@example.com');
    expect(clean).not.toContain('secret.db');
    expect(clean).not.toContain('deadbeef');
    expect(clean).toContain('REDACTED-LICENSE');
    expect(clean).toContain('REDACTED-PATH');
  });

  it('produces a bounded, correlation-tagged diagnostic line', () => {
    const err = { kind: 'core', subKind: 'Db', message: 'sqlite: failure for owner@example.com' };
    const line = redactedDiagnostic(err);
    expect(line).toContain('[core:Db]');
    expect(line).toContain('retry=non-retryable');
    expect(line).not.toContain('owner@example.com');
    expect(line.length).toBeLessThan(400);
  });
});

describe('correlation ids (ERR-06)', () => {
  it('generates unique ids and reuses an attached id', () => {
    expect(newCorrelationId()).not.toBe(newCorrelationId());
    const err = new Error('x');
    const id = withCorrelationId(err);
    expect(withCorrelationId(err)).toBe(id); // reuse on same object
  });

  it('normalizeError attaches a correlation id and never throws', () => {
    const n = normalizeError(new Error('boom'));
    expect(n.correlationId).toMatch(/^oz-/);
    expect(n.kind).toBe('unknown');
    const weird = normalizeError(undefined);
    expect(weird.rawMessage).toBeTruthy();
  });
});

describe('emitIpcError / onIpcError', () => {
  it('notifies subscribers with command + normalized error', () => {
    const listener = vi.fn();
    const unsubscribe = onIpcError(listener);
    const err = { kind: 'permissionDenied', message: 'owner only' };
    emitIpcError('delete_staff', err);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]!.command).toBe('delete_staff');
    expect(listener.mock.calls[0]![0]!.error.kind).toBe('permissionDenied');
    unsubscribe();
    emitIpcError('delete_staff', err);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing subscriber', () => {
    const bad = vi.fn(() => {
      throw new Error('subscriber bug');
    });
    onIpcError(bad);
    expect(() => emitIpcError('x', new Error('y'))).not.toThrow();
  });
});
