// @vitest-environment jsdom
/**
 * The source twin for `src/lib/script-controls.ts` — the controls a script
 * builds, which no build output can contain.
 *
 * Check 13 of `scripts/check-seo.mjs` measures the 89 built pages, and
 * `accessibility.test.ts` measures the HTML that ships verbatim, plus the
 * templates of the composed ones. Between them they still miss a whole class:
 * the admin dashboard's search field, dialog inputs and range selector, and the
 * prototype's copy and scroll-to-top buttons, exist only after `admin.js` and
 * `app.js` run. Nothing in dist carries them — measured: `/admin/index.html` is
 * a shell whose `#content` is filled at runtime, and `prototypes/app.js` builds
 * two of its controls with `document.createElement`.
 *
 * So the guard is here, and it is the only one. Three arms run it:
 *
 *   1. Every script source in the repository is judged by the same rule module
 *      the built check uses, so the two cannot disagree about what a control or
 *      a name is.
 *   2. The coverage BOUNDARY is asserted, not implied: `coverageGaps` fails on a
 *      file that builds a control without being judged or declared, and on a
 *      declaration that has outlived its reason.
 *   3. A runtime arm (this file is jsdom) evaluates the real `admin-utils.js`
 *      module and measures the element it returns with the same rule, so a
 *      static verdict is checked against a real DOM at least once.
 *
 * What this still does NOT cover, stated rather than left silent: a tag that
 * reaches `document.createElement` through a variable, a control assembled from
 * a runtime data shape, and any DOM `admin.js` builds behind its own login and
 * API calls — that page needs a browser, an admin session and mocked endpoints,
 * which is a harness too expensive to be the gate. Those cases are the reason
 * `coverageGaps` exists: an unreadable tag is reported until an author declares
 * the file and says why, so the limit is visible in the rule's own output.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import utils from '../../public/admin/admin-utils.js';
import { unnamedControls } from '../lib/accessibility';
import {
  boundaryIssues,
  collectScriptSources,
  coverageGaps,
  declaredFiles,
  factoryRegistry,
  judgedIssues,
  scriptControlIssues,
  type SourceFile,
} from '../lib/script-controls';

const SRC = join(import.meta.dirname, '..');
const WEBSITE = join(SRC, '..');
const REPO = join(WEBSITE, '..');

// The boundary — which roots are walked and which are skipped — is owned by the
// rule module, so this twin and `scripts/check-seo.mjs` (check 14) judge the
// same file list by construction rather than by two lists that can drift.
const sources: SourceFile[] = collectScriptSources(REPO);

const factories = factoryRegistry(sources);

// A declared file is answered by its declaration, and `coverageGaps` is what
// keeps that honest in both directions — so the per-file arm judges the rest.
const declared = declaredFiles();
const judged = sources.filter((file) => !declared.has(file.path));

// The arms below read and scan the whole repository, and vitest's default 5 s
// per-test budget is tight for that under a fully parallel run — a timed-out
// guard fails the build for being slow rather than for being wrong. Explicit
// budgets, generous enough that only a real hang trips them.
const SLOW = 30_000;

describe('controls a script builds, judged at the source', () => {
  it('finds the sources and the factory, so the arms below cannot pass vacuously', () => {
    expect(sources.length).toBeGreaterThan(60);
    const names = sources.map((file) => file.path);
    expect(names).toContain('website/public/admin/admin.js');
    expect(names).toContain('website/public/admin/admin-utils.js');
    expect(names).toContain('prototypes/app.js');
    expect(names).toContain('prototypes/kds-prototype.html');
    // The dashboard's controls go through this one factory; without it every
    // `el('input', …)` below would be invisible instead of judged.
    expect(factories.map((factory) => factory.name)).toContain('el');
    expect(judged.length).toBe(sources.length - declared.size);
    // Exactly once each: the walk must not reach the generated
    // `website/public/dev/` copy of every prototype as well as its source, or
    // the file set would depend on whether a build had already run (CI runs
    // `npm test` BEFORE `npm run build`) and every prototype finding would be
    // counted twice. A duplicate path is the symptom.
    expect(new Set(names).size).toBe(names.length);
    expect(names.some((path) => path.startsWith('website/public/dev/'))).toBe(false);
    expect(names.filter((path) => path === 'prototypes/app.js')).toHaveLength(1);
  }, SLOW);

  it.each(judged.map((file) => [file.path, file]))('%s names every control it builds', (_name, file) => {
    expect(
      scriptControlIssues(file, factories),
      'a control built at runtime needs a name set in the same block — aria-label, aria-labelledby, a label it names, or text; check 13 can never see this one',
    ).toEqual([]);
  });

  it('judges or declares every file that builds a control', () => {
    expect(coverageGaps(sources)).toEqual([]);
  }, SLOW);

  it('shows the gate exactly the findings this file judges', () => {
    // Check 14 calls `judgedIssues`; the arm above calls `scriptControlIssues`
    // per file. They must be the same set, or a defect could be red in the gate
    // and green here (or worse, the reverse).
    const expected = judged.flatMap((file) =>
      scriptControlIssues(file, factories).map((message) => ({ file: file.path, message })),
    );
    expect(judgedIssues(sources)).toEqual(expected);
  }, SLOW);
});

describe('a control built at runtime', () => {
  it('is named, measured on the element rather than on the source', () => {
    // The revoke-confirmation field is built by `el('input', 'input')` inside
    // the exported modal, so this measures the DOM the browser would get.
    const { box } = utils.revokeConfirmModal('owner@example.com', () => {}, {});
    document.body.appendChild(box);
    expect(unnamedControls(box.outerHTML)).toEqual([]);

    // And the name is the visible hint's own key, so the two cannot drift: a
    // translator rewriting `tenant.revokeHint` moves the label and the name
    // together, which is the failure a sibling `<p>` label invites.
    const field = box.querySelector('input')!;
    const name = field.getAttribute('aria-label')!;
    expect(name).toBeTruthy();
    expect(box.querySelector('p')!.textContent!.startsWith(name)).toBe(true);
  });

  it('still reports a runtime control with no name, so the arm above is not vacuous', () => {
    // The same factory the fix uses, deliberately without a name.
    const bare = utils.el('input', 'input');
    expect(unnamedControls(`<main>${bare.outerHTML}</main>`)).toEqual([
      'has <input class="input"> with no accessible name — no label, aria-label or aria-labelledby',
    ]);
  });
});

describe('the rule on sources that are not in the repository', () => {
  const FACTORY =
    'function el(tag, cls, text) {\n' +
    '  var e = document.createElement(tag);\n' +
    '  if (text !== undefined) e.textContent = text;\n' +
    '  return e;\n' +
    '}\n';
  const file = (source: string): SourceFile => ({ path: 'website/public/admin/example.js', source });
  const issuesIn = (source: string): string[] => {
    const one = [file(FACTORY + source)];
    return scriptControlIssues(one[0], factoryRegistry(one));
  };
  const gapsIn = (source: string): string[] => coverageGaps([file(FACTORY + source)]);

  it('accepts the shapes the dashboard actually writes', () => {
    // Every naming mechanism the codebase uses, in one authoring case: the
    // factory's text argument, an aria-label set on the next line, a label the
    // control itself names, text written with innerHTML, and a createElement
    // element named where it is used.
    const clean =
      'function render(box) {\n' +
      "  var btn = el('button', 'btn', t('save'));\n" +
      "  var input = el('input', 'input');\n" +
      "  input.setAttribute('aria-label', t('email'));\n" +
      "  var link = el('a', null, t('back'));\n" +
      '  var label = document.createElement(\'label\');\n' +
      "  label.htmlFor = 'field';\n" +
      "  var named = document.createElement('button');\n" +
      "  named.setAttribute('aria-label', 'Close');\n" +
      '  var icon = document.createElement(\'button\');\n' +
      "  icon.innerHTML = '<span>Copy code</span>';\n" +
      '  box.appendChild(btn); box.appendChild(input); box.appendChild(link);\n' +
      '  box.appendChild(label); box.appendChild(named); box.appendChild(icon);\n' +
      '}\n';
    expect(issuesIn(clean)).toEqual([]);
    expect(gapsIn(clean)).toEqual([]);
  });

  it('reports a factory control with no name anywhere', () => {
    const unnamed =
      'function render(box) {\n' +
      "  var input = el('input', 'input');\n" +
      "  input.placeholder = t('typeEmail');\n" +
      '  box.appendChild(input);\n' +
      '}\n';
    expect(issuesIn(unnamed)).toEqual([
      'line 7: builds a <input> through an element factory and never names it in the block that follows — no aria-label, title, textContent, text-bearing innerHTML or label it names',
    ]);
  });

  it('reports markup a script writes with no name', () => {
    const written = "box.innerHTML = '<button class=\"btn\"></button>';\n";
    expect(issuesIn(written)).toEqual([
      'line 6: has <button class="btn"> with no accessible name — no text, aria-label or aria-labelledby',
    ]);
  });

  it('reads an icon-only innerHTML as no name at all', () => {
    // The prototype's scroll-to-top button: the SVG it writes is not a name,
    // which is why the aria-label beside it is what makes it pass.
    const iconOnly =
      'function render(box) {\n' +
      "  var up = document.createElement('button');\n" +
      "  up.innerHTML = '<svg viewBox=\"0 0 24 24\"><polyline points=\"18 15 12 9 6 15\"/></svg>';\n" +
      '  box.appendChild(up);\n' +
      '}\n';
    expect(issuesIn(iconOnly)).toHaveLength(1);
    expect(issuesIn(iconOnly)[0]).toContain('never names it in the block that follows');
  });

  it('reports a tag it cannot read instead of passing it in silence', () => {
    const unreadable = "function render(box) {\n  var control = el(kind, 'x');\n  box.appendChild(control);\n}\n";
    expect(gapsIn(unreadable)).toEqual([
      'website/public/admin/example.js builds a control through an element factory whose tag is not a literal (line 7) — judge the call or declare the file in script-controls.ts',
    ]);
  });

  it('attributes a boundary gap to the file it is about', () => {
    // `scripts/check-seo.mjs` prints the file beside the message, so the split
    // has to name the file rather than a prefix of the message.
    const unreadable = "function render(box) {\n  var control = el(kind, 'x');\n  box.appendChild(control);\n}\n";
    expect(boundaryIssues([file(FACTORY + unreadable)])).toEqual([
      {
        file: 'website/public/admin/example.js',
        message:
          'builds a control through an element factory whose tag is not a literal (line 7) — judge the call or declare the file in script-controls.ts',
      },
    ]);
  });

  it('reports a declaration whose file no longer deserves it', () => {
    // NOT_OPERABLE holds exactly one entry — the transient textarea the licence
    // panel uses for the clipboard fallback. A declaration that stops being
    // true must fail, or the exemption list becomes a place to hide.
    const declared: SourceFile[] = [
      {
        path: 'website/src/components/account/AccountLicense.tsx',
        source: "const ta = document.createElement('textarea');\nta.setAttribute('aria-label', 'Licence key');\n",
      },
    ];
    expect(coverageGaps(declared)).toEqual([
      'website/src/components/account/AccountLicense.tsx is declared NOT_OPERABLE but its controls are all named now — remove the declaration',
    ]);
  });
});
