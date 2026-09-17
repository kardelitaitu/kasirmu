// ── Bare Fluent placeholder scanner ───────────────────────────────
//
// Fluent parses `{ created }` — a placeable whose content is a bare
// identifier with no `$` (variable) or `-` (term) prefix — as a
// *message reference*. When no message of that name exists, the real
// runtime renders the literal `{created}` text and records an error.
// Rounds 150–152 shipped exactly that defect in the Apply chip and
// discard dialog; mocked-Fluent tests interpolate by hand and could
// never see it. This module is the permanent guard: a pure per-file
// scan plus a repo-wide scan over every locale bundle, wired into the
// i18n lint gate so a bare placeholder can never ship again.

export interface BarePlaceholderHit {
  file: string;
  line: number;
  ident: string;
}

/** A placeable holding a bare identifier (no `$` / `-` prefix). */
const BARE_PLACEHOLDER = /\{\s*([a-zA-Z][\w-]*)\s*\}/g;

/** Message ids (and the id prefix of each line) in an FTL source. */
function messageIds(source: string): Set<string> {
  return new Set([...source.matchAll(/^([\w-]+)\s*=/gm)].map((m) => m[1]!));
}

/**
 * Find bare-`{}` placeholders in one FTL source. A placeholder whose
 * identifier matches a message defined in the same file is a
 * legitimate message reference and is ignored; anything else is the
 * round-150 defect (renders literally in the real runtime).
 */
export function findBarePlaceholders(
  source: string,
): Array<{ line: number; ident: string }> {
  const ids = messageIds(source);
  const hits: Array<{ line: number; ident: string }> = [];
  for (const match of source.matchAll(BARE_PLACEHOLDER)) {
    const ident = match[1]!;
    if (ids.has(ident)) continue;
    hits.push({ line: source.slice(0, match.index).split('\n').length, ident });
  }
  return hits;
}

// ── Shared bundle/site maps (round 168) ──────────────────────────
//
// Every scan globs the same files and parses the same bundles; these
// are the single source of truth for the glob forms (three different
// locale shapes existed before). The pins in the test file lock them:
// a regression to the all-locale glob would silently overwrite en
// contracts with the shorter id translations.

