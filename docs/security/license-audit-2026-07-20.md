# License Audit — 2026-07-20

<!-- Audit stamp: 2026-09-09 . DSH . status: HISTORICAL-RECORD, annotated not rewritten .
The two copyleft rows were re-checked against the manifests in the local registry cache and
both still hold in substance: unescaper is "GPL-3.0/MIT" and r-efi offers MIT, so
"No pure copyleft licenses detected" survives, and ui/package-lock.json still has zero
GPL-family licenses. What changed is coverage and the facts around the rows: r-efi is not an
oz-hal dependency (getrandom pulls it), the crate count moved from 27 to 35 members,
the UI direct-dependency count from 32 to 38, the website/ tree was never audited and does
carry LGPL-3.0-or-later packages, and no live workflow runs cargo deny. Details in the
Currency block below; the record above is untouched.
-->

## Summary

Run: `cargo license` (cargo-license v0.7.0)

### Findings

| License | Count | Risk | Notes |
|---------|-------|------|-------|
| MIT | ~180 | ✅ None | Most common Rust license |
| Apache-2.0 | ~60 | ✅ None | Compatible with MIT |
| MIT OR Apache-2.0 | ~40 | ✅ None | Dual-licensed permissive |
| SEE LICENSE IN LICENSE | 27 | ✅ Internal | All kasir.mu crates — proprietary |
| BSD-3-Clause | ~10 | ✅ None | Permissive |
| GPL-3.0 OR MIT | 1 | 🟡 Low | `unescaper` — MIT option available |
| LGPL-2.1 OR MIT | 1 | 🟡 Low | `r-efi` — MIT option available |
| MPL-2.0 | ~3 | 🟡 Low | Weak copyleft — file-level only |
| ISC, Zlib, BSL-1.0, Unicode-3.0 | ~10 | ✅ None | Permissive |

### Copyleft Analysis

**No pure copyleft licenses detected.** The two GPL/LGPL-licensed dependencies (`unescaper`, `r-efi`) are both dual-licensed with MIT, allowing the project to use them under the MIT terms.

| Dependency | License | Usage | Resolution |
|-----------|---------|-------|------------|
| `unescaper` | GPL-3.0 OR MIT | String unescaping utility | Use under MIT |
| `r-efi` | LGPL-2.1 OR MIT | UEFI runtime (oz-hal) | Use under MIT |

### UI Dependencies

Run: `npm ls --all` (10 prod + 22 dev = 32 total)

All UI dependencies are MIT, Apache-2.0, or BSD-licensed. No GPL or copyleft packages found in `node_modules`.

### Distribution Impact

- **Desktop app**: Ships as compiled binary — dynamic linking of system libraries (webkit2gtk, gtk3) uses LGPL, which is acceptable for binary distribution with separate .so/.dll files.
- **Cloud server**: Docker image ships with statically-linked musl binary. No GPL dependencies linked.
- **Tablet app**: Android/iOS packaged via Tauri. No copyleft concerns.

### Recommendation

No action required. All copyleft-licensed dependencies are dual-licensed with MIT, and the project uses them under MIT terms. Annual re-audit recommended.

---

## Currency (re-checked 2026-09-09 against branch 0.0.37 — annotation only; the record above is unchanged)

The conclusion survives: nothing in the tree is forced to ship under a copyleft term. What does not survive is the evidence around it.

- **"`r-efi` … UEFI runtime (oz-hal)" — wrong attribution.** `crates/oz-hal/Cargo.toml` has no `getrandom` or `r-efi` entry, and the lock shows its only two consumers are getrandom 0.3.4 and 0.4.3 (`Cargo.lock:2249`, `Cargo.lock:2262`). It is a transitive UEFI-target backstop of the RNG, reached from many places, not an oz-hal dependency. The attribution that actually belongs to oz-hal is the row above it: `unescaper` (`Cargo.lock:7797`) is pulled by serialport 4.9.0, and `crates/oz-hal/Cargo.toml:21` is `serialport = { workspace = true }`.
- **Both license strings are stated imprecisely, in the safe direction.** r-efi is published as `MIT OR Apache-2.0 OR LGPL-2.1-or-later` (three-way, not the dual recorded here) and appears at two versions (5.3.0 `Cargo.lock:5492`, 6.0.0), not one; unescaper is `GPL-3.0/MIT`. The "MIT option available" resolution holds for both. Re-measure: `grep -A1 'name = "r-efi"' Cargo.lock`.
- **"27 kasir.mu crates" is now 35.** `cargo metadata --no-deps` lists 35 workspace members, all with `license = "SEE LICENSE IN LICENSE"`, and `deny.toml` carries 36 `[[licenses.clarify]]` entries. Re-measure: `cargo metadata --no-deps --format-version 1`.
- **"10 prod + 22 dev = 32 total" is now 38.** `ui/package.json` holds 15 direct dependencies + 23 devDependencies, and `website/package.json` (13 + 7) was never in this audit's scope. Re-measure: `npm ls --all` from each directory.
- **The node_modules sweep covered one of three lockfiles.** `ui/package-lock.json` is still copyleft-free (MIT 487, ISC 41, Apache-2.0 33, BSD-3 9, BSD-2 9 — zero GPL-family), so the sentence holds where it was measured. But `website/package-lock.json` carries **28 LGPL-3.0-or-later entries** — the `@img/sharp-libvips-*` prebuilt binaries of `sharp`, the site's image pipeline. That is a coverage gap, not a contradiction of the UI finding, and it is unassessed for the marketing-site deployment. Re-measure: count `"license": ".*GPL` per lockfile.
- **"Cloud server: Docker image ships with statically-linked musl binary" is false as written.** `Dockerfile.server:20` builds on `rust:1.88-slim` (Debian, glibc), `Dockerfile.server:151` is a plain `cargo build --package oz-cloud-server --release` with no `--target *-musl`, and `Dockerfile.server:155` runs on `debian:bookworm-slim`; `Dockerfile.unified:43/158/166` is the same shape. A grep for `musl` across the repo's Dockerfiles hits only `apps/license-server/Dockerfile:18` (`apk add --no-cache gcc musl-dev`, an Alpine Go build for the license server, and there `CGO_ENABLED=1` at line 29 means it is *not* statically linked either). The only genuinely static artifact is `Dockerfile.unified:39` (`CGO_ENABLED=0`, modernc sqlite). This matters because the copy-left analysis for a shipped binary depends on static-vs-dynamic linking, and the cloud-server image links glibc dynamically.
- **"Tablet app: Android/iOS packaged via Tauri"** describes a pipeline that no longer runs: mobile release workflows are `.bak` (`release.yml:24` says "Mobile (android.yml.bak / ios.yml.bak). Never part of this file"), so nothing today produces the Android/iOS artifacts whose licensing this row cleared.
- **Nothing enforces any of this.** `deny.toml` declares a fail-closed license allow-list and 36 clarify blocks, but no live workflow runs `cargo deny` — `scripts/gates.json` records gate `security-pr` as retired with the note "cargo audit and cargo deny appear in neither dev-ci.yml nor check.sh". That is a config finding, flagged not fixed. The "Annual re-audit recommended" line also has no owner: the 2026-07-20 record is the only one that exists.

> last audited 09-09-26 by docs-auditor
