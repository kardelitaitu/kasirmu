# Audit Closed Findings — Archive

> **Closed findings, moved out of [audit-open-findings.md](./audit-open-findings.md) on 2026-09-14.**
> A block came here only because its own text already carried a closure commit; nothing was
> reworded, softened, re-dated or re-scoped, and every sha it names is intact. Where a heading
> exceeded 75 characters it was shortened to fit the records-heading limit, the body under it
> unchanged — the open register keeps a one-line pointer per moved block naming the finding, its
> closure commit and this file. Blocks still carrying open work, and closures whose text names no
> commit, stayed in [audit-open-findings.md](./audit-open-findings.md).
> Cross-references inside these blocks (“the table above”, “the next section”) were written in the
> open register's order, and the moved blocks keep that same relative order here.

---

## CRM (`01-crm-module.md` — PARTIALLY REMEDIATED)

**Status:** CRM-01–CRM-11 ALL closed as of 2026-08-31 (CRM-06 was real and fixed same day; the rest verified fixed against current code).

Key items:
- ~~**CRM-02** — Customer listing does not enforce the view permission~~ — **VERIFIED FIXED 2026-08-31** (with one residual closed same day): `list_customers_scoped`/`search_customers_scoped` enforce `customers:view` on both clients (denial-tested). **Residual found and fixed (`7967cc2d`):** the tablet still registered the legacy unguarded `get_customer` (no session, no permission, global db — cross-store read by id); replaced with `get_customer_scoped` (gated, store-scoped, denial-tested on both clients), and the dead legacy UI wrappers were removed so no caller can reach an unregistered command.
- ~~**CRM-03** — Load failures are silently rendered as an empty customer database~~ — **VERIFIED FIXED 2026-08-31**: `loadError` state; the error view replaces the empty state when the list fails to load (`CustomerManagementScreen.tsx:465`).
- ~~**CRM-04** — Delete is immediate and delete failures are invisible~~ — **VERIFIED FIXED 2026-08-31**: `ConfirmDialog` gates deletion (CUST-02) and a localized toast surfaces delete failures (CUST-04), both tested.
- ~~**CRM-05** — "Purchase history" documented but not exposed~~ — **VERIFIED FIXED 2026-08-31**: `get_customer_history_scoped` + in-screen history view with load-failure retry (CUST-05 tested).
- ~~**CRM-06** — Sale-completion aggregation is not idempotent and does not validate currency~~ — **REAL, FIXED 2026-08-31 (`23b78594`+`841448ca`, unsubscription follow-up next commit)**: the handler WAS live — `platform/startup` subscribed `CrmHistoryHandler` to `sale.completed` in both shipping clients (an earlier grep that missed `platform/` produced a wrong "zero production writers" claim, corrected here). So the original bugs were production-real: no idempotency (event re-delivery double-counted spend) and no currency validation (foreign-currency sales added raw). The projection moved into the completion transaction (base currency, statement-level atomic increment, replay-safe via the finalize `changed==1` CAS — idempotency by construction) and `create_refund` reverses it proportionally at the sale-recorded rate (integer round-half-up, floor at zero). The handler's bus subscription is removed with it — running both writers would double-count every sale. 5 tests, Red-first.
- ~~**CRM-07** — Duplicate, incomplete ownership between CRM module and core persistence~~ — **RESOLVED 2026-08-31 by deletion + unsubscription**: the duplicate writer (`modules/crm/src/handlers.rs` + its `platform/startup` subscription) is gone; `Store` completion/refund is the single owner of the spend projection.
- ~~**CRM-08** — Indonesian locale incomplete~~ — **VERIFIED FIXED 2026-08-31**: `customers.ftl`/`customers.id.ftl` at 56/56 key parity, enforced by the i18n lint + bundle-parity pre-commit gates.
- ~~**CRM-09** — Hardcoded English fallbacks~~ — **VERIFIED FIXED 2026-08-31**: screen uses `requiredLocalized`/`getString` throughout; remaining `??` defaults are data values (empty strings, em-dash), not user-facing English.
- ~~**CRM-10** — Row action touch targets below POS minimum~~ — **VERIFIED FIXED 2026-08-31**: `.customer-mgmt-action-btn` carries `min-height/min-width: 2.75rem` (44px).
- ~~**CRM-11** — Test coverage omits failure/authorization/destructive paths~~ — **VERIFIED FIXED 2026-08-31**: 35 screen tests including delete-failure toast, load-failure retry, history retry; command-level permission denial tests on both clients (pre/post `7967cc2d`).

---

## Money — Frontend (`32-money-frontend.md` — FULLY REMEDIATED)

**Status:** FRONTEND-01/02/03/04 all closed (04 found + fixed during the FRONTEND-03 sweep, 2026-08-30).

- **FRONTEND-01** — PaymentModal charge-amount row inflates by base exponent (P1, FIXED)
- **FRONTEND-02** — usePosState silently mixes currencies in the subtotal (P1, FIXED)
- ~~**FRONTEND-03** — IPC boundary drops line currency (P2, **DEFERRED to Phase 5 — open, needs backend change**)~~ — **CLOSED 2026-08-30**, commit `fc8eae22`: `AddLineArgs.unit_price_currency` (optional, wire-compatible) added on desktop + tablet; commands build the line in the wire currency so `Cart::add_line`'s (previously dead) mismatch check rejects cross-currency lines; invalid ISO codes fail closed. PaymentModal sends `line.unit_price.currency` on both sale paths. Pinned by tablet e2e (EUR line into USD cart → Err) + desktop serde-shape/helper tests + UI contract tests. Follow-up also **CLOSED 2026-08-30**, commit `4439cfa3`: `CartLineData.unit_price_currency` in `complete_sale_with_resolved_shortfalls_scoped` (both clients) — same helper pattern, same fail-closed parse; PaymentModal's shortfall-dialog mapping sends the line currency, dialog passthrough pinned by test.
- ~~**FRONTEND-04** (P2, found 2026-08-30 during the FRONTEND-03 sweep) — multi-currency charge + stock shortfall settles the second command in the WRONG currency~~ — **CLOSED 2026-08-30**, commit `0e5e8bf9`. Semantics decision: the retry must settle in the SAME currency the first command used (charge currency) — it is a retry of the same sale. Fix (UI-only; the Rust struct already accepted all five CUR-02 fields): CUR-02 tender metadata lifted into a shared `tenderSnapshot` memo used by the QRIS path, main path, and shortfall dialog; dialog now receives `lineItemsInCartCurrency` + `cartCurrency` + `effectiveTotalInCartCurrency` + `tenderedMinorInCartCurrency` and forwards tip/service/base fields into the retry args. Pinned by a multi-currency e2e (USD cart → IDR charge at 16500: retry payload currency IDR, converted line amounts, baseCurrency/baseTotalMinor/tenderRateMillionths) + single-currency tip/service pin (previously the retry recorded tip=0/service=0 even without multi-currency).

