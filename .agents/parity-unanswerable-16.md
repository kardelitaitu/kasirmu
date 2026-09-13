# the sixteen dev-mock commands the parity gate calls unanswerable, and what each allowlist entry says about them

measurements: gate reading at tip `226fec2ee`, 2026-09-13 09:08:44 +0700; pin mirror,
registration checks and allowlist line numbers at tip `fa88a9296`, 09:11:53 +0700. the
historical 280-failure reading belongs to tip `b7397ad60`, 08:54 +0700, and to script blob
`2f588cc79131292cc772815f01f3be2313215823`. this branch moved repeatedly while this file was
being written — every figure names the tip and the minute it was taken, and nothing here
should be trusted across a dev-mock commit without re-running the queries.

## what this file replaced, and why the first framing was wrong

an earlier draft of this document called the sixteen "real mock debt behind a 290-failure
gate". both halves were wrong, in different ways.

the red was mostly not debt. at `b7397ad60` the gate printed `FAIL: 280 IPC parity
violation(s)`, of which 278 were dev-mock lines, on a reading of `215 handlers registered,
0 more answerable via the scoped alias rule, 294 of 453 UI commands unanswerable`. that
reading came from an extractor that named one file (`scripts/verify-ipc-parity.py:130`,
read once at `:161`) while 322 of the registry's keys had already moved into
`ui/src/dev-mock/handlers/*.ts`, and whose alias-rule presence check at `:166-167` could
not match because the pass itself now lives at `ui/src/dev-mock/core/mockDispatcher.ts:84`
— so 205 flagged names were registered outright, 73 more were served by the alias rule, and
16 were left. the arithmetic of that reading is 205 + 73 + 16 = 294.

the extractor was fixed mid-classification by another session, `cb0175ce26` at 09:03:36
+0700, and the gate now reads `info[dev-mock]: 536 handlers registered across 12 of 17 files
under ui/src/dev-mock (router 214, extracted modules 322 new), 148 more answerable via the
scoped alias rule` and `info[dev-mock]: 16 of 453 UI commands unanswerable (16
allowlisted)` — 16 allowlisted, contributing 0 failures (query: the two
`info[dev-mock]` lines above, plus `FAIL: 2 IPC parity violation(s)` whose two lines are
`tablet: UI invokes 'list_sync_conflicts_scoped'` and `tablet: UI invokes
'resolve_sync_conflict_scoped'`, both from `ui/src/api/syncConflicts.ts`). so the honest
shape of the old red is 278 phantoms plus 2 real cross-platform registration violations,
and the sixteen are not unfiled debt at all: they are a decision somebody already recorded.

## the sixteen, and what each entry records

`ui site` is the invoke call site. `rust command` is the command as registered in the
desktop shell (each of the sixteen appears exactly once in
`apps/desktop-client/src/lib.rs`; query: `git grep -c ::<name> --
apps/desktop-client/src/lib.rs`). `entry` is where the allowlist records it, by section and
line. the last column is the point of this file.

