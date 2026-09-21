/**
 * Keyboard-Trap Orientation - ADR-0001 Slice 6.
 *
 * docs/adr/ADR-0001-orientation-and-adaptive-layout-strategy.md#L210, verbatim:
 *
 *   | **6** | Keyboard-trap verification | A check that a focused field plus an open
 *   on-screen keyboard leaves the submit control reachable, in both orientations. |
 *   One runnable check per migrated form-bearing screen. |
 *
 * WHAT IT GRADES. The trap is not one shape in one sheet - it is three facts in two files,
 * and each alone can be true while the trap still exists:
 *
 *   1. the form renders into a declared scroll container (overflow-y: auto in the sheet);
 *   2. the useKeyboardAvoidance containerRef is attached to an element, so the hook is not
 *      inert - it returns early when the ref is null, and nothing else in the repo asserts
 *      the two coincide;
 *   3. the submit control is declared at all, and is wired to the save action.
 *
 * The MDN orientation caveat - an open keyboard shrinks the VISUAL viewport and may flip it
 * wider-than-tall - is why the shell reading is height-independence on the content slot
 * rather than an orientation query: a slot that is a min-height floor lets .app-content
 * scroll the submit back in either orientation, and a fixed height ceiling clips it in both.
 *
 * WHY TEXT GREP AND NOT A CSS PARSER. An earlier round of this file carried a nesting-aware
 * rule reader and a JSX element-span walker. Both were wrong in ways that read as tree
 * violations: a multi-line selector list was attributed the line number of the preceding
 * @keyframes closing brace, and a tag scan that stopped at the > of an earlier arrow
 * function never found the modal panel className at all. A checker that fabricates
 * violations is worse than a blunt one, because its red is unactionable. The rules below
 * assert TEXT THAT MUST EXIST, per file, and print the line they found it on.
 *
 * THE PLANTED CONTROL. A fence never shown going red is an assertion that happens to be
 * green (orientationAdaptiveWalker.test.ts - Slice 4 made the same point). Each rule is a
 * pure predicate over text, and one test feeds it synthetic sheets.
 *
 * WHAT GREEN DOES NOT COVER. (a) the printed denominator is not coverage; (b) these are
 * source-text readings - "a scroll container is declared and the ref is attached" is not
 * "the submit is on screen when the keyboard is open", which only a real webview at a real
 * keyboard height can settle and no headless test in this repo can; (c) overflow-y: auto
 * inside a @media block counts here, so a conditional scroll container reads the same as an
 * unconditional one; (d) the shell slots are graded for a height ceiling, not for a render.
 *
 * READ LIKE ITS SIBLINGS: node fs over the working tree, no channel to any revision, and the
 * denominator printed as one console line and one named test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, normalize } from 'path';

const UI_SRC = normalize(join(__dirname, '..'));
const NEWLINE = String.fromCharCode(10);

/** Read a ui-relative path; a missing file throws with the path in the message. */
function source(rel: string): string {
  return readFileSync(join(UI_SRC, rel), 'utf-8');
}

/**
 * 1-based line numbers where pattern matches, with the matched line trimmed. The pattern is
 * tested against the WHOLE text, not line by line: two of the rules below (`onClick={complete}`
 * before its testid; `onSubmit={handleUsernameSubmit}` before `type="submit"`) cross a line
 * break, and a per-line test silently finds nothing. The reported line is the line the match
 * STARTS on, printed trimmed and whole.
 */
function hits(text: string, pattern: RegExp): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  // The source regex MUST carry over its flags. Without them a rule written with `\S` (an
  // upper-case class escape) silently becomes a class of `S` plus a literal backslash, so a
  // rule that matches the raw file reports nothing here - which is how the StaffLoginScreen
  // submit read as a gap it does not have.
  const scan = new RegExp(pattern.source, 'g' + pattern.flags.replace('g', ''));
  let match: RegExpExecArray | null;
  while ((match = scan.exec(text)) !== null) {
    // A zero-length match would spin forever; every rule here consumes at least one char.
    if (match[0].length === 0) scan.lastIndex++;
    const line = text.slice(0, match.index).split(NEWLINE).length;
    out.push({ line: line, text: text.split(NEWLINE)[line - 1]!.trim() });
  }
  return out;
}

