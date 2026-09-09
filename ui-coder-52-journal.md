# ui-coder-52 journal — Slice G13-c: topology clipboard hook

> Provenance note: this slice was executed by the manager-as-executor because the
> session's subagent delegation infrastructure (spawn_coder and every spawn_* role)
> failed deterministically at tool binding (subagent backend globals unregistered in
> this deployment). The brief, fences, and verification battery are unchanged from
> the dispatched brief. Recorded per the stall policy (nothing waits on the user).

### 2026-09-09 — Slice G13-c: clipboard/duplicate/paste hook extracted

- **Responsibility boundary:** the internal Ctrl+C/Ctrl+V clipboard (clipboardRef),
  the Figma-style paste-cascade counter (pasteCascadeRef), and the three mutation
  callbacks (copySelection / duplicateSelection / pasteClipboard) move into
  useTopologyEditorClipboard (NEW nodeTopologyEditorClipboard.ts, 198 lines,
  TopologyEditorClipboardDeps = 14 fields). The parent keeps wiring graph state,
  viewport, the shared creation gate (duplicateRefusal), toast/l10n, and GRID_SIZE.
- **Files:** NodeTopologyEditor.tsx (3,475 -> 3,387; git stat 24+/112−);
  nodeTopologyEditorClipboard.ts NEW (198). ui-coder-52-journal.md (this file).
- **Public imports/re-exports:** unchanged. Consumers untouched: the keyboard
  controller receives the three callbacks under their original names (dep array
  text unchanged); the inspector drawer's duplicateSelection prop unchanged;
  clipboardRef/pasteCascadeRef had zero external readers (grep-verified).
- **Byte-identity proof:** the 112-line cluster was excised by a scripted splice
  with first/last-line boundary assertions, saved to a side file, and all 109
  non-blank lines verified present verbatim in the hook file (0 missing). Bodies
  and comments were never retyped. No new useCallback/useMemo; nothing renamed;
  JSX zero lines changed.
- **Accepted deviation (documented in the hook header):** the two flagged dep
  arrays gain TWO stable names — canvasRef (stable ref object) and GRID_SIZE
  (module const) — because both became deps-object fields and exhaustive-deps
  demands them. Identity churn is unchanged (3.3a setLiveAnnouncement precedent:
  stable additions are behavior-identical). Ratchet alternative (+2 disables)
  rejected: would have breached the tree cap (3+2 > 4).
- **Dead imports:** sanitizeCopiedNode left the editor's topologyCard import
  (sole consumer moved). clampNodeToViewport and GRID_SIZE stay (other call
  sites at :1946/:2072 region). GRID_SIZE is forwarded as a deps field
  (keyboard-hook precedent), not duplicated.
- **Focused tests:** baseline (pre-slice, independently run by the executor at
  5842e2d81~2): 564 passed / 1 skipped / 0 failed across editor + Inspector +
  memo (3 files, 31.6s). Post-slice same three suites: 564 / 1 / 0 (31.3s) —
  bit-identical, ZERO test edits. The 7-test clipboard characterization describe
  (f67b5034f) and the 13-test "clipboard & bulk duplication" describe are the
  protection; nodeTopologyMemo (7/7) is the churn tripwire.
- **Typecheck:** npm run typecheck exit 0 (tree-wide, includes foreign in-flight
  edits). Pre-commit gate re-ran it on the staged files: clean.
- **ESLint:** 0 errors; hook file 0 warnings after the sanctioned dep additions;
  editor warnings unchanged (pre-existing compat re-export block).
- **Behavior explicitly checked:** refusal-before-history ordering (test 6 of the
  characterization block), cascade counter reset-on-fresh-copy, wire-ride-on
  both-endpoints rule, sanitizeCopiedNode branch-identity stripping, one undo
  entry per accepted gesture, copies-become-selection — all pinned by unedited
  tests and all green.
- **Rollback point:** revert 5842e2d81 alone (2 files; independent of every
  other slice).
- **Remaining coupling / follow-up:** none new. Next slice G13-a+b (templates +
  import/export) — anchors re-pinned: template state :856-862, export/import
  handlers :1368-1407, template handlers :1409-1438 (pre-slice numbering),
  TopologyHeader props consumers; l10nRef is read inside two template handlers.
