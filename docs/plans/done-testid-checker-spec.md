# scripts/check-testid.mjs - FROZEN SPEC

Status: TODO (not implemented). Scope: `ui/src` source files only. All below is measured or ruled; implement mechanically, do not re-derive.

## 1. Contract - testable assertions

| # | Assertion |
|---|---|
| C1 | Every `data-testid` / `dataTestId` attribute value parses to 1..N string literals. |
| C2 | **R1** - every normalized literal matches `^[a-z0-9]+(-[a-z0-9]+)*$`. |
| C3 | **R2** - no FULL normalized literal is produced by >= 2 distinct source files, unless a `contracts[]` row in `scripts/testid-baseline.json`. |
| C4 | R2 keys on the FULL normalized string. Prefix keys are a bug. |
| C5 | Repeats of one literal within ONE file are legal (mutually-exclusive branches). |
| C6 | `querySelector('[data-testid="x"]')`, `querySelectorAll`, `getByTestId`, `findByTestId`, `getAllByTestId` are CONSUMERS - they produce nothing. |
| C7 | Exit 0 = clean, 1 = findings, 2 = could-not-run. |
| C8 | An EMPTY corpus (0 scanned files) exits 2, never 0. Print the resolved root. |
| C9 | Every `contracts[]` row must still be a LIVE >= 2-file collision, else ERROR (stale-entry rule). |
| C10 | Count of live collisions must be <= `max_duplicate_contracts`. |
| C11 | Cross-platform: pure `node:fs` + `node:path`. No bash, no `git ls-files`, no cwd reliance (see section 5). |

## 2. Parser algorithm - ordered

Per file: read UTF-8, scan left to right.
1. **Find the attribute:** `/(?:data-testid|dataTestId)\s*=\s*/g` - both spellings are producers (`ui/src/features/kds/KdsHamburgerPanel.tsx:496,514` uses `dataTestId=`).
2. **Skip consumers:** if the match sits inside a `querySelector`/`querySelectorAll`/`getByTestId`/`findByTestId`/`getAllByTestId` call, continue (C6). Detect via a `[` or `(` within the preceding 40 chars.
3. **Plain literal:** char after `=` is a quote -> read to the matching close quote, emit ONE literal, done.
4. **Brace expression:** char after `=` is `{` ->
   a. **Balanced-brace scan is MANDATORY**: walk forward counting `{`/`}` depth, stop at depth 0. Do NOT use `/data-testid=\{(.+)\}/` - greedy, measured to give **40 false positives** on this tree (manager-reproduced).
   b. Split the INNER text into **ALL alternatives**, not just the first: top-level ternary `?` `:` -> both branches (nested -> 3+); `||`/`&&` tail -> each string operand.
   c. Per alternative extract: Literal -> quoted text; TemplateLiteral -> quasis + `${...}` holes; `+` BinaryExpression -> left Literal + PLACEHOLDER for the right tail; anything else (bare identifier, member expr, call) -> **SKIP that alternative**.
5. **Normalize** each extracted string (below).
6. **Record** `{ normalized, file, line }`, then dedupe `(normalized, file)` pairs before R2 (C5).

**Normalization.** (1) Replace each `${...}` hole with the placeholder word `hole`. (2) Replace each `+` concat tail (non-literal right operand) with `hole`. (3) **The placeholder is APPENDED after the hyphen, never left as an empty segment**: `'security-trail-outcome-' + chip.value` -> `security-trail-outcome-hole` (NOT `security-trail-outcome-`, which fails R1 spuriously); mid-string `kds-order-card-${id}` -> `kds-order-card-hole`. (4) Lowercase nothing, strip nothing else - underscore, uppercase, double hyphen, leading/trailing hyphen are all R1 violations.

## 3. Exclusion set (scan a file only if NONE hold)

- path contains `/__tests__/`
- basename matches `*.test.ts` | `*.test.tsx` | `*.spec.ts` | `*.spec.tsx`
- path starts with `ui/e2e/`, `ui/src/dev-mock/`, or `ui/src/test-utils/`
- path == `ui/src/test-setup.ts`
- extension not in `.ts` `.tsx` `.js` `.jsx`

Live corpus: **671 source files**, **173** plain `data-testid="..."` attributes, **40** brace-expression attributes.

## 4. Baseline - `scripts/testid-baseline.json`

```json
{ "max_duplicate_contracts": 1,
  "contracts": [ { "literal": "product-grid-scroll",
                   "files": ["ui/src/features/retail/RetailPosScreen.tsx",
                             "ui/src/features/retail/RetailProductGrid.tsx"],
                   "consumer": "ui/src/features/retail/RetailPosScreen.tsx:443 querySelector - renders no node",
                   "reason": "cross-file contract: the grid owns the node, the screen measures it",
                   "since": "2026-09-19" } ],
  "_note": "Ratchet cap, not a dumping ground. Raise max_duplicate_contracts only by adding a contracts row in the SAME commit; each unit is a selector two components can fight over." }
```

