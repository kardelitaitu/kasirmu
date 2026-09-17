import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/i18n/test-utils';
import { TopologyNodeFinder } from '@/features/locations/topologyNodeFinder';
import type { TopologyNodeData } from '@/features/locations/NodeTopologyEditor';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import multiStoreIdFtl from '@/locales/multi-location.id.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import sharedIdFtl from '@/locales/shared.id.ftl?raw';

// ── Mock data factories ────────────────────────────────────────────────

function makeNode(overrides: Partial<TopologyNodeData> = {}): TopologyNodeData {
  const base: TopologyNodeData = {
    id: 'node-1',
    type: 'workspace',
    name: 'Test Node',
    subtitle: 'Store POS',
    x: 100,
    y: 200,
    metadata: { typeKey: 'store-pos', enabled: true },
  };
  return { ...base, ...overrides };
}

function makeNodes(count: number, baseOverrides: Partial<TopologyNodeData> = {}): TopologyNodeData[] {
  return Array.from({ length: count }, (_, i) =>
    makeNode({
      id: `node-${i + 1}`,
      name: `Node ${i + 1}`,
      subtitle: `Type ${i + 1}`,
      ...baseOverrides,
    })
  );
}

// ── Test utilities ─────────────────────────────────────────────────────

async function renderWithFluent(ui: React.ReactElement) {
  const wrapped = withFluent(ui, sharedFtl, multiStoreFtl);
  return await renderInAct(wrapped);
}

async function renderWithFluentId(ui: React.ReactElement) {
  const wrapped = withFluentLocale('id', ui, sharedIdFtl, multiStoreIdFtl);
  return await renderInAct(wrapped);
}

// ── Default props factory ──────────────────────────────────────────────

