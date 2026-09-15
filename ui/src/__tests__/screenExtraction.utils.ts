// ── Shared utilities for CSS class extraction integrity tests ─────
//
// Import these functions into any screen-level test to assert that
// every className referenced in JSX has a matching CSS rule, no
// class is duplicated across files, and there are no dead classes.
//
// Usage:
//   import { extractClassSelectors, extractUsedClassNames } from
//     '../screenExtraction.utils';

/**
 * Extract every CSS class-name selector from a stylesheet string,
 * including selectors nested inside `@media` blocks.
 *
 * Ignores `@keyframes` definitions, pseudo-classes like `:root`,
 * attribute selectors, and id selectors.
 */
export function extractClassSelectors(css: string): Set<string> {
  const classes = new Set<string>();

  // Remove comments
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Remove @keyframes blocks so animation names don't pollute
  const noKeyframes = cleaned.replace(
    /@keyframes\s+\w+\s*\{[^}]*\}/g,
    '',
  );

  // Strip url() content so data-uri strings like `www.w3.org/2000/svg`
  // do not produce false-positive class names (e.g. `w3`).
  const noUrls = noKeyframes.replace(/url\([^)]*\)/g, '');

  // Match every `.class-name` token that sits in SELECTOR position, which is
  // to say: the character that terminates the name is one that can legally
  // follow a simple selector. That set is the block brace `{`, the selector
  // list comma `,`, whitespace (descendant or combinator), a further compound
  // part `.`, an attribute bracket `[`, the `)` that closes a functional
  // selector like `:global(.dark)`, and a `:` that opens a pseudo-class or
  // pseudo-element. The pseudo branch is deliberately narrower than a bare
  // `:`: it requires a letter or a second colon immediately after, so a
  // declaration colon (`content: "theme.dark"`) cannot mint a name, while
  // `.toggle-thumb::after` and `.retail-shift-modal:has(...)` do.
  //
  // Before this, the terminator set was `[.,\s{]` and a name followed by a
  // compound selector was silently dropped - 126 names across the tree, 121 of
  // them in themes/components.css. The dropping was one-directional: nothing
  // was ever OVER-reported, so the defect reads as a clean sheet rather than a
  // wrong finding, which is the worst kind.
  //
  // NOTE on preprocessing, because a previous scan got this wrong: quoted
  // strings are deliberately NOT stripped above. Stripping them removes most of
  // this very population (`:global(.dark)` lives in a quoted module context in
  // some sheets) and a scan that stripped them reported 9 names where the tree
  // holds 126. The digit-name exclusion below is what keeps values like `0.3s`
  // and `1.25rem` out, not string stripping.
  const selectorRe = /\.([\w-]+)(?=[.,\s{)\]]|\[|:(?=[A-Za-z:]))/g;
  let match: RegExpExecArray | null;
  while ((match = selectorRe.exec(noUrls)) !== null) {
    const name = match[1]!;
    if (!name.startsWith(':') && !/^\d/.test(name)) {
      classes.add(name);
    }
  }

  return classes;
}

/**
 * Extract only the CSS class names that are genuinely referenced in
 * JSX `className` attributes from a TSX source string.
 *
 * Handles:
 *   1. Static:   `className="pos-screen"`
 *   2. Template:  `className={`pos-cart-line-wrap ${...}`}`
 *   3. Curly-brace: `className={cond ? 'a b' : 'c d'}`
 *
 * IMPORTANTLY, this does NOT match l10n.getString() or
 * <Localized id="..."> calls — those are Fluent message ids,
 * not CSS class names, and would produce false positives.
 *
 * False-positive tokens (common comparison values, form field names,
 * partial BEM prefixes) are filtered by CANONICAL_STOP_WORDS and
 * the digit-prefix / dangling-BEM-suffix checks below.
 */

