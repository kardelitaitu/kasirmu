/**
 * Published pricing matrix ↔ Rust enforcement parity.
 *
 * Two files describe the same subscription-tier table:
 *
 *  - `crates/kasirmu-core/src/subscription/tier.rs` — the accessors the app
 *    enforces (`max_warehouses()`, `allows_workspace_type()`, …);
 *  - `src/content/pricing/{en,id}.ts` `featureRows` — the matrix the site
 *    publishes, and the one a customer reads before paying.
 *
 * They drifted silently: the warehouse row published `0` on every tier below
 * Premium while `max_warehouses()` still returned a non-zero allowance, so the
 * site under-claimed a paid feature and no test noticed — each file was
 * individually consistent. A comment pointing from one to the other ("mirrors
 * subscription-tiers.md §3") is not a guard, it is a hope.
 *
 * So this test PARSES the Rust and asserts the published rows agree. It does
 * not restate the numbers: a third copy would drift the same way. Change either
 * side and the failure names the row, the tier and the accessor.
 *
 * Two things are pinned by hand, because parity alone cannot see them:
 *  - the tier where each type-gated row opens (both sides moving together is a
 *    product change, not drift) — see `admittedByRuling`;
 *  - the wording of duration rows (`sales_history_days` returns 90, the table
 *    says "3 months"), which no accessor can supply.
 *
 * Out of scope on purpose: the payment-rail rows (Dynamic QRIS publishes ✓ on
 * Free while `supports_qris()` is still false — a recorded, deliberate
 * website-first decision documented in pricing-content-invariants.test.ts) and
 * the rows no accessor answers for at all (Memo, whitelabel branding, priority
 * support, scheduled emails).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { featureRowsFor } from '../../content/pricing';
import type { FeatureRow, TierKey } from '../../content/pricing/types';

// Resolved from this file, not `process.cwd()`: the suite runs from `website/`
// under `npm run check`, but a developer may run vitest from the repo root.
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const TIER_RS = join(REPO_ROOT, 'crates', 'kasirmu-core', 'src', 'subscription', 'tier.rs');
const WORKSPACE_TYPE_RS = join(REPO_ROOT, 'crates', 'kasirmu-core', 'src', 'workspace_type.rs');

const tierRs = readFileSync(TIER_RS, 'utf-8');
const workspaceTypeRs = readFileSync(WORKSPACE_TYPE_RS, 'utf-8');

type RustVariant = 'Free' | 'OneTime' | 'Plus' | 'Pro' | 'Premium' | 'Enterprise';
type Locale = 'en' | 'id';
type Published = string | number;

const LOCALES = ['en', 'id'] as const;
const ALL_VARIANTS: readonly RustVariant[] = [
  'Free',
  'OneTime',
  'Plus',
  'Pro',
  'Premium',
  'Enterprise',
];

/** The five published columns, each paired with the Rust variant that answers for it. */
const COLUMNS: ReadonlyArray<{ rust: RustVariant; tier: TierKey }> = [
  { rust: 'Free', tier: 'free' },
  { rust: 'Plus', tier: 'plus' },
  { rust: 'Pro', tier: 'pro' },
  { rust: 'Premium', tier: 'premium' },
  { rust: 'Enterprise', tier: 'enterprise' },
];

const GATE_SIGNATURE = 'pub fn allows_workspace_type(&self, type_key: &str) -> bool';

// ─── tier.rs parsing ────────────────────────────────────────────────────

/**
 * One accessor's body: from just after its signature to the method's closing
 * brace.
 *
 * Bounding the body matters. An earlier parity test scanned forward to the NEXT
 * `match self {`, so an accessor in an unexpected shape silently adopted the
 * arms of the one below it and still reported a pass. A body that ends where the
 * method ends cannot do that.
 */
function accessorBody(source: string, signature: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.includes(signature));
  if (start === -1) throw new Error(`tier.rs has no accessor ${signature}`);
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i] === '    }') break; // the method's own closing brace
    body.push(lines[i] ?? '');
  }
  if (body.length === 0) throw new Error(`empty body for ${signature}`);
  return body.join('\n');
}

