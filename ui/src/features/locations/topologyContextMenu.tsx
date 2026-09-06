import { useLocalization } from '@fluent/react';
import { NODE_TYPE_ICON } from './topologyCard';
import type { NodeType, WorkspaceTypeKey, TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';

/**
 * Right-click canvas context menu — extracted from `NodeTopologyEditor.tsx`
 * (Phase 4a split). Renders the wire / node / canvas menus with keyboard
 * arrow navigation. Presentational: every value and callback is a prop.
 */

export interface TopologyContextMenuState {
  x: number;
  y: number;
  nodeId?: string;
  wireId?: string;
}

export interface TopologyContextMenuProps {
  l10n: ReturnType<typeof useLocalization>['l10n'];
  menu: TopologyContextMenuState;
  onClose: () => void;
  nodeMap: Map<string, TopologyNodeData>;
  wires: TopologyWireData[];
  wireDisplayLabel: (wire: TopologyWireData) => string;
  onCycleWireDirection: (wireId: string) => void;
  onStartWireRename: (wireId: string) => void;
  onStartNodeRename: (nodeId: string, name: string) => void;
  onDuplicateSelection: () => void;
  onDeleteRequest: () => void;
  onZoomToSelection: () => void;
  selectedCount: number;
  onClearSelection: () => void;
  allowLegacyApply: boolean;
  onAddNode: (type: NodeType, at?: { x: number; y: number }, workspaceTypeKey?: WorkspaceTypeKey) => void;
  pan: { x: number; y: number };
  zoom: number;
  onSelectAll: () => void;
  onZoomToFit: () => void;
  onResetView: () => void;
  /** True when the parent can rename a branch location (store node). */
  canRenameBranch: boolean;
  /** True when the parent can rename a workspace instance node. */
  canRenameWorkspace: boolean;
  /** Delete the selected wire (parent opens the confirm dialog). */
  onConfirmDeleteWire: () => void;
}

export function TopologyContextMenu({
  l10n,
  menu,
  onClose,
  nodeMap,
  wires,
  wireDisplayLabel,
  onCycleWireDirection,
  onStartWireRename,
  onStartNodeRename,
  onDuplicateSelection,
  onDeleteRequest,
  onZoomToSelection,
  selectedCount,
  onClearSelection,
  allowLegacyApply,
  onAddNode,
  pan,
  zoom,
  onSelectAll,
  onZoomToFit,
  onResetView,
  canRenameBranch,
  canRenameWorkspace,
  onConfirmDeleteWire,
}: TopologyContextMenuProps) {
  const menuNode = menu.nodeId ? nodeMap.get(menu.nodeId) : undefined;
  const menuWire = menu.wireId ? wires.find((w) => w.id === menu.wireId) : undefined;
  return (
    <div
      className="topology-context-menu"
      role="menu"
      aria-label={l10n.getString('topology-context-add-title')}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const items = Array.from(
          e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
        );
        if (items.length === 0) return;
        const idx = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown'
          ? (idx + 1) % items.length
          : (idx - 1 + items.length) % items.length;
        items[next]!.focus();
      }}
      style={{ left: menu.x, top: menu.y }}
    >
      {(() => {
        if (menuWire) {
          // Wire menu: object-scoped actions (direction + rename + delete).
          return (
            <>
              <div className="topology-context-section-title">{wireDisplayLabel(menuWire)}</div>
              <button
                type="button"
                role="menuitem"
                className="topology-context-item"
                onClick={() => { onClose(); onCycleWireDirection(menuWire.id); }}
              >
                {l10n.getString('topology-wire-toggle-aria')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="topology-context-item"
                onClick={() => { onClose(); onStartWireRename(menuWire.id); }}
              >
                {l10n.getString('topology-context-rename-wire')}
              </button>
              <div className="topology-context-divider" />
              <button
                type="button"
                role="menuitem"
                className="topology-context-item"
                onClick={() => { onClose(); onConfirmDeleteWire(); }}
              >
                {l10n.getString('topology-context-delete-wire')}
              </button>
            </>
          );
        }
        if (menuNode) {
          // Node menu: object-scoped actions (rename/duplicate/delete).
          const menuRenameable = (menuNode.type === 'store' && canRenameBranch)
            || (menuNode.type === 'workspace' && canRenameWorkspace);
          return (
            <>
              <div className="topology-context-section-title">{menuNode.name}</div>
              {menuRenameable && (
                <button
                  type="button"
                  role="menuitem"
                  className="topology-context-item"
                  onClick={() => { onClose(); onStartNodeRename(menuNode.id, menuNode.name); }}
                >
                  {l10n.getString('topology-context-rename')}
                </button>
              )}
              {menuNode.type !== 'store' && (
                <button
                  type="button"
                  role="menuitem"
                  className="topology-context-item"
                  onClick={() => { onClose(); onDuplicateSelection(); }}
                >
                  {l10n.getString('topology-context-duplicate')}
                </button>
              )}
              {menuNode.type !== 'store' && (
                <button
                  type="button"
                  role="menuitem"
                  className="topology-context-item"
                  onClick={() => { onClose(); onDeleteRequest(); }}
                >
                  {l10n.getString('topology-confirm-delete-node-title')}
                </button>
              )}
              <div className="topology-context-divider" />
              <button
                type="button"
                role="menuitem"
                className="topology-context-item"
                onClick={() => { onClose(); onZoomToSelection(); }}
              >
                {l10n.getString('topology-context-zoom-selection')}
              </button>
            </>
          );
        }
        // Canvas menu: an active (marquee) selection gets a summary
        // + clear action up top; add node types + view actions follow.
        return (
          <>
            {selectedCount > 0 && (
              <>
                <div className="topology-context-section-title">
                  {l10n.getString('topology-context-selection-title', { count: selectedCount })}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="topology-context-item"
                  onClick={() => { onClose(); onClearSelection(); }}
                >
                  {l10n.getString('topology-context-clear-selection')}
                </button>
                <div className="topology-context-divider" />
              </>
            )}
            <div className="topology-context-section-title">
              {l10n.getString('topology-context-add-title')}
            </div>
            {(['store', 'workspace', 'warehouse', 'hardware'] as NodeType[])
              .filter((t) => allowLegacyApply || t !== 'store')
              .map((type) => {
                const Icon = NODE_TYPE_ICON[type];
                return (
                  <button
                    key={type}
                    type="button"
                    role="menuitem"
                    className="topology-context-item"
                    onClick={() => {
                      onClose();
                      onAddNode(type, {
                        x: (menu.x - pan.x) / zoom,
                        y: (menu.y - pan.y) / zoom,
                      });
                    }}
                  >
                    <span className="topology-context-item-icon"><Icon size={14} /></span>
                    {l10n.getString(`topology-new-${type}`)}
                  </button>
                );
              })}
            <div className="topology-context-divider" />
            <button
              type="button"
              role="menuitem"
              className="topology-context-item"
              onClick={() => { onClose(); onSelectAll(); }}
            >
              {l10n.getString('topology-context-select-all')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="topology-context-item"
              onClick={() => { onClose(); onZoomToFit(); }}
            >
              {l10n.getString('topology-fit-all')}
            </button>
            {selectedCount > 0 && (
              <button
                type="button"
                role="menuitem"
                className="topology-context-item"
                onClick={() => { onClose(); onZoomToSelection(); }}
              >
                {l10n.getString('topology-context-zoom-selection')}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="topology-context-item"
              onClick={() => { onClose(); onResetView(); }}
            >
              {l10n.getString('topology-reset-view')}
            </button>
          </>
        );
      })()}
    </div>
  );
}