// ── Stop-word blocklist ─────────────────────────────────────────────
//
// These tokens appear inside className={...} expressions as comparison
// values or string literals that are NOT CSS class names.
//
const CANONICAL_STOP_WORDS = new Set([
  'add',
  'remove',
  'Active',
  'Completed',
  'Voided',
  'Pending',
  'open',
  'closed',
  'success',
  'failure',
  'info',
  'username',
  'pin',
  'all',
  'connected',
  'disconnected',
]);

/**
 * Valid CSS class names consist of letters, digits, hyphens,
 * underscores, and must not start with a digit.
 */
const VALID_CLASS_RE = /^[a-zA-Z_-][\w-]*$/;

function isNonClassToken(token: string): boolean {
  // Reject any token that isn't a valid CSS class name.
  if (!VALID_CLASS_RE.test(token)) return true;
  // A token that OPENS or CLOSES with a hyphen is a fragment of a template
  // interpolation, not a name. `kds-column--${status}` leaves `kds-column--`,
  // and `${dir}-align` leaves `-align`; the double form was already rejected
  // here and the single form was not, because VALID_CLASS_RE admits a hyphen at
  // either end. Neither shape can ever appear in a stylesheet as a selector a
  // rule could be written for, so each one could only ever arrive as a false
  // "used but undefined" finding against a component that never wrote it.
  if (token.startsWith('-') || token.endsWith('-')) return true;
  // Common non-class stop words.
  if (CANONICAL_STOP_WORDS.has(token)) return true;
  return false;
}

/**
 * Remove `${...}` interpolations from a template literal body, leaving the literal text.
 *
 * The obvious implementation -- `body.replace(/\$\{[^}]*\}/g, '')` -- is wrong whenever an
 * interpolation contains a `}` that is not its own terminator, and this repo has that case
 * in production: KdsHamburgerPanel.tsx:415 embeds the regex `/^#[0-9a-f]{6}$/i`, whose
 * quantifier `}` ends the naive match early. The strip then leaves the regex tail glued to
 * the class that preceded it -- `kds-hex-input$/i.test(hexDraft.value)` -- so the token no
 * longer equals `kds-hex-input`, and the dead-class check reported a live class as unused.
 * Counting braces instead of scanning to the first `}` fixes it for every nesting depth.
 */
function stripInterpolations(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '$' && body[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < body.length && depth > 0) {
        if (body[j] === '{') depth += 1;
        else if (body[j] === '}') depth -= 1;
        j += 1;
      }
      i = j - 1; // skip past the matching close brace
      continue;
    }
    out += body[i];
  }
  return out;
}

/**
 * Is the quote opening at `at` a class operand, or just a string the
 * expression happens to contain?
 *
 * Steps 2 and 3 below fish every `'...'` out of a className expression, which
 * is correct for ternaries (`cond ? 'a b' : 'c d'`) and wrong for two shapes
 * that look identical to a regex: the right-hand side of a comparison
 * (`status === 'eligible'`) and a Fluent message id passed to a localization
 * helper (`requiredLocalized(l10n, 'inv-transit-error-load')`). Both are names
 * in some OTHER namespace - a status enum, a message catalog - and the CSS
 * gate cannot see either namespace, so a harvested one is reported as a class
 * with no rule, which is how a lane ends up deleting markup that was never
 * there. Context, not token shape, is the only discriminator available: a
 * Fluent id and a BEM class are both lowercase kebab. The helper names are the
 * three this repo actually has; `formatMessage` returns 0 hits tree-wide and is
 * deliberately not listed. Every rule in that helper still only ever REMOVES a
 * candidate, so quoteIsClassOperand itself remains narrowing by construction.
 * What it no longer describes is the whole extractor: resolveComposedClassNames
 * below ADDS names to what the dead-class case credits, and what confines that
 * widening to case 3 is the sheet predicate and the call site, not this sentence.
 */
