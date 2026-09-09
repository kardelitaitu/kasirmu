//! Diagram import/export and template callbacks for the topology editor
//! (slice G13-a+b).
//!
//! Extracted verbatim from NodeTopologyEditor.tsx: the clipboard-JSON export
//! (handleExport), the clipboard-JSON import that replaces the canvas under
//! one undo entry (handleImport), and the named-template save/load/delete/
//! open handlers. Bodies and comments are byte-identical to the inline
//! originals; nothing was rewrapped and no callback was re-derived.
//!
//! The four popover state slots (templateSaveOpen / templateName /
//! templatesOpen / savedTemplates) stay PARENT-owned: a hook taking
//! pushHistory must sit below its declaration, and the setter fields would
//! force the same placement anyway — the split therefore keeps state in the
//! editor and moves only the six handlers (the G4-a state-trio precedent).
//! TopologyHeader consumes all six under their original names through the
//! same props, so the JSX is untouched.
//!
//! Dep-array note: the arrays keep their original name lists plus the deps-
//! object fields exhaustive-deps demands (l10nRef + the four setters). Every
//! addition is a React-guaranteed stable identity — a ref or a setState
//! dispatch — so callback identity churn is unchanged (3.3a precedent).
//!
//! l10n is read through the parent's latest-ref (l10nRef) exactly as before:
//! the two async handlers and the template handlers stringify at call time,
//! not render time.

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { useLocalization } from '@fluent/react';
import type { ToastType } from '@/frontend/shared/Toast';
import type { TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';
import {
  deserializeTopology,
  serializeTopology,
  saveTemplate,
  loadTemplate,
  listTemplates,
  deleteTemplate,
} from './topologyExport';

/** Everything the import/export/template handlers read from the editor. */
export interface TopologyEditorIoDeps {
  /** Current graph — exported verbatim and captured into templates. */
  nodes: TopologyNodeData[];
  wires: TopologyWireData[];
  /** Toast sink for the localized result copy. */
  addToast: (toast: { message: string; type: ToastType }) => unknown;
  /** Latest-ref localization handle — stringified at call time. */
  l10nRef: MutableRefObject<{ getString: ReturnType<typeof useLocalization>['l10n']['getString'] }>;
  /** History push — import and template-load are each one undo entry. */
  pushHistory: (snapshot?: { nodes: TopologyNodeData[]; wires: TopologyWireData[] }) => void;
  /** Canvas replacement (import / template load) — full array swap. */
  setNodes: Dispatch<SetStateAction<TopologyNodeData[]>>;
  setWires: Dispatch<SetStateAction<TopologyWireData[]>>;
  /** Popover state the handlers drive — the slots stay parent-owned. */
  setTemplateSaveOpen: Dispatch<SetStateAction<boolean>>;
  setTemplateName: Dispatch<SetStateAction<string>>;
  setTemplatesOpen: Dispatch<SetStateAction<boolean>>;
  setSavedTemplates: Dispatch<SetStateAction<string[]>>;
}

/** Owns the six import/export/template handlers. The returned names are the
 *  original locals, so TopologyHeader's props keep their pre-extraction text. */
export function useTopologyEditorIo(deps: TopologyEditorIoDeps) {
  const {
    nodes,
    wires,
    addToast,
    l10nRef,
    pushHistory,
    setNodes,
    setWires,
    setTemplateSaveOpen,
    setTemplateName,
    setTemplatesOpen,
    setSavedTemplates,
  } = deps;

  /** Copy the diagram to the clipboard as the versioned JSON envelope.
   *  Guards a missing clipboard API (insecure context / WebView) with an
   *  explanatory toast instead of throwing. */
  const handleExport = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      addToast({ message: l10nRef.current.getString('topology-toast-clipboard-unavailable'), type: 'warning' });
      return;
    }
    try {
      await navigator.clipboard.writeText(serializeTopology(nodes, wires));
      addToast({ message: l10nRef.current.getString('topology-toast-export-copied'), type: 'info' });
    } catch {
      addToast({ message: l10nRef.current.getString('topology-toast-clipboard-unavailable'), type: 'warning' });
    }
  }, [nodes, wires, addToast, l10nRef]);

  /** Replace the canvas with a clipboard payload under ONE undo entry. A
   *  strict-parse failure (or a missing/unreadable clipboard) leaves the
   *  canvas untouched — a bad paste can never half-load a broken diagram. */
  const handleImport = useCallback(async () => {
    if (!navigator.clipboard?.readText) {
      addToast({ message: l10nRef.current.getString('topology-toast-clipboard-unavailable'), type: 'warning' });
      return;
    }
    let json: string;
    try {
      json = await navigator.clipboard.readText();
    } catch {
      addToast({ message: l10nRef.current.getString('topology-toast-import-invalid'), type: 'warning' });
      return;
    }
    const payload = deserializeTopology(json);
    if (!payload) {
      addToast({ message: l10nRef.current.getString('topology-toast-import-invalid'), type: 'warning' });
      return;
    }
    pushHistory();
    setNodes(payload.nodes.map((n) => ({ ...n })));
    setWires(payload.wires.map((w) => ({ ...w })));
    addToast({ message: l10nRef.current.getString('topology-toast-import-ok'), type: 'info' });
  }, [pushHistory, addToast, setNodes, setWires, l10nRef]);

  /** Save the diagram under `name`; an empty name keeps the popover open
   *  (the pure helper refuses it — nothing to save). */
  const handleSaveTemplate = useCallback((name: string) => {
    if (saveTemplate(name, nodes, wires) === null) return;
    setTemplateSaveOpen(false);
    setTemplateName('');
    addToast({ message: l10nRef.current.getString('topology-toast-template-saved'), type: 'info' });
  }, [nodes, wires, addToast, l10nRef, setTemplateName, setTemplateSaveOpen]);

  /** Load a saved template, replacing the canvas under one undo entry. */
  const handleLoadTemplate = useCallback((name: string) => {
    const payload = loadTemplate(name);
    if (!payload) return;
    pushHistory();
    setNodes(payload.nodes.map((n) => ({ ...n })));
    setWires(payload.wires.map((w) => ({ ...w })));
    setTemplatesOpen(false);
    addToast({ message: l10nRef.current.getString('topology-toast-import-ok'), type: 'info' });
  }, [pushHistory, addToast, setNodes, setWires, l10nRef, setTemplatesOpen]);

  /** Delete a saved template and re-list, so the popover reflects the
   *  deletion immediately. */
  const handleDeleteTemplate = useCallback((name: string) => {
    deleteTemplate(name);
    setSavedTemplates(listTemplates());
    addToast({ message: l10nRef.current.getString('topology-toast-template-deleted'), type: 'info' });
  }, [addToast, l10nRef, setSavedTemplates]);

  /** Toggle the templates popover, re-listing on every open. */
  const openTemplates = useCallback(() => {
    setSavedTemplates(listTemplates());
    setTemplatesOpen((v) => !v);
  }, [setSavedTemplates, setTemplatesOpen]);

  return { handleExport, handleImport, handleSaveTemplate, handleLoadTemplate, handleDeleteTemplate, openTemplates };
}
