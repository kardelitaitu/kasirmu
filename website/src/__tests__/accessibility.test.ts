import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accessibilityIssues, unnamedControls } from '../lib/accessibility';
import { elementsIn } from '../lib/html-scan';

/**
 * The other half of the accessibility guard.
 *
 * `scripts/check-seo.mjs` check 13 measures every BUILT page, which is the
 * authority on the composed document — a landmark, a label or an ARIA reference
 * can be assembled from three files, and only the build shows the result. What
 * that check cannot do is fail early: it needs a full `astro build` first.
 *
 * This test covers what SOURCE can prove exactly, running the same rule module
 * so the two can never disagree about what a control is:
 *
 *   1. The rule itself, on minimal documents. Each arm is pinned here as well as
 *      in the built check, because a rule that silently stops firing (a tag name
 *      typo, a role set that drifted) leaves both callers green.
 *
 *   2. HTML that ships VERBATIM. `prototypes/**` is copied into
 *      `website/public/dev/` on prebuild and `public/**` as-is, so those files
 *      reach the build byte-for-byte and their landmarks, names and references
 *      are decided entirely in the file. The list is a directory walk, so a new
 *      prototype is covered by the commit that adds it.
 *
 *   3. No CONTROL may live in markup that never renders, and no `role="tab"`
 *      may ship without a `role="tabpanel"` beside it.
 *
 * Composed pages are deliberately NOT approximated here — a name assembled from
 * a sibling, a wrapping label or a composed layout would read as a violation
 * here and be correct in dist. The built check owns those; this one only reports
 * what is wrong in the file itself. That asymmetry is the point: the reference,
 * landmark and tab-index arms need a whole document, so they are unit-tested
 * (arm 1) and built-tested, never guessed from a fragment.
 */

const SRC = join(import.meta.dirname, '..');
const WEBSITE = join(SRC, '..');
const REPO = join(WEBSITE, '..');
const PROTOTYPES = join(REPO, 'prototypes');
const PUBLIC = join(WEBSITE, 'public');

// The generated mirror of prototypes/ — identical bytes, and gitignored, so it
// is the source directory that is checked rather than its copy.
const GENERATED = `${sep}public${sep}dev${sep}`;
const MARKUP = /\.(?:astro|tsx|html)$/;
const SKIPPED = [`${sep}__tests__${sep}`, GENERATED];

const isMarkup = (path: string) => MARKUP.test(path) && !SKIPPED.some((part) => path.includes(part));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (isMarkup(path)) out.push(path);
  }
  return out;
}

/** Repo-relative, forward-slashed: what a failure message should name. */
const named = (path: string) => relative(REPO, path).split(sep).join('/');

/** Files whose landmarks, names and references are decided by the file itself. */
const verbatim = [...walk(PROTOTYPES), ...walk(PUBLIC)].filter((path) => path.endsWith('.html'));

/** The template, not the frontmatter — JS there is not markup to a reader. */
const templateOf = (source: string) => source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

/** A source file that writes no markup at all proves nothing; skip it. */
const templates = walk(SRC).filter((path) => /<(?:button|a|input|select|textarea|summary|main|nav)\b/.test(readFileSync(path, 'utf8')));

