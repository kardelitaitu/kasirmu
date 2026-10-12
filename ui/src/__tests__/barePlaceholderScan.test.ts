/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── barePlaceholderScan unit tests ────────────────────────────────
//
// Pins the bare-`{}` placeholder guard (round 156). Fluent treats a
// placeable containing a bare identifier — `{ created }` instead of
// `{ $created }` — as a *message reference* to a message of that name;
// when no such message exists, the real runtime renders the literal
// `{created}` text and records an error. Rounds 150–152 shipped this
// defect in the Apply chip and discard dialog; only a mocked Fluent
// (which interpolates by hand) hid it. This scanner is the permanent
// guard: every locale file must be free of bare placeholders whose
// identifier is not a defined message.

import { describe, expect, it } from 'vitest';
import {
  findBarePlaceholders,
  scanLocaleFiles,
  messageDeclaredVars,
  findLocalizedSites,
  scanLocalizedVars,
  scanTranslationVars,
  scanAttributeOmissions,
  localizedAttributeOmission,
  localizedAttributeMissing,
  translationVarDrift,
  varsMismatch,
  loadEnContracts,
  loadIdContracts,
  loadLocaleSources,
  loadTsxSources,
  loadLocalizedSites,
  type MessageVarContract,
} from '@/i18n/barePlaceholderScan';

describe('findBarePlaceholders', () => {
  it('flags a bare identifier placeholder with no matching message', () => {
    expect(findBarePlaceholders('chip = { created } created')).toEqual([
      { line: 1, ident: 'created' },
    ]);
  });

  it('ignores $-variables', () => {
    expect(findBarePlaceholders('chip = { $created } created')).toEqual([]);
  });

  it('ignores term references', () => {
    expect(findBarePlaceholders('brand = {-oz-brand} is great')).toEqual([]);
  });

  it('ignores a message reference whose message is defined', () => {
    const src = ['retry = Retry', 'cta = { retry } now'].join('\n');
    expect(findBarePlaceholders(src)).toEqual([]);
  });

  it('flags a bare placeholder inside a message attribute', () => {
    const src = ['msg = value', '    .label = { oops }'].join('\n');
    expect(findBarePlaceholders(src)).toEqual([{ line: 2, ident: 'oops' }]);
  });

  it('reports the line number of the offending placeholder', () => {
    const src = ['first = ok', 'second = ok', 'third = { nope }'].join('\n');
    expect(findBarePlaceholders(src)).toEqual([{ line: 3, ident: 'nope' }]);
  });

  it('does not flag braces that are not bare identifiers (quoted strings, selectors)', () => {
    const src = [
      'lit = { "" } literal brace',
      'sel = { $count ->',
      '    [one] One',
      '   *[other] { $count }',
      '}',
    ].join('\n');
    expect(findBarePlaceholders(src)).toEqual([]);
  });
});

describe('scanLocaleFiles (repo integrity)', () => {
  it('finds no bare placeholders in any locale bundle', () => {
    // The round-150/152 defect shipped because no gate formatted the
    // keys through the real runtime. Every .ftl / .id.ftl must be
    // free of bare `{ ident }` placeholders whose ident is not a
    // defined message — or this test names the file and line.
    expect(scanLocaleFiles()).toEqual([]);
  });
});

// ── Localized-vars cross-check (round 164) ────────────────────────

