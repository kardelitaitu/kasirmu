import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/frontend/shared';
import {
  StoreIcon,
  WarehouseIcon,
  PrinterIcon,
  CartIcon,
  UtensilsIcon,
  TrashIcon,
  LockIcon,
  PlusIcon,
  NodesIcon,
} from './NodeTopologyIcons';
import type { NodeType, WorkspaceTypeKey } from './NodeTopologyEditor';

/**
 * Right-side tool rack — extracted from `NodeTopologyEditor.tsx`
 * (Phase 3 split). Four expandable panels (add / edit / view / share) plus
 * the rack-icon strip. Presentational: every value and callback is a prop
 * so the parent keeps all canvas state and save logic.
 */

export interface TopologyToolRackProps {
  l10n: ReturnType<typeof useLocalization>['l10n'];
  /** Currently open rack panel (null = collapsed). */
  rackPanel: string | null;
  onTogglePanel: (panel: string) => void;
  onClosePanel: () => void;
  /** Edit-panel gating: something selected, or undo/redo available. */
  hasSelection: boolean;
  /** Delete button gating: an actual node/wire selection exists. */
  canDelete: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onDeleteSelected: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Add panel. */
  allowLegacyApply: boolean;
  onAddNode: (type: NodeType, at?: { x: number; y: number }, workspaceTypeKey?: WorkspaceTypeKey) => void;
  isProAllowed: boolean;
  hasWarehouse: boolean;
  /** View panel. */
  onAutoLayout: () => void;
  wireRouting: 'elbow' | 'curved';
  onToggleWireRouting: () => void;
  anyBentWires: boolean;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  panToolActive: boolean;
  onTogglePanTool: () => void;
  wireLabelsVisible: boolean;
  onToggleWireLabels: () => void;
  /** Share panel: export / import / templates. */
  onExport: () => void;
  onImport: () => void;
  templateSaveOpen: boolean;
  onToggleTemplateSave: () => void;
  templateName: string;
  onTemplateNameChange: (name: string) => void;
  onSaveTemplate: (name: string) => void;
  onOpenTemplates: () => void;
  templatesOpen: boolean;
  savedTemplates: string[];
  onLoadTemplate: (name: string) => void;
  onDeleteTemplate: (name: string) => void;
}

