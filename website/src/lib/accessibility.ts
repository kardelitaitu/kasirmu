/**
 * The accessibility rule — the things a reader who cannot see the page depends
 * on that are decidable from rendered markup: landmarks, an accessible name on
 * every interactive control, ARIA references that resolve, and a keyboard path
 * that is not reordered or hidden.
 *
 * Two callers run it, and they must never disagree:
 *   • `scripts/check-seo.mjs` check 13, on all 89 built pages — the vendored
 *     docs portal exempt by page class, as the heading rule is.
 *   • `src/__tests__/accessibility.test.ts`, on the HTML sources that ship
 *     verbatim (`prototypes/**` → `/dev/`, `public/**` → `/admin/`), so a
 *     violation visible in source fails in `npm test` rather than after a build.
 *
 * Scope decisions, so the rule stays actionable rather than noisy: `<main>` is
 * required and unique and a `<nav>` must be named once there is more than one —
 * but a standalone stub owes no header, footer or nav of its own, and nothing
 * here requires them. A placeholder is not an accessible name: it vanishes as
 * soon as the reader types, and WCAG 3.3.2 asks for a label that persists.
 *
 * A `<header>` or `<footer>` inside `<main>` is deliberately NOT reported. An
 * article footer (author, tags) or a section header is ordinary authoring, and
 * because their nearest sectioning ancestor is not `<body>` neither is a
 * landmark there — so there is no defect to name, and the arm that flagged them
 * would have failed a legitimate author for markup that is correct. (It shipped
 * that way for a round and was removed when it was measured against real
 * authoring rather than against a rule-shaped example.)
 *
 * `<noscript>` is judged rather than ignored, which is where this rule departs
 * from the heading rule next door. A control inside it is a control a reader
 * without scripting operates, so names, references and focus are checked on the
 * union of both modes; a LANDMARK inside it is not counted as the page's, since
 * a scripting-on reader does not receive it — that shape is reported in its own
 * right instead of being silently accepted or silently ignored.
 */

// Explicit `.ts` (see heading-outline.ts): this module is loaded by
// `scripts/check-seo.mjs` under Node's type stripping.
import { elementsIn, type ScannedElement } from './html-scan.ts';

/** Roles whose elements are operated by a reader, so each needs a name. */
const CONTROL_ROLES = new Set([
  'button',
  'link',
  'tab',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'combobox',
  'textbox',
  'searchbox',
  'slider',
  'spinbutton',
]);

/** Elements a reader operates by their tag alone, when they carry no role. */
const NATIVE_CONTROLS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);

/** Input types that are not exposed as controls and need no name. */
const UNNAMED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

const REFERENCE_ATTRIBUTES = ['aria-labelledby', 'aria-controls', 'aria-describedby', 'aria-owns'];

const isTemplated = (value: string): boolean => value.includes('{');

/** How a reader meets this element: `<input type="email" name="email">`. */
function describe(element: ScannedElement): string {
  const identity: string[] = [];
  for (const key of ['type', 'name', 'id', 'class', 'href']) {
    const value = element.attrs[key];
    if (!value || isTemplated(value)) continue;
    identity.push(`${key}="${value.split(/\s+/)[0].slice(0, 30)}"`);
    if (identity.length === 2) break;
  }
  const text = element.text.slice(0, 30);
  const label = identity.length ? ` ${identity.join(' ')}` : '';
  return `<${element.tag}${label}>${text ? ` ${JSON.stringify(text)}` : ''}`;
}

/** The label text of every `<label for="…">`, keyed by the id it names. */
function labelsByTarget(elements: ScannedElement[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const element of elements) {
    if (element.tag !== 'label') continue;
    // `htmlFor` is what the attribute is called in the `.tsx` components this
    // rule also reads; React emits `for`, which is what dist carries.
    const target = element.attrs.for ?? element.attrs.htmlfor;
    if (target && !isTemplated(target) && element.text) labels.set(target, element.text);
  }
  return labels;
}

/** Whether an open element is wrapped in a `<label>`, whose text names it. */
const wrappedInLabel = (element: ScannedElement): boolean => element.ancestors.includes('label');

const isControl = (element: ScannedElement): boolean => {
  if (element.attrs['aria-hidden'] === 'true') return false; // not exposed: not named
  // An explicit role wins — `<div role="button">` is a control, `<link>` in the
  // head is not, and the tag alone cannot tell the two apart.
  if (element.attrs.role) return CONTROL_ROLES.has(element.attrs.role);
  if (!NATIVE_CONTROLS.has(element.tag)) return false;
  if (element.tag === 'a') return element.attrs.href !== undefined; // anchor, not a link
  return true;
};

/**
 * Every way the rendered page fails a reader who cannot see it, in the order a
 * reader would meet the defects. Messages are returned rather than thrown so
 * that both callers report the same wording.
 */