/** Every locale source, en and id (the round-156 bare-placeholder glob). */
export function loadLocaleSources(): Record<string, string> {
  return import.meta.glob('@/locales/*.ftl', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
}

/** EN-only sources — canonical for the var/attr contracts (round 164). */
export function loadEnSources(): Record<string, string> {
  // The id bundles are excluded in CODE rather than with a `!` glob pattern. After
  // P9a moved the corpus to shared-ui/locales/ the negative pattern pointed at a
  // directory that no longer exists, so it excluded nothing and the EN contract map
  // silently gained id-only keys — caught by the `customers-add` pin below. A filter
  // cannot rot that way, because it reads the same keys the positive glob produced.
  return Object.fromEntries(
    Object.entries(loadLocaleSources()).filter(([path]) => !path.endsWith('.id.ftl')),
  );
}

/** Indonesian sources. */
export function loadIdSources(): Record<string, string> {
  return import.meta.glob('@/locales/*.id.ftl', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
}

/** Production `.tsx` sources — tests excluded (the parity gate's domain). */
export function loadTsxSources(): Record<string, string> {
  return import.meta.glob(['../**/*.tsx', '!../**/__tests__/**'], {
    query: '?raw',
    import: 'default',
    eager: true,
  });
}

/** Every message id → variable contract across the EN bundles. */
export function loadEnContracts(): Map<string, MessageVarContract> {
  const map = new Map<string, MessageVarContract>();
  for (const source of Object.values(loadEnSources())) {
    for (const [id, contract] of messageDeclaredVars(source)) map.set(id, contract);
  }
  return map;
}

/** Every message id → variable contract across the Indonesian bundles. */
export function loadIdContracts(): Map<string, MessageVarContract> {
  const map = new Map<string, MessageVarContract>();
  for (const source of Object.values(loadIdSources())) {
    for (const [id, contract] of messageDeclaredVars(source)) map.set(id, contract);
  }
  return map;
}

/** Every production tsx file → its `<Localized>` sites. */
export function loadLocalizedSites(): Map<string, LocalizedSite[]> {
  const map = new Map<string, LocalizedSite[]>();
  for (const [path, source] of Object.entries(loadTsxSources())) {
    map.set(path, findLocalizedSites(source));
  }
  return map;
}

/**
 * Scan every locale bundle in `src/locales` (both `.ftl` and
 * `.id.ftl`) for bare placeholders. Returns one hit per occurrence,
 * naming the file and line — the caller's `expect(...).toEqual([])`
 * turns a regression into a readable report.
 */
export function scanLocaleFiles(): BarePlaceholderHit[] {
  const hits: BarePlaceholderHit[] = [];
  for (const [path, source] of Object.entries(loadLocaleSources())) {
    for (const hit of findBarePlaceholders(source)) {
      hits.push({ file: path, ...hit });
    }
  }
  return hits;
}

// ── Localized-vars cross-check (round 164) ───────────────────────
//
// Bundle parity counts keys; it does NOT check that a `<Localized
// id="..." vars={{ ... }}>` site provides exactly the variables the
// FTL message declares. A site missing a `$var` renders the raw id (or
// a partial message) in the real runtime — the same invisible-to-
// mocked-Fluent defect family as the bare placeholders. This scan
// extracts each message's declared `$vars` from the en bundles (via the
// REAL `@fluent/bundle` parser — value and per-attribute separately)
// and each statically-readable `<Localized>` site's `vars` keys, and
// reports any mismatch. Runs in the same i18n gate.

import { FluentResource } from '@fluent/bundle';

export interface LocalizedSite {
  /** The FTL message id (string-literal `id` only). */
  id: string;
  /** Statically-known `vars` object keys; `null` when the `vars`
   *  expression is not a readable object literal (skipped — the
   *  programmatic case, like the parity gate's programmatic ids). */
  varsKeys: string[] | null;
  /** Statically-known `attrs` keys (localized attributes); `null` when
   *  the `attrs` expression is not a readable object literal. */
  attrsKeys: string[] | null;
  line: number;
}

export interface LocalizedVarsHit {
  file: string;
  line: number;
  id: string;
  /** Message `$vars` the site does not provide — renders literally. */
  missing: string[];
  /** Site keys the message does not declare — drift, not breakage. */
  extra: string[];
}

/** A message's variable contract: what its VALUE needs, and what each
 *  localizable ATTRIBUTE needs (a site only pays the attributes it
 *  localizes via `attrs`). */
export interface MessageVarContract {
  value: string[];
  attributes: Map<string, string[]>;
}

/** Every `{ type: 'var' }` name reachable in a Fluent pattern (including
 *  inside selectors and `-term($arg)` call arguments). */
function patternVars(pattern: unknown): string[] {
  const vars = new Set<string>();
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') return;
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as { type?: string; name?: unknown };
    if (obj.type === 'var' && typeof obj.name === 'string') vars.add(obj.name);
    for (const value of Object.values(node)) walk(value);
  };
  walk(pattern);
  return [...vars].sort();
}

/**
 * Every message id → its variable contract (value vars + per-attribute
 * vars), parsed with the REAL `@fluent/bundle` grammar. Using the real
 * parser means the value/attribute split is exactly what the runtime
 * sees — no hand-rolled grammar to drift. Terms are included (their
 * ids start with `-`); no `<Localized>` site references a term, so they
 * never collide.
 */
export function messageDeclaredVars(source: string): Map<string, MessageVarContract> {
  const resource = new FluentResource(source);
  const map = new Map<string, MessageVarContract>();
  for (const entry of resource.body) {
    const id = entry?.id;
    if (typeof id !== 'string') continue; // Junk entries
    const attributes = new Map<string, string[]>();
    for (const [name, pattern] of Object.entries(entry.attributes ?? {})) {
      attributes.set(name, patternVars(pattern));
    }
    map.set(id, { value: patternVars(entry.value), attributes });
  }
  return map;
}

/** The opening `<Localized ...>` tag: from the tag start to its closing
 *  `>` at zero brace depth outside quotes. A `>` inside a prop's nested
 *  JSX truncates the window early — the site is then mis-parsed and its
 *  later `vars` prop missed (a possible false-positive on var-bearing
 *  messages; none exist in the current tree). */
function scanOpeningTagEnd(source: string, start: number): number {
  let braceDepth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') braceDepth += 1;
    else if (ch === '}') braceDepth -= 1;
    else if (ch === '>' && braceDepth === 0) return i;
  }
  return -1;
}

/** Top-level keys of a JS object literal `{ ... }` (explicit, quoted, or
 *  shorthand). The object's own braces delimit the top level; inner
 *  braces (nested objects/arrays) are tracked by depth. */
