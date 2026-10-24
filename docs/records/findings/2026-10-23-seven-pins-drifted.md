# Seven pinned base-image digests have drifted, unnoticed

**Date:** 2026-10-23 · **Severity:** high · **Status:** open (needs an owner decision)

## What was found

`scripts/verify-docker-digests.sh` re-resolves every `image:tag@sha256:...` pin in the
six Dockerfiles and Compose files against the live registry. Run against the tree on
2026-10-23 it reports **7 drifted PINS across 5 distinct IMAGES**:

| Image | Pinned | Registry now | References |
|---|---|---|---|
| `debian:bookworm-slim` | `88200866dfff…` | `7ff6ba31527b…` | 2 (`Dockerfile.server`, `Dockerfile.unified`) |
| `caddy:2-alpine` | `5f5c8640aae0…` | `eb4d35b7452d…` | 1 (`Dockerfile.unified`) |
| `alpine:3.22` | `14358309a308…` | `2e0b81d60597…` | 1 (`apps/license-server/Dockerfile`) |
| `public.ecr.aws/docker/library/redis:7-alpine` | `ff02b58f971e…` | `57e4255cc971…` | 2 (`docker-compose.yml`, `docker-compose.e2e.yml`) |
| `postgres:16-alpine` | `cf78e76683b9…` | `f46107955874…` | 1 (`docker-compose.pg.yml`) |
| `rust:1.88-slim` / `golang:1.25-alpine` | — | still current | 3 |

**Corrected 2026-10-24: the count above was wrong in both halves.** This line said "6
distinct images" while its table listed five drifted images plus a "still current" row, and
"7 drifted pins" is right only if you count REFERENCES rather than images — `debian` and
`redis` are each pinned twice. Measured from a live run of the gate: 7 drifted references,
5 distinct images, and the two "still current" images (`rust:1.88-slim`, `golang:1.25-alpine`,
**4** references — `Dockerfile.server:22` + `Dockerfile.unified:43` for rust,
`license-server/Dockerfile:16` + `Dockerfile.unified:27` for golang) are not drifted at all. The
number that matters for a refresh is 5 images; the number that matters for a diff is 7 lines.

**Second correction, same shape (2026-10-24): that "3" was itself an arithmetic slip, in a
paragraph already correcting arithmetic.** Counted per pin site, the two current images hold
**4** references, and 7 drifted + 4 current = **11**, which is exactly what `scripts/gates.json`'s
own "11 pins" row says. The gate's `FILES` array now holds 7 files and 12 pins after the
blind-spot fix below.

Three of the six were re-queried independently (`docker buildx imagetools inspect`) and
returned exactly the digests the gate reported, so the finding is not an artefact of the
gate's own parsing.

## The blind spot is now FIXED, and one gap it hid (2026-10-24)

A delegated audit re-measured all 11 pins two ways that need no daemon (Docker Hub
`docker-content-digest` header; SHA-256 of the raw manifest bytes for public ECR, which returns
no header) and reproduced every digest in this finding exactly. It found three things this file
did not record:

1. **The pins are STALE, not frozen.** `git grep -inE "frozen|freeze"` over the Dockerfiles, the
   gate, `.trivyignore` and `agent-gates.md` returns **zero hits** — no freeze marker exists, so
   the drift is genuine rot rather than a deliberate hold.
2. **The "refreshed <date>" comments are partly FALSE.** `Dockerfile.unified:193` claims debian
   "refreshed 2026-08-17" while pinning an artifact created **2026-08-24** — a refresh on 8/17
   cannot have pinned an 8/24 artifact. And `Dockerfile.server:185` and `Dockerfile.unified:194`
   pin the *identical* debian digest under two different refresh dates. Treat those dates as
   provenance you must verify, not as evidence a pin is fresh.