export function TopologyToolRack({
  l10n,
  rackPanel,
  onTogglePanel,
  onClosePanel,
  hasSelection,
  canDelete,
  canUndo,
  canRedo,
  onDeleteSelected,
  onUndo,
  onRedo,
  allowLegacyApply,
  onAddNode,
  isProAllowed,
  hasWarehouse,
  onAutoLayout,
  wireRouting,
  onToggleWireRouting,
  anyBentWires,
  snapEnabled,
  onToggleSnap,
  panToolActive,
  onTogglePanTool,
  wireLabelsVisible,
  onToggleWireLabels,
  onExport,
  onImport,
  templateSaveOpen,
  onToggleTemplateSave,
  templateName,
  onTemplateNameChange,
  onSaveTemplate,
  onOpenTemplates,
  templatesOpen,
  savedTemplates,
  onLoadTemplate,
  onDeleteTemplate,
}: TopologyToolRackProps) {
  return (
    <div className="node-tool-rack">
      <button type="button" className={`rack-icon-btn${rackPanel === 'add' ? ' is-active' : ''}`} onClick={() => onTogglePanel('add')} aria-label={l10n.getString('topology-rack-add-title')} aria-expanded={rackPanel === 'add'}><PlusIcon size={18} /></button>
      {hasSelection && (
        <button type="button" className={`rack-icon-btn${rackPanel === 'edit' ? ' is-active' : ''}`} onClick={() => onTogglePanel('edit')} aria-label={l10n.getString('topology-rack-edit-title')} aria-expanded={rackPanel === 'edit'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg></button>
      )}
      <button type="button" className={`rack-icon-btn${rackPanel === 'view' ? ' is-active' : ''}`} onClick={() => onTogglePanel('view')} aria-label={l10n.getString('topology-rack-view-title')} aria-expanded={rackPanel === 'view'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg></button>
      <button type="button" className={`rack-icon-btn${rackPanel === 'share' ? ' is-active' : ''}`} onClick={() => onTogglePanel('share')} aria-label={l10n.getString('topology-rack-share-title')} aria-expanded={rackPanel === 'share'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg></button>

      {rackPanel && (
        <div className="rack-panel" role="group" aria-label={l10n.getString(`topology-rack-${rackPanel}-title`)}>
          <div className="rack-panel-header">
            <h3 className="rack-panel-title"><Localized id={`topology-rack-${rackPanel}-title`}>{rackPanel}</Localized></h3>
            <button type="button" className="rack-panel-close" onClick={onClosePanel} aria-label={requiredLocalized(l10n, 'close-aria')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
          </div>
          {rackPanel === 'add' && (
            <div className="rack-panel-body">
              {allowLegacyApply && (
                <button type="button" className="tool-card" onClick={() => { onAddNode('store'); }}><span className="tool-card-icon"><StoreIcon size={20} /></span><div className="tool-card-info"><strong><Localized id="topology-tool-store">+ Store Node</Localized></strong><span><Localized id="topology-tool-store-desc">Store Branch Profile</Localized></span></div><kbd className="tool-card-shortcut">1</kbd></button>
              )}
              <div className="rack-panel-subsection"><span className="rack-panel-subsection-title">{l10n.getString('topology-workspace-types-title')}</span></div>
              <button type="button" className="tool-card" onClick={() => { onAddNode('workspace', undefined, 'restaurant-pos'); }}><span className="tool-card-icon"><UtensilsIcon size={20} /></span><div className="tool-card-info"><strong><Localized id="topology-tool-restaurant-pos">+ Restaurant POS</Localized></strong><span><Localized id="topology-tool-restaurant-pos-desc">Restaurant checkout workspace</Localized></span></div></button>
              <button type="button" className="tool-card" onClick={() => { onAddNode('workspace', undefined, 'store-pos'); }}><span className="tool-card-icon"><CartIcon size={20} /></span><div className="tool-card-info"><strong><Localized id="topology-tool-retail-pos">+ Retail POS</Localized></strong><span><Localized id="topology-tool-retail-pos-desc">Retail checkout workspace</Localized></span></div></button>
              <button type="button" className="tool-card" onClick={() => { onAddNode('workspace', undefined, 'kds'); }}><span className="tool-card-icon"><NodesIcon size={20} /></span><div className="tool-card-info"><strong><Localized id="topology-tool-kds">+ KDS</Localized></strong><span><Localized id="topology-tool-kds-desc">Kitchen display workspace</Localized></span></div></button>
              <button type="button" className={`tool-card${!isProAllowed && hasWarehouse ? ' locked' : ''}`} onClick={() => { onAddNode('warehouse'); }}><span className="tool-card-icon"><WarehouseIcon size={20} /></span><div className="tool-card-info"><strong><Localized id="topology-tool-warehouse-workspace">+ Warehouse</Localized></strong><span><Localized id="topology-tool-warehouse-workspace-desc">Inventory storage workspace</Localized></span></div>{!isProAllowed && hasWarehouse && <span className="lock-badge"><LockIcon size={12} /> Pro</span>}</button>
              <div className="rack-panel-subsection"><span className="rack-panel-subsection-title"><Localized id="topology-other-nodes-title">Other Nodes</Localized></span></div>
              <button type="button" className="tool-card" onClick={() => { onAddNode('hardware'); }}><span className="tool-card-icon"><PrinterIcon size={20} /></span><div className="tool-card-info"><strong><Localized id="topology-tool-hardware">+ Hardware Node</Localized></strong><span><Localized id="topology-tool-hardware-desc">Printer / KDS Peripheral</Localized></span></div></button>
            </div>
          )}
          {rackPanel === 'edit' && (
            <div className="rack-panel-body">
              {canDelete ? (
                <button type="button" className="tool-card" onClick={onDeleteSelected}><span className="tool-card-icon" style={{ color: 'var(--color-danger)' }}><TrashIcon size={20} /></span><div className="tool-card-info"><strong><Localized id="topology-delete-selected">Delete Selected Element</Localized></strong></div></button>
              ) : <Localized id="topology-rack-delete-empty"><p className="rack-panel-empty">Select a node or wire to delete</p></Localized>}
              {canUndo && <button type="button" className="tool-card" onClick={onUndo}><span className="tool-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg></span><div className="tool-card-info"><strong><Localized id="topology-undo">Undo (Ctrl+Z)</Localized></strong></div></button>}
              {canRedo && <button type="button" className="tool-card" onClick={onRedo}><span className="tool-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg></span><div className="tool-card-info"><strong><Localized id="topology-redo">Redo (Ctrl+Y)</Localized></strong></div></button>}
            </div>
          )}
          {rackPanel === 'view' && (
            <div className="rack-panel-body">
              <button type="button" className="tool-card" onClick={onAutoLayout}><span className="tool-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg></span><div className="tool-card-info"><strong><Localized id="topology-auto-layout">Auto-layout</Localized></strong></div></button>
              <button type="button" className={`tool-card${wireRouting === 'elbow' ? ' is-active' : ''}`} aria-pressed={wireRouting === 'elbow'} title={anyBentWires ? l10n.getString('topology-bends-override-note') : undefined} onClick={onToggleWireRouting}><span className="tool-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><polyline points="4 4 4 20 20 20" /><polyline points="4 4 12 12" /></svg></span><div className="tool-card-info"><strong><Localized id="topology-wire-routing-toggle">Elbow wires</Localized></strong>{anyBentWires && <span className="rack-panel-note">{l10n.getString('topology-bends-override-note')}</span>}</div></button>
              <button type="button" className={`tool-card${snapEnabled ? ' is-active' : ''}`} aria-pressed={snapEnabled} onClick={onToggleSnap}><span className="tool-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg></span><div className="tool-card-info"><strong><Localized id="topology-snap-toggle">Snap to grid</Localized></strong></div></button>
              <button type="button" className={`tool-card${panToolActive ? ' is-active' : ''}`} aria-pressed={panToolActive} onClick={onTogglePanTool}><span className="tool-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M18 11V6a2 2 0 0 0-4 0v5" /><path d="M14 10V4a2 2 0 0 0-4 0v6" /><path d="M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></svg></span><div className="tool-card-info"><strong><Localized id="topology-pan-tool-toggle">Pan tool</Localized></strong></div></button>
              <button type="button" className={`tool-card${wireLabelsVisible ? ' is-active' : ''}`} aria-pressed={wireLabelsVisible} onClick={onToggleWireLabels}><span className="tool-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></span><div className="tool-card-info"><strong><Localized id="topology-wire-labels-toggle">Wire labels</Localized></strong></div></button>
            </div>
          )}
          {rackPanel === 'share' && (
            <div className="rack-panel-body">
              <button type="button" className="tool-card" onClick={onExport}><span className="tool-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg></span><div className="tool-card-info"><strong><Localized id="topology-export">Export</Localized></strong><Localized id="topology-export-desc"><span>Download as JSON</span></Localized></div></button>
              <button type="button" className="tool-card" onClick={onImport}><span className="tool-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg></span><div className="tool-card-info"><strong><Localized id="topology-import">Import</Localized></strong><Localized id="topology-import-desc"><span>Load from JSON file</span></Localized></div></button>
              <div className="rack-panel-divider" />
              <button type="button" className="tool-card" onClick={onToggleTemplateSave}><span className="tool-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg></span><div className="tool-card-info"><strong><Localized id="topology-save-template">Save template</Localized></strong></div></button>
              {templateSaveOpen && (
                <div className="rack-template-pop" role="group"><input type="text" className="rack-template-input" placeholder={l10n.getString('topology-template-name-placeholder')} value={templateName} onChange={(e) => onTemplateNameChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSaveTemplate(templateName); else if (e.key === 'Escape') { onToggleTemplateSave(); onTemplateNameChange(''); } }} /><button type="button" className="rack-template-save" onClick={() => onSaveTemplate(templateName)}><Localized id="topology-template-save">Save</Localized></button></div>
              )}
              <button type="button" className="tool-card" onClick={onOpenTemplates}><span className="tool-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg></span><div className="tool-card-info"><strong><Localized id="topology-templates">Templates</Localized></strong></div></button>
              {templatesOpen && (
                <div className="rack-template-list" role="group">
                  {savedTemplates.length === 0 ? <p className="rack-panel-empty"><Localized id="topology-no-templates">No saved templates</Localized></p> : (
                    <ul className="rack-template-items">{savedTemplates.map((name) => (<li key={name} className="rack-template-item"><span className="rack-template-name">{name}</span><div className="rack-template-actions"><button type="button" onClick={() => onLoadTemplate(name)}><Localized id="topology-template-load">Load</Localized></button><button type="button" onClick={() => onDeleteTemplate(name)}><Localized id="topology-template-delete">Delete</Localized></button></div></li>))}</ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
