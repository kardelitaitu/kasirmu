# Specs

A **spec** here is a statement of intended design, scoped small enough to be finished and checked.
Specs are not documentation of what *is* — that is [`../records/`](../records/). They are not
task lists — that is [`../plans/`](../plans/).

Written 2026-10-02 because this directory had no index and a newcomer could not infer any of the
conventions below from the filenames.

## Layout

| Path | What lives there |
|---|---|
| [`_active/`](./_active/) | Specs being worked |
| [`_done/`](./_done/) | Specs finished and validated |
| [`testing/`](./testing/) | Cross-cutting test strategy (1 file) |
| *(root)* | Long-running specs that predate the `_active`/`_done` split, plus `module-manifest.schema.json` |

## Filename prefixes — three schemes, deliberately not unified

The numbering in `_active/` is **not one scheme**. This is a record of what exists, not an
endorsement:

| Prefix | Meaning | Example |
|---|---|---|
| `0043-`, `0044-`, `0045-` | Sequential spec IDs, as a **directory** | `0043-architecture-boundary-checker/` |
| `0046b-`, `0047-`, `0049-` | Sequential spec IDs, as a **loose file** | `0047-openapi-drift-guard-and-read-tiers.md` |
| `c1-`…`c5-` | Finding IDs from the security audit, adopted as spec IDs | `c1-money-type-safety.md` |
| `p1-`…`p3-` | Phase IDs from one sync plan, never promoted to spec IDs | `p3-sync-pagination-snapshot-observability.md` |
| *(none)* | Unnumbered | `kds-redesign-ux.md`, `tenant-lifecycle-admin.md` |

The `c` and `p` prefixes are **borrowed identifiers from other documents**, not a second numbering
scheme. Treat them as opaque: `c1` and `p1` say nothing about each other or about `0043`.

## Numbered directories

A sequential-ID spec that carries more than one artefact gets a directory rather than a file:

```
0043-architecture-boundary-checker/
├── plan.md         what will be built
├── validation.md   how it will be checked
└── spec.yaml       machine-readable metadata
```

Not every one has all three — `0045-sync-conflict-dead-letter-recovery/` has `spec.yaml` and
`validation.md` but no `plan.md`. Read what is there rather than assuming the full set.

## A known numbering collision — documented, not fixed

**`0047` and `0049` each name two different specs**, one in `_active/` and one in `_done/`:

| ID | In `_active/` | In `_done/` |
|---|---|---|
| 0046 | `0046b-product-menu-images.md` (the "b" is a variant) | `0046-rbac-permission-registry/` |
| 0047 | `0047-openapi-drift-guard-and-read-tiers.md` | `0047-rbac-centralized-enforcement-gate/` |
| 0048 | — | `0048-rbac-assignment-model-and-taxonomy/` |
| 0049 | `0049-edge-relay-network.md` | `0049-user-profile-data/` |

**This has been left alone on purpose.** Renumbering would break a large number of references
across the repo, including a concentration in the engineering journal
(`docs/records/journal/JOURNAL-part-4.md`) and **`CHANGELOG.md`, which is a historical record and
must not be rewritten to tidy a number.** The IDs are only ambiguous *across* the two folders;
within either folder they are unique, which is why nothing has broken.

**Do not quote a reference count here.** It was measured at 134 in September and had already drifted
by the time this file was written — and this README contributes to the count itself, since documenting
the collision mentions the IDs. Re-derive instead:

```bash
git grep -ohE '004[6-9]' -- '*.md' | wc -l          # total occurrences
git grep -ohE '004[6-9]' -- CHANGELOG.md | wc -l  # the file that must not be rewritten
```

Both use `-o` so they count **occurrences**, not matching lines — `git grep -c` would report 18 for
`CHANGELOG.md` where the true occurrence count is 23, because several lines mention more than one ID.

If you add a sequential spec, continue the highest number **within the folder you are writing to**
and check the other folder first.

## Related

- [`../plans/`](../plans/) — task lists and implementation plans
- [`../records/`](../records/) — dated records, superseded material, engineering journal
- [`../README.md`](../README.md) — the documentation index