describe('the accessibility rule', () => {
  it('accepts a named, structured document', () => {
    const good =
      '<main><nav aria-label="Primary"><a href="/">Home</a></nav>' +
      '<button type="button">Open</button>' +
      '<label for="email">Email</label><input id="email" type="email">' +
      '<input type="search" aria-label="Search products">' +
      '<input type="hidden" name="token" value="x">' +
      '<details><summary>Is it free?</summary><p>Yes</p></details>' +
      '</main>';
    expect(accessibilityIssues(good)).toEqual([]);
  });

  it('reports a control with no accessible name, and says which', () => {
    expect(accessibilityIssues('<main><button type="button"></button></main>')).toEqual([
      'has <button type="button"> with no accessible name — no text, aria-label or aria-labelledby',
    ]);
    expect(accessibilityIssues('<main><a href="/x"><svg aria-hidden="true"></svg></a></main>')).toEqual([
      'has <a href="/x"> with no accessible name — no text, aria-label or aria-labelledby',
    ]);
  });

  it('treats a placeholder as an instruction, not a name', () => {
    // The design-language demo input shipped this way: a reader heard "edit
    // text", and the one string that explained the field vanished on the first
    // keystroke.
    expect(accessibilityIssues('<main><input id="demo" type="text" placeholder="Type ok to succeed"></main>')).toEqual([
      'has <input type="text" id="demo"> named only by its placeholder — a placeholder is not a label, it disappears on input',
    ]);
  });

  it.each([
    ['a wrapping label', '<label>Email <input type="email"></label>'],
    ['a for/id label', '<label for="e">Email</label><input id="e" type="email">'],
    ['aria-label', '<input type="email" aria-label="Email">'],
    ['aria-labelledby', '<span id="l">Email</span><input type="email" aria-labelledby="l">'],
    ['a title', '<input type="email" title="Email">'],
  ])('accepts a name from %s', (_what, markup) => {
    expect(accessibilityIssues(`<main>${markup}</main>`)).toEqual([]);
  });

  it('takes an image alt as the name of the control that wraps it', () => {
    // The header nav toggle is an icon button; reading only character data
    // would call it unnamed.
    expect(accessibilityIssues('<main><button type="button"><img src="/m.svg" alt="Open menu"></button></main>')).toEqual([]);
  });

  it('requires one main landmark, and one only', () => {
    expect(accessibilityIssues('<header><nav aria-label="Primary"><a href="/">Home</a></nav></header>')).toEqual([
      'has no <main> landmark — a reader cannot skip the repeated header and footer',
    ]);
    expect(accessibilityIssues('<main>one</main><main>two</main>')).toEqual([
      'has 2 <main> landmarks — a page has one',
    ]);
  });

  it('requires a name on each nav only once there is more than one', () => {
    const one = '<main><nav><a href="/">Home</a></nav></main>';
    expect(accessibilityIssues(one)).toEqual([]);
    const two = '<main><nav><a href="/">Home</a></nav><nav aria-label="Footer"><a href="/x">X</a></nav></main>';
    expect(accessibilityIssues(two)).toEqual(['has 1 unnamed <nav> landmark(s) among 2 — with more than one, each must be named']);
  });

  it('rejects a header or footer nested inside main', () => {
    expect(accessibilityIssues('<main><article><footer><a href="/">Home</a></footer></article></main>')).toEqual([
      'has a <footer> inside <main> (<footer> "Home") — a region nested there is not a page footer',
    ]);
  });

  it('rejects a reference to an id that is not on the page', () => {
    expect(accessibilityIssues('<main><button type="button" aria-controls="gone">Menu</button></main>')).toEqual([
      'has aria-controls="gone" on <button type="button"> "Menu" naming an id that is not on the page',
    ]);
  });

  it('does not resolve a templated reference', () => {
    // A name computed at render time cannot be judged from source, and
    // reporting it would make the whole arm unusable on templates.
    expect(accessibilityIssues('<main><button type="button" aria-labelledby={`tab-${mode}`}>Pick</button></main>')).toEqual([]);
  });

  it('rejects a positive tabindex and a focusable aria-hidden element', () => {
    expect(accessibilityIssues('<main><div tabindex="2">Jump the queue</div></main>')).toEqual([
      'has tabindex="2" on <div> "Jump the queue" — a positive value reorders the whole page for keyboard users',
    ]);
    expect(accessibilityIssues('<main><button type="button" aria-hidden="true">Hidden</button></main>')).toEqual([
      'hides <button type="button"> "Hidden" from assistive technology with aria-hidden while it stays focusable',
    ]);
  });

  it('allows an aria-hidden element nothing can focus', () => {
    expect(accessibilityIssues('<main><span aria-hidden="true">★</span><button type="button">Rate</button></main>')).toEqual([]);
  });

  it('requires a tab to have a panel, and a panel to have a name', () => {
    const tabsOnly = '<main><div role="tablist"><button type="button" role="tab">One</button></div></main>';
    expect(accessibilityIssues(tabsOnly)).toEqual([
      'has 1 role="tab" control(s) but no role="tabpanel" — a tab must name the panel it controls',
    ]);
    const unnamedPanel =
      '<main><div role="tablist"><button type="button" role="tab" aria-controls="p">One</button></div><div id="p" role="tabpanel">Body</div></main>';
    expect(accessibilityIssues(unnamedPanel)).toEqual([
      'has a role="tabpanel" with no name (<div id="p"> "Body") — a panel must name its tab',
    ]);
  });

});