function objectLiteralKeys(literal: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  const flush = () => {
    const entry = current.trim();
    current = '';
    if (!entry || entry.startsWith('...')) return; // spread — not a key
    const colon = entry.indexOf(':');
    if (colon === -1) {
      keys.push(entry); // shorthand `{ count }`
      return;
    }
    keys.push(entry.slice(0, colon).trim().replace(/^['"]|['"]$/g, ''));
  };
  const inner = literal.slice(1, -1);
  for (const ch of `${inner},`) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      flush();
      continue;
    }
    current += ch;
  }
  flush();
  return [...new Set(keys)];
}

/**
 * The statically-readable keys of a `propName={{ ... }}` object-literal
 * prop, or `null` when the prop is absent from the tag or its value is
 * not a readable literal (a non-literal expression is skipped, like the
 * parity gate's programmatic ids).
 */
function propObjectKeys(tag: string, propName: string): string[] | null {
  const propMatch = new RegExp(`\\b${propName}\\s*=\\s*\\{`).exec(tag);
  if (!propMatch) return null; // absent — distinguishable from unresolvable
  const literalStart = propMatch.index + propMatch[0].length - 1;
  let depth = 0;
  let quote: string | null = null;
  let exprEnd = -1;
  for (let i = literalStart; i < tag.length; i += 1) {
    const ch = tag[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        exprEnd = i;
        break;
      }
    }
  }
  if (exprEnd === -1) return null;
  const expr = tag.slice(literalStart, exprEnd + 1);
  // A literal object is `{{ ... }}` (JSX braces + object braces); a bare
  // `{...}` is an expression — unresolvable statically.
  if (!expr.startsWith('{{')) return null;
  return objectLiteralKeys(expr.slice(1, -1));
}

/**
 * Find every `<Localized>` opening tag with a string-literal `id` and
 * its statically-readable `vars`/`attrs` keys. Sites without a `vars`
 * prop get `varsKeys: []`; sites whose `vars` is a non-literal
 * expression get `varsKeys: null` (skipped). `attrsKeys` is `null` when
 * the site has no statically-readable `attrs` (then only the message's
 * VALUE vars are required of it).
 */
