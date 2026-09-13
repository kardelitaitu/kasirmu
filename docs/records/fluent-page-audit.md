# Fluent Page Audit — Full Journal

<!-- Path currency note, added 08-09-26: paths in this journal are as-of each dated entry. Two that recur are not live pointers. `ui/locales/` appears six times as a FINDING — an orphan directory that held no bundle; the real locale path has always been `ui/src/locales/`, and the finding was that the stray dir existed. `scripts/tmp-split-spec.ps1` was a throwaway helper and has been deleted. Read either as history, not as a file to open. -->

> **Provenance.** This is the working journal of the 2026-09-03 Fluent/i18n
> page audit: an inventory of every registered page in `ui/src`, followed by
> twelve phases of remediation, each landed as its own commit. It was kept in
> a temp directory during the work and moved here afterwards; the entries are
> reproduced as written, including the corrections, so the reasoning behind
> each commit stays auditable.
>
> **Commits, in order:** `fe0f553d` `2df83a38` `87d25587` `12a54a68`
> `c4195b04` `67029af9` `9c16592b` `994c1448` `ef94ff29` `d5c2a19c`
> `2c000db1` `4efa59d4`, then `7ff75b5c` `8ed8194b` restoring CI enforcement.
>
> **Headline finding:** the bundle-parity gate was not guarding what it
> claimed. It walked only literal `<Localized id>` under
> `ui/src/features/**`, and `lint-i18n.sh` ran it with `--report-only` while
> discarding the exit code — so 14 keys shipped broken while CI reported
> `0 missing key(s)`. It now checks six surfaces across all of `ui/src`,
> fail-closed, in the pre-commit hook **and** in CI.
>
> **A claim later retracted:** the audit initially reported the gate as
> enforced "in both the hook and CI" on the strength of a sentence in
> `AGENTS.md`. That sentence was stale — `23c96330` had retired `ci.yml`
> without replacing its `i18n quality gate` step. `7ff75b5c` restored it.
> The lesson is recorded below and worth repeating: **read the workflow, not
> the prose about the workflow.**

---
# Fluent Localization Audit — Working Journal

Objective: execute the full audit plan (parity-gate extension + waves W1–W6 + hygiene),
one commit per phase, carefully.

Workspace: `C:/dev/ozpos/0.0.35/oz-pos` · branch `0.0.35` · version lock `0.0.35`
Artifacts: this directory (`scan_fluent.py`, `rollup.py`, `fluent_scan.json`,
`hardcoded_hits.tsv`, `page_health.tsv`).

---

## Baseline (captured at start of Round 1)

- HEAD: `60d7a3d6 feat(admin): recent revenue events feed (#5)`
- `core.hooksPath` is **NOT set** → the six pre-commit gates are inactive in this
  checkout. Consequence: every phase must run the relevant gate scripts manually;
  I will not silently enable hooksPath.
- `scripts/lint-i18n.sh` hung >15 min when run directly (vitest stage). Its two
  fail-closed checks were reproduced manually instead:
  - byte-identical `.id.ftl` sibling → **0**
  - duplicate keys in a joined bundle → **0**

### Pre-existing dirty tree — NOT produced by this audit

25 modified files, nothing staged. Two unrelated in-flight changes:

1. **Version stamp sweep `0.0.34` → `0.0.35`** across `Cargo.toml`, `CHANGELOG.md`,
   `README.md`, both `tauri.conf.json`, `ui/package.json`, `website/*`, and
   `LicenseActivationScreen.tsx:31`, `StaffLoginScreen.tsx:595`,
   `TooltipPreview.tsx:440`.
2. **Workspace-home staff-empty copy** — `shared.ftl` / `shared.id.ftl` add
   `workspace-home-staff-empty{,-desc}`; `WorkspaceHome.tsx` + its test consume them.

**Handling rule adopted for every phase commit:** never `git add -A`. Stage only my
own hunks with `git apply --cached <patch>` so the in-flight work stays unstaged in
the working tree. Files where this matters: `ui/src/locales/shared.ftl`,
`ui/src/locales/shared.id.ftl`, `ui/src/features/auth/StaffLoginScreen.tsx`,
`ui/src/features/auth/LicenseActivationScreen.tsx`,
`ui/src/features/design/TooltipPreview.tsx`.

---

## Findings ledger

| ID | Severity | Finding | Status |
|---|---|---|---|
| F1 | 🔴 S1 | 11 `getString()` keys exist in no bundle (invisible validation errors, 3 unnamed icon buttons) | open |
| F2 | 🔴 S1 | 3 `registerNavItem` `i18nKey`s missing → English sidebar labels in `id` mode | open |
| F3 | 🟠 S2 | ~66 hardcoded copy sites outside the dev-only `design` showcase | open |
| F4 | 🟠 S2 | 20 `getString(…) ?? 'English'` fallbacks breach the `requiredLocalized` rule | open |
| S3 | 🟡 | Parity gate blind spots: no `getString`, no `i18nKey`, only `features/**`, 98+23 dynamic sites | open |
| S4 | ⚪ | 79 dead id-only keys · orphan `ui/locales/` · 225 identical en/id values | open |

---

## Phase log

