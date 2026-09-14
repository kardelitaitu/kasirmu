import { describe, it, expect } from 'vitest';
import { extractClassSelectors, extractUsedClassNames } from './screenExtraction.utils';

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