3. **A 12th pin the gate could not see.** `scripts/run-e2e.mjs:126` hardcodes the same redis
   digest as `docker-compose.e2e.yml` — its own comment says "Keep in sync" — but the file was
   not in the gate's `FILES` array. Refreshing the compose pin alone would leave `prePullRedis()`
   pulling the OLD digest while compose started the NEW one: two different images in one e2e run.

**Fixed:** `scripts/run-e2e.mjs` is now in `FILES`, taking the gate from 11 pins across 6 files to
**12 pins across 7 files**. The pattern already matched the line (verified before the edit), so
the only change needed was the path. The `--self-test` still passes 8/8 — and note it does NOT
cover `FILES`, which is why the pin count was re-measured directly to prove the edit worked.

**Still open, and still an owner decision:** refreshing the 7 drifted references themselves
(debian first — it is the only security-relevant one, a ~2-month-overdue point release), plus
correcting the false comment dates in the same commit. The audit also recommends wiring the
retired Monday cron as an **advisory**, issue-opening job rather than a blocking one: caddy alone
moves roughly 4x a month, so a blocking job would be permanently red.
## Every current digest is now independently re-derived, so the refresh is mechanical (2026-10-24)

The Docker daemon is down on this host, so `verify-docker-digests.sh` cannot run its live scan.
Every digest was instead re-derived straight from the registries — Docker Hub via the
`docker-content-digest` response header with a SHA-256 fallback over the raw manifest bytes, and
public ECR (which returns no header) by SHA-256 of the returned bytes. Each value below was
measured twice and matches the gate's own report from 2026-10-23 exactly:

| image | current digest (verified 2026-10-24) |
|---|---|
| `debian:bookworm-slim` | `sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8` |
| `caddy:2-alpine` | `sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f` |
| `alpine:3.22` | `sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f` |
| `postgres:16-alpine` | `sha256:f4610795587492cd4fb887c2dc3de301b813278bb6f616992061141b5f15ac36` |
| `…/redis:7-alpine` | `sha256:57e4255cc971b1c8d6f8a6ca283ac01bc3ecdd914273ef6bfaede87aaecd6541` |

**The refresh is deliberately NOT applied here.** The pins are mechanical to swap, but a pin
change cannot be verified without building the images, and the daemon is unavailable — so the
one thing that would make this a safe change (a green build on the new bases) is exactly the
thing that cannot be run. Committing an unbuildable pin set would trade a known-stale pin for
an unverified one, which is worse. The table above makes the refresh a copy-paste once a daemon
is available.

**The false comment dates ARE fixed** (`ad38bac63`): three "refreshed <date>" claims were
replaced with the measured artifact dates, because a refresh date that predates the artifact it
pins is not provenance — it is noise that makes the next reader think a pin is fresher than it
is. Pin count is unchanged at 12 and the gate's self-test still passes 8/8.
## The alerting gap is now CLOSED (2026-10-24)

The section below says the gate had no live runner, which is what let seven pins rot for two
months. That is fixed: **`.github/workflows/docker-digest-drift.yml` is restored and LIVE**
(`54d877434`), running weekly on Monday 05:00 UTC plus `workflow_dispatch`.

**It is advisory, and deliberately so.** On drift it OPENS A GITHUB ISSUE rather than failing a
branch. The images use moving tags — `bookworm-slim`, `2-alpine`, `16-alpine`, `7-alpine` — so their
index digest is expected to move; caddy alone moves roughly four times a month. A blocking job
would be permanently red, and a permanently red job is one nobody reads, which is precisely the
failure this workflow exists to prevent. A human decides whether each drift is security-relevant.

**Restoring it was a THREE-file change, and the third file is what the gate enforces.** Adding the
workflow alone left `verify-ci-docs-drift.py` red with `UNDOCUMENTED LIVE JOBS — check`, because the
checker parses `ci-pipeline.md`'s Job Matrix and Workflow inventory and compares them to what is
on disk. The workflow row and the `check` job row both had to be updated — the same
"editing check.sh is a two-file change" rule, applied to workflows. It was verified green by
proving the rows are parsed as LIVE rather than waved through the history exemption: the module's
own regexes find `check` among 31 matrix rows and `docker-digest-drift.yml` among 12 inventory
rows, and `looks_like_actions_workflow()` returns True for the on-disk file.

