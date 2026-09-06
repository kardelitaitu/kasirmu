import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { TopologyNodeData } from '@/features/locations/NodeTopologyEditor';
import {
  gatingSemanticId,
  iconForNode,
  isKdsNode,
  isRestaurantPosNode,
  leftPortLabelId,
  leftPortVariants,
  nodeKindOf,
  portAriaLabelId,
  portLabelId,
  sanitizeCopiedNode,
  semanticPortId,
  semanticPortLabelId,
  settingsCardForTypeKey,
  socketSemanticIds,
  visiblePortsForNode,
} from '@/features/locations/topologyCard';

// ADR #45 §3 — the behavior freeze.
//
// Per-type knowledge currently sits in eleven separate functions in
// topologyCard.ts (leftPortVariants, visiblePortsForNode, leftPortLabelId,
// portLabelId, semanticPortLabelId, portAriaLabelId, semanticPortId,
// socketSemanticIds, gatingSemanticId, WORKSPACE_SETTINGS_CARD,
// NODE_TYPE_ICON). Collapsing them into one registry is the refactor ADR #45
// §3 asks for, and the spine of a 6,145-line editor must not be moved without
// first recording exactly what it does today.
//
// This golden IS that recording: it captures every observable behaviour of
// every node kind — sockets, semantics, labels, icons, settings cards, copy
// sanitization — across the full probe set, including the kinds that exist in
// the database but not in the topology contract. The registry refactor must
// leave this file byte-identical. If it changes, the refactor changed
// behaviour, and that has to be argued about rather than merged.
//
// Regenerate deliberately:
//   TOPOLOGY_BEHAVIOR_UPDATE=1 npx vitest run src/__tests__/topologyKindBehavior.test.ts

const GOLDEN_PATH = resolve(__dirname, 'topologyKindBehavior.golden.json');

/** Every node shape the eleven functions branch on. The last four are
 *  deliberately awkward: `warehouse` and `admin` are real seeded workspace
 *  type keys that the topology contract does not declare, `general` is a
 *  purpose_key that appears in fixtures in the typeKey slot, and a workspace
 *  with no typeKey at all exercises the defaults. */
const PROBES: Array<[string, TopologyNodeData]> = [
  ['branch-location', { id: 'b', type: 'store', name: 'B', x: 0, y: 0 }],
  ['branch-location-diagram-only', { id: 'b2', type: 'store', name: 'B2', x: 0, y: 0, storeProfileId: 'default' }],
  ['workspace:store-pos', { id: 'w1', type: 'workspace', name: 'W', x: 0, y: 0, metadata: { typeKey: 'store-pos' } }],
  ['workspace:restaurant-pos', { id: 'w2', type: 'workspace', name: 'W', x: 0, y: 0, metadata: { typeKey: 'restaurant-pos' } }],
  ['workspace:kds', { id: 'w3', type: 'workspace', name: 'W', x: 0, y: 0, metadata: { typeKey: 'kds' } }],
  ['workspace:warehouse', { id: 'w4', type: 'workspace', name: 'W', x: 0, y: 0, metadata: { typeKey: 'warehouse' } }],
  ['workspace:admin', { id: 'w5', type: 'workspace', name: 'W', x: 0, y: 0, metadata: { typeKey: 'admin' } }],
  ['workspace:general', { id: 'w6', type: 'workspace', name: 'W', x: 0, y: 0, metadata: { typeKey: 'general' } }],
  ['workspace:<none>', { id: 'w7', type: 'workspace', name: 'W', x: 0, y: 0 }],
  ['warehouse', { id: 'h1', type: 'warehouse', name: 'H', x: 0, y: 0 }],
  ['hardware', { id: 'd1', type: 'hardware', name: 'D', x: 0, y: 0 }],
];

/** Labels a card can show depending on what is already attached to the socket.
 *  These are the connectedPortId branches in leftPortLabelId. */
const CONNECTED_PORT_CASES = [undefined, 'operation-in', 'stock-in', 'transfer-in', 'ticket-in', 'location-in'];

/** Every semantic the contract knows about, so the label map is probed
 *  uniformly rather than only where a node happens to expose it. */
