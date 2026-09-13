import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/locales/test-utils';
import { TopologyWireGroup } from '@/features/locations/topologyWireGroup';
import type { TopologyWireData } from '@/features/locations/NodeTopologyEditor';
import type { TopologyValidationError } from '@/features/locations/topologyContract';
import type { ReactLocalization } from '@fluent/react';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import multiStoreIdFtl from '@/locales/multi-location.id.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import sharedIdFtl from '@/locales/shared.id.ftl?raw';

// ── Mock data factories ────────────────────────────────────────────────

function makeWire(overrides: Partial<TopologyWireData> = {}): TopologyWireData {
  return {
    id: 'wire-1',
    fromNodeId: 'node-1',
    toNodeId: 'node-2',
    direction: 'one-way',
    label: 'Test Wire',
    fromPort: 'right',
    toPort: 'left',
    bends: [] as Array<{ x: number; y: number }>,
    fromPortId: 'operation-out',
    toPortId: 'operation-in',
    relationshipType: 'generic',
    ...overrides,
  };
}

function makeError(overrides: Partial<TopologyValidationError> = {}): TopologyValidationError {
  return {
    code: 'warehouse-at-capacity',
    messageId: 'topology-validation-warehouse-at-capacity',
    ...overrides,
  };
}

// ── Test utilities ─────────────────────────────────────────────────────

async function renderWithFluent(ui: React.ReactElement) {
  const wrapped = withFluent(ui, sharedFtl, multiStoreFtl);
  await renderInAct(wrapped);
}

async function renderWithFluentId(ui: React.ReactElement) {
  const wrapped = withFluentLocale('id', ui, sharedIdFtl, multiStoreIdFtl);
  await renderInAct(wrapped);
}

// ── Default props factory ──────────────────────────────────────────────

function defaultProps(overrides: Partial<{
  wire: TopologyWireData;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  pathD: string;
  polyline: Array<[number, number]>;
  selected: boolean;
  dimmed: boolean;
  hovered: boolean;
  pulse: { x: number; y: number } | null;
  errors: TopologyValidationError[];
  onHoverWire: React.Dispatch<React.SetStateAction<string | null>>;
  onWireClick: (e: { stopPropagation(): void }, wireId: string) => void;
  onOpenWireMenu: (e: React.MouseEvent, wireId: string) => void;
  onStartGhostBend: (e: React.MouseEvent, wireId: string, segmentIndex: number, mx: number, my: number) => void;
  onStartBendDrag: (e: React.MouseEvent, wireId: string, index: number, bx: number, by: number) => void;
  onRemoveBend: (wireId: string, index: number) => void;
}> = {}) {
  const wire = makeWire();
  const polyline: Array<[number, number]> = [[100, 100], [300, 100]];
  const pathD = 'M100,100 C200,100 200,100 300,100';

  return {
    wire,
    x1: 100,
    y1: 100,
    x2: 300,
    y2: 100,
    dx: 200,
    pathD,
    polyline,
    selected: false,
    dimmed: false,
    hovered: false,
    pulse: null,
    errors: [],
    l10n: { getString: (id: string) => id } as Pick<ReactLocalization, 'getString'>,
    onHoverWire: vi.fn(),
    onWireClick: vi.fn(),
    onOpenWireMenu: vi.fn(),
    onStartGhostBend: vi.fn(),
    onStartBendDrag: vi.fn(),
    onRemoveBend: vi.fn(),
    ...overrides,
  };
}

// Helper to get the wire group container (the <g> element)
function getWireGroup() {
  return document.querySelector('.wire-group');
}