describe('messageDeclaredVars', () => {
  it('collects $vars from the message value', () => {
    expect(messageDeclaredVars('counts = { $onlyInCurrent } and { $other } here')).toEqual(
      new Map([['counts', { value: ['onlyInCurrent', 'other'], attributes: new Map() }]]),
    );
  });

  it('collects $vars per message attribute', () => {
    const src = ['msg = body', '    .title = { $tier } tier'].join('\n');
    expect(messageDeclaredVars(src)).toEqual(
      new Map([['msg', { value: [], attributes: new Map([['title', ['tier']]]) }]]),
    );
  });

  it('keeps multiple attributes separate', () => {
    const src = ['msg = { $body }', '    .title = { $tier }', '    .aria = { $tier } here'].join('\n');
    expect(messageDeclaredVars(src)).toEqual(
      new Map([['msg', { value: ['body'], attributes: new Map([['title', ['tier']], ['aria', ['tier']]]) }]]),
    );
  });

  it('treats member access on a variable as the base name', () => {
    expect(messageDeclaredVars('hi = Hello { $user.name }')).toEqual(
      new Map([['hi', { value: ['user'], attributes: new Map() }]]),
    );
  });

  it('returns an empty contract for a plain message', () => {
    expect(messageDeclaredVars('plain = Just text')).toEqual(
      new Map([['plain', { value: [], attributes: new Map() }]]),
    );
  });

  it('captures vars from term call arguments (the real-parser AST walk sees them)', () => {
    // A `-term($name)` call passes a message-level variable inside parens,
    // not a `{$var}` placeable — a hand-rolled regex would miss it, but
    // the real `@fluent/bundle` AST walk finds the `var` node.
    expect(messageDeclaredVars('x = {-brand($name)} rocks')).toEqual(
      new Map([['x', { value: ['name'], attributes: new Map() }]]),
    );
  });

  it('keeps per-message contracts separate across multiple messages', () => {
    const src = ['a = { $x }', 'b = { $y }'].join('\n');
    expect(messageDeclaredVars(src)).toEqual(
      new Map([
        ['a', { value: ['x'], attributes: new Map() }],
        ['b', { value: ['y'], attributes: new Map() }],
      ]),
    );
  });
});

describe('findLocalizedSites', () => {
  it('reads explicit vars keys', () => {
    const src = '<Localized id="k" vars={{ a: 1, b: 2 }}>x</Localized>';
    expect(findLocalizedSites(src)).toEqual([{ id: 'k', varsKeys: ['a', 'b'], attrsKeys: [], line: 1 }]);
  });

  it('reads shorthand vars keys and quoted keys', () => {
    const src = "<Localized id='k' vars={{ created, 'named': 1 }}>x</Localized>";
    const [site] = findLocalizedSites(src);
    expect(site!.varsKeys!.sort()).toEqual(['created', 'named']);
    expect(site!.attrsKeys).toEqual([]);
  });

  it('ignores nested object values and spreads', () => {
    const src = '<Localized id="k" vars={{ a: { deep: true }, b: 1 }}>x</Localized>';
    expect(findLocalizedSites(src)).toEqual([{ id: 'k', varsKeys: ['a', 'b'], attrsKeys: [], line: 1 }]);
  });

  it('reads the attrs keys the site localizes', () => {
    const src = '<Localized id="k" attrs={{ "aria-label": true }} vars={{ name: 1 }}>x</Localized>';
    expect(findLocalizedSites(src)).toEqual([{ id: 'k', varsKeys: ['name'], attrsKeys: ['aria-label'], line: 1 }]);
  });

  it('reports a site with no vars prop as an empty set', () => {
    expect(findLocalizedSites('<Localized id="k">x</Localized>')).toEqual([
      { id: 'k', varsKeys: [], attrsKeys: [], line: 1 },
    ]);
  });

  it('marks an unresolvable vars expression as null (skipped)', () => {
    expect(findLocalizedSites('<Localized id="k" vars={t(vars)}>x</Localized>')).toEqual([
      { id: 'k', varsKeys: null, attrsKeys: [], line: 1 },
    ]);
  });

  it('reports the site line across multiline props', () => {
    const src = [
      '<div>',
      '  <Localized',
      '    id="k"',
      '    vars={{ count: 1 }}',
      '  >',
      '    text',
      '  </Localized>',
      '</div>',
    ].join('\n');
    expect(findLocalizedSites(src)).toEqual([{ id: 'k', varsKeys: ['count'], attrsKeys: [], line: 2 }]);
  });
});

describe('varsMismatch', () => {
  const contract = {
    value: ['name'],
    attributes: new Map([
      ['aria-label', ['name']],
      ['title', ['tier']],
    ]),
  };

  it('is exact when the site provides exactly the value vars', () => {
    expect(varsMismatch(['name'], contract, [])).toBeNull();
  });

  it('flags a missing value var', () => {
    expect(varsMismatch([], contract, [])).toEqual({ missing: ['name'], extra: [] });
  });

  it('flags an extra (drift) key', () => {
    expect(varsMismatch(['name', 'count'], contract, [])).toEqual({
      missing: [],
      extra: ['count'],
    });
  });

  it('charges an attribute\'s vars only when the site localizes it', () => {
    // Not localizing the title attribute must not require `tier`.
    expect(varsMismatch(['name'], contract, ['title'])).toEqual({
      missing: ['tier'],
      extra: [],
    });
    expect(varsMismatch(['name', 'tier'], contract, ['title'])).toBeNull();
  });

  it('does not charge attribute vars when attrs are unresolvable (null)', () => {
    expect(varsMismatch(['name'], contract, null)).toBeNull();
  });
});

