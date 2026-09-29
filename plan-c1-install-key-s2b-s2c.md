# C1 S2b / S2c — per-install at-rest key: implementation plan

<!-- Plan token kept: `plan-` (AGENTS.md §7.4 — the docs-auditor exempts this name
     from check-dead-refs.py). This is a PLAN, not a record of work done. S2b-1 and
     S2b-2a have since landed (2026-09-29) and are marked below; S2b-2b and S2c have
     not. It is deliberately NOT named `done-*`. -->

**Status:** IN PROGRESS. **S2b-1 (the injection seam) IMPLEMENTED 2026-09-29** — it
changes no runtime behaviour, which is what the slice was scoped to guarantee.
**S2b-2a (the keychain half: durability + generate-once resolution) IMPLEMENTED
2026-09-29** (`f2932f6f8`). **S2b-2b (the shells' boot injection) IMPLEMENTED 2026-09-29**
(`625c47290`, `5813b9208`) — this header previously said NOT STARTED and cited a lane lease
that did not exist; see §6 S2b-2b for the retraction. **The §7 release-build clause is
RE-SCOPED (§10, option (a)) AND LANDED 2026-09-29**, so **S2c (`oz rekey`) is the only slice
still outstanding** and the only thing keeping C1's box unticked. Written 2026-09-29. The §8
questions are ANSWERED — see §8, with §8.4 superseded by §10. **S2c's ordering is RULED
2026-09-29: park the OLD key as `…-prev`, promote the NEW key, sweep, verify, then retire
`-prev` — the "park the new key" ordering this file originally carried cannot satisfy the
slice's own crash-safety gate. See §6 S2c.**
**Branch:** `0.0.40` (do not create or switch branches).
**Checklist item:** C1 (`manager-codebase-review-checklist.md`), slices S2b and S2c.
**Owner decision:** D1, **ruled** — option D (per-install key in the OS keychain,
branch-tolerant reader, re-encrypt on write).
**Precondition:** the branch-tolerant reader. **DONE** — verified this pass:
`decrypt_smtp_at_rest` (`crates/kasirmu-crypto/src/lib.rs:387-391`) now reads through
`candidate_keys`, so all six at-rest families are branch-tolerant.

---

## 1. Why this is a plan and not a patch

D1's own text says the precondition "is the whole cost". Having now measured the
code, there is a second cost the decision did not name, and it is an **architecture**
question rather than a crypto one:

> **`kasirmu-crypto` cannot reach the keychain.** `kasirmu-crypto` and
> `kasirmu-security` are **siblings**, and neither depends on the other
> (verified: neither `Cargo.toml` names the other). The keyring lives in
> `kasirmu-security` (`default_keyring()`, `crates/kasirmu-security/src/lib.rs:194`),
> whose own crate description says *"At-rest encryption lives in kasirmu-crypto."*
> The two halves of D1's design — "derive with a per-install key" and "hold that key
> in the OS keychain" — sit on opposite sides of a dependency edge that does not exist.

So S2b is not "call `install_key` from somewhere". It is: **decide who owns the
process-global install key, and how it arrives before the first decrypt.** That
decision has a wrong answer that silently destroys credentials, which is what §5 is for.

## 2. The failure this plan exists to avoid

`install_key` (`crates/kasirmu-crypto/src/lib.rs:261`) is deliberately **dormant** and
its doc block says so: it "intentionally does **not** participate in `candidate_keys`,
so no reader acquires a new branch and no existing ciphertext changes meaning."

The moment a per-install key starts being *used for writes*, every row written under
it becomes unreadable unless the same key is present at read time **and** is in the
candidate list. Two concrete ways to brick an install:

1. **Write under a key the reader does not try.** If `portable_key` starts returning
   `install_key(...)` for writes but `candidate_keys` does not include it, every value
   written after the upgrade fails to decrypt — including on the *same* install,
   immediately.
2. **Lose the key.** The key is stored in the OS keychain. If it is lost, regenerated,
   or unavailable at boot, all six families stop decrypting at once. Unlike option B
   (a bad `OZ_MASTER_KEY`), this can happen without any operator action.

`candidate_keys` must therefore gain the install-key branch **before** any write uses
it, and the read path must never assume the keychain answered.

## 3. Current state, measured

| Fact | Evidence |
|---|---|
| `install_key(domain, secret)` exists, dormant | `crates/kasirmu-crypto/src/lib.rs:261` |
| `install_key_derivation_active()` hardcoded `false` | `:276-278` |
| No keychain entry | no `oz-pos/at-rest-key.v1` literal anywhere outside a doc comment |
| No `rekey` subcommand | `git grep rekey crates/kasirmu-cli/src/` → 0 hits |
| `kasirmu-crypto` has **no** process-global state | 0 `OnceLock`/`static`/`Mutex` in the crate |
| `kasirmu-crypto` never depends on `kasirmu-security` | neither `Cargo.toml` names the other |
| `platform/core` calls crypto but not security | `platform/core/Cargo.toml`: `kasirmu-crypto` only |
| `kasirmu-cli` depends on neither | 0 hits for both |
| 6 at-rest families, 6 encrypt + 6 decrypt sites | `lib.rs:375,415,429,443,457,471,485` (encrypt) mirroring `candidate_keys` calls at `:390,424,438,452,466,480,498` |
| `SMTP` and `profile` use `derive_static_key`; the other five use `derive_key(d,"static")` | same lines — **the two legacy arms differ and must not be conflated** |

**The two legacy arms differ.** S2b/S2c must treat them as two families with different
`legacy` closures, exactly as `candidate_keys` already does. A single-`legacy` refactor
would change ciphertext meaning for one of them.

## 4. Design: how the key reaches the derivation

Three options, and the choice is the heart of this plan.

| Option | Mechanism | Verdict |
|---|---|---|
| **A. `kasirmu-crypto` depends on `kasirmu-security`** | crypto calls `default_keyring()` itself | **Reject.** Inverts a deliberate layering (the crate docs say at-rest encryption lives in crypto, credential storage in security), drags `zbus`/`windows-sys`/`security-framework` into a crate every binary links including the headless server, and makes crypto untestable without an OS keychain. |
| **B. `kasirmu-security` depends on `kasirmu-crypto`** | security holds the key and derives | **Reject.** The same edge in the other direction, and it puts the *derivation* behind the crate that six families' call sites do not import. |
| **C. An injected process-global in `kasirmu-crypto`, set at boot** | a `OnceLock<Option<[u8;32]>>` in crypto + a `pub fn install_key_from_keychain(secret)`; each binary's boot resolves the keychain and injects before the first decrypt | **RECOMMENDED.** Keeps both crates independent, keeps crypto unit-testable (tests inject directly), and makes the boot-time ordering explicit and assertable. |

**Option C in detail.**

```rust
// crates/kasirmu-crypto/src/lib.rs — new
static INSTALL_KEY: OnceLock<[u8; 32]> = OnceLock::new();

/// Install the process-wide per-install key. Idempotent; first call wins.
pub fn set_install_key(secret: [u8; 32]) -> bool   // false if already set

/// Whether a per-install key is installed in THIS process.
pub fn install_key_derivation_active() -> bool     // replaces the hardcoded false
```

- `portable_key` gains a **third** arm: install key if set, else `OZ_MASTER_KEY` HMAC if
  set, else legacy. Precedence is a genuine decision — recommend **install key wins**,
  matching D1's intent that the keychain becomes the real key.
- `candidate_keys` gains the install-key branch **first**, so a reader tries
  install → master → legacy. Order is a read-only concern; AES-GCM tag is the oracle.
- `install_key(domain, secret)` stays public and stateless — the pure function S2a landed,
  still used directly by tests.

**Why `OnceLock` and not a parameter threaded through 12 call sites:** the six decrypt
functions are called from `platform/core`, the bridge and the shells, at points far from
any boot closure; threading a key through would touch every caller and every test. A
process-global set once at boot is the smaller, safer change — but it must be
**explicitly optional**, never a panic, so a process that never sets it behaves exactly
as today.

## 5. The hazards, and the guards for each

| # | Hazard | Guard |
|---|---|---|
| **H1** | Writes use the install key before reads try it → immediate self-brick | Land the `candidate_keys` branch **in the same commit** as the `portable_key` arm; a test writes under an injected install key and reads it back through the public reader |
| **H2** | Keychain lost/unavailable → all six families fail at once | Boot **must not** fail. A missing key = today's behaviour (legacy/master), never an error. A *read failure* must be distinguishable from *no key*, and both must fall back |
| **H3** | **`InMemoryKeyring` on unsupported targets starts empty every boot** (`kasirmu-security/src/lib.rs:207-210`) | **The most dangerous one.** A key generated into an in-process map is gone next boot, orphaning every row written under it. S2b must **refuse to generate** a key when the resolved keyring is the in-memory fallback — detect it, log loudly, stay on the legacy derivation |
| **H4** | Existing rows stop decrypting on the first keyed boot | The precondition (branch-tolerant reader) covers install→legacy. A test must prove a row written under the legacy derivation still reads after a key is installed |
| **H5** | Two `legacy` arms conflated (SMTP/profile vs the other five) | Keep `candidate_keys`' existing per-family closure parameter; do not unify |
| **H6** | `.db` / `.backup.db` whole-file portability breaks | **Expected and accepted by D1.** The five credential keys are on `SECRET_KEY_DENY_LIST` so they never cross a machine via sync/export; a whole-file copy does carry them. This is a **behaviour change requiring a release note**, not a bug |
| **H7** | `.ozpkg` PII needs a lane | D1 flags this. S3 (the `.ozpkg` PII pin) has landed; **verify at implementation time** whether the install key breaks the `users.national_id` / `monthly_take_home_minor` import path, and if so add the export/import lane or an explicit exclusion |

## 6. Slices, each independently shippable and reversible

**S2b-1 — the injection seam, no behaviour change.** ✅ **DONE 2026-09-29.**
Added `INSTALL_KEY` (`OnceLock<[u8; 32]>`), `set_install_key` (idempotent, first call
wins), a private `install_key_from_process`, and a real
`install_key_derivation_active`. The key is wired into `portable_key` (precedence
install → master → legacy, per §8.1) and `candidate_keys` (install branch tried first,
same slice as the write arm, per hazard H1). Tests inject through the new
`portable_key_from` / `candidate_keys_from` cores, because the global cannot be
un-set and installing one in the unit binary would poison its siblings; the real
global is driven in `tests/at_rest_key_lifecycle.rs`, which runs as its own process.
*Gate met:* with no key installed the production selector and candidate list are
unchanged (`no_install_key_leaves_the_production_path_unchanged` asserts the real
`portable_key`/`candidate_keys`, not the injectable helpers), and legacy rows still
read (`install_key_rows_read_and_legacy_rows_survive_the_upgrade`, plus the
integration case). Verified: 31 unit + 1 integration test pass, clippy clean,
`cargo fmt --check` clean, `cargo check --workspace --lib` clean.
**This slice alone changes nothing at runtime** — nothing calls `set_install_key` yet.

**S2b-2 — keychain resolution + boot injection.**
Add the keychain read to the **shells** (which already depend on `kasirmu-security`):
desktop `apps/desktop-tauri/src/lib.rs` setup closure, mobile `:114`. Each resolves
`oz-pos/at-rest-key.v1`; if absent, **generates one only when the keyring is durable**
(H3 guard); then calls `set_install_key` before any DB access.
*Gate:* boot with no keychain entry generates and logs; boot with a durable-unavailable
keyring falls back and logs; H2/H3/H4 tests green.

#### S2b-2a — the keychain-half prerequisite ✅ **DONE 2026-09-29** (commit `f2932f6f8`)

**The slice as written above was not implementable, and this is why.** It requires the
shells to "generate one only when the keyring is durable" — but nothing could answer that
question: `default_keyring()` returns a `Box<dyn Keyring>` and there was **no durability
signal anywhere in the crate**. A boot path had no way to tell the OS credential store from
the in-memory fallback that empties on every launch.

Landed in `crates/kasirmu-security` (unclaimed by any lane, and the only crate that may host
it — `kasirmu-crypto` and `kasirmu-security` are deliberate siblings):

- `Keyring::is_durable()` — **fail-closed default `false`**, so a backend must opt in; `true`
  in the Windows/Linux/macOS backends, explicit `false` beside the map in `InMemoryKeyring`.
- `install_key::{INSTALL_KEY_ENTRY, resolve_install_key, InstallKeyResolution,
  InstallKeySource}` — **generate-once** resolution. Present-and-well-formed → `Loaded`,
  nothing written. Present-but-malformed → **error, never regenerated** (a value that cannot
  be parsed may still decrypt existing rows). Absent → generate only on a durable store, else
  `RefusedNonDurableKeyring`, which is deliberately **not an error** so a dev machine or CI
  runner still starts.
- Deliberately **not** `rotate_key`: it overwrites on every call, so a boot path using it
  would mint a new secret each launch and orphan the previous rows.
- `InstallKeyResolution`'s `Debug` is **hand-written to redact the secret** — the C89 class,
  where a derived `Debug` printed credentials.

The audit stamp's "88 tests pass" was already 6 low; corrected to the measured 100.

#### S2b-2b — the boot half ✅ **DONE 2026-09-29** (commits `625c47290`, `5813b9208`)

Wiring `resolve_install_key` into the two shells' setup closures.

**⚠️ The "BLOCKED on a lane lease" status this section previously carried was STALE, and the
blocker did not exist.** It claimed `apps/desktop-tauri/**` and `apps/mobile-tauri/**` were
two other lanes' "exclusive paths". Re-verified 2026-09-29: `git status` showed both shells
**clean** apart from this lane's own line-ending artefact, and there is no lease or exclusion
mechanism for them — `.agents/scripts/verify-lane.sh` is a *receipt harness* for one lane
(it prints HEAD and the dirty paths before and after a run so a borrowed red can be spotted),
not a lock. The work was therefore schedulable, and the honest lesson is that a
"blocked on another lane" note needs a re-check like any other claim.

**What landed, and why it went through the bridge rather than the shells directly.** No crate
depended on **both** `kasirmu-crypto` and `kasirmu-security` — they are deliberate siblings —
so the shells could not call `resolve_install_key` and hand the result to `set_install_key`
without adding that edge somewhere. `kasirmu-bridge` was the right home: it already depends on
`kasirmu-security`, already wraps the keyring in `with_keyring` for exactly this
blocking-thread reason, and both shells already depend on it. So
`kasirmu_bridge::security::install_at_rest_key()` is the seam, and each shell's `setup`
closure calls it **before `AppState::new`** — verified by line number in both
(desktop injection L199 < `AppState::new` L238; mobile L178 < L215).

**It is synchronous on purpose,** unlike the neighbouring `with_keyring`: Tauri's `.setup()`
closure is synchronous, so there is no async context to await in, and the keyring operation
runs on a dedicated OS thread (spawn + join) rather than `block_on`, keeping the Linux Secret
Service backend's private runtime out of Tauri's. A panicked worker is caught rather than
propagated, because no keychain outcome may abort a boot.

**Evidence:** `cargo test -p kasirmu-bridge security` -> **44 passed, 0 failed** (7 new);
`cargo clippy -p kasirmu-bridge --all-targets -- -D warnings` clean; both shells compile and
`cargo clippy -p kasirmu-app ... -D warnings` clean; `cargo test -p kasirmu-app --lib` -> 173
passed with only the pre-existing registry-floor pin red (unrelated, see below).

**§8.4's debug-only static fallback was NOT implemented, deliberately — it contradicts H2.**
See §10, which is the finding this slice produced rather than the code it was expected to
produce.

**S2c — `oz rekey`.**
New CLI subcommand re-writes every at-rest row under a newly rotated key. Needs
`kasirmu-cli` to gain the crypto (+ security) dependency — it currently has neither.
*Gate:* a fixture with rows under legacy + install keys rekeys and reads back; an
interrupted rekey leaves every row readable under the old key.

#### S2c — the ordering, ruled 2026-09-29: park the OLD key, promote the NEW one

**The ordering originally written above — "park the new key, re-encrypt under it,
promote" — cannot satisfy this slice's own gate**, and the reason is a property of the
process-global rather than a detail: `set_install_key` is a first-call-wins `OnceLock`
holding **one** key, and `candidate_keys` is `[install, legacy, master]`. Re-encrypting
to a key the keychain does not yet hold means an interruption leaves rows under a key no
boot can install — the install is bricked, which is exactly what the gate forbids.
Parking the **old** key instead keeps both keys durably present for the whole operation.

**Why the reverse order is crash-safe at every instant.** After park + promote the
keychain holds new (`INSTALL_KEY_ENTRY`) + old (`…-prev`), so **any** boot reads both and
every row decrypts — whether it is still old or already re-encrypted. Interruption before
park: nothing changed. Between park and promote: the current entry is still the old key.
Mid-sweep: both keys present. `-prev` is retired only after the sweep verifies, and
retiring it is the last step. **Never delete the old key until the re-encrypt verifies.**

**Required changes, none of which the original paragraph named:**

1. **`kasirmu-crypto`** — a SECOND read slot (`previous_install_key`) wired into
   `candidate_keys` and **deliberately NOT into `portable_key`'s write arm**, so writes
   always use the current key (hazard H1 preserved). Read order becomes
   `[install, previous, legacy, master]`; the `[legacy, master]` tail keeps its existing
   order (H5), so a process with no keys produces a byte-identical list.
2. **`kasirmu-security`** — `INSTALL_KEY_PREV_ENTRY`, park / promote / retire primitives,
   and a `resolve_previous_install_key` mirroring `resolve_install_key`'s three cases
   (present → `Loaded`; malformed → error, never regenerated; absent → `None`, **not** a
   generation trigger).
3. **`kasirmu-bridge::security::install_at_rest_key()`** — installs BOTH keys, so both
   shells gain the tolerance without either shell changing.
4. **`kasirmu-cli`** — `oz rekey`, which needs the crypto **and** security dependencies
   it does not have today (its manifest names `kasirmu-core` only).

**The sweep must be TOTAL over the install-key-derived families — measured, not assumed.**
A row left under the old key is unreadable the moment `-prev` is retired, so the sweep
covers every family that derives through `portable_key` / `candidate_keys`. There are
**eight**, read off the call sites:

| # | Family | Domain | Legacy arm |
|---|---|---|---|
| 1 | `sync_api_key` | `SYNC_API_KEY_DOMAIN` | `derive_key(d, "static")` |
| 2 | `sync_terminal_secret` | `SYNC_TERMINAL_SECRET_DOMAIN` | `derive_key(d, "static")` |
| 3 | `pg_sync.password` | `PG_SYNC_PASSWORD_DOMAIN` | `derive_key(d, "static")` |
| 4 | `rate_sync.api_key` | `RATE_API_KEY_DOMAIN` | `derive_key(d, "static")` |
| 5 | `lan_server.psk` | `LAN_PSK_DOMAIN` | `derive_key(d, "static")` |
| 6 | `local_api.secret` | `LOCAL_API_SECRET_DOMAIN` | `derive_key(d, "static")` |
| 7 | `smtp_config` password field | `SMTP_AT_REST_DOMAIN` | **`derive_static_key`** |
| 8 | profile fields (`users.national_id`, `monthly_take_home_minor`) | `PROFILE_AT_REST_DOMAIN` | **`derive_static_key`** |

Two families (**API_KEY_DOMAIN**, **SMTP_DOMAIN**) are **machine-bound**
(`derive_key(domain, machine_id)`) and are **NOT** install-key-derived, so `oz rekey`
must not touch them — their ciphertext does not change meaning when the install key
rotates. Rows 7 and 8 use a *different* legacy closure from rows 1–6 (hazard H5), so the
sweep must not unify them. A partial sweep does not fail loudly; it strands rows.

**Explicitly NOT in this plan:** `OZ_MASTER_KEY` deprecation, the `.db` portability
question beyond the release note, and any change to `SECRET_KEY_DENY_LIST`.

## 7. Done when (C1's own clause, restated as testable)

C1 says: *"a per-install key is held in the OS keychain, a test asserts the static
fallback cannot be reached in a release build, and a row written under the legacy
derivation still decrypts after the key exists."*

- [x] **A key written to the OS keychain at boot and read back on the next boot.**
      DONE — S2b-2a (`f2932f6f8`) resolves it generate-once; S2b-2b (`625c47290`,
      `5813b9208`) installs it in both shells before the store opens.
- [x] **The static fallback is unreachable in a release build.** **RE-SCOPED AND LANDED
      2026-09-29 (§10, option (a))** — the clause now reads: *"in a release build the static
      fallback is never the WRITER whenever a durable keychain exists"*, surviving only as a
      read candidate for pre-upgrade rows (H4 requires it). It is **not** a build-time gate and
      cannot be: `derive_static_key` must stay compiled for H4's legacy read path, so no
      `compile_error!` can express it. The assertion is **behavioural** —
      `the_static_fallback_is_never_the_writer_when_an_install_key_exists` in
      `crates/kasirmu-crypto/src/lib_tests.rs` asserts both halves (write arm = install key;
      static derivation still a read candidate), and it was falsified RED by disabling the
      install arm before landing. The old tripwire pin is **discharged rather than tripped**
      (its rationale updated, assertion unchanged) because §8.4's hard-error reading was
      refused; see §10.
- [ ] A row written under the legacy derivation still decrypts after the key exists (H4).
      **Satisfied structurally by S2b-1** (the install arm is first for writes, last for
      reads; `candidate_keys` keeps the legacy tail) and pinned by
      `crates/kasirmu-crypto/tests/at_rest_key_lifecycle.rs`; not re-run this pass.

## 10. The §7 release-build clause contradicts §5's H2 — do not build it as written

Found 2026-09-29 while implementing S2b-2b, **before** writing any code for this clause.

**The two clauses, verbatim from this plan:**

- §8 Q4 (answering the §7 clause): *"In a release build an unset master key must be a **hard
  error** rather than a silent fallback to the public constant, so the fallback is
  structurally unreachable there."*
- §5 H2: *"Keychain lost/unavailable → all six families fail at once. **Boot must not fail.**
  A missing key = today's behaviour (legacy/master), never an error."*

**They cannot both hold, and the collision is the default path, not an exotic one.** On a
machine whose keychain is unusable (the H3 refusal, or a Linux box with no libsecret) the
install key is absent **and** — verified: **zero** shipped config sets `KASIRMU_MASTER_KEY`
or `OZ_MASTER_KEY` anywhere in `ops/`, `.env.example`, any compose or Dockerfile — the master
key is unset too. So the arm a release build selects is exactly `derive_static_key`, the
public constant. Q4 would make that a **hard error**, i.e. the app refuses to start on every
CI runner and every libsecret-less Linux install — which is what H2 forbids.

**Why H2 should win, on evidence this plan already collected.**

1. **Every shipped install is in that state.** The checklist records the public-constant key
   as "live on every shipped install" and nothing ships a master key. A hard error would not
   harden those installs; it would stop them booting.
2. **It converts an at-rest exposure into an availability outage**, a strictly worse trade for
   a till. D1's whole analysis was built on *not* bricking live installs — that is why option B
   (set the master key now) was rejected.
3. **The clause's intent is satisfiable without the hard error.** Its goal is that the public
   constant stops being the derivation for **new writes**, not that the process refuses to run.
   S2b-2 already achieves that wherever a durable keychain exists: the install key becomes the
   write arm, and the static fallback survives only as the **last read candidate** for rows
   written before the upgrade — which H4 *requires* it to be.

**Options for whoever picks this up.**

- **(a) Re-scope the clause** to *"the static fallback is never the WRITER in a release build
  when a durable keychain exists"* — testable, and consistent with both H2 and H4.
- **(b) Keep the hard-error reading** and accept it is a breaking change needing an operator
  opt-in (e.g. only when a key is *expected* but missing) — a product decision, not a
  mechanical one.

**(a) is the recommendation.** Note that neither option is expressible as a `compile_error!`
build gate: `derive_static_key` must stay compiled because H4's legacy read path needs it, so
the assertion has to be **behavioural** (a release-profile test), not a build failure. That is
also why this clause is the only part of C1 that cannot be closed from the checklist alone.

**Status: NOT IMPLEMENTED, deliberately.** S2b-2b's other half — the boot injection — is done
and tested. This clause is left for a decision rather than guessed at, because guessing wrong
here stops the application from starting.

**ANSWERED 2026-09-29: option (a) — the clause is re-scoped, and §8.4's hard-error reading is
retracted.** The re-scoped clause is:

> **In a release build, the static fallback is never the WRITER whenever a durable keychain
> exists.** It survives only as a **read candidate** for rows written before the upgrade,
> which H4 requires.

Why (a) and not (b): the hard-error reading contradicts §5's H2, and the collision is the
default path rather than an exotic one — **zero** shipped config sets `KASIRMU_MASTER_KEY` or
`OZ_MASTER_KEY`, so on any machine without a durable keychain the release arm *is*
`derive_static_key`, and (b) would stop every such install and every CI runner from booting.
That converts an at-rest exposure into an availability outage, which is the trade D1 already
refused when it rejected option B.

**And it cannot be a build gate, which is why §7's wording changes.** `derive_static_key` must
stay **compiled** for H4's legacy read path, so no `compile_error!` can express this. The
assertion must be **behavioural** — a test that drives the injectable cores
(`portable_key_from` / `candidate_keys_from`) and asserts that a present install key wins the
*write* arm while the static derivation is still present in the *read* candidate list.

**The tripwire pin is DISCHARGED, not tripped — and the distinction matters.** §8.4 said the
existing pin (`the_static_fallback_is_the_default_derivation_and_is_pinned_as_reachable`) "must
go red when this lands, and be inverted in the same change". It does **not** go red, because the
reading that would have made it red (the hard error) was refused. So the pin keeps its assertion
and only its **rationale** changes: it now pins the edge the scope allows — with no install key,
the static fallback is still the writer — instead of standing as a tripwire for a gate that was
never built. The clause's affirmative half is a **new** test,
`the_static_fallback_is_never_the_writer_when_an_install_key_exists`, which asserts *both* halves
on purpose: asserting only the write arm would also be satisfied by the wrong fix — deleting the
static derivation from the candidate list, which would orphan every pre-upgrade row.

## 8. Owner questions — ANSWERED 2026-09-29

All four were answered by taking the plan's own recommendation. Recorded here so the
next reader does not re-ask them.

1. **Precedence when both a keychain key and a master key are present → the install key
   wins.** Landed in S2b-1 as `portable_key`'s first arm: install → master → legacy.
   `portable_key_from` is the injectable core that makes the ordering testable without
   installing a key into the process global.
2. **H3's fallback → refuse to generate.** On a target whose resolved keyring is the
   in-memory fallback, S2b-2 must detect it, log loudly, and stay on the legacy
   derivation rather than generate a key that is gone next boot. The refusal is
   S2b-2's job, not `set_install_key`'s: the function cannot tell where the secret came
   from, and its doc says so.
3. **Portability → the trade is accepted as D1 recorded it.** Whole-file `.db` /
   `.backup.db` copies stop being portable under a per-install key; that is the
   intended consequence and it needs a release note, not a fix. `.ozpkg` is **not**
   pre-decided: S2b-2 verifies at implementation time whether the install key breaks
   the `users.national_id` / `monthly_take_home_minor` import path, and adds the
   export/import lane only if it does.
4. **The release-build assertion → the static fallback becomes debug-only.** In a
   release build an unset master key must be a hard error rather than a silent
   fallback to the public constant, so the fallback is structurally unreachable there
   instead of merely untested. This is a change to `derive_static_key`'s reachability
   and therefore lands in **S2b-2**, where it can be falsified by a release-profile
   run. Until then the existing pin
   (`the_static_fallback_is_the_default_derivation_and_is_pinned_as_reachable`) stays
   as the deliberate tripwire the plan asked for: it must go red when this lands, and
   be inverted in the same change.
   **⚠️ THIS ANSWER WAS SUPERSEDED 2026-09-29 — see §10.** The hard-error reading
   contradicts §5's H2 and is retracted in favour of §10's option (a); the tripwire
   pin is still inverted, but against the re-scoped clause, not this one.

## 9. Production blast radius (why the ordering in §6 matters)

7 write sites across 6 storage locations: `settings.sync_api_key`,
`sync_terminal_secret`, `pg_sync.password`, `rate_sync.api_key`, `lan_server.psk`, the
SMTP password inside the `smtp_config` JSON, plus `users.national_id` and
`monthly_take_home_minor` — **and copies in the `setting_updated` delta ledger and in
every `.db` / `.backup.db` snapshot.**

**Two of the six families have no production setter** (`set_rate_sync_api_key`,
`set_lan_server_psk`), so if their ciphertext is orphaned they **cannot be re-entered
through the product**. That is the specific reason option B was rejected and the reason
H1/H3/H4 are gates rather than notes.