/** The three facts Slice 6 needs from a form-bearing screen, as text shapes. */
interface FormScreen {
  name: string;
  css: string;
  tsx: string;
  /** Declarations that prove a scroll container, not a clipping box. */
  scrollRule: RegExp;
  /** The useKeyboardAvoidance containerRef binding, attached to an element. */
  refRule: RegExp;
  /** The submit control, and the handler that makes it the save action. */
  submitRule: RegExp;
  /**
   * A known, unresolved gap in this screen, named only so its violation is auditable. It is
   * NOT an exemption: the rule above still grades the screen and the gap still fails the
   * suite. Documenting it here keeps a real red from reading as a checker defect.
   */
  knownGap?: string;
}

const FORM_SCREENS: readonly FormScreen[] = [
  {
    // Brief: "sales/PaymentModal". A money screen, so the keyboard that opens is the
    // numeric one - the tallest on Android, which is why this screen is the trap.
    name: 'sales/PaymentModal',
    css: 'features/sales/PaymentModal.css',
    tsx: 'features/sales/PaymentModal.tsx',
    // Ceilings recorded today: .payment-customer-search-list (max-height 15rem at :426 plus
    // overflow-y: auto at :427) and the customer-search modal (70vh at :912 + auto at :932).
    scrollRule: /overflow-y:\s*auto/,
    // A callback ref, not a ref={...} prop: the modal forwards the hook ref onto the panel
    // the focus trap also owns (PaymentModal.tsx:1378-1380).
    refRule: /keyboardAvoidRef[\s\S]{0,80}\.current\s*=/,
    // The settle control (PaymentModal.tsx:1854-1859): `onClick={complete}` immediately
    // before its testid, in that order. The modal has no form element, so the wired handler
    // plus the testid is the honest identification, not a tag that happens to exist.
    submitRule: /onClick=\{complete\}[\s\S]{0,80}data-testid="settle-button"/,
  },
  {
    // Brief: the THIRD production consumer of useKeyboardAvoidance - StaffLoginScreen.tsx
    // imports it at :2 and calls it at :134. All three are declared here; the ADR asks for
    // "one runnable check per migrated form-bearing screen", so a consumer left out is a
    // screen nobody checks.
    name: 'auth/StaffLoginScreen',
    css: 'features/auth/StaffLoginScreen.css',
    tsx: 'features/auth/StaffLoginScreen.tsx',
    // KNOWN GAP - measured 2026-09-21, and this screen is RED for it. No sheet under
    // ui/src/features/auth/ declares a single `overflow`/`overflow-y` scroll value
    // (a repo grep for `overflow-y` plain in ui/src/features/auth returns nothing),
    // while `.staff-login-card` both pins `min-height: 33.75rem` (a FIXED 540px) at :46 and
    // clips with `overflow: hidden` at :53. In one 568px-tall landscape view that is more
    // than the whole visual viewport, and nothing inside it can scroll, so the PIN pad and
    // the submit button are unreachable - which is exactly Slice 6's stated trap.
    scrollRule: /overflow-y:\s*auto/,
    // Attached, unlike a plain ref={...}: the screen hands the ref to the card's PARENT, the
    // full-viewport `.staff-login-screen` overlay (StaffLoginScreen.tsx:484-486).
    refRule: /keyboardAvoidRef as React\.MutableRefObject<HTMLDivElement \| null>\)\.current\s*=/,
    // `<form onSubmit={handleUsernameSubmit}>` (:515) with `<button type="submit">` (:539)
    // inside it - the strongest submit shape of the three screens.
    submitRule: /onSubmit=\{handleUsernameSubmit\}[\s\S]{0,2000}type="submit"/,
  },
  {
    name: 'settings/SettingsPage',
    css: 'features/settings/SettingsPage.css',
    tsx: 'features/settings/SettingsPage.tsx',
    // The hook ref and the scroll container are the same node here: .settings-content
    // declares the scroll container (flex: 1 + min-height: 0 + overflow-y: auto).
    scrollRule: /overflow-y:\s*auto/,
    refRule: /settingsKeyboardRef/,
    // The form IS the submit control: onSubmit -> handleSave, with a hidden submit button.
    submitRule: /onSubmit=\{[\s\S]{0,200}handleSave/,
  },
];

