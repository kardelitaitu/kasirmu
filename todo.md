# 7-Day Action Plan — kasir.mu `0.0.41`

> Generated: 2026-11-09. Branch locked at `0.0.41`. Never create or switch branches.

---

## Day 1–2 · Quality & Testing Baseline

- [ ] `cd ui && npm run lint && npm run typecheck` — confirm zero ESLint + TypeScript errors
- [ ] `cd ui && npm run test` — run full Vitest suite, capture baseline pass count
- [ ] `python scripts/check-gate-runners.py` — confirm check.sh duplicate-runner gate is green
- [ ] Clean `.agents/` scratch leftovers:
  - Delete `r5*`, `r6*`, `r7*`, `r8*`, `r9*` measure/debug/probe/verify scripts
  - Delete associated `.txt` and `.js` output files
  - Commit removal: `git commit -m "chore(agents): remove session scratch files" -- .agents/...`
- [ ] Revisit `kasirmu-hal` test suite — determine if `STATUS_DLL_INIT_FAILED` / `0xc06d007e` exits are environment-specific DLL init or need mock injection in `crates/kasirmu-hal/src/drivers/mock.rs`

---

## Day 3–4 · I18N Cleanup (`I18N-01`)

- [ ] Enumerate the 55 Indonesian-only bundle keys:
  ```
  python scripts/verify-ftl-orphans.py --census
  ```
- [ ] For each key: check if there is a corresponding `.en-US.ftl` entry — if not, prune the key from the `.id.ftl` file
- [ ] Re-run `verify-ftl-orphans.py --census` after pruning — confirm count reaches 0
- [ ] Commit pruned `.ftl` files: `git commit -m "chore(i18n): prune 55 Indonesian-only orphan bundle keys" -- ...`
- [ ] Run `cd ui && npm run lint` to confirm no remaining reference to pruned keys

---

## Day 4–5 · Terminal Profile Dead Surfaces

Three IPC commands exist in `apps/desktop-tauri/src/commands/terminals.rs` with **no UI callers**:
- `set_terminal_profile_scoped`
- `delete_terminal_profile_scoped`
- `list_terminal_profiles_scoped`

- [ ] Search `ui/src/features/` to confirm zero live call sites (`search_graph` / grep)
- [ ] **Decision required** — choose one path:
  - **A. Document as headless admin surfaces** — add a `//! Admin-only: no UI` doc comment + note in `docs/operations/`
  - **B. Retire** — remove from `generate_handler!`, remove from `ipc-parity-allowlist.json` (desktop), remove mock handler
- [ ] If retiring: run `python scripts/verify-ipc-parity.py` after change — must stay green
- [ ] Commit whichever path is chosen

---

## Day 5–6 · Owner Question Follow-up

Active plan: `docs/plans/_active/owner-question-2026-09-28-r4-r6-r7.md`

Three open questions — all blocked on external input:

| Q | Topic | Blocked on |
|---|---|---|
| Q1 | EDC terminal binding — which terminal maps to which lane | Owner hardware config |
| Q2 | MIDTRANS credential rotation | Owner / MIDTRANS account access |
| Q3 | R7 terminal model confirmation | Physical device inspection |

- [ ] Review the plan file, confirm questions are still open
- [ ] Draft a short owner-facing checklist email/message covering Q1–Q3 to unblock
- [ ] If any question can be answered from the codebase alone, resolve it and update the plan

---

## Day 6–7 · Website Carousel Plan

Active plan: `docs/plans/_active/website_carousel.md`

Blocked on:
- Video assets (§7.0 mount-box decision)
- Mount-box viewport decision (can be resolved independently of assets)

- [ ] Read `docs/plans/_active/website_carousel.md` — identify every sub-decision gated only on video assets vs. those resolvable now
- [ ] Make the §7.0 mount-box viewport ruling if it does not require video assets
- [ ] Update the plan with the ruling + mark that section unblocked
- [ ] Commit plan update: `git commit -m "docs(plans): resolve §7.0 mount-box decision in website_carousel plan" -- docs/plans/_active/website_carousel.md`

---

## Ongoing · Documentation Portal Health

- [ ] `mdbook build docs` — confirm portal still builds cleanly after `_done/` path moves
- [ ] If red: check `docs/book.toml` and `scripts/build-docs.sh` for stale `_active/` references

---

## Reference — Gate Commands

```powershell
# UI gates (run from ui/)
cd ui && npm run lint && npm run typecheck
cd ui && npm run test

# Rust iteration (per-crate)
cargo check -p kasirmu-core
cargo test -p kasirmu-core

# Gate scripts
python scripts/check-gate-runners.py
python scripts/verify-agents-mirrors.py
python scripts/verify-ipc-parity.py
python scripts/verify-ftl-orphans.py --census

# Docs portal
mdbook build docs
```

> **Never** `git push` without explicit user order.  
> **Never** modify version numbers (`0.0.41` locked).  
> **Never** `git clean -x...` (would delete `.env`).  
> **Always** commit with explicit pathspec: `git commit -m "type(area): subject" -- path/one path/two`
