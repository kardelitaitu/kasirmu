# C1 S2b / S2c — per-install at-rest key: implementation plan

<!-- Plan token kept: `plan-` (AGENTS.md §7.4 — the docs-auditor exempts this name
     from check-dead-refs.py). This is a PLAN, not a record of work done. Nothing
     in it has been implemented. It is deliberately NOT named `done-*`. -->

**Status:** PLAN, not started. Written 2026-09-29.
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

**S2b-1 — the injection seam, no behaviour change.**
Add `INSTALL_KEY`, `set_install_key`, real `install_key_derivation_active`. Wire the
key into `portable_key` and `candidate_keys`. Tests inject directly.
*Gate:* with no key set, `cargo test -p kasirmu-crypto` is byte-identical in behaviour;
a test proves legacy rows still read. **This slice alone changes nothing at runtime.**

**S2b-2 — keychain resolution + boot injection.**
Add the keychain read to the **shells** (which already depend on `kasirmu-security`):
desktop `apps/desktop-tauri/src/lib.rs` setup closure, mobile `:114`. Each resolves
`oz-pos/at-rest-key.v1`; if absent, **generates one only when the keyring is durable**
(H3 guard); then calls `set_install_key` before any DB access.
*Gate:* boot with no keychain entry generates and logs; boot with a durable-unavailable
keyring falls back and logs; H2/H3/H4 tests green.

**S2c — `oz rekey`.**
New CLI subcommand re-writes every at-rest row under a newly rotated key. Needs
`kasirmu-cli` to gain the crypto (+ security) dependency — it currently has neither.
Rotation is **staged**, mirroring `Keyring::rotate_key`'s SEC-4 ordering: park the new
key, re-encrypt under it, promote; a failure before promote leaves the old key and the
old ciphertext intact. **Never delete the old key until the re-encrypt verifies.**
*Gate:* a fixture with rows under legacy + install keys rekeys and reads back; an
interrupted rekey leaves every row readable under the old key.

**Explicitly NOT in this plan:** `OZ_MASTER_KEY` deprecation, the `.db` portability
question beyond the release note, and any change to `SECRET_KEY_DENY_LIST`.

## 7. Done when (C1's own clause, restated as testable)

C1 says: *"a per-install key is held in the OS keychain, a test asserts the static
fallback cannot be reached in a release build, and a row written under the legacy
derivation still decrypts after the key exists."*

- [ ] A key written to the OS keychain at boot and read back on the next boot.
- [ ] **The static fallback is unreachable in a release build.** This needs a build-time
      assertion, not a runtime one — likely `#[cfg(not(debug_assertions))]` plus a
      `compile_error!` if `derive_static_key` is reachable, or a release-only test. **This
      is the least-specified part of the item and needs a design decision during S2b-2.**
- [ ] A row written under the legacy derivation still decrypts after the key exists (H4).

## 8. Open questions for the owner

1. **Precedence when both a keychain key and `OZ_MASTER_KEY` are present.** Recommended:
   keychain wins (it is per-install and non-public). But this silently changes which
   derivation writes, so confirm.
2. **H3's fallback:** on an unsupported target (in-memory keyring), refuse to generate —
   recommended — or generate-with-a-warning? Refusing keeps at-rest behaviour static and
   is the conservative answer; generating would encrypt rows that silently orphan.
3. **H6/H7 portability.** D1 accepts breaking whole-file `.db` portability. Confirm that
   is still the intended trade, and whether `.ozpkg` needs the import lane.
4. **The release-build assertion in §7.** No mechanism exists today; pick one.

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
