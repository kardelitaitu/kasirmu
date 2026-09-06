import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/locales/test-utils';
import { TopologyValidationWidget } from '@/features/locations/topologyValidationWidget';
import type { TopologyValidationNodeIssue } from '@/features/locations/topologyValidationWidget';
import type { TopologyValidationError } from '@/features/locations/topologyContract';
import multiStoreFtl from '@/locales/multi-store.ftl?raw';
import multiStoreIdFtl from '@/locales/multi-store.id.ftl?raw';

// ── Mock data factories ───────────────────────────────────────────

function makeNodeIssue(overrides: Partial<TopologyValidationNodeIssue> = {}): TopologyValidationNodeIssue {
  return {
    nodeId: 'node-1',
    nodeName: 'Test Warehouse',
    messageId: 'topology-validation-warehouse-missing-stock-routing',
    code: 'warehouse-missing-stock-routing',
    ...overrides,
  };
}

function makeGraphIssue(overrides: Partial<TopologyValidationError> = {}): TopologyValidationError {
  return {
    code: 'cycle-detected',
    messageId: 'topology-validation-wire-cyclic',
    wireId: 'wire-1',
    ...overrides,
  };
}

// ── Test utilities ────────────────────────────────────────────────

async function renderWithFluent(ui: React.ReactElement) {
  return renderInAct(withFluent(ui, multiStoreFtl));
}

const defaultProps = {
  totalIssues: 0,
  open: false,
  onToggle: vi.fn(),
  nodeIssues: [] as TopologyValidationNodeIssue[],
  graphIssues: [] as TopologyValidationError[],
  onSelectNode: vi.fn(),
  onAddStockWire: vi.fn(),
  onJumpToWire: vi.fn(),
  onDismissNodeIssue: vi.fn(),
  onDismissGraphIssue: vi.fn(),
};

// ── Button rendering ──────────────────────────────────────────────