/** Net `{`/`}` count on a line, for tracking a block-bodied match arm. */
function braceDelta(line: string): number {
  let delta = 0;
  for (const ch of line) {
    if (ch === '{') delta += 1;
    if (ch === '}') delta -= 1;
  }
  return delta;
}

/** Arm text with `// …` comments and the trailing comma removed. */
function finishArm(lines: string[]): string {
  return lines
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/,\s*$/, '')
    .trim();
}

/**
 * The body of the `match self { … }` arm that answers for `variant`, or
 * `undefined` when no arm names it.
 *
 * Handles both arm shapes tier.rs uses — a single-line arm
 * (`Self::Pro => Some(2),`) and a block-bodied one
 * (`Self::Free | Self::OneTime => { matches!(…) }`), which is how
 * `allows_workspace_type` is written — so that accessor needs no second parser.
 * A variant is recorded under every name its arm lists.
 */
function matchArm(body: string, variant: RustVariant): string | undefined {
  let current: { variants: RustVariant[]; lines: string[]; depth: number } | undefined;

  for (const line of body.split('\n')) {
    const armStart = /^\s*((?:Self::\w+\s*\|\s*)*Self::\w+)\s*=>\s*(.*)$/.exec(line);
    if (armStart !== null && (current === undefined || current.depth <= 0)) {
      const variants = [...(armStart[1] ?? '').matchAll(/Self::(\w+)/g)].map(
        (match) => (match[1] ?? '') as RustVariant,
      );
      const rest = armStart[2] ?? '';
      const depth = braceDelta(rest);
      if (depth > 0) {
        current = { variants, lines: [rest], depth };
      } else {
        if (variants.includes(variant)) return finishArm([rest]);
        current = undefined;
      }
      continue;
    }
    if (current === undefined) continue;
    current.lines.push(line);
    current.depth += braceDelta(line);
    if (current.depth <= 0) {
      if (current.variants.includes(variant)) return finishArm(current.lines);
      current = undefined;
    }
  }
  return undefined;
}

const ARM_CACHE = new Map<string, Map<RustVariant, string>>();

/**
 * Every arm of an accessor, keyed by variant.
 *
 * TWO shapes exist in tier.rs and both are handled, so a new accessor in either
 * style needs no change here: a `match self { … }` block, and a bare
 * `matches!(self, …)` with no `match` at all (`supports_loyalty`,
 * `supports_analytics`, `supports_daily_dashboard`). The bare form answers
 * `false` for every variant it does not list, so it is recorded under ALL
 * variants — including OneTime, which the bare arms never spell out.
 */
function armsOf(signature: string): Map<RustVariant, string> {
  const cached = ARM_CACHE.get(signature);
  if (cached !== undefined) return cached;

  const body = accessorBody(tierRs, signature);
  const arms = new Map<RustVariant, string>();
  if (body.includes('match self {')) {
    for (const variant of ALL_VARIANTS) {
      const arm = matchArm(body, variant);
      if (arm !== undefined) arms.set(variant, arm);
    }
  } else {
    const flat = body.replace(/\s+/g, ' ').trim();
    const call = /matches!\((?:self\s*,\s*)?[^)]*\)/.exec(flat);
    if (call === null) {
      throw new Error(`${signature} is neither a match block nor a matches! call`);
    }
    for (const variant of ALL_VARIANTS) arms.set(variant, call[0]);
  }
  ARM_CACHE.set(signature, arms);
  return arms;
}

/** One variant's arm, failing loudly when the accessor does not answer for it. */
function armFor(signature: string, variant: RustVariant): string {
  const arm = armsOf(signature).get(variant);
  if (arm === undefined) {
    throw new Error(`no ${variant} arm in ${signature} — that variant must be answered for here`);
  }
  return arm;
}

