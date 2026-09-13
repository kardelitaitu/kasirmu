// ── KdsRoutingRulesEditor — routing-rules editor over the shipped IPC ──
//
// The mock seam is `@/utils/logged-invoke` — the single Tauri boundary — so
// the real `@/api/kds` routing wrappers run end to end: a command rename or
// an args-shape drift breaks here, not only in dev-mock (which is deliberately
// NOT extended by this dispatch — see the stamp in todo-kds-agents-1.md).
// Rendered against the real `kds.ftl` bundle, so a label renamed without its
// key fails too.
//
// Coverage required by the work order: load-renders-rows, save-sends-
// whole-set-replace, [] clears with confirm, priority reorder produces a
// renumbered payload, and the error path shows a LOCALIZED banner with no
// raw backend text (ERR-10).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithFluent } from '@/__tests__/test-utils/render';
import kdsFtl from '@/locales/kds.ftl?raw';
import type { KdsRoutingRule, KdsRoutingRuleInput } from '@/api/kds';

import {
  KdsRoutingRulesEditor,
  KdsRoutingRulesSection,
} from '@/features/kds/components/KdsRoutingRulesEditor';
import {
  incompleteRowKeys,
  moveRow,
  newDraftRow,
  rowsFromPersisted,
  toSavePayload,
} from '@/features/kds/kdsRoutingRulesModel';

const SESSION_TOKEN = 'tok-routing';

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

// The section (not the editor core) wires the session token from the
// workspace context; same boundary stub shape as ExpoScreen.test.tsx.
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: SESSION_TOKEN }),
}));

function makeRule(
  id: string,
  priority: number,
  matcher: KdsRoutingRule['matcher'],
  matcher_value: string,
  target_station: string,
  is_active = true,
): KdsRoutingRule {
  return {
    id,
    restaurant_pos_id: 'resto-1',
    priority,
    matcher,
    matcher_value,
    target_station,
    is_active,
    created_at: '2026-09-13T05:00:00Z',
    updated_at: '2026-09-13T05:00:00Z',
  };
}

/** Default IPC: get resolves `getRules`; save echoes inputs back stamped
 *  with server ids in submitted order (the real contract). */
function stubIpc(getRules: KdsRoutingRule[] = []) {
  mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'get_kds_routing_rules_scoped') return Promise.resolve(getRules);
    if (cmd === 'save_kds_routing_rules_scoped') {
      const rules = (args?.['rules'] ?? []) as KdsRoutingRuleInput[];
      return Promise.resolve(
        rules.map((r, i) => ({
          id: `srv-${i + 1}`,
          restaurant_pos_id: 'resto-1',
          created_at: '2026-09-13T05:00:00Z',
          updated_at: '2026-09-13T05:00:00Z',
          ...r,
        })),
      );
    }
    return Promise.resolve(undefined);
  });
}

/** Calls to a command, as [cmd, args] pairs. */
function callsFor(cmd: string): Array<Record<string, unknown>> {
  return mockInvoke.mock.calls
    .filter((c) => c[0] === cmd)
    .map((c) => c[1] as Record<string, unknown>);
}

async function renderEditor() {
  await renderWithFluent(
    <KdsRoutingRulesEditor sessionToken={SESSION_TOKEN} />,
    kdsFtl,
  );
}

beforeEach(() => {
  mockInvoke.mockReset();
  stubIpc();
});

