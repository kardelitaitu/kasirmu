import { describe, expect, it } from 'vitest';
import {
  deletableNodeIds,
  nodesWithoutIds,
  wiresWithoutEndpoints,
} from '../features/locations/topologyCommands';
import type {
  TopologyNodeData,
  TopologyWireData,
} from '../features/locations/NodeTopologyEditor';

const node = (id: string, type: TopologyNodeData['type']): TopologyNodeData => ({
  id,
  type,
  name: id,
  x: 0,
  y: 0,
});

const wire = (id: string, fromNodeId: string, toNodeId: string): TopologyWireData => ({
  id,
  fromNodeId,
  toNodeId,
  direction: 'one-way',
  fromPort: 'right',
  toPort: 'left',
});

describe('deletableNodeIds', () => {
  it('excludes Branch Location nodes — they are permanent anchors', () => {
    const nodes = [node('store-1', 'store'), node('ws-1', 'workspace'), node('hw-1', 'hardware')];
    expect(deletableNodeIds(nodes, ['store-1', 'ws-1', 'hw-1'])).toEqual(['ws-1', 'hw-1']);
  });

  it('detects Branch Locations by type, not by id spelling', () => {
    const nodes = [node('store-named-workspace', 'workspace'), node('ws-1', 'workspace')];
    expect(deletableNodeIds(nodes, ['store-named-workspace', 'ws-1'])).toEqual([
      'store-named-workspace',
      'ws-1',
    ]);
  });

  it('preserves input order and deduplicates', () => {
    const nodes = [node('a', 'workspace'), node('b', 'workspace')];
    expect(deletableNodeIds(nodes, ['b', 'a', 'b', 'a'])).toEqual(['b', 'a']);
  });

  it('treats unknown ids as deletable, matching the inline filter it replaced', () => {
    const nodes = [node('store-1', 'store')];
    expect(deletableNodeIds(nodes, ['ghost-id'])).toEqual(['ghost-id']);
  });

  it('returns empty for an all-branch request or an empty request', () => {
    const nodes = [node('store-1', 'store'), node('ws-1', 'workspace')];
    expect(deletableNodeIds(nodes, ['store-1'])).toEqual([]);
    expect(deletableNodeIds(nodes, [])).toEqual([]);
  });
});

describe('nodesWithoutIds', () => {
  it('removes only the doomed ids and preserves the rest in order', () => {
    const nodes = [node('store-1', 'store'), node('a', 'workspace'), node('b', 'workspace')];
    const result = nodesWithoutIds(nodes, new Set(['b']));
    expect(result.map((n) => n.id)).toEqual(['store-1', 'a']);
  });

  it('returns a new array and mutates nothing', () => {
    const nodes = [node('a', 'workspace'), node('b', 'workspace')];
    const snapshot = [...nodes];
    const result = nodesWithoutIds(nodes, new Set(['b']));
    expect(result).not.toBe(nodes);
    expect(nodes).toEqual(snapshot);
  });

  it('keeps everything when the doomed set is empty', () => {
    const nodes = [node('a', 'workspace'), node('b', 'workspace')];
    expect(nodesWithoutIds(nodes, new Set()).map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('wiresWithoutEndpoints', () => {
  it('drops wires anchored to any deleted node — from or to side', () => {
    const wires = [wire('w1', 'a', 'b'), wire('w2', 'store-1', 'a'), wire('w3', 'b', 'store-1'), wire('w4', 'store-1', 'c')];
    // w1 loses its FROM endpoint, w2 its TO endpoint — both go. w3/w4
    // never touch the doomed node and survive.
    expect(wiresWithoutEndpoints(wires, new Set(['a'])).map((w) => w.id)).toEqual(['w3', 'w4']);
  });

  it('keeps every wire when nothing is doomed', () => {
    const wires = [wire('w1', 'a', 'b'), wire('w2', 'b', 'a')];
    expect(wiresWithoutEndpoints(wires, new Set())).toEqual(wires);
  });

  it('composes into the delete command shape the editor wires up', () => {
    // Documents the deleteNodes composition: deletable ids -> one Set ->
    // node and wire filters share it, so every touching wire leaves with
    // its node and Branch Locations are never doomed.
    const nodes = [node('store-1', 'store'), node('a', 'workspace'), node('b', 'workspace'), node('c', 'hardware')];
    const wires = [wire('w1', 'a', 'b'), wire('w2', 'store-1', 'a'), wire('w3', 'b', 'c'), wire('w4', 'store-1', 'c')];
    const doomed = new Set(deletableNodeIds(nodes, ['store-1', 'a', 'b', 'ghost']));
    expect([...doomed].sort()).toEqual(['a', 'b', 'ghost']);
    expect(nodesWithoutIds(nodes, doomed).map((n) => n.id)).toEqual(['store-1', 'c']);
    // Every wire touching a or b goes; only the store→c wire survives.
    expect(wiresWithoutEndpoints(wires, doomed).map((w) => w.id)).toEqual(['w4']);
  });
});