/** `Some(5)` → 5, `None` → null; anything else throws. */
function parseOptionI64(expression: string): number | null {
  const trimmed = expression.trim().replace(/,$/, '').trim();
  if (trimmed === 'None') return null;
  const some = /^Some\(\s*([0-9_]+)\s*\)$/.exec(trimmed);
  if (some?.[1] !== undefined) return Number(some[1].replace(/_/g, ''));
  // `Some(5 * 365)` — the one arithmetic form in the table (Pro sales history).
  const mul = /^Some\(\s*([0-9_]+)\s*\*\s*([0-9_]+)\s*\)$/.exec(trimmed);
  if (mul?.[1] !== undefined && mul[2] !== undefined) {
    return Number(mul[1].replace(/_/g, '')) * Number(mul[2].replace(/_/g, ''));
  }
  throw new Error(`unhandled Option<i64> expression: ${expression}`);
}

/** A bare integer arm — `offline_grace_days` returns `i64`, not `Option<i64>`. */
function parseI64(expression: string): number {
  const value = Number(expression.replace(/_/g, ''));
  if (!Number.isInteger(value)) throw new Error(`unhandled i64 expression: ${expression}`);
  return value;
}

/** `true`/`false`, or a `matches!` allow-list resolved for `variant`. */
function parseBool(expression: string, variant: RustVariant): boolean {
  const trimmed = expression.trim().replace(/,$/, '').trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const call = /^matches!\(\s*(?:self\s*,\s*)?([^)]+)\)$/.exec(trimmed.replace(/\s+/g, ' '));
  if (call === null) throw new Error(`unhandled bool expression: ${expression}`);
  const listed = [...(call[1] ?? '').matchAll(/Self::(\w+)/g)].map((match) => match[1] ?? '');
  return listed.includes(variant);
}

/** `pub const WAREHOUSE: &str = "warehouse";` → `warehouse`. */
function workspaceTypeKey(constName: string): string {
  const declared = new RegExp(`pub const ${constName}: &str = "([^"]+)"`).exec(workspaceTypeRs);
  if (declared?.[1] === undefined) throw new Error(`workspace_type.rs has no ${constName}`);
  return declared[1];
}

/**
 * Whether a `allows_workspace_type` arm admits the type named by `constName`.
 *
 * Compared against the Rust const NAMES the arms are written with
 * (`WAREHOUSE`), not the wire keys they hold (`"warehouse"`) — comparing
 * against the value made every deny-list arm read as an allow, which is exactly
 * the mistake this guard exists to catch.
 *
 * The arms are an allow-list (`matches!(type_key, A | B)`), a deny-list
 * (`!matches!(type_key, WAREHOUSE)`) or `true`; all three appear, so all three
 * are resolved rather than assumed.
 */
function allowsType(arm: string, constName: string): boolean {
  const flat = arm.replace(/\s+/g, ' ').trim();
  if (flat === 'true') return true;
  if (flat === 'false') return false;
  const call = /(!?)\s*matches!\(\s*type_key\s*,\s*([^)]*)\)/.exec(flat);
  if (call === null) throw new Error(`unhandled allows_workspace_type arm: ${arm}`);
  const admitted = [...(call[2] ?? '').matchAll(/\b[A-Z][A-Z0-9_]*\b/g)].map((m) => m[0]);
  const listed = admitted.includes(constName);
  return call[1] === '!' ? !listed : listed;
}

// ─── Rubric: which published row is answered by which accessor ──────────

const UNLIMITED: Record<Locale, string> = { en: 'Unlimited', id: 'Tanpa batas' };
/** audit_retention_days' `None` is the INVERSE of "unlimited": nothing retained. */
const NO_RETENTION: Record<Locale, string> = { en: 'None', id: 'Tidak ada' };

/** A day count → the wording the table publishes; an unknown count throws. */
function dayWords(
  table: Record<number, Record<Locale, string>>,
  days: number,
  locale: Locale,
  signature: string,
): string {
  const entry = table[days];
  if (entry === undefined) {
    throw new Error(`${signature} returns ${days}; the published matrix has no wording for it`);
  }
  return entry[locale];
}

/** Duration rows translate the day count; an unknown count is not a silent skip. */
const SALES_HISTORY: Record<number, Record<Locale, string>> = {
  90: { en: '3 months', id: '3 bulan' },
  365: { en: '1 year', id: '1 tahun' },
  1825: { en: '5 years', id: '5 tahun' },
};