function quoteIsClassOperand(expr: string, at: number): boolean {
  const before = expr.slice(0, at).replace(/\s+$/, '');
  // Comparison operand: `x === 'y'`, `x != 'y'`, `x == 'y'`.
  if (/[=!]==?$/.test(before)) return false;
  // Localization call argument: the quote is an argument position (after `(`,
  // `,` or `[` in the head) and the nearest enclosing call is one of ours.
  if (/[,($]$/.test(before) && /(?:requiredLocalized|l10nErrorMessage|getString)\s*[(,][^()]*$/.test(before)) return false;
  return true;
}

export function extractUsedClassNames(tsx: string): Set<string> {
  const names = new Set<string>();

  // 1. Static className="..."
  const staticRe = /className="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(tsx)) !== null) {
    for (const token of m[1]!.split(/\s+/)) {
      if (token && !isNonClassToken(token)) names.add(token);
    }
  }

  // 2. Template literal className={`...`}
  // Supports multiline templates via [\s\S].
  const templateRe = /className=\{`([\s\S]*?)`\}/g;
  while ((m = templateRe.exec(tsx)) !== null) {
    const body = m[1]!;

    // Strip interpolation placeholders ${...} to reveal plain class tokens
    const plainPart = stripInterpolations(body);
    for (const token of plainPart.split(/\s+/)) {
      if (token && !isNonClassToken(token)) names.add(token);
    }

    // Also fish out quoted class names inside the interpolations
    // e.g. `${revealed ? 'pos-cart-line-wrap--revealed' : ''}`
    // Use [^']* (not [^']+) so an empty `''` alternative matches and is
    // consumed as a pair. With `+` the engine skipped `''`, resumed on its
    // closing quote, and then paired quotes off-by-one for the rest of the
    // template — swallowing every second real class name.
    const quotedRe = /'([^']*)'/g;
    let qm: RegExpExecArray | null;
    while ((qm = quotedRe.exec(body)) !== null) {
      if (!quoteIsClassOperand(body, qm.index)) continue;
      for (const token of qm[1]!.split(/\s+/)) {
        if (token && !isNonClassToken(token)) names.add(token);
      }
    }
  }

  // 3. Curly-brace className expressions (ternaries, function calls, etc.)
  // Extract all quoted strings from the expression and split by whitespace
  // to handle multi-value ternaries like `cond ? 'a b' : 'c d'`.
  // Template literals are excluded — they are handled by step 2 above.
  const curlyRe = /className=\{([^}]+)\}/g;
  while ((m = curlyRe.exec(tsx)) !== null) {
    const expr = m[1]!;
    // Skip template literals (already handled in step 2) and any
    // expressions containing `${}`, which would confuse the [^}]+ match.
    if (expr.includes('`') || expr.includes('$')) continue;
    const quotedRe = /'([^']*)'/g;
    let qm: RegExpExecArray | null;
    while ((qm = quotedRe.exec(expr)) !== null) {
      if (!quoteIsClassOperand(expr, qm.index)) continue;
      for (const token of qm[1]!.split(/\s+/)) {
        if (token && !isNonClassToken(token)) names.add(token);
      }
    }
  }

  return names;
}

