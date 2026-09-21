# ADR #57 audit — handoff note for the session mid-edit

**From:** DSH docs-auditor pass (separate session), 2026-09-22
**For:** the session currently editing `docs/decisions/2026-10-04-adr57-client-tamper-resistance.md`
(§2.4, the new `quota_effect.go` POS-quota signal) — fold these into your pass; do not hand back.
**Why this file instead of an edit:** that ADR is dirty with your uncommitted work, so a pathspec
commit of it would file your in-flight §2.4 rewrite and its untracked feature doc under my message
(`AGENTS.md` §3: *stop and say so*). I made **zero** edits to it. This note is the whole handoff.
**Line numbers are from the 1091-line revision at 3:25 AM and will shift under your edits — every
item below quotes its own anchor text, so re-locate by that, not by the number.**

---

## 1. Already fixed by your in-flight edit — do NOT redo these

- **The stale header paragraph.** The old note asserting that `grep ... returns **nothing**` and that
  "§2.4 remains honestly unbuilt" is now correctly marked *"Superseded reading, kept as history
  (2026-09-21)"* (L52-60), and you added the marker legend at L47-50. That was my finding B1.
- **§2.4's notifier attribution.** The old sentence credited `build_integrity_alerts.go` with
  *"classifies and stores"*; classification/storage is `build_integrity.go`, and your rewrite drops
  the claim entirely. That was A4.
- **§3.3's A2 row** is now *"Detected on the DEVICE axis, still unbounded on the others"*. That
  supersedes the version I had prepared.

## 2. Still live — mechanical, each one verified against the tree today

| # | Anchor (quote) | Doc says | Tree says |
|---|---|---|---|
| A1 | §1.5 row, L151: `**7 bridge call sites**` | 7 | **6**. §2.4's own note at L261 already says *"the count is 6, not 7"* — the correction never reached §1.5. Count: `products.rs:701`, `staff.rs:1094`, `locations.rs:259`, `terminals.rs:455`, `workspaces.rs:324`, `inventory.rs:127` |
| A7 | §2.4, L255: `staff.rs:1084` | :1084 | **:1094** (the same row also sits in §1.5 above) |
| A3 | §2.1, L418: `**All three pieces now ship**` | three | the table below it has **four** rows (+ `release_pins.go`) |
| A5 | §2.1, L471: `(7 of them in `build_fingerprint`)` | 7 | **13** — `build_fingerprint_tests.rs` has 13 `#[test]`, and §Q4's own verification line (L870) says *"13 passed"* for the same suite |
| A6a | §2.6, L476: ``subscription.rs:518`` | :518 | guard is at **:534**; `verify_signature` is at :517, as the next paragraph states |
| A6b | §2.6, L490: ``subscription_tests.rs:196`` | :196 | **:197** |
| B3 | §Q3 heading, L725: `DECIDED (build deferred)` | deferred | both prerequisites shipped. The section's own note 60 lines below says *"BOTH CONDITIONS NOW HOLD"* (L788). The prerequisite table at L739-742 still reads **Not built** twice |
| A2 | §Q-D implementation note, L1078-1080: `requires only that §2.4's detection **mark the tenant**` | mark the tenant | **Wrong build instruction.** §2.5 chose and built the refusal **per DEVICE**: `renew.go:111` → `deviceHasFingerprintMismatch(app, req.MachineID)`, with `MachineID` on `RenewRequest` (`renew.go:23-28`). An implementer following Q-D builds a tenant flag. (Same note cites `renew.go:76-81`; the tenant-status guard is at `:82-87`.) |

## 3. The structural repair I did not make (because §3.3 was yours to rewrite)

§3.3 now carries **four** successive residual statements: the current table, the block headed
*"What the 2026-10-05 work did and did not change in this table"* (L573) whose opening marker reads
*"SUPERSEDED 2026-09-21"* (L575) while claiming to supersede 2026-10-05 notes, and a **second**
table `| Residual | Bound — **as of 2026-09-21** |` at L622. The closing instruction *"The table is
the authority … Where they disagree about severity, this table wins"* (L644) no longer identifies
**which** table, and the chronological impossibility at L575 is the same defect one layer up.

