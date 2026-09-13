// StationSelectorModal + kdsStationPrefs tests — todo-kds-agents-3, M3.
//
// The modal is presentational (props in, callbacks out), so it renders with
// the sync Fluent helper; only the focus-trap effect runs on mount and it is
// synchronous (element.focus(), no promises).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { StationSelectorModal } from '@/features/kds/components/StationSelectorModal';
import {
  readExpoStation,
  writeExpoStation,
  KDS_EXPO_STATION_KEY_PREFIX,
} from '@/features/kds/kdsStationPrefs';
import kdsFtl from '@/locales/kds.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import type { StationOption } from '@/features/kds/components/StationSelectorModal';

const options: StationOption[] = [
  { zone: 'grill', tickets: 2 },
  { zone: 'fry', tickets: 1 },
];

function renderModal(overrides: Partial<React.ComponentProps<typeof StationSelectorModal>> = {}) {
  const props = {
    isOpen: true,
    options,
    selected: '',
    onSelect: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  renderWithFluentSync(<StationSelectorModal {...props} />, sharedFtl, kdsFtl);
  return props;
}

beforeEach(() => {
  localStorage.clear();
});

describe('StationSelectorModal', () => {
  it('renders nothing while closed', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByTestId('kds-station-dialog')).toBeNull();
  });

  it('presents an All row plus one radio per station, in order', () => {
    renderModal();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(screen.getByTestId('kds-station-option-all')).toBeInTheDocument();
    expect(screen.getByTestId('kds-station-option-grill')).toBeInTheDocument();
    expect(screen.getByTestId('kds-station-option-fry')).toBeInTheDocument();
  });

  it('marks the current selection and keeps a single roving tab stop', () => {
    renderModal({ selected: 'grill' });
    expect(screen.getByTestId('kds-station-option-grill')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('kds-station-option-all')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
    expect(screen.getByTestId('kds-station-option-grill')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('kds-station-option-fry')).toHaveAttribute('tabindex', '-1');
  });

  it('shows the per-station active ticket count', () => {
    renderModal();
    expect(screen.getByTestId('kds-station-option-grill')).toHaveTextContent('2 orders');
    expect(screen.getByTestId('kds-station-option-fry')).toHaveTextContent('1 order');
  });

  it('selecting a station calls onSelect then onClose', () => {
    const props = renderModal();
    fireEvent.click(screen.getByTestId('kds-station-option-grill'));
    expect(props.onSelect).toHaveBeenCalledWith('grill');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('the All row selects the empty sentinel', () => {
    const props = renderModal({ selected: 'grill' });
    fireEvent.click(screen.getByTestId('kds-station-option-all'));
    expect(props.onSelect).toHaveBeenCalledWith('');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel closes without changing the selection', () => {
    const props = renderModal();
    fireEvent.click(screen.getByTestId('kds-station-close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('Escape closes the dialog (focus-trap contract)', () => {
    const props = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('ArrowDown moves focus through the radio group', () => {
    renderModal();
    const all = screen.getByTestId('kds-station-option-all');
    all.focus();
    // The roving handler lives on the radio buttons themselves (jsx-a11y:
    // keyboard listeners belong on interactive elements, not the dialog).
    fireEvent.keyDown(all, { key: 'ArrowDown' });
    expect(screen.getByTestId('kds-station-option-grill')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('kds-station-option-grill'), { key: 'ArrowUp' });
    expect(all).toHaveFocus();
  });

  it('announces each row for assistive tech with its station name', () => {
    renderModal();
    expect(screen.getByTestId('kds-station-option-grill')).toHaveAccessibleName(
      'Show only tickets from station grill',
    );
    expect(screen.getByTestId('kds-station-option-all')).toHaveAccessibleName(
      'Show tickets from all stations',
    );
  });

  it('shows the empty-board hint but keeps All selectable when there are no stations', () => {
    const props = renderModal({ options: [] });
    expect(screen.getByText('No stations on the board yet')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('kds-station-option-all'));
    expect(props.onSelect).toHaveBeenCalledWith('');
  });

  it('is a labelled modal dialog', () => {
    renderModal();
    const dialog = screen.getByTestId('kds-station-dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Choose station');
  });
});

describe('kdsStationPrefs', () => {
  it('defaults to the all-stations sentinel', () => {
    expect(readExpoStation('user-1')).toBe('');
  });

  it('round-trips a selection through the prefixed key', () => {
    writeExpoStation('user-1', 'grill');
    expect(readExpoStation('user-1')).toBe('grill');
    expect(localStorage.getItem(`${KDS_EXPO_STATION_KEY_PREFIX}user-1`)).toBe('grill');
  });

  it('is per-user (a shared terminal keeps separate selections)', () => {
    writeExpoStation('user-1', 'grill');
    expect(readExpoStation('user-2')).toBe('');
  });

  it('writing the empty string clears back to all stations', () => {
    writeExpoStation('user-1', 'fry');
    writeExpoStation('user-1', '');
    expect(readExpoStation('user-1')).toBe('');
  });

  it('ignores reads/writes for an empty user id (unauthenticated)', () => {
    writeExpoStation('', 'grill');
    expect(readExpoStation('')).toBe('');
  });
});