// ── Translation var drift (round 165) ────────────────────────────
//
// The round-164 gate aligns every <Localized> site to the EN contract,
// so a site can only ever provide the vars the en message declares.
// An id translation that references ANY other variable name therefore
// renders a literal `{$var}` placeholder for Indonesian users. The
// check is subset-direction: a translation DROPPING a var is fine in
// Fluent (unused vars are ignored) — only drift (a var the en
// counterpart never declares) is a defect. That is why no skip list is
// needed: legitimate omissions are already safe by construction.

describe('translationVarDrift', () => {
  const en: MessageVarContract = {
    value: ['number', 'count'],
    attributes: new Map([['aria-label', ['number']]]),
  };

  it('is clean when the translation mirrors the en contract', () => {
    expect(
      translationVarDrift(
        { value: ['number', 'count'], attributes: new Map([['aria-label', ['number']]]) },
        en,
      ),
    ).toEqual([]);
  });

  it('allows a translation to DROP a var (subset direction — unused vars are safe)', () => {
    expect(translationVarDrift({ value: ['count'], attributes: new Map() }, en)).toEqual([]);
  });

  it('flags a value var the en message never declares (name drift)', () => {
    expect(translationVarDrift({ value: ['count', 'nomor'], attributes: new Map() }, en)).toEqual([
      { attr: 'value', vars: ['nomor'] },
    ]);
  });

  it('flags an attribute var the en attribute never declares', () => {
    expect(
      translationVarDrift(
        { value: [], attributes: new Map([['aria-label', ['nomor']]]) },
        en,
      ),
    ).toEqual([{ attr: 'aria-label', vars: ['nomor'] }]);
  });

  it('ignores an id-only attribute (never localized — the site picks attrs from en)', () => {
    expect(
      translationVarDrift(
        { value: [], attributes: new Map([['title', ['nomor']]]) },
        en,
      ),
    ).toEqual([]);
  });

  it('ignores an en-only attribute (attribute omission is a separate defect class)', () => {
    expect(translationVarDrift({ value: [], attributes: new Map() }, en)).toEqual([]);
  });
});

describe('scanTranslationVars (repo integrity)', () => {
  it('finds no var drift across every id bundle against its en counterpart', () => {
    // An id message referencing a var its en counterpart never declares
    // renders a literal placeholder for Indonesian users — the site can
    // only provide the en contract's vars (round 164 gates that). This
    // runs in the same gate as the en-side cross-check.
    expect(scanTranslationVars()).toEqual([]);
  });
});

// ── Shared bundle/site maps (round 168) ──────────────────────────
//
// The four scans each globbed and parsed the bundles themselves, with
// three different locale glob forms in play. These pins lock the
// shared maps so the globs live in exactly one place: a regression to
// the round-156 all-locale glob (matching id files) would silently
// overwrite en contracts with the shorter id translations.

describe('shared bundle and site maps (round 168)', () => {
  it('loads the en contracts with the canonical attribute vars', () => {
    // Discriminating: `customers-add` exists ONLY in the id bundles, so
    // if the en glob ever matched id files, en contracts would gain it —
    // this pin fails (the round-164 bug). The var-level discriminator
    // (id used to DROP `$colour`) was retired when the id translation
    // gained the var for swatch parity, so key-set membership is the
    // remaining lock on the glob direction.
    const en = loadEnContracts();
    expect(en.get('category-colour-swatch-aria')!.attributes.get('aria-label')).toEqual(['colour']);
    expect(en.has('customers-add')).toBe(false);
  });

  it('loads the id contracts keeping the parity var', () => {
    // Parity fix 6840fbf3 added `$colour` to the id translation, so both
    // bundles now declare it. The id-only `customers-add` key must still
    // be present — it proves the id glob is reading id files, not en.
    const id = loadIdContracts();
    expect(id.get('category-colour-swatch-aria')!.attributes.get('aria-label')).toEqual(['colour']);
    expect(id.has('customers-add')).toBe(true);
  });

  it('loads every production site with its attrs', () => {
    const sites = loadLocalizedSites();
    const fastpin = [...sites.entries()].find(([path]) => path.endsWith('FastPINOverlay.tsx'));
    expect(fastpin).toBeDefined();
    const clear = fastpin![1].find((site) => site.id === 'staff-login-clear-aria');
    expect(clear!.attrsKeys).toEqual(['aria-label']);
  });

  it('excludes test files from the tsx map', () => {
    expect(Object.keys(loadTsxSources()).some((p) => p.includes('__tests__'))).toBe(false);
  });

  it('serves the round-156 all-locale sources for the bare-placeholder scan', () => {
    const all = loadLocaleSources();
    expect(Object.keys(all).some((p) => p.endsWith('.id.ftl'))).toBe(true);
  });
});

