# Plans

A **plan** here is a task list with an owner and an acceptance command — *how* to build something,
and how to know it is done. Specs state *what* should exist ([`../specs/`](../specs/)); records
capture what was true on a date ([`../records/`](../records/)).

Written 2026-02 for the same reason `../specs/README.md` was: this directory had no index, and the
lifecycle rule below is enforced by tooling, not by convention anyone can see.

## Layout — the lifecycle

| Folder | Meaning | Files |
|---|---|---|
| [`_active/`](./_active/) | Being worked right now | 14 |
| [`_backlog/`](./_backlog/) | Recognised, not started | 2 |
| [`_done/`](./_done/) | Finished; acceptance command passed | 16 |

**A plan moves `_active` → `_done`, never `_active` → `_backlog`.** `_backlog` is for work that
has never started; `_done` is for work that finished.

## The naming rule is a tool contract, not a style preference

AGENTS.md §7.4:

> - **`done-todo-*` is earned ONLY when that file's own acceptance command was RUN and PASSED.**
>   Anything else stays `todo-`. Parked/superseded states belong in a dated header line, never the
>   filename.
> - **A tool reads the name:** `check-dead-refs.py` exempts any doc whose name contains `todo-`,
>   `plan-`, or `prd-` — keep the token wherever the file lives.

So a plan is **renamed in place**, keeping its token:

- in progress → `_active/todo-foo.md`
- finished and verified → `_done/done-todo-foo.md`

Two consequences worth knowing:

1. **A plan in `_done/` without a `done-` prefix is a bug**, not a variant. It means the rename was
   skipped or the acceptance never ran.
2. **The token is what exempts a plan from `check-dead-refs.py`** — a plan is allowed to name files
   that do not exist yet, because a plan names what it *intends* to create. Renaming a plan to
   something without a token makes the checker audit it as a live document and report those
   forward references as dead.

## Where live plans live

**Live plans sit at the repo root**, not in this folder — `todo-*.md` and `plan-*.md` at the
repository root, per AGENTS.md §7.4 (*"Renames happen in place at the repo root"*). Completed ones are
collected here, which is why `_done/` holds `done-*` files that were once root-level.

That split is currently unresolved and tracked in `todo-docs-restructure.md` §10 Q1: whether live
plans should move to `_active/` too. Until it is answered, **a root `todo-*.md` is correct**.

## Related

- [`../specs/`](../specs/) — design specs, with their own numbering conventions
- [`../records/`](../records/) — dated records and the engineering journal
- [`../README.md`](../README.md) — the documentation index
