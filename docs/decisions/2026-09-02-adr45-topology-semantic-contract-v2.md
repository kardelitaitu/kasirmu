---
num: 45
area: topology
title: ADR #45: Topology Semantic Contract v2 — Endpoint Predicates, Kind Registry, Deliberate Cold Start, and Theme Parity
status: Accepted — §1–§3, §4.1, §5, §4.2 storage + IPC + migration function, §4.3 ordering rule + backend parity implemented (2026-09-02); §4.2 UI swap and §4.3 checklist UI proposed
---
# ADR #45: Topology Semantic Contract v2

**Status:** Accepted — §1–§3, §4.1, §5, §4.2 storage + IPC + migration function, §4.3 ordering rule + backend parity implemented (2026-09-02); §4.2 UI swap and §4.3 checklist UI proposed
**Date:** 2026-09-02
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** topology, semantic-contract, cross-language-parity, node-kind-registry, cold-start, theming

---

## Context

[ADR #34](./2026-08-07-adr34-business-logic-topology-builder.md) set the goal — "make
valid relationships discoverable and invalid relationships difficult or
impossible to create" — and [ADR #44](./2026-08-08-adr44-typed-connection-gating.md)
shipped the gate, declaring `topologySemantics.json` the single source of truth
for what may connect.

A design review of the topology surface (2026-09-02) found that the *row table*
is in fact a single source of truth, and is well guarded: the Rust crate vendors
a copy (`crates/oz-core/src/topologySemantics.json`, embedded via `include_str!`
at `crates/oz-core/src/topology.rs:35`), `scripts/verify-topology-parity.py:61-68`
byte-compares the two copies, and `crates/oz-core/src/topology_tests.rs:30` fails
the build on drift. The two files are byte-identical today.

What is **not** in that contract is the second half of every rule: which *node
kinds* may sit on each end of a row. Those predicates exist, are enforced, and
were written **six** separate times in two languages with no parity guard
between them. (Line numbers below are as they stood before this change.)

### The six shapes of one rule

| # | Where it lived | What it checked |
|---|---|---|
| 1 | `topologySemantics.json:11-19` | source semantic × target semantic × relationship |
| 2 | `topology.rs:266-296` — hand-written `match` | endpoint node types and workspace typeKeys, 5 rows |
| 3 | `topology.rs:510-521` — pre-filter | **target only**, then `continue` skipped the contract check at `:522` |
| 4 | `topologyCard.ts:346-359` — `operationRowAllowed` | **both** endpoints, generic row only |
| 5 | `topologyContract.ts:473-510` — `semanticNodesMatchWire` | a full duplicate `switch` over all rows |
| 6 | `topologyContract.ts:656-661` — pre-filter | target-only skip, mirroring #3 |

Three consequences follow directly from those lines:

1. **The `operation-out` match arm at `topology.rs:282-288` was unreachable.**
   Its two admitted shapes (`restaurant-pos → kds`, `store-pos → warehouse`) are
   exactly the cases the pre-filter at `:510-519` already skipped. Because the
   pre-filter never inspected the source, a wire from *any other* node kind into
   a KDS or warehouse operation input bypassed semantic validation in Rust
   entirely — while the TypeScript gate refused to offer the same wire.
2. **The TypeScript side had the same hole**, at `topologyContract.ts:656-661`,
   and its own second copy of every predicate at `:473-510`. The live-validation
   mirror that ADR #44 built to guarantee "badges agree with Apply" was therefore
   agreeing with Apply *by coincidence of two hand-written copies*, not by
   construction.
3. **The `location` row was not in the match at all.** It is enforced by a
   dedicated block (`topology.rs:450-480`) whose rule is a *reference*, not a
   kind: the wire must originate from the graph's single branch node
   (`from_node_id == branch_id`) and land on a workspace or warehouse id. No
   kind-based table can express that, which is part of why it drifted out.

### This has already bitten once

`CHANGELOG.md:144` and `JOURNAL.md:3953` record the same failure mode in an
earlier form: both sides read the same JSON, but the TypeScript capacity check
counted *any* stock-bearing wire while the Rust guard counted only wires landing
on `stock-in`/`transfer-in`. A stock-routing wire on the ownership port produced
`warehouse-at-capacity` from TypeScript and `invalid-semantic-connection` from
Rust — the same rejection, narrated differently to the merchant. It was masked in
editor flows because `inferredWire` normalizes ports, and surfaced only for
direct IPC callers. The residual drift was fixed rule-by-rule; the *shape* that
produced it was left in place. This ADR addresses the shape.

### Two adjacent findings from the same review

**Two kind vocabularies, no single owner.** `topologySemantics.json:9` declares
`endpointWorkspaceTypeKeys: ["store-pos", "restaurant-pos", "kds"]`. The editor ignores
that field and hardcodes its own list at `NodeTopologyEditor.tsx:307` —
`['store-pos', 'restaurant-pos', 'kds', 'warehouse']`. Neither list is the
system's real enum: the seeded `workspace_types` table
(`crates/oz-core/migrations/20260813_init.pg.sql:1601-1605`) carries five keys —
`restaurant-pos`, `store-pos`, `warehouse`, `admin`, `kds`. So `warehouse` in
the editor's list is not a bug, and the contract field is not wrong either; it
is the *topology-relevant* subset wearing a name that implies exhaustiveness.
Three lists, three meanings, no declared owner — which is precisely the
condition that lets a fourth appear. §3 gives the registry that ownership.

A related trap surfaced while testing: `general` is a **`purpose_key`**, not a
`type_key` (`topology.rs:596` defaults purpose to `"general"`), yet it appears in
the topology test fixtures in the `typeKey` slot. Any rule written to admit
`general` there would be admitting an unregistered workspace type by accident.

**Per-type knowledge is spread across eleven surfaces.** `topologyCard.ts` opens
with the promise that "adding a new node type should be a one-entry change here —
not a touch in a dozen switch statements" (`:23-25`). In the same file it is
`leftPortVariants` (`:107`), `visiblePortsForNode` (`:116`), `leftPortLabelId`
(`:136`), `portLabelId` (`:157`), `semanticPortLabelId` (`:175`),
`portAriaLabelId` (`:198`), `semanticPortId` (`:212`), `socketSemanticIds`
(`:230`), `gatingSemanticId` (`:274`), `WORKSPACE_SETTINGS_CARD` (`:60`), and
`NODE_TYPE_ICON` (`:456`). Two of these fail *silently* rather than at compile
time: `settingsCardForTypeKey` returns the Store POS card for any unknown
typeKey (`:70`, `?? WORKSPACE_SETTINGS_CARD['store-pos']`), and
`socketSemanticIds` falls through to a generic `['stock-out','transfer-out']`
output set (`:261`). A new workspace typeKey that misses a registration renders a
plausible, wrong graph.

**One correction to the review's own first pass.** An earlier written summary of
this review claimed the editor stylesheet was dark-only by drift, with ~128
hardcoded colours, ~111 `!important`, and 15 ungated animations. Measured
directly, that is wrong and the record is corrected here:
`NodeTopologyEditor.css` is 3,308 lines with **32** hex literals, of which
**29 are `var()` fallbacks** (e.g. `var(--color-success, #10b981)`), and **2**
`!important`. Wire colours are already tokens (`stroke: var(--color-accent)` at
`:858`, `var(--color-info)` at `:884`). There are 9 `@keyframes`, 6
`prefers-reduced-motion` guards, and 2 infinite animations — one correctly gated
behind `no-preference` (`:1098-1102`), one not (`:1931-1933`). The surface is
token-driven by construction; §5 is about making that explicit, not re-skinning
it.

---

## Decision

### 1. Contract v2 — endpoint tuples move into the shared JSON

`schemaVersion` becomes `2`. Every pairing row gains an `endpoints` list of
explicit `{from, to}` **kind tokens**. A row is legal for a given wire iff the
wire's `(sourceKind, targetKind)` tuple appears in that row's list.

```json
{
  "schemaVersion": 2,
  "semanticPairings": [
    {
      "source": "operation-out", "target": "operation-in",
      "relationshipType": "generic", "labelId": "topology-relationship-operation",
      "endpoints": [
        { "from": "workspace:restaurant-pos", "to": "workspace:kds" },
        { "from": "workspace:store-pos",      "to": "warehouse" }
      ]
    },
    {
      "source": "stock-out", "target": "stock-in",
      "relationshipType": "stock-routing", "labelId": "topology-relationship-stock-routing",
      "endpoints": [
        { "from": "workspace:store-pos",      "to": "warehouse" },
        { "from": "workspace:restaurant-pos", "to": "warehouse" },
        { "from": "warehouse",                "to": "warehouse" }
      ]
    },
    {
      "source": "location-out", "target": "location-in",
      "relationshipType": "location", "labelId": "topology-relationship-location",
      "endpoints": [
        { "from": "@branch-root", "to": "workspace" },
        { "from": "@branch-root", "to": "warehouse" }
      ]
    }
  ]
}
```

Three constraints make this safe, and they are the substance of the decision:

- **A closed kind vocabulary, shared by both languages.** A node's kind is one
  string: `branch-location`, `warehouse`, `hardware`, or `workspace:<typeKey>`.
  Both sides already compute the two halves (`node.type` + `metadata.typeKey` in
  TypeScript; `semantic_node_type` + `semantic_type_key` in Rust at
  `topology.rs:261-264`); canonicalizing them into one token turns every
  predicate into a set lookup. `store` folds into `branch-location` at this one
  boundary, so the ADR #34 alias never reaches the contract.
- **Family matching, discovered during implementation.** An endpoint token
  written without a `:` suffix also covers that family: `workspace` admits
  `workspace:store-pos`, while `workspace:store-pos` admits only itself. The
  contract needs both registers — the Location row means "any workspace", the
  Operation row means "this one" — and one prefix rule keeps the comparison a
  line long in each language. Exact-token matching alone, which is what this ADR
  originally specified, refused every legitimate Branch → workspace location
  wire; the first run of the contract tests caught it.
- **No boolean logic in the contract.** Predicates are tuple membership only.
  Rows that need AND/OR — like `operation-out`, whose two admitted pairs are
  *not* the cross product of their endpoints — are written as an explicit pair
  list. An expression language in JSON would need two evaluators, and two
  evaluators is how this ADR's problem was created.
- **`@branch-root` is the only reserved token**, resolving to the graph's single
  Branch Location node. It exists so the location rule
  (`topology.rs:450-480`) can join the table instead of living beside it.
  Whether the graph has *exactly one* such node stays a separate graph-level
  rule (`multiple-branch-locations`), enforced before the wire loop on both
  sides. Unknown kinds, unknown `@`-tokens, and an empty `endpoints` list all
  **fail closed** — a payload that lost its endpoints degrades to "no wire may
  be authored" rather than silently to the looser row-only check, matching how
  unknown semantics already fail closed in `canSemanticPortsConnect`
  (`topologyCard.ts:310-315`).

The Rust `match` (`topology.rs:266-296`) and the TypeScript duplicate switch
(`topologyContract.ts:473-510`) are deleted; both languages call one evaluator
over the contract.

**The two pre-filters were tightened, not deleted** — a deliberate departure
from this ADR's original wording. They exist to route a genuine workspace
operational feed to the specialized `invalid-operation-source` and
`invalid-warehouse-operation-source` checks, so the merchant gets a specific
message instead of the broad one; deleting them would trade a correctness hole
for a worse error. The fix keeps the precedence and closes the hole by testing
the **source** as well as the target: a workspace-sourced operation wire still
skips the generic gate, and a hardware-, warehouse-, or branch-sourced one no
longer slips past it. Folding those two specialized source checks into the
contract is follow-up work, and until it lands the operation row's endpoints are
advisory for authoring while the specialized checks remain the Apply-boundary
authority for that row.

**Deferred, deliberately:** wire *cardinality* (the one-location-wire-per-pair
duplicate check at `topology.rs:450`, and the warehouse primary/operational input
split at `topologySemantics.json:3-8`) stays outside the pairing rows. Folding it
in would mean designing a second schema in the same change.

### 2. A generated cross-language corpus test

Byte parity proves the two files agree. It does not prove the two *evaluators*
agree, and the evaluators are what broke in 2026-08.

`verify-topology-parity.py` gains a second phase: for every combination of
(pairing row × source kind × target kind) drawn from the contract itself plus the
full kind vocabulary, assert that the TypeScript evaluator and the Rust evaluator
return the same verdict. The corpus is generated from the contract, so a new row
or kind is covered automatically — nobody has to remember to write the case that
would have caught them.

This is the part of the decision that makes §1 durable. A schema change without
it leaves the same gap with tidier furniture.

### 3. One node-kind registry, landed behind a behavior freeze

Per-type knowledge collapses into a single `Record<NodeKind, NodeKindSpec>`
keyed by the **same kind token** as the contract, replacing the eleven surfaces
listed above:

```ts
type NodeKindSpec = {
  ports:  { left: readonly SemanticPortId[]; right: readonly SemanticPortId[] };
  labels: Partial<Record<SemanticPortId, string>>;   // Fluent message ids
  icon:   ComponentType;
  settingsCard?: ComponentType;
  renameable: boolean;
};
```

Three specific properties matter more than the consolidation itself:

- **No domain defaults.** The `?? store-pos` settings-card fallback
  (`topologyCard.ts:70`) is removed. With a `Record` over a closed kind union, a
  missing kind is a compile error instead of a plausible wrong inspector.
  Display-layer fallbacks (`topologyUiString`, `:519-525`) stay — those guard
  against a stale locale bundle, which is a different job.
- **Derived registration.** `WORKSPACE_TYPE_KEYS` (`NodeTopologyEditor.tsx:307`)
  becomes a projection of the registry's workspace kinds, which also removes the
  `warehouse` divergence from `topologySemantics.json:9`.
- **A characterization test first.** Before any move, snapshot the current
  `(semantics, label, icon, settingsCard)` tuple for every kind × socket;
  refactor; assert the snapshot is unchanged. This is the spine of a 6,145-line
  editor and ~525 tests in its own suite; a refactor without a freeze is a
  redesign by accident.

### 4. Cold start is "start empty, build deliberately"

This supersedes the preset stance of [ADR #34](./2026-08-07-adr34-business-logic-topology-builder.md).
Presets are retired: the editor opens on an empty canvas, and every wire in a
saved graph is a relationship a human chose. That is the direct expression of
"invalid relationships difficult to create" — a graph the merchant did not
understand cannot be a graph they maintain.

Three obligations come with the stance, and they are the reason it is a decision
rather than a deletion:

- **A mandatory root is not a decision, so do not make the merchant place it.**
  The empty state authors the single Branch Location root (`@branch-root` exists
  exactly once per graph by contract) and points at its `location-out` socket.
  "Deliberate" governs wires, not the root the schema requires.
- **Templates must leave `localStorage`.** Saved diagram templates are keyed
  `ozpos.topology.templates.v1` in browser storage (`topologyExport.ts:16`,
  written at `:161`, read at `:171`, enumerated at `:182`). They are
  configuration, and today they do not survive a different device, a profile
  switch, or a reinstall. They move to persisted, per-branch storage alongside
  the graph.
- **The validation panel becomes the checklist.** It already computes the exact
  next omission (`warehouse-missing-stock-routing`, a workspace with no
  `location-in` wire). Presented as "next step" rather than as a red error, it
  carries cold start without a preset — the graph's own contract tells the
  merchant what to do next.

### 5. Theme parity is a verification task, not a re-skin

The editor is already token-driven (see the correction in Context). The decision
is to make that guarantee explicit and testable:

- Replace the two true literals — `stroke: #fff` (`:1574`) and `fill: #fff`
  (`:1579`), used on the wire validation badge's ring and its glyph — with
  tokens. Implementation found these need *different* tokens, and that the
  glyph was a contrast defect in both themes, not only a theme defect.
- Audit the `var()` fallbacks — 30 hex and 39 in total, not the 29 first
  counted. The audit's premise was that a missing token *would* silently
  reintroduce a dark surface. It already does: five tokens used by this
  stylesheet exist nowhere in the codebase, so their fallbacks are the rendered
  values permanently, and two declarations with no fallback are invalid at
  computed-value time today. Fallbacks are dropped where the token is
  guaranteed; runtime-set tokens keep theirs.
- Gate the one ungated infinite animation, `port-glow` (`:1931-1933`), using the
  house pattern already present at `:1098-1102` (`prefers-reduced-motion:
  no-preference`).
- Delete `.topology-shortcuts-popover` from `ui/src/frontend/themes/components.css`;
  its component no longer exists. Deferred — two compliance tests still list it
  and the removal belongs to the in-flight component deletion. See the
  implementation record.
- Verify the canvas, wires, and node cards in light theme as a gate, not by
  inspection. The gate must cover `fill`/`stroke`, token *existence*, and
  fallback *correctness* — the three things the existing repo-wide token test
  does not check, and the reason none of this was caught.

---

## Consequences

**Positive**

- One rule, one place, both languages. Adding a node kind becomes: register it in
  the contract, register its `NodeKindSpec`, and the corpus test covers the new
  combinations without anyone writing them.
- The silent-failure paths (`?? store-pos`, the generic output fallthrough at
  `topologyCard.ts:261`, the source-blind pre-filter at `topology.rs:510`) become
  compile errors or test failures.
- The unreachable arm and the location-rule special case stop existing, so the
  "Apply button can never be a lie" property of ADR #44's live mirror stops
  depending on two hand-written rule sets staying in step.
- Cold start has a stated philosophy with three concrete obligations, instead of
  a preset removal that leaves a hole.

**Costs and risks**

- A `schemaVersion` bump means both evaluators must accept v1 payloads during the
  transition, or persisted graphs must migrate. v1 rows carry no `endpoints`, so
  the loader needs an explicit "v1 ⇒ admit the row, defer to the legacy path"
  rule that is itself fail-closed. This is the main risk in §1 and the reason §1
  lands before §3.
- The corpus test needs a way to invoke the Rust evaluator from the parity
  script. A `--export-pairing-matrix` debug command, or a Rust test that writes
  the matrix to a fixture the script reads, both work; the choice is an
  implementation detail, but the test is not optional.
- The registry refactor touches the same file as the in-flight preset removal.
  It must land after that work settles, or the characterization snapshot will
  capture a moving tree.
- Retiring presets makes the first-run experience worse until the §4 obligations
  ship. They are part of the decision, not follow-ups to it.

---

## Rollout

| Slice | Scope | Touches | Depends on |
|---|---|---|---|
| **A** | Contract v2 + both evaluators + corpus test; delete the Rust `match`, the pre-filter, and `operationRowAllowed` | `topologySemantics.json` ×2, `topologyCard.ts`, `topology.rs`, `verify-topology-parity.py` | — |
| **B** | Kind registry + characterization snapshot; derive `WORKSPACE_TYPE_KEYS` | `topologyCard.ts`, `NodeTopologyEditor.tsx` | A |
| **C** | Cold start: auto-place root, templates to persisted storage, validation panel as checklist | `TopologyScreen.tsx`, `topologyExport.ts`, api + IPC command | the preset removal settling |
| **D** | Theme parity: 2 literals, 29 fallbacks, 1 animation gate, 1 dead selector, light-theme verification | `NodeTopologyEditor.css`, `themes/components.css` | independent |

A and D are independent of each other and of B/C. A is first because it closes a
live, silent, cross-language failure mode with a recorded precedent.

---

## Non-goals

- No new node kinds, relationship types, or ports. This ADR changes where rules
  live, not what they permit.
- No canvas, selection, wire-editing, or viewport behaviour changes.
- No light-theme *design* pass — §5 makes the existing token discipline hold, it
  does not restyle the editor.
- No migration of persisted graphs to canonical `branch-location` naming. ADR #34
  §1 defers that; this ADR neither advances nor reverses it.

---

## Verification

- `python3 scripts/verify-topology-parity.py` — byte parity **and** the generated
  corpus verdict comparison.
- `cargo test -p oz-core topology` — the vendored-contract drift test plus the
  semantic validation suites.
- `npm run typecheck && npm run lint && npm run test` from `ui/` — the registry
  snapshot must be byte-identical to the pre-refactor capture.
- Manual: one graph per pairing row, applied through the real Apply gate, in both
  themes.

---

## Implementation record

### §1 — contract v2 (shipped 2026-09-02, `e93868e2` + `b4399aa9`)

`schemaVersion` is `2`; all seven rows carry `endpoints`. The TypeScript
evaluator is `nodeKindToken` / `nodeKindOf` / `pairingAllowsEndpoints` /
`pairingAdmitsKinds` / `pairingAllowsNodes` in `topologyCard.ts`, and the Rust
twin is `node_kind_token` / `kind_token_admits` / `pairing_admits_kinds` in
`topology.rs`. Deleted: `operationRowAllowed`, the `semanticNodesMatchWire`
switch, and the Rust `match` with its unreachable arm. Both pre-filters now test
the source as well as the target.

**One merchant-visible behaviour change, intended.** A workspace whose
`typeKey` the contract does not declare is no longer authorable as a stock or
transfer source. Previously the canvas offered that wire and the Rust gate
rejected it, so the merchant was invited to draw a relationship that could never
persist. An unregistered type becomes authorable by declaring its endpoint rows.

**Evidence.** `cargo test -p oz-core --lib topology` 47/47 (5 new);
`topologyCard.test.ts` + `topologyContract.test.ts` 94/94 (3 new); the eight
topology component suites 312/312; `tsc --noEmit` clean; `eslint` clean;
`verify-topology-parity.py` OK. In the full UI suite, 11 tests fail — all 11
reproduce with this change stashed, and every one names a preset fixture
(`Downtown Branch`, `New Retail POS`), a `.topology-shortcuts-popover` CSS rule
its component no longer has, or a hardcoded `18px` port padding: the concurrent
preset-removal work, not this contract.

### §2 — corpus test (shipped 2026-09-02)

`crates/oz-core/src/topologySemantics.matrix.json` is the generated corpus:
every (pairing row × source kind × target kind) combination — 7 rows × 9 kinds
× 9 kinds = 567 verdicts — produced by the Rust evaluator, never by restating a
rule. Both gates assert against it:
`topology_matrix_golden_matches_the_rust_evaluator` in Rust, and
`ui/src/__tests__/topologyMatrix.test.ts` in TypeScript (572 tests, 567 of them
generated). A change to either evaluator now fails a test until the golden is
regenerated deliberately and the matrix diff is reviewed — which is where a new
rule gets argued instead of quietly landing on one side.

The golden is Rust-generated because the backend is the persistence authority:
it defines what a wire that survives means. The TypeScript test is the one that
catches the canvas drifting from it.

The corpus probes three undeclared kinds on purpose — `workspace:pharmacy-pos`
(an unregistered POS type), `workspace:general` (a `purpose_key` mistaken for a
`type_key`), and `not-a-kind` — so fail-closed behaviour is pinned rather than
assumed.

`verify-topology-parity.py` gained a second phase. It cannot run either
evaluator, so it enforces the corpus's *shape*: existence, schema version, one
row per pairing in contract order, every declared kind probed, the full
cross-product per row, and **at least one admitted pair per row**. That last
check exists because removing the family-match rule made the Location row
all-false while every other test still passed; a row that authorizes nothing is
either a dead contract member or a broken evaluator, and the script now forces
the question.

Two bugs were caught by negative-controlling this slice's own tests — the
practice, not the assertion, found them:

1. The corpus guard script printed row labels containing `→`, which raised
   `UnicodeEncodeError` on a cp1252 Windows console. The script died *instead
   of reporting the drift it had found*: a guard that fails closed by failing
   silently is worse than no guard. Output is now forced to UTF-8 with
   `errors="replace"`, and labels use `->`.
2. The corpus test was verified by tampering one golden verdict and confirming
   2 assertions failed, and the shape guard by zeroing a row's verdicts and
   confirming the specific message. A test that has never been observed failing
   is not evidence.

### §2 — what is still not covered

The corpus pins the **endpoint evaluator**. It does not yet pin the two
specialized operation-source checks (follow-up #2) or `socketSemanticIds`'
capability fallthrough (follow-up #1), both of which can still make the canvas
and the gate disagree for reasons other than endpoint kinds.

### §3 — behavior freeze (shipped 2026-09-02) and what it revealed

`ui/src/__tests__/topologyKindBehavior.test.ts` captures every observable
behaviour of the eleven per-type surfaces — sockets, semantics, gating and
recording ids, labels, aria labels, icons, settings cards, copy sanitization —
across eleven probes, into `topologyKindBehavior.golden.json`. The registry
refactor must leave that file byte-identical; if it changes, the refactor
changed behaviour and that has to be argued, not merged. The repo uses no
snapshot framework anywhere (0 uses of `toMatchSnapshot`), so the freeze is an
explicit golden with the same regeneration discipline as the §2 corpus
(`TOPOLOGY_BEHAVIOR_UPDATE=1`).

Reading the freeze surfaced four things the source review had missed:

1. **Every workspace kind renders the same icon.** `NODE_TYPE_ICON` is keyed on
   `node.type`, so `store-pos`, `restaurant-pos`, and `kds` all resolve to
   `PosIcon` — in the card (`topologyNodeCard.tsx:204`), the inspector
   (`NodeTopologyEditor.tsx:5710`), and the context menu
   (`topologyContextMenu.tsx:207`). Meanwhile the tool rack offers
   `UtensilsIcon`, `CartIcon`, and `NodesIcon` for those same three
   (`topologyToolRack.tsx:128-130`). Workspaces are the only nodes whose
   add-icon differs from their canvas icon: a merchant clicks a fork and knife
   and gets a POS terminal. A structure keyed on `node.type` **cannot** express
   a per-kind icon, which is the strongest argument for the registry.
2. **The unregistered-type fallthrough is confirmed empirically.**
   `workspace:warehouse`, `workspace:admin`, `workspace:general`, and a
   workspace with no typeKey all receive `stock-out, transfer-out` sockets and
   `WorkspaceStorePosSettings`. After §1 the contract refuses every wire from
   those sockets, so those cards advertise inputs and outputs that can never
   legally connect — follow-up #1, now measured rather than inferred.
3. **Right-socket order is meaningful and differs by kind**: `store-pos` yields
   `stock, transfer, operation` while `restaurant-pos` yields
   `operation, stock, transfer`. The registry must preserve order, not become a
   set. The freeze pins it.
4. **Two contract fields have no production readers at all.** Neither
   `nodeKinds` nor `endpointWorkspaceTypeKeys` is read by any TypeScript or Rust
   production code; the only readers are the §2 corpus tests, which now make
   them load-bearing as a coverage forcing function — a declared kind that the
   corpus does not probe fails. That is a legitimate role, but it is not the
   role the field names imply, and §3 should say so out loud.

This also corrects §Context's framing of the three lists. `WORKSPACE_TYPE_KEYS`
has exactly one consumer, `NodeTopologyEditor.tsx:5841`, which filters out its
own fourth member (`k !== 'warehouse'`) — the entry exists only to be removed.
The honest description is three lists with three *different* jobs: the DB enum
(what the system supports), the contract field (what the semantic contract
declares endpoints for, now also what the corpus must probe), and the palette
list (what a merchant may add). "Derive the editor list from the registry" is
therefore wrong as originally written: the registry should **own** the palette
list as its own declared concern, not inherit it from the contract.

### §3 — kind registry (shipped 2026-09-02)

`NODE_KIND_REGISTRY` in `topologyCard.ts` now holds one row per kind —
`branch-location`, `warehouse`, `hardware`, `workspace:store-pos`,
`workspace:restaurant-pos`, `workspace:kds`, `workspace:warehouse`, and an
explicit `workspace:*` fallback — carrying visible ports, left variants, both
socket semantic lists in order, the recording-side map, right labels and aria
labels, the connected-port label override with its precedence, icon, settings
card, type label, and whether the inspector may switch to it.

Eight functions now delegate: `leftPortVariants`, `visiblePortsForNode`,
`leftPortLabelId`, `portLabelId`, `portAriaLabelId`, `semanticPortId`,
`socketSemanticIds`, `settingsCardForTypeKey`, plus `workspaceTypeLabel`. The
`?? store-pos` fallback is gone — an unregistered type reaches the
`workspace:*` row, which declares the Store POS card as data instead of
inheriting it from a trailing `??`.

**The behavior freeze held byte-identically**, which is the proof the refactor
changed no behaviour. `topologyKindBehavior.golden.json` was not regenerated at
any point during it.

**The card token is deliberately not the contract token.** `nodeKindToken`
resolves a workspace with no typeKey to `workspace:store-pos`, because that
default is what keeps such a node authorable as a Store POS under §1. The card
must keep treating it as unregistered, or every legacy type-less node would
silently gain full POS sockets. So `cardKindToken` exists, resolves it to
`workspace:*`, and `topologyKindRegistry.test.ts` pins the divergence as a
named promise rather than an accident of two code paths.

**§1 and §3 now close a loop.** The registry test computes, for every kind,
which advertised sockets the §1 contract admits no wire for, and asserts the
result *exactly* as a debt ledger:

```
workspace:admin:right:stock-out      workspace:warehouse:right:stock-out
workspace:admin:right:transfer-out   workspace:warehouse:right:transfer-out
```

Four entries, all the fallthrough shapes, nothing else. Adding a kind with an
illegal socket fails the test; fixing one shrinks the ledger, which also fails
until the entry is deleted — so the debt can neither grow quietly nor be
forgotten. Follow-up #1 is now a named list rather than a paragraph.

`WORKSPACE_TYPE_KEYS` is deleted from `NodeTopologyEditor.tsx`. Its single
consumer filtered out the list's own fourth member; selectability is now
`typeSelectable` on the row, and `SELECTABLE_WORKSPACE_TYPE_KEYS` is derived
from it.

**The KDS icon defect is fixed as its own deliberate golden change.** The
registry keys on kind, so it could finally express what the tool rack had been
offering all along: a cart for a retail terminal, a fork for a restaurant
terminal, a node cluster for a kitchen display — while the canvas drew all three
as `PosIcon` because the old map was keyed on `node.type`. The three workspace
rows now name those glyphs, and the card and inspector resolve them through
`iconForNode`. `topologyKindBehavior.golden.json` regenerated with **exactly six
changed lines, three `-` and three `+`, all of them `"icon"`** — the surgical
diff is the evidence that nothing else moved. `NODE_TYPE_ICON` stays for the
context menu's add-node list, which iterates node *types* and is correct to do
so.

This is the mechanism the freeze exists to provide: a behaviour change is a
golden diff you read, not a claim in a commit message.

One lint rule had to be satisfied honestly rather than bypassed:
`react-hooks/static-components` flags JSX with a computed tag (`<Icon />` where
`Icon` came from a function call) as a render-local component. The lookup
returns an existing module-level component, so the code now says
`createElement(iconForNode(node), { size: 16 })`, which states that intent
directly instead of looking like a violation.

### §5 — theme parity (shipped 2026-09-02)

Implementing this section disproved most of what it asserted. The numbers were
wrong in one direction and the problem was worse in another.

**Five tokens used by the topology stylesheet do not exist.** `--color-surface`,
`--color-bg-base`, `--color-fg-on-primary`, `--font-family-mono`,
`--font-weight-regular` — zero definitions in any CSS file, zero references in
any TS file. §5 predicted "a missing token *silently re-introduces* a dark
surface", as if it were conditional. It is not: **the fallback is the rendered
value, permanently.** And two of the five carried no fallback at all, so those
declarations were invalid at computed-value time *today* —
`.wire-bend-handle { stroke: var(--color-surface) }` was stroking the wire bend
handles with the CSS initial value, black, in both themes.

**Not one of the 28 hex fallbacks matched the token it fell back from.**
`--color-success` carried three different wrong greens (`#10b981`, `#22c55e`,
`#4caf50`) against a real `#2E9E3E`/`#6FE884`; `--color-accent` said `#5a9fd4`
against a real `#1155CC`/`#147EFB`; `--font-weight-bold` fell back to `600`
against a real `700`; `--text-xs` to `0.75rem` against a real `0.625rem`. These
are a second, unmaintained palette from an older design system — dead while the
token resolves, which is always, and actively wrong the instant it does not.
All 37 literal fallbacks are dropped; the two runtime-set cursor tokens
(`--mouse-x`, `--mouse-y`) keep their `50%` default because before the first
pointer event there genuinely is no value.

**The two `#fff` literals needed different tokens, and one was not a theme bug
at all.** The badge ring separates the marker from the wire behind it, so it must
*be* the canvas colour (`--color-bg`); a literal white reads as a clean
punch-out on the dark canvas and vanishes on the light one. The "!" glyph sits
on a saturated danger fill, so it needs `--color-text-on-color` — navy on the
lighter dark-theme red, white on the deeper light-theme red. Plain `#fff`
contrasted in **neither** theme. That is an accessibility defect the theme
framing had been hiding.

**The count was 30, not 29** (39 counting non-hex fallbacks). The ADR's number
was close and its direction was right; its diagnosis was too gentle.

**`themeTokenCompliance.test.ts` has three structural holes**, all of which the
topology canvas fell through: its `COLOR_PROPERTIES` set omits `fill`, `stroke`,
`stop-color` and `flood-color`, so an SVG surface can hardcode forever and stay
green; it never asks whether a token *exists*; and it never asks whether a
fallback is *correct*. `ui/src/__tests__/topologyThemeParity.test.ts` closes all
three plus reduced motion, and was **negative-controlled**: reintroducing a
phantom token, a stale fallback, a bare `stroke: #fff`, and an ungated infinite
animation fails 5 of its 7 tests with messages naming each offender. The repair
tool is `scripts/strip-topology-token-fallbacks.py`, which runs in `--check`
mode.

**Deferred, deliberately:**

- `.topology-shortcuts-popover` in `themes/components.css` (3 grouped rules).
  The component is gone from production code, but two compliance tests still
  list it as a surface — `popoverSurfaceCompliance.test.ts:54` and
  `noiseDitherCompliance.test.ts:146` — and that test is **red at HEAD** because
  the topology CSS no longer defines the rule. Deleting the selector means
  editing both test lists, which is the same in-flight component removal a
  concurrent agent is finishing. Touching it now risks a collision for no gain.
- The 4 `themeTokenCompliance` violations at HEAD: two `18px` port-label
  paddings in this stylesheet (commit `013c04cd`) and two in
  `frontend/shell/Tooltip.css`. Proven pre-existing by stashing this slice's CSS
  and re-running: 4 violations before, 4 after. The `18px` pair is not a
  mechanical token swap either — no spacing token equals 18px, so "fixing" it
  would move the port labels a concurrent agent just laid out.

### §4 — cold start (§4.1 closed 2026-09-02; §4.2–§4.3 open)

Reading the load path before changing it overturned this section's premise too.
The first obligation — "a mandatory root is not a decision, so do not make the
merchant place it" — **is already implemented** on the seeded path:
`NodeTopologyEditor.tsx:1622-1634` walks `branchLocations ?? []` and pushes a
`type: 'store'` node per location that no existing node already claims, keyed by
`id = location.id` with `storeProfileId = location.id`, the location's name, and
a default slot position. That is the `@branch-root` the contract requires,
authored without a merchant decision, and it is why `multiple-branch-locations`
can treat a second root as an error at all.

What was **not** resolved then is resolved now, by test rather than by reading.
A fresh store — real `branchLocations`, no workspace instances, `loadTopology`
resolving `null` — opens on exactly one node, the Branch Location card keyed by
`location.id`, with the onboarding hint stepped aside and the canvas **not**
dirty. `NodeTopologyEditor.test.tsx` › *"authors the Branch Location root for a
fresh store that has a location"* and *"does not mark the canvas dirty for a root
the merchant never placed"*. The second is the one that matters: the root lands
in the same `commitSnapshot` as the loaded graph, so it is part of the applied
baseline rather than an edit — otherwise every fresh store would open showing
"Unsaved changes", asking the merchant to Apply a decision they were never asked
to make. Both were negative-controlled by replacing the seed loop's
`branchLocations ?? []` with an empty array; the root test fails, so it detects
the behaviour rather than the render.

**§4.1 is therefore closed as already-implemented, now with the tests that keep
it that way.** The two genuinely rootless cases — `branchLocations: []` with no
instances, and the `unassigned` pseudo-branch — keep the onboarding hint, which
is correct: there is no branch to root on.

Obligations 2 and 3 are each a full slice on their own and neither is mechanical:

- **Templates out of `localStorage`** (`ozpos.topology.templates.v1`,
  `topologyExport.ts:16/161/171/182`) needs a table, a migration, a Rust command,
  an API client, and UI — and `init.pg.sql` is generated, so the PG drift gate
  and `generate-pg-migration.py` are in the loop.
- **The validation panel as checklist** is a redesign of
  `topologyValidationWidget.tsx`, which today presents a flat, dismissible issue
  list with jump actions. "Next step" framing needs new Fluent copy (and the
  bundle-parity gate), an ordering rule over `TopologyValidationError` codes, and
  a decision about whether a checklist replaces the error list or sits above it.

### Follow-ups this slice surfaced

1. ~~`socketSemanticIds` still hands an unregistered workspace type the generic
   `['stock-out','transfer-out']` output set~~ — **now measured and pinned** as
   the four-entry debt ledger in `topologyKindRegistry.test.ts`. The remaining
   work is the decision, not the discovery: either register endpoints for those
   types in the contract, or make the `workspace:*` row advertise no output
   socket at all. Either edit shrinks the ledger to empty and the test forces
   its deletion.

   **RETRACTION (2026-09-02, same day, one round later): the paragraph below this
   line is FALSE and must not be relied on. It was written from a traced code path
   without a test, and the test written the next round refuted it.** A
   `workspace:admin → warehouse` stock wire — an endpoint the contract does not
   declare — passes `validate_semantic_json` cleanly, while the identical graph
   with `store-pos` as the source also passes. So the contract gate is **not**
   refusing unregistered-workspace stock wires on the backend, and the argument
   that removing the `workspace:*` sockets cannot orphan saved data is
   unproven. The socket-debt edit stays blocked, now on a sharper question: why
   the gate admits this wire at all, and whether the vendored `endpoints` lists
   are enforced for stock/transfer on the Rust side or only offered by the
   frontend. Do not shrink the ledger until that is answered with a test.

   **CORRECTION OF THE CORRECTION (2026-09-02, one round later) — the retraction
   above is itself wrong; the ORIGINAL claim stands, now actually tested.** The
   probe that appeared to refute it was built with `semantic_node`, whose third
   parameter is `store_profile_id`, not `type_key`. Both of its workspace nodes
   therefore carried no type key at all, and a type-less workspace canonicalizes
   to `workspace:store-pos` by design — a type the contract DOES declare a stock
   endpoint for. Both graphs were the same legal wire; neither ever tested
   `admin`. The test passed for a reason unrelated to what it appeared to test,
   and the retraction drew a conclusion about the backend gate from a fixture
   that never exercised it.

   Rebuilt with `typed_node`, which does take a type key, and pinned as
   `an_unregistered_workspace_type_has_no_stock_endpoint_in_the_contract`:
   `node_kind_token` yields `workspace:admin`, `pairing_admits_kinds` returns
   false for it, and `validate_semantic_json` refuses the wire with
   `invalid-semantic-connection`. A positive control asserts the declared
   `workspace:store-pos -> warehouse` endpoint is admitted, built the same way so
   it cannot repeat the mistake.

   The original finding therefore holds: a wire the contract refuses cannot reach
   storage, so removing the `workspace:*` sockets orphans no saved data, and the
   socket-debt edit is unblocked. Two lessons kept on the record rather than
   edited out: a traced code path is only a hypothesis, and a passing test is not
   evidence until you check that its fixture exercises the thing its name claims.

   **The edit is still not safe, for a different reason found while attempting
   it (2026-09-02).** Persistence is no longer the blocker; the row itself is.
   `workspace:*` serves two populations with opposite requirements, because the
   two token functions deliberately disagree about a type-less node:

   - `nodeKindToken('workspace', undefined)` → `workspace:store-pos`, so a legacy
     node with no type key keeps POS endpoints at the contract.
   - `cardKindToken({ type: 'workspace' })` with no type key → `workspace:*`, so
     that same node renders from the fallback row.
   - `workspace:admin` has no row of its own, so `nodeKindEntry`'s
     `?? NODE_KIND_REGISTRY['workspace:*']` hands it the same row. (Corrected the
     round after this was written: `cardKindToken` does NOT collapse an explicit
     unknown key to `workspace:*` — it keeps `workspace:admin`. The conflation is
     in the entry lookup, one step later. The conclusion is unchanged; the
     mechanism as first stated was wrong, and a test now pins the real one.)

   Deleting the row's `rightSemantics` would therefore strip visible stock-out
   and transfer-out ports from legacy store nodes that the contract says may
   legitimately source them — a real regression traded for a cosmetic ledger. The
   debt is not the sockets; it is that one rendering row stands in for both "no
   type key, means store-pos" and "unknown type key, means nothing".

   The small fix is to make the fallback honest by separating those cases in
   `cardKindToken`: a type-less workspace should resolve to `workspace:store-pos`,
   matching what the contract already says about it, leaving `workspace:*` for
   genuinely unknown keys. Then the row can advertise no output socket without
   touching a legacy node. That is a rendering change for legacy stores, so it
   needs its own characterization pass first — not a two-line deletion.

   **Measured (2026-09-02, next round): that route is not free, and there is a
   better one.** The two rows are not near-identical as assumed:

   | | `workspace:store-pos` | `workspace:*` |
   |---|---|---|
   | `rightSemantics` | `stock-out, transfer-out, operation-out` | `stock-out, transfer-out` |
   | `icon` | `CartIcon` | `PosIcon` |

   So retargeting the type-less token at `workspace:store-pos` would **grant
   legacy nodes an `operation-out` socket they do not currently have** and change
   their glyph. The first is a capability change — defensible, since the contract
   already treats the node as `store-pos` and declares `workspace:store-pos ->
   workspace:kds`, so a legacy store arguably should be able to feed a KDS — but
   it is a product decision, not a cleanup, and the icon change is visible either
   way.

   The route that needs no decision: give the unregistered types their **own**
   rows with no output sockets, and leave `workspace:*` alone. `workspace:admin`
   and `workspace:warehouse` reach the fallback only through `nodeKindEntry`'s
   `??`, so an explicit row pre-empts it for them and nothing about a type-less
   legacy node changes at all. That empties all four ledger entries, and the
   equality test from round 14 keeps failing if anyone later collapses the two
   populations back together.

   Not done for lack of context, not for lack of clarity. The edit is four lines
   of registry plus emptying `UNAUTHORABLE_SOCKET_DEBT`, and it must be followed
   by the full UI topology suite — `NodeTopologyEditor.test.tsx` in particular,
   which is the only thing likely to hold an assertion that an admin card has
   stock sockets.

   **Attempted, and the suite said the plan was wrong in two ways (2026-09-02).**
   Reverted; nothing above this line was shipped.

   1. `workspace:warehouse` **already has its own registry row** — a duplicate
      key was a compile error. So the premise that it reaches the fallback
      through `??` is false, and its two ledger entries come from that existing
      row's own `rightSemantics`. The fix there is a one-line edit in place, not
      a new row. Only `workspace:admin` actually falls back.
   2. `rightLabelId` and `rightAriaLabelId` are **required** on `NodeKindEntry`,
      not optional, so a row cannot simply omit the right side. A row with
      `visiblePorts: ['left']` still has to carry right-socket labels, which
      means either widening the type or leaving dead fields on the row — a real
      design question this thread has not asked before.

   Useful result from the same run: `NodeTopologyEditor.test.tsx` passed all 510
   tests against the broken registry, so the merchant-facing editor flow is not
   what this change threatens. What it threatens is the registry's own tests and
   the behavior golden — which is the expected blast radius, and the golden needs
   `TOPOLOGY_BEHAVIOR_UPDATE=1` regeneration rather than hand-editing.

   The corrected edit, in order: empty `rightSemantics` on the existing
   `workspace:warehouse` row; add a `workspace:admin` row that carries the two
   required right-label fields; decide whether `NodeKindEntry` should make those
   fields optional when `visiblePorts` excludes `'right'`; regenerate the golden;
   then empty the ledger last, so each step's failure is attributable.

   **Follow-up #1 is CLOSED (2026-09-02).** Both steps shipped — `86f92003` for
   `workspace:warehouse`, `06ae21ab` for `workspace:admin` — and
   `UNAUTHORABLE_SOCKET_DEBT` is now an empty array, kept as an instrument rather
   than deleted. The two-population tests written in round 14 did their job: one
   of them failed the moment `admin` got its own row, which was the signal the
   change was supposed to produce before acceptance, not after.

   Two things this closed without pretending otherwise. The residual is real:
   `workspace:*` still advertises stock and transfer, and any type the registry
   has never heard of still resolves to it and gets those sockets. That is the
   deliberate price of legacy nodes carrying no type key, and it is recorded in
   the ledger comment rather than presented as a finished job. And one question
   stayed open by design — `rightLabelId` / `rightAriaLabelId` are required on
   `NodeKindEntry`, so both new rows carry two fields that can never render.
   Making them conditional on `visiblePorts` is a type change with consumers to
   audit, and it was left as its own piece of work rather than folded in.

   **Closed without changing the type (2026-09-02).** The audit came back as two
   consumers, both total functions today. Making the fields optional would push an
   `undefined` case into each of them and need a fallback message key that means
   nothing for half the kinds — for the benefit of deleting four unused string
   literals. `records` in the same interface IS optional, and that is the useful
   contrast: its consumers already handle absence, so optionality there costs
   nothing. The invariant is now stated at the field, so the dead fields read as
   an accepted trade rather than unfinished work. Recorded because "we decided not
   to do this" needs to be as findable as "we did".

### Whole-suite verification (2026-09-02, after 19 rounds of scoped runs)
   Every gate in this slice had been run against topology-scoped suites only,
   which is a real blind spot: a change to a shared registry can break a test
   that never mentions topology. The full UI suite was run for the first time.

   `7726 passed / 18 skipped / 4 failed` across 409 files. All four failures were
   checked rather than assumed to be unrelated:

   - `themeTokenCompliance` and `popoverSurfaceCompliance` — both already red at
     HEAD before this slice, recorded in the deferred list above (the `18px`
     port-label paddings from another agent's commit, and the
     `.topology-shortcuts-popover` deletion).
   - `SettingsPage > keeps unconfigured sync unconfigured` — outside topology
     entirely.
   - `NodeTopologyEditorDevMock > reloads the authoritative diagram...` — the one
     worth recording, because it is topology-adjacent and had never been run in
     this slice. It fails on `Unable to find an element with the text: New Retail
     POS`, and that string exists **only in the test file**, in no production
     module and no bundle. `git log -S` over the whole history returns two
     commits, neither of them a registry change from this slice. So the test
     asserts a label the app does not produce; it is not a regression introduced
     here, and it is left to its owner rather than being edited blind from an
     unrelated thread.

   Conclusion: no evidence that any change in this slice broke anything outside
   the topology suites that were run for it. The blind spot itself is the finding
   — scoped green is not green.

### Consolidated gate record (2026-09-02, current HEAD)

Every gate run together for the first time, after all implementation commits:

| Gate | Result |
|---|---|
| Full UI suite (`--maxWorkers=2`) | 7732 passed / 18 skipped / **4 failed** |
| `cargo test -p oz-core --lib topology` | 52 / 52 |
| `cargo test -p oz-pos-app --lib topology` | 329 / 329 |
| `scripts/verify-topology-parity.py` | exit 0, both phases |

The four UI failures are the same four as the first full run, one commit earlier,
and the totals differ by exactly the six migration tests added in between — so
nothing in this slice broke them and nothing else regressed. They are:
`themeTokenCompliance` and `popoverSurfaceCompliance` (both red at HEAD before
this slice, in the deferred list), `SettingsPage > keeps unconfigured sync
unconfigured` (outside topology), and `NodeTopologyEditorDevMock` (asserts a label
the app does not produce; see above).

`--maxWorkers=2` is required: the full run crashes the worker pool at the default
count on this machine, which is an environment limit and not a test failure.

   ---

   ~~The data-compatibility blocker on this is resolved, and it pointed the
   opposite way from what was assumed.~~ The worry was that removing
   the sockets could orphan wires already saved in a merchant diagram. It cannot:
   every write goes `save_topology_json_at_key_with_revision` →
   `validate_semantic_ownership` → `validate_semantic_json`, which refuses any
   wire the contract gate rejects. A stock or transfer wire leaving an
   unregistered workspace type was never persistable, so there is nothing on disk
   to orphan — the only graphs that ever held one were unsaved canvases, which is
   precisely what §4 wants to make unauthorable.

   One carve-out to know before editing: `validate_semantic_json` skips the
   contract gate for `operation-out → operation-in` wires of relationship
   `generic` leaving a workspace, leaving those to the specialised checks. Stock
   and transfer are not in that pre-filter, so the reasoning above holds for all
   four ledger entries. It does not hold for operation wires, where the
   specialised check is the only gate — which is why item 2 mattered.
2. The `invalid-operation-source` / `invalid-warehouse-operation-source` checks
   are a seventh and eighth statement of the operation row's endpoints. They
   give better messages and should stay, but the contract should generate them.

   **Done for `invalid-operation-source` (2026-09-02)**, in both languages:
   `topologyContract.ts` and `crates/oz-core/src/topology.rs` now ask
   `pairingAdmitsKinds` / `pairing_admits_kinds` rather than testing a type key
   alone. The Rust set was also inconsistent with its own neighbour —
   `restaurant_pos_ids` checked type key only while `retail_pos_ids` checked kind
   and type key. Building the graph to prove the hole was reachable showed the §1
   wire gate refuses that feed first, so the weak predicate was defence in depth
   that could never fire; the test now pins that ordering instead.
   `invalid-warehouse-operation-source` was still hand-written at that point; it
   moved the same way in `862164ce`, so **follow-up #2 is now closed in both
   languages for both variants.** Worth recording that the warehouse predicate
   was never wrong — it checked kind alongside type key, unlike the KDS one — so
   that change removed a duplicate rather than fixing a defect. Keeping those two
   categories distinct is what stops the history implying a bug merchants never
   hit.
3. ~~Three workspace-type lists with three meanings and no owner~~ — **half
   resolved.** The editor's list is gone, derived from `typeSelectable`. The
   contract's `endpointWorkspaceTypeKeys` and the DB's `workspace_types` table remain
   two different vocabularies, which is correct — one declares what the semantic
   contract has endpoints for, the other what the system can store — but the
   contract field's name still implies the second meaning. Renaming it to
   `endpointWorkspaceTypeKeys` (or documenting it at the field) would finish the
   job.

   **Done (2026-09-02).** Renamed across both vendored JSON copies, the Rust
   corpus test, both TypeScript contract tests and `verify-topology-parity.py`.
   The name was not merely imprecise: every consumer builds an endpoint token
   from it (`format!("workspace:{}", key)`), and nothing reads it as a palette
   list — yet the palette's own list, `SELECTABLE_WORKSPACE_TYPE_KEYS`, is
   derived separately from the card registry. Two similarly-named fields with
   different meanings and different sources is exactly the shape this ADR keeps
   collapsing. Parity re-verified byte-identical at 2,515 bytes; 49/49 Rust and
   688/688 UI topology tests pass unchanged, and the generated golden matrix
   never referenced the field, so it needed no regeneration.

---

## §4.3 prerequisite is half a prerequisite (2026-09-02)

Round 26 recorded the ordering rule as §4.3's finished prerequisite. That was
wrong in a way worth writing down, because it is the exact failure mode this ADR
is named for.

The rule orders the **TypeScript** list. The backend does not have a list:
`validate_semantic_json` has fourteen `return Err(topology_validation(...))` sites
and collects nothing, so it short-circuits on the first failure it happens to
encounter in traversal order. The TypeScript validator has twenty-five
`errors.push` sites and now sorts them by tier.

Both surfaces reach the merchant. The live checklist is the TS list; the Apply
rejection is the Rust single error, surfaced through `TopologyApplyValidationError`
(`NodeTopologyEditor.tsx:2148`). So a merchant can be told "fix the cycle" by the
checklist and "this wire has an incompatible semantic connection" by Apply, for the
same graph.

This is not a correctness bug — Apply still refuses what it should refuse, and the
tier ordering is still strictly better than `errors[0]`. It is a **presentation
divergence between two implementations of one rule**, which is what sections 1-3
spent this whole slice eliminating in the pairing table.

What §4.3 actually needs, and the choice it forces:

1. **Order the Rust side too** — convert fourteen short-circuits into a collected,
   sorted result. Largest change, and the only one that makes the two surfaces
   agree by construction rather than by luck.
2. **Let the checklist defer to Apply** — render the TS ordering only while no
   Apply has happened, and replace it with the backend's error once one has.
   Smallest change, and honest: the backend is the authority, so the checklist
   should not compete with it.
3. **Accept the divergence and label it** — cheapest, and probably wrong: a
   checklist that contradicts the button next to it teaches merchants to ignore
   both.

Recommendation is 2 for §4.3 and 1 as its own later slice. Option 1 is the correct
end state but it is a refactor of the backend validator's shape, not something to
fold into a UI change.

## Validation-code coverage: TS 24 vs core 14 (2026-09-02)

Compared the codes the TypeScript validator can emit against those the core Rust
validator emits. The first count said **ten TS codes had no backend check**. That
number was wrong by roughly five times, and the ways it was wrong are the useful
part.

Breakdown of the ten, each verified individually:

- **Four were a regex artifact.** `missing-operation-input`,
  `multiple-operation-inputs`, `missing-location-input`,
  `multiple-location-inputs` are all emitted in `topology.rs` — but through a
  *conditional expression* as the first argument to `topology_validation(...)`,
  not a literal string. A pattern anchored on `topology_validation("code"` cannot
  see them. The code was fine; my extraction was too narrow.
- **Three live at another layer, by design.** `unsupported-schema-version` is
  enforced on read in `semantics.rs:235` (see the two-version-axes note in §2 —
  the envelope version is a read gate, not a graph rule). `warehouse-at-capacity`
  and `warehouse-missing-stock-routing` are enforced in the desktop-client
  `persistence.rs`, which is where Apply actually runs.
- **One is a code-name divergence, not a gap.** `unknown-wire-endpoint` has no
  backend equivalent, but a probe with a wire pointing at a nonexistent node is
  refused — as `invalid-location-connection`. The graph is rejected either way.
  What differs is the label, so the live checklist and Apply can name the same
  defect with two different codes.

**Two remained** after that, and one of them turned out to be the same mistake
again — see below.

**`warehouse-tier-limit` — CLOSED, not a gap.** The next round looked for the
*rule* rather than the code string and found it: `apply_topology_diff`
(`commands.rs:248`) calls `validate_warehouse_quota(&diagram_nodes,
&effective_tier)` at L473, after loading the tenant subscription, running
`validate_clock_rollback`, and `verify_signature`. It has its own test suite in
`persistence_tests.rs` covering no-warehouses-always-ok, free-tier-one-ok,
free-tier-two-rejected, and uncapped tiers. So the entitlement is enforced
server-side and well covered; the only thing missing was the TS code string,
because the backend names the rule `validate_warehouse_quota` rather than echoing
the UI's `warehouse-tier-limit`.

This is the second of the ten to dissolve into a naming mismatch, and it is the one
that looked most like a security hole. Worth stating plainly: **grepping for a
client-side error code and finding nothing is evidence about the code string, not
about the rule.** The first round's "ten validation rules exist only in the UI"
would have been a serious-sounding, entirely false claim about entitlement
enforcement.

**`multiple-ticket-inputs` — CLOSED by `c4cfbef8`.** Searched under
`ticket_in`, `ticket-input`, `multiple_ticket`, `ticket_count` across `crates/`
and `apps/`: no reference. Unlike the other nine, there is no plausible alternate
name or layer to check — the rule appears to exist only in the TypeScript
validator, which enforces a cardinality limit on a node's ticket inputs that the
backend does not.

Read the TypeScript rule first, which is what made it portable: it constrains
`hardware` nodes to at most one `ticket-routing` wire arriving on `ticket-in`. Two
feeds leave routing undefined — which queue a ticket reaches depends on wire order
— so the backend must not accept the graph. Ported as a standalone pass before the
per-node gates, with two tests.

The audit therefore closes at **zero unenforced rules**: of the ten apparent gaps,
four were a too-narrow regex, three were enforced at another layer by design, two
were naming mismatches whose rule did exist, and this one was real and is now
fixed. The headline that would have survived review — "ten validation rules exist
only in the UI" — was wrong nine times out of ten.

Method note, since it is the second round running: every one of these was settled
by a probe or a whole-tree grep, not by reading one file. The tempting headline was
"ten validation rules exist only in the UI" and it would have been wrong eight
times.

### Second whole-suite sweep (2026-09-02, after rounds 26-36)

Eight rounds changed code after the sweep above and none of them re-ran the full
suite - the exact gap round 20 named. Run now:

| Gate | Round 23 | Now | Delta |
|---|---|---|---|
| UI test files | 409 | **410** | +1 (`topologyValidationParity`) |
| UI tests | 7754 | **7774** | +20 |
| UI failures | 4 | **4** | same four |
| `oz-core` topology | 52 | **58** | +6 |
| `oz-pos-app` topology | 329 | **329** | 0 |

The +20 is fully accounted: 10 ordering tests, 4 priority-table guards, 6 parity
tests. Nothing appeared and nothing went missing. The four failures are identical
to round 20's and round 23's - `NodeTopologyEditorDevMock`, `themeTokenCompliance`,
`popoverSurfaceCompliance`, `SettingsPage` - all pre-existing, all deferred.

What actually needed proving was round 26. It rewrote
`firstTopologyValidationError` from `errors[0]` into a sorted return, and that
function feeds the editor's validation display. Changing which error a merchant is
shown first is exactly the edit that passes every test mentioning topology and
breaks one that does not mention it at all. Nothing broke - but until this run that
was untested optimism.

## §4.2 UI swap — verified spec, not yet done (2026-09-02)
For twenty rounds this was described as "too large for the current window". The
premise was checked rather than repeated, and it was mostly wrong. Everything
needed is already in scope:

- All four call sites are `useCallback` event handlers, not render paths or
  effects: `handleSaveTemplate` (L2055), `handleLoadTemplate` (L2171),
  `handleDeleteTemplate` (L2183), `openTemplates` (L2190).
- `sessionToken` is already destructured in the same component at L494 from
  `useWorkspace()`, and `branchId` is already in use at L1501 and L1682. **No
  prop-threading is required** — that was the assumed blocker, and it does not
  exist.
- The async-in-handler pattern is already present nearby (`confirmApply`, L2063),
  with the `await` + toast + error path the swap needs.

So the work is four small edits and one import change, not a refactor. Two things
still make it a real task rather than a mechanical one, and both belong in the
same commit:

1. `loadTemplate` returns `TopologyExportPayload`; the IPC client returns
   `unknown`. The swap needs a narrowing check at the load site rather than a
   cast, or a corrupt template becomes a runtime shape error inside the editor.
2. `openTemplates` is the natural migration trigger — migrate, then list, in one
   handler. That puts the round trips on the first template-panel open of an
   upgraded install, which is the right moment and needs a toast on partial
   failure rather than silence.

Recorded rather than attempted: converting three of four handlers and running out
of window leaves an editor reading templates from two places at once, which is
worse than today's single-source state. The premise check is the actual gain — the
blocker named for twenty rounds was not real, and the next session should expect
this to be a short piece of work.

**Attempted the next round (2026-09-02), and reverted it.** The swap itself went
cleanly: all four handlers converted, `tsc` clean, and **508 of 510** editor tests
passed untouched — confirming the change is well-scoped and the editor's other
behaviour is unaffected. What stopped it is exactly two tests, both written
against the localStorage contract this change replaces:

- `saves the current diagram as a named template` — asserts
  `localStorage.getItem('oz-topology-template:My Layout')` is non-null. Must
  assert the backend call instead.
- `loads and deletes a saved template` — seeds that same key and expects
  `Import Me` in the popover. Must seed `listTopologyTemplates` /
  `loadTopologyTemplate` instead, and assert `deleteTopologyTemplate`.

Two findings from the attempt that save the next session discovery time:

1. **No new Fluent copy is needed.** The handlers reuse `topology-toast-no-session`,
   `topology-toast-save-error`, `topology-toast-load-error` and
   `topology-toast-import-invalid`, all of which already exist in every bundle.
   The first draft invented `topology-toast-template-save-failed`; catching that
   against the bundle list is what round 18's missing-key mistake taught.
2. **The test file's `vi.mock('@/api/topology')` block must be self-seeded** with
   the four new functions, for the documented reason already in its comment: an
   unseeded `vi.fn()` returns `undefined` and the async handlers await on it.

One design decision the attempt settled in code, worth keeping: if **any** template
fails to migrate, `openTemplates` keeps showing the local list rather than
switching to the backend. A partial switch would hide the templates left behind —
still on disk, but unreachable from the only UI that can reach them — which is a
quieter and worse loss than a visible failure.

---

## Correction to the sweep above: the Rust side was scoped too (2026-09-02)

The round-37 record claimed eight rounds were cleared, citing
`oz-pos-app --lib topology` at 329/329. The number is correct and the conclusion
drawn from it was not: **329 is the topology-filtered subset of a 1160-test crate.**
Running the whole crate:

| Crate | Scoped (as reported) | Full crate |
|---|---|---|
| `oz-core --lib` | 58 topology | **2396 / 2396** |
| `oz-pos-app --lib` | 329 topology | **1153 / 1160 — 7 failed** |

The irony is the point: the lesson was applied to the UI suite and then quietly not
applied to Rust, in the same round, in a section whose entire subject is that scoped
green is not green.

**The seven are not this slice's.** All are
`commands::staff::tests::scoped_update_staff_*`, failing with
`database error: cannot start a transaction within a transaction`. Evidence:

- They reproduce **within the staff module alone** (38 passed / 7 failed), so they
  are not cross-module pollution from anything added here.
- `staff.rs` was last touched by `5c71bcd0`, another agent's staff-IPC enforcement
  campaign. This slice's last Rust commit is `c4cfbef8`, touching only
  `topology.rs`.
- A SQLite transaction-nesting error in PIN-rotation tests has no path from
  `validate_semantic_json`.

Left unfixed and recorded rather than touched: this thread has twice already stayed
out of overlapping in-flight work, and a concurrent agent is editing UI files right
now. Worth flagging to that campaign's owner — a nested-transaction failure that
appears only when the module runs as a group is a shared-connection leak between
tests, and it will read as flakiness to anyone running them singly.

---

## Third whole-suite sweep (2026-09-02, closing rounds 38–43)

| Gate | Round 37 | Now | Delta |
|---|---|---|---|
| UI test files | 410 | **410** | 0 |
| UI tests | 7774 | **7776** | **+2** — exactly the migration canary |
| UI failures | 4 | **4** | same four, unchanged |
| `oz-core --lib` (full) | 2396 | 2396 +2 ticket tests | clean |
| `oz-pos-app --lib` (full) | 1153/1160 | unchanged | 7 staff failures, another campaign |

Checked before running, because the canary added in round 40 asserts the *current*
state of `NodeTopologyEditor.tsx` and a concurrent agent had four UI files open at
the time: the editor has not changed since, and the working tree is clean. Had they
landed a template-API call in the editor, my own test would have gone red on someone
else's correct work — a coupling the canary accepts deliberately, since the whole
point is to be woken up by exactly that change.

The four failures remain `NodeTopologyEditorDevMock`, `themeTokenCompliance`,
`popoverSurfaceCompliance`, `SettingsPage`. All predate this slice and are in the
deferred list.

---

## Related decisions

- [ADR #22: Visual Node-Based Store & Workspace Topology Builder](./2026-07-20-node-based-store-topology-builder.md)
- [ADR #34: Topology Editor as the Business Logic Builder](./2026-08-07-adr34-business-logic-topology-builder.md) — §Presets superseded by §4 here
- [ADR #44: Typed Connection Gating & Live Validation](./2026-08-08-adr44-typed-connection-gating.md) — §1 completes its single-source-of-truth goal
- [ADR #41: App Lifecycle, Device Onboarding, Dynamic Topology Workspaces](./2026-08-28-adr41-app-lifecycle-device-onboarding-topology-home-gating.md)
