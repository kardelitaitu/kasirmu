# ui-coder-54 journal — Slice G18: topology context-menu state + open handlers

> Provenance: manager-as-executor (session subagent delegation infrastructure
> unavailable — see ui-coder-52-journal.md). Briefs, fences, and verification
> battery unchanged from the dispatched protocol.

### 2026-09-09 — Slice G18: right-click context-menu state and open handlers extracted

- **Responsibility boundary:** the menu STATE (ContextMenuPoint | null), the
  document-level close effect (Escape w/ stopPropagation + outside-mousedown,
  cleanup on close), and the two object-scoped open handlers (openNodeMenu /
  openWireMenu) move into useTopologyEditorContextMenu (NEW
  nodeTopologyEditorContextMenu.ts, deps 3, returns 4). The pointer hook KEEPS
  handleContextMenu (the canvas swallow-gate — a gesture concern, 3.4b
  property). handleWireClick (select + cycle direction) stays parent — it is
  not menu machinery.
- **Design-pass verdict (resolves scout-14's double-re-plumb warning):** the
  keyboard hook has NO menu dependency (grep-verified; the pre-baked brief's
  ":1224 keyboard" attribution was wrong — that line is
  resetTransientCanvasState's dep array). Real consumers: pointer hook
  (setContextMenu dep), touch hook (setContextMenu dep),
  resetTransientCanvasState (dep), the two open-handlers, the close effect,
  and the JSX mount. Placing the state-owning hook at the vacated state slot
  (above all consumers) lets it return setContextMenu under the ORIGINAL
  name — pointer/touch/resetTransient call sites are UNTOUCHED. No re-plumb.
- **Files:** NodeTopologyEditor.tsx (3,329 -> 3,305); nodeTopologyEditorContextMenu.ts
  NEW. ui-coder-54-journal.md (this file).
- **Public imports/re-exports:** unchanged. TopologyContextMenu component,
  TopologyNodeCard/TopologyWireGroup onOpenNodeMenu/onOpenWireMenu props, and
  the JSX mount all keep their pre-extraction text.
- **Byte-identity proof:** three spans (state comment+state+close effect
  823-843; openNodeMenu block 2431-2440; openWireMenu block 2451-2459) excised
  by scripted splice with per-span first/last-line assertions plus a
  between-block assertion (handleWireClick must sit between the two handler
  spans); all 39 non-blank span lines verified verbatim in the hook except ONE
  DOCUMENTED substitution: the useState type literal
  '{ x: number; y: number; nodeId?: string; wireId: string } | null' becomes
  the ContextMenuPoint alias (nodeTopologyEditorPointer.ts:81), which is
  structurally IDENTICAL field-for-field — the same shape the pointer/touch
  hooks already use for the same state. No other difference. No new
  useCallback; JSX zero lines changed.
- **Zero dep-array deviations:** the handlers' arrays name exactly
  [selectOnly, canvasRef, setContextMenu] / [selectWire, canvasRef, setContextMenu]
  — every name is a deps field or hook-internal setState. The close effect's
  [contextMenu] is hook-local. No disables, no additions, ratchet untouched.
- **Focused tests:** (recorded below in the gate) — the menu behavior is
  pinned by dedicated editor-suite describes: canvas menu (7406: right-click
  spawn, select-all, reload-closes-menu), node menu (8736: select+rename),
  wire menu (8798: select+label title), edge clamp (1863), right-button-pan
  swallow (5197), strict-mode store omission (2094), zoom-to-selection
  conditional (8617).
- **Typecheck / ESLint:** (recorded below in the gate).
- **Rollback point:** revert the G18 commit alone (2 files).
- **Remaining coupling / follow-up:** none new. G18 was the LAST named
  extraction in the adopted ladder; remaining = unmount-sweep disable
  retirement + Phase 5 composition cleanup per the todo doc.