**Also corrected in the same commit:** `gates.json`'s `docker-digests` note still said "the six
Dockerfiles and Compose files" and "11 pins" after round 108 added `scripts/run-e2e.mjs` to the
gate's `FILES` array. Now seven files and 12 pins.

**What remains:** refreshing the 7 drifted references themselves. Every current digest is
re-derived and tabulated above, so it is a copy-paste — but it still needs a Docker daemon to
build on the new bases, and this host has none. The workflow will now raise an issue weekly until
someone does it, which is the alerting behaviour that was missing.
## Why nobody saw it

The gate had **no live runner of any kind**. Its only caller was
`.github/workflows/attic/docker-digest-drift.yml.bak:37` — a RETIRED workflow that GitHub
never executes. The script's own header has said so since 2026-09-16: *"BUT NOTHING RUNS
IT — pins DO silently rot and nobody is alerted."* That sentence was accurate, and this is
what it predicted.

It surfaced only because writing a `--self-test` for the gate required running it, and the
first dispatch placement let the real scan start before the cases ran. The defect in my
own dispatch is what exposed the defect in the pins — which is a useful reminder that a
gate nobody executes is not a gate.

## What is NOT true of this finding

A drifted digest is **not automatically a compromise**. These are multi-arch index
digests for moving tags (`bookworm-slim`, `2-alpine`, `16-alpine`); upstream rebuilds them
on every base-image patch, so drift is the EXPECTED state for a tag that is not frozen.
The pinning policy (`.trivyignore` and the Dockerfile comments) is *"pin immutable
multi-arch index digests, refresh deliberately"* — so the correct reading is: **the
refresh is overdue**, not that something is wrong with the images. The gate cannot tell
the two apart and does not claim to.

## What was done this round

1. A **census floor** was added: with the pin pattern dead the gate used to print
   "All pinned image digests are current." over ZERO pins and exit 0. Measured, then fixed;
   it now exits 2 with a named refusal.
2. A `--self-test` (8 cases, no daemon) grades the pin pattern and the digest comparison,
   and is wired into `scripts/check.sh` as `docker digests self-test`.
3. `gates.json` gained a `docker-digests` record, **status advisory**, noting that the scan
   itself is still not wired: re-resolving 11 pins with up to 5 retries each is not
   something a local matrix should do on every pass.

## What an owner must decide

- **Refresh the pins deliberately** (the DOCKER-02 process), accepting the new digests.
  This is the expected outcome for a moving tag; it needs someone to sign off on the
  change, which is why it is not done here.
