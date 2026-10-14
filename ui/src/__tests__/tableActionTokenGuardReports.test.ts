// ── A sessionToken guard in a table ACTION must report, not return bare ──
//
// TableManagementScreen has five handlers the operator performs — save a table,
// delete it, move it, merge it, print its bill — and four of them opened with a
// guard that returns silently when the session token is missing:
//
//     if (!moveTableModal || !selectedDestTableId || !sessionToken) return;
//
// Every one of those handlers ALREADY toasts on its other paths
// (`tables-toast-move-failed`, `tables-action-error`, `tables-toast-bill-print-failed`),
// so the no-token branch was the only mute one. The operator taps Move, the modal
// stays open with nothing said, and the reasonable reading is that the button is
// broken rather than that the session lapsed.
//
// This is the same class rounds 41-43 fixed in StockShortfallDialog, the restaurant
// settings/editor/payments screens and the EDC cards. That sweep pinned NAMED handlers
// in those files; this screen was not among them, which is how it kept the shape.
//
// The reason it is worth a guard rather than a comment: the failure is invisible. The
// action does not fail loudly, it does nothing, and the operator cannot distinguish
// "no session" from "the till is stuck".

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const SRC = readFileSync(
  resolve(REPO, 'ui/src/features/tables/TableManagementScreen.tsx'),
  'utf-8',
);

/**
 * Handlers the USER performs, whose guard must report when the token is absent.
 *
 * Named individually rather than detected by pattern: a regex for "handler with a
 * token guard" would also catch the two LOAD effects (`loadTables`, the settings
 * reads), where returning quietly is correct because the screen renders its own
 * empty state. Which is which is a judgement, so it is written down here.
 */
const ACTIONS = [
  'handleSaveTableModal',
  'handleDeleteTable',
  'handleConfirmMoveTable',
  'handleConfirmMergeTable',
];

/** The body of a `useCallback` handler, brace-matched. */
function handlerBody(name: string): string {
  const at = SRC.indexOf('const ' + name);
  expect(at, name + ' not found — rename this guard row with it').toBeGreaterThan(-1);
  const open = SRC.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') {
      depth--;
      if (depth === 0) return SRC.slice(open, i + 1);
    }
  }
  throw new Error('unbalanced braces in ' + name);
}

describe('a table action reports when the session token is missing', () => {
  it.each(ACTIONS)('%s reports on the token branch, not merely somewhere', (name) => {
    // Three drafts of this check were vacuous, each in a different way, and the ways
    // are worth keeping:
    //
    //   1. "the handler toasts somewhere" — satisfied by the success and catch paths,
    //      which is every handler, including the broken ones.
    //   2. "a report appears after the guard line" — the catch block is still 'after'.
    //   3. "the report call has a non-null argument" — did not help, because the
    //      catch block's argument is non-null too.
    //
    // What actually distinguishes the branches is the SHAPE of the guard statement: a
    // silent guard is `if (...) return;` as one statement, and a reporting guard puts
    // the message inside braces. So this asserts on that.
    const body = handlerBody(name);
    expect(body, name + ' no longer checks sessionToken').toMatch(/!sessionToken/);

    const at = SRC.indexOf('const ' + name);
    const guardAt = SRC.indexOf('!sessionToken', at);
    // Walk back to the start of the `if (` that owns this test.
    const ifAt = SRC.lastIndexOf('if (', guardAt);
    // ...and forward to the end of that statement. A braced guard closes with `}`; a
    // bare one ends at the first `;`.
    const semi = SRC.indexOf(';', guardAt);
    const brace = SRC.indexOf('{', guardAt);
    const braced = brace !== -1 && brace < semi;

    expect(
      braced,
      name + ' returns SILENTLY when sessionToken is missing (`if (...) return;`). The ' +
        'operator taps the button, nothing happens, and a toast on the success or ' +
        'error path below does not cover this branch. Put the message in the guard: ' +
        'if (!sessionToken) { addToast(...); return; }',
    ).toBe(true);

    const guardBlock = SRC.slice(ifAt, SRC.indexOf('}', brace) + 1);
    expect(
      guardBlock,
      name + '\'s guard is braced but says nothing. It must report, the way this ' +
        'handler already reports on its other paths.',
    ).toMatch(/addToast\(|setActionError\(|setTableModalError\(/);
  });

  it('the two LOAD effects are NOT required to toast, and this guard knows why', () => {
    // Non-vacuity in the other direction: the distinction is real. A load that cannot
    // run renders an empty screen, which is the symptom; toasting on every mount with
    // no session would be noise. Named here so the list above is a decision.
    const loaders = ['loadTables'];
    for (const name of loaders) {
      expect(SRC, name + ' no longer exists — repoint this guard').toContain(name);
    }
    // And no action row was accidentally also a loader.
    for (const name of ACTIONS) {
      expect(loaders).not.toContain(name);
    }
  });
});
