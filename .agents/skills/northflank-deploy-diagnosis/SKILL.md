---
name: northflank-deploy-diagnosis
description: Diagnose why a kasir.mu Northflank build or deploy failed, and prove the fix before spending another deploy cycle. Use when a Northflank build shows FAILURE with only "Failure on executing build", when a container exits at exec with "error while loading shared libraries", when the Dockerfile that Northflank builds diverges from ops/docker/Dockerfile.server, when a pkg-config or build-script failure appears in a Docker build log, or when the Northflank service/path/branch config is suspected to be stale. Covers the build-logs endpoint (buildId is a QUERY PARAM, not a path segment), the lineLimit ceiling and the useless pagination cursor, the PATCH-combined-service vs deprecated build-options distinction, enumerating a crate closure's pkg-config build scripts via cargo metadata plus resolved feature sets, verifying runtime shared libraries offline against already-built local images with ldd, the usrmerge `dpkg -S` trap, and the sandbox rule that Docker container egress is blocked so apt-get cannot be tested in a fresh container.
---

# kasir.mu — diagnosing a Northflank build/deploy failure

The service is `oz-pos` / `cloud`, built from `main`. A **successful build auto-deploys** (measured:
build `mint-cook-2048` succeeded 15:10Z, deployed 15:16Z), so a FAILURE build means the deploy simply
never happened — there is no separate deploy step to check.

**`oz-pos` below is the Northflank *project id*, not the brand — do not rebrand it.** The brand is
`kasir.mu`, but the Northflank project is still literally named `oz-pos`, and every endpoint here
takes it as a path segment (`/v1/projects/oz-pos/services/cloud/…`). Renaming the string makes the
URLs 404. The pre-rebrand image tags below (`oz-pos-cloud:*`, `oz-pos-unified:latest`) and the
`/app/oz-cloud-server` binary path name artifacts that really exist under those names, so leave them
too. Both `oz-pos` and `oz-cloud` are allow-listed in the drift guard's crate-prefix check
(`PREFIX_ALLOWLIST` in `detect.sh`), so this file produces **no** finding. If one ever reappears,
suspect the allowlist — not this doc.

**The hard constraint:** every Northflank build costs minutes and the fix only takes effect after it
reaches `main`. So do not push a guess. Get the build log, name the failing line, and prove the fix
locally first. A previous session burned two deploy cycles on a toolchain hypothesis that the build log
later disproved outright.

## 1. Get the build log — the endpoint is the whole trick

```bash
TOKEN=$(grep -m1 '^NORTHFLANK_API_TOKEN=' .env | cut -d= -f2- | tr -d '\r\n')
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.northflank.com/v1/projects/oz-pos/services/cloud/build-logs?buildId=<id>&queryType=range&direction=backward&lineLimit=250"
```

- **`buildId` is a QUERY PARAMETER.** `/build/{id}/log` and `/logs` return **404** — they are dead ends
  that a previous session mistook for "the log is unavailable".
- **`lineLimit` ceiling is below 3000.** `lineLimit=3000` → **HTTP 400** with zero lines. `250` works.
- **`pagination.cursor` is returned but ignored.** Passing it back returns the identical window. You
  cannot page past the first response this way. Fortunately one backward window from the failure usually
  covers the whole failing BuildKit step — check the step number on the first and last line to confirm.
- The token lives in the repo `.env` under the **pre-rebrand unprefixed** name `NORTHFLANK_API_TOKEN`
  (the `KASIRMU_`-prefixed names in AGENTS.md do not exist in `.env`, and the user-scope env var is
  empty in a bash tool session).
- `jq` is not installed; parse with the managed Python. `curl` is a Windows binary — do **not** pass it
  MSYS `/tmp/...` paths (writing to a `C:/...` path is fine).

## 2. Classify the failure before touching anything

| Log signature | Meaning |
|---|---|
| `error: failed to run custom build command for \`X\`` + `pkg-config ... Package Y was not found` | a **system library** is missing from the builder stage |
| `failed to solve: process "/bin/sh -c cargo build ..." did not complete successfully: exit code: 101` | a build script panicked (101 is the panic exit code) |
| `dockerfile not found` / build dies in seconds with no compile output | the configured **dockerFilePath is stale** — the Dockerfile moved |
| Container starts then dies with `error while loading shared libraries: libX.so.N` | a **runtime** package is missing (rare here — see §5) |

