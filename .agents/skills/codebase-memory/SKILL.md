---
name: codebase-memory
description: "Query the OZ-POS code knowledge graph from run_code via the codebase-memory-mcp server. Use for structural discovery instead of grep/read: explore the codebase, understand the architecture, what functions exist, show me the structure, who calls this function, what does X call, trace the call chain, find callers of, show dependencies, impact analysis, blast radius, dead code, unused functions, high fan-in, high fan-out, refactor candidates, code quality audit, hot paths, Cypher query examples, edge types, graph query syntax, how to use search_graph."
---

<!-- Audit stamp: 2026-09-08 · DSH · status: NEW, then RE-MEASURED the same day after `index_repository` refreshed the graph (generation 2026-09-04T18:32Z → 2026-09-08T05:07Z). Every number, shape, error string and latency below was produced by executing the tool against the live oz-pos graph — nothing is copied from the upstream docs. The re-measurement is itself a lesson: 44,213 nodes became 47,026, a tld-7 hot path became tld-4, and an unlabeled-source Cypher that returned 42 rows on the old index returned 0 on the new one. Numbers in this file are dated, not permanent. -->

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
| 3 | **Always label the source node in Cypher.** | Unlabeled source returns 0 rows where the truth is 24,664. |
| 4 | **Check freshness before you act, not after.** | This repo's index sat 610 commits behind HEAD until it was refreshed on 08-09-26. |
| 5 | **Read the `in`/`out` columns for fan-in/fan-out.** | `direction` is accepted by `search_graph` and does nothing. |
| 6 | **Filter by `label` and `file_pattern` before quoting a count.** | Markdown headings, mock registries and generated schemas are all nodes. |
| 7 | **Never re-index, delete a project, or ingest traces without an explicit order.** | Those mutate the artifact every other agent on this branch reads. |
| 8 | **Quote the index generation alongside any number you report.** | "47,026 nodes" is meaningless without "as of 2026-09-08T05:07Z". |

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
| Nodes / edges | 47,026 / 238,705 |
| Node labels / edge types | 19 / 26 (top edges: USAGE 99,372 · CALLS 56,000 · DEFINES 44,191 · DECORATES 11,192 · IMPORTS 8,159) |
| File nodes | 3,000 — TypeScript 1,093, Rust 967, CSS 132, Go 72, Python 51, TOML 46, Bash 44, SQL 44, YAML 24, JavaScript 8 |
| Index generation | 2026-09-08T05:07:39Z (= 12:07 local), mode `full`, `recording_status: complete` — **already superseded**: a second refresh landed at 05:18:33Z (47,066 nodes) while this page was being written, by another agent working the same repo. Treat the generation as the volatile field, not the counts. |
| Coverage flags | 44 `parse_partial` files, 0 `skipped`, 174 files + 20 dirs excluded by design |
| Exclusions | `.cbmignore` (build artifacts, node_modules, images, logs) — it deliberately un-excludes `scripts/`, `docs/`, `audit/` so prose and shell are searchable |

**Expect the index to lag, by a lot.** Before it was refreshed on 08-09-26 this graph
was 610 commits behind HEAD (generation 04-09-26). After the refresh it is already 2
commits behind again — HEAD moves every few minutes on this branch and 30+ files are
normally dirty. A lagging index is the normal state here, not an error state, which is
why the next section is mandatory rather than advisory.

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
`metadata_changed`, the graph may describe an older tree — for anything you are about to
*modify*, read the source.

**But do not chase a clean freshness.** `metadata_changed` +
`recommended_action: read_source_and_reindex` was still returned one minute after a
successful re-index, because the working tree has ~30 uncommitted files. On a dirty tree
this field never clears, so it is a hint to read the source, not a to-do to re-index.
The third value seen is `not_tracked` — the file is not in the index at all.

### What staleness looks like in practice (before / after)

On the 04-09-26 index the graph placed `NodeTopologyEditor.tsx` and
`topologyContract.ts` under `features/stores/`. Neither path existed on disk — the
directory had been renamed to `features/locations/`. Every field of the response was
internally consistent and structurally valid: right file name, right symbol, plausible
qualified name, **wrong directory**. Nothing errored, and nothing warned.