// ── Attribute omission (round 166) ───────────────────────────────
//
// A site localizes an attribute via `attrs={{ 'aria-label': true }}`;
// when the id translation omits that attribute (the message exists but
// lacks the key), the attribute is silently unset for Indonesian
// users — no error, no fallback. Key-level parity can't see it (it
// counts messages, not attributes); the var drift scan can't see it
// (no vars involved). Only the site's attrs tell us which attributes
// are actually rendered, so the gate is driven by them.

describe('localizedAttributeOmission', () => {
  const enAttrs = new Set(['aria-label', 'title']);

  it('is clean when the id translation keeps every localized attribute', () => {
    expect(localizedAttributeOmission(['aria-label'], enAttrs, new Set(['aria-label']))).toEqual([]);
  });

  it('flags a localized attribute the id translation omits', () => {
    expect(localizedAttributeOmission(['aria-label'], enAttrs, new Set())).toEqual(['aria-label']);
  });

  it('flags only the omitted ones from a mixed set', () => {
    expect(
      localizedAttributeOmission(['aria-label', 'title'], enAttrs, new Set(['title'])),
    ).toEqual(['aria-label']);
  });

  it('ignores an attribute en ALSO lacks (site-side bug, not translation drift)', () => {
    expect(localizedAttributeOmission(['placeholder'], enAttrs, new Set())).toEqual([]);
  });

  it('is clean for an empty attrs set', () => {
    expect(localizedAttributeOmission([], enAttrs, new Set())).toEqual([]);
  });
});

// Round 167: the en-side of the same gate. A site-localized attribute
// missing from the EN message is silently unset for ALL users — the
// JSX fallback (usually hardcoded English) shows instead. The data
// showed this splits into two live sub-classes: absent from both
// bundles (26 sites) and present only in id (5 — en users still lose
// it). Sites align to the en contract (rounds 164-166), so the
// invariant is: every localized attr must exist in en.

describe('localizedAttributeMissing', () => {
  const enAttrs = new Set(['aria-label']);

  it('flags a localized attribute absent from the en message', () => {
    expect(localizedAttributeMissing(['placeholder'], enAttrs)).toEqual(['placeholder']);
  });

  // (The id-only sub-class — attr present in id but not en — is the
  // same decision here: en is canonical, id presence is irrelevant to
  // whether EN users lose the attribute. The scan's repo-integrity
  // assertion covers it against the real tree.)

  it('flags only the en-missing ones from a mixed set', () => {
    expect(localizedAttributeMissing(['placeholder', 'aria-label'], enAttrs)).toEqual(['placeholder']);
  });

  it('is clean when every localized attribute exists in en', () => {
    expect(localizedAttributeMissing(['aria-label'], enAttrs)).toEqual([]);
  });

  it('is clean for an empty attrs set', () => {
    expect(localizedAttributeMissing([], enAttrs)).toEqual([]);
  });
});

describe('scanAttributeOmissions (repo integrity)', () => {
  it('finds no localized attribute missing or omitted by any translation', () => {
    // Round 166: an attribute the id translation omits is silently
    // unset for Indonesian users. Round 167: an attribute absent from
    // the EN message is silently unset for everyone (JSX English
    // fallback). Driven by the site attrs, so only rendered
    // attributes count.
    expect(scanAttributeOmissions()).toEqual([]);
  });
});

describe('scanLocalizedVars (repo integrity)', () => {
  it('finds no vars mismatches across every Localized site and en bundle', () => {
    // A site whose vars keys don't exactly match the message's declared
    // $vars renders the raw id at runtime — invisible to mocked Fluent
    // and to bundle parity (which counts keys, not variables). This
    // scan runs inside the lint:i18n gate so a mismatch fails closed
    // with the file, line, id, and the missing/extra names.
    expect(scanLocalizedVars()).toEqual([]);
  });
});
