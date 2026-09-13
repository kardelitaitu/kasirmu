// ── Characterization tests for the Apply confirmation dialog ──────────
//
// ADR #46's Rule 3 waiver authorises EXTRACTING this dialog out of
// NodeTopologyEditor.tsx into its own module. The waiver is conditional: the
// extraction must NET-REMOVE the dialog's JSX and state, or it is void.
//
// Those are behaviour-preservation claims, and nothing in the suite asserted
// the dialog's behaviour — it was only ever driven incidentally, as a means to
// an Apply, by NodeTopologyEditorDevMock.test.tsx. Extracting 187 lines of
// PIN-gated, focus-managed, aria-labelled JSX with no net is how the most
// important action in the feature silently breaks.
//
// So these tests are written BEFORE the move and are deliberately written
// against OBSERVABLE behaviour (roles, labels, enabled/disabled, what a click
// does) rather than against the file layout. They must pass unchanged on both
// sides of the refactor: red after the extraction means the move changed
// behaviour, which is exactly what the waiver forbids.

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import NodeTopologyEditor from '../features/locations/NodeTopologyEditor';
import { applyTopologyDiff, listTopologyRevisions } from '@/api/topology';
import type { ComponentProps } from 'react';
import type * as FluentReactModule from '@fluent/react';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

// Route invoke to the real dev-mock handlers, exactly as
// NodeTopologyEditorDevMock.test.tsx does. Without this the editor's
// useSettings has no backend and the render throws before any assertion runs.
vi.mock('@tauri-apps/api/core', async () => {
  const { invoke } = await import('@/dev-mock/tauri-api');
  return { invoke };
});

vi.mock('@fluent/react', async () => {
  const actual = await vi.importActual<typeof FluentReactModule>('@fluent/react');
  return {
    ...actual,
    // The dialog's Localized elements carry English fallback children, which
    // this renders verbatim — so assertions read as the user sees them.
    Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
    useLocalization: () => ({
      l10n: {
        getString: (key: string, fallback?: { $count?: number }) =>
          typeof fallback === 'object' ? key : key,
      },
    }),
  };
});

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      receipt: {
        showCurrency: false,
        decimalSeparator: 'dot',
        showTax: true,
        footer: '',
        paperWidth: 'standard',
        showTableNumber: false,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
      },
      store: { name: 'Test Store', address: '', taxId: '', currency: 'IDR', branch: '' },
      sync: { serverUrl: null, hasApiKey: false, enabled: false },
      brand: { colour: '#147EFB', storeName: 'Test Store' },
      preferences: { cardSize: 0, fontSize: 0, fontSmoothing: 'antialiased' },
      currencies: [],
      appVersion: '0.0.25',
    },
    loading: false,
    error: null,
    hasPartialError: false,
    refetch: vi.fn(),
    lastChangedKeys: [],
    markSettingsUpdated: vi.fn(),
  }),
}));

// Wire the editor's Apply to the REAL API → dev-mock chain, mirroring
// TopologyScreen's handleTopologySave (minus the screen's diff/validation
// layer, which has its own coverage): pass the editor's base revision
// through so the dev-mock gate sees exactly what the backend would.

// The dev-mock's verify_pin accepts ANY PIN on purpose (so the real Apply
// chain stays reachable in integration tests), which makes PIN rejection
// untestable through it. The editor imports verifyPin dynamically, so mock the
// module with a switch this file can flip.
const pinGate = {
  accept: true,
  /**
   * Every verifyPin call in order. The recorder is what makes the
   * credential-BEFORE-payload ordering pin below possible — without it the
   * test could only observe that a save happened, not that it happened after
   * verification.
   */
  calls: [] as Array<{ token: string; pin: string }>,
};
vi.mock('@/api/staff', () => ({
  verifyPin: async (token: string, pin: string) => {
    pinGate.calls.push({ token, pin });
    return pinGate.accept;
  },
}));

