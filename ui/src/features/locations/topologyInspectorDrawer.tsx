/**
 * Inspector drawer for the topology node editor (slice G7-b).
 *
 * Extracted from NodeTopologyEditor.tsx: the conditional inspector JSX block
 * (formerly an inline IIFE guarded by the selectedNode mount condition) moved
 * VERBATIM - identical JSX, identical class strings, identical handlers. The
 * mount condition itself stays in the editor, so the editor renders
 * <TopologyInspectorDrawer ... /> exactly where the IIFE used to sit.
 *
 * Contracts preserved on purpose:
 *  - selectedNode, renameBaselineRef and persistNodeRename are handed through
 *    as THE SAME objects/functions the editor holds (the inspector rename
 *    persistence tests pin persist + dirty + baseline no-double-commit and
 *    rejected-rename-reverts on that path). No value-ification, no wrapping,
 *    no new useCallback around them.
 *  - The workspace card adapter (renderWorkspaceCard) moved here unchanged
 *    with its sessionToken dependency: this file is its only consumer.
 *  - getTelemetry intentionally STAYS in the editor (the canvas card grid
 *    consumes it, not the drawer).
 */

import { createElement, useCallback, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import { Localized } from '@fluent/react';
import type { useLocalization } from '@fluent/react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { TrashIcon, CloseIcon } from './NodeTopologyIcons';
import {
  iconForNode,
  SELECTABLE_WORKSPACE_TYPE_KEYS,
  workspaceTypeLabel,
  settingsCardForTypeKey,
  topologyUiString,
} from './topologyCard';
import { WarehouseSettingsCard } from './topologyWarehouseCard';
import { BranchLocationFields } from './topologyBranchLocationFields';
import type { TopologyNodeData } from './NodeTopologyEditor';
import type { WorkspaceCardProps } from '@/features/settings/workspace-cards';

export function TopologyInspectorDrawer({
  selectedNode,
  l10n,
  beginInspectorEdit,
  setNodes,
  persistNodeRename,
  renameBaselineRef,
  duplicateSelection,
  handleDeleteRequest,
  handleSetNodeMetadata,
  isProAllowed,
  sessionToken,
  clearSelection,
}: {
  selectedNode: TopologyNodeData;
  l10n: ReturnType<typeof useLocalization>['l10n'];
  beginInspectorEdit: (id: string) => void;
  setNodes: Dispatch<SetStateAction<TopologyNodeData[]>>;
  persistNodeRename: (nodeId: string, name: string) => Promise<void>;
  renameBaselineRef: MutableRefObject<string | null>;
  duplicateSelection: () => void;
  handleDeleteRequest: () => void;
  handleSetNodeMetadata: (nodeId: string, patch: Record<string, unknown>) => void;
  isProAllowed: boolean;
  sessionToken: string | null;
  clearSelection: () => void;
}) {
  // ── Workspace card adapter (ADR #22 Phase 2) ────────────────

  /** Map a workspace node's typeKey to the correct settings card. The
   *  per-type card registry lives in topologyCard.ts — adding a workspace
   *  type with its own card is a one-line change there. */
  const renderWorkspaceCard = useCallback((node: TopologyNodeData) => {
    const typeKey = (node.metadata?.['typeKey'] as string) ?? 'store-pos';
    const cardProps: WorkspaceCardProps = {
      variant: 'inspector-drawer',
      terminalId: node.id,
      ...(sessionToken ? { sessionToken } : {}),
    };
    const Card = settingsCardForTypeKey(typeKey);
    return <Card key={node.id} {...cardProps} />;
  }, [sessionToken]);

  const typeColors: Record<string, string> = {
    store: 'var(--color-warning, #f59e0b)',
    workspace: 'var(--color-accent, #5a9fd4)',
    warehouse: 'var(--color-success, #4caf50)',
    hardware: 'var(--color-fg-muted, #8b95a5)',
  };
  const typeLabelKey: Record<string, string> = {
    store: 'topology-node-type-store',
    workspace: `topology-node-type-${(selectedNode.metadata?.['typeKey'] as string) ?? 'workspace'}`,
    warehouse: 'topology-node-type-warehouse',
    hardware: 'topology-node-type-hardware',
  };
  const typeColor = typeColors[selectedNode.type] ?? 'var(--color-fg-muted)';
  return (
  <div className="node-inspector-drawer">
    {/* Type-specific header */}
    <div className="inspector-header">
      <div className="inspector-type-badge" style={{ backgroundColor: typeColor }}>
        {createElement(iconForNode(selectedNode), { size: 18 })}
      </div>
      <div className="inspector-header-text">
        <h3>{selectedNode.name || l10n.getString(typeLabelKey[selectedNode.type] ?? 'topology-node-type-workspace')}</h3>
        <span className="inspector-type-label" style={{ color: typeColor }}>
          {l10n.getString(typeLabelKey[selectedNode.type] ?? 'topology-node-type-workspace')}
        </span>
      </div>
      <button type="button" className="inspector-close-btn" onClick={clearSelection} aria-label={l10n.getString('topology-inspector-close-aria')}>
        <CloseIcon size={16} />
      </button>
    </div>

    <div className="inspector-content">
      <ErrorBoundary>
      {/* ── Name section ─────────────────────────────────────── */}
      <div className="inspector-section">
        <h4 className="inspector-section-title"><Localized id="topology-inspector-section-identity">Identity</Localized></h4>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className="inspector-field">
          <span><Localized id="topology-inspector-node-name">Name</Localized></span>
          <input
            type="text"
            value={selectedNode.name}
            onChange={(e) => {
              beginInspectorEdit(selectedNode.id);
              const name = e.target.value;
              setNodes((prev) => prev.map((n) => (n.id === selectedNode.id ? { ...n, name } : n)));
            }}
            onFocus={() => { renameBaselineRef.current = selectedNode.name; }}
            onBlur={() => void persistNodeRename(selectedNode.id, selectedNode.name)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void persistNodeRename(selectedNode.id, selectedNode.name); } }}
          />
        </label>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className="inspector-field">
          <span><Localized id="topology-inspector-subtitle">Subtitle / Location</Localized></span>
          <input
            type="text"
            value={selectedNode.subtitle || ''}
            onChange={(e) => {
              beginInspectorEdit(selectedNode.id);
              const subtitle = e.target.value;
              setNodes((prev) => prev.map((n) => (n.id === selectedNode.id ? { ...n, subtitle } : n)));
            }}
          />
        </label>
      </div>

      {/* ── Branch Location store profile fields ──────────── */}
      {selectedNode.type === 'store' && (
        <BranchLocationFields
          nodeId={selectedNode.storeProfileId ?? selectedNode.id}
          sessionToken={sessionToken!}
          l10n={l10n}
          beginInspectorEdit={beginInspectorEdit}
        />
      )}

      {/* ── Workspace type section ────────────────────────── */}
      {selectedNode.type === 'workspace' && (
        <div className="inspector-section">
          <h4 className="inspector-section-title"><Localized id="workspace-type-selector-label">Workspace Type</Localized></h4>
          <div className="topology-workspace-identity" data-testid="workspace-identity-fields">
            <span className="topology-identity-row">
              <Localized id="topology-workspace-purpose-label">Purpose</Localized>:
              <strong>{l10n.getString(`topology-purpose-${(selectedNode.metadata?.['purposeKey'] as string) ?? 'general'}`)}</strong>
            </span>
            <span className="topology-identity-row topology-identity-technical">
              <Localized id="topology-workspace-technical-type-label">Technical type</Localized>:
              <code>{(selectedNode.metadata?.['typeKey'] as string) ?? 'store-pos'}</code>
            </span>
          </div>
          <label className="inspector-field">
            <span><Localized id="topology-workspace-purpose-selector-label">Workspace purpose</Localized></span>
            <select
              className="topology-purpose-select"
              value={(selectedNode.metadata?.['purposeKey'] as string) ?? 'general'}
              onChange={(e) => {
                beginInspectorEdit(selectedNode.id);
                const purposeKey = e.target.value;
                setNodes((prev) => prev.map((n) => n.id === selectedNode.id
                  ? { ...n, metadata: { ...n.metadata, purposeKey } }
                  : n));
              }}
              aria-label={l10n.getString('topology-workspace-purpose-selector-aria')}
            >
              <option value="general">{l10n.getString('topology-purpose-general')}</option>
              <option value="checkout">{l10n.getString('topology-purpose-checkout')}</option>
              <option value="returns">{l10n.getString('topology-purpose-returns')}</option>
              <option value="dining-room">{l10n.getString('topology-purpose-dining-room')}</option>
              <option value="kitchen-hot-line">{l10n.getString('topology-purpose-kitchen-hot-line')}</option>
              <option value="stock-control">{l10n.getString('topology-purpose-stock-control')}</option>
              <option value="receiving">{l10n.getString('topology-purpose-receiving')}</option>
            </select>
          </label>
          <select
            className="inspector-select"
            value={(selectedNode.metadata?.['typeKey'] as string) ?? 'store-pos'}
            onChange={(e) => {
              beginInspectorEdit(selectedNode.id);
              const newTypeKey = e.target.value;
              setNodes((prev) =>
                prev.map((n) =>
                  n.id === selectedNode.id
                    ? { ...n, metadata: { ...n.metadata, typeKey: newTypeKey } }
                    : n,
                ),
              );
            }}
            aria-label={l10n.getString('topology-ws-type-select-aria')}
          >
            {SELECTABLE_WORKSPACE_TYPE_KEYS.map((k) => (
              <option key={k} value={k}>
                {workspaceTypeLabel(k, (id, vars) => topologyUiString(l10n, id, vars ?? null))}
              </option>
            ))}
          </select>
          {/* Peer group: optional grouping label for multi-POS terminals */}
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- text is provided by <Localized> child */}
          <label className="inspector-field">
            <span><Localized id="topology-workspace-peer-group-label">Peer group</Localized></span>
            <input
              type="text"
              placeholder={l10n.getString('topology-workspace-peer-group-placeholder')}
              value={(selectedNode.metadata?.['peerGroup'] as string) ?? ''}
              onChange={(e) => {
                beginInspectorEdit(selectedNode.id);
                const peerGroup = e.target.value || undefined;
                setNodes((prev) => prev.map((n) => n.id === selectedNode.id
                  ? { ...n, metadata: { ...n.metadata, ...(peerGroup ? { peerGroup } : { peerGroup: undefined }) } }
                  : n));
              }}
            />
          </label>
          {renderWorkspaceCard(selectedNode)}
        </div>
      )}

      {/* ── Warehouse section ────────────────────────────── */}
      {selectedNode.type === 'warehouse' && (
        <div className="inspector-section">
          <h4 className="inspector-section-title"><Localized id="topology-inspector-section-warehouse">Warehouse</Localized></h4>
          <WarehouseSettingsCard node={selectedNode} onChange={handleSetNodeMetadata} capacityLocked={!isProAllowed} />
        </div>
      )}

      {/* ── Hardware section ──────────────────────────────── */}
      {selectedNode.type === 'hardware' && (
        <div className="inspector-section" data-testid="hardware-inspector">
          <h4 className="inspector-section-title"><Localized id="topology-inspector-hardware-title">Hardware Device</Localized></h4>
          {selectedNode.telemetryBadge && (
            <span className={`node-telemetry-badge telemetry-${selectedNode.telemetryStatus ?? 'online'}`}>
              {selectedNode.telemetryBadge}
            </span>
          )}
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label className="inspector-field">
            <span><Localized id="topology-inspector-device-type">Device Type</Localized></span>
            <select
              className="inspector-select"
              value={(selectedNode.metadata?.['deviceType'] as string) ?? 'thermal-receipt'}
              onChange={(e) => {
                beginInspectorEdit(selectedNode.id);
                const deviceType = e.target.value;
                setNodes((prev) => prev.map((n) => n.id === selectedNode.id
                  ? { ...n, metadata: { ...n.metadata, deviceType } }
                  : n));
              }}
            >
              <option value="thermal-receipt">{l10n.getString('topology-hardware-thermal-receipt')}</option>
              <option value="thermal-kitchen">{l10n.getString('topology-hardware-thermal-kitchen')}</option>
              <option value="barcode-scanner">{l10n.getString('topology-hardware-barcode-scanner')}</option>
              <option value="cash-drawer">{l10n.getString('topology-hardware-cash-drawer')}</option>
              <option value="display-customer">{l10n.getString('topology-hardware-display-customer')}</option>
            </select>
          </label>
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label className="inspector-field">
            <span><Localized id="topology-inspector-device-address">Connection Address</Localized></span>
            <input
              type="text"
              placeholder={l10n.getString('topology-inspector-device-address-placeholder')}
              value={(selectedNode.metadata?.['deviceAddress'] as string) ?? ''}
              onChange={(e) => {
                beginInspectorEdit(selectedNode.id);
                const deviceAddress = e.target.value;
                setNodes((prev) => prev.map((n) => n.id === selectedNode.id
                  ? { ...n, metadata: { ...n.metadata, deviceAddress } }
                  : n));
              }}
            />
          </label>
        </div>
      )}

      {/* ── Quick actions ─────────────────────────────────── */}
      <div className="inspector-section inspector-section--actions">
        <h4 className="inspector-section-title"><Localized id="topology-inspector-section-actions">Actions</Localized></h4>
        <div className="inspector-actions">
          {selectedNode.type !== 'store' && (
            <button type="button" className="inspector-action-btn" onClick={() => { duplicateSelection(); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              <Localized id="topology-inspector-duplicate">Duplicate</Localized>
            </button>
          )}
          {selectedNode.type !== 'store' ? (
            <button type="button" className="inspector-action-btn inspector-action-btn--danger" onClick={handleDeleteRequest}>
              <TrashIcon size={14} />
              <Localized id="topology-inspector-delete">Delete</Localized>
            </button>
          ) : (
            <span className="inspector-anchor-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="12" height="12"><circle cx="12" cy="5" r="2" /><path d="M12 7v10" /><path d="M8 21h8" /></svg>
              <Localized id="topology-inspector-anchor-label">Anchor</Localized>
            </span>
          )}
        </div>
      </div>
      </ErrorBoundary>
    </div>
  </div>
  );
}