| Phase | Scope | Commit | Verification |
|---|---|---|---|
| P0 | Journal + baseline capture | — (temp only) | ✅ |
| P1 | Extend `verify-bundle-parity.py`: `getString` + `i18nKey` + extra dirs | ✅ `fe0f553d` | rev-1 contract intact; census finds exactly 14 |
| P2 | W2 — fix F1 (11 keys) + F2 (3 nav keys) | ✅ `2df83a38` | census 14 → 0; dedupe clean |
| P3 | W1 — shared chrome + contexts | ✅ `87d25587` | typecheck 0; full suite 7744 pass |
| P4 | Promote parity to fail-closed census gate | ✅ `12a54a68` | lint-i18n exit 0; negative control exits 1 |
| P5 | W3 — hardcoded clusters (kds first) | pending | — |
| P6 | W3 — table-header clusters (shifts, audit, offline) | pending | — |
| P7 | F4 — the 20 `?? 'English'` fallbacks | pending | — |
| P8 | W4 — dynamic key sites (sales, retail, settings, stores) | pending | — |
| P9 | W5 — confirm the clean routes | pending | — |
| P10 | W6 — gate screens | pending | — |
| P11 | S4 hygiene (dead id-only keys, orphan `ui/locales/`, lazy translations) | pending | — |

### P1 — extend the parity gate ✅ `fe0f553d`

`ci(i18n): extend bundle-parity gate to getString, requiredLocalized and nav keys`
— 1 file changed (`scripts/verify-bundle-parity.py`), committed with
`git commit --only -- <path>` so the concurrent worker's dirty files stayed out.

Added opt-in surfaces (`--include-getstring`, `--include-nav-keys`,
`--scan-dirs`, `--full-census`), per-surface attribution of misses, and comment
blanking (block + whole-line `//`, offsets preserved).

Verification:
- default mode → `0 missing key(s)`, exit 0 (rev-1 contract intact)
- `--staged-only <feature file> <locale file>` → warns+skips the out-of-scope
  locale file, exit 0 (pre-commit hook contract intact)
- `--full-census --report-only` → **exactly the 14 audited keys, 0 false positives**
- untracked `<Localized>` count 101 → 94 (comment noise removed)
- `dedupe-ftl.py --dry-run` → clean

### ⚠️ Concurrent writer active in this checkout

Discovered mid-P1: `ui/src/locales/shared.ftl` mtime moved from before my
baseline read to `06:54:43`, adding `workspace-home-staff-empty{,-desc}` and
bumping `statusbar-version` to v0.0.35 — en key count went 4290 → 4292 under me.
Files touched in the last 30 min include `crates/oz-api/src/{spec,lib}.rs`,
`apps/license-server/*`, `website/public/admin/*`, `scripts/tmp-split-spec.ps1`.

**This is not my work.** Consequences adopted as standing rules:
1. Never `git add -A` / never bare `git commit`. Always `git commit --only -- <paths>`.
2. Re-read every file immediately before editing it; never trust a cached line number.
3. Avoid editing files that carry someone else's unstaged hunks where an
   equivalent location exists (e.g. put a new key in the domain `.ftl` rather than
   in the actively-edited `shared.ftl`).
4. Re-run the census after each phase, not just before.

### Hook state correction

`core.hooksPath = .githooks` IS set in `.git/config` (it was unset at my first
check — the concurrent worker enabled it at some point during this session).
So the six pre-commit gates DO run. P1 passed them; `lint-i18n.sh` completed
quickly this time, so the earlier >15 min hang was a cold vitest start, not a
permanent blocker. Gates are therefore a real safety net for the remaining phases.

---

## Log

### P0 — baseline
Captured HEAD, dirty tree, hook state, and the two fail-closed i18n checks manually.
No repo files modified.

### P2 — restore the 14 phantom keys ✅ `2df83a38`

`fix(i18n): add the 14 Fluent keys that resolved to nothing` — 8 locale files,
43 insertions, all six pre-commit gates passed.

**Correction to Report 1:** `product-mgmt-field-name-required` is NOT a validation
message. `ProductManagementScreen.tsx:553-554` is
`<label htmlFor="product-field-name">{l10n.getString(...)}</label>` and its sibling
is `product-mgmt-field-sku-required = SKU *`. The defect was an **input with no
visible label**, so the value added is `Name *` / `Nama *`, not a sentence.
Report 1's wording for this key was wrong.

Placement followed the file owning each family (`shared.ftl` for auth-*/nav-*,
`terminals.ftl`, `purchasing.ftl`, `products.ftl`); keys named verbatim as the
call sites reference them. Values follow existing tone and reuse Indonesian terms
already on those screens (Kartu Hadiah, Stok Opname, Rekayasa Menu, Pengikatan).

Verified: `--full-census` 14 → **0 missing**; rev-1 default 0; dedupe clean;
en 4292→4306, id 4371→4385, still 0 en keys lacking an id twin.

### P3 — shared chrome + contexts

| File | Fix |
|---|---|
| `frontend/shared/ContextMenu.tsx` | `aria-label="Context menu"` + literal `Copy`/`Paste` → `requiredLocalized(l10n, 'ctx-menu-{aria,copy,paste}')`. Used by 14 surfaces. |
| `frontend/shell/AppLayout.tsx:140` | `getString('a11y-skip-to-content') ?? 'Skip to main content'` → `requiredLocalized(...)`. Key already existed; the `??` duplicated English in source. |
| `contexts/WorkspaceContext.tsx:207` | `setError("Failed to load workspaces from server.")` → `requiredLocalized(l10n, 'workspace-home-error-desc')`, reusing an existing bilingual key instead of adding a near-duplicate. |
| `locales/shared{,.id}.ftl` | +3 `ctx-menu-*` keys |

**Deliberately not changed:** `AppLayout.tsx:214` / `TabletAppLayout.tsx:130`
`getString(item.i18nKey ?? item.label) ?? item.label`. The trailing `?? item.label`
is a last-resort net over a data value, not hardcoded JSX copy, and after P2 every
registered `i18nKey` resolves. Removing a working fallback for a lint bucket would
be a regression dressed as a fix.