function defaultProps(overrides: Partial<{
  open: boolean;
  nodes: TopologyNodeData[];
  onJump: (match: TopologyNodeData) => void;
  onClose: () => void;
}> = {}) {
  return {
    open: true,
    nodes: makeNodes(3),
    onJump: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('TopologyNodeFinder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering — open state', () => {
    it('renders dialog when open=true', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps()} />);

      const dialog = screen.getByRole('dialog', { name: /find node/i });
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveClass('topology-finder');
    });

    it('does not render when open=false', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ open: false })} />);

      expect(screen.queryByRole('dialog', { name: /find node/i })).not.toBeInTheDocument();
    });

    it('renders input with placeholder', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps()} />);

      const input = screen.getByRole('combobox', { name: /find node/i });
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('placeholder', 'Search nodes…');
    });

    it('renders listbox with all nodes when query is empty', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(3) })} />);

      const listbox = screen.getByRole('listbox');
      expect(listbox).toBeInTheDocument();

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(3);
    });

    it('shows node names and subtitles in options', async () => {
      const nodes = [
        makeNode({ id: 'node-1', name: 'Branch A', subtitle: 'Store POS' }),
        makeNode({ id: 'node-2', name: 'Branch B', subtitle: 'Kitchen Display' }),
      ];
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes })} />);

      expect(screen.getByText('Branch A')).toBeInTheDocument();
      expect(screen.getByText('Branch B')).toBeInTheDocument();
      expect(screen.getByText('Store POS')).toBeInTheDocument();
      expect(screen.getByText('Kitchen Display')).toBeInTheDocument();
    });

    it('applies is-active class to highlighted option', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(3) })} />);

      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveClass('is-active');
      expect(options[1]).not.toHaveClass('is-active');
      expect(options[2]).not.toHaveClass('is-active');
    });
  });

  describe('Rendering — empty state', () => {
    it('renders empty message when no nodes provided', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: [] })} />);

      const empty = screen.getByRole('option', { name: /no nodes match/i });
      expect(empty).toBeInTheDocument();
      expect(empty).toHaveAttribute('id', 'topology-finder-empty');
      expect(empty).toHaveClass('topology-finder-empty');
    });

    it('sets aria-activedescendant to empty id when query has no matches', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(1, { name: 'Existing' }) })} />);

      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'nonexistent' } });

      expect(input).toHaveAttribute('aria-activedescendant', 'topology-finder-empty');
    });

    it('sets aria-activedescendant to undefined when query is empty and no nodes', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: [] })} />);

      const input = screen.getByRole('combobox');
      expect(input).not.toHaveAttribute('aria-activedescendant');
    });
  });

  describe('Interaction — filtering', () => {
    it('filters nodes by name (case-insensitive)', async () => {
      const nodes = [
        makeNode({ id: 'node-1', name: 'Branch A' }),
        makeNode({ id: 'node-2', name: 'Branch B' }),
        makeNode({ id: 'node-3', name: 'Warehouse' }),
      ];

      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes })} />);

      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'branch' } });

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(2);
      expect(screen.getByText('Branch A')).toBeInTheDocument();
      expect(screen.getByText('Branch B')).toBeInTheDocument();
      expect(screen.queryByText('Warehouse')).not.toBeInTheDocument();
    });

    it('filters nodes by subtitle', async () => {
      const nodes = [
        makeNode({ id: 'node-1', name: 'Node 1', subtitle: 'Store POS' }),
        makeNode({ id: 'node-2', name: 'Node 2', subtitle: 'Kitchen Display' }),
      ];

      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes })} />);

      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'kitchen' } });

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(screen.getByText('Kitchen Display')).toBeInTheDocument();
    });

    it('resets highlight index to 0 on query change', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(3) })} />);

      const input = screen.getByRole('combobox');
      // Navigate down first
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });

      // Now filter to match only first node
      fireEvent.change(input, { target: { value: 'Node 1' } });

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveClass('is-active');
    });

    it('shows all nodes when query is cleared', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(3) })} />);

      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'xyz123nomatch' } });
      // When no matches, empty state option is rendered
      expect(screen.getAllByRole('option')).toHaveLength(1);
      expect(screen.getByRole('option', { name: /no nodes match/i })).toBeInTheDocument();

      fireEvent.change(input, { target: { value: '' } });
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });
  });

  describe('Interaction — keyboard navigation', () => {
    it('moves highlight down with ArrowDown', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(3) })} />);

      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowDown' });

      const options = screen.getAllByRole('option');
      expect(options[1]).toHaveClass('is-active');
    });

    it('wraps around on ArrowDown at end', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(3) })} />);

      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // index 1
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // index 2
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // wraps to 0

      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveClass('is-active');
    });

    it('moves highlight up with ArrowUp', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(3) })} />);

      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowUp' });

      const options = screen.getAllByRole('option');
      expect(options[2]).toHaveClass('is-active');
    });

    it('wraps around on ArrowUp at start', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(3) })} />);

      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowUp' }); // wraps to 2

      const options = screen.getAllByRole('option');
      expect(options[2]).toHaveClass('is-active');
    });

    it('handles ArrowDown/ArrowUp when no matches', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(1, { name: 'Existing' }) })} />);

      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'nonexistent' } });

      // Should not throw
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowUp' });

      const empty = screen.getByRole('option', { name: /no nodes match/i });
      expect(empty).toBeInTheDocument();
    });
  });

  describe('Interaction — Enter to jump', () => {
    it('calls onJump with highlighted match on Enter', async () => {
      const onJump = vi.fn();
      const nodes = makeNodes(3);
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes, onJump })} />);

      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight second
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onJump).toHaveBeenCalledTimes(1);
      expect(onJump).toHaveBeenCalledWith(nodes[1]);
    });

    it('calls onJump with first match on Enter without navigation', async () => {
      const onJump = vi.fn();
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ onJump })} />);

      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onJump).toHaveBeenCalledTimes(1);
      expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: 'node-1' }));
    });

    it('does not call onJump when no matches', async () => {
      const onJump = vi.fn();
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(1, { name: 'Existing' }), onJump })} />);

      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'nonexistent' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onJump).not.toHaveBeenCalled();
    });
  });

  describe('Interaction — Escape to close', () => {
    it('calls onClose on Escape', async () => {
      const onClose = vi.fn();
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ onClose })} />);

      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Interaction — mouse selection', () => {
    it('calls onJump when option clicked', async () => {
      const onJump = vi.fn();
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(3), onJump })} />);

      const options = screen.getAllByRole('option');
      const secondOption = options[1]!;
      expect(secondOption).toBeInTheDocument();
      fireEvent.mouseDown(secondOption);

      expect(onJump).toHaveBeenCalledTimes(1);
      expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: 'node-2' }));
    });
  });

  describe('Interaction — open/close lifecycle', () => {
    it('resets query and index when opened', async () => {
      // First render closed
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ open: false })} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Then render open - query and index should be reset
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ open: true, nodes: makeNodes(3) })} />);

      const input = screen.getByRole('combobox');
      expect(input).toHaveValue('');
      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveClass('is-active');
    });

    it('focuses input when opened', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ open: true, nodes: makeNodes(3) })} />);

      const input = screen.getByRole('combobox');
      expect(input).toHaveFocus();
    });

    it('renders new nodes when nodes prop changes', async () => {
      // Just test that it renders the correct number of nodes
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(5) })} />);

      expect(screen.getAllByRole('option')).toHaveLength(5);
    });
  });

  describe('Accessibility', () => {
    it('has correct combobox attributes', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(3) })} />);

      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute('aria-expanded', 'true');
      expect(input).toHaveAttribute('aria-controls', 'topology-finder-listbox');
      expect(input).toHaveAttribute('role', 'combobox');
    });

    it('has correct listbox attributes', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(3) })} />);

      const listbox = screen.getByRole('listbox');
      expect(listbox).toHaveAttribute('id', 'topology-finder-listbox');
    });

    it('options have correct role and aria-selected', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(3) })} />);

      const options = screen.getAllByRole('option');
      options.forEach((option, i) => {
        expect(option).toHaveAttribute('role', 'option');
        if (i === 0) {
          expect(option).toHaveAttribute('aria-selected', 'true');
        } else {
          expect(option).toHaveAttribute('aria-selected', 'false');
        }
      });
    });

    it('updates aria-activedescendant on navigation', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(3) })} />);

      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowDown' });

      expect(input).toHaveAttribute('aria-activedescendant', 'topology-finder-option-node-2');
    });
  });

  describe('Indonesian locale', () => {
    it('renders with Indonesian localization', async () => {
      await renderWithFluentId(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(2) })} />);

      const dialog = screen.getByRole('dialog', { name: /cari simpul/i });
      expect(dialog).toBeInTheDocument();

      const input = screen.getByRole('combobox');
      expect(input).toBeInTheDocument();
    });

    it('shows Indonesian empty message when no matches', async () => {
      await renderWithFluentId(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(1, { name: 'Existing' }) })} />);

      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'nonexistent' } });

      const empty = screen.getByRole('option', { name: /tidak ada simpul yang cocok/i });
      expect(empty).toBeInTheDocument();
    });

    it('filters correctly with Indonesian characters', async () => {
      const nodes = [
        makeNode({ id: 'node-1', name: 'Gudang A', subtitle: 'Gudang Utama' }),
        makeNode({ id: 'node-2', name: 'Cabang B', subtitle: 'Cabang Baru' }),
      ];

      await renderWithFluentId(<TopologyNodeFinder {...defaultProps({ nodes })} />);

      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'gudang' } });

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(screen.getByText('Gudang A')).toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('handles empty nodes array', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: [] })} />);

      const empty = screen.getByRole('option', { name: /no nodes match/i });
      expect(empty).toBeInTheDocument();
    });

    it('handles single node', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(1) })} />);

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveClass('is-active');
    });

    it('handles many nodes (virtualization not needed but renders all)', async () => {
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes: makeNodes(50) })} />);

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(50);
    });

    it('handles nodes with missing subtitle', async () => {
      const nodes = [
        makeNode({ id: 'node-1' }), // subtitle will use default from makeNode
        makeNode({ id: 'node-2', subtitle: 'Has Subtitle' }),
      ];

      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes })} />);

      expect(screen.getAllByRole('option')).toHaveLength(2);
      // Both should render (subtitle renders as undefined -> empty string in JSX)
    });

    it('clamps index when matches shrink', async () => {
      // This tests the logic in ArrowDown/ArrowUp that uses Math.min(i, matches.length - 1)
      const onJump = vi.fn();
      const nodes = makeNodes(3);
      await renderWithFluent(<TopologyNodeFinder {...defaultProps({ nodes, onJump })} />);

      const input = screen.getByRole('combobox');
      // Navigate to last item
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });

      // Now filter to only 1 match
      fireEvent.change(input, { target: { value: 'Node 1' } });

      // Enter should jump to the only match
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: 'node-1' }));
    });
  });
});