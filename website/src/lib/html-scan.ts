/**
 * HTML scanning primitives shared by the rules that judge rendered markup:
 * which regions a consumer receives, and what elements those regions contain.
 *
 * Two rules run over the same 89 built pages and both need the same answer to
 * "is this in the markup, or merely in the source?" — `heading-outline.ts` to
 * count headings, `accessibility.ts` to find landmarks, controls and ARIA
 * references. Anything a browser does not receive is not part of either
 * question, so the stripping lives here once rather than in each rule:
 * comments, and the content of `<script>`, `<style>`, `<noscript>` (not
 * rendered with scripting on) and `<template>` (not rendered until cloned).
 *
 * `elementsIn()` walks the same markup and reports each element with its
 * attributes and its descendant text, which is what an accessible-name lookup
 * needs: a `<button>` is named by its own text, an `<input>` is not.
 *
 * `<noscript>` is the one region whose policy is not universal, so it is the
 * caller's choice (`keepNoscript`). A heading inside it is part of no outline a
 * scripting-on consumer receives, which is why the heading rule strips it — but
 * a no-script reader DOES receive its contents, so the accessibility rule asks
 * for them and judges the controls it finds there like any other.
 */

/** One element found in rendered markup, in document order of its open tag. */
export interface ScannedElement {
  /** Lowercased tag name. */
  tag: string;
  /** Attributes, lowercased names, entity-decoded values; valueless ones are `''`. */
  attrs: Record<string, string>;
  /** Text of this element's descendants, tags removed and whitespace collapsed. */
  text: string;
  /** Ancestors, outermost first — so a control can ask whether a `<label>` wraps it. */
  ancestors: string[];
}

/** A comment open, and a non-rendered element open, in one pass. */
const NON_RENDERED_OR_COMMENT = /<!--|<(script|style|noscript|template)\b/gi;

/**
 * Drop the regions a consumer does not receive — comments, and the content of
 * `<script>`, `<style>`, `<noscript>` (not rendered when scripting is on) and
 * `<template>` (not rendered until cloned).
 *
 * A scan rather than a pair of regexes, because a regex that only knew about
 * `</script>` cannot tell which form it is looking at and reads straight past a
 * self-closing one. Both forms are real here: `DocsLayout.astro` and
 * `Base.astro` write their JSON-LD blocks as `<script ... />`, and stripping
 * from the first of those to the file's one true closer swallowed the whole
 * page template, `<h1>{title}</h1>` included — a false "this page has no h1"
 * that only the source-level test ever saw, since Astro writes the explicit
 * closer into dist. Comments are handled in the same pass so that neither shape
 * can hide inside the other.
 */
export function withoutNonRendered(html: string, policy: { keepNoscript?: boolean } = {}): string {
  const kept: string[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  NON_RENDERED_OR_COMMENT.lastIndex = 0;
  while ((match = NON_RENDERED_OR_COMMENT.exec(html))) {
    const start = match.index;
    let end: number;
    if (policy.keepNoscript && match[1]?.toLowerCase() === 'noscript') {
      // Keep the element and its contents: a reader without scripting sees
      // them. Only the open tag is skipped over, so the walk continues through
      // the content and the closer is left as a stray tag for `elementsIn`.
      const openEnd = html.indexOf('>', start);
      if (openEnd === -1) break;
      kept.push(html.slice(cursor, openEnd + 1));
      cursor = openEnd + 1;
      NON_RENDERED_OR_COMMENT.lastIndex = cursor;
      continue;
    }
    if (match[0] === '<!--') {
      const close = html.indexOf('-->', start + '<!--'.length);
      end = close === -1 ? html.length : close + '-->'.length;
    } else {
      const openEnd = html.indexOf('>', start);
      if (openEnd === -1) break; // malformed tail: keep it rather than guess
      if (html[openEnd - 1] === '/') {
        end = openEnd + 1; // `<script ... />` ends at its own tag
      } else {
        const name = match[1].toLowerCase();
        const close = new RegExp(`</${name}\\s*>`, 'i').exec(html.slice(openEnd + 1));
        // No closer: treat the element as ending at its own tag and keep the
        // rest. Dropping the remainder instead would turn a prose mention of
        // `<noscript>` in a source comment into "this page has no h1" — which is
        // how this rule first failed on its own component. Astro always writes
        // the closer into dist, so the malformed shape is a source artifact.
        end = close ? openEnd + 1 + close.index + close[0].length : openEnd + 1;
      }
    }
    kept.push(html.slice(cursor, start));
    cursor = end;
    NON_RENDERED_OR_COMMENT.lastIndex = cursor;
  }
  kept.push(html.slice(cursor));
  return kept.join('');
}

const entities = (markup: string): string =>
  markup
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const normalize = (markup: string): string => entities(markup).replace(/\s+/g, ' ').trim();

/** An element's text as a screen reader would announce it: tags gone. */
export const textOf = (markup: string): string => normalize(markup.replace(/<[^>]+>/g, ' '));

/**
 * A JSX expression container, which is opaque and may hold anything — `>`, a
 * quote, an arrow function. `{cond && <b>x</b>}` is markup that renders, so
 * these are scanned rather than skipped: the alternative (rewriting each file
 * to plain HTML before scanning) would lose every control inside a conditional.
 * Two levels of nesting cover the real shapes; a deeper one ends the tag early,
 * which is a lost attribute in a source file rather than a wrong verdict on a
 * built page — dist carries no expressions at all.
 */
const EXPRESSION = String.raw`\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}`;

const TAG = new RegExp(
  `<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|${EXPRESSION}|[^>"'{])*)(\\/?)>|<\\/\\s*([a-zA-Z][a-zA-Z0-9-]*)\\s*>`,
  'g',
);

const ATTRIBUTE = new RegExp(
  `([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(${EXPRESSION})|([^\\s"'>]+)))?`,
  'g',
);

/** Attribute names lowercased; valueless attributes present with an empty value. */
function attrsOf(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTRIBUTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE.exec(source))) {
    const value = match[2] ?? match[3] ?? match[4] ?? match[5] ?? '';
    attrs[match[1].toLowerCase()] = normalize(value);
  }
  return attrs;
}