**Test fallout:** adding `useLocalization()` to `ContextMenu` and `WorkspaceProvider`
broke 31 tests — both were mounted with no `LocalizationProvider`, and
`useLocalization` throws. Fixed by wrapping with the project's existing `withFluent`
helper rather than by adding an optional-l10n branch: a component that needs copy
should declare that it needs copy.
- `__tests__/ContextMenu.test.tsx` — shadowed `render` with a `withFluent` wrapper so
  all 7 call sites stay unchanged.
- `__tests__/WorkspaceContext.test.tsx` — `wrapper` returns `withFluent(...)`.

Verified so far: `npm run typecheck` exit 0; eslint on the 3 changed source files →
0 errors, 3 warnings all pre-existing; census 0 missing; dedupe clean. Full
`vitest run` in flight (job pwsh-116).

**P3 CLOSED ✅ `87d25587`** — 5 files, 39 insertions, gates passed. Full suite came
back 409/410 files, 7744 passed / 18 skipped / **1 failed**: `WorkspaceContext.test.tsx:487`
asserted the old hardcoded string. Updated to the resolved `workspace-home-error-desc`
text. Re-ran the 10 affected files: 163/163 pass.

### ⚠️ The concurrent writer swept my work into their commit

`f93879b7 fix(workspaces): remove KDS entry from home-screen Tools section`
committed `ui/src/locales/shared.ftl` + `shared.id.ftl` — including my
uncommitted `ctx-menu-*` keys — alongside its own `WorkspaceHome.tsx` change.
Nothing lost (keys verified in HEAD, both locales), but P3's locale half shipped
under someone else's message.

**Tightened rule from P4:** edit a locale file and commit it in the same command
invocation, so the window for another `git commit -a` to absorb it is seconds,
not minutes.

### 🔍 Proof of the S3 blind spot, straight from the hook
Committing P3 printed:
```
warning: --staged-only path outside .../ui/src/features, skipping: ui/src/frontend/shared/ContextMenu.tsx
warning: --staged-only path outside .../ui/src/features, skipping: ui/src/contexts/WorkspaceContext.tsx
... (all 5 files)
verify-bundle-parity: --staged-only received 5 path(s) but none are eligible
```
The gate meant to protect shared chrome verifies **none of it**. P4 closes this by
wiring the rev-2 surfaces into `.githooks/pre-commit`.



### P4 — promote the parity gate ✅ `12a54a68`

`ci(i18n): promote bundle-parity to a fail-closed census gate` — 2 files
(`.githooks/pre-commit`, `scripts/lint-i18n.sh`), 46 insertions.

`lint-i18n.sh` moved from informational to fail-closed following its own
documented promotion procedure, and now runs `--full-census`. The hook passes
`--include-getstring --include-nav-keys --scan-dirs
features,components,frontend,contexts,hooks,platform`.

Verified: `lint-i18n.sh` exit 0; hook-equivalent on the two P3 chrome files
now checks them instead of skipping; **negative control** — a synthetic
`getString('zzz-does-not-exist-key')` produced `1 missing key(s)` and exit 1
with surface attribution, then the probe file was deleted and confirmed gone
from `git status`.

### 🧯 Environment gotcha that cost a 10-minute timeout

`bash` on PATH here resolves to `C:\Windows\System32\bash.exe` (WSL launcher),
which hangs indefinitely — even `bash -n <file>` never returns. Git's hooks use
Git's own bundled interpreter, so the gates work fine inside a commit. To run
`scripts/*.sh` by hand, use `& 'C:\Program Files\Git\bin\bash.exe' scripts/...`.
Two pre-existing hung `system32\bash.exe` processes (started 9/2 20:45 and 9/3
04:09) predate this session and were left alone.

### P5 — KDS settings panel ✅ `c4195b04`

`fix(i18n): localize the KDS settings panel's 23 hardcoded strings` — 3 files,
61 insertions / 22 deletions.

Worst production file in the audit, now at zero:
- 11 `getString('k') ?? 'English'` → `requiredLocalized(l10n, 'k')`
- 10 hardcoded `aria-label`/`title` on glyph-only buttons (Dark theme, Light
  theme, Zoom out/in, Reset zoom to 100%, Reset to 100%, Fewer/More columns,
  Reset columns to auto, Reset to auto)
- 2 bare `<h3>Display</h3>` / `<h3>Behaviour</h3>` → wrapped in `<Localized>`
- 1 visible `'Auto'` column value
- 14 new keys in `kds.ftl` + `kds.id.ftl`

**Latent a11y bug found while fixing:** the colour pickers built their accessible
name from the raw key — ``aria-label={`${labelId} colour picker`}`` — so a screen
reader announced "kds-settings-color-dinein colour picker". Now composed through
`kds-color-picker-aria` with a `{ $name }` placeable, keeping word order
translatable.

**New tooling:** `apply_i18n_patch.py` — applies a declared set of replacements
where every rule must match its stated occurrence count exactly and every
`expect_absent` check must hold afterwards, or the whole file aborts unwritten.
22 rules + 19 absence checks for this patch. It now writes LF explicitly (the
first run left a stat-cache ` M` that `git update-index --refresh` cleared).

Verified: kds hardcoded 23 → 0; repo total 233 → 205 (138 of those are the
dev-only `design` showcase); `--full-census` 0 missing; typecheck exit 0; eslint
clean; all 10 KDS test files pass (175 tests). The promoted hook fired on this
commit and scanned 43 key sites across 5 surfaces — the exact check that used to
skip everything outside `features/`.

## Round 1 summary

5 commits, one per phase, all six pre-commit gates green on each:

