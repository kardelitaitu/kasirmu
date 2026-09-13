//! Isolated unit tests for the topology editor's extracted relationship
//! picker and validation issues widget — the two state-adjacent pieces the
//! overlay tests do not cover, pinned by their props→behavior contracts.

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TopologyRelationshipPicker } from '../features/locations/topologyRelationshipPicker';
import { TopologyValidationWidget } from '../features/locations/topologyValidationWidget';
import type { TopologyNodeData } from '../features/locations/NodeTopologyEditor';
import type { TopologyPickerState } from '../features/locations/nodeTopologyEditorConnectionState';
import type { WireRelationshipOption } from '../features/locations/topologyCard';
import type { TopologyValidationError } from '../features/locations/topologyContract';

vi.mock('@fluent/react', () => ({
  Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
  useLocalization: () => ({
    l10n: {
      getString: (id: string, vars?: Record<string, string | number> | null) => {
        let value = id;
        for (const [key, val] of Object.entries(vars ?? {})) {
          value = value.replaceAll(`{ $${key} }`, String(val)).replaceAll(`{${key}}`, String(val));
        }
        return value;
      },
    },
  }),
}));

afterEach(cleanup);

describe('TopologyRelationshipPicker', () => {
  const optionA: WireRelationshipOption = {
    fromPortId: 'operation-out',
    toPortId: 'operation-in',
    relationshipType: 'generic',
    labelId: 'topology-relationship-generic',
  };
  const optionB: WireRelationshipOption = {
    fromPortId: 'stock-out',
    toPortId: 'stock-in',
    relationshipType: 'stock-routing',
    labelId: 'topology-relationship-stock-routing',
  };
  const picker: TopologyPickerState = {
    fromNodeId: 'a',
    fromPort: 'right',
    fromVariantIndex: 0,
    toNodeId: 'b',
    toPort: 'left',
    toVariantIndex: 0,
    options: [optionA, optionB],
  };
  const toNode: TopologyNodeData = { id: 'b', type: 'warehouse', name: 'B', x: 300, y: 200 };

  const renderPicker = (overrides: Partial<Parameters<typeof TopologyRelationshipPicker>[0]> = {}) =>
    render(
      <TopologyRelationshipPicker
        picker={picker}
        toNode={toNode}
        getCanvas={() => null}
        pan={{ x: 0, y: 0 }}
        zoom={1}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        {...overrides}
      />,
    );

  it('renders one option per choice plus a cancel button', () => {
    const { container } = renderPicker();
    expect(container.querySelectorAll('.topology-relationship-option')).toHaveLength(2);
    expect(container.querySelector('.topology-relationship-cancel')).not.toBeNull();
  });

  it('commits the chosen option and cancels on the cancel button', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { container } = renderPicker({ onCommit, onCancel });

    fireEvent.click(container.querySelectorAll('.topology-relationship-option')[0]!);
    expect(onCommit).toHaveBeenCalledWith(optionA);

    fireEvent.click(container.querySelector('.topology-relationship-cancel')!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('TopologyValidationWidget', () => {
  const nodeIssues = [
    { nodeId: 'n1', nodeName: 'Store 1', messageId: 'topology-validation-missing-location', code: 'missing-location-input' as const },
    { nodeId: 'n2', nodeName: 'Warehouse', messageId: 'topology-validation-missing-stock-routing', code: 'warehouse-missing-stock-routing' as const },
  ];
  const graphIssues: TopologyValidationError[] = [
    { code: 'duplicate-wire', messageId: 'topology-validation-duplicate-wire', wireId: 'w1' },
    { code: 'missing-branch-location', messageId: 'topology-validation-missing-branch' },
  ];

  const renderWidget = (overrides: Partial<Parameters<typeof TopologyValidationWidget>[0]> = {}) =>
    render(
      <TopologyValidationWidget
        totalIssues={4}
        open={false}
        onToggle={vi.fn()}
        nodeIssues={nodeIssues}
        graphIssues={graphIssues}
        onSelectNode={vi.fn()}
        onAddStockWire={vi.fn()}
        onJumpToWire={vi.fn()}
        onDismissNodeIssue={vi.fn()}
        onDismissGraphIssue={vi.fn()}
        {...overrides}
      />,
    );

  it('toggles the panel open/closed via the issues button', () => {
    const onToggle = vi.fn();
    const { container } = renderWidget({ onToggle });
    const button = screen.getByRole('button', { expanded: false });
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.topology-validation-panel')).toBeNull();
  });

  it('renders node rows and dispatches select + stock-wire actions when open', () => {
    const onSelectNode = vi.fn();
    const onAddStockWire = vi.fn();
    const { container } = renderWidget({ open: true, onSelectNode, onAddStockWire });

    const selectButtons = container.querySelectorAll('.topology-validation-item-select');
    expect(selectButtons).toHaveLength(3); // 2 node rows + 1 jumpable graph row

    fireEvent.click(selectButtons[0]!);
    expect(onSelectNode).toHaveBeenCalledWith('n1');

    fireEvent.click(container.querySelector('.topology-validation-item-action')!);
    expect(onAddStockWire).toHaveBeenCalledWith('n2');
  });

  it('renders jumpable graph rows and dispatches jump + dismiss actions', () => {
    const onJumpToWire = vi.fn();
    const onDismissNodeIssue = vi.fn();
    const onDismissGraphIssue = vi.fn();
    const { container } = renderWidget({ open: true, onJumpToWire, onDismissNodeIssue, onDismissGraphIssue });

    const selectButtons = container.querySelectorAll('.topology-validation-item-select');
    // Row 3 (index 2) is the wireId graph row.
    fireEvent.click(selectButtons[2]!);
    expect(onJumpToWire).toHaveBeenCalledWith('w1');

    // Dismiss buttons: 2 node rows + 2 graph rows = 4.
    const dismissButtons = container.querySelectorAll('.topology-validation-item-dismiss');
    expect(dismissButtons).toHaveLength(4);
    fireEvent.click(dismissButtons[0]!);
    expect(onDismissNodeIssue).toHaveBeenCalledWith('n1', 'topology-validation-missing-location');
    fireEvent.click(dismissButtons[2]!);
    expect(onDismissGraphIssue).toHaveBeenCalledWith('topology-validation-duplicate-wire');
  });
});
