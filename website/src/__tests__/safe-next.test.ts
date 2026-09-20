// ── safe-next tests ────────────────────────────────────────────────
//
// Every CROSS-origin shape below was measured against the browser URL parser
// before the fix, and two of them passed the old guard: the leading-slash +
// backslash form and the leading-slash + tab form.
//
// ADR #54 §2.4 depends on this too: the OAuth callback returns through a
// `next`-style parameter, so the guard has to be an origin check, not a prefix.

import { describe, expect, it } from 'vitest';
import { sameOriginPath } from '../lib/safe-next';

const BASE = 'https://kasir.mu';
const FALLBACK = '/en/account';

const resolve = (raw: string | null) => sameOriginPath(raw, FALLBACK, BASE);

describe('sameOriginPath', () => {
  it('accepts a same-origin path and preserves its query and hash', () => {
    expect(resolve('/en/pricing')).toBe('/en/pricing');
    expect(resolve('/en/account?theme=dark')).toBe('/en/account?theme=dark');
    expect(resolve('/en/account#tab')).toBe('/en/account#tab');
  });

  it('rejects the protocol-relative form the old guard already caught', () => {
    expect(resolve('//evil.com')).toBe(FALLBACK);
  });

  it('rejects the backslash form that bypassed the old guard', () => {
    // '/\\evil.com' passes startsWith('/') and fails startsWith('//'), so the
    // old guard returned it verbatim — and the parser turns it into //evil.com.
    expect(resolve('/\\evil.com')).toBe(FALLBACK);
    expect(resolve('/\\evil.com/path')).toBe(FALLBACK);
  });

  it('rejects the tab form that bypassed the old guard', () => {
    // The parser strips the tab, so '/\t/evil.com' also resolves to //evil.com.
    expect(resolve('/\t/evil.com')).toBe(FALLBACK);
  });

  it('rejects other cross-origin and non-path shapes', () => {
    expect(resolve('https://evil.com/x')).toBe(FALLBACK);
    expect(resolve('https://kasir.mu.evil.com/x')).toBe(FALLBACK);
    expect(resolve('javascript:alert(1)')).toBe(FALLBACK);
    expect(resolve('\\\\evil.com')).toBe(FALLBACK);
    expect(resolve('en/account')).toBe(FALLBACK);
    expect(resolve('')).toBe(FALLBACK);
    expect(resolve(null)).toBe(FALLBACK);
  });

  it('rejects the bypass shapes with NO base origin available', () => {
    // The structural layer must stand alone: a test harness or an SSR pass has
    // no window.location.origin, and the origin comparison cannot run there.
    const bare = (raw: string) => sameOriginPath(raw, FALLBACK, '');
    expect(bare('/\\evil.com')).toBe(FALLBACK);
    expect(bare('/\t/evil.com')).toBe(FALLBACK);
    expect(bare('//evil.com')).toBe(FALLBACK);
    expect(bare('/en/pricing')).toBe('/en/pricing');
    expect(bare('/en/pricing?plan=pro')).toBe('/en/pricing?plan=pro');
  });

  it('never returns the raw input when it resolved elsewhere', () => {
    const raw = '/\\evil.com';
    expect(resolve(raw)).not.toBe(raw);
  });
});
