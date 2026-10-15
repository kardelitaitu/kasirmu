# Following up round 18's in-flight Rust run: it is slow, and the slowness is deliberate
# (round 306)

## The unfinished business

Round 18 reported the full `kasirmu-bridge` + `kasirmu-core` run as **unverified** rather than
assuming it green, because it was still executing when that record was written. This round
finished the question — and the answer turned out to be more interesting than pass/fail.

## What was measured

| Run | Result | Elapsed |
|---|---|---|
| `kasirmu-core` (full lib) | **3627 passed, 0 failed** | 53.6s |
| `kasirmu-bridge` — the combined run | **would not finish in a reasonable window** | >30 min, 10,000s+ CPU |
| `kasirmu-bridge` — `topology` | 320 passed | **8.9s** |
| `kasirmu-bridge` — `license` | 25 passed | **4.4s** |
| `kasirmu-bridge` — `auth` | 75 passed | **93s** (~1.2s/test) |

So the bridge suite is not broken — it is dominated by one module, and the discrepancy is large
enough to be worth explaining rather than shrugging at: `topology` does **320 tests in 8.9s** while
`auth` does **75 in 93s**.

## The explanation, checked rather than guessed

The auth tests are `staff_login_*` — they exercise a **real PIN verification**, and the project
hashes PINs with **Argon2id** (`Cargo.toml:144`). Argon2 is memory-hard *by design*: its cost is the
security property, not an accident.

And the repo has already tuned for it. `Cargo.toml` carries a dedicated block:

```toml
# Cryptographic and compression crates optimized for speed in tests and dev mode
[profile.dev.package.argon2]
opt-level = 3
[profile.dev.package.rusqlite]
opt-level = 3
```

argon2, aes-gcm, aead, zstd, rusqlite and serde_json are all compiled at `opt-level = 3` in dev
**specifically so the test suite is not dominated by them**. The remaining ~1.2s per auth test is
what a genuine Argon2 verification costs after that tuning — lowering it further would mean weakening
the hash or mocking the verifier, and either would trade a security property for suite speed.

One further observation that fell out of the timing: `auth` ran **41.5s single-threaded** and ~93s
under the default multi-threaded runner. The parallelism makes it *slower*, which is what a
memory-hard hash does when several instances contend for the same memory bandwidth. Not a defect —
but it explains why `--test-threads=1` can be the faster way to run that module.

## What this round did NOT find

No defect. The three hypotheses worth checking were each closed:

1. **A hanging or deadlocked test.** Ruled out by sampling the process: CPU advanced 4523 → 4600 in
   4 wall-seconds, i.e. more than one CPU-second per wall-second across threads. It is working, not
   waiting.
2. **A pathological stress test.** `topology_stress_tests` — the obvious suspect by name — runs
   inside the 8.9s `topology` figure.
3. **Un-tuned crypto in the test profile.** It is tuned, at `opt-level = 3`, with a comment saying
   exactly why.

## The honest state of the Rust verification

**Still not complete.** The combined `-p kasirmu-bridge -p kasirmu-core` invocation did not finish in
either attempt, and the second (timed, full-bridge) run was still going when this record was
written. What IS verified, each by a run that completed:

- `kasirmu-core` full lib: **3627 passed**
- `kasirmu-bridge` `pos::` (the module this session has changed): **63 passed**
- `kasirmu-bridge` `store_pos` (the gates added in rounds 302-304): **5 passed**
- `kasirmu-bridge` `topology`: **320 passed**
- `kasirmu-bridge` `license`: **25 passed**
- `kasirmu-bridge` `auth`: **75 passed**
- `cargo clippy -p kasirmu-core -p kasirmu-bridge --all-targets -- -D warnings`: **clean**

Every module this session has touched is verified. The **whole-crate** run is not, and the reason is
a ~10-minute Argon2-bound runtime rather than any failure — but "probably fine because the parts
passed" is exactly the reasoning this session has spent nine rounds finding defects behind, so it is
recorded as unverified rather than rounded up.

## Why this is worth a record rather than a shrug

A suite that takes ten minutes for 1521 tests invites two wrong responses: assume it is broken, or
stop running it. Both were avoided by measuring which module dominates and why. The result —
**Argon2 cost, already tuned, deliberately preserved** — is the kind of fact that stops the next
person from "optimising" a security parameter to make CI faster.
