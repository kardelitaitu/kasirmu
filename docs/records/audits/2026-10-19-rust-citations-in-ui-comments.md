# Rust line cites in UI comments: a 26-cite sample, 11 repaired — 2026-10-19

**Scope:** `path/to.rs:NNN` citations inside `ui/src/features/**` comments. The UI citation guard
(`featureCommentPaths.test.ts`) structurally cannot reach these — it resolves same-file and same-directory
`name.tsx:NNN` only — so nothing grades them and every gate stays green while they rot.

**Measured:** 316 `.rs:NNN` tokens across `ui/src` (94 in `features/`, the rest in `__tests__/`, `api/`,
`dev-mock/`). This pass audited every citation in `sales/`, `tables/`, `retail/`, `settings/`,
`kds/`, `warehouse/`, `inventory/`, `audit/`, `auth/`, `locations/`, `shifts/` and the two sales
widget/model files — 26 distinct targets read against the Rust source.

| verdict | count |
|---|---|
| CORRECT | 13 |
| DRIFTED | 7 |
| NOT_FOUND | 2 |
| **repaired** | **11** |

## What actually rots, and what does not

The split is not random. **Citations that name a function or a file survive; citations that name a bare
line number do not.** Every DRIFTED/NOT_FOUND row was a number, and every one had a correct claim
underneath — nothing in this sample was FALSE-CLAIM. Three distinct rot mechanisms showed up:

1. **The file grew under a fixed number.** `apps/desktop-tauri/src/lib.rs:1261,1267,1269` was cited for
   `activate_license` / `get_machine_id` / `get_hardware_fingerprint`. Those three numbers now land on
   `BUS.subscribe("sale.completed")` event wiring; the real registrations are 1728/1737/1739. The same
   wrong triple was **duplicated verbatim into a test file**, so a one-file fix would have left the copy.
2. **The body was extracted to another crate.** `commands/topology/revisions.rs` is now a re-export shim —
   `TOPOLOGY_CHANGE_NOTE_MAX_CHARS` lives in `crates/kasirmu-bridge/src/topology/revisions.rs`.
   Likewise `commands/settings.rs:1054` is a **362-line file**, so the cite was past EOF; the claim
   (a `HashMap<String, String>` parameter) is true at `set_settings_scoped`'s `entries` parameter.
3. **The number was never right.** `rbac_presets.rs:46` was cited for the Owner preset's `["*"]` — line 46
   is doc text about a foreign key; the wildcard is at line 75. `rbac_presets.rs:75` was then cited for
   "a key the Manager preset carries" — 75 is the Owner wildcard, and `STAFF_UPDATE` is at 104. Two cites,
   each landing on the other's subject.

## The repair rule

**Anchor by symbol.** Each of the 11 was rewritten to name a `fn`, a constant, or an expression, never a
re-measured number. Two of the repairs (`AuditLogScreen.rs:285-305` / `:306-310`) simply dropped the range
and named the preset block, because the range had never been right and a fresh number would rot the same way.

## A mistake I made three times, and what fixed it

Three of the repairs above briefly left a **duplicated comment block** — the same symptom recorded in
`2026-10-19-ui-comment-citation-sweep.md`. The cause was identical each time: `splice(idx, N, ...repl)`
with an `N` counted by eye against the wrong baseline, so the replacement either under-ate (leaving the
old tail) or over-ate (taking a code line with it). Twice it silently removed real code —
`const canMarkReviewed` / `const canExportAudit` in `AuditLogScreen.tsx`.

`tsc` caught neither: the file still parsed. What caught them was **reading the block back and diffing
against HEAD**:

    git diff --ignore-cr-at-eol -U0 -- <file>

If the diff is not exactly the comment lines I meant to touch, the edit is wrong. That check is now part of
the procedure for any multi-line comment replacement, and it is the reason the final commits show
`15 insertions, 14 deletions` rather than a block rewrite.

## What is still open

- **~68 feature-file `.rs` cites remain unaudited**, plus `ui/src/__tests__/` (the largest single cluster,
  `writtenSettingHasReader.test.ts` with 17), `ui/src/api/` and `ui/src/dev-mock/`. The same four-batch
  read-only subagent pattern applies.
- `ui/src/features/sales/PaymentModal.tsx` still holds two drifted cites the audit found
  (`pos/checkout.rs:424-428`, `sales_checkout.rs:549`). They were **not** committed: that file's working
  tree also carries another lane's uncommitted `pay_later` work, and a pathspec commit would sweep it in.

## Verification

Guard 4/4, census `21 total, 21 in range, 0 to review`. `tsc --noEmit` clean in every touched file,
`eslint` 0 errors, and the affected suites ran green: AuditLog 43, Topology+Shift 90, Settings+KDS 48,
LicenseActivation+SalesHistory+useMultiCurrency+guard 74.