export function accessibilityIssues(html: string): string[] {
  // Two views of one document. `rendered` is what a scripting-on reader gets
  // (the majority, and the only one the landmark counts can be judged against);
  // `met` is everything a reader of either mode can operate.
  const rendered = elementsIn(html);
  const met = elementsIn(html, { keepNoscript: true });
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const element of met) {
    if (element.attrs.id && !isTemplated(element.attrs.id)) ids.add(element.attrs.id);
  }
  const labels = labelsByTarget(met);

  // --- landmarks -----------------------------------------------------------
  const isMain = (element: ScannedElement) => element.tag === 'main' || element.attrs.role === 'main';
  const mains = rendered.filter(isMain);
  if (mains.length === 0) {
    // Naming the noscript case separately keeps the rule honest about a
    // fallback: the page HAS a landmark, just not one the scripting-on reader
    // receives, and the author needs to know which of the two they built.
    issues.push(
      met.some(isMain)
        ? 'has its only <main> landmark inside <noscript> — a reader with scripting on does not receive it'
        : 'has no <main> landmark — a reader cannot skip the repeated header and footer',
    );
  } else if (mains.length > 1) {
    issues.push(`has ${mains.length} <main> landmarks — a page has one`);
  }
  const navs = rendered.filter((element) => element.tag === 'nav' || element.attrs.role === 'navigation');
  const unnamedNavs = navs.filter((nav) => !nav.attrs['aria-label'] && !nav.attrs['aria-labelledby']);
  if (navs.length > 1 && unnamedNavs.length) {
    issues.push(
      `has ${unnamedNavs.length} unnamed <nav> landmark(s) among ${navs.length} — with more than one, each must be named`,
    );
  }

  // --- names on interactive controls ---------------------------------------
  issues.push(...unnamedControls(html, met, labels));

  // --- ARIA references, tabindex, hidden focusables -------------------------
  for (const element of met) {
    for (const attribute of REFERENCE_ATTRIBUTES) {
      const value = element.attrs[attribute];
      if (!value || isTemplated(value)) continue;
      const missing = value
        .split(/\s+/)
        .filter((id) => id && !ids.has(id));
      if (missing.length) {
        issues.push(`has ${attribute}="${missing.join(' ')}" on ${describe(element)} naming an id that is not on the page`);
      }
    }
    const tabindex = Number(element.attrs.tabindex);
    if (Number.isFinite(tabindex) && tabindex > 0) {
      issues.push(
        `has tabindex="${tabindex}" on ${describe(element)} — a positive value reorders the whole page for keyboard users`,
      );
    }
    if (element.attrs['aria-hidden'] === 'true' && tabbable(element)) {
      issues.push(`hides ${describe(element)} from assistive technology with aria-hidden while it stays focusable`);
    }
  }

  // --- tabs and the panels they control ------------------------------------
  const tabs = met.filter((element) => element.attrs.role === 'tab');
  const panels = met.filter((element) => element.attrs.role === 'tabpanel');
  if (tabs.length && !panels.length) {
    issues.push(
      `has ${tabs.length} role="tab" control(s) but no role="tabpanel" — a tab must name the panel it controls`,
    );
  }
  for (const panel of panels) {
    if (!panel.attrs['aria-labelledby'] && !panel.attrs['aria-label']) {
      issues.push(`has a role="tabpanel" with no name (${describe(panel)}) — a panel must name its tab`);
    }
  }
  // One panel per tab. A single panel that every tab claims is what a two-tab
  // form reaches for (one slot, two contents), and it is wrong in a way a
  // reader can hear: the tab that is NOT selected still announces that it
  // controls a panel showing the other tab's content.
  const claims = new Map<string, ScannedElement[]>();
  for (const tab of tabs) {
    const target = tab.attrs['aria-controls'];
    if (!target || isTemplated(target)) continue;
    claims.set(target, [...(claims.get(target) ?? []), tab]);
  }
  for (const [target, claimants] of claims) {
    if (claimants.length < 2) continue;
    issues.push(
      `has ${claimants.length} role="tab" controls claiming the same panel "${target}" (${claimants.map(describe).join(', ')}) — a tab must control the panel it shows`,
    );
  }

  return issues;
}

/**
 * Every interactive control with no accessible name. Exported because the
 * source-level twin needs exactly this arm and nothing else: on a TEMPLATE a
 * landmark, a cross-file reference or a tabindex cannot be judged (the document
 * does not exist yet), but an unnamed control is unnamed in the file too.
 */
export function unnamedControls(
  html: string,
  scanned?: ScannedElement[],
  knownLabels?: Map<string, string>,
): string[] {
  const elements = scanned ?? elementsIn(html);
  const labels = knownLabels ?? labelsByTarget(elements);
  const issues: string[] = [];
  for (const element of elements) {
    if (!isControl(element)) continue;
    if (element.attrs['aria-label'] || element.attrs['aria-labelledby']) continue;
    if (element.attrs.title) continue; // a last-resort name, used by AT
    const type = element.tag === 'input' ? element.attrs.type || 'text' : '';
    if (element.tag === 'input' && UNNAMED_INPUT_TYPES.has(type)) continue;
    if (labels.has(element.attrs.id) || wrappedInLabel(element)) continue;
    if (element.tag !== 'input' && element.tag !== 'select' && element.tag !== 'textarea' && element.text) continue;
    if (element.tag === 'input' || element.tag === 'select' || element.tag === 'textarea') {
      issues.push(
        element.attrs.placeholder
          ? `has ${describe(element)} named only by its placeholder — a placeholder is not a label, it disappears on input`
          : `has ${describe(element)} with no accessible name — no label, aria-label or aria-labelledby`,
      );
      continue;
    }
    issues.push(`has ${describe(element)} with no accessible name — no text, aria-label or aria-labelledby`);
  }
  return issues;
}

/** Focusable: natively tabbable, or explicitly given a non-negative tabindex. */
function tabbable(element: ScannedElement): boolean {
  if (element.attrs.tabindex !== undefined) return Number(element.attrs.tabindex) >= 0;
  if (element.tag === 'a') return element.attrs.href !== undefined;
  if (element.tag === 'input') return (element.attrs.type || 'text') !== 'hidden';
  // `summary` is focusable as the first child of a `<details>` (the FAQ
  // disclosures and the mobile nav toggle both are), which is why it counts.
  return ['button', 'select', 'textarea', 'summary'].includes(element.tag);
}