---

## Money — TDD sweep (`MONEY-01..05` — CLOSED 2026-08-31, LOYALTY-01 too)

A `/tdd` pass over the money area (foundation `money.rs` came back exemplary — deep-audited, property-tested, no change needed; the weaknesses were all in the UI conversion/input edges and one daemon cast):

- ~~**MONEY-01** — PaymentModal tender conversion mis-rounded .5 boundaries~~ — **FIXED `79247c92`**: the conversion chain (`baseMinor/10^exp × float-rate × 10^exp`) turned exact decimal halves into float values slightly below the tie — brute-forced counterexamples: 0.03 USD @ 149.5 → 448 instead of 449, 0.41 → 6129 vs 6130. Replaced by `convertMinorUnits` (BigInt, half-up toward +∞, inverse-pair aware via an `inverted` flag) + `reciprocalMillionths` for the persisted `tender_rate_millionths` (the snapshot now carries the ORIGINAL integer, not a float round-trip). 11 unit tests.
- ~~**MONEY-02** — every user-entered money field parsed with `Math.round(parseFloat(s) × 10^scale)`~~ — **FIXED `89589dae`**: "1.005" USD → 100 cents (exact: 101); parseFloat also swallowed "1e3" → 1000 and "1,500" → 1 on free-text fields. `parseMinorUnits` (strict decimal regex + BigInt scaling + half-up) migrated to all sites: tender, split amounts (×3), rate editor (scale 6), shift balances, staff pay (garbage → absent, not NaN). 12 unit tests.
- ~~**MONEY-03** — rate-sync daemon cast untrusted API floats with saturating `as i64`~~ — **FIXED `6736fb02`**: a `1e300` response became `i64::MAX`, which PASSES the repo's `>0` validation and persists. `rate_to_millionths` now rejects non-finite/non-positive/≥1e10/sub-resolution before the cast; rejected rows warn+skip. 6 unit tests.
- ~~**MONEY-04** — Rp discount tab hardcoded ×100~~ — **FIXED `46fd1ab0`**: for IDR (exponent 0) the ratio inflated 100× — Rp 2,000 off Rp 100,000 computed pct=200 → `setDiscount` clamps → **100% off, free goods**. Now scales by `minorUnitExponent(subtotal.currency)`. Red test pinned first (the tab had zero coverage).
- ~~**MONEY-05** — shift open/close balances hardcoded ×100~~ — **FIXED `46fd1ab0`**: `opening_balance_minor` is store-currency minor units; every IDR drawer count was stored 100× inflated, breaking `expected_cash` reconciliation. Now scales by `minorUnitExponent(storeSettings.currency)`. The old test PINNED the bug (100000 → 10000000); corrected.
- ~~**LOYALTY-01 (OPEN)** — `db/loyalty.rs` computed `points = ((base as f64)/100 × earn_multiplier).round() as i64` with the multiplier stored as `REAL`~~ — **CLOSED 2026-08-31**, commits `803f6239` (core) + `02b264cd` (UI): the multiplier is now **fixed-point millionths** end to end (`earn_multiplier_millionths INTEGER`, the repo's own `rate_millionths` precedent). Evidence that justified it: exhaustive scan (double vs exact-decimal, half-away) — multiplier 1.4 flipped at 585 bases ≤ 2,000,000, e.g. base=2250 (a $22.50 sale at points_per_unit=1): float 31.499999999999996 → 31 points where exact decimal gives 32, always DOWNWARD for 1.4; 1.1/1.2/1.3/1.5/1.75/2.0 never flipped in range (1.5/1.75/2.0 binary-exact; the others' error snaps back at the tie — which is why the seeded tiers 1.0/1.25/1.5/2.0 hid this for so long). The corruption was at WRITE time (UI JS number → f64 IPC → REAL column), so no compute-site patch could recover intent. Fix: migration `20260831_loyalty_multiplier_fixedpoint.sql` (drop triggers → ADD COLUMN → backfill `CAST(ROUND(old × 1e6) AS INTEGER)` → DROP COLUMN → recreate triggers; no table rebuild, the `loyalty_accounts.tier_id` FK is never disturbed), `compute_points()` exact i128 half-up toward +∞, DTO/wire rename to `earn_multiplier_millionths`, tier editor parses via `parseMinorUnits(x, 6)` and displays via `millionthsToDecimalString` (integer-only). Postgres intentionally untouched — the cloud has no loyalty code path and `init.pg.sql` is a generated artifact. 5 new Rust tests (boundary grid, extremes saturate, end-to-end $22.50→32, legacy backfill, seeded-tier exactness) + 3 UI tests (prefill "1.25", save 1_400_000, zero rejected).
- **Test hygiene fallout (CLOSED `0ffdd2c3`)** — the full-suite run surfaced 6 tests red at HEAD *before* the money batch: the scoped-IPC audit (`5e0d4caa`) and REP-06 shipped without updating RefundModal (wire object dropped `userId`; token is arg 0), VoidOrdersScreen (`voidSaleScoped` positional), a11yTransitions (StatusBar's scoped offline call), and AnalyticsScreen ×2 (category fixture missing the REP-06 row currency — `Intl.NumberFormat` currency-style throws on a missing code; CSV export predates the REP-06a currency column). The ERR-10 compliance whitelist pinned PaymentModal line numbers and drifted under MONEY-01/02 — now content-anchored with a per-entry sanity check.

---

## Refund guards — rust-auditor COR-25/COR-26 (CLOSED 2026-08-30)

- ~~**COR-25** (MEDIUM) — over-refund guard ran outside the transaction and read the cumulative refunded SUM with `.unwrap_or(0)`: a read error read as "zero refunds" and the money guard failed OPEN~~ — fixed: guard inside the tx, SUM errors propagate (`crates/oz-core/src/db/refunds.rs`, commit 8f01a5d0; regression test `over_refund_guard_fails_closed_when_cumulative_sum_unreadable`).
- ~~**COR-26** (LOW) — refund currency never compared to the sale currency~~ — fixed: `create_refund` rejects a mismatch with `CoreError::CurrencyMismatch` (commit a53feaea; regression test `create_refund_rejects_currency_mismatch`).

---

## PG integration harness — silently-skipped tests (CLOSED 2026-08-30)

`throwaway_test_pool` built DB names from UUID `Display` (hyphens) inside an
unquoted `CREATE DATABASE` identifier → server syntax error → every
throwaway-DB PG test (REST roundtrip, RLS non-owner, concurrent adjust,
sync-store) printed "skipped" and reported PASS — cloud money-path coverage
was silently zero. Fixed with `.simple()` hex names + probe connections
retargeted to the throwaway DB (commit a022b4fb). **Verified live: oz-api
198/198 and oz-cloud-server 224/224 with ZERO skips.** Residual risk: on
machines/CI without PG the skip is still quiet (PASS) by design.

---

## Dated corrections and retractions, 2026-09-13 to 2026-09-14

> Moved from [audit-open-findings.md](./audit-open-findings.md) — these `###` blocks were sections of
> that register's gate-integrity run; their parent findings, and everything still open, remain there.

---

### Dated correction (2026-09-13, 14:18) — command-line table is history

The row that said strict unknown-argument handling was "being added right now, outcome
deliberately not recorded" can be closed against measured exits: `7b4c2bc5a` and
`45e2521a3` landed it, and `python3 scripts/verify-migration-column-types.py --self-test`
and `... verify-flaky-quarantine.py --self-test` now both exit **2**, naming the flags each
script actually implements (`--staged-only`, `--report`), while both bare invocations still
exit 0. The money gate was already the argparse one (exit 2). **Three gates that answered one
command line three ways now answer it one way.** Bare-run stdout was hash-compared before and
after (`54c2e8cb…`/152 B, `6b40bfa7…`/212 B) — unchanged, so the refusal is addition and not
noise. Both rejection cases are mutation-proven load-bearing: removing the guard returns the
false green at exit 0 printing the ordinary `ok:`/`PASS:` line.

The paragraph claiming the closures were **unpinned** is also superseded, for the money gate
only: `805159081` (198/0) added a real `--self-test` with `tally: 3 green = 3 CAUGHT + 0 CLEAN
/ 0 red`. Its own stdout states why `0 CLEAN` is not a weakness — a clean-tree case reddens
under none of the three mutations, so it would have been a tautology, and the real-tree run is
that gate’s clean half outside the flag. It also records the disjunct `scanned == 0` in the
refusal guard as **unobservable** (an all-empty tree always leaves `starved` non-empty too),
and prints its own limit: **nothing calls the flag.** `scripts/gates.json` already runs
`verify-ftl-orphans.py --self-test` blocking in CI, so the wiring precedent exists; the
remaining change is one line naming this gate beside it, in `gates.json` and `dev-ci.yml` —
both outside this session’s authority, recorded here rather than done.

**Still open after this correction:** `verify-scoped-reads.py` F-2 (a copy prints
`0 production file(s) graded against … clean for desktop.` at exit 0) and
`verify-ftl-orphans.py --staged-only` (`staged_diff()` has no `check=True`, swallows git 129, measured 16:30, note, the 62 bytes are the caller's own vacuous-clean verdict, git contributes 0 bytes,
and emits a 62-byte line identical to a real run — index-bound, a different class).

---

### Dated correction (2026-09-13, 14:47) — F-2 and sibling closed

`4d103182c` (158/3, one file, `973 → 1125` lines) put a `require_allowlist_shape()` guard between
reading the parsed JSON and any `.get` on it, refusing when the object it wanted — a JSON object
keyed by the shell section, default `"desktop"`, a key name read off the live loader rather than
guessed — is absent or wrong-typed. Measured against the **committed blob** in a temp dir:
`{}` and `{"entries":[]}` — both of which previously exited **0** printing
`0 production file(s) graded … clean for desktop.` having compared nothing — now exit **1**
with a sentence naming what was wanted and what was got; `[{"a":1}]` no longer escapes as an
uncaught `AttributeError` at `allowlist_names:303`; `not json` is unchanged. Four cells, all
refuse, no tracebacks, no `clean` line. Re-verified by the director, not only by the lane:
bare exit 0 still reporting `568 production file(s) graded`, `--self-test` PASS through case 8
(the director's own count of "~40 ok lines, was 34" was a mis-prefixed grep; the `    ok` line counts measured by the lane are **34 → 39**, later **39 → 41**), `verify-agents-mirrors` exit 0.

**Still open, three of them, all named, none touched:** the identical wrong-shape hazard in
`verify-ipc-parity.py`, whose `load_allowlist()` hands raw `json.loads` output to
`payload.get(section)` at `:547 :592 :730 :765 :794` with no top-level check — and that gate is
the *writer* of the same shared file, so it can re-publish a shape nothing can read; a valid-
JSON **UTF-16** file still escaping `read_allowlist` as an uncaught `UnicodeDecodeError` **[closed 14:57 by `dd4888194` — see the next section]**
(it catches only `PermissionError` and `JSONDecodeError`, unchanged before and after this
commit); and `--shell ''`, which exits 0 printing `clean for .` because with no section named **[closed 15:18 by `4f841a673`]**
there is no key to require. The last is the same class one level further in: a refusal needs a
named section before the shape question exists.

---

### Dated correction (2026-09-13, 15:00) — UTF-16 cell closed

`dd4888194` (58/2, one file) added `AllowlistUndecodable` as a subclass of the existing
`AllowlistUnreadable` with one `except UnicodeDecodeError` arm placed *after* `JSONDecodeError`
inside the retry loop, so the guard order stayed `exists → isdir → denial-retries → decode`,
properties of the argument before properties of the read and only a denial retrying. Director-run
repro against the committed blob (`git show HEAD:` into a temp dir, a real `encoding="utf-16"`
allowlist) at 15:00 — exit **1**, stdout **1** line, `grep -c Traceback` **0**, where before the
same input produced a 19-line traceback ending `UnicodeDecodeError: … byte 0xff in position 0`.
The sentence says the gate cannot decode rather than calling the file invalid JSON, *it may be
valid JSON in an encoding this reader will not guess*, and both new cells forbid the busy
sentence, keeping the misdiagnosis class closed. Self-test PASS, ok lines **39 → 41** (cases 9
and 10); bare still exit 0 at `568 production file(s) graded` with byte-identical stdout.

Reported, not fixed — `scripts/coverage_top.py:40` opens a JSON file with no `encoding=`, so it
inherits the locale codec and takes the same uncaught error; `extract-updater-seed.py:167` and
`verify-exhaustive-deps.py:49` do name `encoding="utf-8"`, and `verify-ipc-parity.py:101` already
catches `(OSError, UnicodeDecodeError)`. Two of the three still-open items above remain as
written, the wrong-shape hazard in `verify-ipc-parity.py` and `--shell ''`, and the second is
the same class one level further in, a refusal needs a named section before a shape can be asked
of it.

---

### Dated correction (2026-09-13, 15:21) — `--shell` closed too

`4f841a673` (154/2, one file, `scripts/verify-scoped-reads.py` `1184 → 1336`) refuses a `--shell`
value that names no shell, placed where the shell list resolves rather than inside the walk,
because an empty shell list is a property of the argument and not of the read, and it refuses
rather than defaulting to every shell, since guessing what an empty argument means is how a typo
becomes evidence. Director-measured: `--shell ""` now exits **1** with one `FAIL: --shell
received ""…` line and no `clean` anywhere in the output where HEAD exited **0** printing
`clean for .` having graded nothing, self-test `    ok` lines **41 → 44**, bare still exit 0 at
`568 production file(s) graded`, `--shell desktop` exit 0 and `--shell desktop --shell tablet`
exit 1 on the pre-existing tablet violations, so neither path regressed.

---

### Dated correction (2026-09-13, 16:15) — `coverage_top.py` closed

`dfb3e10e9` (36/2, one file) names `encoding="utf-8"` at the open and refuses with one `UNREADABLE:`
line. Director-measured on the committed blob at 16:12: a real UTF-16 JSON file now exits **1** with
**0** `Traceback` where the pre-fix blob exits **1** with **1**, ending
`JSONDecodeError: Expecting value: line 1 column 1`.

**My brief was wrong about the symptom and the worker said so.** I told it the failure was an
uncaught `UnicodeDecodeError`; on this box the locale codec is **cp1252** (measured
`locale.getpreferredencoding`, Python 3.14.5), which happily *decodes* UTF-16 bytes into mojibake
that then fails to **parse**, so the real exception was `JSONDecodeError`. Under `PYTHONUTF8=1` the
same pre-fix run does raise `UnicodeDecodeError`, so my finding described only one of two platform
states. The worker kept its narrow `except UnicodeDecodeError` arm and defended it: **because the
encoding is asserted at the open, the mojibake path stops existing** — the bytes become
undecodable rather than decodable-and-wrong, so both symptoms converge on one refusal. Widening
the catch to `JSONDecodeError` would let one sentence claim "not UTF-8" about a file that *is*
UTF-8 and merely malformed, the very mislabel `dd4888194` argues against.

**Verified separately by me:** the identical input fed to the pre-fix and post-fix copies both die
later with `AttributeError: 'list' object has no attribute 'get'` — **pre-existing**, my fixture
shape, not the change; the two tracebacks differ only in the filename line. An object-shaped valid
UTF-8 file exits **0** and prints `NO MATCHES: scanned 0 files`, proving the guard does not
over-refuse.

**Reported, not fixed, output side:** a *valid UTF-8* file containing a non-ASCII path now reads
fine and dies 30 lines later on `UnicodeEncodeError: 'charmap' codec can't encode character
'\u1f8d'` — the **print** codec, not the read. No partial ranking can exit 0, but stdout does
carry a partial report. Fixing it needs an output-side decision outside the brief, so it is
recorded here. Every path in this repo's real cargo-llvm-cov exports is ASCII.

---

### Dated correction (2026-09-14, 00:16) — gate thirteen closed

`73afbf0b65` (163/8), `scripts/verify-scoped-reads.py`, verified by me at 00:15: default now prints
`27 of 27`, CI form `180 of 181` with **`FAIL: 129 unguarded`**, self-test 37 cases exit 0, mirrors 0,
allowlist `e5663346ef` in worktree and HEAD.

**The number that matters is not the coverage, it is the delta.** `FAIL: 112` → `FAIL: 129`, and the
worker proved the direction by parsing both reports into (shell, command, file:line) triples and taking
the symmetric difference: **+17, −0**. Zero removals is the proof — a quieted finding would show as a
removal, and the failure mode I briefed it to watch was exactly that, the widened pattern matching a
*call site* as a wrapper and thereby hiding it. An independent second parser confirmed 0 mispairings
across 491 new (command, wrapper) pairs and that all 412 commands the old pattern saw are kept, a
strict superset.

**So 17 unguarded ambient IPC calls existed the whole time and no tool could see them**, in
`LicenseSettings.tsx`, `AppShell.tsx`, `TopologyScreen.tsx`, `StaffManagementScreen.tsx`,
`EmailReportSettings.tsx`, `useAuthConnection.ts`. Tonight was about gates that pass over nothing; this
is the payoff case, the gate was not lying about a refusal, it was blind to real code. One correction to
my own brief, I cited `features/license/LicenseActivationScreen.tsx`; the file is
`features/auth/LicenseActivationScreen.tsx`. Line 106 matched, the dir did not.

**Two claims retired by this commit.** The researcher guessed bucket C, eleven `license.ts` names are
cloud-server commands with no Tauri wrapper; **its own reading refuted that**, they are registered at
`lib.rs:1177-1192` and cloud-facing *behind* a Tauri command. And the worker's residual 5 asserted that
`verify-ipc-parity.py`'s write-side refusals still spend exit 1 — **stale by three commits**, closed at
`8b3f52c8db`. I have now seen two lanes report a residual that a earlier lane had already fixed, which
is the cost of working a shared tree on self-report; the register is the dedupe point.

**What the sole residual is.** `rotate_encryption_key` does not resolve, and it is not a blind spot —
the command was ungated and deleted (`ui/src/api/security.ts:29-36`), so it is a stale allowlist entry.
Deliberately *not* special-cased in code, a comment names it. That leaves the informational ratio line as
the only witness, and nothing branches on it, so **the owner should drop one name from
`scripts/ipc-parity-allowlist.json`**, which is not mine to edit.

**The next idiom is the same bug.** `export default function`, a wrapper built in a loop, a re-export —
each would silently drop the ratio again and every command it loses becomes unfindable. The ratio line is
now the canary; it is informational by contract, so a human has to read line 2.

---

### Dated corrections (2026-09-14, 00:10) — gates ten to twelve

**Gate 10, `a6998faef0`** (316/4), `scripts/verify-migration-column-types.py`. Verified by me 23:57: a typo
in a bare positional root, `crates/oz-core/migratios`, went exit 0 printing a clean full scan of 59
migrations; it now exits 2 with no count line and no Traceback. Plain run byte-identical at 152 B exit 0.
The file had no `--self-test` at all; the lane added one, eight cases, and pinned a red self-test at exit
2 so a broken test cannot impersonate a float-column finding.

**Gate 11, `84425ba057`** (193/23), `scripts/scan-unwrap-panic.py`. Verified by me 00:06: `--roots crates
nope` went exit 0 reporting 96 calls as if it were the world; now exit 2, 0 stdout, 0 count-bearing
lines. A deliberate narrow scan (`--roots crates`) still exits 0 and scans, which is the distinction that
makes this usable rather than annoying. Equation intact: total 136, invariant_annotated 136, recoverable
0, tolerance 0. **The pair that ends this family:** a genuinely empty root printed
`# total: 0 production unwrap/expect calls`, and that same line printed for the empty root plus one typo,
two runs byte-indistinguishable, one honest and one starved. Now only the honest one speaks.

**Gate 12, `8b3f52c8db`** (238/25), `scripts/verify-ipc-parity.py`. Verified by me 00:09: default grade
still byte-identical at exit 1, 3379 B stdout, 628 B stderr; self-test 0 (22 cases, 102 assertions);
mirrors 0; zero scratch; allowlist `e5663346ef` in worktree and HEAD, never written, though this is the
gate that writes it. Write-path refusals (drift, busy rename, and a previously-uncought OSError arm that
escaped as a traceback, i.e. exit 1) now go to `error:` plus exit 2, while an entry-level shape finding
keeps exit 1. This closes the residual registered at `6b405857d`, including the sharpest form of it, a
lock collision wearing the verdict code.

**My premise was wrong and the fence-holder corrected it.** I briefed gate 10 against
`verify-migration-column-types.py` on the strength of a measurement saying `--roots crates nope` exited 0
there. That file never had a `--roots` flag, it died at the unknown-flag guard. The symptom I described
reproduces in `scan-unwrap-panic.py`, and that lane closed it as gate 11 rather than assuming my brief was
right. A lane that disproves its own brief in the same turn has done more than a lane that completes it.

**One thing I nearly got wrong in the other direction:** I measured 2 hits for `allowlist write problem`
in the gate-12 file where the lane reported none, suspected a stale claim, and read them, both are
past-tense docstring prose, "Until now all three came back ... printed as" and "used to print". Checking
resolved it in the lane favour. Grep counts are not findings; the lines are.

**Left open on purpose:** the new write refusal prints to stderr while the older nothing-resolves refusal
prints to stdout, because `run-pre-push` merges them, same exit 2, same no-count rule, different streams,
deliberately not churned mid-session, a one-line follow-up. And gate 10 note stands, `--self-test` is a
developer tool in both files, named by neither `gates.json` nor `dev-ci.yml`, so the new tests enforce
nothing until someone wires them.

---

### Dated retraction (2026-09-13, 23:45) — two false CI claims

A lane dispatched to *fix* one of them checked instead, and found the opposite. Both were mine, both
were stated as facts in reports to the human, and one of them became a recommendation with a cost
estimate attached.

1. **"Nothing runs `scan-unwrap-panic.py --fail-on-recoverable`, so its green is a property of a
    command nobody invokes."** **False.** It is wired at `dev-ci.yml:489`, step "Panic inventory
(ADR #33)", and `scripts/gates.json` lists `panic-inventory` with `"status": "required"` mapped to
`dev-ci.yml#static-gates`. Measured 23:41.
2. **"`scripts/gates.json` holds a stale `130 / 0` for this scanner."** **False.** `grep -c 130
    scripts/gates.json` → **0**. No `130` anywhere in the file, and the file has no expectation
    fields at all — an entry is `{id, label, status, runners, _note, ci}`. The "130/0" was a
    scanner-output pair I had detached from its source and re-attached to a file that does not
    contain it.

**The shape of the failure is worth naming, because it is not a typo.** Claim 1 is about a real line I
had *not* grepped; claim 2 was the same sentence about a different surface, built by attaching a number
I had genuinely measured once (some earlier total/expected pair) to a filename I had genuinely inspected
(its shape). Both halves real, the glue invented. It propagated into `cc0c9d277` and `6b405857d` and
then into an authorization request — the human lifted a prohibition for a fix that turned out not to
exist, which is the most expensive form of a wrong belief: it buys permission.

**What changed as a result.** The `gates.json` fix is **cancelled**, not deferred. The live CI work is
exactly one item, `5C`, and it landed as `eb5e57d452`: `continue-on-error: true` on the
"FTL orphan census (informational)" step, the blocking `--self-test` step untouched — which finally makes
the AGENTS.md promise "in CI, non-blocking" true rather than aspirational. Remaining, and correctly
withheld by that lane: repointing `:489` at the bare strict default once `scan-unwrap-panic.py` settles,
since the flag is today an inert alias.

**Standing rule, restated where it will hurt:** before asserting a file contains a value, grep the file
in the same breath as writing the sentence. Two of my four retracted numbers tonight were about
*structure* I had looked at and *values* I had not.

---

### Dated correction (2026-09-13, 22:55) — the ninth gate closed

`2fabafb78b` (252/9), `scripts/verify-scoped-reads.py` only — the residual the eighth gate named, closed
in the same fence. Verified by me at 22:52: numstat **one file**; allowlist still `e5663346ef`; default
**180 B exit 0**; CI form **20473 B exit 1** still reading `FAIL: 112 unguarded`, unmoved and unquieted;
`--self-test` exit 0; mirrors from the repository root exit 0; zero scratch.

**The acceptance test was the sentence, not the code — and that test is my own fault for existing.** In a
temp tree with `ui/src` populated and `ui/src/api` absent, I measured exit **2**, **0 stdout**, **no**
`graded` line, **no** verdict line, no Traceback, and the stderr beginning
`error: the wrapper surface this gate grades is not there:` — naming the **wrapper** arm and *not* the
corpus arm. Because at 22:02 an unexplained exit 2 was a broken allowlist path wearing the wrong guard\u0027s
face, a bare status is no longer admissible evidence in this family, and the brief said so.

**What it closes:** an absent api layer produced an empty command-to-wrapper map, so every allowlisted
command resolved to zero wrappers, zero call sites, and the gate printed `clean for desktop.` at exit 0 on
a **3-file** corpus — the eighth guard passed happily because the corpus was non-empty. Same zero, one
level deeper: the walk is not the surface.

**A platform divergence it surfaced, deliberately left alone:** `production_files()`\x27s `ui/src/api`
exclusion builds `os.path.join("ui","api")` unnormalized and compares it against a normalized root, so on
**Windows it never fires** and api files are graded as production source too (fixture counts moved 3 → 4).
The lane declined to touch it because changing it would move the 612 and the 20473 mid-audit — the right
call, but the consequence is that *the set of files this gate grades differs by operating system*. That
deserves its own change with its own before/after counts, not a ride-along.

**The residual this one cannot close, and correctly refused to invent:** `if cmd_to_wrapper:` tests
*emptiness*, not *coverage*. An api layer holding one wrapper for an unrelated command makes the map
non-empty, so a real command resolving to nothing still grades clean (the lane\x27s own case 19 is the
reproduction). Closing it needs a threshold — per shell? per name? which names must have wrappers at all?
— and that is the allowlist contract owner\x27s policy, not a number to guess. Recorded as **PARKED** below.

---

### Dated correction (2026-09-13, 22:35) — an invented number

Two of my own errors, both surfaced by a worker *measuring* rather than by me checking. Written here because
they are the kind that survive into other documents if only the fix is recorded.

**One. `14 unguarded calls` was never measured; the truth is `112`.** A lane reported "14", I repeated it,
and it then propagated into `6b405857d` and `958a56009` — into three places, all of them mine, none of them
mineasured. The worker that landed `3cf078aad` corrected itself (`grep -o 'FAIL: [0-9]* unguarded'` →
`FAIL: 112 unguarded ambient IPC call(s)`), and I reproduced **112** myself at 22:31. The byte-identity
claims were never at risk: the 20473-byte CI-form output is identical on both sides and carries 112 on both
sides. A wrong adjective on a right verdict is still wrong, and this repo has now twice seen a number
invent itself a life in prose (the `130 / 0` I cited there does not exist, see the 23:45 retraction, it was my second invented number in an hour, in `scripts/gates.json`).

**Two. My "the guard already refuses a genuinely missing root" (in `6b405857d`) was my own broken path.**
At 22:02 I built a temp tree, put the allowlist at `<root>/ipc-parity-allowlist.json`, and watched the gate
exit 2. I read that as the corpus guard. It was `read_allowlist()` failing on a path it could not find —
the gate reads `REPO/scripts/ipc-parity-allowlist.json` (line 110). The lane measured the same cell with a
*valid* allowlist and a missing `ui/`: **rc 0, 197 B, `0 production file(s) graded`, `clean for desktop.`**
The seventh gate therefore did **not** already cover the missing root; the eighth gate (`3cf078aad`) is what
covers it, and my inference had shrunk a bigger hole into a smaller one. That is the failure mode of a
reasonable-sounding exit code, and I wrote the paragraph about it in the same document two lines later.

**The rule, restated where it will be read:** an exit code identifies *that* something refused; only the
sentence it prints identifies *what*. Read the `error:` line, or reproduce the cell with the input you
actually intended, before writing that a guard exists. I have now confirmed this gate refuses a missing root
the honest way, at 22:31, allowlist present and correct, `ui/` gone: exit **2**, 0 stdout, no graded line.

---

### Dated correction (2026-09-13, 22:32) — the eighth gate closed

`3cf078aad` (211/3), `scripts/verify-scoped-reads.py` only — the residual the seventh gate left open,
closed inside the same fence. Verified by me at 22:29, and this time against **my own** baselines taken
30 minutes earlier at 22:02: bare default **180 B exit 0** and `--shell desktop,tablet` **20473 B at
exit 1** both reproduced exactly, the 1 still carrying the tree's 112 unguarded-call verdict (a
*regression* if it had moved), `--self-test` exit 0, allowlist still `e5663346ef`, zero scratch.

**The two-sided proof, run in isolation.** With a *valid* stated-empty allowlist in place, so only the
corpus could trip it: `ui/src` present and empty → exit **2**, 0 stdout, no Traceback, no verdict line,
`error: …\ui\src exists an…`; add **one** production file → exit **0** and `1 production file(s)
graded … clean for desktop.` Same guard, opposite outcomes, which is the only pair of results that
shows it discriminates rather than simply failing.

**A methodological confession worth the page.** My first attempt at that cell put the allowlist at
`<root>/ipc-parity-allowlist.json`; the gate reads `REPO/scripts/ipc-parity-allowlist.json` (line 110).
So the run exited 2 for the *wrong reason* — the allowlist guard, not the corpus guard — and the exit
code looked like success. An exit 2 that names nothing is no evidence at all; I only caught it by
reading the `error:` text instead of the status. A refusal must be identified by the sentence it
prints, not by the code it returns.

---

### Dated correction (2026-09-13, 22:05) — the seventh gate closed

`551f2a38eb` (111/29), `scripts/verify-scoped-reads.py` only — the *other* reader of the same shared
`scripts/ipc-parity-allowlist.json`, which the `e931220d9a` guard did not cover. Verified by me at
22:02 on the committed tree: numstat one file; default run **byte-identical 180 B exit 0** against a
baseline copy placed inside `scripts/`; CI form `--shell desktop,tablet` **byte-identical 20473 B at
exit 1**, that 1 being the tree's own pre-existing verdict (112 unguarded calls) which the lane
correctly did *not* silence; `--self-test` exit 0; mirrors from the repository root exit 0; allowlist
still `e5663346ef` in worktree and HEAD; zero scratch.

**The hole it closed was timing, not presence.** The old shape guard asked only for *membership*, so
`{"desktop": "abc"}` cleared it, **walked 612 production files**, and only then reported a member
problem under the verdict code — a refusal one second late and one door too far. Membership plus
`isinstance(..., list)` now refuses before the walk, and refusals moved off exit 1 (three real
verdicts spend it here) onto 2, with `error:` on stderr. Note this file's own header and three class
docstrings *declared* the old behaviour as the design, "ONE voice, `FAIL: <sentence>`, exit 1" — a
comment documenting a bug as intent is still a bug.

**A residual I shrank by testing it rather than repeating it.** The lane reported (1): a copy with
`ui/src` present but holding nothing exits **0** printing `0 production file(s) graded`. True. I
tried the stricter case, `ui/` absent entirely, and it exits **2** with **0 stdout bytes** — the
guard already refuses a genuinely missing root. So the live gap is only *present-but-empty*, which
is narrower than "nothing refuses it" and should be written down that way.

**Two residuals to carry, both real:** (2) exit 1 still means two different things in this file,
"the tree has unguarded calls" and "one of your allowlist entries is malformed", separated only by
wording; (3) the two gates now hold **near-but-not-identical schemas for one shared file** — this
one requires only the sections `--shell` names (right for a two-of-four reader), `verify-ipc-parity.py
refuses unless all four are stated lists — so a `{desktop, tablet}` file is *graded* by one and
*refused* by the other. Honest per role, but nothing outside either file polices that they keep
agreeing; the next edit to that allowlist format needs both gates open in front of whoever makes it.

---

### Dated correction (2026-09-13, 21:35) — the sixth gate closed

`e931220d9a` (253/18) + `21da42e70f` (8/0), `scripts/verify-ipc-parity.py` only, both one file. This was
the highest-blast file left because it *writes* `scripts/ipc-parity-allowlist.json`: an unreadable or
wrong-shaped read was treated as an empty allowlist, the gate printed its verdict, and `--write-*`
flags could persist that emptiness — the `{}` case wrote 1227 bytes where the probe held 2. Now a
read-site refusal (`AllowlistUnusable` → `error:` + exit **2**, the same voice as the ftl-orphans
refusals) and all three writer flags route through `write_or_refuse`, so a refusal writes nothing.

**Verified by me at 21:32, on the committed tree, sibling runs at one instant:** the default grade
is **byte-identical** before/after (exit 1, stdout 3379 B, stderr 628 B, `cmp` clean on both) so the
refusal is purely additive on the failure path; `--self-test` exit **0** "self-test: OK";
`verify-agents-mirrors.py` **from the repository root** exit **0**; and
`git hash-object scripts/ipc-parity-allowlist.json` = `e5663346ef` in the worktree **and** at HEAD —
the frozen baseline I took at 20:50 *before* briefing the worker, so the destructive case is proven
not to have touched the shared file. Zero scratch (`tmp-ipc*`/`tmp-ab*`) left in `scripts/`.

**The distinction that makes this correct, not just quiet:** "stated-empty is a claim,
defaulted-empty is this run's own invention." `{"dev_mock": []}` — key present, value a list, zero
entries — is a claim the file makes, so it grades (and `--write-allowlist` legitimately emits it on
a clean tree). An absent file, a non-object, `{}`, or a section holding a scalar is a value never
received, and `payload.get(section)` was *manufacturing* the emptiness. Told apart by
`section in payload and isinstance(..., list)`, before any walk.

**A worker fixing its own refusal is the tell worth reading.** Its first commit's decode arm called
`.strerror` on a `UnicodeDecodeError`, which has none, so the refusal itself raised AttributeError —
"a refusal that crashes is worse than one that does not", and per §3 it went in as a second one-file
commit rather than an amend, with every check re-run on the final bytes. That is the behaviour.

**Residuals the worker named, which I am escalating rather than burying.** (1)
`scripts/verify-scoped-reads.py:266` still opens the *same* shared allowlist under its own rules — my
guard is this gate only, not that path. (2) Four sections each stated `[]` is legal and grades clean,
so a truncate-the-entries-but-keep-the-keys edit still passes on `(0 allowlisted)` reporting alone.
(3) Entry-level shape findings and every *write-side* refusal still spend verdict code 1 — including
a busy-rename lock collision, the exact case the ftl file says must never leave a 1. (4)
`extract_ui_commands`/`read_dev_mock_sources` answer an unreadable source with `warn:` + `continue`,
so a hole in the walked corpus is a shorter walk, not a refusal. Each is real; (1) is the cheapest to
follow next because it is a small file that already has an `AllowlistUndecodable` precedent.

---

### Dated corrections (2026-09-13, 20:30) — fifth gate closed

**The 19:45 finding is closed by `4d1a85b15`** (20:28, `scripts/verify-ftl-orphans.py`, 186/7 — one
file). A locale file that cannot be *read* is now routed instead of crashing: `PermissionError`
appears at two handling sites, and exit **1** (which in this file means `FAIL: N orphan
problem(s)`) is no longer reachable from a failed read. Verified by me at 20:29 on the committed
tree, with the baseline blob placed *inside* `scripts/` so `ROOT` resolves to the real repo, then
deleted: `--census` **1781 B exit 0**, `--self-test` **68 B exit 0**, `--staged-only` **62 B exit 0**
— all three **byte-identical** to `HEAD^`, so the refusal is purely additive on the failure path.
**Honest limit on this entry**: the forced-`PermissionError` repro was *reported* by the worker
(a holder process keeping the file open, correct for this OS, since `chmod 000` does not deny reads
under msys/NTFS). I did not re-drive that race myself and this line does not claim I did.

**A fifth gate, same class, closed earlier: `868fe3582`** (19:59, `scripts/verify-commit-subjects.py`,
71/7). Its git helper returned `r.stdout` with no `check=` and `returncode` unread, so a rejected
revision and a genuinely empty range were the same value. Verified by me at 20:01: the old code
printed `0 commit(s) checked, 0 non-conforming subject(s)` at exit **1** over a range git had
**rejected**; the new code exits **2** with **0 stdout bytes**. Healthy-path output unchanged.

**Two verification traps found while closing these, both mine, both worth keeping.**
1. *Identical results can mean two crashes.* My first attempt ran the extracted blob from a temp
   dir, where `ROOT` (derived from `__file__`) pointed outside the repo; both old and new died on
   an unrelated `FileNotFoundError` reading `.githooks/commit-msg` and returned the *same* exit and
   byte counts. A diff that shows no change is only evidence when both sides ran the intended code.
2. *A single read of a file being written is a photograph of a transit.* At 20:14 `wc -l` returned
   493 and clean while the lane was mid-write; I concluded a 176-line rollback and told the worker
   so. Two minutes later the same file read 669, dirty. The lesson generalises the porcelain rule
   in §3 — inspect twice, and only where you are not the disturbance.

**Residuals left open deliberately.** `--range HEAD..HEAD` still prints its `0 commit(s) checked`
verdict to stdout *before* its own honest exit-1 refusal — print ordering, and reordering it would
change healthy-path output. And an unreadable `.githooks/commit-msg` is still a `FileNotFoundError`
traceback rather than a refusal: same family, different read.

---

### Dated correction (2026-09-13, 19:28) — hollow root closed

`ef2058f28` (38/1, one file) adds a `hollow_root_reason()` gate on the `LOCALES` surface. Proven by
me on the committed tree, not on the report: run from outside any repository `--census` now exits
**2** printing one `error: cannot run --census here: the required directory \`ui/src/locales\` is
missing (looked under ROOT=…); nothing was counted, so this refusal is not an orphan verdict.` line
(stderr, 0 stdout bytes, **0** occurrences of `candidates`, **0** tracebacks). Inside the real tree
`HEAD^` and `ef2058f28` censused back to back at 19:22 are **byte-identical** at 1,781 bytes, exit 0
both, `candidates` still 68.

**A caution for anyone re-verifying this entry.** The `declared`/`referenced` figures above are not
stable: they drifted 4823 → 4831 → 4871 while this finding was being closed, because other sessions
were landing `.ftl` keys mid-flight. Only `candidates` (68) and the byte count (1,781) held. A
diff-and-blame against a quoted figure from this page is therefore meaningless — compare two
*sibling* runs taken from the same tree at the same instant, never a run against a number written
in prose.

**Still open in the same file, newly confirmed rather than inherited:** at a hollow ROOT,
`--self-test` **crashes** — exit **1**, one `Traceback`, measured by me at 19:27 — where `--census`
and `--staged-only` now refuse at exit 2. This was recorded at 17:04 on a worker report and
explicitly labelled unverified; it is verified now. Same class, smaller fix: the guard already
exists in the file, `self_test()` just does not call it. Worth noting how easily this one hides —
the crash exits **1**, the same code a real self-test failure produces, so a hollow invocation
looks exactly like a genuine check that found something. The worker also reported `ui_blob()`
still reachable (a tree with bundles but no `ui/src/**/*.ts*` censuses every key as a candidate,
loud rather than clean-looking) and `load_allowlist()` still returning `{}` for an absent file.

---

### Dated correction (2026-09-13, 16:57) — staged-diff swallow closed

`cd2b55fa3` (40/6, one file) makes `verify-ftl-orphans.py` **refuse** when its staged diff cannot be
obtained. Proven both directions on the committed blob at 16:56: run from outside any repository it
exits **2** with one `error: cannot read the staged diff (\`git diff --cached -U0\`…)` line, **0**
tracebacks and **0** occurrences of the phrase `nothing staged`; inside the real repo with nothing
staged under `ui/src` it still prints `staged-only: nothing staged under ui/src; nothing to verify.`
at exit **0** — the honest empty verdict is untouched, which is the case a refusal-shaped fix
most often breaks. The voice follows the house decision from `409d09334`: `error:` on **stderr**,
exit **2**, because in this file **exit 1 already means a verdict was reached about someone
else's keys**, and a refusal must not be able to read as one. Enforcement note for the owner:
this gate is called at `.githooks/pre-commit:257` and the hook aborts on nonzero, so the refusal
now blocks a commit instead of green-lighting it.

**Class sweep, measured:** across all 50 `scripts/*.py` and all 60 tracked `.py` files, **0**
remaining text-mode `open()` feeding a `json.load` without an `encoding=`. The 9 bare-`open(` hits
are 7 `urllib.request.urlopen`, one `open(path, "rb")` PEM read, and one prose string in a doc.
`coverage_top.py` had no invokers at all — the only `git grep` hit is its own usage line at `:5`,
so no caller inherits a new exit code.

Two of the three named items remain genuinely open: the identical wrong-shape hazard in
`verify-ipc-parity.py` (`:547 :592 :730 :765 :794`), which is also the *writer* of the shared
allowlist and so can re-publish a shape nothing can read, and `scripts/coverage_top.py:40`
opening JSON with no `encoding=`. Recorded as findings, not touched.

**(later same day)** the first of those two was taken up and closed by `409d09334` (78/8, one file,
`scripts/verify-bundle-parity.py`): `--scan-dirs` with a blank value, a lone comma, or `""` all now
exit **2** with one `error:` line on stderr, **0 bytes on stdout**, and no `missing key` token in
either stream, so a CI log grep for the verdict string cannot match a refusal. Note the`""`
case was worse than reported, it did not merely scan nothing, it silently *widened* to a full
scan of 330 files, so a typo in the flag turned into a different audit than the one asked for.
Director-measured at 15:38: bare run exit 0 at 685 bytes, byte-identical to the lane's 15:26
baseline, and the six-dir CI form still `scanned 448 file(s)`. The voice question was decided by
the worker and accepted here, it refused with this gate's own `error:`/exit 2 rather than the
`FAIL:`/exit 1 of the reference gate, because in this file **exit 1 already means "a scan ran and
found missing keys"**, so a shared voice would have been a shared *lie*; consistency of format is
worthless when the code means something different on the other side. It also reported, without
being asked, that `--staged-only` with no paths prints `0 missing key(s)` and exits 0, and did NOT
change it, because that behaviour is documented in the file's own EXIT CODES and relied on by
`.githooks/pre-commit` for delete-only commits, a contract decision rather than a fence edit.