| ui site | rust command (file:line) | entry | reason the entry carries |
|---|---|---|---|
| `ui/src/api/topology.ts:179` `save_topology_template` | `apps/desktop-client/src/commands/topology/commands.rs:67` | `dev_mock` :233, `tablet` :160 | no reason recorded — the entry is a bare quoted string |
| `ui/src/api/topology.ts:192` `load_topology_template` | `apps/desktop-client/src/commands/topology/commands.rs:88` | `dev_mock` :221, `tablet` :125 | no reason recorded — bare string |
| `ui/src/api/topology.ts:203` `list_topology_templates` | `apps/desktop-client/src/commands/topology/commands.rs:102` | `dev_mock` :220, `tablet` :119 | no reason recorded — bare string |
| `ui/src/api/topology.ts:214` `delete_topology_template` | `apps/desktop-client/src/commands/topology/commands.rs:115` | `dev_mock` :218, `tablet` :60 | no reason recorded — bare string |
| `ui/src/api/gateway.ts:24` `gateway_status` | `apps/desktop-client/src/commands/settings.rs:259` (tablet twin `apps/tablet-client/src/commands/settings.rs:508`) | `dev_mock` :219, no tablet entry | no reason recorded — bare string |
| `ui/src/api/staff.ts:572` `refresh_picker_ticket` | `apps/desktop-client/src/commands/auth.rs:294`, forwarding to `crates/oz-bridge/src/auth.rs:739` | `dev_mock` :232, `tablet` :152 | no reason recorded — bare string |
| `ui/src/api/localApi.ts:28` `local_api_status_scoped` | `apps/desktop-client/src/commands/local_api.rs:275` | `dev_mock` :227, `tablet` :131 | no reason recorded — bare string |
| `ui/src/api/localApi.ts:32` `local_api_set_enabled_scoped` | `apps/desktop-client/src/commands/local_api.rs:291` | `dev_mock` :224, `tablet` :128 | no reason recorded — bare string |
| `ui/src/api/localApi.ts:36` `local_api_set_port_scoped` | `apps/desktop-client/src/commands/local_api.rs:306` | `dev_mock` :225, `tablet` :129 | no reason recorded — bare string |
| `ui/src/api/localApi.ts:43` `local_api_set_store_scoped` | `apps/desktop-client/src/commands/local_api.rs:320` | `dev_mock` :226, `tablet` :130 | no reason recorded — bare string |
| `ui/src/api/localApi.ts:51` `local_api_rotate_secret_scoped` | `apps/desktop-client/src/commands/local_api.rs:340` | `dev_mock` :223, `tablet` :127 | no reason recorded — bare string |
| `ui/src/api/localApi.ts:59` `local_api_mint_token_scoped` | `apps/desktop-client/src/commands/local_api.rs:358` | `dev_mock` :222, `tablet` :126 | no reason recorded — bare string |
| `ui/src/api/products.ts:403` `products_set_image_scoped` | `apps/desktop-client/src/commands/products_images.rs:67` | `dev_mock` :231, `tablet` :149 | no reason recorded — bare string |
| `ui/src/api/products.ts:411` `products_clear_image_scoped` | `apps/desktop-client/src/commands/products_images.rs:102` | `dev_mock` :229, `tablet` :147 | no reason recorded — bare string |
| `ui/src/api/products.ts:418` `products_list_images_scoped` | `apps/desktop-client/src/commands/products_images.rs:120` | `dev_mock` :230, `tablet` :148 | no reason recorded — bare string |
| `ui/src/api/sales.ts:257` `preview_promoted_total_from_lines_scoped` | `apps/desktop-client/src/commands/pos.rs:254` (tablet twin `apps/tablet-client/src/commands/pos.rs:1265`) | `dev_mock` :228, no tablet entry | no reason recorded — bare string |

present 16 of 16, absent 0 — the whole set is at
`scripts/ipc-parity-allowlist.json:218-233` (query: `git grep -n '"<name>"' --
scripts/ipc-parity-allowlist.json`, one per row; 14 of the 16 also appear in the `tablet`
section at :60, :119, :125-:131, :147-:149, :152, :160, and 0 of the 16 appear in the
`desktop` section, which runs :3-:31).

"no reason recorded" is not a shortfall of diligence by whoever filed them, it is a
structural property of that section: `dev_mock` is a JSON array of 16 quoted strings
(`:217-234`), and a JSON array cannot carry a per-element note. the only prose attached to
the section is one section-level key, `_dev_mock_comment` at
`scripts/ipc-parity-allowlist.json:216`, a 2,773-character string that opens:

> "UI command strings that ui/src/dev-mock/tauri-api.ts cannot answer: no handler of its own
> and no unscoped twin for the alias rule to reach, so invoke() resolves to null in browser
> dev preview. That silent null is the R36-02 failure mode the mock itself warns about, so
> every entry here is recorded debt, not a clean pass."

it then tells the history of five named commands — `list_role_holders_scoped`,
`list_security_events_scoped`, `export_audit_log_scoped`,
`mark_audit_reviewed_scoped`, `get_audit_review_status_scoped` — and 0 of those five is
among the sixteen (query: `git grep -c '"<name>"' -- scripts/ipc-parity-allowlist.json`
against the text of line 216). so the section carries a class-level rationale and a
clearance history, and attaches a reason to none of these sixteen names. the other sections
are no different in kind: `_comment` at :2 and `_scoped_orphans_comment` at :215 are also
section-level, which is why `scoped_orphans` prints its per-entry triage from code rather
than from the file (`scripts/verify-ipc-parity.py:430-438` in the pre-fix blob; the
equivalent in the repaired script is the `info[scoped-orphans]` line that names
`get_active_cart_scoped=SALES_PROCESS` and `list_active_carts_scoped=SALES_PROCESS`).

one more thing the comment records that is now stale: it defines the gap against
`ui/src/dev-mock/tauri-api.ts` alone, and the repaired gate defines it against the whole
`ui/src/dev-mock` tree — so the text that justifies these 16 entries describes a surface
that no longer exists, as of `cb0175ce26` at 09:03:36 +0700.