describe('HTML that ships verbatim', () => {
  it('has files to check at all', () => {
    // Without this, a rename of prototypes/ or a change to the walker would
    // leave every assertion below vacuously green.
    expect(verbatim.length, 'no verbatim HTML found — is the walker still pointed at the sources?').toBeGreaterThan(3);
    expect(verbatim.map(named)).toContain('prototypes/design-language.html');
    expect(verbatim.map(named)).toContain('website/public/admin/login.html');
  });

  it.each(verbatim.map((path) => [named(path), path]))('%s passes the whole rule in its source', (_name, path) => {
    expect(
      accessibilityIssues(readFileSync(path, 'utf8')),
      'this file is shipped as-is, so its landmarks, names and references are decided here — the built check would only catch it after a full build',
    ).toEqual([]);
  });
});

describe('templates', () => {
  it('scans the files that write interactive markup', () => {
    const names = templates.map(named);
    expect(templates.length).toBeGreaterThan(15);
    expect(names).toContain('website/src/components/Header.astro');
    expect(names).toContain('website/src/components/AuthForm.tsx');
  });

  // This arm is the ONLY guard on three surfaces, and that is the reason it
  // exists: SearchModal, OtpInput and PairView live inside React islands whose
  // markup dist does not contain (measured: `/en/login/index.html` carries no
  // `otp-` id and `/en/pair/index.html` no `pairing-code`), so check 13's
  // rendered sweep cannot see them and only the source can. It found the demo
  // switch and the OTP boxes that no built page could report.
  it.each(templates.map((path) => [named(path), path]))('%s names every control it writes', (_name, path) => {
    expect(
      unnamedControls(templateOf(readFileSync(path, 'utf8'))),
      'a control with no name in its own file needs aria-label, aria-labelledby, a label, or text — check-seo check 13 reads the composed page',
    ).toEqual([]);
  });

  it.each(templates.map((path) => [named(path), path]))('%s pairs every tab with a panel', (_name, path) => {
    const template = templateOf(readFileSync(path, 'utf8'));
    const elements = elementsIn(template);
    const tabs = elements.filter((element) => element.attrs.role === 'tab');
    if (!tabs.length) return;
    expect(
      elements.filter((element) => element.attrs.role === 'tabpanel').length,
      `${tabs.length} tab(s) and no tabpanel in the same file — a tab that controls nothing announces a panel that is not there`,
    ).toBeGreaterThan(0);
  });

  it.each(templates.map((path) => [named(path), path]))('%s keeps every control in markup that renders', (_name, path) => {
    const template = templateOf(readFileSync(path, 'utf8'));
    // The identity has to include the text and type, or two unnamed buttons of
    // the same tag collapse into one and a control that never renders hides
    // behind an identical one that does. Comments are stripped from the text
    // first, because on the rendered side they are gone: ThemeToggle's button
    // is described by two HTML comments that sit inside it as documentation,
    // and comparing them as content reported the component as a violation of
    // the rule it documents.
    const describeAll = (markup: string, rendered: boolean) =>
      elementsIn(markup, { rendered })
        .filter((element) => ['button', 'a', 'input', 'select', 'textarea', 'summary'].includes(element.tag))
        .map(
          (element) =>
            `${element.tag}[${element.attrs.type ?? ''}]${element.attrs.id ?? ''}:${element.text.replace(/<!--[\s\S]*?-->/g, '').trim()}`,
        );
    const shown = describeAll(template, true);
    const everywhere = describeAll(template, false);
    expect(
      everywhere.filter((control) => !shown.includes(control)),
      'a control inside a comment, <script>, <noscript> or <template> is operated by nobody — check-seo check 13 strips those regions',
    ).toEqual([]);
  });
});
