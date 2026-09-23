/**
 * Hardcoded-UI-string scanner.
 *
 * The site's i18n is dictionary-first: prose reaches the page through the
 * locale lookup in `src/i18n`, an island's `labels` prop, or a value injected into an
 * `is:inline` script with `define:vars`. Two other kinds of string escaped that
 * route entirely, and both were invisible to every gate here — `audit-i18n.mjs`
 * only checks that the KEYS a file reads exist, and island-label-coverage only
 * checks a key list against its call sites, so a literal is simply not part of
 * either contract:
 *
 *   1. literal values on prose attributes (`aria-label`, `title`, `placeholder`,
 *      `alt`, `aria-roledescription`), and
 *   2. literals written into the DOM by a script (`btn.textContent = 'Copy'`),
 *      which is how the docs copy button, the enterprise-trial form errors and
 *      the mobile-menu close label each shipped English to /id/ pages.
 *
 * Anything found must be either routed through the dictionaries or declared in
 * `ALLOWED_LITERALS` with a reason — an English literal that is deliberately
 * English (a brand, an ARIA role token, a format example) is a decision, and the
 * point of the allowlist is that the decision is written down.
 *
 * Scope: the production site source. `public/admin/**` has its own string table
 * and its own gate (`admin-strings.test.ts`); test files quote the strings they
 * guard, so they are out of scope too.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(import.meta.dirname, '..');
const SCANNED = /\.(astro|tsx|ts)$/;

/** Attributes whose value is prose a person reads or hears. */
const PROSE_ATTRS = [
  'aria-label',
  'aria-placeholder',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
];

/** English function words. A literal containing one is prose, not a token. */
const ENGLISH_STOPWORDS = [
  'the',
  'is',
  'are',
  'you',
  'your',
  'our',
  'please',
  'not',
  'this',
  'that',
  'with',
  'from',
  'of',
  'and',
  'or',
  'for',
  'to',
  'was',
  'were',
  'will',
  'would',
  'can',
  'could',
  'should',
  'has',
  'have',
];

export interface AllowedLiteral {
  /** The exact literal, as it appears in the source. */
  value: string;
  /** Why it is English on purpose. */
  reason: string;
}

/**
 * English literals that must stay English.
 *
 * Every entry is a proper noun, an ARIA role token or a machine-readable
 * example — never prose a translator would rewrite.
 */
export const ALLOWED_LITERALS: AllowedLiteral[] = [
  { value: 'Discord', reason: 'Social handle: a proper noun, the same in every locale.' },
  { value: 'X (Twitter)', reason: 'Social handle: a proper noun, the same in every locale.' },
  { value: 'Instagram', reason: 'Social handle: a proper noun, the same in every locale.' },
  { value: 'Facebook', reason: 'Social handle: a proper noun, the same in every locale.' },
  { value: 'Telegram', reason: 'Social handle: a proper noun, the same in every locale.' },
  { value: 'kasir.mu', reason: 'The product name.' },
  {
    value: '404 — kasir.mu',
    reason: 'The 404 document title: an HTTP status code and the product name, no prose.',
  },
  {
    value: 'carousel',
    reason:
      'ARIA role description announced in place of `group`. Indonesian localises it only as the loanword "korsel", whose everyday sense is a ride at a fair, so the recognised English token is kept and the localized name sits beside it.',
  },
  {
    value: 'ABCD-1234',
    reason: 'Pairing-code format example: a shape a reader copies, not a sentence.',
  },
  {
    value: 'Website',
    reason:
      'The contact form honeypot label. It is `aria-hidden` and positioned off-screen, so no reader or screen reader ever receives it; naming it in a dictionary would put a key in the bundles that no translator can act on.',
  },
];

export interface UiStringOffender {
  file: string;
  line: number;
  rule: 'attribute' | 'dom-write' | 'text-node';
  value: string;
}

/** Walk the site source, skipping tests (they quote the guarded strings). */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === '__tests__') continue;
      sourceFiles(path, out);
    } else if (SCANNED.test(name)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Blank out comments so prose in a comment cannot be reported as a string.
 *
 * `//` is only treated as a comment when it is not preceded by `:`, which keeps
 * `https://…` inside a string intact.
 */
function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Blank out everything that is not markup, keeping every newline in place so
 * line numbers stay true: an Astro frontmatter block (whose TypeScript generics
 * look like tags) and `<script>`/`<style>` bodies (whose code is judged by the
 * attribute and DOM-write rules instead).
 */
function maskNonMarkup(text: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, ' ');
  return text
    .replace(/^---\n[\s\S]*?\n---\n/, blank)
    .replace(/<script\b[\s\S]*?<\/script>/gi, blank)
    .replace(/<style\b[\s\S]*?<\/style>/gi, blank);
}