describe('KdsRoutingRulesEditor — load', () => {
  it('loads the scoped rule set on mount and renders one row per rule', async () => {
    stubIpc([
      makeRule('r-1', 1, 'sku', 'BURGER', 'grill'),
      makeRule('r-2', 2, 'category', 'cat-9', 'fry', false),
    ]);
    await renderEditor();

    expect(mockInvoke).toHaveBeenCalledWith('get_kds_routing_rules_scoped', {
      sessionToken: SESSION_TOKEN,
    });
    expect(await screen.findByDisplayValue('BURGER')).toBeInTheDocument();
    expect(screen.getByDisplayValue('grill')).toBeInTheDocument();
    expect(screen.getByDisplayValue('cat-9')).toBeInTheDocument();
    expect(screen.getByDisplayValue('fry')).toBeInTheDocument();
    // Position numbers mirror the priority rank.
    expect(screen.getByRole('cell', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument();
    // The inactive rule's switch is off.
    expect(screen.getByRole('switch', { name: 'Rule 2 active' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('shows an empty-state line when the restaurant has no rules', async () => {
    stubIpc([]);
    await renderEditor();
    expect(
      await screen.findByText(/No rules yet/i),
    ).toBeInTheDocument();
  });

  it('surfaces a localized load error with a retry that refetches', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_kds_routing_rules_scoped') {
        return Promise.reject(new Error('raw sqlite3_open failed — secret path /var/db/x'));
      }
      return Promise.resolve([]);
    });
    await renderEditor();

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/Could not load routing rules/i);
    expect(banner).not.toHaveTextContent(/sqlite/i); // ERR-10: no raw message

    stubIpc([makeRule('r-9', 1, 'sku', 'FRIES', 'fry')]);
    await userEvent.click(screen.getByTestId('kds-routing-retry'));
    expect(await screen.findByDisplayValue('FRIES')).toBeInTheDocument();
    expect(callsFor('get_kds_routing_rules_scoped')).toHaveLength(2);
  });
});

describe('KdsRoutingRulesEditor — save is a whole-set replace', () => {
  it('sends every row as one set with positional priorities, then confirms success', async () => {
    stubIpc([
      makeRule('r-1', 1, 'sku', 'BURGER', 'grill'),
      makeRule('r-2', 2, 'category', 'cat-9', 'fry'),
    ]);
    await renderEditor();
    await screen.findByDisplayValue('BURGER');

    await userEvent.click(screen.getByRole('button', { name: 'Save rules' }));

    await waitFor(() => expect(callsFor('save_kds_routing_rules_scoped')).toHaveLength(1));
    const call = callsFor('save_kds_routing_rules_scoped')[0]!;
    expect(Object.keys(call).sort()).toEqual(['rules', 'sessionToken']);
    expect(call['sessionToken']).toBe(SESSION_TOKEN);
    expect(call['rules']).toEqual([
      { priority: 1, matcher: 'sku', matcher_value: 'BURGER', target_station: 'grill', is_active: true },
      { priority: 2, matcher: 'category', matcher_value: 'cat-9', target_station: 'fry', is_active: true },
    ]);
    expect(await screen.findByRole('status')).toHaveTextContent(/Routing rules saved/i);
  });

  it('carries edited values and toggled active states into the payload', async () => {
    stubIpc([makeRule('r-1', 1, 'sku', 'BURGER', 'grill')]);
    await renderEditor();
    await screen.findByDisplayValue('BURGER');

    await userEvent.clear(screen.getByRole('textbox', { name: /Target station for rule 1/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /Target station for rule 1/i }), 'bar');
    await userEvent.click(screen.getByRole('switch', { name: 'Rule 1 active' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save rules' }));

    await waitFor(() => expect(callsFor('save_kds_routing_rules_scoped')).toHaveLength(1));
    const rules = callsFor('save_kds_routing_rules_scoped')[0]!['rules'];
    expect(rules).toEqual([
      { priority: 1, matcher: 'sku', matcher_value: 'BURGER', target_station: 'bar', is_active: false },
    ]);
  });

  it('reorders with the move buttons and renumbers priority in the payload', async () => {
    stubIpc([
      makeRule('r-1', 1, 'sku', 'BURGER', 'grill'),
      makeRule('r-2', 2, 'sku', 'FRIES', 'fry'),
      makeRule('r-3', 3, 'sku', 'NEEDLE', 'salad'),
    ]);
    await renderEditor();
    await screen.findByDisplayValue('BURGER');

    // Edges: first row cannot move up, last row cannot move down.
    expect(screen.getByRole('button', { name: 'Move rule 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move rule 3 down' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Move rule 3 up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save rules' }));

    await waitFor(() => expect(callsFor('save_kds_routing_rules_scoped')).toHaveLength(1));
    expect(callsFor('save_kds_routing_rules_scoped')[0]!['rules']).toEqual([
      { priority: 1, matcher: 'sku', matcher_value: 'BURGER', target_station: 'grill', is_active: true },
      { priority: 2, matcher: 'sku', matcher_value: 'NEEDLE', target_station: 'salad', is_active: true },
      { priority: 3, matcher: 'sku', matcher_value: 'FRIES', target_station: 'fry', is_active: true },
    ]);
  });

  it('rejects incomplete rows client-side before touching the wire', async () => {
    stubIpc([makeRule('r-1', 1, 'sku', 'BURGER', 'grill')]);
    await renderEditor();
    await screen.findByDisplayValue('BURGER');

    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save rules' }));

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent(/Every rule needs a match value and a target station/i);
    expect(callsFor('save_kds_routing_rules_scoped')).toHaveLength(0);
    expect(
      screen.getByRole('textbox', { name: /Match value for rule 2/i }),
    ).toHaveAttribute('aria-invalid', 'true');
  });

  it('removes a row locally and never re-sends it', async () => {
    stubIpc([
      makeRule('r-1', 1, 'sku', 'BURGER', 'grill'),
      makeRule('r-2', 2, 'sku', 'FRIES', 'fry'),
    ]);
    await renderEditor();
    await screen.findByDisplayValue('FRIES');

    await userEvent.click(screen.getByRole('button', { name: 'Remove rule 2' }));
    expect(screen.queryByDisplayValue('FRIES')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save rules' }));
    await waitFor(() => expect(callsFor('save_kds_routing_rules_scoped')).toHaveLength(1));
    expect(callsFor('save_kds_routing_rules_scoped')[0]!['rules']).toEqual([
      { priority: 1, matcher: 'sku', matcher_value: 'BURGER', target_station: 'grill', is_active: true },
    ]);
  });
});

describe('KdsRoutingRulesEditor — clear all', () => {
  it('asks for confirmation first, then saves the empty set which clears the scope', async () => {
    stubIpc([makeRule('r-1', 1, 'sku', 'BURGER', 'grill')]);
    await renderEditor();
    await screen.findByDisplayValue('BURGER');

    await userEvent.click(screen.getByRole('button', { name: 'Clear all rules' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/Clear all routing rules\?/i);
    expect(callsFor('save_kds_routing_rules_scoped')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(callsFor('save_kds_routing_rules_scoped')).toHaveLength(1));
    expect(callsFor('save_kds_routing_rules_scoped')[0]!['rules']).toEqual([]);
    expect(screen.queryByDisplayValue('BURGER')).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(/All routing rules cleared/i);
  });

  it('sends nothing when the confirm is declined', async () => {
    stubIpc([makeRule('r-1', 1, 'sku', 'BURGER', 'grill')]);
    await renderEditor();
    await screen.findByDisplayValue('BURGER');

    await userEvent.click(screen.getByRole('button', { name: 'Clear all rules' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Keep rules' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(callsFor('save_kds_routing_rules_scoped')).toHaveLength(0);
    expect(screen.getByDisplayValue('BURGER')).toBeInTheDocument();
  });
});

describe('KdsRoutingRulesEditor — failure path', () => {
  it('shows a localized banner (not the raw backend message) when save fails', async () => {
    stubIpc([makeRule('r-1', 1, 'sku', 'BURGER', 'grill')]);
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_kds_routing_rules_scoped') return Promise.resolve([makeRule('r-1', 1, 'sku', 'BURGER', 'grill')]);
      return Promise.reject(new Error('UNIQUE constraint failed: kds_routing_rules.id'));
    });
    await renderEditor();
    await screen.findByDisplayValue('BURGER');

    await userEvent.click(screen.getByRole('button', { name: 'Save rules' }));
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/Could not save routing rules/i);
    expect(banner).not.toHaveTextContent(/UNIQUE constraint/i);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('KdsRoutingRulesEditor — tag matcher honesty', () => {
  it('renders a not-yet-effective hint on a loaded tag rule', async () => {
    stubIpc([makeRule('r-t', 1, 'tag', 'spicy', 'grill')]);
    await renderEditor();
    await screen.findByDisplayValue('spicy');
    expect(
      screen.getByText(/Tags are not modeled in the catalog yet/i),
    ).toBeInTheDocument();
  });

  it('offers tag as an option and reveals the hint when chosen', async () => {
    stubIpc([makeRule('r-1', 1, 'sku', 'BURGER', 'grill')]);
    await renderEditor();
    const combo = await screen.findByRole('combobox', { name: /What rule 1 matches/i });
    expect(screen.getByRole('option', { name: 'Tag' })).toBeInTheDocument();
    expect(
      screen.queryByText(/Tags are not modeled in the catalog yet/i),
    ).not.toBeInTheDocument();

    await userEvent.selectOptions(combo, 'tag');
    expect(
      screen.getByText(/Tags are not modeled in the catalog yet/i),
    ).toBeInTheDocument();
  });
});

describe('KdsRoutingRulesSection — collapsible panel section', () => {
  it('starts collapsed without touching the wire, then loads through useWorkspace', async () => {
    stubIpc([makeRule('r-1', 1, 'sku', 'BURGER', 'grill')]);
    await renderWithFluent(<KdsRoutingRulesSection />, kdsFtl);

    expect(screen.queryByRole('button', { name: 'Save rules' })).not.toBeInTheDocument();
    expect(callsFor('get_kds_routing_rules_scoped')).toHaveLength(0);

    const toggle = screen.getByRole('button', { name: /routing rules editor/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);

    expect(await screen.findByDisplayValue('BURGER')).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith('get_kds_routing_rules_scoped', {
      sessionToken: SESSION_TOKEN,
    });
    expect(
      screen.getByRole('button', { name: /routing rules editor/i }),
    ).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('kdsRoutingRulesModel — pure helpers', () => {
  it('moveRow swaps neighbours and ignores out-of-bounds moves', () => {
    const rows = rowsFromPersisted([
      makeRule('a', 1, 'sku', 'A', 'x'),
      makeRule('b', 2, 'sku', 'B', 'y'),
    ]);
    expect(moveRow(rows, 1, -1).map((r) => r.key)).toEqual(['b', 'a']);
    expect(moveRow(rows, 0, -1)).toBe(rows);
    expect(moveRow(rows, 1, 1)).toBe(rows);
  });

  it('toSavePayload renumbers priority by position and trims values', () => {
    const rows = rowsFromPersisted([
      makeRule('a', 7, 'sku', '  BURGER ', ' grill '),
      makeRule('b', 3, 'category', 'cat-9', 'fry', false),
    ]);
    const payload = toSavePayload(rows);
    expect(payload).toEqual([
      { priority: 1, matcher: 'sku', matcher_value: 'BURGER', target_station: 'grill', is_active: true },
      { priority: 2, matcher: 'category', matcher_value: 'cat-9', target_station: 'fry', is_active: false },
    ]);
  });

  it('incompleteRowKeys flags blank values and blank stations', () => {
    const rows = rowsFromPersisted([makeRule('a', 1, 'sku', 'x', 's')]);
    rows.push(newDraftRow(1));
    expect([...incompleteRowKeys(rows)]).toEqual(['draft-1']);
  });
});
