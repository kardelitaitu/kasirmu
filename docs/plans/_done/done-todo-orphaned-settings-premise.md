# The two orphaned settings components: the note's premise is off by one shell

> **RESOLVED 2026-10-25.** The premise correction in this file stands, and both components
> it describes now have a disposition:
>
> - `MachineIdStatus` / `get_machine_id` -- deleted in round 154 (`562eeac91`).
> - `EmailReportSettings` / the four email commands -- mounted in round 155 (`b4b13682e`),
>   with its two WRITES guarded for the tablet (which registers none of them) and its read
>   skipping the invoke there entirely.
>
> What this file argued still matters: the obstacle was never mobile work. A lane that
> trusted the old SecurityAccountScreen note would have built tablet commands nobody
> needed. The note itself was corrected at source in round 153.


**Measured 2026-10-25 (round 153) at HEAD `c3a1b295f`.** Supersedes the reasoning in
`docs/plans/_active/todo-dead-settings-surface.md` (round 151) on one point, and adds a
correction the source file's own note needs.

## The registrations, both shells

```
$ grep -n 'save_report_schedule|send_test_report|get_report_schedule|get_machine_id' apps/desktop-tauri/src/lib.rs
1421: commands::email::send_test_report,
1422: commands::email::get_report_schedule,
1423: commands::email::get_report_schedule_scoped,
1424: commands::email::save_report_schedule,
1739: commands::license::get_machine_id,
1740: commands::license::get_machine_id_scoped,

$ grep -n 'save_report_schedule|send_test_report|get_report_schedule|get_machine_id' apps/mobile-tauri/src/lib.rs
(nothing)
```

## What the existing note says, and what is actually true

`ui/src/features/settings/screens/SecurityAccountScreen.tsx:37-46` contains a careful note
that is RIGHT about the tablet and INCOMPLETE about the other half:

> The component cannot function on the tablet at all: ... registered in
> apps/desktop-tauri/src/lib.rs and in NO mobile registration list ... So the SMTP form is
> desktop-only functionality whose shell does not ship it ... Do not add one without the
> mobile commands landing first.

Every clause there is true. What it leaves a reader concluding is that the ONLY obstacle is
the missing mobile commands, and therefore that the desktop is fine. It is not: the desktop
registers all four commands and **nothing renders the component there either**. The blocking
fact is not the shell asymmetry. It is that `EmailReportSettings` has no mount in any file.

`MachineIdStatus` is the same shape in a smaller way: `get_machine_id` is registered by the
desktop (`:1739`), and the component is rendered nowhere. It was replaced in `20bb94c5c8`
("unified StatusBar with latency-based colored SVG icons", 2026-09-01), which deleted
`<MachineIdStatus />` and its import from the license activation screen; the component file
was left behind.

## How each lost its mount — both were DELIBERATE

- `MachineIdStatus`: replaced by `StatusBar`. `git show 20bb94c5c8 -- ui/src` shows the
  import and the JSX element both removed.
- `EmailReportSettings`: orphaned by `75eb83d7c5`, which rebuilt the settings nav as a flat
  page list. That commit's message enumerates the keys whose "last production reference this
  commit removes" — the same cleanup, applied to strings and not to the component.

So neither is a regression. Both are a replacement that landed without retiring the thing it
replaced.

## The decision, stated so it can be made

| Option | Cost | Effect |
|---|---|---|
| Delete both components + their tests | loses 50 passing tests, `@/api/email` becomes orphaned and its 4 commands unclaimed | closes 3 scoped-reads findings, unlocks `--strict` on the reachability gate |
| Mount `MachineIdStatus` in diagnostics | one JSX line | closes 1 finding |
| Mount `EmailReportSettings` in a desktop settings section | a nav entry; desktop-only is honest there | closes 2 findings, restores a shipped feature |

The third option is the one worth weighing seriously, because the alternative is that the
product HAS desktop SMTP report scheduling registered and unreachable — commands a user paid
for the backend of and cannot open. Deleting the component would not delete those commands,
so the runtime surface would stay and only the UI would disappear.

**This lane is not taking that decision.** It is a product call about whether email reports
ship. What is recorded here is that the choice is NOT blocked on mobile work, which is what
the source note implies and what would otherwise send the next lane building tablet commands
nobody needs.

## Filed by

The round-153 lane. No production file edited for this item; the round's fix went to the
reachability gate's evidence instead.

---

**ARCHIVED, NOT EARNED.** Moved to `_done/` because its subject is resolved -- verified by the same two commits plus the premise correction --
not because an acceptance command in this file ran and passed. This file never declared one:
it is a MEASUREMENT record, not a task with a testable end state. The `done-` prefix here
means "nothing further is owed by this file", which is the fact worth carrying.

Evidence: 562eeac91; b4b13682e; note corrected at source in SecurityAccountScreen.tsx.

See AGENTS.md 7.4 -- archival and acceptance are different facts and the filename carries
only one of them.