const hasLetters = (value: string) => /[A-Za-z]/.test(value);
const hasStopword = (value: string) => {
  const words = value.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.some((word) => ENGLISH_STOPWORDS.includes(word));
};

/** Literal text of a template literal, with `${…}` holes removed. */
const literalText = (template: string) => template.replace(/\$\{[^}]*\}/g, ' ');

const allowed = new Set(ALLOWED_LITERALS.map((entry) => entry.value));

/**
 * Every literal UI string that is neither translated nor declared.
 *
 * An empty result is the contract: a new English `aria-label`, a new literal
 * `textContent`, or a new English sentence in markup fails this scan.
 */
export function findUiStringOffenders(root: string = SRC): UiStringOffender[] {
  const offenders: UiStringOffender[] = [];
  const proseAttrs = PROSE_ATTRS.join('|');
  const quotedAttr = new RegExp(`\\b(${proseAttrs})\\s*=\\s*(["'])([^"'\\n]*)\\2`, 'g');
  const templateAttr = new RegExp(`\\b(${proseAttrs})\\s*=\\s*\\{\\s*\`([^\`]*)\`\\s*\\}`, 'g');
  const domWrite = /\.(?:textContent|innerText|innerHTML)\s*=\s*(["'])([^"'\n]+)\1/g;
  // `el.innerHTML = `…${label}…`` — a template with no `${}` hole is a literal
  // in disguise, so it is judged as one; with holes, only the literal text is.
  const domWriteTemplate = /\.(?:textContent|innerText|innerHTML)\s*=\s*`([^`]*)`/g;
  const setAttribute = new RegExp(
    `setAttribute\\(\\s*(["'])(${proseAttrs})\\1\\s*,\\s*(["'])([^"'\\n]+)\\3`,
    'g',
  );
  const textNode = />([^<>{}]+)</g;

  for (const path of sourceFiles(root)) {
    const file = relative(SRC, path).split(sep).join('/');
    const raw = stripComments(readFileSync(path, 'utf8'));
    const source = maskNonMarkup(raw);
    // In markup, text nodes are read over the whole file rather than line by
    // line: a sentence written on its own line between two tags
    // (`<a …>\n  Skip to content\n</a>`) has no `>` before it on that line,
    // which is the shape the first version of this scanner missed.
    //
    // TS/TSX keeps the per-line rule instead: there, everything between a `>`
    // and a later `<` is code — `Array.from(rootRef.current.querySelectorAll`
    // read as "text" is a false positive, and JSX text is written inline anyway.
    if (file.endsWith('.astro')) {
      for (const match of source.matchAll(textNode)) {
        const value = match[1];
        if (!hasStopword(literalText(value))) continue;
        offenders.push({
          file,
          line: source.slice(0, match.index).split('\n').length,
          rule: 'text-node',
          value: value.replace(/\s+/g, ' ').trim().slice(0, 80),
        });
      }
    }
    source.split('\n').forEach((line, index) => {
      const at = index + 1;
      const push = (rule: UiStringOffender['rule'], value: string) => {
        const trimmed = value.trim();
        if (!hasLetters(trimmed) || allowed.has(trimmed)) return;
        offenders.push({ file, line: at, rule, value: trimmed });
      };

      for (const match of line.matchAll(quotedAttr)) push('attribute', match[3]);
      for (const match of line.matchAll(templateAttr)) {
        const text = literalText(match[2]);
        if (hasStopword(text)) push('attribute', text.trim());
      }
      for (const match of line.matchAll(domWrite)) push('dom-write', match[2]);
      for (const match of line.matchAll(domWriteTemplate)) {
        const raw = match[1];
        if (!raw.includes('${')) push('dom-write', raw);
        else if (hasStopword(literalText(raw))) push('dom-write', literalText(raw).trim());
      }
      for (const match of line.matchAll(setAttribute)) push('dom-write', match[4]);
      if (!file.endsWith('.astro')) {
        for (const match of line.matchAll(textNode)) {
          // Only prose: a single token is caught by the rules above, while an
          // English stopword means a sentence was written out in the markup.
          if (hasStopword(literalText(match[1]))) push('text-node', match[1]);
        }
      }
    });
  }
  return offenders;
}
