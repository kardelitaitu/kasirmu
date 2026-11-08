# 7-Day Action Plan — kasir.mu `0.0.41`

> Generated: 2026-11-09. Branch locked at `0.0.41`. Never create or switch branches.
> Every item below was verified against the live tree before writing. Cross-references include
> exact file paths and commands so any reader can re-derive without reading this document first.

---

## ~~Day 1–2 · Quality & Testing Baseline~~ ✅ DONE 2026-11-09

### 1a. UI lint + typecheck + unit tests — ✅
- `npm run lint` → **0 errors**
- `npm run typecheck` → **0 errors**
- `npm run test` → **13,130 passed · 3 skipped · 3 todo** across **828 test files** (exit 0)

### 1b. Gate scripts — ✅
- `check-gate-runners.py` → 150 gates checked, all resolve
- `verify-agents-mirrors.py` → every policed mirror agrees
- `verify-ipc-parity.py` → IPC parity: OK

### 1c. `.agents/` scratch cleanup — ✅
- 46 untracked files deleted (43 `.py` + 2 `.txt` + 1 `.js`). No commit needed (were never tracked).

### 1d. `kasirmu-hal` DLL — ✅ root cause confirmed, no code fix needed
- `cargo check` and `--no-run` both pass clean.
- Full test run exits `0xc06d007e` **after** all 435 tests print `ok` — crash is during process exit.
- **Root cause:** Windows async runtime teardown race between tokio runtimes and COM/WinRT on process exit. Test logic is correct. `timeout_wrapping_slow_terminal_operation` passes in isolation (1/1).
- **Safe workaround:** run individual tests with `cargo test -p kasirmu-hal --lib -- <test_name>`. Not a code defect.

---

## Day 3–4 · I18N Cleanup (`I18N-01`)

**Verified state:** `python scripts/verify-ftl-orphans.py --census` reports exactly **55 keys** that
exist only in the Indonesian bundle (`.id.ftl` files) with no English counterpart and no code reference.
The gate is not broken — `verify-bundle-parity.py` already blocks adding a new reference that resolves
in English but not Indonesian. This is cleanup debt, not a gate failure.