| Phase | Commit | Result |
|---|---|---|
| P1 gate extension | `fe0f553d` | census sees getString / requiredLocalized / i18nKey / SECTION_LABELS / 6 dirs |
| P2 phantom keys | `2df83a38` | 14 broken keys restored; census 14 → 0 |
| P3 shared chrome | `87d25587` | ContextMenu + AppLayout + WorkspaceContext; full suite 7744 pass |
| P4 gate promotion | `12a54a68` | parity now fail-closed repo-wide; negative control exits 1 |
| P5 KDS panel | `c4195b04` | 23 → 0 hardcoded sites in the worst file |

Remaining: P6 table headers (shifts 9, audit 6, offline 6), P7 the 9 leftover
`?? 'English'` fallbacks, P8 dynamic key sites (98 + 23), P9 confirm clean routes,
P10 gate screens, P11 hygiene.

Open risk to raise with the user: a second agent is committing in this same
checkout and already absorbed my `shared.ftl` edits into its `f93879b7`.

### P6 — loading-skeleton table headers ✅ `67029af9`

`fix(i18n): localize the loading-skeleton table headers on three screens` —
21 insertions / 21 deletions, 3 files.

**This phase changed the diagnosis of its own findings.** The scanner flagged
21 hardcoded `<th>` cells in ShiftManagementScreen, OfflineQueueScreen and
AuditLogScreen as "hardcoded copy". Read in context, every one sits inside a
loading skeleton whose `<table>` carries `aria-hidden="true"`, and the real
table below it is already fully localized (`shift-table-*`, `offline-queue-*`,
`audit-log-col-*`). So it was never missing copy — it was an **English flash**
for a few hundred milliseconds before data lands.

Fix reuses the 21 keys the live tables already resolve (each verified present in
BOTH bundles), so no new copy was authored and no skeleton/table drift is
possible. Lesson recorded: a scanner count is a work queue, not a verdict.

### P7 — scattered copy ✅ `9c16592b`

`fix(i18n): localize 16 scattered hardcoded strings across 10 screens` —
21 files, 37 insertions / 20 deletions.

10 of 16 sites reused existing bilingual keys (`toggle`, `close-aria`,
`shared-loading`, `topology-template-load`, `topology-template-delete`,
`pos-hold-cancel`, `sc-type-full/cyclic/spot`); only 7 new keys authored.

The 6 `sr-only` "Toggle" spans are the most important of the batch: they are
announced by screen readers but never seen, so they are invisible to any visual
review of the app.

**Two tooling lessons, both fixed:**
1. Wrapping `<span className="sr-only">Toggle</span>` in `<Localized>` broke
   `jsx-a11y/label-has-associated-control` — the rule cannot see text through a
   component child. Reverted to `{requiredLocalized(l10n, 'toggle')}` inside the
   span. eslint earned its place in the loop here; typecheck passed the broken form.
2. `apply_i18n_patch.py` was **not atomic across targets**: one bad
   `expect_absent` assertion (checking for a string that legitimately survives as
   a `<Localized>` fallback child — the same trap the audit itself fell into in
   round 1) aborted the run *after* 17 targets had already been written, silently
   skipping the last 3. Rewritten as validate-all-then-write. The 3 skipped
   targets were caught by re-reading `git status`, not by the script.

**Deferred deliberately:** `StaffLoginScreen.tsx` still carries another worker's
uncommitted `v0.0.34 → v0.0.35` line at 595, and my `title` edit lands at 598 —
inside the same 3-line-context hunk. Patching it now would absorb their change
under my message. Its key (`staff-login-last-login-title`) is committed and
waiting; the code edit moves to P8.

**Classified decorative, not fixed:** DailyTotalWidget's `aria-hidden`
locked-tier preview (4), SettingsPage's hidden form-submit shim + Ctrl/S kbd
hints (3), WarehouseFnBar `F12`, the "OZ-POS" brand marks, "Pro" tier badges,
and the `e.g. 50000` / `pcs / kg / box` / `A-01` input examples.

### Round 2 status

| Phase | Commit | Delta |
|---|---|---|
| P6 | `67029af9` | 21 skeleton headers localized by key reuse |
| P7 | `9c16592b` | 16 scattered sites; 45 → 29 non-design hits |

Cumulative non-design hardcoded hits: **95 → 29** (and 13 of the 29 are the
decorative list above, so ~16 remain, mostly the 6 dynamic `?? 'English'`
fallbacks plus placeholders).

Remaining: P8 (StaffLoginScreen + the 6 template-literal `?? 'English'`
fallbacks), P9 (98 `<Localized id={expr}>` + 23 `getString(\`…\`)` sites — the
only class no static gate can close), P10 (gate screens), P11 (hygiene: 79 dead
id-only keys, orphan `ui/locales/`, 225 identical en/id values).

### P8 — dynamic-key sites: one real bug, one dead fallback ✅ `994c1448`

`fix(i18n): repair the PO-Receive label and retire a dead fallback` — 6 files,
185 insertions / 7 deletions (3 new files).

This was the first phase that could not be done with the parity gate, because
the whole class is template-built ids the gate cannot resolve. So the method
changed: **enumerate the value domain from the type definition, then check every
resulting id against both real bundles.**

**🐛 Real user-visible bug found: PO-Receive.**
`ShiftBar.tsx:223` and `TransactionLogScreen.tsx:242` built
`` `inv-log-type-${tx.type}` ``. For type `purchase-order-receive` that is
`inv-log-type-purchase-order-receive` — a key present in **neither** bundle.
Both sites fell through to `tx.type.replace('-',' ')` and displayed the English
slug **"purchase order receive"** in English *and* Indonesian, while the filter
dropdown 60 lines above the table cell (`TransactionLogScreen:176`) names
`inv-log-type-po-receive` literally and correctly shows **"PO Diterima"**. Two
widgets on one screen showing two different labels for one value.

