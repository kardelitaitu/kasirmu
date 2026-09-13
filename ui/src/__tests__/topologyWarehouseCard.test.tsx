import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/locales/test-utils';
import { WarehouseSettingsCard } from '@/features/locations/topologyWarehouseCard';
import type { TopologyNodeData } from '@/features/locations/NodeTopologyEditor';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import multiStoreIdFtl from '@/locales/multi-location.id.ftl?raw';

// ── Mock data ─────────────────────────────────────────────────────

function makeWarehouseNode(overrides: Partial<TopologyNodeData> = {}): TopologyNodeData {
  return {
    id: 'wh-1',
    type: 'warehouse',
    name: 'Main Warehouse',
    subtitle: 'Stock Room',
    x: 100,
    y: 200,
    metadata: {
      capacity: 500,
      lowStockThreshold: 50,
      stock: 120,
    },
    ...overrides,
  };
}

// ── Test utilities ────────────────────────────────────────────────

async function renderWithFluent(ui: React.ReactElement) {
  return renderInAct(withFluent(ui, multiStoreFtl));
}

const defaultProps = {
  node: makeWarehouseNode(),
  onChange: vi.fn(),
};

// ── EN locale tests ───────────────────────────────────────────────

describe('WarehouseSettingsCard — EN', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ────────────────────────────────────────────────

  it('renders the warehouse inspector section', async () => {
    await renderWithFluent(<WarehouseSettingsCard {...defaultProps} />);
    expect(screen.getByTestId('warehouse-inspector')).toBeInTheDocument();
  });

  it('renders title', async () => {
    await renderWithFluent(<WarehouseSettingsCard {...defaultProps} />);
    expect(screen.getByText(/warehouse settings/i)).toBeInTheDocument();
  });

  it('renders capacity label', async () => {
    await renderWithFluent(<WarehouseSettingsCard {...defaultProps} />);
    expect(screen.getByText(/capacity/i)).toBeInTheDocument();
  });

  it('renders low-stock threshold label', async () => {
    await renderWithFluent(<WarehouseSettingsCard {...defaultProps} />);
    expect(screen.getByText(/low-stock/i)).toBeInTheDocument();
  });

  it('renders current stock label', async () => {
    await renderWithFluent(<WarehouseSettingsCard {...defaultProps} />);
    expect(screen.getByText(/current stock/i)).toBeInTheDocument();
  });

  // ── Input values ─────────────────────────────────────────────

  it('capacity input shows node value', async () => {
    await renderWithFluent(<WarehouseSettingsCard {...defaultProps} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(500);
  });

  it('low-stock input shows node value', async () => {
    await renderWithFluent(<WarehouseSettingsCard {...defaultProps} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[1]).toHaveValue(50);
  });

  it('stock input shows node value', async () => {
    await renderWithFluent(<WarehouseSettingsCard {...defaultProps} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[2]).toHaveValue(120);
  });

  // ── onChange callbacks ────────────────────────────────────────

  it('capacity change calls onChange with number', async () => {
    const onChange = vi.fn();
    await renderWithFluent(<WarehouseSettingsCard {...defaultProps} onChange={onChange} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0]!, { target: { value: '600' } });
    expect(onChange).toHaveBeenCalledWith('wh-1', { capacity: 600 });
  });

  it('low-stock change calls onChange', async () => {
    const onChange = vi.fn();
    await renderWithFluent(<WarehouseSettingsCard {...defaultProps} onChange={onChange} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[1]!, { target: { value: '75' } });
    expect(onChange).toHaveBeenCalledWith('wh-1', { lowStockThreshold: 75 });
  });

  it('stock change calls onChange', async () => {
    const onChange = vi.fn();
    await renderWithFluent(<WarehouseSettingsCard {...defaultProps} onChange={onChange} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[2]!, { target: { value: '200' } });
    expect(onChange).toHaveBeenCalledWith('wh-1', { stock: 200 });
  });

  it('empty input calls onChange with 0', async () => {
    const onChange = vi.fn();
    await renderWithFluent(<WarehouseSettingsCard {...defaultProps} onChange={onChange} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0]!, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('wh-1', { capacity: 0 });
  });

  // ── Missing metadata ─────────────────────────────────────────

  it('empty inputs when metadata has no values', async () => {
    const node = makeWarehouseNode({ metadata: {} });
    await renderWithFluent(<WarehouseSettingsCard {...defaultProps} node={node} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(null);
    expect(inputs[1]).toHaveValue(null);
    expect(inputs[2]).toHaveValue(null);
  });

  // ── Capacity locked (non-Pro tier) ──────────────────────────

  it('capacity locked shows lock badge', async () => {
    await renderWithFluent(
      <WarehouseSettingsCard {...defaultProps} capacityLocked={true} />,
    );
    expect(screen.getAllByText(/pro/i).length).toBeGreaterThanOrEqual(2);
  });

  it('capacity locked disables capacity input', async () => {
    await renderWithFluent(
      <WarehouseSettingsCard {...defaultProps} capacityLocked={true} />,
    );
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toBeDisabled();
  });

  it('capacity locked disables low-stock input', async () => {
    await renderWithFluent(
      <WarehouseSettingsCard {...defaultProps} capacityLocked={true} />,
    );
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[1]).toBeDisabled();
  });

  it('stock input is always editable (not locked)', async () => {
    await renderWithFluent(
      <WarehouseSettingsCard {...defaultProps} capacityLocked={true} />,
    );
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[2]).not.toBeDisabled();
  });

  it('capacity locked shows upgrade hint', async () => {
    await renderWithFluent(
      <WarehouseSettingsCard {...defaultProps} capacityLocked={true} />,
    );
    expect(screen.getAllByText(/upgrade/i).length).toBeGreaterThanOrEqual(2);
  });

  // ── No lock badge when unlocked ──────────────────────────────

  it('no lock badge when capacity not locked', async () => {
    await renderWithFluent(
      <WarehouseSettingsCard {...defaultProps} capacityLocked={false} />,
    );
    expect(screen.queryByText(/pro/i)).not.toBeInTheDocument();
  });
});

// ── Indonesian locale ─────────────────────────────────────────────

describe('WarehouseSettingsCard — ID', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title in Indonesian', async () => {
    await renderInAct(
      withFluentLocale(
        'id',
        <WarehouseSettingsCard {...defaultProps} />,
        multiStoreIdFtl,
      ),
    );
    expect(screen.getByTestId('warehouse-inspector')).toBeInTheDocument();
  });

  it('renders labels in Indonesian', async () => {
    await renderInAct(
      withFluentLocale(
        'id',
        <WarehouseSettingsCard {...defaultProps} />,
        multiStoreIdFtl,
      ),
    );
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(3);
  });
});
