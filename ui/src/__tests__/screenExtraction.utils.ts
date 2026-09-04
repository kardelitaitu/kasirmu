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

  // Match every `.class-name` token that precedes `{`, `,`, `.`,
  // or whitespace. The `.` in the lookahead handles compound
  // selectors like `.class1.class2`.
  // CSS values like `0.3s` or `1.25rem` also match this regex (because
  // `\w` includes digits), so we exclude names starting with a digit.
  const selectorRe = /\.([\w-]+)(?=[.,\s{])/g;
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
  // Dangling BEM prefix from template literal `${variable}` parts
  // (e.g. `kds-column--${status}` → the plain part is `kds-column--`)
  if (token.endsWith('--')) return true;
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
      for (const token of qm[1]!.split(/\s+/)) {
        if (token && !isNonClassToken(token)) names.add(token);
      }
    }
  }

  return names;
}