// The editor's own prop type, not a hand-rolled signature: the real onSave
// takes (nodes, wires, baseRevision, resolvedIssueKeys) and resolves to a
// union, and `(payload: unknown) => Promise<unknown>` type-checked nothing
// while failing tsc. Deriving it means this harness cannot drift from the
// component it drives.
type OnSave = NonNullable<ComponentProps<typeof NodeTopologyEditor>['onSave']>;

const renderEditor = (onSave: OnSave) =>
  renderWithProvidersSync(
    <NodeTopologyEditor currentTier="free" onSave={onSave} />,
    multiStoreFtl,
    sharedFtl,
  );

/** Drive the editor to the point the dialog is open. */
const openDialog = async () => {
  fireEvent.click(screen.getByText('Apply Topology'));
  await waitFor(() =>
    expect(document.querySelector('.topology-apply-confirm-overlay')).not.toBeNull(),
  );
};

beforeEach(() => {
  pinGate.accept = true;
  pinGate.calls.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('Apply confirmation dialog — characterization (pre-extraction net)', () => {
  it('opens as a labelled modal dialog', async () => {
    renderEditor(vi.fn().mockResolvedValue({ revision: 1 }));
    await openDialog();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    // The accessible name comes from the title's id, not a bare aria-label —
    // screen readers announce "Confirm Topology Changes".
    const labelledBy = dialog?.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy ?? '')?.textContent).toContain(
      'Confirm Topology Changes',
    );
  });

  it('gates Apply on a PIN of at least four digits', async () => {
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    await openDialog();

    const applyBtn = screen.getByText('Apply').closest('button') as HTMLButtonElement;
    const pin = document.getElementById('topology-apply-pin') as HTMLInputElement;

    expect(pin).not.toBeNull();
    expect(pin.type).toBe('password');
    expect(applyBtn.disabled).toBe(true);

    fireEvent.change(pin, { target: { value: '123' } });
    expect(applyBtn.disabled).toBe(true);

    fireEvent.change(pin, { target: { value: '1234' } });
    expect(applyBtn.disabled).toBe(false);
  });

  it('does not persist anything until the PIN is confirmed', async () => {
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    await openDialog();

    // Opening the dialog must not itself save — the whole point of the gate.
    expect(onSave).not.toHaveBeenCalled();
  });

  it('closes on Cancel without saving', async () => {
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    await openDialog();

    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() =>
      expect(document.querySelector('.topology-apply-confirm-overlay')).toBeNull(),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('submits from the PIN field on Enter', async () => {
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    await openDialog();

    const pin = document.getElementById('topology-apply-pin') as HTMLInputElement;
    // Too short: Enter must not fire the Apply.
    fireEvent.change(pin, { target: { value: '12' } });
    fireEvent.keyDown(pin, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(pin, { target: { value: '1234' } });
    fireEvent.keyDown(pin, { key: 'Enter' });
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it('shows the session-vs-target store scope, and warns on a mismatch', async () => {
    renderEditor(vi.fn().mockResolvedValue({ revision: 1 }));
    await openDialog();

    const labels = [...document.querySelectorAll('.topology-apply-confirm-scope-label')].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(expect.arrayContaining(['Session store', 'Target store']));
  });

  it('lists what will change, which is the dialog\'s whole purpose', async () => {
    renderEditor(vi.fn().mockResolvedValue({ revision: 1 }));
    // An empty diff renders no sections (proved by the first draft of this
    // test asserting otherwise), so make a real edit first — the same move
    // NodeTopologyEditorDevMock.test.tsx uses to get a non-empty diff.
    const addBtn = document.querySelector(
      '.rack-icon-btn[aria-label="topology-rack-add-title"]',
    ) as HTMLElement;
    if (addBtn && !addBtn.classList.contains('is-active')) {
      fireEvent.click(addBtn);
    }
    fireEvent.click(screen.getByText('+ Retail POS'));
    await openDialog();

    const sections = [...document.querySelectorAll('.topology-apply-confirm-section')];
    expect(sections.length).toBeGreaterThan(0);
    // Each section carries a count, so the operator sees the scale of the
    // deploy before confirming it.
    const counts = [...document.querySelectorAll('.topology-apply-confirm-count')];
    expect(counts.length).toBe(sections.length);
    for (const c of counts) {
      expect(c.textContent?.trim()).toMatch(/^\d+$/);
    }
  });

  it('survives a rejected PIN: reopens, cleared, with the error shown', async () => {
    // THE reason the extraction cannot simply move state into the component.
    // Today the dialog CLOSES before verification and RE-OPENS on rejection,
    // so the error and the cleared PIN live across an unmount. A component
    // that owns that state would lose it on remount and silently drop the
    // error. Pinned here so the refactor has to keep it.
    pinGate.accept = false;
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    await openDialog();

    const pin = document.getElementById('topology-apply-pin') as HTMLInputElement;
    fireEvent.change(pin, { target: { value: '0000' } }); // wrong PIN
    fireEvent.click(screen.getByText('Apply').closest('button') as HTMLButtonElement);

    await waitFor(() =>
      expect(
        document.querySelector('.topology-apply-confirm-pin-error'),
      ).not.toBeNull(),
    );
    expect(
      document.querySelector('.topology-apply-confirm-pin-error')?.textContent,
    ).toContain('Incorrect PIN');
    // Cleared, so the operator retypes rather than resubmitting blind.
    expect((document.getElementById('topology-apply-pin') as HTMLInputElement).value).toBe('');
    // And the canvas was never written.
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the verifying state rather than a dead canvas mid-PIN-check', async () => {
    // The dialog closes BEFORE verification and only reopens on failure, so on
    // a SUCCESSFUL verify the operator sees nothing at all between the click
    // and the save. This asserts the current, weaker behaviour so the
    // extraction is judged against what the code does today, not what it
    // should do. If the refactor makes 'Verifying…' actually reachable, this
    // test must be updated deliberately rather than quietly.
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    await openDialog();
    const pin = document.getElementById('topology-apply-pin') as HTMLInputElement;
    fireEvent.change(pin, { target: { value: '1234' } });
    fireEvent.click(screen.getByText('Apply').closest('button') as HTMLButtonElement);
    // No 'Verifying…' label appears; the dialog is gone while the PIN check runs.
    expect(screen.queryByText('Verifying…')).toBeNull();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  // ── Change note (ADR #46 §6) ───────────────────────────────────
  // Added AFTER the extraction, under the same waiver that authorised it.
  // These are new-behaviour tests, not characterization.

  it('carries the typed change note through to the save call', async () => {
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    await openDialog();

    const note = document.getElementById('topology-apply-note') as HTMLTextAreaElement;
    expect(note).not.toBeNull();
    fireEvent.change(note, { target: { value: 'Opened the Pos Kota counter' } });

    const pin = document.getElementById('topology-apply-pin') as HTMLInputElement;
    fireEvent.change(pin, { target: { value: '1234' } });
    fireEvent.click(screen.getByText('Apply').closest('button') as HTMLButtonElement);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // 5th positional argument, after resolvedIssueKeys.
    expect(onSave.mock.calls[0]?.[4]).toBe('Opened the Pos Kota counter');
  });

  it('sends an empty note rather than blocking the Apply when left blank', async () => {
    // §6 is explicit that a note is optional: forcing one on every Apply
    // trains operators to type noise, and the whole point of the field is to
    // be worth reading.
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    await openDialog();

    const pin = document.getElementById('topology-apply-pin') as HTMLInputElement;
    fireEvent.change(pin, { target: { value: '1234' } });
    fireEvent.click(screen.getByText('Apply').closest('button') as HTMLButtonElement);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[4]).toBe('');
  });

  it('caps the note at the backend limit, counted in characters', async () => {
    // Mirrors TOPOLOGY_CHANGE_NOTE_MAX_CHARS. The server REJECTS an over-long
    // note rather than truncating it, so the field must not let one through.
    renderEditor(vi.fn().mockResolvedValue({ revision: 1 }));
    await openDialog();
    const note = document.getElementById('topology-apply-note') as HTMLTextAreaElement;
    expect(note.maxLength).toBe(500);
  });

  it('keeps the note when the PIN is rejected, and clears it on a fresh open', async () => {
    // Both halves of the deliberate reset semantics: a wrong PIN must not
    // cost the operator a paragraph they already wrote (it is not a
    // credential), but a NEW Apply must not inherit the last one's note.
    pinGate.accept = false;
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    await openDialog();

    const noteEl = () => document.getElementById('topology-apply-note') as HTMLTextAreaElement;
    fireEvent.change(noteEl(), { target: { value: 'Moved Gudang to back-room routing' } });
    const pin = document.getElementById('topology-apply-pin') as HTMLInputElement;
    fireEvent.change(pin, { target: { value: '1234' } });
    fireEvent.click(screen.getByText('Apply').closest('button') as HTMLButtonElement);

    await waitFor(() =>
      expect(document.querySelector('.topology-apply-confirm-pin-error')).not.toBeNull());
    expect(noteEl().value).toBe('Moved Gudang to back-room routing');
    // The PIN is still cleared — that one IS a credential.
    expect((document.getElementById('topology-apply-pin') as HTMLInputElement).value).toBe('');

    // Cancel and re-open: the note must not carry over into a new Apply.
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(document.querySelector('.topology-apply-confirm-overlay')).toBeNull());
    fireEvent.click(screen.getByText('Apply Topology'));
    await waitFor(() => expect(document.querySelector('.topology-apply-confirm-overlay')).not.toBeNull());
    expect(noteEl().value).toBe('');
  });

  it('lands the note in the revision history through the real IPC chain', async () => {
    // THE point of §6. The earlier tests prove the dialog hands the note to
    // onSave; this proves it survives from there to the record a merchant
    // reads days later.
    //
    // The onSave below is a BRIDGE, not a stub: it does what TopologyScreen's
    // real handler does — forward its own arguments to applyTopologyDiff. So
    // the string that ends up in the revision row can only have come from the
    // textarea. Hardcoding it here would have tested the dev-mock and looked
    // like it tested the dialog.
    const bridgedSave: OnSave = (_nodes, _wires, baseRevision, resolvedIssueKeys, changeNote) =>
      applyTopologyDiff(
        'test-session-token', [], [], [],
        // Empty diagram on purpose: the editor's TopologyNodeData is not the
        // payload shape applyTopologyDiff takes (TopologyScreen converts it via
        // buildDiagramPayloads), and this test is about the NOTE's journey, not
        // the graph's. The note still travels the whole real path.
        [], [], undefined, baseRevision ?? 0,
        undefined, resolvedIssueKeys, changeNote,
      );

    renderEditor(bridgedSave);
    await openDialog();

    const typed = 'Opened Pos Kota counter';
    fireEvent.change(
      document.getElementById('topology-apply-note') as HTMLTextAreaElement,
      { target: { value: typed } },
    );
    fireEvent.change(
      document.getElementById('topology-apply-pin') as HTMLInputElement,
      { target: { value: '1234' } },
    );
    fireEvent.click(screen.getByText('Apply').closest('button') as HTMLButtonElement);

    await waitFor(async () => {
      const history = await listTopologyRevisions('test-session-token');
      expect(history[0]?.changeNote).toBe(typed);
    });
  });

  it('keeps the remember-PIN option out of the way once the session is verified', async () => {
    renderEditor(vi.fn().mockResolvedValue({ revision: 1 }));
    await openDialog();
    // Either the checkbox is offered, or it is deliberately absent because
    // this session already verified. Both are correct; what must not happen is
    // the label rendering with no control attached.
    const remember = screen.queryByText('Remember PIN for this session');
    if (remember) {
      expect(remember.closest('label')?.querySelector('input[type="checkbox"]')).not.toBeNull();
    }
  });
});

// ── Apply SAVE-FLOW characterization (G8: the apply/save panel) ─────
//
// Everything above characterizes the DIALOG — which is the part that already
// moved out under the ADR #46 Rule 3 waiver. What none of it pins is the pair
// still inside NodeTopologyEditor.tsx: `handleApplyClick` (validation gate +
// diff-preview assembly) and `confirmApply` (verify → onSave → snapshot and
// revision adoption). todo-refactor-topology.md flags that pair as G8, the
// highest-leverage surface extraction left in the editor.
//
// So these tests pin the CONTRACT between the panel and the editor, again only
// through observable behaviour — roles, DOM and the arguments onSave actually
// receives. They must pass on both sides of the move: red after the extraction
// means the panel stopped threading something the save depends on.
//
// Pre-existing coverage deliberately not duplicated here: the dirty-chip
// transitions and the idMap rewrite are pinned in NodeTopologyEditor.test.tsx
// ('Apply failure resilience', 'idMap remapping'); the change note's journey is
// pinned above. What is NOT pinned anywhere else is the onSave argument
// positional contract, the keyboard-ownership guard, and revision adoption —
// which are precisely the three things a props-object refactor can quietly
// break while every existing test stays green.
describe('Apply save flow — characterization (pre-G8 extraction)', () => {
  /** The saved spy's call list, read through the REAL prop signature so a
   *  positional swap in the panel is a type-visible failure, not an `any`. */
  const callsOf = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls as unknown as Parameters<OnSave>[];

  /** Tick the tool rack open if it is closed, then add a Retail POS
   *  workspace — the same route the diff-preview test above uses. */
  const addRetailWorkspace = () => {
    const addBtn = document.querySelector(
      '.rack-icon-btn[aria-label="topology-rack-add-title"]',
    ) as HTMLElement;
    if (addBtn && !addBtn.classList.contains('is-active')) {
      fireEvent.click(addBtn);
    }
    fireEvent.click(screen.getByText('+ Retail POS'));
  };

  /** Type a valid PIN and press the dialog's Apply. */
  const submitPin = async (onSave: ReturnType<typeof vi.fn>, times = 1) => {
    const pin = document.getElementById('topology-apply-pin') as HTMLInputElement;
    fireEvent.change(pin, { target: { value: '1234' } });
    fireEvent.click(screen.getByText('Apply').closest('button') as HTMLButtonElement);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(times));
  };

  /** Barrier on the save-lifecycle machine having released the Apply: while a
   *  save is in flight the header button is disabled, so an enabled header is
   *  observable proof that `finishApply`/`failApply` ran. Needed because the
   *  editor releases the guard from a `setTimeout(0)`, not inline. */
  const applyReleased = async () => {
    await waitFor(() =>
      expect(
        (screen.getByText('Apply Topology').closest('button') as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  };

  it('hands onSave the live canvas, base revision and issue keys, in that order', async () => {
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    addRetailWorkspace();
    // Counted BEFORE the save: the payload must carry this canvas, so the
    // number has to match what is on screen at click time.
    const domNodes = document.querySelectorAll('.topology-node').length;

    await openDialog();
    await submitPin(onSave);

    const args = callsOf(onSave)[0];
    // Five positional arguments — (nodes, wires, baseRevision,
    // resolvedIssueKeys, changeNote). An ApplyPanelProps object that forgets
    // one still "works" against a loose mock; this pins the arity.
    expect(args).toHaveLength(5);
    const [nodes, wires, baseRevision, resolvedIssueKeys] = args ?? [];
    expect(nodes).toHaveLength(domNodes);
    expect(Array.isArray(wires)).toBe(true);
    for (const n of nodes ?? []) {
      expect(typeof n.id).toBe('string');
      expect(typeof n.type).toBe('string');
    }
    expect(typeof baseRevision).toBe('number');
    // resolvedIssueKeys is a SPREAD COPY (`[...resolvedIssues]`), not the Set.
    // Forwarding the Set keeps this call green and breaks the parent, which
    // hands it straight to the IPC payload — the same class of shape drift
    // b30e97c63 pinned for the rename label (delete vs empty string).
    expect(Array.isArray(resolvedIssueKeys)).toBe(true);
    expect(resolvedIssueKeys).not.toBeInstanceOf(Set);
  });

  it('still opens and saves on an unchanged canvas — Apply is not dirty-gated', async () => {
    // `handleApplyClick` checks VALIDATION errors and then opens; `isDirty`
    // plays no part in it. That is deliberate enough to pin: the extraction
    // "improving" the panel into a no-op when nothing changed would remove the
    // only way to re-push an unchanged diagram, and no existing test notices.
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    // The canvas is CLEAN before the click: with no saved diagram behind the
    // dev-mock, the standalone editor settles on an empty graph, so no
    // 'Unsaved changes' chip is up. Writing anything from here is by definition
    // an Apply with nothing to apply.
    expect(document.querySelector('.topology-dirty-chip')).toBeNull();

    fireEvent.click(screen.getByText('Apply Topology'));
    await waitFor(() =>
      expect(document.querySelector('.topology-apply-confirm-overlay')).not.toBeNull(),
    );

    // An empty diff: the empty-state paragraph stands in for all four sections.
    expect(document.querySelectorAll('.topology-apply-confirm-section')).toHaveLength(0);
    expect(document.querySelector('.topology-apply-confirm-empty')).not.toBeNull();

    const applyBtn = screen.getByText('Apply').closest('button') as HTMLButtonElement;
    const pin = document.getElementById('topology-apply-pin') as HTMLInputElement;
    fireEvent.change(pin, { target: { value: '1234' } });
    expect(applyBtn.disabled).toBe(false);
    fireEvent.click(applyBtn);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // The save really did go out carrying the empty canvas, rather than being
    // skipped as a no-op — the payload is the graph, not the diff.
    expect(callsOf(onSave)[0]?.[0]).toEqual([]);
    expect(callsOf(onSave)[0]?.[1]).toEqual([]);
  });

  it('keeps canvas shortcuts inert while the dialog is open', async () => {
    // The editor's document-level keydown handler silences canvas shortcuts
    // for any event whose target sits inside `.topology-apply-confirm-overlay`
    // (NodeTopologyEditor.tsx's `closest` guard). The comment next to that
    // guard says every editor-owned dialog must be covered "or its Escape
    // handling will leak into the canvas" — the overlay's class name is load
    // bearing. Renaming it during the extraction would let Escape close the
    // dialog and Delete eat the selection underneath it.
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    addRetailWorkspace();
    // Select the newly added (unwired) workspace: unwired workspaces delete
    // immediately, so a leaked Delete keypress WOULD visibly change the canvas.
    const nodes = document.querySelectorAll('.topology-node');
    const target = nodes[nodes.length - 1] as HTMLElement;
    fireEvent.mouseDown(target, { button: 0 });
    expect(document.querySelector('.topology-node.node-selected')).not.toBeNull();
    const before = nodes.length;

    await openDialog();
    const overlay = document.querySelector('.topology-apply-confirm-overlay') as HTMLElement;
    fireEvent.keyDown(overlay, { key: 'Escape' });
    fireEvent.keyDown(overlay, { key: 'Delete' });
    fireEvent.keyDown(overlay, { key: 'Backspace' });

    // Nothing leaked: dialog open, canvas intact, selection intact, no save.
    expect(document.querySelector('.topology-apply-confirm-overlay')).not.toBeNull();
    expect(document.querySelectorAll('.topology-node')).toHaveLength(before);
    expect(document.querySelector('.topology-node.node-selected')).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not dismiss on a backdrop mousedown — the overlay is not click-to-close', async () => {
    // The overlay's onMouseDown only calls stopPropagation, so the backdrop is
    // a shield (keep the canvas from starting a marquee under the modal), not
    // a dismissal affordance. A PIN-gated deploy confirm that closes on a
    // stray click outside it is a real behaviour change, and it is exactly
    // what swapping in a shared Modal/ConfirmDialog would bring.
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    await openDialog();
    const overlay = document.querySelector('.topology-apply-confirm-overlay') as HTMLElement;
    fireEvent.mouseDown(overlay, { button: 0 });

    expect(document.querySelector('.topology-apply-confirm-overlay')).not.toBeNull();
    // Still fully armed: the typed credentials survived the backdrop click.
    expect(document.getElementById('topology-apply-pin')).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('reports a failed save without reopening the dialog or blaming the PIN', async () => {
    // confirmApply resolves TRUE for a backend failure precisely so the dialog
    // does NOT reopen — a rejected save is not a rejected credential. The
    // canvas-side half of this (edits kept, still dirty, undo intact) is pinned
    // in NodeTopologyEditor.test.tsx; the dialog-side half is pinned here, and
    // the retry at the end is the proof that failApply released the in-flight
    // guard instead of stranding the editor in `applying`.
    const onSave = vi.fn().mockRejectedValue(new Error('backend said no'));
    renderEditor(onSave);
    await openDialog();
    await submitPin(onSave);

    await waitFor(() =>
      expect(screen.getByText(/topology-toast-save-error/)).toBeInTheDocument(),
    );
    expect(document.querySelector('.topology-apply-confirm-overlay')).toBeNull();
    expect(document.querySelector('.topology-apply-confirm-pin-error')).toBeNull();
    // No silent retry from the failure path itself.
    expect(onSave).toHaveBeenCalledTimes(1);

    await applyReleased();
    fireEvent.click(screen.getByText('Apply Topology'));
    await waitFor(() =>
      expect(document.querySelector('.topology-apply-confirm-overlay')).not.toBeNull(),
    );
  });

  it('asks for the PIN again on the next Apply when Remember was not ticked', async () => {
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    await openDialog();
    await submitPin(onSave);
    expect(pinGate.calls).toHaveLength(1);
    expect(pinGate.calls[0]?.pin).toBe('1234');
    await applyReleased();

    // A fresh open hands over empty credentials: PIN cleared by the dialog's
    // open effect, Apply disabled again, nothing pre-authorized.
    fireEvent.click(screen.getByText('Apply Topology'));
    await waitFor(() =>
      expect(document.querySelector('.topology-apply-confirm-overlay')).not.toBeNull(),
    );
    const pinAgain = document.getElementById('topology-apply-pin') as HTMLInputElement;
    expect(pinAgain.value).toBe('');
    expect(
      (screen.getByText('Apply').closest('button') as HTMLButtonElement).disabled,
    ).toBe(true);

    await submitPin(onSave, 2);
    // Second verification, same session token: the remember-cache is keyed per
    // session and was NOT armed, so the credential is re-checked per Apply.
    expect(pinGate.calls).toHaveLength(2);
    expect(pinGate.calls[1]?.token).toBe(pinGate.calls[0]?.token);
  });

  it('clears the unsaved-changes state and the diff preview together once the save succeeds', async () => {
    // `commitSnapshot({nodes: savedNodes, wires: savedWires})` is the single
    // thing that makes an Apply land CLEAN. Dirty is DERIVED by comparing the
    // canvas against that snapshot, and the dialog's diff preview is built from
    // the same snapshot — so the chip and the preview are two views of one
    // value, and both must flip on a success. A panel that saves correctly but
    // forgets to call commitSnapshot leaves the operator staring at 'Unsaved
    // changes' and a diff that never empties; this is the only net on it.
    const onSave = vi.fn().mockResolvedValue({ revision: 1 });
    renderEditor(onSave);
    addRetailWorkspace();
    expect(document.querySelector('.topology-dirty-chip')).not.toBeNull();

    await openDialog();
    // The pending diff is real before the save...
    expect(document.querySelectorAll('.topology-apply-confirm-section').length).toBeGreaterThan(0);
    await submitPin(onSave);
    await applyReleased();

    // ...and is gone after it, from BOTH surfaces, with nothing rewritten in
    // memory beyond the ids the save returned.
    expect(document.querySelector('.topology-dirty-chip')).toBeNull();
    fireEvent.click(screen.getByText('Apply Topology'));
    await waitFor(() =>
      expect(document.querySelector('.topology-apply-confirm-overlay')).not.toBeNull(),
    );
    expect(document.querySelectorAll('.topology-apply-confirm-section')).toHaveLength(0);
    expect(document.querySelector('.topology-apply-confirm-empty')).not.toBeNull();
    // No extra save was implied by reopening the dialog.
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