/** Elements that never have content, so their open tag is the whole element. */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

interface Frame {
  tag: string;
  attrs: Record<string, string>;
  text: string[];
  ancestors: string[];
}

/**
 * Every element in the rendered markup, with its attributes, its descendant
 * text and its ancestor tags. Children are reported when they close, so the
 * order is that of each element's *closing* tag; callers that need document
 * order sort by `index`.
 */
export function elementsIn(
  html: string,
  options: { rendered?: boolean; keepNoscript?: boolean } = {},
): ScannedElement[] {
  const source =
    options.rendered === false
      ? html
      : withoutNonRendered(html, { keepNoscript: options.keepNoscript });
  const elements: ScannedElement[] = [];
  const stack: Frame[] = [];
  const append = (chunk: string): void => {
    for (const frame of stack) frame.text.push(chunk);
  };
  let cursor = 0;
  let match: RegExpExecArray | null;
  TAG.lastIndex = 0;
  while ((match = TAG.exec(source))) {
    if (match.index > cursor) append(source.slice(cursor, match.index));
    cursor = TAG.lastIndex;
    if (match[4]) {
      const closing = match[4].toLowerCase();
      let index = -1;
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].tag === closing) {
          index = i;
          break;
        }
      }
      if (index === -1) continue; // stray closer: ignore rather than guess
      // Close every frame above it too — an unclosed child still belongs to the
      // closing element's subtree, and dropping it would lose real text.
      for (let i = stack.length - 1; i >= index; i -= 1) {
        const frame = stack[i];
        elements.push({
          tag: frame.tag,
          attrs: frame.attrs,
          text: normalize(frame.text.join(' ')),
          ancestors: frame.ancestors,
        });
      }
      stack.length = index;
      continue;
    }
    const tag = match[1].toLowerCase();
    const attrs = attrsOf(match[2]);
    if (VOID.has(tag) || match[3]) {
      elements.push({ tag, attrs, text: '', ancestors: stack.map((frame) => frame.tag) });
      // An image's alt is part of its ancestors' text, exactly as it is part of
      // their accessible name: a button wrapping `<img alt="Open menu">` is
      // named, and a rule that reads only character data would call it unnamed.
      if (tag === 'img' && attrs.alt) append(attrs.alt);
      continue;
    }
    stack.push({ tag, attrs, text: [], ancestors: stack.map((frame) => frame.tag) });
  }
  while (stack.length) {
    const frame = stack.pop() as Frame;
    elements.push({
      tag: frame.tag,
      attrs: frame.attrs,
      text: normalize(frame.text.join(' ')),
      ancestors: frame.ancestors,
    });
  }
  return elements;
}
