# UI CI gates, re-verified at HEAD (2026-10-13, round 76)

## Why this note exists

`docs/records/audits/rust-gates-at-head.md` (round 75) recorded the Rust legs and, more
usefully, the reason the earlier check had been wrong: it ran `--lib` where CI runs
`--all-targets`. This is the UI half, run against the commands `dev-ci.yml#ui-test`
actually invokes rather than the ones this session happened to use.

## What was run, exactly as CI runs it

| CI step | Command | Result |
|---|---|---|
| UI typecheck | `cd ui && npm run typecheck` | **clean** (0 errors) |
| UI lint | `cd ui && npm run lint` | **exit 0**; 112 warnings, 0 errors |
| Exhaustive-deps ratchet | `python3 scripts/verify-exhaustive-deps.py` | **3 / cap 3** |
| Exhaustive-deps self-test | `... --self-test` | SELF-TEST OK (4 cases) |
| Vitest | `cd ui && npm test` | **12,639 passed, 755 files**, 0 failed |
| Analytics timezone invariance | `python3 scripts/check-tz-invariance.py` | PASS — 424 passed under 5 host zones |
| Bundle budget (desktop) | `cd ui && npm run bundle:check` | satisfied |
| Bundle budget (mobile) | `cd ui && npm run bundle:check:mobile` | satisfied |

`npm test` is `vitest run`, which is what this session has been running throughout, so
the vitest figure is the same measurement and not a re-run.

## Two things worth knowing before re-verifying

**1. `npm run lint` is `eslint .`, and it exits 0 on warnings.** A green run here does NOT
mean zero warnings — CI does not pass `--max-warnings`, so 112 warnings is a green CI. If
that policy ever changes, the number to watch is 112, not the exit code.

**2. The exhaustive-deps ratchet has NO headroom.** It sits exactly at the cap of 3, so
**any** new `react-hooks/exhaustive-deps` warning in the UI fails the ratchet outright,
 rather than the cap being loosened. Raising the cap is an explicit decision
(`scripts/verify-exhaustive-deps.py`), and the current state is the deliberate ceiling
recorded for this objective.

## What this does NOT cover

The Rust legs are in `rust-gates-at-head.md`. The `static-gates` job's ~40 steps are in
`static-gates-local-verification.md`. This covers `ui-test` only — and it does not run
`npm ci --no-audit --no-fund --ignore-scripts`, which is an environment step rather than
an assertion.