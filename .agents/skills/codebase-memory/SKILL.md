---
name: codebase-memory
description: "Query the OZ-POS code knowledge graph from run_code via the codebase-memory-mcp server. Use for structural discovery instead of grep/read: explore the codebase, understand the architecture, what functions exist, show me the structure, who calls this function, what does X call, trace the call chain, find callers of, show dependencies, impact analysis, blast radius, dead code, unused functions, high fan-in, high fan-out, refactor candidates, code quality audit, hot paths, Cypher query examples, edge types, graph query syntax, how to use search_graph."
---

<!-- Audit stamp: 2026-09-08 · DSH · status: NEW · every number, shape, error string and latency below was produced by executing the tool in this session against the live oz-pos graph — nothing here is copied from the upstream docs. Claims that could NOT be verified are labelled "not verified" and must not be relied on. -->

# Codebase Memory — OZ-POS knowledge graph

AGENTS.md makes graph-first discovery a **MUST FOLLOW** rule ("ALWAYS use
`codebase-memory-mcp` first for code exploration"). This skill is how that rule is
actually executed, and — more importantly — where the tool's **silent failure modes**
are recorded, because most of them look like a correct answer.

## When to use

Reach for the graph whenever the question is **structural** rather than textual:

- "What exists in area X?" / "Where does this concept live?" — `search_graph`.
- "Who calls this?" / "What breaks if I change it?" — `trace_path`, `detect_changes`.
- "Is this screen/function dead?" — degree sweeps, then the three greps AGENTS.md demands.
- "What are the actual module seams?" — `get_architecture(aspects: ['clusters'])`.
- "Which functions are hot?" — complexity properties via `query_graph`.
- "Is this file even in the index?" — `check_index_coverage`.

Stay with `grep`/`read` when the question is about **literal text**: a string constant,
a config key, an i18n id, a SQL fragment, or anything inside a
`parse_partial` line range. The graph is a lossy structural summary; treating it as a
faster grep is how you get confident wrong answers.

---

## Golden rules

| # | Rule | Why |
|---|------|-----|
| 1 | **Graph first, source second.** | AGENTS.md makes it a MUST FOLLOW; measured 33 ms vs 1.3 s for the grep-backed path. |
| 2 | **Never conclude "does not exist" from a graph result.** | Every silent-failure mode below produces an empty or near-empty answer that looks like absence. |
| 3 | **Always label the source node in Cypher.** | Unlabeled source: 42 rows where the truth is 22,831. |
| 4 | **Check freshness before you act, not after.** | This repo's index ran 610 commits behind HEAD when measured. |
| 5 | **Read the `in`/`out` columns for fan-in/fan-out.** | `direction` is accepted by `search_graph` and does nothing. |
| 6 | **Filter by `label` and `file_pattern` before quoting a count.** | Markdown headings, mock registries and generated schemas are all nodes. |
| 7 | **Never re-index, delete a project, or ingest traces without an explicit order.** | Those mutate the artifact every other agent on this branch reads. |
| 8 | **Quote the index generation alongside any number you report.** | "44,213 nodes" is meaningless without "as of 2026-09-04T18:32Z". |

---

## Which copy of this skill wins

Three documents describe the same server. They are not interchangeable:

| Location | Scope | Invocation model |
|---|---|---|
| `.agents/skills/codebase-memory/SKILL.md` (this file) | This repo, from `run_code` | TypeScript `await tools.mcp__cbm__<tool>({...})` |
| `.prime/agent/skills/codebase-memory-mcp/SKILL.md` | prime-agent only | Python `import codebase_memory_mcp` |
| `~/.agents/skills/codebase-memory/` (outside the repo) | Machine wiring | launcher path, daemon port, per-client MCP config |

The server itself is configured by `.mcp.json` (repo root) and `.agents/mcp.json`,
both of which exec a user-scope launcher script — the binary is **not** in this repo,
so never hardcode a path to it.

---

## Invocation (this is the part that is easy to get wrong)

```ts
const r = await tools.mcp__cbm__search_graph({
  project: 'oz-pos',
  name_pattern: 'KdsOrder',
  label: 'Struct',
  limit: 5,
});
```

1. **`tools.mcp__cbm__<tool>` is the only form that resolves.** A bare
   `mcp__cbm__list_projects` global is `undefined` (measured). No `import`, no shell
   command, no HTTP call to the daemon.
2. **`project` is required on every tool except `list_projects`.** Omitting it fails
   with `missing required argument: project` and a hint to run `list_projects`.
3. **The result envelope is `{ content, structuredContent }`.** `structuredContent`
   is present for `list_projects`, `index_status`, `get_graph_schema`,
   `get_code_snippet`, `check_index_coverage`, `manage_adr`, `search_code` with
   `mode` files/full, and for `search_graph` / `trace_path` / `detect_changes` when you
   pass `format: 'json'`. The default `tree` format returns **text only** in
   `content[0].text` — if you need to iterate rows, re-call with `format: 'json'`
   instead of parsing prose.
4. **A failed call throws `ToolCallError`** (`e.toolName` names the tool). Wrap in
   `try/catch` inside `run_code` when you are probing several tools in one program —
   an uncaught throw kills the whole script.

---

## Project facts (measured 08-09-26)

| Fact | Value |
|---|---|
| Project name to pass | `oz-pos` |
| Root path | `C:/dev/ozpos/0.0.35/oz-pos` |
| Indexed branch | `0.0.37` |
| Nodes / edges | 44,213 / 226,232 |
| Node labels / edge types | 19 / 26 |
| File nodes | 2,797 — TypeScript 976, Rust 924, CSS 125, Go 72, TOML 46, Python 46, Bash 43, SQL 29, YAML 24, JavaScript 8 |
| Index generation | 2026-09-04T18:32:05Z, mode `full`, `recording_status: complete` |
| Coverage flags | 35 `parse_partial` files, 0 `skipped`, 176 files + 18 dirs excluded by design |
| Exclusions | `.cbmignore` (build artifacts, node_modules, images, logs) — it deliberately un-excludes `scripts/`, `docs/`, `audit/` so prose and shell are searchable |

**The index is 610 commits behind HEAD** (HEAD is dated 08-09-26; generation is
04-09-26). That is not a defect, it is the normal state of a long-lived release
branch, and it is why the next section is mandatory rather than advisory.

---

## Mandatory first two calls

```ts
await tools.mcp__cbm__list_projects({});
await tools.mcp__cbm__index_status({ project: 'oz-pos' });
```

Then, once you know which files your answer depends on:

```ts
await tools.mcp__cbm__check_index_coverage({
  project: 'oz-pos',
  paths: ['crates/oz-core/src/kds.rs', 'crates/oz-core/migrations/20260813_init.sql'],
});
```

Real response fields per path: `status` (`no_recorded_issue` | `partial`),
`freshness`, `recommended_action`, and `coverage[]` with the exact line
`ranges`. Measured on this repo: `kds.rs` → `no_recorded_issue` but
`freshness: metadata_changed` + `recommended_action: read_source_and_reindex`;
`20260813_init.sql` → `partial` with 8 flagged ranges including `1046-1531`.

**Read the freshness, not just the status.** `no_recorded_issue` means "the indexer
saw no problem", not "this file still looks like that". When freshness says
`metadata_changed`, the graph describes the 04-09-26 tree — for anything you are about
to *modify*, read the source.

### What staleness looks like in practice

Measured while writing this file: the graph places `NodeTopologyEditor.tsx` and
`topologyContract.ts` under `features/stores/`. Neither path exists on disk any more —
that directory is `features/locations/` now, and `git log --diff-filter=D` shows the
deletion. Every field of the response was internally consistent and structurally valid:
right file name, right symbol, plausible qualified name, **wrong directory**. Nothing
errors, and nothing warns.

The rule that follows: a graph hit gives you a *symbol to go find*, not a *location to
cite*. Confirm the path with `glob` or `read` before it enters a report, a commit
message, or a refactor plan.

---

## Tool map — only the parameters that were verified to do something

| Tool | Required | Optional params confirmed live |
|---|---|---|
| `list_projects` | — | — |
| `index_status` | `project` | `verbose` |
| `index_repository` | `repo_path` | `mode`, `name`, `target_projects`, `persistence` — **not executed here**, see "Re-indexing" |
| `delete_project` | `project` | destructive — do not call without an explicit order |
| `search_graph` | `project` | `name_pattern`, `qn_pattern`, `query`, `semantic_query` (array), `label`, `file_pattern`, `relationship`, `min_degree`, `max_degree`, `include_connected`, `exclude_entry_points`, `limit`, `offset`, `format`, `fields`, `detail` |
| `search_code` | `pattern`, `project` | `mode` (compact/full/files), `regex`, `file_pattern`, `path_filter`, `context`, `limit` |
| `get_code_snippet` | `project`, `qualified_name` | `include_neighbors` |
| `trace_path` | `project`, `function_name` | `direction`, `depth`, `mode`, `format`, `risk_labels`, `cursor` |
| `detect_changes` | `project` | `format`, `direction` |
| `check_index_coverage` | `project` + at least one of `paths` / `scopes` | — |
| `get_graph_schema` | `project` | — |
| `get_architecture` | `project` | `path` (directory scope), `aspects` |
| `query_graph` | `project`, `query` | `graph` — `code` (default) or `missed`; `max_rows` |
| `manage_adr` | `project`, `mode` | `content` |
| `ingest_traces` | `project`, `traces` | mutating — do not call without an explicit order |

Every aspect requested below returned data, but they are not equally worth asking
for. (`languages`, `packages` and `entry_points` were never requested on their own —
`overview` already prints all three as sub-blocks.)

| Aspect | Measured on this repo |
|---|---|
| `overview` | Counts + languages + packages + 20 entry points. The default. |
| `structure` | **A subset of `overview`** (node-label counts only, 345 chars). Redundant. |
| `dependencies` | The 26 edge types with counts — same block `overview` already prints. |
| `hotspots` | Top 10 by fan-in. Cheap and genuinely useful. |
| `clusters` | 12 Leiden communities over CALLS edges — the real seams, which cut across the folder layout. |
| `boundaries` | 10 cross-package call counts (`sync → oz-core` 340, `oz-payment → src` 126). Small and useful. |
| `layers` | 37 rows; every script lands as `internal` with fan-in 0. Low signal. |
| `routes` | 20 rows, several of them false positives (see the noise section). |
| `cycles` | 14 circular CALLS groups over 44,439 edges, in 99 ms. Opt-in only — never implied by `all` or `overview`. |
| `file_tree` | **1,075 entries / 45.6 KB unscoped.** Scope it with `path` (18 entries for `modules/sales`) or do not ask for it. |
| `all` | 53 KB. It includes `file_tree`. Prefer named aspects. |

---

## Qualified-name grammar

`<project>.<path segments joined by dots, dashes preserved>.<Symbol>[.<Member>]`

```text
oz-pos.crates.oz-core.src.kds.KdsOrder
oz-pos.foundation.src.cart.Cart.add_line
oz-pos.ui.src.features.tables.register.registerTablesFeature
oz-pos.agents.skills.docs-auditor.scripts.check-orphans.main
```

The last one is `.agents/skills/docs-auditor/scripts/check-orphans.py`: a leading dot in
a path segment is dropped, so `.agents` becomes `agents` in the qualified name while
`file_path` keeps the real dotted directory. Dashes survive untouched
(`oz-core`, `check-orphans`). Never guess a qualified name from a path — get it from
`search_graph` or from `entry_points` in `get_architecture`.

The tree format **groups** rows to save tokens: a header line carries the shared
prefix and the file, and each row shows only the trailing name. The full qualified
name is `group prefix + "." + name`. Do not feed a bare row name back into another
tool when the group prefix was carrying meaning.

---

## Recipes (each one was run against this repo)

### 1. Find a symbol, read it, see who calls it

```ts
const hit = await tools.mcp__cbm__search_graph({ project: 'oz-pos', name_pattern: 'KdsOrder', label: 'Struct', limit: 5 });
const src = await tools.mcp__cbm__get_code_snippet({ project: 'oz-pos', qualified_name: 'oz-pos.crates.oz-core.src.kds.KdsOrder' });
const callers = await tools.mcp__cbm__trace_path({ project: 'oz-pos', function_name: 'oz-pos.foundation.src.cart.Cart.add_line', direction: 'inbound', depth: 2 });
```

`get_code_snippet` returns an **absolute** `file_path` plus `start_line`/`end_line`, so
you can hand it to `read` with exact offsets. `include_neighbors: true` adds
`callers`/`callees` counts and a `caller_names` array — one call instead of two.

### 2. Disambiguate a short name

`trace_path` accepts a short name **only when it is unique**. `add_line` exists twice
in this repo, so the call returns instead of throwing:

```json
{ "status": "ambiguous", "message": "2 matches for \"add_line\"...",
  "suggestions": [{ "qualified_name": "oz-pos.foundation.src.cart.Cart.add_line", "file_path": "foundation/src/cart.rs" }] }
```

Fix: pass the `qualified_name` from `suggestions`. A wrong qualified name is a hard
error (`function not found`) with a hint to re-run `search_graph` — that is the
fastest way to discover the real name.

### 3. Ranked text search when you do not know the symbol

```ts
await tools.mcp__cbm__search_graph({ project: 'oz-pos', query: 'process payment tender', limit: 10 });
await tools.mcp__cbm__search_graph({ project: 'oz-pos', semantic_query: ['refund', 'void transaction'], limit: 5 });
await tools.mcp__cbm__search_code({ project: 'oz-pos', pattern: 'registerPage', limit: 10 });
```

`query` is BM25 over names and docstrings (camelCase split) with structural boosting;
it returned `total: 799` for that phrase, so **always** narrow with `label` /
`file_pattern` before paginating. `semantic_query` must be an **array** — it scores
each keyword independently (min-cosine), so adding a second keyword drops results that
only match one. `search_code` is grep + graph dedup; its counters
(`total_grep_matches`, `total_results`, `raw_match_count`, `elapsed_ms`, `dedup_ratio`)
are how you detect truncation — there is no `offset`, raise `limit` or narrow instead.

### 4. Blast radius of the working tree

```ts
await tools.mcp__cbm__detect_changes({ project: 'oz-pos', format: 'json' });
```

Measured here: `base: main`, `changed_files: 950` — because this branch is a long-lived
release branch, not a feature diff. `detect_changes` answers "what does this branch
touch relative to main", which on `0.0.37` is far too wide to be a per-change impact
set. For a single change, scope it yourself: `trace_path(direction: 'inbound')` on the
symbols you edited.

### 5. Architecture, scoped

```ts
await tools.mcp__cbm__get_architecture({ project: 'oz-pos', aspects: ['overview'] });
await tools.mcp__cbm__get_architecture({ project: 'oz-pos', path: 'modules/sales', aspects: ['overview'] });
await tools.mcp__cbm__get_architecture({ project: 'oz-pos', aspects: ['clusters'] });
await tools.mcp__cbm__get_architecture({ project: 'oz-pos', aspects: ['cycles'] });
```

`path` is real scoping: `modules/sales` returned 232 nodes / 582 edges against the
44,213-node root, plus its own hotspots. `clusters` returned 12 communities (top:
`apps` 299 members cohesion 0.81; `ui` 241 at 0.95 around `loggedInvoke`). `cycles`
returned 14 circular CALLS groups over 44,439 scanned edges. Measured
`hotspots` fan-in: `Store.new` 1271, `QrisPaymentProcessor.clone` 831,
`PluginDb.execute` 641, `loggedInvoke` 434.

### 6. Hot-path and complexity sweeps

```ts
await tools.mcp__cbm__query_graph({
  project: 'oz-pos',
  query: "MATCH (f:Function) WHERE f.transitive_loop_depth >= 3 RETURN f.qualified_name AS qn, f.transitive_loop_depth AS tld ORDER BY tld DESC LIMIT 5",
});
```

Returned `create_product_variant_scoped` and `update_product_variant_scoped` at tld 7.
The sibling properties were all returned in one sweep — `complexity`, `cognitive`,
`loop_depth`, `linear_scan_in_loop`, `alloc_in_loop`, `param_count`, `max_access_depth`.
Top hit: `scan_file` in `scripts/verify-no-hardcoded-money-format.py` (ls=6, alloc=6,
cx=19). Two boolean flags are worth querying directly: `f.recursive = true` → 69
functions, and `f.unguarded_recursion = true` → exactly 2, one of them `visit` in
`ui/src/features/locations/topologyContract.ts` — a **closure inside a function**, not a
top-level routine. The graph indexes nested arrow functions, so a "hot path" hit may be
ten lines inside a bigger routine; read the snippet before writing it up.

---

## Cypher: the trap that will burn you first

**A relationship pattern needs a label on the SOURCE node, or it silently returns the
wrong answer.** Measured on this graph, which holds 52,258 CALLS edges:

| Pattern | Result |
|---|---|
| `MATCH (a:Function)-[r:CALLS]->(b) RETURN count(r)` | 45,418 |
| `MATCH (a:Function)-[r:CALLS]->(b:Function) RETURN count(r)` | 22,831 |
| `MATCH (a)-[r:CALLS]->(b:Function) RETURN count(r)` | **42** |
| `MATCH (a)-[r:CALLS]->(b:Function) RETURN a.name, b.name LIMIT 3` | **0 rows** |
| `MATCH (a)-[r:HTTP_CALLS]->(b) RETURN a.name, b.name LIMIT 3` | **0 rows** |
| `MATCH (a:Function)-[r:HTTP_CALLS]->(b) RETURN a.name, b.name LIMIT 3` | 4 rows (`resolve → https://api.ipify.org`, `rate_limiter_allows_within_limit → /api/sync/push`) |
| `MATCH (a:Function)-[r:HTTP_CALLS]->(b:Function) RETURN count(r)` | **0 rows** — HTTP_CALLS targets `Route`, not `Function` |

An unlabeled source does not error and does not say "unbounded scan refused" — it
returns a plausible-looking near-empty answer. So the rule is:

1. **Always label the source node.** Non-negotiable.
2. **Label the target only with a label it actually has.** The last row above is the
   mirror image of the trap: correct source label, plausible target label, still 0 rows
   — because HTTP_CALLS points *at* `Route` nodes.
3. Therefore `0 rows` is **evidence about your query**, never evidence that the edge or
   the dependency does not exist. Debug it by dropping the target label, then the
   property list, until something returns — and only then re-tighten.

Other measured Cypher behavior:

- Node-property queries (`MATCH (f:Function) WHERE ...`) are unaffected and reliable.
- `RETURN count(f)` yields the number as a **string** (`"16973"`) — cast before arithmetic.
- Malformed Cypher errors properly (`expected token type 67, got 85 at pos 9`).
- Hard 100k-row ceiling: put `LIMIT` in the query. `max_rows` caps the returned page.
- `graph: 'missed'` queries the miss graph: `MATCH (f:File) RETURN f.file_path, f.kind`
  → the 35 `parse_partial` files, same list `index_status` reports.
- Edge properties exist per type — CALLS carries `args`, `callee`, `candidates`,
  `confidence`, `line`, `strategy`, `url_path`, `via`. `Route` nodes carry `method`,
  `broker`, `source`.
- `manage_adr({ project: 'oz-pos', mode: 'get' })` returns `status: no_adr`. The graph
  stores no ADR; the real ones are markdown in `docs/decisions/` (ADR 34–43 and
  earlier). Do not treat an empty ADR store as "this project has no decisions".

---

## Parameters that are accepted and then ignored

This is the second trap. `run_code` will not complain, and the tool will not complain:

| Call | Measured outcome |
|---|---|
| `search_graph({ ..., bogus_param: 123 })` | Succeeds, param dropped |
| `search_graph({ ..., direction: 'outbound' })` | Byte-identical to omitting it — **`direction` does nothing on `search_graph`** |
| `search_graph({ ..., exclude_entry_points: true })` with `max_degree: 0` | `total: 356` either way — no effect in the case measured |
| `trace_path({ ..., include_tests: false })` | Still returns test callers (`kds_tests` first) |
| `trace_path({ ..., file_path: '...' })` | Ignored; ambiguity response unchanged |
| `trace_path({ ..., mode: 'nonsense' })` | Echoes `mode: nonsense`, behaves like `calls` — **no validation** |
| `detect_changes({ ..., base: 'HEAD' })` | Still diffs against `main` |
| `get_code_snippet({ ..., uri: '...' })` | Ignored; resolves on `qualified_name` alone |

Consequences worth stating plainly: the widely-copied fan-in/fan-out recipe
`search_graph(min_degree: 10, relationship: 'CALLS', direction: 'outbound')` does not
measure fan-out. `min_degree`/`max_degree` match when **either** the `in` or the `out`
column crosses the threshold, and `relationship` only selects which edge family those
degrees count over (CALLS → total 32 vs 39 for the default family). For a true
direction-specific number, use `trace_path` or a labeled Cypher count.

Also: `trace_path` does **not** take `name` — the parameter is `function_name`
(`function_name is required`).

---

## Noise you must filter before believing a result

- **Markdown headings are graph nodes.** `name_pattern: '.*Money.*'` returned 144
  matches whose top hits were `Section` nodes in `docs/records/JOURNAL.md`. Pass
  `label` (`Function`, `Struct`, `Method`, ...) or you will audit a changelog.
- **`name_pattern` is a substring match, not anchored.** `KdsOrder` already matches
  `CreateKdsOrderInput`; wrapping it in `.*...` changes nothing except the row count
  of unrelated hits. A zero-result `name_pattern` means no symbol contains that text —
  it does **not** mean your syntax is wrong.
- **A broken regex is indistinguishable from no matches.** `name_pattern: '.*('`
  returns `total: 0` plus a "check spelling" hint, no parse error.
- **`ui/src/dev-mock/tauri-api.ts` dominates any zero-degree sweep.** Its mock keys are
  indexed as `Function` nodes named like `'create_kds_order_from_sale'` with in=0 and
  out=0, so `max_degree: 0` reports 356 "dead" functions that are mostly mock registry
  strings. Filter by `file_pattern` and by `is_test` before calling anything dead —
  and treat a dead-code claim as needing three greps, per AGENTS.md, because features
  register lazily.
- **Generated artifacts are indexed.** `apps/tablet-client/gen/schemas/android-schema.json`
  shows up as a high-degree `Variable`; so do Go stdlib types from
  `apps/license-server`. `file_pattern` **matches, it does not exclude** — scope
  positively to the tree you want rather than trying to subtract `gen/`.
- **The two path filters do not share a regex engine, and both fail silently.**
  `file_pattern: '^(?!.*gen).*'` on `search_graph` returned `total: 0`; the identical
  `path_filter` on `search_code` returned everything (412 results, unfiltered). Lookahead
  is unsupported in one and ignored in the other. A filter that silently matches nothing
  is indistinguishable from an empty result set — confirm the `total` actually moved.
- **`aspects: ['routes']` over-reports.** Measured output includes `/dev/ttyUSB0`,
  `/dev/rfcomm0`, `/tmp/media`, `/nonexistent/plugin/dir` and a SQL index comment
  parsed as a path. Route nodes are a text-mining artifact as often as a real endpoint —
  confirm against `crates/oz-api/src/routes/` or the Tauri command registry.
- **`aspects: ['layers']` classifies scripts as `internal` with fan-in 0**, which is
  true but useless. Use `clusters` for the real seams.
- **Test code is woven into traces.** `create_kds_order` inbound returned 40 callers,
  the first 20+ of them tests. `is_test` is a queryable property on Function nodes
  (8,258 true here) — filter it in Cypher, since `include_tests` does nothing.

---

## Cost (measured, warm)

| Call | Latency |
|---|---|
| `search_graph` (any mode, incl. semantic) | 33–54 ms |
| `trace_path` (depth 3, 205 callers) | 38 ms |
| `get_architecture` (`cycles`, whole graph) | 99 ms |
| `detect_changes` (950 files) | 1.17 s |
| `search_code` (grep-backed) | 0.63–1.29 s |
| `list_projects` (first call in a session) | 1.03 s |
| `query_graph` unindexed full-edge count | 2.41 s |

Graph tools are ~30–50× cheaper than the grep-backed ones; the exception is
`query_graph` with an unbounded aggregation. Bound it with a label and a `LIMIT`.

---

## Re-indexing, and what not to touch

The index is a snapshot; when it is too stale to answer your question, say so and ask
the user before re-indexing. `index_repository` is the only refresh path
(`repo_path`, `mode`: `fast` | `moderate` | `full` | `cross-repo-intelligence`,
optional `name`, `persistence`, `target_projects`). **Its runtime on this repo was not
measured in this session** — do not quote a duration for it, and do not start one
speculatively mid-task: it rewrites the shared artifact every other agent reads.

`delete_project` removes the index outright and `ingest_traces` writes runtime edges
into it. Neither is a discovery tool; both need an explicit order.

---

## Subagents

A child agent inherits the ability to call these tools but not your findings. Before
delegating, run the graph calls yourself and hand over: the project name, the index
generation, the exact qualified names, the file paths with their coverage status, and
which claims are provisional. A child that has not called `check_index_coverage` will
report a 04-09-26 graph as current truth.

---

## Common pitfalls

1. **Trusting an empty result as absence.** Four separate mechanisms produce it: an
   unlabeled Cypher source, a wrong target label, an unsupported regex construct, and a
   stale index. None of them error. See "Cypher: the trap that will burn you first".
2. **Passing a parameter that does not exist.** `direction` on `search_graph`,
   `include_tests` / `file_path` on `trace_path`, `base` on `detect_changes`, `uri` on
   `get_code_snippet` — all accepted, all dropped. The list of confirmed-live parameters
   in the tool map is the boundary of what you can rely on.
3. **Reporting fan-in from `min_degree`.** It matches either direction. Read the `in`
   and `out` columns, or count with a labeled Cypher query.
4. **Quoting a dead-code count without filtering.** `max_degree: 0` on this repo returns
   356 functions, many of them mock-registry strings in `ui/src/dev-mock/tauri-api.ts`.
   AGENTS.md's three-grep rule still applies — features register lazily.
5. **Citing a graph path as a location.** See the staleness example above; the directory
   moved and the graph did not notice.
6. **Skipping `check_index_coverage` on the files you are about to edit.** 35 files here
   carry `parse_partial` ranges; one migration file has a 486-line hole. A symbol that
   "has no callers" inside such a range may simply not be in the graph.
7. **Letting `file_tree` or `all` into context unscoped.** 45.6 KB and 53 KB respectively
   on this repo. Scope with `path`, or ask for the two or three aspects you need.
8. **Re-indexing to "fix" a surprising result.** A surprising result is usually a query
   bug (items 1–3). Re-indexing is a shared-artifact write; ask first.
9. **Assuming the Python form works here.** `import codebase_memory_mcp` is prime-agent
   only. From `run_code` it is `await tools.mcp__cbm__<tool>({...})`, always with
   `project`.

---

## See also

- `onboarding-guide` — the router; graph-first is a standing rule, not a row.
- `skill-drift-guard` — audits this file's paths, crate tokens and footer on every run.
- `docs-auditor` — when the claim being checked is in a document rather than in code.
- `tdd` — the graph is the fastest way to find the weak point before writing a test.
- `.prime/agent/skills/codebase-memory-mcp/SKILL.md` — the Python wrapper, different runtime.

---

## Keeping this skill honest

`.agents/skills/skill-drift-guard/scripts/detect.sh` scans every
`.agents/skills/*/SKILL.md`, including this one: referenced paths must exist, every
`oz-*` token must resolve to a workspace crate, every Fluent id a code example names
must exist in the locale bundles, and the footer below must stay a real DD-MM-YY within
30 days.
The measured facts in this file (node counts, totals, latencies, error strings) are
**not** machine-checked — they are a snapshot of the 04-09-26 index. Re-run the calls
in "Mandatory first two calls" before repeating any of them to someone else.

---

> last audited 08-09-26 by DSH