Fix: `INVENTORY_TRANSACTION_TYPE_KEYS`, a `Record<InventoryTransaction['type'],
string>`. TypeScript rejects the map if the union gains a member, and
`transactionTypeLabel.test.ts` resolves all seven ids through `getBundle()` —
the **real** production bundles, not the hand-written key-map mocks the audit
flagged as a weakness in the per-screen tests. Unknown types still humanize, so
a newer backend can never surface a raw message id.

**Dead code behind a stale comment: SetupWizard.** The line chained
`getString(\`setup-feature-${f.key}-label\`) ?? requiredLocalized(plain key)`,
justified by a comment claiming "the id bundle has only 12 of 27". Verified
against the component's own 27 feature keys: **both bundles now have all 27.**
Simplified to one call; `setupWizardFeatureLabels.test.ts` enumerates ids from
the raw `.ftl` source so a feature added without its translation fails.

**Left alone deliberately (3 of 6):** `stock-transfers-status-${status} ??
statusLabel(status)`, `inv-log-type-* ?? humanized slug` (now via the map), and
`pos-promotions-applied || names` — all documented nets over *data* values, the
same class as the `?? item.label` kept in P3.

**Two self-corrections during this phase:**
1. `FluentBundle` has no public `format()` — typecheck caught it; the repo
   idiom is `formatPattern(getMessage(k)!.value!, null)`.
2. My first regression assertion ("no id equals `inv-log-type-${type}`") was
   itself wrong: for six of seven types the derived id *is* the key. Replaced
   with a targeted assertion on the one irregular mapping.