const AUDIT_RETENTION: Record<number, Record<Locale, string>> = {
  90: { en: '90 days', id: '90 hari' },
  180: { en: '180 days', id: '180 hari' },
  365: { en: '1 year', id: '1 tahun' },
  1095: { en: '3 years', id: '3 tahun' },
};

/** `None` reads as the word, a count reads as the number. */
function quota(value: number | null, locale: Locale): Published {
  return value === null ? UNLIMITED[locale] : value;
}

interface OptionRow {
  label: Record<Locale, string>;
  signature: string;
  format: (value: number | null, locale: Locale) => Published;
}

const OPTION_ROWS: OptionRow[] = [
  {
    label: { en: 'Locations', id: 'Lokasi' },
    signature: 'pub fn max_locations(&self)',
    format: quota,
  },
  {
    label: { en: 'Terminals (registers) per location', id: 'Terminal (register) per lokasi' },
    signature: 'pub fn max_pos_instances(&self)',
    format: quota,
  },
  {
    label: { en: 'Warehouse workspaces', id: 'Ruang kerja gudang' },
    signature: 'pub fn max_warehouses(&self)',
    format: quota,
  },
  {
    label: { en: 'Kitchen Display screens', id: 'Layar Dapur (KDS)' },
    signature: 'pub fn max_kds_screens(&self)',
    format: quota,
  },
  {
    label: { en: 'Max products/menu', id: 'Max produk/menu' },
    signature: 'pub fn max_products(&self)',
    format: quota,
  },
  {
    label: { en: 'Staff users', id: 'Staf pengguna' },
    signature: 'pub fn max_staff_users(&self)',
    format: quota,
  },
  {
    label: { en: 'Sales history', id: 'Riwayat penjualan' },
    signature: 'pub fn sales_history_days(&self)',
    format: (value, locale) =>
      value === null
        ? UNLIMITED[locale]
        : dayWords(SALES_HISTORY, value, locale, 'sales_history_days'),
  },
  {
    label: { en: 'Audit log retention', id: 'Retensi log audit' },
    signature: 'pub fn audit_retention_days(&self)',
    format: (value, locale) =>
      value === null
        ? NO_RETENTION[locale]
        : dayWords(AUDIT_RETENTION, value, locale, 'audit_retention_days'),
  },
];

const BARE_ROWS: Array<{
  label: Record<Locale, string>;
  signature: string;
  format: (value: number, locale: Locale) => Published;
}> = [
  // Enterprise's 60 days is a published value, not "unlimited" — hence a bare
  // accessor and its own row kind.
  {
    label: { en: 'Offline grace period', id: 'Masa tenggang offline' },
    signature: 'pub fn offline_grace_days(&self)',
    format: (value, locale) => `${value} ${locale === 'en' ? 'days' : 'hari'}`,
  },
];

const BOOL_ROWS: Array<{ label: Record<Locale, string>; signature: string }> = [
  { label: { en: 'Cloud sync', id: 'Sinkron cloud' }, signature: 'pub fn supports_cloud_sync(&self)' },
  {
    label: { en: 'Daily Sales Dashboard', id: 'Dasbor Penjualan Harian' },
    signature: 'pub fn supports_daily_dashboard(&self)',
  },
  {
    label: { en: 'Reports & analytics', id: 'Laporan & analitik' },
    signature: 'pub fn supports_analytics(&self)',
  },
  { label: { en: 'Loyalty program', id: 'Program loyalitas' }, signature: 'pub fn supports_loyalty(&self)' },
  { label: { en: 'Lua scripting', id: 'Skrip Lua' }, signature: 'pub fn supports_lua_engine(&self)' },
];

/**
 * Rows whose count follows the type gate, not just a quota: a tier that denies
 * the type must publish 0, and a tier that admits it publishes its cap.
 *
 * `admittedByRuling` is the hand-pinned part. Parity cannot catch both sides
 * moving together, and a row that silently opened the warehouse on Plus would
 * look perfectly consistent — so the tier each gated row opens at is stated
 * once, here. Changing it is a product decision (the owner's 2026-09-29 ruling
 * is the warehouse one), and it moves in the same commit as the ruling.
 */