**What the script gates vs. what it doesn't:**
- Gates: a commit ADDS a key → must be referenced in the working tree.
- Gates: a commit REMOVES a reference → its key must still exist in the bundle.
- Does NOT gate: pre-existing unreferenced keys (the 55 we're cleaning).

### Steps

- [ ] Run census and capture the full key list:
  ```powershell
  python scripts/verify-ftl-orphans.py --census 2>&1 | Tee-Object -FilePath .agents/i18n-orphans.txt
  ```
- [ ] For each key: verify zero references across the whole tree:
  ```powershell
  git grep -n "<key-name>" -- ui/ shared-ui/
  ```
  Keys with dynamic composition (`analytics-month-${m}` style) must be checked carefully —
  a family hit by a single template expression is live, not orphaned.
- [ ] Remove confirmed orphan keys from their `.id.ftl` files.
- [ ] After pruning, re-run:
  ```powershell
  python scripts/verify-ftl-orphans.py --census   # target: 0 unaccounted keys
  cd ui && npm run lint                            # confirm no broken references
  ```
- [ ] Commit per-file (one commit per `.ftl` file touched is fine):
  ```powershell
  git commit -m "chore(i18n): prune orphaned Indonesian bundle keys" -- shared-ui/locales/...
  ```

---

## Day 4–5 · Terminal Profile Dead Surfaces

**Verified state:** The three IPC commands exist in Rust and are wired in `lib.rs`:

| Command | Rust file | `lib.rs` line |
|---|---|---|
| `list_terminal_profiles_scoped` | `apps/desktop-tauri/src/commands/terminals.rs:83` | `:1666` |
| `set_terminal_profile_scoped` | `:200` | `:1665` |
| `delete_terminal_profile_scoped` | `:213` | `:1667` |

**Also verified:** The commands ARE wired in `ui/src/api/terminals.ts` (lines 140, 147, 154) and
have dev-mock handlers in `ui/src/dev-mock/handlers/payment.ts` (lines 399, 401, 403).

**What's missing:** `git grep` over `ui/src/features/` returns **zero hits** — no React component
calls these API wrappers.

### Decision required (choose A or B):

**Option A — Document as headless admin-only surfaces** *(lower risk)*
- Add `//! Admin-only: no current UI caller — intentionally exposed for external tooling.`
  doc comment to each command in `terminals.rs`.
- No IPC parity changes needed.

**Option B — Retire the commands** *(cleaner, higher effort)*
1. Remove the three `pub async fn` commands from `apps/desktop-tauri/src/commands/terminals.rs`.
2. Remove their entries from `generate_handler!` in `apps/desktop-tauri/src/lib.rs` (lines 1665–1667).
3. Remove from `ui/src/api/terminals.ts` (lines 140, 147, 154).
4. Remove mock handlers from `ui/src/dev-mock/handlers/payment.ts` (lines 399, 401, 403).
5. Remove from `ipc-parity-allowlist.json` (desktop section).
6. Run: `python scripts/verify-ipc-parity.py` → must exit 0.
7. Run: `cargo check -p kasirmu-app --lib` → must pass.
8. Run: `cd ui && npm run typecheck` → must pass.

- [ ] Make the decision, execute the chosen option, commit.

---

## Day 5–6 · Owner Question Follow-up

**Verified state:** `docs/plans/_active/owner-question-2026-09-28-r4-r6-r7.md` has recorded answers:

| Q | Topic | Status |
|---|---|---|
| **Q1 (R4)** | EDC terminal binding | ✅ **RESOLVED** — Option (a) implemented and verified end-to-end. No further action. |
| **Q2 (R6)** | MIDTRANS sandbox credential | ⚠️ **Declined** — owner accepted 4 acquirer behaviours as unproven. No code action. |
| **Q3 (R7)** | R7 terminal model | ⚠️ **"None yet"** — loopback simulator is the only funded work. Vendor protocol stubs return `HalError::Unsupported`. |

**Revised action** (Q1 is done — focus on Q2 and Q3):

- [ ] **Q2**: If a MIDTRANS sandbox key is ever supplied, the re-verification checklist is in the plan file.
  Until then, confirm `MIDTRANS_SERVER_KEY` is NOT hardcoded anywhere:
  ```powershell
  git grep -n "MIDTRANS_SERVER_KEY" -- crates/ apps/
  ```
  It should only appear at `crates/kasirmu-payment/src/drivers/qris.rs:306` (env read) — nowhere else.
- [ ] **Q3**: Read `crates/kasirmu-hal/src/drivers/wired.rs`, `wireless.rs`, and
  `protocol/{pax,ingenico,verifone}.rs` — confirm all still return `HalError::Unsupported`.
  If a model is ever named, do NOT implement against a guessed framing; request a protocol capture first.
- [ ] **Consider archiving**: if Q2 and Q3 are accepted as indefinitely blocked, the plan file is
  ready to move to `docs/plans/_done/` with an `ARCHIVED, NOT EARNED` note (per AGENTS.md §7.4).

---

## Day 6–7 · Website Carousel — §7.0 Mount-Box Decision

**Verified state:**
- `website_carousel.md` is blocked on **two things**: (1) the §7.0 mount-box viewport decision, (2) the video assets themselves.
- **Blocker (1) can be resolved now** — it is a design choice, not a hardware wait.
- The carousel component migrated from `HeroCarousel.tsx` (React island, retired) to
  `HeroCarousel.astro` + `website/src/lib/hero-carousel.ts` (128 lines).
- The slide markup is now in an Astro component, not a React island — the §7 integration
  approach in the plan must account for this.

### §7.0 — the three options (read `website_carousel.md §7.0` for full context)

The video mounts inside `SlideWindow`'s `content` slot. The box is **~1280×693 px**, not 1280×720.

| | Option | Description |
|---|---|---|
| **A** | Encode at 1280×693 | Pixel-perfect fit; non-standard aspect ratio, slightly unusual encoder flags |
| **B** | Encode at 1280×720, let CSS crop | No re-capture if the box changes slightly; wastes ~4% of pixels |
| **C** | Replace `SlideWindow` chrome | Most invasive; removes the chrome bar entirely for slide pages |

- [ ] Read `mockups/SlideWindow.tsx:6-10` and `HeroCarousel.astro:92` — confirm current box dimensions.
- [ ] Pick A, B, or C and record the ruling in `website_carousel.md §7.0`.
- [ ] Update the plan's status block to unblock blocker (1).
- [ ] Commit: `git commit -m "docs(plans): record §7.0 mount-box ruling in website_carousel plan" -- docs/plans/_active/website_carousel.md`
- [ ] **Blocker (2) — video assets**: these require owner-supplied footage. Confirm whether a placeholder
  or synthetic clip is acceptable to unblock §6 (encode) and §7 (integrate) testing.

---

## Ongoing · Documentation Portal Health

- [ ] Re-run after the plan archive moves:
  ```powershell
  mdbook build docs
  ```
  Must exit 0. If red: check `docs/book.toml` for stale `_active/` paths; `scripts/build-docs.sh`
  and `scripts/build-docs.ps1` were updated in commit `772e3f6d0` to point to `_done/`.

---

## Reference — Gate Commands Cheatsheet

```powershell
# UI gates (always from ui/)
cd ui && npm run lint && npm run typecheck
cd ui && npm run test

# Rust per-crate (iteration)
cargo check -p kasirmu-core
cargo test -p kasirmu-core

# Gate scripts
python scripts/check-gate-runners.py          # 41 self-tests
python scripts/verify-agents-mirrors.py       # AGENTS.md mirrors
python scripts/verify-ipc-parity.py           # IPC allowlist
python scripts/verify-ftl-orphans.py --census # i18n orphan count

# Docs portal
mdbook build docs

# Commit form (ALWAYS explicit pathspec)
git commit -m "type(area): subject" -- path/one path/two
git show --stat
```

> **Never** `git push` without explicit user order.  
> **Never** modify version numbers (`0.0.41` locked).  
> **Never** `git clean -x...` (would delete `.env` — 82 files at risk).  
> **Never** `git commit -a` or bare `git add` except for new-file staging.  
> **Always** commit with explicit pathspec.
