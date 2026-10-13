// ── EditProductModal: two image actions that dropped silently ────────────
//
// `handleSetImage` and `handleClearImage` each open with a combined guard:
//
//     if (!sessionToken || !product?.id) return;
//
// and this file reports through `setImageError` a few lines below, in BOTH of them —
// once for a non-Tauri preview and once for the menu-slot-1 rule. So the token branch is
// a third reason to refuse the click, and the only one that says nothing: the operator
// taps an empty image slot and the modal sits there.
//
// Round 67's census listed this file as needing a reporting channel first. That was
// wrong — `setImageError` is right there, used by the sibling branch of the same guard.
// Recorded because the mistake matters: a file's refusal is only a fact once the whole
// handler has been read, not just its imports.
//
// ── Why the guard splits the condition ──
//
// The two refusals are not the same fact. `!product?.id` means there is no product to act
// on, which for an editor that renders its own empty state is not worth a message. A
// missing TOKEN means the action cannot be attempted, which the operator has to be told —
// otherwise they retry the same click. The fix separates them; the test asserts the
// separation rather than a generic toast.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const SRC = readFileSync(
  resolve(REPO, 'ui/src/features/retail/EditProductModal.tsx'),
  'utf-8',
);

/** Image actions the operator performs. */
const ACTIONS = ['handleSetImage', 'handleClearImage'];

describe('an image action reports when the session token is missing', () => {
  it.each(ACTIONS)('%s reports on the token branch', (name) => {
    const at = SRC.indexOf('const ' + name);
    expect(at, name + ' not found — rename this guard row with it').toBeGreaterThan(-1);

    const guardAt = SRC.indexOf('!sessionToken', at);
    expect(guardAt, name + ' no longer checks sessionToken').toBeGreaterThan(-1);

    const semi = SRC.indexOf(';', guardAt);
    const brace = SRC.indexOf('{', guardAt);
    const braced = brace !== -1 && brace < semi;

    expect(
      braced,
      name + ' returns SILENTLY. Unlike the !product?.id half of the same condition, a ' +
        'missing token is worth telling the operator about: this file already reports ' +
        'through setImageError. Split the guard and report.',
    ).toBe(true);

    const block = SRC.slice(brace, SRC.indexOf('}', brace) + 1);
    expect(
      block,
      name + ' guard is braced but says nothing. Use setImageError, the channel this ' +
        'handler already uses below.',
    ).toMatch(/setImageError\(/);
  });

  it('the guard is not vacuous', () => {
    expect(SRC.length).toBeGreaterThan(4_000);
    expect(SRC).toMatch(/setImageError\(/);
  });
});
