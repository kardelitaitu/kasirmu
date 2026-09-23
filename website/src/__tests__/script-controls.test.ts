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
 *   2. The coverage BOUNDARY is asserted, not implied: `declarationGaps` fails on
 *      a file that builds a control without being judged or declared, on a
 *      declaration that has outlived its reason, and on an opaque write whose
 *      shape the file's declaration does not cover.
 *   3. A runtime arm (this file is jsdom) evaluates the real `admin-utils.js`
 *      module and measures the element it returns with the same rule, so a
 *      static verdict is checked against a real DOM at least once.
 *
 * What this still does NOT cover, stated rather than left silent: any DOM
 * `admin.js` builds behind its own login and API calls, and any script outside
 * `SOURCE_ROOTS` — that page needs a browser, an admin session and mocked
 * endpoints, which is a harness too expensive to be the gate. The probes below
 * have the same kind of limit kept in the same place: a builder is measured on
 * this file's fixtures, so a branch no fixture reaches is unmeasured, and a
 * probe exercises the builder rather than the call site that feeds it.
 *
 * Two limits are still not silence, and this file asserts both:
 *
 *   4. A markup write whose right-hand side is a VALUE rather than a literal
 *      (`box.innerHTML = donut.svg`, `tmp.innerHTML = html`) yields no string to
 *      read, so it used to yield nothing at all. It is now evidence: reported
 *      until a declaration in `OPAQUE_MARKUP` names the shapes the file reads
 *      markup from, and only those shapes — a new expression in a declared file
 *      fails like any other undeclared one. 22 sites across 4 files.
 *   5. The walk does not reach vendored tree `website/public/docs-portal/**`,
 *      which `scripts/import-portal.sh` stages from mdBook/rustdoc/TypeDoc. It
 *      is the same tree checks 12 and 13 exempt by page class, and the same
 *      reason: nobody edits generated vendor HTML to satisfy this rule.
 *   6. A declared `builder` shape is PROBED, not merely named. `OPAQUE_MARKUP`
 *      saying `admin.js` reads markup from `svgChart` is, on its own, a claim
 *      about an identifier: a builder that started returning an unnamed control
 *      would satisfy every arm in this file and the gate alike. So each
 *      `builder` shape has a probe here that calls the real builder with a
 *      fixture and measures its output with the same name rule, and a `caller`
 *      shape — supplied at the write, checkable by nothing — has to say where
 *      its markup comes from instead.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import utils from '../../public/admin/admin-utils.js';
import { unnamedControls } from '../lib/accessibility';
import {
  collectScriptSources,
  controlEvidenceIn,
  declarationGaps,
  declaredFiles,
  factoryRegistry,
  OPAQUE_MARKUP,
  scriptControlIssues,
  scriptControlVerdict,
  SKIPPED_SEGMENTS,
  type Finding,
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

// A declared file is answered by its declaration, and `declarationGaps` is what
// keeps that honest in both directions — so the per-file arm judges the rest.
const declared = declaredFiles();
const judged = sources.filter((file) => !declared.has(file.path));

/** `file message` — the readable form, since a Finding carries a kind too. */
const shaped = (findings: Finding[]): string[] => findings.map((finding) => `${finding.file} ${finding.message}`);

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
    expect(shaped(declarationGaps(sources))).toEqual([]);
  }, SLOW);

  it('walks past the vendored portal, the same tree checks 12 and 13 exempt', () => {
    // A developer who runs scripts/import-portal.sh must not be blocked by a
    // finding in generated mdBook/rustdoc/TypeDoc output. The exemption is
    // declared in the walk (one owner) and asserted here, because a stale skip
    // entry is otherwise indistinguishable from a working one.
    expect(SKIPPED_SEGMENTS).toContain('/website/public/docs-portal/');
    const names = sources.map((file) => file.path);
    expect(names.some((path) => path.startsWith('website/public/docs-portal/'))).toBe(false);
  }, SLOW);

  it('declares the shapes it reads markup from, and reports the sites', () => {
    // The arm that used to be silence: `box.innerHTML = donut.svg` hands the DOM
    // markup this rule can never read. Every such site must be answered by a
    // declaration that names its shape, and the count must not be zero — a
    // boundary that declares nothing here is the bug this replaces.
    const writers = sources.filter((file) => controlEvidenceIn(file, factories).opaqueWrites.length);
    const { summary } = scriptControlVerdict(sources);
    expect(summary.opaque.files).toBe(writers.length);
    expect(summary.opaque.declared + summary.opaque.undeclared).toBe(summary.opaque.files);
    expect(summary.opaque.sites).toBeGreaterThan(15);
    const shapes = new Set(OPAQUE_MARKUP.flatMap((entry) => entry.shapes.map((shape) => shape.name)));
    for (const file of sources) {
      for (const write of controlEvidenceIn(file, factories).opaqueWrites) {
        expect(shapes, `${file.path}:${write.line} reads markup from \`${write.shape}\``).toContain(write.shape);
      }
    }
  }, SLOW);

  it('shows the gate every finding exactly once, through one path', () => {
    // Check 14 calls `scriptControlVerdict` only. Two loops used to feed it —
    // the boundary gaps already contained the name issues that a second pass
    // re-derived — so one defect printed twice and reported `FAIL 2`.
    const { findings } = scriptControlVerdict(sources);
    const rows = shaped(findings);
    expect(new Set(rows).size).toBe(rows.length);

    // And the aggregate must be the same set the per-file arms judge, or a
    // defect could be red in the gate and green here (or worse, the reverse).
    const expected = judged.flatMap((file) =>
      scriptControlIssues(file, factories).map((message) => `${file.path} ${message}`),
    );
    expect(shaped(findings.filter((finding) => finding.kind === 'name'))).toEqual(expected);
  }, SLOW);
});

