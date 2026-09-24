/**
 * Dev-mock tier parity — the guard that keeps `mockTier.ts` honest.
 *
 * `ui/src/dev-mock/core/mockTier.ts` transcribes the Rust subscription-tier
 * table, because the browser preview cannot call Rust. A transcription is a
 * copy, and a copy drifts silently: the whole reason that module exists is that
 * the preview previously served seven hardcoded tier literals that had already
 * contradicted each other. Without this test the same rot simply moves one file
 * over.
 *
 * So this test does not restate the expected numbers — restating them would be
 * a third copy with the same problem. It PARSES the Rust source and asserts the
 * TypeScript table matches what the accessors actually return. Change the Rust,
 * and the failure names the row to change with it.
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

import {
  MOCK_TIER_CAPS,
  MOCK_TIER_KEYS,
  MOCK_TIER_MAX_PRODUCTS,
  MOCK_TIER_NAMES,
  getMockTier,
  setMockTier,
  resetMockTier,
  isMockTierKey,
  type MockTierKey,
} from '../dev-mock/core/mockTier';

const SUBSCRIPTION_RS = path.resolve(
  process.cwd(),
  '../crates/kasirmu-core/src/subscription.rs',
);

/** The Rust tier variants that carry a distinct `tier_key`, in table order. */
const RUST_VARIANTS = ['Free', 'Plus', 'Pro', 'Premium', 'Enterprise'] as const;

const rustSource = fs.readFileSync(SUBSCRIPTION_RS, 'utf8');

/**
 * Extract one accessor's `match` arms, keyed by the variant each answers for.
 *
 * TWO shapes exist in `subscription.rs` and both must be handled:
 *
 *   1. a `match self { Self::A | Self::B => <expr>, ... }` block — the quota and
 *      most boolean accessors;
 *   2. a bare `matches!(self, Self::A | Self::B)` expression with no `match` at
 *      all — `supports_regional_zones`, `supports_loyalty`, `supports_analytics`.
 *
 * Missing shape 2 was a real bug: the forward scan for `match self {` sailed
 * past those accessors into the NEXT one and silently adopted its arms, so the
 * test compared the wrong rows while still reporting a pass.
 *
 * A `Self::Free | Self::OneTime` arm is recorded under BOTH names, because that
 * is what it means.
 */
function extractArms(source: string, fnSignature: string): Map<string, string> {
  const lines = source.split('\n');
  const startIdx = lines.findIndex((l) => l.includes(fnSignature));
  if (startIdx === -1) throw new Error(`accessor not found: ${fnSignature}`);

  const arms = new Map<string, string>();
  const afterSig = lines.slice(startIdx + 1);

  // Shape 2: the body is one `matches!(self, ...)`, which Rust may wrap across
  // lines (`supports_daily_dashboard` puts `matches!(` alone and `self,` on the
  // next). So find the `matches!(` line — the `self,` may not share it — then
  // accumulate until the parens balance.
  for (let i = 0; i < afterSig.length; i += 1) {
    if (afterSig[i].trim() === '}') break;
    if (!/^\s*matches!\(/.test(afterSig[i])) continue;
    const collected = [afterSig[i].replace(/^\s*matches!\(/, '')];
    let depth = 1;
    for (const ch of collected[0]) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
    }
    while (depth > 0 && i + 1 < afterSig.length) {
      i += 1;
      collected.push(afterSig[i]);
      for (const ch of afterSig[i]) {
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
      }
    }
    const expr = `matches!(${collected.join(' ')}`.replace(/\s+/g, ' ').trim();
    for (const v of RUST_VARIANTS) arms.set(v, expr);
    return arms;
  }

  // Shape 1: a `match self { ... }` block.
  let sawMatch = false;
  for (let i = startIdx; i < lines.length; i += 1) {
    const line = lines[i];
    if (!sawMatch) {
      if (line.trim() === 'match self {') sawMatch = true;
      continue;
    }
    // The match block ends at the first line that is exactly the closing brace
    // at the match's own indent.
    if (line.trim() === '}') break;
    // `(.+)` is greedy and `\s*$` anchors the line, so a trailing comma stays
    // in the captured value; it is stripped explicitly below rather than by an
    // optional group, which the greedy capture defeats.
    const arm = /^\s*([^=]+?)\s*=>\s*(.+)\s*$/.exec(line);
    if (!arm) continue;
    const variants = [...arm[1].matchAll(/Self::(\w+)/g)].map((v) => v[1]);
    if (variants.length === 0) continue;
    // Trailing `//` comments are common on these arms (e.g. `Some(90), // 3 months`).
    // Strip them BEFORE the comma so the value parses as the Rust expression it is.
    const value = arm[2].replace(/\/\/.*$/, '').replace(/,$/, '').trim();
    for (const v of variants) arms.set(v, value);
  }
  if (arms.size === 0) throw new Error(`no arms extracted for ${fnSignature}`);
  return arms;
}

/** `Some(5)` -> 5, `None` -> null. Throws on an unrecognised shape. */
function parseOptionI64(expr: string): number | null {
  const trimmed = expr.trim().replace(/,$/, '').trim();
  if (trimmed === 'None') return null;
  const some = /^Some\(\s*([0-9_]+)\s*\)$/.exec(trimmed);
  if (some) return Number(some[1].replace(/_/g, ''));
  // `Some(5 * 365)` — the one arithmetic form in the table (Pro sales history).
  const mul = /^Some\(\s*([0-9_]+)\s*\*\s*([0-9_]+)\s*\)$/.exec(trimmed);
  if (mul) return Number(mul[1].replace(/_/g, '')) * Number(mul[2].replace(/_/g, ''));
  throw new Error(`unhandled Option<i64> expression: ${expr}`);
}

/** `true`/`false`, or `matches!(self, Self::A | Self::B)` resolved for `variant`. */
function parseBool(expr: string, variant: string): boolean {
  const trimmed = expr.trim().replace(/,$/, '').trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  // Accepts both `matches!(self, Self::A | Self::B)` and the rebuilt form without
  // the `self,` prefix (`matches!( Self::Enterprise)`), since the shape-2 branch
  // captures from just after the comma.
  const norm = trimmed.replace(/\s+/g, ' ');
  const matches = /^matches!\(\s*(?:self\s*,\s*)?([^)]+)\)$/.exec(norm);
  if (matches) {
    const set = [...matches[1].matchAll(/Self::(\w+)/g)].map((v) => v[1]);
    return set.includes(variant);
  }
  throw new Error(`unhandled bool expression: ${expr}`);
}