- **B4.1 Stale-entry rule (C9):** a row whose `literal` is not a live >= 2-file collision, or whose `files` is not an EXACT set match against live producers, is an ERROR naming the row. Delete a producer -> red until the entry goes.
- **B4.2** R1 has NO baseline section. Kebab is absolute; no row can permit it.
- **B4.3** Missing/unparseable baseline exits 2, never 1 - absent is "cannot certify", not "clean".
- **B4.4** A third producer of an allowed literal FAILS (exact set match): rename or justify in the same commit.
- **B4.5** Baseline lives in JSON, never an in-script const (invisible drift). Precedent: `scripts/exhaustive-deps-baseline.json` (cap + `_note`) and `scripts/ipc-parity-allowlist.json` (schema in `scripts/allowlist-schema.py`, data in JSON, each row carrying a reason).

## 5. Acceptance - exact commands and outcomes

| Command | Expected |
|---|---|
| `node scripts/check-testid.mjs` | exit 0 (R1 clean; R2 = 1 live collision, covered by the one baseline row) |
| `node scripts/check-testid.mjs` after deleting the contracts row | exit 1, names `product-grid-scroll` and both files |
| `node scripts/check-testid.mjs --self-test` | exit 0, prints every section-6 fixture as input -> expected literals |
| `node scripts/check-testid.mjs`, `ui/src` unreadable or 0 files | exit 2, prints the resolved absolute root |
| `node scripts/check-testid.mjs` run from `/` and from `ui/` | identical output (root from `import.meta.url`, never `process.cwd()`) |
| `cd ui && npm run check:all` | leg 0 named `Data-testid compliance`; manifest self-audit reports no drift |

Mandatory shape: `const HERE = path.dirname(fileURLToPath(import.meta.url))`; `const REPO = path.resolve(HERE, '..')`; scan `path.join(REPO, 'ui', 'src')`. Never `process.cwd()` - `scripts/check-ui.mjs:35` chdirs to `ui/` before running legs.

### Wiring (ruled; ship in ONE commit with the script)

- `ui/package.json`: add `"testid:check": "node ../scripts/check-testid.mjs"` beside `"bundle:check"`.
- `scripts/check-ui.mjs`: insert `gate('Data-testid compliance', 'npm run testid:check');` **before** `// - 1. Lint`. SINGLE QUOTES are load-bearing: `scripts/verify-ci-docs-drift.py:522` parses `gate\('([^']+)'\)` and is blind to double quotes; matching is by substring, so the name must contain `testid`. `scripts/check-ui.mjs:213-222` fails CLOSED on a needle mismatch.
- `scripts/gates.json`: `{ "id": "data-testid-compliance", "label": "Data-testid compliance", "status": "required", "runners": { "check:all": ["testid"] }, "_note": "<non-empty>" }`. **No `ci` block yet** - `unrecorded_active_gates()` (`scripts/verify-ci-docs-drift.py:245-272`) flags `required` + no `ci` **unless** `_note`/`note` is non-empty; the `_note` must state the only runner is `check:all` and no workflow runs it yet.
- `docs/operations/ci-pipeline.md`: add a row to the Pre-Merge Validation Gates table (~:130-132) and a leg 9 to the `scripts/check-ui.mjs` list (~:262-272).

## 6. Fixture cases - input -> expected output literals

| Source | Input (trimmed) | Expected |
|---|---|---|
| `ui/src/features/audit/SecurityTrailScreen.tsx:255` | `data-testid={'security-trail-outcome-' + chip.value}` | `security-trail-outcome-hole` (1) |
| `ui/src/features/settings/sections/DiagnosticsSection.tsx:130` | `<li key={key} ... data-testid={'diagnostics-row-' + key}>` | `diagnostics-row-hole` (1) |
| `ui/src/features/kds/KdsHamburgerPanel.tsx:99` | `data-testid={dataTestId}` | SKIP (0) - bare identifier |
| `ui/src/features/kds/ExpoScreen.tsx:350` | `` data-testid={column.zone ? `kds-expo-station-${column.zone}` : 'kds-expo-station-none'} `` | `kds-expo-station-hole`, `kds-expo-station-none` (2) |
| `ui/src/features/kds/components/StationSelectorModal.tsx:82` | `` data-testid={isAll ? 'kds-station-option-all' : `kds-station-option-${zone}`} `` | `kds-station-option-all`, `kds-station-option-hole` (2) |
| `ui/src/features/kds/KdsHamburgerPanel.tsx:496` | `dataTestId="kds-settings-yellow-slider"` | `kds-settings-yellow-slider` (1) - `dataTestId` spelling |
| `ui/src/features/retail/RetailPosScreen.tsx:443` | `querySelector<HTMLElement>('[data-testid="product-grid-scroll"]')` | CONSUMER (0) |
| `ui/src/features/retail/RetailProductGrid.tsx:658,678` | two `data-testid="product-grid-scroll"` in one file | `product-grid-scroll` x1 for R2 (per-file dedupe, C5) |
| `ui/src/features/kds/components/KdsTicketCard.tsx:314` | `` data-testid={`kds-order-card-${order.display_number ?? order.id}`} `` | `kds-order-card-hole` (1) - `??` inside the hole |
| synthetic | `data-testid="Foo_Bar"` | R1 FAIL |
| synthetic | `data-testid="foo--bar"` | R1 FAIL |
| synthetic | `data-testid="foo-bar-"` | R1 FAIL |
| synthetic | two files, both `data-testid="dup-x"`, not in baseline | R2 FAIL, names both files |
| synthetic | 0 files scanned | exit 2 |