/**
 * The markup a declared shape produces, obtained by calling it.
 *
 * `OPAQUE_MARKUP` naming `svgChart` is, on its own, a claim about an
 * IDENTIFIER — a builder that started returning an unnamed control would pass
 * every static arm in this file and in the gate. These probes call the real
 * builders, the same module `admin.js` loads, with a fixture, and hand the
 * output to the same name rule the rest of the sweep uses, so `builder` is a
 * kind that was measured rather than a word in a reason string.
 *
 * They are here and not in the rule module on purpose: the module must not
 * reach into `public/`, and the UMD's export depends on the loader
 * (`self.AdminUtils` in a browser, `default` under vitest) — not a dependency a
 * gate should acquire. The build still fails through this suite, because
 * `prebuild` runs it before `astro build`.
 */
const CHART_ROWS = [
  { label: 'idr', count: 12, churn: 2, paddleIdr: 8, midtransIdr: 4, paid: 3, notConverted: 5 },
  { label: 'usd', count: 5, churn: 1, paddleIdr: 3, midtransIdr: 2, paid: 2, notConverted: 1 },
];
const CHART_BUCKETS = [
  { req: 5, err: 1 },
  { req: 9, err: 2 },
  { req: 3, err: 0 },
];
/** Both donut writes read this: `donut.svg` and `donut.legend` come from one call. */
const donutMarkup = (): string[] => {
  const donut = utils.svgDonut('tiers', CHART_ROWS, 'label', 'count');
  return [donut.svg, donut.legend];
};
const PROBES: Record<string, () => string | string[]> = {
  svgChart: () => [utils.svgChart('trend', CHART_ROWS, ['count'], { wide: true })],
  svgBarChart: () => utils.svgBarChart('signups', CHART_ROWS, { valueKey: 'count', color: 'var(--accent)' }),
  svgStackedBars: () =>
    utils.svgStackedBars('mix', CHART_ROWS, {
      stack: [
        { key: 'paddleIdr', color: 'var(--primary)' },
        { key: 'midtransIdr', color: 'var(--success)' },
      ],
      fmt: (v: number) => String(v),
    }),
  sparkline: () => utils.sparkline(CHART_BUCKETS),
  donut: donutMarkup,
  donut2: donutMarkup,
};

