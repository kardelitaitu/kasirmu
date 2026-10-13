# `LocalApiSection` is unreachable: a working feature with no UI path (round 112)

## The finding

`ui/src/features/settings/sections/LocalApiSection.tsx` is **476 lines** wiring the embedded
loopback REST API server: enable/disable, port, served store, secret rotation, token
minting. Everything it calls is implemented and registered.

| Layer | State |
|---|---|
| Rust commands | `apps/desktop-tauri/src/commands/local_api.rs` — `local_api_status_scoped`, `local_api_set_enabled_scoped` and the rest |
| Registration | `apps/desktop-tauri/src/lib.rs:1405-1406` — wired into `generate_handler!` |
| UI API layer | `ui/src/api/localApi.ts` — typed wrappers over `loggedInvoke` |
| UI section | `sections/LocalApiSection.tsx` — the whole control surface, written |
| **Route** | **ABSENT** |

The settings hub has THREE registration lists, and `local-api` is in **none** of them:

```
SETTINGS_SCREENS   (screens/registry.ts)          no 'local-api'
NAV_ITEMS          (SettingsNavTree.tsx)          no 'local-api'
KEPT_SECTIONS      (hooks/useSettingsHashSection.ts)  no 'local-api'
```

`KEPT_SECTIONS` is 13 entries; `SETTINGS_SCREENS` mounts 14. The section is not among them,
so `renderSection` cannot select it, no nav item reaches it, and no hash deep link is
accepted.

## Why this looks like an oversight, not a decision

**66 `settings-local-api-*` FTL keys** are in the bundles — intro, enabled, port, port
apply/invalid/applied/failed, store, rotate, mint. A removed feature does not leave its
localised copy. `messages` and `id` bundles both carry them.

**Its tests grade UI no user can reach** — `LocalApiSection.test.tsx` mounts it directly,
which is the shape `AboutSection` and `AppearanceSection` were stamped DEAD for.

**Those two ARE stamped, this one is not.** Both carry `// DEAD (2026-09-15 · HEAD
f0ad9b170e)` headers naming the missing registry key, the closed route and the orphan tests,
and saying "Comment only — the code below is deliberately untouched." `LocalApiSection` has
no such header. Whatever pass stamped those two either missed this one or judged it
different — and the reasoning is not recorded anywhere.

**The bridge-side gap is separately recorded and does not explain it.**
`docs/records/campaigns/manager-2-journal.md:286-287` parks `local_api` as an OWNER DECISION
because `BridgeCtx` has no port for long-lived services — that is about the command layer,
and the commands exist desktop-side. It says nothing about the missing route.

## What I did NOT do

**I did not wire it up.** Adding a section to three registration lists is small, but
`SettingsPage.test.tsx` asserts those three lists agree "in both directions", the tablet was
verified section-by-section on 2026-10-07, and enabling a **loopback REST server that accepts
long-lived tokens** is a security-relevant surface. Deciding whether it should be reachable
is an owner call, not a defect fix.

**I did not delete it either.** Two of its three siblings are stamped DEAD with a rationale;
this one is 476 lines of working, registered, token-minting code. Deleting on the assumption
that "unregistered" means "unwanted" would discard the decision rather than record it.

## What would settle it

Either the owner confirms the local API should be reachable, and the fix is a `local-api` key
in `SETTINGS_SCREENS` + `NAV_ITEMS` + `KEPT_SECTIONS` (and the `SettingsPage.test.tsx`
agreement assertion follows); or it should not, and the section joins its siblings under a
`// DEAD` header naming the reason. Both are recorded outcomes; the current state is the one
shape that cannot be read from the code.

## How it was found

Rounds 107-111 established that a module nothing imports is a place to look. A tree-wide
screen for production files with no importer produced 69 candidates — but `AGENTS.md` warns
that screens register LAZILY, and indeed almost all 69 are reachable via `registerPage`.
Re-checking by NAME narrowed it to 9; reading each eliminated 6 (two stamped DEAD, three
composed into live `screens/`), leaving this one.

The instrument that worked was not the grep. It was **reading the three registration lists
the code would have to appear in**, and finding a plausible-looking file absent from all
three while its backend, its API layer and its 66 localised strings are all present.