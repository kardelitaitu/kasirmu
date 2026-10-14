// ── A sessionToken guard in a user ACTION must report, not return bare ───
//
// The defect, and why it needed a guard after the fact:
//
//   if (!sessionToken) return;
//
// inside a handler the user performs (Save, Delete, Test) drops the action with NOTHING
// on screen. WorkspaceContext.tsx:76-84 names the class outright — a rejected session
// that is "a console.warn only" leaves "every token-taking command downstream"
// no-opping "with nothing on screen to explain why" — and sessionToken starts null
// (:232), so it is reachable whenever a session lapses while a screen is open.
//
// Found and fixed one at a time: StockShortfallDialog (0b9e88694), then a sweep that
// took four in features/restaurant (22d42992d), then the EDC/payment settings here. Seven
// of the eight handlers already toasted on EVERY other path — success and failure alike
// — so the silent branch was the only mute one, which is why it read as a dead button
// rather than an error.
//
// WHY NOT A CLASS SWEEP: a census shows 77 of these guards across 43 files, and 34 of
// those files hold SOME reporter (addToast / setFormError / setError). But most guards sit
// in LOAD effects, where a missing token correctly yields empty data — an empty screen IS
// the symptom, and toasting on every mount would be noise. "A reporter exists somewhere
// in this file" cannot tell an action from a load, so a guard keyed to it would fail
// forever and then be deleted. This pins the named ACTION handlers instead: a small list
// that a real fix empties, not a pattern that fires everywhere.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');

/**
 * The sessionToken guard block of `fn`, i.e. from `if (!sessionToken) {` up to its own
 * closing brace. Deliberately NOT a fixed character window: handleSave reports through
 * `addToastRef.current({ message: requiredLocalized(...) })`, so a short window can cut
 * the call off and report a FIXED handler as silent — which is how the first draft of
 * this check got that answer wrong.
 */
function guardBlock(rel: string, fn: string): string {
  const src = readFileSync(resolve(REPO, rel), 'utf-8');
  const at = src.indexOf('const ' + fn);
  expect(at, rel + ' declares no ' + fn + ' — rename this guard row with it').toBeGreaterThan(-1);
  const g = src.indexOf('if (!sessionToken) {', at);
  expect(g, rel + ':' + fn + ' has no `if (!sessionToken) {` guard — did it move?').toBeGreaterThan(-1);
  const close = src.indexOf('}', g);
  return src.slice(g, close + 1);
}

/**
 * Handler → file. Every entry is a handler the USER performs, where a silent return
 * loses their action and no other symptom appears.
 */
const HANDLERS: Array<[string, string]> = [
  ['ui/src/features/sales/StockShortfallDialog.tsx', 'handleConfirm'],
  ['ui/src/features/restaurant/screens/RestaurantSettingsScreen.tsx', 'handleSave'],
  ['ui/src/features/restaurant/screens/RestaurantMenuEditorScreen.tsx', 'handleDeleteItem'],
  ['ui/src/features/restaurant/screens/RestaurantMenuEditorScreen.tsx', 'handleDeleteCategory'],
  ['ui/src/features/restaurant/screens/RestaurantPaymentsScreen.tsx', 'handleTestEdc'],
  ['ui/src/features/settings/workspace-cards/TerminalPreferencesCard.tsx', 'handleTestEdc'],
  ['ui/src/features/settings/components/EdcTerminalsCard.tsx', 'handleTestConnection'],
  ['ui/src/features/settings/components/EdcTerminalsCard.tsx', 'handleSubmit'],
];

describe('a sessionToken guard in a user action never returns bare', () => {
  for (const [rel, fn] of HANDLERS) {
    it(rel.split('/').pop() + ':' + fn + ' reports a missing token', () => {
      const block = guardBlock(rel, fn);
      expect(
        block,
        'this guard returns without reporting, so the action drops with nothing on ' +
          'screen. Report it (addToast / setFormError / setError) the way every other ' +
          'path in this handler already does.',
      ).toMatch(/addToast|setFormError|setSaveError|setError/);
    });
  }
});