const ALL_SEMANTICS = [
  'location-out', 'location-in', 'operation-out', 'operation-in',
  'stock-out', 'stock-in', 'transfer-out', 'transfer-in',
  'ticket-out', 'ticket-in', 'device-out', 'generic-in', 'generic-out',
] as const;

function componentName(component: unknown): string {
  if (typeof component === 'function') return component.name || '<anonymous>';
  if (component && typeof component === 'object') {
    const anyComponent = component as { name?: string; displayName?: string };
    return anyComponent.displayName || anyComponent.name || '<object>';
  }
  return '<none>';
}

function probeNode(node: TopologyNodeData) {
  const ports = visiblePortsForNode(node);
  const variants = leftPortVariants(node);
  const socketCount = Math.max(1, variants.length);

  const sockets = (['left', 'right'] as const).map((side) => ({
    side,
    visible: ports.includes(side),
    rows: Array.from({ length: side === 'left' ? variants.length : socketCount }, (_, index) => ({
      index,
      semantics: socketSemanticIds(node, side, index),
      gating: gatingSemanticId(node, side, index),
      recording: semanticPortId(node, side, index),
      labelId: portLabelId(node, side),
      ariaLabelId: portAriaLabelId(node, side, index),
      leftLabelId: side === 'left' ? leftPortLabelId(node, index) : undefined,
    })),
  }));

  return {
    kind: nodeKindOf(node),
    isKds: isKdsNode(node),
    isRestaurantPos: isRestaurantPosNode(node),
    visiblePorts: ports,
    leftPortVariants: variants,
    sockets,
    leftLabelsByConnected: CONNECTED_PORT_CASES.map((connected) => ({
      connected: connected ?? '<none>',
      labelId: leftPortLabelId(node, 0, connected),
    })),
    semanticLabels: ALL_SEMANTICS.map((semantic) => ({
      semantic,
      left: semanticPortLabelId(node, 'left', semantic),
      right: semanticPortLabelId(node, 'right', semantic),
    })),
    icon: componentName(iconForNode(node)),
    settingsCard: node.type === 'workspace'
      ? componentName(settingsCardForTypeKey(String(node.metadata?.['typeKey'] ?? '')))
      : '<not-a-workspace>',
    copySanitization: (() => {
      const withIdentity = { ...node, storeProfileId: 'default' } as TopologyNodeData;
      const copy = sanitizeCopiedNode(withIdentity);
      return { keepsStoreProfileId: 'storeProfileId' in copy };
    })(),
  };
}

function buildGolden() {
  return {
    generatedBy: 'ui/src/__tests__/topologyKindBehavior.test.ts (ADR #45 §3 behavior freeze)',
    probes: PROBES.map(([label, node]) => ({ label, behavior: probeNode(node) })),
  };
}

describe('topology kind behavior — the ADR #45 §3 freeze', () => {
  const golden = buildGolden();

  it('records the observable behavior of every node kind', () => {
    if (process.env['TOPOLOGY_BEHAVIOR_UPDATE']) {
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(golden, null, 2)}\n`, 'utf-8');
      return;
    }
    let recorded: string;
    try {
      recorded = readFileSync(GOLDEN_PATH, 'utf-8');
    } catch {
      throw new Error(
        `topology behavior golden missing at ${GOLDEN_PATH} — regenerate with `
        + 'TOPOLOGY_BEHAVIOR_UPDATE=1 npx vitest run src/__tests__/topologyKindBehavior.test.ts',
      );
    }
    expect(JSON.parse(recorded)).toEqual(golden);
  });

  it('probes every node type the canvas can hold', () => {
    const types = new Set(PROBES.map(([, node]) => node.type));
    expect([...types].sort()).toEqual(['hardware', 'store', 'warehouse', 'workspace']);
  });

  it('probes both registered and unregistered workspace types', () => {
    // The registry refactor must not quietly start treating an unregistered
    // typeKey like a registered one; these probes are what catch it.
    const keys = PROBES
      .filter(([, node]) => node.type === 'workspace')
      .map(([, node]) => String(node.metadata?.['typeKey'] ?? '<none>'));
    for (const key of ['store-pos', 'restaurant-pos', 'kds', 'warehouse', 'admin', 'general']) {
      expect(keys).toContain(key);
    }
  });
});