- **Or wire the scan** on a schedule (the retired workflow's cron was `0 5 * * 1`) and
  accept that a weekly job will go red whenever upstream rebuilds a base image. **This is
  now the only real alternative** — the research above shows the scan is the only lever,
  because every tag choice drifts at the same rate.
- ~~Or pin frozen digests~~ — **withdrawn 2026-10-24.** Measured: the "immutable"
  version-pinned aliases are bit-identical digests to the moving tags and are re-pushed on
  the same upstream rebuilds. There is no tag that does not drift; `@sha256:` is the
  immutability, and the repo already uses it.

Wiring the scan without settling the first question would produce a gate that is
permanently red for a reason nobody agreed to — the failure mode that gets gates muted.

## Upstream research 2026-10-24: this drift is EXPECTED

**All five tags are moving tags that upstream re-publishes on purpose.** None is frozen.

| image:tag | mutable? | evidence |
|---|---|---|
| `debian:bookworm-slim` | yes | docker-library FAQ promises "at least monthly" Debian rebuilds |
| `caddy:2-alpine` | yes | caddy-docker CI pushes on every commit to master |
| `alpine:3.22` | yes | official-images stanza `Tags: 3.22.7, 3.22` |
| `redis:7-alpine` | yes | official-images stanza `7.4.11-alpine, 7.4-alpine, 7-alpine` |
| `postgres:16-alpine` | yes | official-images stanza `16.15-alpine, 16-alpine` |

Measured cadence (repo-info commit history, 2026): debian ~monthly (16 updates in 10
months), postgres quarterly+rebuilds, caddy bursty (~22/yr), alpine every 2-4 months.

**The decisive fact:** all five were re-pushed upstream inside ONE 48-hour window,
2026-10-21T01:35Z to 2026-10-22T01:09Z. That is a single coordinated upstream rebuild
sweep, not five incidents. The pins were correct through ~Oct 20 and went stale together.

**This kills one of the three options below.** Switching to a version-pinned tag does NOT
reduce churn: the live Hub digests for `alpine:3.22` vs `alpine:3.22.7`,
`postgres:16-alpine` vs `postgres:16.15-alpine`, `caddy:2-alpine` vs `caddy:2.11.7-alpine`,
`redis:7-alpine` vs `redis:7.4.11-alpine` and `debian:bookworm-slim` vs
`debian:bookworm-20261020-slim` are IDENTICAL PAIRS -- upstream re-pushes the pinned alias
on every rebuild too. The `@sha256:` pin the repo already uses is the only immutability
available, so "pin frozen digests" is not a different tag choice, it is what is already done.

**What remains for the owner is purely a cadence question**, not a "did something go wrong"
question: how often to re-pin, and whether to wire the scan on a schedule. The retired
workflow's Monday cron would fire on a real rebuild most weeks, since caddy alone moves ~4x
per month.

**Independently re-verified** at the Docker Hub tag API, because the whole option withdrawal
rests on it and a delegated claim is not evidence:

```
alpine:3.22            sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f
alpine:3.22.7          sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f
postgres:16-alpine     sha256:f4610795587492cd4fb887c2dc3de301b813278bb6f616992061141b5f15ac36
postgres:16.15-alpine  sha256:f4610795587492cd4fb887c2dc3de301b813278bb6f616992061141b5f15ac36
```

Two identical pairs, and both "current" values match what `verify-docker-digests.sh` reports
for `alpine:3.22` and `postgres:16-alpine`. So the measurement and the gate agree, and the
"pin a version tag" option is closed on evidence rather than on a document's say-so.

Not closed: the ECR pull-through path for `public.ecr.aws/docker/library/redis:7-alpine`
was verified against the Docker Hub mirror, not ECR itself.

## Re-measured 2026-10-24: same 7 pins, and the gate does exit 1

The drift is unchanged (no new pins, none refreshed) and the finding is still **open for an
owner decision**. The re-run was worth doing for one reason: it confirmed the gate FAILS on
what it found.

```
direct exit: 1        # bash scripts/verify-docker-digests.sh, no pipe, measured via subprocess
```

Two separate measurements said 0 before that, and both were the MEASUREMENT, not the gate:

1. `bash scripts/verify-docker-digests.sh 2>&1 | tail -25` — `$?` is `tail`'s status.
2. `bash -c 'bash verify-docker-digests.sh; echo RC=$?'` — the `echo` is the last command in
   that shell, so it consumes the status too, which is why `process exit == RC` came back
   **False** with RC=1. A `;` chain inside one `bash -c` is the same trap as a pipe.

The rule this project keeps re-learning, now with a fresh instance: **run the thing alone,
or read the status out of a file — never off the end of a pipeline or a chain.** A supply-chain
gate that reports drift and exits 0 would be worse than no gate, which is exactly why the
false reading was worth chasing down rather than accepting.

## Provenance

- Gate: `scripts/verify-docker-digests.sh` (this round added its floor and self-test).
- Detected: 2026-10-23, running the gate by hand while writing its self-test.
- Related: `docs/records/findings/` sibling finding on the retracted `--self-test`
  placement is in the commit message of the self-test commit.