## which of the sixteen a scoped alias could serve

ten of them end in `_scoped`, six do not, and the answer splits exactly on that line.

**the six unscoped names** (`save_topology_template`, `load_topology_template`,
`list_topology_templates`, `delete_topology_template`, `gateway_status`,
`refresh_picker_ticket`) cannot be served by the alias rule at all, structurally: the pass
only ever writes a `_scoped` key out of an unscoped one
(`ui/src/dev-mock/core/mockDispatcher.ts:85-86`), so no alias output can ever equal one of
these names. each needs a handler of its own, or its call site goes away.

**the ten `_scoped` names** are serveable by the rule only in form, and not in substance.
in form: register any handler under the unscoped base and `mockDispatcher.ts:84-94` mirrors
it onto the scoped spelling, so the name resolves at `:116-119` instead of falling to the
`console.warn` + `return null` path at `:121-122`. in substance: 0 of the ten bases is a
command anywhere in the shells, measured as 0 hits each for `git grep -nw local_api_status
-- apps`, `local_api_set_enabled`, `local_api_set_port`, `local_api_set_store`,
`local_api_mint_token`, `local_api_rotate_secret`, `products_set_image`,
`products_clear_image`, `products_list_images`, `preview_promoted_total_from_lines` (0
hits for all ten, against the 426 `#[tauri::command]` declarations found across
`apps/desktop-client/src/commands` and `apps/tablet-client/src/commands`; query: count
matches of `#\[tauri::command\]\s*pub (async )?fn ([a-z0-9_]+)` over those two trees). the
alias rule exists to bridge the ADR #7 rename, unscoped handler keys against scoped call
sites (`mockDispatcher.ts:60-77`); there is nothing to bridge here. using it would mean
registering a mock handler under a name no backend implements, which costs the same handler
work and adds a fake key — so the shortcut saves 0 lines.

**where tablet and desktop actually differ.** 14 of the sixteen are desktop-only: the
desktop shell registers them and the tablet shell does not, which is why each carries a
second entry in the `tablet` section (the two lines quoted in the first section,
`list_sync_conflicts_scoped` and `resolve_sync_conflict_scoped`, are the same class of
gap for commands outside the sixteen). only two of the sixteen exist in both shells —
`gateway_status` (`apps/desktop-client/src/commands/settings.rs:259` /
`apps/tablet-client/src/commands/settings.rs:508`) and
`preview_promoted_total_from_lines_scoped` (`apps/desktop-client/src/commands/pos.rs:254`
/ `apps/tablet-client/src/commands/pos.rs:1265`) — and those two are absent from the
`tablet` allowlist for exactly that reason (query: membership in the `tablet` array, plus
`git grep -c ::<name> -- apps/desktop-client/src/lib.rs
apps/tablet-client/src/lib.rs` → 1 hit in each file for these two names, and 1 hit in the
desktop file only for the other 14). for those 14 the browser-preview gap and the
cross-platform gap are two independent facts about the same name, and the allowlist records
both, with no note on either.

## the localApi family and the computed-name pin: the claim i was handed is false

the brief that produced this file asserted that the localApi entries were computed names —
"the four computed-name localApi entries flagged as the shape that
`drift_pin_no_computed_command_names_in_ui` exists to catch" — and referred to the same
family as six elsewhere. that is false as written, and this file says so plainly rather
than quietly dropping it.

measured at the cited lines: `ui/src/api/localApi.ts:28`, `:32`, `:36`, `:43`, `:51`
and `:59` are six string literals, each of the form
`loggedInvoke<LocalApiStatusDto>('local_api_..._scoped', { sessionToken, ... })` — the
command name is typed out in quotes at every one of the six. 0 of the six build a name at
runtime. the pin at
`apps/desktop-client/src/commands/registration_gate_tests.rs:864` is therefore not
flagging these commands and never could: it looks for `invoke(` followed by something that
is not a quote, and these lines put a quote immediately after the open paren.

what my sweep does show, mirroring the pin's own predicate over HEAD blobs of the 1,128
tracked `.ts`/`.tsx` files under `ui/src`: 103 `invoke(` sites counted, 100 of them
literal, 3 non-literal — `ui/src/__tests__/dev-mock-scoped-aliases.test.ts:65`,
`ui/src/__tests__/useSessionKeepalive.test.ts:25` and
`ui/src/dev-mock/core/mockDispatcher.ts:108` (this is a reimplementation of the predicate
in `registration_gate_tests.rs:852-869`, not a run of the crate). the desktop tolerance
list has five paths (`apps/desktop-client/src/commands/registration_gate_tests.rs:883-904`)
and covers all three, so the desktop pin's offender set is 0; the tablet tolerance list has
four (`apps/tablet-client/src/commands/registration_gate_tests.rs:830-841`), is missing
`dev-mock/core/mockDispatcher.ts`, and so its offender set is exactly 1, the forwarder at
`ui/src/dev-mock/core/mockDispatcher.ts:108`.

