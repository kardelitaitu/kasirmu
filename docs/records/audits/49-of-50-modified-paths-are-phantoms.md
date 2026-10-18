# 49 of the 50 "modified" paths are phantoms, and one is real (round 289)

## The reading that prompted it

Every `git status` this session showed a long dirty list — twelve `docs/records/audits/*.md`
files, several `todo-*.md`, `stats.json`, `README-technical.md`. The natural reading is "another
session has 50 files in flight", and it is the reading AGENTS.md §7.3 exists to stop:

> **⚠️ Not every ` M` is content.** Under `text=auto` a file can show modified while its bytes
> equal the HEAD blob — compare `git hash-object <path>` with `git rev-parse :<path>`; matching
> hashes mean nothing to commit.

A direct measurement, over every ` M` path in the tree:

```
phantom (identical bytes): 49
real content diffs:        1        -> crates/kasirmu-bridge/src/subscription_tests.rs
```

The method: `git hash-object -- <path>` (worktree) against `git rev-parse :<path>` (index),
per path.

## Why this is worth a record

**It changes what a plan should do.** A round that reads the status list as 50 files of another
session's work will avoid paths it could safely touch, and will avoid *committing* for fear of
sweeping up someone else's edits. Neither fear applies to a phantom: the bytes in the worktree,
the index and HEAD are identical (`2989a22d…` for the file spot-checked in full), so there is
nothing to sweep and nothing that a pathspec commit could capture.

The single real file is the one that was already being edited at the start of this session —
`crates/kasirmu-bridge/src/subscription_tests.rs`, +51/-43 — and it is genuinely another
session's in-flight work. **One real file, not fifty.**

## What was NOT concluded

- The phantoms were not repaired. `git update-index --refresh` would clear the stat cache, and
  running it is a reasonable next step, but it mutates shared index state and this round had no
  need for it. It is named here rather than done.
- The cause is not confirmed beyond the symptom. Identical blob hashes prove there is no content
  difference; they do not prove `text=auto` line-ending normalisation is the mechanism. The
  measured fact is the equality, not the explanation.

## Verified

| Item | Result |
|---|---|
| ` M` entries classified | 50 |
| Identical worktree/index bytes | **49** |
| Real content diffs | **1** (`subscription_tests.rs`) |
| Spot-check of all three hashes | worktree = index = HEAD = `2989a22d` |
| Files changed by this round | none |

> last audited 15-10-26 by docs-auditor
