# ui-coder-53 journal — Slice G13-a+b: topology import/export + templates hook

> Provenance: manager-as-executor (subagent delegation infrastructure unavailable
> in this session — see ui-coder-52-journal.md). Briefs, fences, and verification
> battery unchanged from the dispatched protocol.

### 2026-09-09 — Slice G13-a+b: diagram import/export + template handlers extracted

- **Responsibility boundary:** handleExport (clipboard-JSON envelope), handleImport
  (clipboard-JSON canvas replacement under one undo entry), and the template
  quartet (handleSaveTemplate / handleLoadTemplate / handleDeleteTemplate /
  openTemplates) move into useTopologyEditorIo (NEW nodeTopologyEditorIo.ts,
  deps 11, returns 6). The four popover state slots (templateSaveOpen /
  templateName / templatesOpen / savedTemplates) stay PARENT-owned by
  construction: a hook taking pushHistory must sit below :1312, and the state's
  only consumers are the TopologyHeader props (the G4-a state-trio precedent);
  the setters cross the boundary as stable deps.
- **Files:** NodeTopologyEditor.tsx (3,387 -> 3,329); nodeTopologyEditorIo.ts NEW.
  ui-coder-53-journal.md (this file).
- **Public imports/re-exports:** unchanged. TopologyHeader consumes all six
  handlers under their original names through identical props; the six
  topologyExport symbols (serializeTopology / deserializeTopology / saveTemplate /
  loadTemplate / listTemplates / deleteTemplate) leave the editor's import block
  entirely (sole consumers moved) and are imported by the hook.
- **Byte-identity proof:** the 75-line span (doc comment at 1365 through
  openTemplates' closing) excised by scripted splice with boundary assertions
  (first line literal, last line literal, blank line after span, all six handler
  declarations pinned inside the span, openTemplates declared exactly once
  therein); all 70 non-blank lines verified verbatim in the hook file (0
  missing). No new useCallback; nothing renamed; JSX zero lines changed.
  Two boundary re-pins occurred pre-edit (comment at 1367/1368, then 1365;
  the over-broad whole-file uniqueness guard replaced by span-content pinning)
  — the splice script refused to write on every mismatch, as designed.
- **Accepted deviation (documented in the hook header):** dep arrays keep their
  original name lists plus the deps-object fields exhaustive-deps demands:
  l10nRef (stable ref) and the four popover setters (React-guaranteed dispatch
  identities). Callback identity churn is unchanged (3.3a precedent). openTemplates'
  array grows from [] to its two setters for the same reason. +6 disables
  rejected (ratchet cap).
- **Deps interface note:** TopologyEditorIoDeps types nodes/wires as the real
  TopologyNodeData/TopologyWireData (type-only import from './NodeTopologyEditor' —
  the keyboard-hook pattern; no runtime cycle). An initial structural-stand-in
  draft (index signatures) was rejected before verification: concrete types do
  not satisfy index signatures under strict mode.
- **Focused tests:** post-splice 564 passed / 1 skipped / 0 failed across editor +
  InspectorIntegration + memo (identical to the G13-c post-slice baseline; zero
  test edits). The dedicated describe block "topology export / import / templates
  (clipboard + localStorage)" (NodeTopologyEditor.test.tsx:10447, 4 tests: export
  envelope, import+replace+undoable, save template, load+delete template) is the
  protection — recorded pre-extraction per the doc's Phase-0 rule.
- **Typecheck:** exit 0 tree-wide (recorded below in the gate).
- **ESLint:** 0 errors; nodeTopologyEditorIo.ts clean (0 warnings) after the
  sanctioned dep additions; editor warnings unchanged (pre-existing react-refresh
  re-export block, 9).
- **Rollback point:** revert the io commit alone (2 files).
- **Remaining coupling / follow-up:** none new. G18 context menus remain LAST per
  the adopted ladder.