Suggested shape, keeping every superseded block verbatim (this record's own convention):
1. One line at the top of §3.3: *the first table is CURRENT; everything after it is dated history;
   where a historical block and the table disagree, the table wins.*
2. A one-line label on each historical block naming the snapshot it describes (drop the
   "SUPERSEDED <date>" form that competes with dates inside the notes).
3. A one-line provenance note near the status block: **the record's dates are non-monotonic** because
   it was updated in place across sessions — the status block is authoritative, in-body marks
   second, dated notes third.

## 4. Open decision to record (not a doc fix — your call)

**The escalation rule exists twice, and the one that fires is the one with no tests behind it.**

- `kasirmu_core::build_fingerprint`'s `fold_build_integrity` / `BuildIntegritySignal` /
  `UNKNOWN_REPORTS_BEFORE_ESCALATION = 7` has **no non-test caller**: every occurrence is inside
  `build_fingerprint.rs` and `build_fingerprint_tests.rs`. §Q4's note at L866 already says this
  (*"no consumer yet"*) and it is still true.
- The shipped scanner implements the **same** rule independently in Go:
  `apps/license-server/build_integrity_alerts.go` — `buildIntegrityUnknownThreshold = 7` (L56) and
  `buildIntegrityUnknownWindow = 7 * 24 * time.Hour` (L49).

So the trigger is fixed in two languages and can drift silently. Either name the Rust state machine
as the specification the Go scanner mirrors and add a parity note, or delete it as dead code. I did
not touch it — it may be the intended spec. Worth one line in §Q4 while you are in the file, and it
gets *more* pressing with your third signal.

## 5. Verified true — do not spend time re-checking

- **§2.5's per-device renewal refusal is real and matches the prose**: `renew.go:111`, placed after
  auth and the tenant check (`:94-99`), reusing the generic string verbatim (`:115`), fail-open
  pinned by `build_integrity_renew_test.go:166-177` (empty id / unknown device / unknown-dev all
  answer "no refusal"; only `bad-dev` refuses).
- **§2.6's sentinel guard is real**: `subscription.rs:534` gates `BOOTSTRAP_FREE_SIGNATURE` on
  `tier_key() == "free"`; `sentinel_does_not_carry_a_paid_tier` exists (line number above).
- **The CI gap is real and still the honest caveat**: no live workflow builds the APK.

## 6. One caveat for your pass

`crates/kasirmu-hal/src/transport/apk_signature.rs` is **dirty in the working tree** while you work,
so line citations into it are moving — cite that file by symbol, not by line, as I did for
`AppShell.tsx` in the ADR #56 pass.

---

## 7. Citation sweep, added 2026-09-22 — two more majors, and every line anchor has drifted

Swept against revision `EB91922B` (**1145 lines**, mtime 03:34) — i.e. after your latest edits, so
§2's numbers above (a 1091-line revision) are also now stale. **Anchor by quoted text, not by
number.** Re-check both majors below against your current text before acting; one may already be
gone.

**Two majors beyond §2.**

1. **The §2.5 block heading is stale:** *"IMPLEMENTED 2026-10-05 — §2.2's verdict is real;
   **§2.1's client half is not**"*. §2.1's client half **is** built —
   `kasirmu-hal/src/transport/apk_signature.rs` (`apk_signing_fingerprint`), the bridge attach at
   `crates/kasirmu-bridge/src/build_integrity.rs:34` + `license.rs:528`,
   `apps/mobile-tauri/src/commands/health.rs:76` `get_build_fingerprint` registered at
   `lib.rs:620` — and both the status block and §2.1's own table say so. Same defect class as the
   `DECIDED (build deferred)` heading: a heading that negates the shipped state.
2. **A §3.3 dated-history bullet says nothing automatic happens** — *"the only AUTOMATIC bound
   remains §2.3's grace window for a paid tier"* — which the **current table 40 lines above it**
   contradicts (*"detected, recorded, emailed AND refused a renewal"*), as does
   `renew.go:111` → `deviceHasFingerprintMismatch` (`build_integrity.go:190`). The history header
   is the only thing stopping a mid-section reader from taking the pre-fix answer.

**Every `file:line` anchor in this record has drifted.** The named symbols are correct; the lines
are not. Rather than trust any of them, re-derive: two whole anchor sets moved by a constant offset.

| Cited | Actual in HEAD |
|---|---|
| `license_verification.rs` :393, :501, :544 | :417, :525, :568 |
| `license_verification.rs` :408-411, :573-582 | :432-435, :591-594 |
| `subscription.rs` :534, :572, :641, :665, :673 | :550, :588, :667, :691, :699 |
| `subscription.rs` :640-643, :942-943, :991-995, :1011, :517-527 | :666-669, :977-979, :1027-1031, :1047, :518-533 |
| `subscription_tests.rs` :1168-1175 | :1199-1207 |
| `settings/keys.rs` :263, :265, :295 | :282 (`SECRET_KEY_DENY_LIST`), :312 (`NON_EXPORTABLE_DEVICE_KEYS`); :295 is `LICENSE_TENANT_ID` |
| `attestation.rs` :205-260, :255 | :203-257, :251 |
| `AppShell.tsx` :235-240 | :253 (the "unknown is not no users" comment) |
| `admin_stats.go` :574-668, :790, :604/:635/:662, :599-603 | :581-675, :797, :611/:642/:669, :606-610 |
| `renew.go` :76-81 | :82-87 |
| `main.go` :434, :451 — cited as boot goroutines | :457, :474 — and **wrong at the recorded-against commit too** |
| ADR58 :289-293, :440-447 | ADR58 :467-471, :775 |
| internal refs (:281-282), (:340-342), (:413-415), (:344-361) | ~:308, ~:725-727, ~:859-861, ~:729-746 |
| `apps/mobile-tauri/AGENTS.md` :40-46 | the Signing section is **:176+**; :40-46 is the Gradle/JDK block |

**Two claims wrong as claims, not as anchors** (both §Q-A):

- *"Membership is checked in constant time"* — it is not: `build_fingerprint.rs:108-111` is
  `accepted.iter().any(|e| …)`, which short-circuits, and `build_integrity.go:100-104` loops the
  same way. No practical impact at four pins; wrong as written.
- The set is *"capped … **and ordered**"* — capped is true (`maxAcceptedPins = 4`,
  `release_pins.go:47`, enforced :202); **no ordering rule exists in code**.

**§3.2's "both shells" claim is half false.** Only
`apps/mobile-tauri/src/commands/registration_gate_debt.generated.rs:59` moved; the desktop ledger
has **no** entry and `scripts/ipc-parity-allowlist.json` has none either.

**Corroborated by the sweep (§5 above stands):** the classifier/verdict/fold behaviour, the 13
`build_fingerprint` tests, the **6** quota call sites, the sentinel guard and its test, the renew
guard's fail-open shape and its 6 tests, the daily scanner's three conditions and weekly cooldown,
`quota_effect.go`, the pin store and both of its tests, and the ride-along's deliberate `None`.

**Also confirmed for the ADR #58 pass:** that record cites ADR #57 §2.5's precedence table, and
ADR #57 cites ADR #58 `:440-447` for §2.7's text — which actually lives at **ADR58:775**. Both
records' cross-references need re-deriving, not just their internal ones.