After the 08-09-26 re-index the same query returns `features/locations/`, and
`file_pattern: 'features/stores'` returns `total: 0`. Same tool, same arguments, two
different answers four days apart.

The rule that follows: a graph hit gives you a *symbol to go find*, not a *location to
cite*. Confirm the path with `glob` or `read` before it enters a report, a commit
message, or a refactor plan.

---

## Tool map — only the parameters that were verified to do something

| Tool | Required | Optional params confirmed live |
|---|---|---|
| `list_projects` | — | — |
| `index_status` | `project` | `verbose` |
| `index_repository` | `repo_path` | `mode`, `name`, `target_projects`, `persistence` — **its success response is unreliable, see "Re-indexing"** |
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
| `clusters` | 12 Leiden communities over CALLS edges — the real seams, which cut across the folder layout. Membership shifts between index generations. |
| `boundaries` | 10 cross-package call counts (`sync → oz-core` 346, `src → public` 89). Small and useful. |
| `layers` | 37 rows; every script lands as `internal` with fan-in 0. Low signal. |
| `routes` | 20 rows, several of them false positives (see the noise section). |
| `cycles` | 14 circular CALLS groups over 47,467 edges, in 113 ms. Opt-in only — never implied by `all` or `overview`. |
| `file_tree` | **1,195 entries / 51.8 KB unscoped** (1,075 / 45.6 KB on the prior index). Scope it with `path` — 18 entries for `modules/sales` — or do not ask for it. |
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

Measured here: `base: main`, `changed_files: 951` — because this branch is a long-lived
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
47,026-node root, plus its own hotspots. `clusters` returned 12 communities (top: 385
members at cohesion 0.7956 around `resolve_session`/`open_store`). `cycles` returned 14
circular CALLS groups over 47,467 scanned edges. Measured `hotspots` fan-in: `Store.new`
1369, `license-server.lock` 1266, `QrisPaymentProcessor.clone` 870, `PluginDb.execute`
724. Every one of those numbers moved when the index was refreshed — re-measure before
quoting.

### 6. Hot-path and complexity sweeps

```ts
await tools.mcp__cbm__query_graph({
  project: 'oz-pos',
  query: "MATCH (f:Function) WHERE f.transitive_loop_depth >= 3 RETURN f.qualified_name AS qn, f.transitive_loop_depth AS tld ORDER BY tld DESC LIMIT 5",
});
```

Top of that sweep is tld 4 (`memo_tests.seed_terminal` and three siblings) — on the
previous index generation the same query topped out at tld 7 with
`create_product_variant_scoped`. **Interprocedural propagation is recomputed per index,
so a ranked complexity list is only valid for the generation that produced it.**

The sibling properties return in one sweep — `complexity`, `cognitive`, `loop_depth`,
`linear_scan_in_loop`, `alloc_in_loop`, `param_count`, `max_access_depth`. The
`linear_scan_in_loop` ranking is the one that found something real:
`validateTopologyGraph` in `ui/src/features/locations/topologyContract.ts` at ls=9,
alloc=21, cx=54 — a nested scan inside a loop, which `loop_depth` alone does not see.
Two boolean flags: `f.recursive = true` → 76 functions, `f.unguarded_recursion = true`
→ exactly 2, one of them `visit` in the same file — a **closure inside a function**, not
a top-level routine. The graph indexes nested arrow functions, so a "hot path" hit may
be ten lines inside a bigger routine; read the snippet before writing it up.

---

## Cypher: the trap that will burn you first

**A relationship pattern needs a label on the SOURCE node, or it silently returns the
wrong answer.** Measured on this graph, which holds 56,000 CALLS edges:

| Pattern | Result |
|---|---|
| `MATCH (a:Function)-[r:CALLS]->(b) RETURN count(r)` | 48,575 |
| `MATCH (a:Function)-[r:CALLS]->(b:Function) RETURN count(r)` | 24,664 |
| `MATCH (a)-[r:CALLS]->(b:Function) RETURN count(r)` | **0 rows** (42 on the previous index) |
| `MATCH ()-[r:CALLS]->() RETURN count(r)` — anonymous on both ends | **0 rows**, against a true 56,000 |
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
  → the 44 `parse_partial` files, same list `index_status` reports.
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
| `search_graph({ ..., exclude_entry_points: true })` with `max_degree: 0` | `total: 364` either way — no effect in the case measured |
| `trace_path({ ..., include_tests: false })` | Still returns test callers (`kds_tests` first) |
| `trace_path({ ..., file_path: '...' })` | Ignored; ambiguity response unchanged |
| `trace_path({ ..., mode: 'nonsense' })` | Echoes `mode: nonsense`, behaves like `calls` — **no validation** |
| `detect_changes({ ..., base: 'HEAD' })` | Still diffs against `main` |
| `get_code_snippet({ ..., uri: '...' })` | Ignored; resolves on `qualified_name` alone |

Consequences worth stating plainly: the widely-copied fan-in/fan-out recipe
`search_graph(min_degree: 10, relationship: 'CALLS', direction: 'outbound')` does not
measure fan-out. `min_degree`/`max_degree` match when **either** the `in` or the `out`
column crosses the threshold, and `relationship` only selects which edge family those
degrees count over (CALLS → total 31 vs 39 for the default family). For a true
direction-specific number, use `trace_path` or a labeled Cypher count.

Also: `trace_path` does **not** take `name` — the parameter is `function_name`
(`function_name is required`).

---

## Noise you must filter before believing a result

- **Markdown headings are graph nodes.** `name_pattern: '.*Money.*'` returned 149
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
  out=0, so `max_degree: 0` reports 364 "dead" functions that are mostly mock registry
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
- **`aspects: ['routes']` over-reports, and its list is not stable.** On the 04-09-26
  index the 20 rows included `/dev/ttyUSB0`, `/dev/rfcomm0`, `/tmp/media`,
  `/nonexistent/plugin/dir` and a SQL index comment parsed as a path. On the 08-09-26
  index the same call returns 20 mostly-real `/api/v1/...` rows plus `/freeze/i` and
  `/unfreeze/i` — regex literals from test code. Route nodes are a text-mining artifact
  as often as a real endpoint; confirm against `crates/oz-api/src/routes/` or the Tauri
  command registry, and never diff two route lists across index generations.
- **`aspects: ['layers']` classifies scripts as `internal` with fan-in 0**, which is
  true but useless. Use `clusters` for the real seams.
- **Test code is woven into traces.** `create_kds_order` inbound returned 52 callers
  (40 on the previous index), and the first group is `kds_tests`. `is_test` is a queryable property on Function nodes
  (8,661 true here) — filter it in Cypher, since `include_tests` does nothing.

---

## Cost (measured, warm)

| Call | Latency |
|---|---|
Re-measured warm against the 47,026-node index:

| Call | Latency |
|---|---|
| `search_graph` (name) | 26 ms |
| `search_graph` (semantic) | 57 ms |
| `trace_path` (depth 3, 219 callers) | 54 ms |
| `get_architecture` (`cycles`, whole graph) | 113 ms |
| `detect_changes` (951 files) | 1.35 s |
| `search_code` (grep-backed) | 1.48 s |
| `list_projects` / `index_status` | 0.5–1.0 s each |
| `query_graph` full-edge count | 2.07 s |

Graph tools are ~30–50× cheaper than the grep-backed ones; the exception is
`query_graph` with an unbounded aggregation. Bound it with a label and a `LIMIT`.

---

## Re-indexing, and what not to touch

The index is a snapshot; when it is too stale to answer your question, say so and ask
the user before re-indexing — it rewrites the shared artifact every other agent on this
branch reads.

### `index_repository` lies about failing

Run against this repo on 08-09-26 with `mode: 'full'`, then `'full'` again, then
`'fast'`. All three returned the identical error at ~2.7 s:

```text
{"project":"oz-pos","status":"error","hint":"Pipeline failed. Check repo_path exists
and contains source files. Try mode='fast' for a quicker diagnostic run."}
```

The database was rewritten anyway: `oz-pos.db` went from 136 MB / 44,213 nodes (Sep 5)
to 144 MB / 47,026 nodes (Sep 8 12:07), and `check_index_coverage` now reports
generation `2026-09-08T05:07:39Z`. **The MCP call reports the handshake, not the job** —
the supervisor keeps the worker running after the tool returns.

So:

1. **Never trust the return value.** Confirm with `index_status` (nodes/edges) and
   `check_index_coverage` → `indexed_at`. Those are the ground truth.
2. **The hint is not a diagnosis.** It told me to "try `mode='fast'`" for a call that
   had already passed `mode: 'fast'`. Content is not the variable either: an A/B in a
   scratch repo made `nul`-vs-no-`nul` pass/fail one way and then the exact opposite way,
   so treat the failure as nondeterministic contention (4 client processes were live;
   the daemon caps `physical_job_limit` at 4) rather than a repo defect.
3. **Watch the staging file** to see whether a run is actually in flight:
   `~/.cache/codebase-memory-mcp/oz-pos.db.stage.*` grows while indexing and vanishes on
   swap. `logs/cbm-daemon.log` records `tool=index_repository status=error` next to
   `index.supervisor.reap outcome=clean exit_code=0` — the reap is the real signal.
4. **Always pass `name: 'oz-pos'`.** Without it the project is keyed from the path
   (`C-dev-...`-style, as the other indexed projects on this machine are), which leaves
   you with a second full graph and every tool call still reading the stale one.
5. **Budget minutes, not hours.** The swap landed within ~7 minutes of the first
   attempt (and another agent was probing the same repo concurrently, so do not read
   that as a clean timing measurement for one call). Four historical
   `tool=index_repository status=ok` entries in the daemon log ran 1.4–5.3 s — those were
   incremental passes over an already-indexed tree.

`delete_project` removes an index outright (returns `status: deleted`, or
`status: not_found` when the failed run never registered a project). `ingest_traces`
writes runtime edges into the graph. Neither is a discovery tool; both need an explicit
order. Clean up any probe project you create — this machine had 6 projects and 4 stale
subtree indexes at one point during the diagnosis.

---

## Subagents

A child agent inherits the ability to call these tools but not your findings. Before
delegating, run the graph calls yourself and hand over: the project name, the index
generation, the exact qualified names, the file paths with their coverage status, and
which claims are provisional. A child that has not called `check_index_coverage` will
report whatever generation it happens to be reading as current truth — and on this repo
the generation changed mid-session, invalidating numbers an hour old.

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
   364 functions, many of them mock-registry strings in `ui/src/dev-mock/tauri-api.ts`.
   AGENTS.md's three-grep rule still applies — features register lazily.
5. **Citing a graph path as a location.** See the staleness example above; the directory
   moved and the graph did not notice.
6. **Skipping `check_index_coverage` on the files you are about to edit.** 44 files here
   carry `parse_partial` ranges; one migration file has a 486-line hole. A symbol that
   "has no callers" inside such a range may simply not be in the graph.
7. **Letting `file_tree` or `all` into context unscoped.** 51.8 KB and 59.3 KB
   respectively on this repo. Scope with `path`, or ask for the two or three aspects you
   need.
8. **Re-indexing to "fix" a surprising result.** A surprising result is usually a query
   bug (items 1–3). Re-indexing is a shared-artifact write; ask first.
9. **Assuming the Python form works here.** `import codebase_memory_mcp` is prime-agent
   only. From `run_code` it is `await tools.mcp__cbm__<tool>({...})`, always with
   `project`.
10. **Believing `index_repository` when it says it failed.** All three attempts on
    08-09-26 returned `status: error` at ~2.7 s and the index refreshed anyway. Confirm
    with `index_status` + `check_index_coverage.indexed_at`, never with the return value.
11. **Carrying a number forward from a previous generation.** `transitive_loop_depth`
    topped out at 7 before the re-index and 4 after; the unlabeled-source Cypher went
    42 → 0; `routes` swapped most of its 20 rows. Re-measure anything you quote.
12. **Being surprised by `__file__` nodes.** File nodes are indexed as
    `<qn-with-extension>.__file__` (e.g. `...topologyContract.ts.__file__`) alongside the
    extension-less Module node `...topologyContract`. They carry in=0/out=0 and will pad
    any name search you run without a `label` filter.

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
**not** machine-checked — they are a snapshot of the 2026-09-08T05:07Z index, and that
index was already 2 commits behind HEAD an hour after it landed. Re-run the calls
in "Mandatory first two calls" before repeating any of them to someone else.

---

> last audited 08-09-26 by DSH