describe('TopologyWireGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering — basic wire', () => {
    it('renders SVG group with wire path and end dot', async () => {
      await renderWithFluent(<TopologyWireGroup {...defaultProps()} />);

      const group = getWireGroup();
      expect(group).toBeInTheDocument();

      // Wire hitbox path (role="button")
      const hitbox = screen.getByRole('button', { name: /topology-wire-toggle-aria/ });
      expect(hitbox).toBeInTheDocument();
      expect(hitbox).toHaveAttribute('data-wire-id', 'wire-1');
      expect(hitbox).toHaveAttribute('tabIndex', '0');

      // End dot - query by class (component only renders start dot)
      const endDots = group?.querySelectorAll('.wire-end-dot');
      expect(endDots).toHaveLength(1);
      expect(endDots?.[0]).toHaveAttribute('cx', '100');
      expect(endDots?.[0]).toHaveAttribute('cy', '100');

      // Styled wire path
      const wirePath = group?.querySelector('.wire-path');
      expect(wirePath).toBeInTheDocument();
      expect(wirePath).toHaveAttribute('data-direction', 'one-way');
    });

    it('renders with base wire-group class by default', async () => {
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ selected: false, dimmed: false, hovered: false })} />);
      const group = getWireGroup();
      expect(group).toHaveClass('wire-group');
      expect(group).not.toHaveClass('wire-selected');
      expect(group).not.toHaveClass('wire-dimmed');
    });

    it('adds wire-selected class when selected=true', async () => {
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ selected: true })} />);
      const group = getWireGroup();
      expect(group).toHaveClass('wire-selected');
    });

    it('adds wire-dimmed class when dimmed=true', async () => {
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ dimmed: true })} />);
      const group = getWireGroup();
      expect(group).toHaveClass('wire-dimmed');
    });

    it('does not add special class for hovered state', async () => {
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ hovered: true })} />);
      const group = getWireGroup();
      // Note: hovered state doesn't add a class to the group in current implementation
      expect(group).toHaveClass('wire-group');
    });
  });

  describe('Validation markers', () => {
    it('renders validation marker when errors array is not empty', async () => {
      const error = makeError();
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ errors: [error] })} />);

      const marker = document.querySelector('.wire-validation-marker');
      expect(marker).toBeInTheDocument();
      expect(marker).toHaveAttribute('role', 'button');
      expect(marker).toHaveAttribute('tabIndex', '0');
      expect(marker).toHaveAttribute('aria-label', 'topology-validation-warehouse-at-capacity');

      // Position at midpoint
      const circle = marker?.querySelector('circle');
      expect(circle).toHaveAttribute('cx', '200'); // (100 + 300) / 2
      expect(circle).toHaveAttribute('cy', '100');
    });

    it('does not render validation marker when errors array is empty', async () => {
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ errors: [] })} />);

      const marker = document.querySelector('.wire-validation-marker');
      expect(marker).not.toBeInTheDocument();
    });

    it('renders validation marker tooltip with error message', async () => {
      const error = makeError();
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ errors: [error] })} />);

      const marker = document.querySelector('.wire-validation-marker');
      const title = marker?.querySelector('title');
      expect(title).toHaveTextContent('topology-validation-warehouse-at-capacity');
    });
  });

  describe('Bend editing affordances', () => {
    it('renders ghost bend circles when hovered (and not selected)', async () => {
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ hovered: true, selected: false })} />);

      // Should render ghosts for the single segment (polyline has 2 points = 1 segment)
      const ghosts = document.querySelectorAll('.wire-bend-ghost');
      expect(ghosts).toHaveLength(1);
      expect(ghosts[0]).toHaveAttribute('data-wire-id', 'wire-1');
      expect(ghosts[0]).toHaveAttribute('data-segment-index', '0');
      expect(ghosts[0]).toHaveAttribute('cx', '200'); // midpoint of 100,100 and 300,100
      expect(ghosts[0]).toHaveAttribute('cy', '100');
      expect(ghosts[0]).toHaveAttribute('r', '5');
    });

    it('renders ghost bend circles when selected (and not hovered)', async () => {
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ selected: true, hovered: false })} />);

      const ghosts = document.querySelectorAll('.wire-bend-ghost');
      expect(ghosts).toHaveLength(1);
    });

    it('renders multiple ghosts for polyline with multiple segments', async () => {
      const multiSegmentPolyline: Array<[number, number]> = [[100, 100], [200, 100], [300, 100]];
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ hovered: true, polyline: multiSegmentPolyline })} />);

      const ghosts = document.querySelectorAll('.wire-bend-ghost');
      expect(ghosts).toHaveLength(2);
      expect(ghosts[0]).toHaveAttribute('data-segment-index', '0');
      expect(ghosts[1]).toHaveAttribute('data-segment-index', '1');
    });

    it('renders bend handles when selected and wire has bends', async () => {
      const wireWithBends = makeWire({
        bends: [{ x: 150, y: 120 }, { x: 250, y: 80 }],
      });
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ selected: true, wire: wireWithBends })} />);

      const handles = document.querySelectorAll('.wire-bend-handle');
      expect(handles).toHaveLength(2);
      expect(handles[0]).toHaveAttribute('data-bend-index', '0');
      expect(handles[0]).toHaveAttribute('cx', '150');
      expect(handles[0]).toHaveAttribute('cy', '120');
      expect(handles[1]).toHaveAttribute('data-bend-index', '1');
      expect(handles[1]).toHaveAttribute('cx', '250');
      expect(handles[1]).toHaveAttribute('cy', '80');
    });

    it('does not render bend handles when not selected', async () => {
      const wireWithBends = makeWire({
        bends: [{ x: 150, y: 120 }],
      });
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ selected: false, wire: wireWithBends })} />);

      const handles = document.querySelectorAll('.wire-bend-handle');
      expect(handles).toHaveLength(0);
    });

    it('does not render bend handles when wire has no bends', async () => {
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ selected: true, wire: makeWire({ bends: [] }) })} />);

      const handles = document.querySelectorAll('.wire-bend-handle');
      expect(handles).toHaveLength(0);
    });
  });

  describe('Interaction handlers', () => {
    it('calls onHoverWire on mouse enter/leave', async () => {
      const onHoverWire = vi.fn();
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ onHoverWire })} />);

      const group = getWireGroup();
      fireEvent.mouseEnter(group!);
      expect(onHoverWire).toHaveBeenCalledWith('wire-1');

      fireEvent.mouseLeave(group!);
      expect(onHoverWire).toHaveBeenCalledWith(expect.any(Function)); // cleanup function
    });

    it('calls onWireClick when hitbox is clicked', async () => {
      const onWireClick = vi.fn();
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ onWireClick })} />);

      const hitbox = screen.getByRole('button', { name: /topology-wire-toggle-aria/ });
      fireEvent.click(hitbox);
      expect(onWireClick).toHaveBeenCalledTimes(1);
    });

    it('calls onOpenWireMenu on context menu', async () => {
      const onOpenWireMenu = vi.fn();
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ onOpenWireMenu })} />);

      const hitbox = screen.getByRole('button', { name: /topology-wire-toggle-aria/ });
      fireEvent.contextMenu(hitbox);
      expect(onOpenWireMenu).toHaveBeenCalledTimes(1);
    });

    it('calls onWireClick on Enter/Space key press on hitbox', async () => {
      const onWireClick = vi.fn();
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ onWireClick })} />);

      const hitbox = screen.getByRole('button', { name: /topology-wire-toggle-aria/ });
      fireEvent.keyDown(hitbox, { key: 'Enter' });
      expect(onWireClick).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      fireEvent.keyDown(hitbox, { key: ' ' });
      expect(onWireClick).toHaveBeenCalledTimes(1);
    });

    it('calls onWireClick when validation marker is clicked', async () => {
      const onWireClick = vi.fn();
      const error = makeError();
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ onWireClick, errors: [error] })} />);

      const marker = document.querySelector('.wire-validation-marker');
      fireEvent.click(marker!);
      expect(onWireClick).toHaveBeenCalledTimes(1);
    });

    it('calls onWireClick on Enter/Space on validation marker', async () => {
      const onWireClick = vi.fn();
      const error = makeError();
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ onWireClick, errors: [error] })} />);

      const marker = document.querySelector('.wire-validation-marker');
      fireEvent.keyDown(marker!, { key: 'Enter' });
      expect(onWireClick).toHaveBeenCalledTimes(1);
    });

    it('calls onStartGhostBend on ghost mousedown', async () => {
      const onStartGhostBend = vi.fn();
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ hovered: true, onStartGhostBend })} />);

      const ghost = document.querySelector('.wire-bend-ghost');
      fireEvent.mouseDown(ghost!);
      expect(onStartGhostBend).toHaveBeenCalledWith(
        expect.any(Object),
        'wire-1',
        0,
        200,
        100
      );
    });

    it('calls onStartBendDrag on bend handle mousedown', async () => {
      const onStartBendDrag = vi.fn();
      const wireWithBends = makeWire({ bends: [{ x: 150, y: 120 }] });
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ selected: true, wire: wireWithBends, onStartBendDrag })} />);

      const handle = document.querySelector('.wire-bend-handle');
      fireEvent.mouseDown(handle!);
      expect(onStartBendDrag).toHaveBeenCalledWith(
        expect.any(Object),
        'wire-1',
        0,
        150,
        120
      );
    });

    it('calls onRemoveBend on bend handle double-click', async () => {
      const onRemoveBend = vi.fn();
      const wireWithBends = makeWire({ bends: [{ x: 150, y: 120 }] });
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ selected: true, wire: wireWithBends, onRemoveBend })} />);

      const handle = document.querySelector('.wire-bend-handle');
      fireEvent.dblClick(handle!);
      expect(onRemoveBend).toHaveBeenCalledWith('wire-1', 0);
    });
  });

  describe('Arrow markers based on direction', () => {
    it('renders one-way arrow (marker-end only)', async () => {
      const wire = makeWire({ direction: 'one-way' });
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ wire })} />);

      const group = getWireGroup();
      const wirePath = group?.querySelector('.wire-path');
      expect(wirePath).toHaveAttribute('marker-end', 'url(#arrow-end)');
      expect(wirePath).not.toHaveAttribute('marker-start');
    });

    it('renders reverse arrow (marker-start only)', async () => {
      const wire = makeWire({ direction: 'reverse' });
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ wire })} />);

      const group = getWireGroup();
      const wirePath = group?.querySelector('.wire-path');
      expect(wirePath).toHaveAttribute('marker-start', 'url(#arrow-start)');
      expect(wirePath).not.toHaveAttribute('marker-end');
    });

    it('renders two-way arrows (both marker-start and marker-end)', async () => {
      const wire = makeWire({ direction: 'two-way' });
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ wire })} />);

      const group = getWireGroup();
      const wirePath = group?.querySelector('.wire-path');
      expect(wirePath).toHaveAttribute('marker-start', 'url(#arrow-start)');
      expect(wirePath).toHaveAttribute('marker-end', 'url(#arrow-end)');
    });
  });

  describe('Wire tooltip', () => {
    it('renders tooltip with wire label and hint', async () => {
      await renderWithFluent(<TopologyWireGroup {...defaultProps()} />);

      const hitbox = screen.getByRole('button', { name: /topology-wire-toggle-aria/ });
      const title = hitbox.querySelector('title');
      expect(title).toHaveTextContent('Test Wire — topology-wire-toggle-hint');
    });

    it('renders tooltip without label when wire has no label', async () => {
      const wire = makeWire({ label: '' });
      await renderWithFluent(<TopologyWireGroup {...defaultProps({ wire })} />);

      const hitbox = screen.getByRole('button', { name: /topology-wire-toggle-aria/ });
      const title = hitbox.querySelector('title');
      expect(title).toHaveTextContent('topology-wire-toggle-hint');
    });
  });

  describe('Indonesian locale', () => {
    it('renders with Indonesian localization', async () => {
      await renderWithFluentId(<TopologyWireGroup {...defaultProps()} />);

      const hitbox = screen.getByRole('button', { name: /topology-wire-toggle-aria/ });
      expect(hitbox).toBeInTheDocument();
    });
  });
});