// ── Composed class names (wave one: helper only, nothing wired) ───────
/**
 * resolveComposedClassNames credits class names the two readers above cannot see
 * because the value is composed first and applied second. Four shapes, all lexical
 * and single-file -- no parser, no typechecker:
 *   1. an accumulator local (let cardClass = ... plus two cardClass += ...) at
 *      features/products/ProductLookupScreen.tsx:495-497, applied at :501;
 *   2. a conditional inside a template held in a local (const logoClass = ...) at
 *      features/auth/StaffLoginScreen.tsx:345, applied at :352 and :359;
 *   3. a function returning class literals, named from an interpolation: getRoleColor
 *      at features/workspaces/WorkspaceHome.tsx:172-186, applied at :247;
 *   4. an UPPER_SNAKE map indexed in a template: WS_COLORS at
 *      WorkspaceHome.tsx:21-27, read at :777 and applied at :783 and :815.
 *
 * WHY THIS EXISTS, in this repo own words -- two production files were reshaped so
 * the extractor could see them: features/kds/components/StationSelectorModal.tsx:45
 * records that a value was put into a form the static scan can resolve, and
 * features/kds/components/ModifierBadge.tsx:69 is the same class of workaround.
 * Authors should not have to edit production code to suit a test extractor; this
 * helper is the alternative, recorded here so the next author does not invent another.
 *
 * THE INVARIANT THAT MAKES IT SAFE: a harvested string is credited ONLY if it is
 * already in definedInSheet, the set of classes the caller own stylesheet defines.
 * The caller must supply that set -- there is no default, because a default that
 * credited everything would turn a Fluent message id or a status-enum value into a
 * class and land it as a used-but-not-defined failure in the OTHER direction.
 * Intersecting with the sheet keeps the widening one-directional: it can only
 * REMOVE a dead-class finding, never create a missing-class one.
 *
 * WHAT IT REFUSES, each pinned by a case in screenExtraction.utils.test.ts: the
 * className / classNames prop pass-throughs, because crediting those is how a guard
 * starts believing anything with the word className in it; any string that is not a
 * literal in this file; map entries whose value is not a plain quoted literal; and
 * every cross-file or cross-feature composition, since the callee or the map has to
 * be declared here. That last refusal is deliberate -- a class one feature declares
 * and another composes stays out of reach, which is the ledger axis, not this one.
 * The 44 zero-evidence names are out of reach by the same construction: no literal
 * anywhere names them, so nothing here can excuse them.
 *
 * WIRED, AND WHAT THAT COSTS: the dead-class case in screenExtraction.test.ts now
 * calls this with the own sheet's class set and tests composed.has(cls) in that
 * case only. Nothing is added to `used`, so the used-but-not-defined case is
 * untouched and can still go red. What changed is that a name a broad prefix was
 * excusing may now be excused for a reason -- a literal in the same file reaching
 * a className sink. This is a PERMISSIVE change: it can only remove dead-class
 * findings and never create one, and every name it frees is counted in the
 * census recorded in that commit.
 */