describe('a declared shape, measured rather than named', () => {
  const declaredShapes = OPAQUE_MARKUP.flatMap((entry) =>
    entry.shapes.map((shape) => ({ ...shape, file: entry.file })),
  );
  const builders = declaredShapes.filter((shape) => shape.source === 'builder');

  it('probes every `builder` shape, so a kind cannot be declared unmeasured', () => {
    // The interop guard first: if the loader stopped handing back this module,
    // every probe below would fail inside its own case instead of here.
    expect(typeof utils.svgChart).toBe('function');
    expect(builders.length).toBeGreaterThan(0);
    expect(builders.map((shape) => shape.name).sort()).toEqual(Object.keys(PROBES).sort());
  });

  it.each(builders.map((shape) => [shape.name, shape.file] as [string, string]))(
    '%s builds markup with no unnamed control',
    (name, file) => {
      const markup = PROBES[name]();
      const parts = Array.isArray(markup) ? markup : [markup];
      expect(parts.length).toBeGreaterThan(0);
      for (const part of parts) {
        expect(typeof part).toBe('string');
        expect(part.length).toBeGreaterThan(0);
        expect(
          unnamedControls(part),
          `${file} declares \`${name}\`, and its real output contains a control with no accessible name`,
        ).toEqual([]);
      }
    },
  );

  it('fails a `caller` shape that does not say where its markup comes from', () => {
    // The kind nothing here can measure: the content arrives at the write, so
    // the declaration has to say where from — otherwise it reads exactly like
    // the probed kind above. Enforced in the gate's pass, not only in this test.
    const html = OPAQUE_MARKUP.find((entry) => entry.file === 'prototypes/app.js')!.shapes.find(
      (shape) => shape.name === 'html',
    )!;
    const note = html.note;
    delete html.note;
    try {
      expect(shaped(declarationGaps(sources))).toEqual([
        'prototypes/app.js declares `html` as supplied by a caller without saying where from — a shape nothing checks has to say so',
      ]);
    } finally {
      html.note = note;
    }
    // The two `caller` shapes are named, so a third cannot be added silently.
    expect(declaredShapes.filter((shape) => shape.source === 'caller').map((shape) => shape.name).sort()).toEqual([
      'html',
      'icon',
    ]);
  }, SLOW);

  it('reads a `literal` shape in place, so its content cannot change unchecked', () => {
    // The kind's claim is that the markup is a literal in this same file, read
    // where it is written. Exercised on the real constant: give COPY_ICON a
    // control and the file's own verdict reports it, with no probe involved.
    const app = sources.find((file) => file.path === 'prototypes/app.js')!;
    expect(
      OPAQUE_MARKUP.find((entry) => entry.file === app.path)!.shapes.some((shape) => shape.source === 'literal'),
    ).toBe(true);
    expect(scriptControlIssues(app, factories)).toEqual([]);
    const issues = scriptControlIssues(
      {
        path: app.path,
        source: app.source.replace("const COPY_ICON = '<svg", 'const COPY_ICON = \'<button class="icon"></button><svg'),
      },
      factories,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('<button class="icon">');
  }, SLOW);
});

describe('the boundary the gate prints', () => {
  const writersOf = (files: SourceFile[]): SourceFile[] =>
    files.filter((file) => controlEvidenceIn(file, factories).opaqueWrites.length);

  it('counts the files that write unreadable markup, not the declarations', () => {
    const { summary } = scriptControlVerdict(sources);
    const writers = writersOf(sources);
    expect(summary.walked).toBe(sources.length);
    expect(summary.judged).toBe(sources.length - declared.size);
    expect(summary.opaque.files).toBe(writers.length);
    expect(summary.opaque.sites).toBe(
      writers.reduce((total, file) => total + controlEvidenceIn(file, factories).opaqueWrites.length, 0),
    );
    expect(summary.opaque.declared + summary.opaque.undeclared).toBe(summary.opaque.files);
    // This tree is clean — every writer is declared — which is exactly why the
    // count had to stop meaning "declarations": the two were indistinguishable
    // here and told a different story the moment a fifth file appeared.
    expect(summary.opaque.undeclared).toBe(0);
    expect(summary.shapes).toEqual({ builder: 6, literal: 8, caller: 2 });
  }, SLOW);

  it('does not report an undeclared opaque file as judged, or leave it uncounted', () => {
    // The untruth this replaces: `opaqueFiles` counted declarations, so adding
    // this file moved NOTHING — the boundary still said four files while five
    // wrote markup nobody could read, and the fifth was neither judged nor
    // declared anywhere in the printed numbers.
    const foreign: SourceFile = {
      path: 'website/public/admin/foreign.js',
      source: 'function render(box) {\n  box.innerHTML = someChart(x);\n}\n',
    };
    const { summary, findings } = scriptControlVerdict([...sources, foreign]);
    expect(summary.walked).toBe(sources.length + 1);
    expect(summary.opaque.files).toBe(writersOf(sources).length + 1);
    expect(summary.opaque.declared).toBe(OPAQUE_MARKUP.length);
    expect(summary.opaque.undeclared).toBe(1);
    expect(findings.map((finding) => finding.file)).toContain('website/public/admin/foreign.js');
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
  const gapsOf = (files: SourceFile[]): string[] => shaped(declarationGaps(files));
  const gapsIn = (source: string): string[] => gapsOf([file(FACTORY + source)]);

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

  it('treats a markup write it CAN read as judged, not as opaque', () => {
    // The authoring case that keeps the new arm from becoming noise. A literal
    // right-hand side is read whole — every control in it is judged — so writing
    // markup this way needs no declaration at all, whether it is quoted or a
    // template with substitutions, and whether or not it holds a control.
    const readable =
      'function render(box) {\n' +
      "  box.innerHTML = '<p>No data</p>';\n" +
      '  var b = document.createElement(\'div\');\n' +
      '  b.innerHTML = `<button>${t(\'retry\')}</button>`;\n' +
      "  b.insertAdjacentHTML('beforeend', '<a href=\"/docs/\">Docs</a>');\n" +
      '  box.appendChild(b);\n' +
      '}\n';
    expect(issuesIn(readable)).toEqual([]);
    expect(gapsIn(readable)).toEqual([]);
  });

  it('reports markup written from a value instead of passing it unseen', () => {
    // The case the whole arm exists for: nothing at this write says what the
    // markup contains, so it is a finding until a declaration names the shape.
    const opaque =
      'function render(box) {\n' +
      '  var donut = buildDonut();\n' +
      '  var legend = document.createElement(\'div\');\n' +
      '  legend.innerHTML = donut.legend;\n' +
      '  box.appendChild(legend);\n' +
      '}\n';
    expect(issuesIn(opaque)).toEqual([]);
    const gaps = declarationGaps([file(FACTORY + opaque)]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].file).toBe('website/public/admin/example.js');
    expect(gaps[0].kind).toBe('opaque');
    expect(gaps[0].message).toContain('writes markup at line 9 whose right-hand side is not a literal');
    expect(gaps[0].message).toContain('declare the file in OPAQUE_MARKUP');
  });

  // The declared dashboard file, so the two cases below exercise a DECLARED
  // file rather than an undeclared one — which is the distinction that matters
  // between "nothing was claimed here" and "what was claimed no longer holds".
  const ADMIN_JS = OPAQUE_MARKUP.find((entry) => entry.file === 'website/public/admin/admin.js')!;
  const atAdminJs = (source: string): SourceFile => ({ path: ADMIN_JS.file, source });

  it('reports a shape the declaration for the file does not cover', () => {
    // A declared file keeps its accountability: the exemption is for the shapes
    // someone looked at, so a new expression is a finding like any other.
    const source =
      'function render(box) {\n' +
      `  box.innerHTML = ${ADMIN_JS.shapes[0].name}(m.trend);\n` +
      '  box.innerHTML = someOtherBuilder(row);\n' +
      '}\n';
    const gaps = declarationGaps([atAdminJs(FACTORY + source)]);
    const uncovered = gaps.filter((gap) => gap.message.includes('does not cover'));
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0].file).toBe(ADMIN_JS.file);
    expect(uncovered[0].kind).toBe('opaque');
    expect(uncovered[0].message).toContain('`someOtherBuilder`');
    // And the shapes this synthetic file never writes report as stale in the
    // same pass — the declaration is held from both ends at once.
    expect(gaps.some((gap) => gap.message.includes('writes no markup from'))).toBe(true);
  });

  it('reports a declared shape that no write reads from any more', () => {
    // The other direction: a declaration must still be earned, or the shape list
    // becomes the place the previous exemption went to hide.
    const source =
      'function render(box) {\n' +
      `  box.innerHTML = ${ADMIN_JS.shapes[0].name}(m.trend);\n` +
      '}\n';
    const stale = declarationGaps([atAdminJs(FACTORY + source)]).find((gap) =>
      gap.message.includes('writes no markup from'),
    );
    expect(stale?.kind).toBe('opaque');
    expect(stale?.message).toContain('`' + ADMIN_JS.shapes[1].name + '`');
    expect(stale?.message).toContain('remove them');
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
    // `scripts/check-seo.mjs` prints the file beside the message, so a Finding
    // has to name the file rather than bury it in the message.
    const unreadable = "function render(box) {\n  var control = el(kind, 'x');\n  box.appendChild(control);\n}\n";
    expect(declarationGaps([file(FACTORY + unreadable)])).toEqual([
      {
        file: 'website/public/admin/example.js',
        kind: 'boundary',
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
    expect(gapsOf(declared)).toEqual([
      'website/src/components/account/AccountLicense.tsx is declared NOT_OPERABLE but its controls are all named now — remove the declaration',
    ]);
  });
});