/** Read an arm for a variant, failing with the accessor name when it is absent. */
function armFor(arms: Map<string, string>, variant: string, signature: string): string {
  const raw = arms.get(variant);
  if (raw === undefined) throw new Error(`no arm for ${variant} in ${signature}`);
  return raw;
}

describe('dev-mock tier table matches the Rust subscription tiers', () => {
  it('declares one row per Rust variant that has a distinct tier_key', () => {
    expect([...MOCK_TIER_KEYS]).toEqual(['free', 'plus', 'pro', 'premium', 'enterprise']);
    // OneTime is intentionally absent: Rust reports it as `free`.
    expect(RUST_VARIANTS.length).toBe(MOCK_TIER_KEYS.length);
  });

  it('names each tier as SubscriptionTier::name() does', () => {
    const sig = 'pub fn name(&self)';
    const arms = extractArms(rustSource, sig);
    for (let i = 0; i < RUST_VARIANTS.length; i += 1) {
      const literal = /^"([^"]+)"$/.exec(armFor(arms, RUST_VARIANTS[i], sig))?.[1];
      expect(literal, `name() arm for ${RUST_VARIANTS[i]}`).toBeDefined();
      expect(MOCK_TIER_NAMES[MOCK_TIER_KEYS[i]]).toBe(literal);
    }
  });

  it('matches every Option<i64> quota accessor', () => {
    const accessors: Array<[string, (t: MockTierKey) => number | null, string]> = [
      ['pub fn max_locations(&self)', (t) => MOCK_TIER_CAPS[t].maxLocations, 'maxLocations'],
      ['pub fn max_pos_instances(&self)', (t) => MOCK_TIER_CAPS[t].maxPosInstances, 'maxPosInstances'],
      ['pub fn max_warehouses(&self)', (t) => MOCK_TIER_CAPS[t].maxWarehouses, 'maxWarehouses'],
      ['pub fn max_kds_screens(&self)', (t) => MOCK_TIER_CAPS[t].maxKdsScreens, 'maxKdsScreens'],
      ['pub fn max_staff_users(&self)', (t) => MOCK_TIER_CAPS[t].maxStaffUsers, 'maxStaffUsers'],
      ['pub fn sales_history_days(&self)', (t) => MOCK_TIER_CAPS[t].salesHistoryDays, 'salesHistoryDays'],
      ['pub fn audit_retention_days(&self)', (t) => MOCK_TIER_CAPS[t].auditRetentionDays, 'auditRetentionDays'],
    ];

    for (const [sig, read, field] of accessors) {
      const arms = extractArms(rustSource, sig);
      for (let i = 0; i < RUST_VARIANTS.length; i += 1) {
        const tier = MOCK_TIER_KEYS[i];
        expect(read(tier), `${tier}.${field} disagrees with ${sig}`).toBe(
          parseOptionI64(armFor(arms, RUST_VARIANTS[i], sig)),
        );
      }
    }
  });

  it('matches every bool feature accessor', () => {
    const accessors: Array<[string, (t: MockTierKey) => boolean]> = [
      ['pub fn supports_cloud_sync(&self)', (t) => MOCK_TIER_CAPS[t].supportsCloudSync],
      ['pub fn supports_qris(&self)', (t) => MOCK_TIER_CAPS[t].supportsQris],
      ['pub fn supports_stripe(&self)', (t) => MOCK_TIER_CAPS[t].supportsStripe],
      ['pub fn supports_lua_engine(&self)', (t) => MOCK_TIER_CAPS[t].supportsLuaEngine],
      ['pub fn supports_regional_zones(&self)', (t) => MOCK_TIER_CAPS[t].supportsRegionalZones],
      ['pub fn supports_loyalty(&self)', (t) => MOCK_TIER_CAPS[t].supportsLoyalty],
      ['pub fn supports_analytics(&self)', (t) => MOCK_TIER_CAPS[t].supportsAnalytics],
      ['pub fn supports_daily_dashboard(&self)', (t) => MOCK_TIER_CAPS[t].supportsDailyDashboard],
    ];

    for (const [sig, read] of accessors) {
      const arms = extractArms(rustSource, sig);
      for (let i = 0; i < RUST_VARIANTS.length; i += 1) {
        const tier = MOCK_TIER_KEYS[i];
        expect(read(tier), `${tier} disagrees with ${sig}`).toBe(
          parseBool(armFor(arms, RUST_VARIANTS[i], sig), RUST_VARIANTS[i]),
        );
      }
    }
  });

  it('matches max_products, which the caps DTO does not carry', () => {
    const sig = 'pub fn max_products(&self)';
    const arms = extractArms(rustSource, sig);
    for (let i = 0; i < RUST_VARIANTS.length; i += 1) {
      const tier = MOCK_TIER_KEYS[i];
      expect(MOCK_TIER_MAX_PRODUCTS[tier]).toBe(
        parseOptionI64(armFor(arms, RUST_VARIANTS[i], sig)),
      );
    }
  });

  it('matches offline_grace_days, which returns a bare i64', () => {
    const sig = 'pub fn offline_grace_days(&self)';
    const arms = extractArms(rustSource, sig);
    for (let i = 0; i < RUST_VARIANTS.length; i += 1) {
      const tier = MOCK_TIER_KEYS[i];
      expect(MOCK_TIER_CAPS[tier].offlineGraceDays).toBe(
        Number(armFor(arms, RUST_VARIANTS[i], sig).replace(/_/g, '')),
      );
    }
  });
});