describe('TopologyValidationWidget — EN', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the issues button', async () => {
    await renderWithFluent(
      <TopologyValidationWidget {...defaultProps} />,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('button shows issue count label', async () => {
    await renderWithFluent(
      <TopologyValidationWidget {...defaultProps} totalIssues={3} />,
    );
    const btn = screen.getByRole('button');
    expect(btn.textContent).toContain('3');
  });

  it('button has aria-expanded=false when closed', async () => {
    await renderWithFluent(
      <TopologyValidationWidget {...defaultProps} open={false} />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('button has aria-expanded=true when open', async () => {
    await renderWithFluent(
      <TopologyValidationWidget {...defaultProps} open={true} />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('button calls onToggle on click', async () => {
    const onToggle = vi.fn();
    await renderWithFluent(
      <TopologyValidationWidget {...defaultProps} onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // ── Panel when open ──────────────────────────────────────────

  it('does not show panel when closed', async () => {
    await renderWithFluent(
      <TopologyValidationWidget {...defaultProps} open={false} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows panel when open', async () => {
    await renderWithFluent(
      <TopologyValidationWidget {...defaultProps} open={true} />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // ── Node issues ──────────────────────────────────────────────

  it('renders node issues', async () => {
    const nodeIssues = [makeNodeIssue()];
    await renderWithFluent(
      <TopologyValidationWidget {...defaultProps} open={true} nodeIssues={nodeIssues} />,
    );
    expect(screen.getByText('Test Warehouse')).toBeInTheDocument();
  });

  it('node issue select button calls onSelectNode', async () => {
    const onSelectNode = vi.fn();
    const nodeIssues = [makeNodeIssue({ nodeId: 'node-42' })];
    await renderWithFluent(
      <TopologyValidationWidget
        {...defaultProps}
        open={true}
        nodeIssues={nodeIssues}
        onSelectNode={onSelectNode}
      />,
    );
    const selectBtn = document.querySelector('.topology-validation-item-select');
    fireEvent.click(selectBtn!);
    expect(onSelectNode).toHaveBeenCalledWith('node-42');
  });

  it('warehouse-missing-stock-routing shows Add stock wire button', async () => {
    const nodeIssues = [makeNodeIssue({ code: 'warehouse-missing-stock-routing' })];
    await renderWithFluent(
      <TopologyValidationWidget {...defaultProps} open={true} nodeIssues={nodeIssues} />,
    );
    expect(screen.getByText(/stock wire/i)).toBeInTheDocument();
  });

  it('non-warehouse issue does not show Add stock wire button', async () => {
    const nodeIssues = [makeNodeIssue({ code: 'other-error' })];
    await renderWithFluent(
      <TopologyValidationWidget {...defaultProps} open={true} nodeIssues={nodeIssues} />,
    );
    expect(screen.queryByText(/stock wire/i)).not.toBeInTheDocument();
  });

  it('node issue dismiss calls onDismissNodeIssue', async () => {
    const onDismissNodeIssue = vi.fn();
    const nodeIssues = [makeNodeIssue({ nodeId: 'n1', messageId: 'msg-1' })];
    await renderWithFluent(
      <TopologyValidationWidget
        {...defaultProps}
        open={true}
        nodeIssues={nodeIssues}
        onDismissNodeIssue={onDismissNodeIssue}
      />,
    );
    const dismissBtn = document.querySelector('.topology-validation-item-dismiss');
    fireEvent.click(dismissBtn!);
    expect(onDismissNodeIssue).toHaveBeenCalledWith('n1', 'msg-1');
  });

  it('Add stock wire calls onAddStockWire', async () => {
    const onAddStockWire = vi.fn();
    const nodeIssues = [makeNodeIssue({ nodeId: 'n1' })];
    await renderWithFluent(
      <TopologyValidationWidget
        {...defaultProps}
        open={true}
        nodeIssues={nodeIssues}
        onAddStockWire={onAddStockWire}
      />,
    );
    const actionBtn = document.querySelector('.topology-validation-item-action');
    fireEvent.click(actionBtn!);
    expect(onAddStockWire).toHaveBeenCalledWith('n1');
  });

  // ── Graph issues ─────────────────────────────────────────────

  it('renders jumpable graph issues with wireId', async () => {
    const graphIssues = [makeGraphIssue({ wireId: 'w1', messageId: 'msg-wire' })];
    await renderWithFluent(
      <TopologyValidationWidget {...defaultProps} open={true} graphIssues={graphIssues} />,
    );
    const selectBtn = document.querySelector('.topology-validation-item-select');
    expect(selectBtn).toBeInTheDocument();
  });

  it('jumpable graph issue calls onJumpToWire', async () => {
    const onJumpToWire = vi.fn();
    const graphIssues = [makeGraphIssue({ wireId: 'w1' })];
    await renderWithFluent(
      <TopologyValidationWidget
        {...defaultProps}
        open={true}
        graphIssues={graphIssues}
        onJumpToWire={onJumpToWire}
      />,
    );
    const selectBtn = document.querySelector('.topology-validation-item-select');
    fireEvent.click(selectBtn!);
    expect(onJumpToWire).toHaveBeenCalledWith('w1');
  });

  it('static graph issues (no wireId) are not clickable', async () => {
    const graphIssues: TopologyValidationError[] = [{ code: 'missing-branch-location', messageId: 'static-msg' }];
    await renderWithFluent(
      <TopologyValidationWidget {...defaultProps} open={true} graphIssues={graphIssues} />,
    );
    const staticItem = document.querySelector('.topology-validation-item-static');
    expect(staticItem).toBeInTheDocument();
    // No select button in static items
    const selectBtns = staticItem!.querySelectorAll('.topology-validation-item-select');
    expect(selectBtns.length).toBe(0);
  });

  it('graph issue dismiss calls onDismissGraphIssue', async () => {
    const onDismissGraphIssue = vi.fn();
    const graphIssues = [makeGraphIssue({ messageId: 'g-msg' })];
    await renderWithFluent(
      <TopologyValidationWidget
        {...defaultProps}
        open={true}
        graphIssues={graphIssues}
        onDismissGraphIssue={onDismissGraphIssue}
      />,
    );
    const dismissBtn = document.querySelector('.topology-validation-item-dismiss');
    fireEvent.click(dismissBtn!);
    expect(onDismissGraphIssue).toHaveBeenCalledWith('g-msg');
  });

  // ── Empty state ──────────────────────────────────────────────

  it('empty panel when no issues', async () => {
    await renderWithFluent(
      <TopologyValidationWidget
        {...defaultProps}
        open={true}
        nodeIssues={[]}
        graphIssues={[]}
      />,
    );
    const panel = screen.getByRole('dialog');
    expect(panel.children.length).toBe(0);
  });

  // ── Multiple issues ──────────────────────────────────────────

  it('renders multiple node issues', async () => {
    const nodeIssues = [
      makeNodeIssue({ nodeId: 'n1', nodeName: 'Node A' }),
      makeNodeIssue({ nodeId: 'n2', nodeName: 'Node B' }),
    ];
    await renderWithFluent(
      <TopologyValidationWidget {...defaultProps} open={true} nodeIssues={nodeIssues} />,
    );
    expect(screen.getByText('Node A')).toBeInTheDocument();
    expect(screen.getByText('Node B')).toBeInTheDocument();
  });
});

// ── Indonesian locale ─────────────────────────────────────────────

describe('TopologyValidationWidget — ID', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders button in Indonesian', async () => {
    await renderInAct(
      withFluentLocale(
        'id',
        <TopologyValidationWidget {...defaultProps} totalIssues={2} />,
        multiStoreIdFtl,
      ),
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
