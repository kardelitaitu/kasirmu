import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  StoreIcon,
  PosIcon,
  WarehouseIcon,
  PrinterIcon,
  FlaskIcon,
  StopIcon,
  CartIcon,
  UtensilsIcon,
  CheckIcon,
  TrashIcon,
  CloseIcon,
  LockIcon,
  NodesIcon,
  PlusIcon,
  MinusIcon,
  WarningIcon,
} from '@/features/locations/NodeTopologyIcons';

// ── All icons render SVG ──────────────────────────────────────────

describe('NodeTopologyIcons', () => {
  const icons = [
    { Component: StoreIcon, name: 'StoreIcon' },
    { Component: PosIcon, name: 'PosIcon' },
    { Component: WarehouseIcon, name: 'WarehouseIcon' },
    { Component: PrinterIcon, name: 'PrinterIcon' },
    { Component: FlaskIcon, name: 'FlaskIcon' },
    { Component: StopIcon, name: 'StopIcon' },
    { Component: CartIcon, name: 'CartIcon' },
    { Component: UtensilsIcon, name: 'UtensilsIcon' },
    { Component: CheckIcon, name: 'CheckIcon' },
    { Component: TrashIcon, name: 'TrashIcon' },
    { Component: CloseIcon, name: 'CloseIcon' },
    { Component: LockIcon, name: 'LockIcon' },
    { Component: NodesIcon, name: 'NodesIcon' },
    { Component: PlusIcon, name: 'PlusIcon' },
    { Component: MinusIcon, name: 'MinusIcon' },
    { Component: WarningIcon, name: 'WarningIcon' },
  ];

  it.each(icons)('$name renders an SVG element', ({ Component }) => {
    const { container } = render(<Component />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it.each(icons)('$name has viewBox="0 0 24 24"', ({ Component }) => {
    const { container } = render(<Component />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it.each(icons)('$name has aria-hidden="true"', ({ Component }) => {
    const { container } = render(<Component />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it.each(icons)('$name defaults to size 20', ({ Component }) => {
    const { container } = render(<Component />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
  });

  // ── Custom size ──────────────────────────────────────────────

  it('StoreIcon respects custom size', () => {
    const { container } = render(<StoreIcon size={32} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
  });

  it('WarningIcon respects custom size', () => {
    const { container } = render(<WarningIcon size={14} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '14');
    expect(svg).toHaveAttribute('height', '14');
  });

  // ── SVG attributes ───────────────────────────────────────────

  it.each(icons)('$name has stroke="currentColor"', ({ Component }) => {
    const { container } = render(<Component />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
  });

  it.each(icons)('$name has fill="none"', ({ Component }) => {
    const { container } = render(<Component />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('fill', 'none');
  });

  it.each(icons)('$name has strokeWidth="2"', ({ Component }) => {
    const { container } = render(<Component />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('stroke-width', '2');
  });

  // ── Pass-through props ───────────────────────────────────────

  it('StoreIcon passes className', () => {
    const { container } = render(<StoreIcon className="my-icon" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('my-icon');
  });

  it('WarningIcon passes data-testid', () => {
    const { container } = render(<WarningIcon data-testid="warn" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('data-testid', 'warn');
  });
});