**A failed build script does NOT mean only one thing is missing.** Cargo aborts on the first failure, so
crates whose build scripts had not started yet never got their chance. Absence of a second error in the
log is *not* proof that a second library is present. Prove it by enumerating the closure (§3).

## 3. Enumerate every pkg-config build script in the closure (offline, decisive)

This replaces log-paging entirely.

1. `cargo metadata --locked --format-version 1 --offline` — works offline, and `--locked` guarantees you
   are reading the same graph the image will build.
2. Walk the closure from the root package (`kasirmu-cloud`, in `apps/cloud-server`).
3. For each package, open `<manifest_dir>/build.rs` and grep for `pkg[-_]config`.
4. **Read the resolved feature set** from `resolve.nodes[].features` for each hit. This is the step that
   matters — every one of these crates has an escape hatch a naive grep misses.

Worked result for `kasirmu-cloud` (2026-09-18, 458 packages in the closure) — exactly four crates probe
pkg-config, and only one is fatal:

| crate | resolved features | verdict |
|---|---|---|
| `libudev-sys 0.1.4` | `[]` | **FATAL** — build.rs:38 `pkg_config::find_library("libudev").unwrap()`, unconditional, no fallback |
| `libusb1-sys 0.7.0` | `[]` | safe — build.rs:221 falls back to `make_source()` (vendored C build); its own libudev probe at :161 is a soft `if let Ok` |
| `zstd-sys 2.0.16` | `['legacy','std','zdict_builder','zstdmt']` | safe — build.rs:276 probes only `if cfg!(feature = "pkg-config")`, not enabled → vendored |
| `libsqlite3-sys 0.28.0` | `['bundled',…]` | safe — build.rs:67 takes `build_bundled`; `bundled` arrives via rusqlite's defaults |

**The general rule:** a crate that *can* vendor is not a deploy risk even with the feature off, if its
fallback path is reachable. Read the `if` that guards the probe. Only an unconditional `.unwrap()` on a
missing system library is fatal.

**Dependency chain for the libudev family:**
`kasirmu-hal` → `serialport 4.9.0` → `libudev 0.3.0` → `libudev-sys 0.1.4`, and
`kasirmu-hal` → `rusb 0.9.4` → `libusb1-sys 0.7.0`. `kasirmu-hal` is why a *server* image needs udev.

## 4. The Dockerfile divergence class — the actual root cause here

`ops/docker/Dockerfile.server` and `ops/docker/Dockerfile.unified` build the **same artifact**
(`kasirmu-cloud`) but are maintained separately, and **nothing compares them**. The unified file had
silently omitted `libudev-dev` for five days while the server file had always installed it.

- The builder stage needs `pkg-config libc-dev libssl-dev libudev-dev`.
- `rust:1.88-slim` ships `cc`/`gcc` but **not** `pkg-config` and **not** `make`.
- The only related gate, `scripts/verify-dockerfile-workspace.py`, validates manifest COPYs and dummy
  src dirs only (it passes 42/42 for both files). It does **not** look at apt lists.
  `docs/plans/northflank-p1-p7-plan.md:26` already records that it does not validate the unified file.
- **Do not write a naive "-dev must have a runtime counterpart" rule.** There is no `libssl3` line
  despite `libssl-dev` (it arrives via `ca-certificates` → `openssl`), so such a check would be wrong.
  It needs an explicit build-only allowlist.

When you add a package, follow the house convention: a `DOCKER-NN` numbered comment explaining **why**
the package is required, what breaks without it, and which file diverged.

## 5. Verify the runtime half offline, against images that already exist

Before adding a runtime package, check whether the base image already has it. The repo has previously
built images that ship the real artifact, so linkage questions are answerable with no network:

```bash
docker run --rm --entrypoint sh <img> -c 'ldd /app/<binary>'
docker run --rm --entrypoint sh <img> -c 'ldconfig -p | grep libX'
```

- The binary is `/app/kasirmu-cloud` in current Dockerfiles but **`/app/oz-cloud-server` in pre-rebrand
  images** (`oz-pos-cloud:*`, `oz-pos-unified:latest`, `oz-pos-pos-cloud-server:latest`).