describe('dev-mock tier resolution', () => {
  it('recognises exactly the five tier keys', () => {
    for (const key of MOCK_TIER_KEYS) expect(isMockTierKey(key)).toBe(true);
    for (const bad of ['', 'FREE', 'standard', 'one_time', 'platinum', null, undefined]) {
      expect(isMockTierKey(bad as string)).toBe(false);
    }
  });

  it('round-trips a selected tier through localStorage', () => {
    resetMockTier();
    expect(getMockTier()).toBe('premium');
    setMockTier('free');
    expect(getMockTier()).toBe('free');
    expect(window.localStorage.getItem('kasirmu-dev-tier')).toBe('free');
    resetMockTier();
    expect(getMockTier()).toBe('premium');
    expect(window.localStorage.getItem('kasirmu-dev-tier')).toBeNull();
  });

  it('lets ?tier= override the stored choice, and ignores an unknown value', () => {
    resetMockTier();
    setMockTier('enterprise');
    window.history.replaceState({}, '', '/?tier=plus');
    expect(getMockTier()).toBe('plus');
    window.history.replaceState({}, '', '/?tier=platinum');
    expect(getMockTier()).toBe('enterprise');
    window.history.replaceState({}, '', '/');
    expect(getMockTier()).toBe('enterprise');
    resetMockTier();
  });
});