const TYPE_GATED_ROWS: Array<{
  constName: string;
  label: Record<Locale, string>;
  capSignature: string;
  admittedByRuling: TierKey[];
}> = [
  {
    constName: 'WAREHOUSE',
    label: { en: 'Warehouse workspaces', id: 'Ruang kerja gudang' },
    capSignature: 'pub fn max_warehouses(&self)',
    admittedByRuling: ['premium', 'enterprise'],
  },
  {
    constName: 'KDS',
    label: { en: 'Kitchen Display screens', id: 'Layar Dapur (KDS)' },
    capSignature: 'pub fn max_kds_screens(&self)',
    admittedByRuling: ['pro', 'premium', 'enterprise'],
  },
];

/** The published row for one locale, failing when the label is gone entirely. */
function publishedRow(locale: Locale, label: string): FeatureRow {
  const row = featureRowsFor(locale).find((candidate) => candidate.label === label);
  if (row === undefined) throw new Error(`${locale} pricing matrix has no "${label}" row`);
  return row;
}

// ─── The guard ──────────────────────────────────────────────────────────

describe('published pricing matrix matches the Rust tier accessors', () => {
  it.each(LOCALES)('%s: quota rows read what the accessors return', (locale) => {
    for (const row of OPTION_ROWS) {
      const published = publishedRow(locale, row.label[locale]);
      for (const { rust, tier } of COLUMNS) {
        const expected = row.format(parseOptionI64(armFor(row.signature, rust)), locale);
        expect(
          published.values[tier],
          `${locale}: "${row.label[locale]}" ${tier} disagrees with ${row.signature}`,
        ).toBe(expected);
      }
    }
    for (const row of BARE_ROWS) {
      const published = publishedRow(locale, row.label[locale]);
      for (const { rust, tier } of COLUMNS) {
        const expected = row.format(parseI64(armFor(row.signature, rust)), locale);
        expect(
          published.values[tier],
          `${locale}: "${row.label[locale]}" ${tier} disagrees with ${row.signature}`,
        ).toBe(expected);
      }
    }
  });

  it.each(LOCALES)('%s: feature rows read what the bool accessors return', (locale) => {
    for (const row of BOOL_ROWS) {
      const published = publishedRow(locale, row.label[locale]);
      for (const { rust, tier } of COLUMNS) {
        expect(
          published.values[tier],
          `${locale}: "${row.label[locale]}" ${tier} disagrees with ${row.signature}`,
        ).toBe(parseBool(armFor(row.signature, rust), rust));
      }
    }
  });

  it('publishes zero for a type the app denies, and the cap where it admits it', () => {
    for (const gated of TYPE_GATED_ROWS) {
      const typeKey = workspaceTypeKey(gated.constName);
      const admittedTiers: TierKey[] = [];
      for (const { rust, tier } of COLUMNS) {
        const admitted = allowsType(armFor(GATE_SIGNATURE, rust), gated.constName);
        if (admitted) admittedTiers.push(tier);
        const cap = parseOptionI64(armFor(gated.capSignature, rust));
        for (const locale of LOCALES) {
          const published = publishedRow(locale, gated.label[locale]);
          expect(
            published.values[tier],
            `${locale}: "${gated.label[locale]}" ${tier} — allows_workspace_type("${typeKey}") = ${admitted}, ${gated.capSignature} = ${String(cap)}`,
          ).toBe(admitted ? quota(cap, locale) : 0);
        }
      }
      expect(
        admittedTiers,
        `${gated.constName} opens at these tiers — a move here is a product change, not a cleanup`,
      ).toEqual(gated.admittedByRuling);
    }
  });

  it('reports the deprecated OneTime variant exactly as free', () => {
    // `tier_key()` maps OneTime to "free", so the free column describes those
    // installs too: an accessor that answered OneTime differently would publish
    // a number no column could carry.
    const signatures = [
      ...OPTION_ROWS.map((row) => row.signature),
      ...BARE_ROWS.map((row) => row.signature),
      ...BOOL_ROWS.map((row) => row.signature),
      GATE_SIGNATURE,
    ];
    for (const signature of signatures) {
      expect(armFor(signature, 'OneTime'), `${signature} arm for OneTime`).toBe(
        armFor(signature, 'Free'),
      );
    }
  });
});
