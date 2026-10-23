# The tablet shell registers 27 fewer IPC commands than the shared UI calls

**Date:** 2026-10-24 · **Severity:** high · **Status:** open — needs an owner ruling on which
shell's command surface is authoritative (the BR-* family)

## What was measured

`scripts/verify-scoped-reads.py --shell tablet` reports **34 call sites across 27 distinct
commands** in `ui/src/`, all of them "not registered in that shell". Measured today:

| command | desktop (`apps/desktop-tauri/src/lib.rs`) | tablet (`apps/mobile-tauri/src/lib.rs`) |
|---|---|---|
| `clear_device_binding_scoped` | registered | — |
| `create_memo_scoped` | registered | — |
| `get_ap_aging_report_scoped` | registered | — |
| `get_device_binding_scoped` | registered | — |
| `get_terminal_profile_scoped` | registered | — |
| `list_workspaces_scoped` | registered | — |
| `open_product_images_scoped` | registered | — |
| `pg_sync_status_scoped` | registered | — |
| `publish_memo_scoped` | registered | — |
| `revise_memo_scoped` | registered | — |
| `update_workspace_instance_scoped` | registered | — |
| `activate_license` | registered | — |
| `load_topology` | registered | — |
| `load_topology_revision` | registered | — |
| … | **all 27** | **none of the 27** |

The 11 `_scoped` names exist in the Rust bridge (`crates/kasirmu-bridge`) and are registered by
the desktop shell; the tablet shell registers **zero** of them.

## Why this is not a checker artefact

Three facts rule out the artefact reading, each measured rather than assumed:

1. **Both shells load the same feature registry.** `ui/src/main.mobile.tsx:5,16` calls
   `registerAllFeatures()` — the same function `ui/src/App.tsx:3,8` calls. There is no
   shell filtering in `ui/src/features/index.ts`, so the tablet build registers the same pages
   as desktop.
2. **The screens carrying these calls are registered, and not shell-qualified.** e.g.
   `ui/src/features/locations/register.tsx` registers `TopologyScreen` at route `topology` with
   `requiredRole: 'manager'` and no platform guard, so it renders on both.
3. **The tablet entry is a real entry, not a stub.** `ui/index.mobile.html:195` loads
   `/src/main.mobile.tsx`, which `ui/vite.mobile.config.ts:118` builds to `dist-mobile` — the
   bundle `apps/mobile-tauri/tauri.conf.json` serves via `frontendDist`.

So a tablet user who opens Topology, Memos, Warehouse, Terminals, Email Reports or the POS
reaches code that invokes a command the shell does not expose.

## The two halves, which the current message conflates

| Class | Sites | Shape | Fix direction |
|---|---|---|---|
| **Registration gap** | 14 | Calls a `_scoped` command that EXISTS in the bridge but is not in `generate_handler!` for tablet | Register it in `apps/mobile-tauri/src/lib.rs` |
| **Scoping gap** | 20 | Calls an *unscoped* command (`load_topology`, `activate_license`, `get_machine_id`, `create_backup`, …) | Needs a scoped twin under the ADR #7 conditional, or a documented host-only reason |

The checker's closing advice — "Fix by routing through the scoped twin under the ADR #7
conditional" — fits the second half only. For the first half it is misleading: those commands
already ARE the scoped twin, and nothing is missing on the UI side at all.

## What the gate does and does not see

`--shell` defaults to `desktop` (`scripts/verify-scoped-reads.py:1124`), and both live runners
(`.github/workflows/dev-ci.yml:1537`, `scripts/check.sh:183`) run it bare. Desktop has **0**
findings, so CI prints `clean for desktop.` and exits 0 — while every finding lives in the other
section. The bare run does print an info line naming the ungraded shell's count, but its own
docstring (`:1252-1255`) states that no exit code branches on it.

Re-measured 2026-10-24: **101 findings when this was first filed (2026-09-14), 34 now.** The
backlog is two-thirds cleared by work that no CI log recorded, because the lane clearing it
cannot make the gate red.

## What an owner must decide

This is the same ruling the BR-* family needs (`audit-open-findings.md`: BR-S8/BR-X4/BR-S9/
BR-S10 — *which shell's gate set is authoritative*). The fork:

- **Register the commands in the tablet shell** — the direct fix for the 14 scoped sites, and it
  makes the tablet surface match the UI it already ships. Requires the bridge commands to be
  safe on tablet (session scoping, no host-only assumptions).
- **Or exclude these screens from the tablet build** — the alternative, and a larger change:
  `registerAllFeatures()` is shared, so it needs per-shell page filtering that does not exist
  today.
- **Or allowlist the 34 sites as documented tablet gaps** — honest about the state but leaves
  real runtime failures in place.

**And the convention for saying so already exists.** `ui/src/api/workspaces.ts:299` and
`ui/src/api/data.ts` carry four "Desktop-only: not registered on tablet (recorded product choice)"
comments, naming memo authoring and payables as the precedent. So the project HAS a way to record
a deliberate desktop-only command — applied **4 times** against **34** call sites. That half needs
no ruling: whichever option is chosen above, annotating the sites with the same line is the
cheapest, most honest part, and it is what the four existing comments were doing.

Applying the one-flag fix (`--shell desktop,tablet` in both runners) turns CI red against this
backlog, and the checker has no `--baseline` and no report-only mode, so it cannot be turned on
"yellow" first. **Sequencing is the owner's call, not a lane's.**

## Provenance

- Gate: `scripts/verify-scoped-reads.py` (`--shell tablet`).
- Found by re-measuring the tablet half of the gate while auditing open findings; the original
  finding is in `docs/records/findings/audit-open-findings.md` under the 2026-09-14 entry.
- Related: GI-6's suffix invariant (pinned this round in `scripts/verify-ipc-parity.py`), and
  the same `--shell` default documented at `verify-ipc-parity.py:1604-1608`.
