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
3 references) are not drifted at all. The number that matters for a refresh is 5 images; the
number that matters for a diff is 7 lines.

Three of the six were re-queried independently (`docker buildx imagetools inspect`) and
returned exactly the digests the gate reported, so the finding is not an artefact of the
gate's own parsing.

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