and the number that should actually be in front of the pin owner is the denominator: 103 is
small because the substring the pin searches for is `invoke(`, while the UI api layer calls
`loggedInvoke(` — capital `I` — so none of the 453 command strings the parity gate
extracts (`scripts/verify-ipc-parity.py:60-62` matches both spellings) is visible to this
ban. the desktop file already says that in its own words, on the entry it flags as "FOUND
TONIGHT, NOT PRE-AUTHORISED": "If logged-invoke is meant to be the only funnel, this ban
should be rewritten to run over its callers instead of over invoke( sites"
(`apps/desktop-client/src/commands/registration_gate_tests.rs:833-841`). a computed name
written in `ui/src/api` today would be invisible to the pin and fully visible to the
parity gate; that is the asymmetry, and it has nothing to do with the localApi six.

## reproduce

    # the gate, on the repaired extractor:
    python3 scripts/verify-ipc-parity.py
    #   -> info[dev-mock]: 536 handlers registered across 12 of 17 files under
    #      ui/src/dev-mock ... 148 more answerable via the scoped alias rule
    #   -> info[dev-mock]: 16 of 453 UI commands unanswerable (16 allowlisted)
    # the 294 / 278-of-280 reading belongs to the old extractor; it needs a worktree of
    # b7397ad60 (AGENTS.md blesses that over touching the shared tree):
    git worktree add <path> b7397ad60 && python3 <path>/scripts/verify-ipc-parity.py

    # per-name, one set per row of the table:
    git grep -n 'local_api_status_scoped' -- ui/src/api              # the call site
    git grep -n 'fn local_api_status_scoped(' -- apps crates          # the rust command
    git grep -nw 'local_api_status' -- apps                           # 0 hits: no base twin
    git grep -n '"local_api_status_scoped"' -- scripts/ipc-parity-allowlist.json
    git grep -c ::local_api_status_scoped -- apps/desktop-client/src/lib.rs         apps/tablet-client/src/lib.rs                                 # which shells register it

    # the pins, run for real rather than mirrored:
    cargo test -p oz-pos-app registration
    cargo test -p oz-pos-tablet registration

timing, because the branch is moving under the reader as well as it moved under me: gate
reading at `226fec2ee` 09:08:44 +0700, allowlist / registration / pin mirror at
`fa88a9296` 09:11:53 +0700, and the 294-reading at `b7397ad60` 08:54 +0700. three events
landed inside the span this document covers: `ui/src/dev-mock/handlers/locations.ts`
(`de174f09b`, 08:50:32 +0700, four minutes before the first gate reading — a sweep older
than that counts fewer registered keys and more gaps), the extractor fix `cb0175ce26`
(09:03:36 +0700), and `.gitignore` :260 `/.agents/devmock-*` (`b37ca2643`, 08:31:33
+0700), which is why this artifact is named `parity-unanswerable-16.md`: the path i was
assigned matched a scratch-lane ignore rule written 23 minutes before my first measurement,
so it could not enter a commit without `-f` or an edit to that shared file, and neither was
done.

## what this file does not claim

- it does not say the gate should be green, and it does not report a green gate: at
  `226fec2ee` it prints `FAIL: 2 IPC parity violation(s)`, and 0 of those 2 involve any of
  the sixteen.
- it proposes no allowlist edit — no addition, no removal, no reformat — and takes no
  position on whether these 16 entries stay or clear. the observation is that 16 of them
  carry no per-entry reason, which is a question for whoever filed them.
- it does not decide, for any of the sixteen, between writing a mock handler and removing
  the call site. the alias column answers only whether the rule could serve the name: for
  all sixteen it could not, usefully.
- it does not claim to have run either Rust pin test. the 103 / 100 / 3 figures and both
  offender sets come from reimplementing the predicate over HEAD blobs; the crate runs are
  listed above for whoever wants the primary reading.
- it does not claim the earlier "16 real gaps" count was wrong as a set. it was not: the
  sixteen identified then are these sixteen. what was wrong is calling them unfiled.
