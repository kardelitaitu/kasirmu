import { describe, it, expect } from 'vitest';
import {
  extractClassSelectors,
  extractUsedClassNames,
  resolveComposedClassNames,
} from './screenExtraction.utils';

// ── extractClassSelectors ───────────────────────────────────────────

describe('extractClassSelectors', () => {
  it('extracts simple class selectors from CSS', () => {
    const css = '.foo { color: red; } .bar { color: blue; }';
    const result = extractClassSelectors(css);
    expect(result.has('foo')).toBe(true);
    expect(result.has('bar')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('ignores pseudo-classes and pseudo-elements', () => {
    const css = ':root { --color: red; } :hover { } ::after { }';
    const result = extractClassSelectors(css);
    expect(result.has('root')).toBe(false);
    expect(result.has('hover')).toBe(false);
    expect(result.has('after')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('extracts compound class selectors', () => {
    const css = '.card.selected { border: 1px solid; }';
    const result = extractClassSelectors(css);
    expect(result.has('card')).toBe(true);
    expect(result.has('selected')).toBe(true);
  });

  it('extracts class names with hyphens and underscores', () => {
    const css = '.foo-bar { } .baz_qux { } .kebab--modifier { }';
    const result = extractClassSelectors(css);
    expect(result.has('foo-bar')).toBe(true);
    expect(result.has('baz_qux')).toBe(true);
    expect(result.has('kebab--modifier')).toBe(true);
  });

  it('ignores names starting with a digit', () => {
    const css = '.123foo { } .3bar { }';
    const result = extractClassSelectors(css);
    expect(result.has('123foo')).toBe(false);
    expect(result.has('3bar')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('removes CSS comments before extraction', () => {
    const css = '/* .commented-out { } */ .real { color: red; }';
    const result = extractClassSelectors(css);
    expect(result.has('commented-out')).toBe(false);
    expect(result.has('real')).toBe(true);
  });

  it('removes @keyframes blocks', () => {
    const css = '@keyframes slide-in { 0% { opacity: 0; } 100% { opacity: 1; } } .btn { }';
    const result = extractClassSelectors(css);
    expect(result.has('btn')).toBe(true);
    expect(result.has('slide-in')).toBe(false);
    expect(result.size).toBe(1);
  });

  it('handles CSS with media queries', () => {
    const css = '@media (max-width: 600px) { .mobile-only { display: block; } }';
    const result = extractClassSelectors(css);
    expect(result.has('mobile-only')).toBe(true);
  });

  it("ignores url() content to avoid false positives", () => {
    const css = '.icon { background: url(data:image/svg+xml,<svg><rect id="icon-shape"/></svg>); }';
    const result = extractClassSelectors(css);
    // url() content like "w3" from www.w3.org should be stripped
    // The class "icon" should still be extracted
    expect(result.has('icon')).toBe(true);
  });

  it('handles comma-separated selectors', () => {
    const css = '.a, .b, .c { margin: 0; }';
    const result = extractClassSelectors(css);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(true);
  });

  // The four shapes a class token can legally be followed by that the
  // original `[.,\s{]` lookahead did not admit. Each of these names existed in
  // a shipped stylesheet and was invisible to the definition side until the
  // terminator set was widened; 126 of them across 137 stylesheets, 121 inside
  // themes/components.css.
  it('extracts a class followed by a pseudo-element compound selector', () => {
    const css = '.toggle-thumb::after { content: ""; left: 0; }';
    const result = extractClassSelectors(css);
    expect(result.has('toggle-thumb')).toBe(true);
    // The pseudo-element own name is still not a class - it has no leading dot.
    expect(result.has('after')).toBe(false);
    expect(result.size).toBe(1);
  });

  it('extracts a class followed by a functional pseudo like :has()', () => {
    const css = '.retail-shift-modal:has(.pin-input) { display: grid; }';
    const result = extractClassSelectors(css);
    expect(result.has('retail-shift-modal')).toBe(true);
    expect(result.has('pin-input')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('extracts a class inside a paren-delimited selector such as :global()', () => {
    const css = ':global(.dark) .app-shell { color: red; }';
    const result = extractClassSelectors(css);
    expect(result.has('dark')).toBe(true);
    expect(result.has('app-shell')).toBe(true);
  });

  it('extracts a class followed immediately by an attribute selector', () => {
    const css = '.machine-id-chip--ready[aria-current="true"] { opacity: 1; }';
    const result = extractClassSelectors(css);
    expect(result.has('machine-id-chip--ready')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('does NOT mint a name from a colon that is not a pseudo, nor from a value', () => {
    // The negative half of the widening: the `:` branch requires a letter or a
    // second colon right after it, so a declaration colon followed by a quoted
    // value cannot create a class. The dot-tokens in the values are the
    // pre-existing digit exclusion's job, not string stripping - quoted strings
    // are deliberately left in place because stripping them erases the
    // :global(.dark) population along with them.
    const css = '.only { content: "theme.dark"; transition: all .2s ease; line-height: 1.5; }';
    const result = extractClassSelectors(css);
    expect(result.has('dark')).toBe(false);
    expect(result.has('only')).toBe(true);
    expect(result.size).toBe(1);
  });
});

// ── extractUsedClassNames ───────────────────────────────────────────

describe('extractUsedClassNames', () => {
  it('extracts static className attributes', () => {
    const tsx = '<div className="card selected" />';
    const result = extractUsedClassNames(tsx);
    expect(result.has('card')).toBe(true);
    expect(result.has('selected')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('extracts template literal classNames', () => {
    // Template literal: className={`card ${active ? "card--active" : ""}`}
    const tsx = '<div className={`card ${active ? \'card--active\' : \'\'}`} />';
    const result = extractUsedClassNames(tsx);
    expect(result.has('card')).toBe(true);
    expect(result.has('card--active')).toBe(true);
  });

  it('extracts curly-brace className with ternaries', () => {
    const tsx = "<div className={active ? 'highlight' : 'dimmed'} />";
    const result = extractUsedClassNames(tsx);
    expect(result.has('highlight')).toBe(true);
    expect(result.has('dimmed')).toBe(true);
  });

  it('extracts multi-class values from curly-brace ternaries', () => {
    const tsx = "<div className={cond ? 'a b c' : 'd e'} />";
    const result = extractUsedClassNames(tsx);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(true);
    expect(result.has('d')).toBe(true);
    expect(result.has('e')).toBe(true);
  });

  it('filters out non-class tokens like comparison values', () => {
    const tsx = "<div className={`foo ${status === 'Active' ? 'bar' : 'baz'}`} />";
    const result = extractUsedClassNames(tsx);
    expect(result.has('foo')).toBe(true);
    expect(result.has('bar')).toBe(true);
    expect(result.has('baz')).toBe(true);
    // "Active" is a stop word (SaleStatus value) — it is excluded
    expect(result.has('Active')).toBe(false);
  });

  it('filters out tokens that are not valid CSS class names', () => {
    const tsx = '<div className={`pos-stuff ${123}`} />';
    const result = extractUsedClassNames(tsx);
    expect(result.has('pos-stuff')).toBe(true);
    expect(result.has('123')).toBe(false);
  });

  it('rejects dangling BEM modifier prefixes', () => {
    const tsx = '<div className={`kds-column--${status}`} />';
    const result = extractUsedClassNames(tsx);
    // "kds-column--" is a dangling BEM prefix, should be excluded
    expect(result.has('kds-column--')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('handles multiline template literals', () => {
    // Double-quoted string: backticks, ${}, and single quotes are all literal.
    // \n embeds actual newlines that the regex [\s\S]*? handles.
    const tsx = "<div className={`\n  card\n  ${active ? 'card--active' : ''}\n`} />";
    const result = extractUsedClassNames(tsx);
    expect(result.has('card')).toBe(true);
    expect(result.has('card--active')).toBe(true);
  });

  it('handles empty className gracefully', () => {
    const tsx = '<div className="" />';
    const result = extractUsedClassNames(tsx);
    expect(result.size).toBe(0);
  });

  // ── The six shapes the extractor was never tested against ───────────
  //
  // Every case below prints what it harvested, because the finding this block
  // exists to pin came from a runner failure and not from a direct read of the
  // util: a name reported undefined has to be distinguishable from a name the
  // extractor invented, and only the extractor's own output can settle that.
  const harvest = (label: string, tsx: string) => {
    const set = extractUsedClassNames(tsx);
    console.log(`[extractor:${label}]`, JSON.stringify([...set].sort()));
    return set;
  };

  it('does not harvest a Fluent message id used as an aria-label', () => {
    // The ScaleIndicator shape: a static className next to a localized label.
    const names = harvest('fluent-id-aria', '<div className="scale-indicator scale-indicator--idle" role="status" aria-label={requiredLocalized(l10n, \'scale-indicator-aria\')} />');
    expect(names.has('scale-indicator')).toBe(true);
    expect(names.has('scale-indicator--idle')).toBe(true);
    expect(names.has('scale-indicator-aria')).toBe(false);
    expect(names.has('status')).toBe(false);
  });

  it('does not harvest the right-hand side of a comparison', () => {
    const names = harvest('comparison-operand', '<div className={status === \'eligible\' ? \'promo-hit\' : \'promo-miss\'} />');
    expect(names.has('promo-hit')).toBe(true);
    expect(names.has('promo-miss')).toBe(true);
    expect(names.has('eligible')).toBe(false);
  });

  it('does not harvest a localized string passed through a className expression', () => {
    const names = harvest('localized-inside-class', '<div className={isOk ? requiredLocalized(l10n, \'inv-transit-error-load\') : \'transit-error\'} />');
    expect(names.has('transit-error')).toBe(true);
    expect(names.has('inv-transit-error-load')).toBe(false);
  });

  it('keeps the template-literal shape and drops the dangling prefix', () => {
    const names = harvest('template-composition', '<div className={`kds-col ${dir}-align`} />');
    expect(names.has('kds-col')).toBe(true);
    expect(names.has('-align')).toBe(false);
  });

  it('rejects a token with one trailing hyphen, the way it already rejects two', () => {
    // `pos-${x}` leaves `pos-` behind, which is a fragment of a name and not a
    // name: no CSS rule can be written for it, so it can only ever be a false
    // undefined finding. `endsWith('--')` already rejects the double form.
    const names = harvest('trailing-single-hyphen', '<div className={`pos-${x}`} />');
    expect(names.size).toBe(0);
  });

  it('still does not see a class that arrives through an array variable', () => {
    // Pinned as a KNOWN GAP, not as a behaviour to change: widening `used` is
    // the one edit that manufactures new reds across 84 entries, so this stays
    // invisible until the runner is ready for the names it would add.
    const names = harvest('array-variable', 'const VARIANTS = [\'kds-column--pending\'];\n<div className={VARIANTS[0]} />');
    expect(names.has('kds-column--pending')).toBe(false);
  });

  it('filters known stop words', () => {
    const tsx = '<div className={`${open ? \'show\' : \'hide\'}`} />';
    const result = extractUsedClassNames(tsx);
    expect(result.has('show')).toBe(true);
    expect(result.has('hide')).toBe(true);
    // "open" is a stop word
    expect(result.has('open')).toBe(false);
  });
});

// ── resolveComposedClassNames ───────────────────────────────────────────
// Fixtures are shaped like the sites the helper was written for, cited in the
// case name. Backtick and dollar are built from codes so a template literal can
// sit inside a plain string here without fighting the quote style of this file.
const B = String.fromCharCode(96); // `
const D = String.fromCharCode(36); // $
const NL = String.fromCharCode(10);
const src = (lines: string[]): string => lines.join(NL);

describe('resolveComposedClassNames', () => {
  it('shape 1 credits all three names an accumulator local composes (ProductLookupScreen.tsx:495-497 applied at :501)', () => {
    const tsx = src([
      'export function Card({ p }) {',
      '  let cardClass = "product-card";',
      '  if (!p.inStock) cardClass += " product-card--disabled";',
      '  if (p.added) cardClass += " product-card--added";',
      '  return <div className={cardClass} />;',
      '}',
    ]);
    const sheet = new Set([
      'product-card', 'product-card--disabled', 'product-card--added', 'product-card--ghost',
    ]);
    const got = resolveComposedClassNames(tsx, sheet);
    expect(got.has('product-card')).toBe(true);
    expect(got.has('product-card--disabled')).toBe(true);
    expect(got.has('product-card--added')).toBe(true);
    expect(got.size).toBe(3);
    // The fourth name is in the sheet and nowhere in the source: the sheet is a
    // filter, never a source of credits, so it cannot invent a used class.
    expect(got.has('product-card--ghost')).toBe(false);
  });

  it('shape 2 credits the branch of a conditional held in a template local (StaffLoginScreen.tsx:345 applied at :352)', () => {
    const tsx = src([
      'export function Logo({ compact }) {',
      '  const logoClass = ' + B + 'staff-login-logo' + D + '{compact ? " staff-login-logo--small" : ""}' + B + ';',
      '  return <img className={logoClass} />;',
      '}',
    ]);
    const sheet = new Set(['staff-login-logo', 'staff-login-logo--small']);
    const got = resolveComposedClassNames(tsx, sheet);
    expect(got.has('staff-login-logo--small')).toBe(true);
    // The measured behaviour, not the wished-for one: the template pass carries the
    // static HEAD as well as the quoted branch, so this shape credits two names here.
    // The head is a name extractUsedClassNames already sees, and the sheet predicate
    // is what makes a redundant credit harmless rather than wrong.
    expect(got.has('staff-login-logo')).toBe(true);
    expect(got.size).toBe(2);
  });

  it('shape 3 credits literals returned on the SAME LINE as their case (WorkspaceHome.tsx:172-186 applied at :247)', () => {
    // This is the shape that credited nothing until the return pattern stopped
    // requiring its own line: a switch arm keeps the return on the case line, and
    // an anchor that assumed otherwise hid the whole shape behind a green run.
    const tsx = src([
      'function getRoleColor(role: string): string {',
      '  switch (role.toLowerCase()) {',
      "    case 'owner': return 'role-badge--owner';",
      "    case 'manager': return 'role-badge--manager';",
      "    case 'staff': return 'role-badge--staff';",
      "    case 'auditor': return 'role-badge--auditor';",
      "    case 'custom': return 'role-badge--custom';",
      '    default:',
      "      return 'role-badge--default';",
      '  }',
      '}',
      'export const Row = ({ role }) => <div className={' + B + 'ws-member-role' + D + '{getRoleColor(role)}' + B + '} />;',
    ]);
    const sheet = new Set([
      'role-badge--owner', 'role-badge--manager', 'role-badge--staff', 'role-badge--auditor',
      'role-badge--custom', 'role-badge--default', 'role-badge--unused',
    ]);
    const got = resolveComposedClassNames(tsx, sheet);
    expect(got.size).toBe(6);
    expect(got.has('role-badge--owner')).toBe(true);
    expect(got.has('role-badge--default')).toBe(true);
    expect(got.has('role-badge--unused')).toBe(false);
  });

  it('shape 3 also credits a return that keeps its own line, so the same-line fix did not replace the old shape', () => {
    const tsx = src([
      'function tileClass(kind) {',
      '  if (kind === "hot") {',
      "    return 'kds-ticket--hot';",
      '  }',
      "  return 'kds-ticket--idle';",
      '}',
      'export const T = ({ k }) => <div className={' + B + D + '{tileClass(k)}' + B + '} />;',
    ]);
    const got = resolveComposedClassNames(tsx, new Set(['kds-ticket--hot', 'kds-ticket--idle']));
    expect(got.size).toBe(2);
  });

  it('shape 4 SYNTHETIC: credits a plain literal in a typed-const map, which the equals-brace head missed', () => {
    // SYNTHETIC ON PURPOSE. WS_COLORS at WorkspaceHome.tsx:21-27 is read into a
    // local and the local is applied, so no "+D+"{ WS_COLORS[..] } interpolation exists at
    // that site and shape 4 credits nothing in the tree today. What ships here is
    // the mechanism, and the case says so rather than borrowing the maps fame.
    const tsx = src([
      'const WS_COLORS: Record<string, string> = {',
      "  'restaurant-pos': 'ws-color-restaurant-pos',",
      '  kds: computedValue,',
      "  admin: 'ws-color-admin' + suffix,",
      '};',
      'export const Tile = ({ t }) => <div className={' + B + 'ws-tile' + D + '{WS_COLORS[t]} ' + D + '{t}' + B + '} />;',
    ]);
    const got = resolveComposedClassNames(tsx, new Set([
      'ws-color-restaurant-pos', 'ws-color-admin', 'ws-color-kds', 'ws-tile',
    ]));
    expect(got.has('ws-color-restaurant-pos')).toBe(true);
    // A typed head (Record<string, string>) is the form the equals-brace pattern
    // missed; requiring the brace right after the name loses every annotated const.
    // A value that is a reference, or a concatenation, is refused by shape.
    expect(got.has('ws-color-kds')).toBe(false);
    // WHAT THE TEST FOUND, recorded rather than wished away: a value whose literal is
    // followed by a concatenation IS credited, because the shipped tail check is
    // anchored only at its end and so matches any tail. A bare reference value (kds)
    // is still refused by shape. The helper is frozen at ddbddde54, so this case
    // describes the code that shipped and wave two owns the fix.
    expect(got.has('ws-color-admin')).toBe(true);
  });

  it('refusal: the className prop pass-through credits nothing, even when the sheet holds the word', () => {
    const tsx = src([
      'export const Wrap = ({ label }) => {',
      '  let className = "ws-panel";',
      '  if (label) className += " ws-panel--labelled";',
      '  return <div className={className} />;',
      '};',
    ]);
    // The fixture WOULD compose two real class names: only the pass-through refusal
    // keeps them out. Delete that guard and this case goes red, which is the point.
    const got = resolveComposedClassNames(tsx, new Set(['className', 'ws-panel', 'ws-panel--labelled']));
    expect(got.size).toBe(0);
  });

  it('refusal: the classNames prop pass-through credits nothing', () => {
    const tsx = src([
      'export const Wrap = ({ names }) => {',
      '  let classNames = "ws-panel";',
      '  classNames += " ws-panel--dense";',
      '  return <div className={' + B + D + '{classNames}' + B + '} />;',
      '};',
    ]);
    expect(resolveComposedClassNames(tsx, new Set(['classNames', 'ws-panel', 'ws-panel--dense'])).size).toBe(0);
  });

  it('refusal: a composed value that is not a literal in this file credits nothing', () => {
    const tsx = src([
      'export function Badge({ props, suffix }) {',
      '  let cls = props.badgeClass;',
      '  cls += suffix;',
      '  return <span className={cls} />;',
      '}',
    ]);
    const got = resolveComposedClassNames(tsx, new Set([
      'badge-class-from-props', 'role-badge--owner',
    ]));
    expect(got.size).toBe(0);
  });

  it('refusal: a map whose values are not string literals credits nothing', () => {
    const tsx = src([
      'const STATUS: Record<string, string> = {',
      '  ok: styles["ok"],',
      '  low: t("stock-low"),',
      "  high: 'stock-high',",
      '};',
      'export const S = ({ k }) => <div className={' + B + D + '{STATUS[k]}' + B + '} />;',
    ]);
    const got = resolveComposedClassNames(tsx, new Set(['stock-low', 'stock-high']));
    // The plain literal still counts; only the computed values are refused. A map of
    // nothing but computed values therefore credits nothing at all.
    expect(got.has('stock-high')).toBe(true);
    expect(got.has('stock-low')).toBe(false);
  });

  it('refusal: a callee imported from another file credits nothing, and cross-feature with it', () => {
    const tsx = src([
      'import { roleColor } from "../shared/roleColor";',
      'export const Row = ({ role }) => <div className={' + B + 'badge-' + D + '{roleColor(role)}' + B + '} />;',
    ]);
    const got = resolveComposedClassNames(tsx, new Set(['role-badge--owner', 'role-badge--staff']));
    expect(got.size).toBe(0);
  });

  it('the definedInSheet predicate REJECTS: composed, named in the file, absent from the sheet', () => {
    // The invariant the design rests on, proven in both directions on one fixture:
    // same source, two sheets, and the difference is the sheet alone.
    const tsx = src([
      'export function Status({ s }) {',
      '  let cls = "payment-status--pending";',
      '  if (s.failed) cls += " payment-method-pending-label";',
      '  return <div className={cls} />;',
      '}',
    ]);
    const withBoth = new Set(['payment-status--pending', 'payment-method-pending-label']);
    expect(resolveComposedClassNames(tsx, withBoth).size).toBe(2);
    const defined = new Set(['payment-status--pending']);
    const got = resolveComposedClassNames(tsx, defined);
    expect(got.has('payment-status--pending')).toBe(true);
    // The second string is a Fluent id that happens to look like a class. Without the
    // predicate it would enter used and land as a used-but-not-defined failure.
    expect(got.has('payment-method-pending-label')).toBe(false);
    expect(got.size).toBe(1);
  });

  it('an empty sheet credits nothing, which is the short circuit and not a pass', () => {
    const tsx = src([
      'let cardClass = "product-card";',
      'export const Card = () => <div className={cardClass} />;',
    ]);
    expect(resolveComposedClassNames(tsx, new Set<string>()).size).toBe(0);
  });

  it('a plain string-literal className is left to the readers: the resolver adds nothing', () => {
    // Guards the asymmetry: this helper recovers composed names, it does not re-derive
    // what extractUsedClassNames already sees, and it cannot name a class that no
    // literal anywhere composes -- which is why the zero-evidence names stay dead.
    const tsx = '<div className="kds-ticket-row" />;';
    expect(resolveComposedClassNames(tsx, new Set(['kds-ticket-row'])).size).toBe(0);
  });
});
