# Seven pinned base-image digests have drifted, unnoticed

**Date:** 2026-10-23 · **Severity:** high · **Status:** open (needs an owner decision)

## What was found

`scripts/verify-docker-digests.sh` re-resolves every `image:tag@sha256:...` pin in the
six Dockerfiles and Compose files against the live registry. Run against the tree on
2026-10-23 it reports **7 drifted pins across 6 distinct images**:

| Image | Pinned | Registry now |
|---|---|---|
| `debian:bookworm-slim` | `88200866dfff…` | `7ff6ba31527b…` |
| `caddy:2-alpine` | `5f5c8640aae0…` | `eb4d35b7452d…` |
| `alpine:3.22` | `14358309a308…` | `2e0b81d60597…` |
| `public.ecr.aws/docker/library/redis:7-alpine` | `ff02b58f971e…` | `57e4255cc971…` |
| `postgres:16-alpine` | `cf78e76683b9…` | `f46107955874…` |
| `rust:1.88-slim` / `golang:1.25-alpine` | — | still current |

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
- **Or pin frozen digests** and treat any future drift as a finding worth investigating.
- **Or wire the scan** on a schedule (the retired workflow's cron was `0 5 * * 1`) and
  accept that a weekly job will go red whenever upstream rebuilds a base image.

Wiring the scan without settling the first question would produce a gate that is
permanently red for a reason nobody agreed to — the failure mode that gets gates muted.

## Provenance

- Gate: `scripts/verify-docker-digests.sh` (this round added its floor and self-test).
- Detected: 2026-10-23, running the gate by hand while writing its self-test.
- Related: `docs/records/findings/` sibling finding on the retracted `--self-test`
  placement is in the commit message of the self-test commit.