- **`debian:bookworm-slim` ALREADY ships `libudev.so.1`** (via `util-linux`) — proven by `ldconfig -p`
  inside `oz-pos-unified:latest`, whose runtime stage never installed `libudev1`. Adding `libudev1` to a
  runtime stage is belt-and-braces, not a requirement. `Dockerfile.server` does it anyway.
- TLS is `rustls` + `ring` — there is **no `openssl-sys`** in the closure, so no `libssl` runtime need.

**The `usrmerge` trap when checking package presence.** `dpkg -S /lib/x86_64-linux-gnu/libudev.so.1`
reports **no owner**, because bookworm is usrmerged (`/lib -> usr/lib`) and dpkg records the
`/usr/lib/...` path. Query the `/usr/lib` path. Likewise a `dpkg-query -f` format string containing an
invalid field prints empty output that looks exactly like "package not installed". Prefer
`dpkg -l | grep <pkg>` and `dpkg-query -W -f='${Package} ${Version}\n' <pkg>`.

## 6. Service configuration — two endpoints, one is deprecated

- **Use** `PATCH /v1/projects/{project}/services/combined/{service}` for a partial update. Verified
  working: `{"buildSettings":{"dockerfile":{"dockerFilePath":"/ops/docker/Dockerfile.unified"}}}` → HTTP
  200. Re-`GET` afterwards and confirm **both** `buildSettings` and `vcsData` moved.
- **Do not use** `POST .../build-options` — deprecated, and it wants a full-shape body, so a partial
  payload silently clears fields.
- `POST .../build` triggers a build.
- The live service id is **`cloud`**, in project **`oz-pos`**. `oz-pos-cloud` does not exist — the old
  branded name survives in `.github/workflows/dev-ci.yml`'s default and had to be corrected.

## 7. Sandbox limits — state these rather than guessing around them

- **Docker container egress is BLOCKED.** DNS resolves but TCP is refused
  (`connect (111: Connection refused)` to `deb.debian.org:80`). So `apt-get install` in a fresh container
  **cannot** be used to verify an apt line, and `apt-get update` appears to succeed while installing
  nothing — always surface the apt output instead of redirecting it to `/dev/null`.
- **crates.io is blocked** (`static.crates.io`, `index.crates.io` → HTTP 000), so no local Rust build can
  substitute for the image build.
- All four pinned base images ARE present locally: `debian:bookworm-slim` `88200866`,
  `rust:1.88-slim` `38bc5a86`, `caddy:2-alpine` `5f5c8640`. The local `golang:1.25-alpine` is
  `56961d79`, which is **not** the pinned `1ae0735f` — do not treat it as the pinned image.

## 8. Before pushing — check the merge is clean

`main` is protected by the same rule as everything else: never push without an explicit order.
Northflank builds `main`, so the fix must reach `main`; a branch push alone changes nothing.

```bash
MAIN=$(git ls-remote origin refs/heads/main | cut -f1)      # never trust a local origin/main ref
git log --oneline "$(git merge-base "$MAIN" HEAD)".."$MAIN"  # what main has that you lack
git cat-file -e "$MAIN":ops/docker/Dockerfile.unified        # does the configured path exist there?
git log --oneline "$(git merge-base "$MAIN" HEAD)".."$MAIN" -- ops/docker/   # conflicts?
```

Resolve remote shas with `git ls-remote`. A `git fetch` that prints `X..Y main -> origin/main` can leave
`git rev-parse origin/main` still returning the old sha.

## Checklist

1. Fetch the build log (§1). Do not theorise before you have it.
2. Read the **failing line and its step number**; confirm the window spans the whole step.
3. If it is a build-script failure, enumerate the closure's pkg-config crates and check resolved features
   (§3) — do not assume one missing library.
4. Compare the two Dockerfiles' builder apt lists (§4).
5. Before adding a runtime package, verify against a local image (§5).
6. Confirm the Northflank `dockerFilePath` and service id still exist (§6).
7. Prove what you can locally; state plainly what the sandbox prevented you from proving.
8. Ask for the push order, then merge to `main` and poll the build to conclusion.

> last audited 19-09-26 by Budak-Korporat