/** The shell sheets that own the content slot, and the slot selector inside each. */
const SHELL_SLOTS: readonly { css: string; selector: string }[] = [
  { css: 'app/AppLayout.css', selector: '.app-content-inner' },
  { css: 'app/tablet/tablet.css', selector: '.tablet-shell .app-content-inner' },
];

/**
 * Pure: the slot block (selector line through its closing brace), or null when the selector
 * is absent - an assertion against a selector that no longer exists is a fence nobody can
 * audit.
 */
function slotBlock(css: string, selector: string): string | null {
  const lines = css.split(NEWLINE);
  const start = lines.findIndex((l) => l.trim().startsWith(selector + ' {'));
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && l.indexOf('}') !== -1);
  return lines.slice(start, end === -1 ? start + 8 : end + 1).join(NEWLINE);
}

/** Pure: a fixed height that is not a min-height floor or a max-height ceiling. */
function fixedHeight(body: string): RegExpMatchArray | null {
  return /(?:^|[;{\s])height\s*:\s*(?!auto|100%|inherit|initial|unset)([^;]+)/.exec(body);
}

function harvest() {
  const readings = FORM_SCREENS.map(function (screen) {
    return {
      screen: screen,
      scroll: hits(source(screen.css), screen.scrollRule),
      ref: hits(source(screen.tsx), screen.refRule),
      submit: hits(source(screen.tsx), screen.submitRule),
    };
  });
  const slots = SHELL_SLOTS.map(function (slot) {
    const block = slotBlock(source(slot.css), slot.selector);
    return {
      css: slot.css,
      selector: slot.selector,
      block: block,
      pinned: block === null ? null : fixedHeight(block),
    };
  });

  const missing: string[] = [];
  readings.forEach(function (r) {
    if (r.scroll.length === 0) missing.push(r.screen.css + " declares no overflow-y: auto - the form branch has no scroll container");
    if (r.ref.length === 0) missing.push(r.screen.tsx + " never attaches the useKeyboardAvoidance ref - the hook returns early and the scroll never happens");
    if (r.submit.length === 0) missing.push(r.screen.tsx + " declares no submit control wired to the save action");
  });
  slots.forEach(function (s) {
    if (s.block === null) missing.push(s.css + " declares no selector " + s.selector);
    else if (s.pinned) missing.push(s.css + " - " + s.selector + " pins a fixed height: " + String(s.pinned[1]).trim() + " - a fixed ceiling clips the submit out of the scrollable content area instead of letting .app-content scroll it back");
  });

  return {
    formScreens: FORM_SCREENS.length,
    scrollContainers: readings.filter((r) => r.scroll.length > 0).length,
    refsAttached: readings.filter((r) => r.ref.length > 0).length,
    submitsDeclared: readings.filter((r) => r.submit.length > 0).length,
    slotsSeen: slots.filter((s) => s.block !== null).length,
    slotsUnpinned: slots.filter((s) => s.block !== null && !s.pinned).length,
    missing: missing,
  };
}

const stats = harvest();

console.log(
  'keyboardTrapOrientation harvest: ' + stats.formScreens + ' form-bearing screens (one runnable check each); ' +
    stats.scrollContainers + ' declare a scroll container, ' + stats.refsAttached + ' attach the useKeyboardAvoidance ref, ' +
    stats.submitsDeclared + ' declare a save-wired submit; ' + stats.slotsSeen + '/' + SHELL_SLOTS.length +
    ' shell slots found, ' + stats.slotsUnpinned + ' of them height-free; ' + stats.missing.length + ' gaps' +
    (stats.missing.length ? ' (' + stats.missing.join('; ') + ')' : '') + '.',
);

describe('keyboard-trap orientation (ADR-0001 Slice 6)', () => {
  it('every form-bearing screen declares a scroll container, attaches the keyboard-avoidance ref, and declares a save-wired submit', () => {
    const msg = 'Found ' + stats.missing.length + ' keyboard-trap gaps:' + NEWLINE + stats.missing.join(NEWLINE);
    expect(stats.missing, msg).toEqual([]);
  });

  it('no shell content slot pins a fixed height: portrait blocks let .app-content scroll the submit back', () => {
    SHELL_SLOTS.forEach(function (slot) {
      const block = slotBlock(source(slot.css), slot.selector);
      expect(block, slot.css + ' no longer declares ' + slot.selector).not.toBeNull();
      expect(fixedHeight(String(block)), slot.css + ' - ' + slot.selector + ' must be a min-height floor, not a fixed-height ceiling').toBeNull();
    });
  });

  it('fails on a planted violation: a fixed-height slot, and a sheet whose only overflow is hidden', () => {
    const pinned = '.app-content-inner {' + NEWLINE + '  container-type: inline-size;' + NEWLINE + '  height: 100dvh;' + NEWLINE + '}' + NEWLINE;
    expect(fixedHeight(pinned), 'the fence no longer fires on a fixed-height slot').not.toBeNull();
    expect(fixedHeight('.app-content-inner {' + NEWLINE + '  min-height: 100%;' + NEWLINE + '}')).toBeNull();
    // Planted: a decorated box that scrolls nothing - the exact shape of the trap, where
    // the submit is below the fold and no scrolling can bring it back.
    const clipping = '.payment-modal {' + NEWLINE + '  overflow: hidden;' + NEWLINE + '}' + NEWLINE;
    expect(hits(clipping, /overflow-y:\s*auto/), 'the fence no longer distinguishes a clipping box from a scroll container').toEqual([]);
    expect(hits('.a {' + NEWLINE + '  overflow-y: auto;' + NEWLINE + '}', /overflow-y:\s*auto/).length).toBe(1);
    // And the slot reader itself: a selector that is absent is reported, not passed.
    expect(slotBlock(clipping, '.app-content-inner')).toBeNull();
  });

  it('the readings are not vacuous: each declared shape was found, on a line inside its file', () => {
    FORM_SCREENS.forEach(function (screen) {
      const cssLines = source(screen.css).split(NEWLINE).length;
      const tsxLines = source(screen.tsx).split(NEWLINE).length;
      const scroll = hits(source(screen.css), screen.scrollRule);
      const ref = hits(source(screen.tsx), screen.refRule);
      const submit = hits(source(screen.tsx), screen.submitRule);
      expect(scroll.length, screen.name + ": no scroll container").toBeGreaterThan(0);
      expect(ref.length, screen.name + ": no attached keyboard-avoidance ref").toBeGreaterThan(0);
      expect(submit.length, screen.name + ": no save-wired submit").toBeGreaterThan(0);
      // A printed line number must address the file, not float past its end.
      expect(scroll[0]!.line).toBeLessThanOrEqual(cssLines);
      expect(ref[0]!.line).toBeLessThanOrEqual(tsxLines);
      expect(submit[0]!.line).toBeLessThanOrEqual(tsxLines);
    });
    expect(stats.slotsSeen).toBe(SHELL_SLOTS.length);
    expect(stats.formScreens).toBeGreaterThan(0);
  });

  it(
    'prints its own denominator: ' + stats.formScreens + ' form-bearing screens (one runnable check each) with ' +
      stats.scrollContainers + ' scroll containers, ' + stats.refsAttached + ' attached refs, ' +
      stats.submitsDeclared + ' save-wired submits; ' + stats.slotsSeen + ' shell slots found with ' +
      stats.slotsUnpinned + ' height-free; ' + stats.missing.length + ' gaps',
    () => {
      expect(stats.missing.length).toBe(0);
      expect(stats.scrollContainers).toBe(stats.formScreens);
      expect(stats.refsAttached).toBe(stats.formScreens);
      expect(stats.submitsDeclared).toBe(stats.formScreens);
      expect(stats.slotsUnpinned).toBe(SHELL_SLOTS.length);
    },
  );
});