export function resolveComposedClassNames(
  tsx: string,
  definedInSheet: ReadonlySet<string>,
): Set<string> {
  const found = new Set<string>();
  // An empty sheet credits nothing on its own, because every credit below is
  // gated on definedInSheet.has(). A size === 0 branch could not be reached by
  // any test that distinguishes it from the predicate, so none is claimed here;
  // the branch that was here is gone rather than kept as decoration.

  const CLASS_TOKEN = /[a-z][A-Za-z0-9_-]*/g;
  const creditTokens = (src: string): void => {
    for (const m of src.matchAll(CLASS_TOKEN)) {
      if (definedInSheet.has(m[0])) found.add(m[0]);
    }
  };
  const QUOTED_SINGLE = /'([^']*)'/g;
  const QUOTED_DOUBLE = /"([^"]*)"/g;
  const TICK = '`';
  const NEWLINE = '\n';
  const APOS = String.fromCharCode(39); // a single quote, for slicing a literal
  const COLON = String.fromCharCode(58);
  // Quoted operands carry the branches of a conditional; the static text of a
  // template literal carries its head and tail, with interpolated expressions
  // stripped first so an expression never contributes its own identifiers.
  const credit = (src: string): void => {
    for (const m of src.matchAll(QUOTED_SINGLE)) creditTokens(m[1] ?? '');
    for (const m of src.matchAll(QUOTED_DOUBLE)) creditTokens(m[1] ?? '');
    const parts = src.split(TICK);
    for (let i = 1; i < parts.length; i += 2) creditTokens(stripInterpolations(parts[i] ?? ''));
  };

  // Shapes 1 and 2. The name has to reach a className bare -- as the whole
  // attribute value, or as an interpolation of itself -- and be written here.
  // One line per right-hand side is the reach: every site this serves keeps its
  // literals on the assigning line, and a build that does not is not credited.
  const PASS_THROUGH = new Set(['className', 'classNames']);
  const ATTR_NAME = /className=\{\s*([A-Za-z_$][\w$]*)\s*\}/g;
  const TEMPLATE_NAME = /\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g;
  const localNames = new Set<string>();
  for (const m of tsx.matchAll(ATTR_NAME)) localNames.add(m[1]!);
  for (const m of tsx.matchAll(TEMPLATE_NAME)) localNames.add(m[1]!);
  const rightHandSide = (line: string, name: string): string | null => {
    for (const op of [' =', ' +=', '=', '+=']) {
      const i = line.indexOf(name + op);
      if (i >= 0) return line.slice(i + name.length + op.length);
    }
    return null;
  };
  for (const name of localNames) {
    if (PASS_THROUGH.has(name)) continue;
    for (const line of tsx.split(NEWLINE)) {
      const rhs = rightHandSide(line, name);
      if (rhs) credit(rhs);
    }
  }

  // Shape 3: an interpolation that calls a function. The function must be
  // declared in this source and only its return literals count, so a callee
  // declared elsewhere is the cross-file refusal, not a miss to chase.
  const TEMPLATE_CALL = /\$\{\s*([A-Za-z_$][\w$]*)\s*\(/g;
  // A switch arm keeps its return on the case line, so a return is matched
  // anywhere in a body line, not only at its start.
  const RETURN_LINE = /\breturn\s+/;
  for (const m of tsx.matchAll(TEMPLATE_CALL)) {
    const body = declarationBlock(tsx, ['function ' + m[1] + '(', 'const ' + m[1], 'let ' + m[1]]);
    if (!body) continue;
    for (const line of body.split(NEWLINE)) if (RETURN_LINE.test(line)) credit(line);
  }

  // Shape 4: an interpolation that indexes an UPPER_SNAKE map declared here. Only
  // a value that is a plain single-quoted literal counts, so a map of computed
  // values, nested templates or bare references credits nothing at all.
  const TEMPLATE_INDEX = /\$\{\s*([A-Z][A-Z0-9_]*)\s*\[/g;
  for (const m of tsx.matchAll(TEMPLATE_INDEX)) {
    const block = declarationBlock(tsx, ['const ' + m[1], 'let ' + m[1]]);
    if (!block) continue;
    for (const raw of block.split(NEWLINE)) {
      const entry = raw.trim();
      const colon = entry.indexOf(COLON);
      if (colon < 0) continue;
      const value = entry.slice(colon + 1).trim();
      if (!value.startsWith(APOS)) continue; // not a plain literal: refused by shape
      const close = value.indexOf(APOS, 1);
      if (close < 0) continue;
      // Anchored at BOTH ends. Unanchored, [\s,]*$ matches any tail, so a value
      // like 'ws-color-admin' + suffix passed as a plain literal -- found by the
      // synthetic map case going red on the first run after it was written.
      if (!/^[,\s]*$/.test(value.slice(close + 1))) continue;
      creditTokens(value.slice(1, close));
    }
  }

  return found;
}

/**
 * The text from the first { after the earliest matching declaration head through
 * its matching }, counted by braces rather than indentation. An absent or
 * unbalanced head returns null: a helper whose job is to stop calling things dead
 * has to be able to say nothing.
 */
function declarationBlock(tsx: string, heads: string[]): string | null {
  const OPEN = '{';
  const CLOSE = '}';
  let start = -1;
  for (const h of heads) {
    const i = tsx.indexOf(h);
    if (i >= 0 && (start < 0 || i < start)) start = i;
  }
  if (start < 0) return null;
  const rest = tsx.slice(start);
  const k = rest.indexOf(OPEN);
  if (k < 0) return null;
  let depth = 0;
  for (let j = k; j < rest.length; j += 1) {
    if (rest[j] === OPEN) depth += 1;
    else if (rest[j] === CLOSE) {
      depth -= 1;
      if (depth === 0) return rest.slice(k, j + 1);
    }
  }
  return null;
}