export function findLocalizedSites(source: string): LocalizedSite[] {
  const sites: LocalizedSite[] = [];
  let idx = 0;
  while ((idx = source.indexOf('<Localized', idx)) !== -1) {
    const line = source.slice(0, idx).split('\n').length;
    const tagEnd = scanOpeningTagEnd(source, idx);
    if (tagEnd === -1) break;
    const tag = source.slice(idx, tagEnd);
    const idMatch = /\bid\s*=\s*["']([^"']+)["']/.exec(tag);
    if (idMatch) {
      const hasVars = /\bvars\s*=\s*\{/.test(tag);
      const varsKeys = hasVars ? propObjectKeys(tag, 'vars') : [];
      const attrsKeys = /\battrs\s*=\s*\{/.test(tag) ? propObjectKeys(tag, 'attrs') : [];
      sites.push({ id: idMatch[1]!, varsKeys, attrsKeys, line });
    }
    idx = tagEnd + 1;
  }
  return sites;
}

/**
 * The scan's hit decision, pure: a site's `varsKeys` must exactly match
 * the message's declared `$vars`. Required vars are the message VALUE's
 * plus each localized ATTRIBUTE's — but only when the site actually
 * localizes that attribute (a site paying only the value must not be
 * charged the attribute's vars). `attrsKeys` is `null` when the site's
 * attrs expression is unresolvable (then only value vars are required).
 * Returns the mismatch or `null` when the site is exact.
 */
export function varsMismatch(
  varsKeys: string[],
  contract: MessageVarContract,
  attrsKeys: string[] | null,
): { missing: string[]; extra: string[] } | null {
  const required = new Set(contract.value);
  if (attrsKeys !== null) {
    for (const attr of attrsKeys) {
      for (const v of contract.attributes.get(attr) ?? []) required.add(v);
    }
  }
  const missing = [...required].filter((v) => !varsKeys.includes(v));
  const extra = varsKeys.filter((v) => !required.has(v));
  if (missing.length === 0 && extra.length === 0) return null;
  return { missing, extra };
}

/**
 * Repo-wide cross-check: every `<Localized>` site's statically-known
 * `vars` keys must exactly match the en-bundle message's declared
 * `$vars`. Missing variables render the raw id; extra keys are drift.
 * Sites with unresolvable `vars` expressions and ids absent from the
 * en bundles are skipped (the latter is the parity gate's job).
 */
export function scanLocalizedVars(): LocalizedVarsHit[] {
  // EN bundles only — the canonical variable contract (loadEnContracts).
  const declared = loadEnContracts();
  const hits: LocalizedVarsHit[] = [];
  for (const [path, sites] of loadLocalizedSites()) {
    for (const site of sites) {
      const contract = declared.get(site.id);
      if (contract === undefined) continue; // missing key — the parity gate owns that
      if (site.varsKeys === null) continue; // unresolvable vars expression — documented
      const mismatch = varsMismatch(site.varsKeys, contract, site.attrsKeys);
      if (mismatch !== null) {
        hits.push({ file: path, line: site.line, id: site.id, ...mismatch });
      }
    }
  }
  return hits;
}

// ── Translation var drift (round 165) ────────────────────────────
//
// The en-side gate (above) aligns every `<Localized>` site to the en
// contract, so a site can only provide the vars the en message
// declares. An id translation referencing any OTHER variable name
// therefore renders a literal `{$var}` placeholder for Indonesian
// users. This scan checks the SUBSET direction: a translation DROPPING
// a var is safe in Fluent (unused vars are ignored) — only drift (a
// var the en counterpart never declares) is a defect. No skip list is
// needed: legitimate omissions are safe by construction.

export interface TranslationVarDriftHit {
  file: string;
  line: number;
  id: string;
  /** `value` or the attribute name carrying the drifted var(s). */
  attr: string;
  /** The var(s) the id message references that en never declares. */
  vars: string[];
}

/**
 * Pure drift decision: the id contract's vars must be a SUBSET of the
 * en counterpart's, compared per value and per attribute (attributes
 * only when present in BOTH — an id-only attribute is never localized,
 * an en-only attribute is a separate omission defect class). Returns
 * one entry per drifted value/attribute with the offending var names.
 */
export function translationVarDrift(
  idContract: MessageVarContract,
  enContract: MessageVarContract,
): Array<{ attr: string; vars: string[] }> {
  const drift: Array<{ attr: string; vars: string[] }> = [];
  const enValue = new Set(enContract.value);
  const idValueDrift = idContract.value.filter((v) => !enValue.has(v));
  if (idValueDrift.length > 0) drift.push({ attr: 'value', vars: idValueDrift });
  for (const [attr, idVars] of idContract.attributes) {
    const enVars = enContract.attributes.get(attr);
    if (enVars === undefined) continue; // id-only attribute — never localized
    const enAttr = new Set(enVars);
    const drifted = idVars.filter((v) => !enAttr.has(v));
    if (drifted.length > 0) drift.push({ attr, vars: drifted });
  }
  return drift;
}

/**
 * Repo-wide drift scan: every message in every `*.id.ftl` bundle that
 * also exists in the en bundles must reference only vars its en
 * counterpart declares. Missing id keys, en-only keys, and id-only
 * attributes are the parity gate's / a separate defect class's job.
 */
export function scanTranslationVars(): TranslationVarDriftHit[] {
  const enDeclared = loadEnContracts();
  const hits: TranslationVarDriftHit[] = [];
  for (const [path, text] of Object.entries(loadIdSources())) {
    for (const [id, idContract] of messageDeclaredVars(text)) {
      const enContract = enDeclared.get(id);
      if (enContract === undefined) continue; // id-only key — the parity gate owns that
      const drift = translationVarDrift(idContract, enContract);
      for (const entry of drift) {
        const line = text.slice(0, text.indexOf(`${id} =`)).split('\n').length;
        hits.push({ file: path, line, id, ...entry });
      }
    }
  }
  return hits;
}

// ── Localized-attribute omission (round 166) ─────────────────────
//
// A site localizes an attribute via `attrs={{ 'aria-label': true }}`.
// When the id translation omits that attribute — the message exists
// but lacks the key — the attribute is silently UNSET for Indonesian
// users: no error, no fallback, invisible to key-level parity (which
// counts messages, not attributes) and to the var-drift scan (no vars
// involved). Only the site's attrs tell us which attributes are
// actually rendered, so the gate is driven by them.

export interface AttributeOmissionHit {
  file: string;
  line: number;
  id: string;
  /** The localized attributes the id translation omits. */
  attrs: string[];
}

/**
 * Pure omission decision: of the attributes a site localizes, which
 * exist in the en message but are missing from the id message? An
 * attribute en ALSO lacks is a site-side bug (both locales silently
 * unset), not translation drift — out of this gate's scope.
 */
export function localizedAttributeOmission(
  attrsKeys: string[],
  enAttrs: ReadonlySet<string>,
  idAttrs: ReadonlySet<string>,
): string[] {
  return attrsKeys.filter((attr) => enAttrs.has(attr) && !idAttrs.has(attr));
}

/**
 * Round 167: the en-side of the same gate. A site-localized attribute
 * absent from the EN message is silently unset for ALL users (the JSX
 * fallback — usually hardcoded English — shows instead). Sites align
 * to the en contract, so every localized attr must exist in en; id
 * presence is irrelevant (an attr only id has still means en users
 * lose it).
 */
export function localizedAttributeMissing(
  attrsKeys: string[],
  enAttrs: ReadonlySet<string>,
): string[] {
  return attrsKeys.filter((attr) => !enAttrs.has(attr));
}

/**
 * Repo-wide attribute scan: every `<Localized>` site's statically-known
 * `attrs` keys must exist in the en message's attributes (round 167)
 * AND, when en has them, in the id translation's (round 166). Sites
 * with unresolvable `attrs` expressions are skipped (documented, like
 * the vars scan); ids missing from en or id are the parity gate's job.
 * Reports one hit per affected site.
 */
export function scanAttributeOmissions(): AttributeOmissionHit[] {
  const enDeclared = loadEnContracts();
  const idDeclared = loadIdContracts();
  const hits: AttributeOmissionHit[] = [];
  for (const [path, sites] of loadLocalizedSites()) {
    for (const site of sites) {
      if (site.attrsKeys === null) continue; // unresolvable attrs expression — documented
      if (site.attrsKeys.length === 0) continue;
      const enContract = enDeclared.get(site.id);
      if (enContract === undefined) continue; // missing en key — the parity gate owns that
      const idContract = idDeclared.get(site.id);
      if (idContract === undefined) continue; // untranslated message — the parity gate owns that
      const enAttrs = new Set(enContract.attributes.keys());
      const idAttrs = new Set(idContract.attributes.keys());
      const missing = localizedAttributeMissing(site.attrsKeys, enAttrs);
      const omitted = localizedAttributeOmission(site.attrsKeys, enAttrs, idAttrs);
      const attrs = [...missing, ...omitted]; // disjoint — missing requires ¬enHas
      if (attrs.length > 0) {
        hits.push({ file: path, line: site.line, id: site.id, attrs });
      }
    }
  }
  return hits;
}

// ── Attribute-only messages consumed via getString (round 169) ────
//
// A message declared with ONLY attributes (`key =\n    .attr = value`)
// has a null VALUE. `l10n.getString(id)` and `requiredLocalized` read the
// message VALUE, so for such a message they return the raw id fallback
// instead of any attribute text — the label silently renders as the
// Fluent key id. This is the reverse of the round-166/167 gate (which
// checks `<Localized attrs>` sites): here the message has no value, but
// a value-reader consumes it. The scan finds every attribute-only
// message id referenced by a `getString`/`requiredLocalized` string
// literal in production `.tsx` code.

export interface AttributeOnlyGetStringHit {
  file: string;
  line: number;
  id: string;
}

/** Message ids in an FTL source that have no value but ≥1 attribute. */
function attributeOnlyMessageIds(source: string): Set<string> {
  const resource = new FluentResource(source);
  const ids = new Set<string>();
  for (const entry of resource.body) {
    const id = entry?.id;
    if (typeof id !== 'string') continue; // Junk entries
    if (entry.value == null && Object.keys(entry.attributes ?? {}).length > 0) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Repo-wide scan: every attribute-only message id (in ANY locale
 * bundle) referenced by a `getString`/`requiredLocalized` call in
 * production `.tsx` code. One hit per id/file pair; programmatic ids
 * (e.g. `getString(a.ariaId)`) are not statically readable and are
 * skipped, matching the parity gate's documented limitation.
 */
export function scanAttributeOnlyGetString(): AttributeOnlyGetStringHit[] {
  const attrOnly = new Set<string>();
  for (const source of Object.values(loadLocaleSources())) {
    for (const id of attributeOnlyMessageIds(source)) attrOnly.add(id);
  }
  const hits: AttributeOnlyGetStringHit[] = [];
  for (const [path, source] of Object.entries(loadTsxSources())) {
    for (const id of attrOnly) {
      const re = new RegExp('\\b(?:getString|requiredLocalized)\\s*\\([^)]*["\']' + id + '["\']');
      if (re.test(source)) {
        const line = source.slice(0, source.indexOf(id)).split('\n').length;
        hits.push({ file: path, line, id });
      }
    }
  }
  return hits;
}