3. `git commit --only` **cannot take untracked files** — the first P8 attempt
   exited 1 with three pathspec errors. New files need an explicit `git add`
   of those paths first. (The other worker's `c152bd22` landed in between.)

Gate evidence: the commit hook reported **0 dynamic `getString()` sites** in the
scanned files, down from 4 — the dynamic-key class is measurably shrinking.

### Round 2 (continued) status

| Phase | Commit | Result |
|---|---|---|
| P6 | `67029af9` | 21 skeleton headers, by key reuse |
| P7 | `9c16592b` | 16 scattered sites; 10 reused keys, 7 new |
| P8 | `994c1448` | PO-Receive bug fixed + dead fallback retired |

Non-design hardcoded hits: **95 → 29**, of which 13 are classified decorative.
Remaining real work: P9 (98 `<Localized id={expr}>` programmatic sites — the
technique from P8 generalizes: enumerate domain, assert against real bundles),
P10 (gate screens), P11 (hygiene), plus the still-deferred `StaffLoginScreen`
title whose file carries another worker's uncommitted version line.

### P9 — dynamic id families ✅ `ef94ff29`

`test(i18n): pin the dynamic Fluent id families the parity gate cannot see` —
2 files, 144 insertions.

New method, because the gate is blind here by construction: find each family's
**domain source of truth**, enumerate it, assert every resulting id resolves to
non-empty, non-self text in BOTH bundles. 12 bounded families, 86 ids — all
clean. `GRANULARITIES` is now exported so the test reads the real array rather
than restating it.

**A false positive I produced and corrected.** First pass enumerated the
`Granularity` *type union* (which admits `'daily'`) and reported
`analytics-granularity-daily` missing from both bundles. It is not missing — it
is **unreachable**: the selector renders the `GRANULARITIES` array (4 entries,
no `daily`) and `useState` seeds `'weekly'`. `'daily'` exists only for
`rangeForGranularity()` and the query cache, which never touch Fluent. The
lesson is now a comment on the exported array: adding `'daily'` to it without
the key WOULD ship a blank button label, and the test is the guard.

Four families are deliberately NOT asserted — `gift-cards-status-`,
`gift-cards-txn-`, `sales-report-category-`, `topology-purpose-` — their ids
come from server strings or DB category names, so no enumeration proves
coverage. I first wrote an `expect(true).toBe(true)` placeholder for them and
deleted it: a fake assertion inflates the count without protecting anything.

### P10 — gate screens + a third dynamic class ✅ `d5c2a19c`

`audit(i18n): gate object-literal Fluent ids and repair the setup toggle label`
— 5 files, 36 insertions.

**New scanner, new class.** `call_strings.py` looks for user-facing English in
*JS call arguments* — `addToast({message})`, `setError`, `confirm()`,
object-literal labels — which the JSX-text/attribute scanner structurally
cannot see. 216 candidates.

**213 verified benign, not waved away:**
- `register.tsx` `label:` values are the designed fallback beside `i18nKey`
  (which the gate now checks).
- SetupWizard `PRESETS`/`STEP_FEATURES` and AnalyticsScreen `ANALYTICS_CARDS`
  `title:`/`description:` fields are `<Localized>` fallback children;
  `StepFeatures` localizes its `title` prop via
  `requiredLocalized(l10n, \`setup-features-section-${sectionId}\`)`.
- Rest are placeholders and examples.

**Third dynamic class, and the largest by count.** An id can sit in a plain
object field and resolve through a variable:
`{ titleKey: 'analytics-card-revenue' }` … `getString(card.titleKey)`. The
`<Localized>` walker needs call syntax, `GETSTRING_ID_PATTERN` needs a literal
inside the call, and here they are 1200 lines apart. `--include-key-fields`
(now part of `--full-census` and the hook) matches
titleKey/descKey/labelId/nameKey/ariaKey/placeholderKey: **97 sites in 6
files**, all resolving today — a clean result, but now a *checked* one.
Negative control fires: synthetic bogus `titleKey` → reported as
`(key-field literal)`, exit 1.

**One real violation:** SetupWizard built `aria-label={`Toggle ${f.label}`}` —
English "Toggle" concatenated with the **unlocalized** array entry. Indonesian
users read "Alihkan Pelacakan Stok" on screen and heard "Toggle Inventory
Tracking". Now `setup-feature-toggle-aria` with a `{ $name }` placeable fed by
the already-localized `label`.

Gate state after P10: **6 surfaces, 4185 key sites, 3439 unique keys, 0
missing.**

### Round 3 status

| Phase | Commit | Result |
|---|---|---|
| P9 | `ef94ff29` | 12 bounded dynamic families pinned (86 ids) |
| P10 | `d5c2a19c` | key-field surface (97 sites) + aria-label repair |

Also corrected mid-phase: my first read of SetupWizard:603 as a direct render
(line 602 wraps it), and a `call_strings.py` bug that would have written its
TSV into the repo root — caught before running.

Remaining: **P11 hygiene** (79 dead id-only keys, orphan `ui/locales/`, 225
identical en/id values) and the still-deferred `StaffLoginScreen` title, whose
file has carried another worker's uncommitted version line since P7.

### P11 — hygiene ✅ `2c000db1`

`chore(i18n): co-locate split locale pairs, drop the stray bundle, gate locality`
— 7 files, 67 insertions / 54 deletions.

**16 split en/id pairs.** `sales-report-*`: English in `reports.ftl`,
Indonesian in `sales.id.ftl`. Both resolve at runtime because all 25 files are
concatenated per locale — so the parity gate was green while the layout lied.
Moved into `reports.id.ftl`, proven **semantic-neutral** by snapshotting the
full key→value map of all 25 id bundles before and after: 4407 keys, 0 added,
0 removed, 0 changed.

**Stray `ui/locales/` deleted.** Not a blind delete: `orphan_check.py` refuses
to bless any stray file whose keys are not a strict subset of the canonical
bundle, and it **correctly refused the first time** — 3 keys looked unique.
Reading them showed they are junk: `receipt-preview-barcode-visual` and
`receipt-preview-qr-visual` are CSS class names (`ReceiptPreview.tsx:161,174`
uses them as `className`), never Fluent message ids. Zero code references
across `ui/src`, `apps`, `crates`, `e2e`, `scripts`. `docs/guides/ROADMAP.md`
had flagged them as "a code-cleanup concern" since 2026-08-31; the note now
records the resolution.

**New gate surface `--check-domain-pairs`**, wired into `--full-census` and the
hook. Negative control is the instructive part: injecting a split pair reported
`reports.ftl + sales.id.ftl -> sales-report-apply` and exited 1 **while still
printing "0 missing key(s)"** — the exact signature of a defect the old gate
structurally could not see.

Left alone deliberately: **78 id-only keys** with no English twin anywhere
(sales 22, staff 20, inventory 14, shared 8, customers 7, settings 4, reports 2,
products 1). Unreachable in English, unreferenced by any statically-checkable
site — dead weight, not a defect, and deleting translations is a translator's
call. `crossings.py` reports the number each run so it cannot grow unnoticed.

### P12 — the deferred StaffLoginScreen site ✅ `4efa59d4`

`fix(i18n): localize the staff login footer's last-login line` — 3 files.

**A second violation my scanner had missed on the same two lines.** Reading the
file to fix the `title` attribute revealed `Last login: {lastLogin}` as JSX
text — missed because the node is *text-then-expression*, not text alone, so it
never matched the JSX-text pattern. A scanner's silence is not a clean bill of
health.

**The pre-commit gate rejected my own commit.** The explanatory comment I had
just written in `staff.ftl` contained a brace-delimited word, and
`barePlaceholderScan.ts` correctly reads that as a bare `{}` placeholder in the
bundle. My prose was the defect. Reworded; `i18nBundle.test.tsx` 20/20 after.

**Concurrency worked around without stealing attribution.** Their
`v0.0.34 → v0.0.35` line at 595 sat inside the same 3-line context hunk as my
edit at 598. `git commit --only` takes working-tree content, so it would have
absorbed their change. Hunk surgery via `git apply --cached --unidiff-zero`
failed (zero-context disallows the offset from an added line). What worked:
write the file as HEAD + my edits only, commit that, then restore their line
from a saved snapshot. Verified after the fact — the worktree diff is **only**
their version line, and HEAD contains only mine.

Three self-inflicted errors during this phase, all caught before commit: a
global `rstrip()` that modified an unrelated whitespace-only line at 575; a
PowerShell quoting failure that silently skipped a rewrite (the following diff
revealed it); and the `{value}` comment above.

## FINAL STATE

| Metric | Baseline (P0) | Final |
|---|---|---|
| Parity gate surfaces | 1 (`<Localized>` in `features/` only) | **6**, all of `ui/src` |
| Gate enforcement | informational (`--report-only`) | **fail-closed** + negative controls |
| Missing keys (census) | 14 | **0** |
| Split en/id pairs | 16 | **0** (now gated) |
| Non-design hardcoded sites | 95 | **21** — all classified benign |
| PO-Receive label | English slug in both locales | **fixed** |
| KDS colour-picker a11y name | raw key id | **fixed** |
| Setup toggle a11y name | `Toggle ` + unlocalized label | **fixed** |
| Stray `ui/locales/` | present | **deleted** |
| Dynamic families pinned by tests | 0 | **12 bounded families, 86 ids** |
| Test files | 410 (1 failing) | **413, all passing** |

The 21 remaining are: brand marks (OZ-POS ×2), `aria-hidden` locked-tier
preview (4), hidden form-submit shim + `Ctrl`/`S`/`F12` key hints (4), `Pro`
tier badge, input examples (`e.g. 50000`, `pcs / kg / box` ×2, `A-01` ×2), and
5 documented last-resort nets over **data** values (`?? item.label` ×2,
`?? statusLabel()`, `?? humanized slug`, `|| promotion names`).

12 commits, one per phase, all six pre-commit gates green on each. Nothing
pushed.

---

## Follow-up rounds (post-audit)

The audit's closing report claimed the gate was fail-closed "in both the hook
and CI". That was derived from a sentence in `AGENTS.md` without reading the
workflow, and it was wrong. Three follow-up items were agreed from the wreckage.

### F1 — CI restoration and the docs that lied (`7ff75b5c`, `8ed8194b`)

`23c96330` ("backup full workflows to .bak and introduce streamlined Quick Dev
CI") retired `ci.yml`, which held the `i18n quality gate` step, and `dev-ci.yml`
never replaced it. So twelve commits of gate work were enforced only for
developers who ran `setup-dev.ps1` and did not pass `--no-verify` — and
`core.hooksPath` is local config, not versioned, meaning **a fresh clone had no
i18n gate at all**.

Added an `i18n` job to `dev-ci.yml` and wired it into `northflank-deploy`'s
`needs`. This is a deliberate trade, not an obvious win: a locale typo can now
hold a backend deploy. A non-blocking job would have been decoration.

Then discovered the repo already had a mechanism for exactly this class of
drift, and it was red: `scripts/gates.json` is the single source of truth for
gate vocabulary, `verify-ci-docs-drift.py` derives a docs check from it, and
`gates.json` still pointed `i18n-lint` at the dead `ci.yml`. The drift gate
**exits 1 with 78 items and runs only in `check.sh` and two `.bak` workflows** —
which is precisely how `AGENTS.md` came to advertise a CI job that did not
exist. Repointing `i18n-lint` and `ftl-dedupe` took it 79 → 78; the other 78 are
other gates' dead references and were left as I18N-05.

Docs corrected where they had drifted: gate-3 scope, the "~1–3s total" claim
(`lint-i18n.sh` alone measures 4.1s), `lint-i18n.sh`'s header citing
`ci.yml`/`release.yml`, `AGENTS.md`'s "mirrors the entire CI matrix" pointer, and
a comment in `i18nBundle.test.tsx` that still told readers the `[i18n]` warning
gate was "loud, not blocking".

### F2 — Rescued artifacts (`026d4ff6`)

This journal moved out of `%TEMP%` and into the repo. Four throwaway scripts
promoted to `scripts/`, each rewritten script-relative because
`scan_fluent.py` had a hardcoded checkout path — the exact thing `AGENTS.md`
forbids. Two bugs found during promotion, both mine, both instructive:

* The rewrite made `ROOT` and `OUT` both read `argv[1]`, so passing an output
  directory caused the scanner to scan *that directory* and report **0 source
  files**. A silent false-clean, the same shape as the original defect.
* `OUT` defaulted to cwd and dropped two files into the repo root.

Caught by running the promoted tools from a subdirectory, not by reading them.

### F3 — The 98 dynamic sites (`92999384`, `30311341`, `fd6bc85c`, `3697f784`)

Rather than hand-enumerate, surveyed the shapes first. Most were literals in
disguise. Three surfaces added, taking the gate from 1 to **eight** and the
census from 4188 to 4434 checked key sites:

| surface | ids recovered | what it catches |
|---|---|---|
| `--include-dynamic-literals` | 82 | ternaries like `id={closing ? 'a' : 'b'}` |
| `--include-id-maps` | 67 | `id={ACTION_FLUENT_IDS[key] ?? fallback}` |
| widened `KEY_FIELD_ID_PATTERN` | +179 sites | `labelKey`, `messageId`, `fluentKey`, … |

Real defects found:

* **`pos-close-shift-confirm`, `pos-close-shift-closing`,
  `pos-open-shift-opening`** existed in `sales.id.ftl` but never in `sales.ftl`.
* **All four `restaurant-sort-*` ids were missing from both bundles.** The
  buttons looked fine in English because each has a hardcoded fallback child, so
  the only symptom was Indonesian users reading English sort labels in an
  otherwise-localised menu.

Things that went wrong and were caught:

* The ternary extractor flagged `restaurant-pos` — a workspace-type
  discriminator in the *condition*, not an id. Comparison and `case` operands
  are now blanked in place, preserving offsets for line attribution.
* A regex assumed `day-*` used `mon`/`tue` abbreviations and reported seven
  phantom gaps; the real domain is full weekday names, abbreviated at the call
  site by `charAt`/`slice`. The second phantom,
  `restaurant-sort-restaurant-menu-hamburger-aria`, came from the same
  "nearby literals" heuristic. Both discarded in favour of reading the source.
* The id-map checker's `` backreference pointed at the double-quote
  *alternative* group instead of the opening quote, so every single-quoted value
  failed to match and it reported **"0 id-map(s) inspected"** — a clean result
  produced by an extractor that matched nothing. The most dangerous kind of
  green. Caught because an empty result looked wrong, not because anything
  failed.

**A broad `return '<kebab-case>'` surface was measured and rejected.** 27 such
literals exist; 21 resolve as ids and 6 must not — `status-pending`,
`status-synced` and `status-failed` are CSS class names returned by
`statusClass()` two functions above `statusLabel()`, and `branch-location` is a
topology port key. Adding the rule would have manufactured junk translations to
satisfy a lint bucket. Same reasoning excludes `portId`/`fromPortId`/`toPortId`
and `sectionId` from the key-field list.

`DAY_KEYS` and `SORT_MODES` are now exported so the test enumerates the live
domain instead of a copy, and `SortMode` is derived from `SORT_MODES` so a fifth
sort mode cannot be added without the test failing. Cost: 2 more
`react-refresh/only-export-components` warnings (65 → 67, eslint still exits 0),
matching the pre-existing `AnalyticsScreen` precedent set for the same reason.

### F4 — The orphan direction, and a scanner that saw too much (`a410ea9f`)

F3 closed the *missing* direction for dynamic families. The unused direction — a key sitting in a
bundle with nothing reading it — still had no gate, and it turned out to be populated:
`topology-shortcuts-*` is 18 keys whose only appearances are test fixtures enumerating expected
bundle contents, plus a comment in `popoverSurfaceCompliance.test.tsx:54` recording that the
shortcuts feature was *removed*. The copy outlived the feature by an unknown number of commits.
`warehouse-*` is ~23 keys with zero matches anywhere in the repository.

**Sized before designing, which is the only reason the gate is usable.** A naive name-grep reports
296 candidates. Resolving intra-bundle references — all 25 domain files concatenate per locale, so
a key may be consumed from a different file than the one declaring it — and template composition
brings it to 93, of which an unknown fraction are detection gaps rather than debt. A blocker
needing a 93-entry allowlist nobody has read is a backlog wearing a gate's clothes. So
`verify-ftl-orphans.py --staged-only` asks only what a commit can answer: a key you *add* must be
referenced, and a reference you *delete* must not strand a key. `--census` reports the tree
informationally.

**Two bugs, found by measuring rather than trusting.** The prefix rescue was silently dead: the
capture class includes `-`, so `` `analytics-month-${m}` `` yielded `'analytics-month-'` and the
test `startswith(p + "-")` looked for `'analytics-month--'` and matched nothing — inflating the
census from ~50 to 295. An earlier, *looser* prototype had got this right by accident; tightening
the comparison made it wrong. And the self-test passed anyway, because it asserted only that prefix
detection *found something*, not that a prefix actually *rescues a key*. **A self-test that checks
a detector runs, rather than that it concludes correctly, is worth nothing** — same family as the
"0 id-map(s) inspected" result above.

**Then the standing lesson happened to me directly.** Chasing a related question I measured 75 keys
present only in `.id.ftl` and absent from every English bundle, of which 6 appeared to be referenced
from production — `done`, `export`, `download`, `pos-cart-title`, `inventory-report-title`,
`inventory-report-sku`. That is a live English-locale defect, since Fluent has no cross-locale
fallback and a missing message renders the key name. **All six were false positives from a scanner
that saw too much:** `kind="download"` is a status prop, `className="pos-cart-title"` is a CSS
class, `step: 'done'` is a state-machine enum. A string that happens to equal a key name is not a
key reference. Re-running restricted to actual resolution sites — `getString`, `<Localized id>`,
`i18nKey`, `labelKey`/`descKey` and the rest of the conventions `verify-bundle-parity.py` already
encodes — returned **zero**. The 75 are dead translations, not a bug.

**What the false alarm nearly established, but did not.** It pointed at a possible gap: 75 keys
exist only in `.id.ftl` and in no English bundle, `i18nBundle.test.tsx:450` asserts only EN→ID,
and `--full-census` is *described* as failing on references resolving in **neither** locale. From
those three facts I concluded that a reference resolving in Indonesian but not English would pass
every gate and render a raw key name to an English user — and wrote it into the backlog, this file,
and the journal, in `98e5e1a5`.

**Then I tested it, and it was false.** Staging a production `l10n.getString()` call on an
Indonesian-only key makes `verify-bundle-parity.py` print `missing in en .ftl only (1 unique)` and
exit 1; same at `<Localized id>` and `i18nKey` sites. The tool checks each locale separately — its
summary wording is what misled, and I reasoned from the description instead of the behaviour. The
claim is retracted in item 61, kept there rather than deleted because the wrong inference is easy
to make.

**Two things survive the error.** The repo's design is better than the check I proposed: a key-set
symmetry rule would flag all 75 unreferenced dead translations as failures, while checking at the
*reference* flags only the ones that would actually break for a user. And the control mattered more
than the subject — `totally-absent-key-zzz` had to exit 1 before an exit 0 on the real case could
mean anything. Two probes before that were invalid, and both times the tool reported its own
emptiness honestly (`--staged-only received 0 path(s)`, "Returning 0 informational"); it was the
reading of the result, not the result, that was wrong.

**Proven to fire through the real hook, not just standalone.** Running `verify-ftl-orphans.py`
directly is not evidence that pre-commit step 10 executes — the wiring is the part that can be
silently wrong, and the hook's own typecheck step already carries a comment about "the gate nobody
noticed was missing was also the gate that never ran". Staging a key in both locale files and
attempting a real commit produced `i18n lint: no issues detected.` followed by
`FAIL: 1 orphan problem(s)` naming the key, and exit 1. The first attempt, adding it only to
English, was rejected by step 3 instead — which usefully revealed that `i18nBundle.test.tsx`
enforces two-way parity, so step 10 is reachable only once parity passes. Both probes left the tree
byte-exact and HEAD unmoved.

### Standing lesson

Every defect in this thread was found by a tool that could not see it, and every
false alarm was produced by a tool that saw too much. The fix in both cases was
the same: run the checker, then go read the source it pointed at.
