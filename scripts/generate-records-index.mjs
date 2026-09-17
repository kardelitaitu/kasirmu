// ── generate-records-index.mjs ─────────────────────────────────────────────
// Regenerates docs/records/README.md — the unified engineering-records
// registry — from the record files themselves, so the index never drifts
// as ADRs/audits are added.
//
// Each record contributes:
//   title   — first `#` heading (or YAML front-matter `title:` if present)
//   status  — `**Status:**`/`> **Status:**`/`Status:` line (or front-matter)
//   area    — derived from the filename slug keywords (see AREA_KEYWORDS),
//             overridable via YAML front-matter `area:`
//
// Usage:  node scripts/generate-records-index.mjs          # write the index
//         node scripts/generate-records-index.mjs --check   # drift guard, writes nothing
// Output: docs/records/README.md (header + conventions are regenerated too)
//
// --check renders twice in-process, fails if the two renders differ (the
// determinism self-proof that makes its exit code meaningful), then compares the
// result against the committed file newline-normalized: exit 0 and one ok: line
// when fresh, exit 1 and a line-by-line diff summary on drift, never writing.
// Unknown arguments exit 2. Output is order-stable because every scan is either
// over an explicit list or sorted by filename — the records scan sorts readdir
// output on purpose, since a checker that moved rows with the filesystem order
// would fail at random. Nothing wires --check into a hook or CI yet; see
// docs/records/adr7-conditional-scoping-fallback-class.md §7 for why.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// KASIRMU_RECORDS_ROOT points the whole generator at a throwaway docs tree; it exists
// so scripts/test-records-index-escaping.sh can drive the live code instead of a
// copy of it. Unset, this is the repository root and nothing about a normal run changes.
const ROOT = process.env.KASIRMU_RECORDS_ROOT
  ? resolve(process.env.KASIRMU_RECORDS_ROOT)
  : join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORDS = join(ROOT, 'docs', 'records');
const OUT = join(RECORDS, 'README.md');

// ── area keyword map (checked against the lowercase filename slug) ────────
// First match wins; order matters (most specific first).
const AREA_KEYWORDS = [
  ['research', ['research', 'forecasting', 'voice']],
  ['subscription', ['subscription', 'tier', 'trial', 'license', 'midtrans', 'paddle', 'billing']],
  ['payments', ['payment', 'stripe', 'qris', 'cash', 'settlement', 'gateway']],
  ['sync', ['sync', 'crdt', 'conflict', 'offline']],
  ['topology', ['topology', 'node-based', 'node-', 'warehouse-allocation', 'stock-routing', 'connection-gating', 'typed-connection', 'multi-terminal', 'peer-model']],
  ['inventory', ['inventory', 'warehouse', 'location', 'multi-location', 'stock']],
  ['kds', ['kds', 'kitchen']],
  ['loyalty', ['loyalty']],
  ['staff', ['staff', 'rbac', 'role', 'user-profile']],
  ['products', ['product', 'category', 'rack', 'attributes', 'popularity', 'context-menu']],
  ['money', ['money', 'currency', 'exchange', 'rounding', 'tax-rounding']],
  ['tax', ['tax', 'ppn', 'pb1']],
  ['reporting', ['reporting', 'report', 'analytics']],
  ['accessibility', ['accessibility', 'a11y', 'keyboard-shortcuts']],
  ['theming', ['theme', 'theming', 'shadow', 'css', 'whitelabel', 'branding']],
  ['ui', ['loading-states', 'empty-states', 'modal', 'ui-state', 'frontend', 'react', 'ux', 'tablet', 'table-management', 'dev-mock']],
  ['crm', ['crm', 'customer']],
  ['module-system', ['module-system', 'event-bus', 'module-registration', 'domain-module']],
  ['architecture', ['architecture', 'frontend-restructure', 'data-scope', 'panic-policy', 'tenancy', 'workspace-type', 'rust-backend']],
  ['security', ['audit-log', 'security', 'auth']],
  ['performance', ['performance']],
  ['plugin', ['plugin']],
  ['quality', ['code-quality', 'dev-experience', 'coverage']],
  ['release', ['release', 'ci', 'docker', 'updater', 'migration', 'deploy', 'vps']],
  ['database', ['database', 'migration', 'db-', 'sql']],
  ['observability', ['logging', 'error-handling', 'observability', 'diagnostics']],
  ['website', ['website', 'dashboard', 'admin-dashboard', 'user-dashboard', 'subdomain']],
  ['general', []],
];

function areaFromSlug(slug) {
  for (const [area, keys] of AREA_KEYWORDS) {
    if (keys.some((k) => slug.includes(k))) return area;
  }
  return 'general';
}

// ── tiny YAML-ish front-matter parser (title/status/area keys) ─────────────
function frontMatter(file) {
  const text = file.split(/[\r\n]+/);
  if (text[0] !== '---') return null;
  let i = 1;
  const out = {};
  while (i < text.length && text[i] !== '---') {
    const m = text[i].match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (m) out[m[1].toLowerCase()] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    i++;
  }
  return out;
}

function extractTitle(file, text) {
  // frontMatter() parses document TEXT, not a path — passing `file` here made
  // the front-matter title unreachable for every record (fallback to body heading).
  const fm = frontMatter(text);
  if (fm?.title) return fm.title;
  const m = text.match(/^#\s+(.+)$/m);
  return m ? m[1].replace(/\\r/g, '').trim() : basename(file).replace(/\.md$/, '');
}

function extractStatus(text) {
  const fm = frontMatter(text);
  if (fm?.status) return fm.status.replace(/\\r/g, '').trim();
  // Prefer the `> **Status:**` (audits) then `**Status:**` (ADRs), then bare `Status:`
  for (const re of [
    /^>\s*\*\*Status:\*\*\s*(.+)$/m,
    /^\*\*Status:\*\*\s*(.+)$/m,
    /^Status:\s*(.+)$/m,
  ]) {
    const m = text.match(re);
    if (m) return m[1].replace(/\\r/g, '').trim();
  }
  return '—';
}

function readRecord(filePath) {
  const text = readFileSync(filePath, 'utf8').replace(/\r/g, ''); // normalize CRLF
  const fm = frontMatter(text);
  const slug = basename(filePath).replace(/\.md$/, '').toLowerCase();
  return {
    file: filePath,
    slug: basename(filePath),
    // num comes from front matter (Option A phase 5) — the registry number
    // lives in the ADR, not a separate map. Absent → not a numbered ADR.
    num: fm?.num !== undefined ? parseInt(fm.num, 10) : undefined,
    title: extractTitle(filePath, text),
    status: extractStatus(text),
    area: fm?.area ?? areaFromSlug(slug),
  };
}

const md = (p) => p.replace(/\\/g, '/');

function relFromRecords(filePath) {
  return md(relative(RECORDS, filePath));
}

// ── content safety for interpolated cells (precedent: relFromRecords) ───────
// Every title, status and area cell is text a record's author wrote, dropped into
// a markdown link label and a table cell. Left raw, a single "]" in a scraped
// heading closes the label early and the rest of the line renders as a link to a
// filename that does not exist — the mechanism behind a JOURNAL row appearing to
// point at JOURNAL-TAMPERED.md, a file that has never existed in the tree. The
// href itself is path-derived (relFromRecords) and never author-supplied, so this
// is a display channel, not a write channel.
//
// Deliberately narrow, and measured: the corpus today has 94 generated links, of
// which 55 status cells contain "(" ")", so parentheses are NOT escaped — they
// cannot restructure a label that ends at "]", and escaping them would rewrite
// most of the index for no safety. Brackets, backslashes and pipes are the ones
// that can; a backtick can hide a bracket from a naive parser, so code spans go;
// a "]" inside a label is the whole exploit, so brackets are escaped rather than
// dropped, keeping the author's words readable.
const TITLE_MAX = 120; // a heading may be a sentence; an index row may not

function mdCell(text, cap) {
  let s = String(text);
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'); // [t](u) -> t: a heading is not a label
  s = s.replace(/!?\[([^\]]*)\]/g, '$1'); // reference-style [t] -> t
  s = s.replace(/`/g, ''); // code spans can mask a label closer
  s = s.replace(/^#+[ \t]*/, ''); // a scraped heading marker is not text
  s = s.replace(/\\/g, '\\\\').replace(/[[\]]/g, '\\$&');
  s = s.replace(/\|/g, '\\|'); // a pipe would split the table cell
  s = s.trim();
  // The cap is a display rule for index LABELS, not a safety rule — an escaped
  // label cannot close early at any length — so it is applied to titles only.
  // Statuses are left whole: 5 of them exceed this, and truncating an audit
  // verdict to make the index prettier is not what the hazard asks for.
  const max = cap ?? 0;
  if (max > 0 && s.length > max) s = s.slice(0, max - 1).trimEnd() + '\u2026';
  return s;
}

// The single place this file builds a link out of document content. Every one of
// the seven interpolations below goes through it, because seven copies of
// "[title](href)" is the drift shape: fix one, six stay open.
const EMITTED_LINKS = [];
function linkCell(label, href) {
  const target = String(href);
  EMITTED_LINKS.push(target);
  return '[' + mdCell(label, TITLE_MAX) + '](' + target + ')';
}

// ── render ───────────────────────────────────────────────────────────────
// scan + emit are a pure function now: render() walks the documentation tree
// and returns the index TEXT plus the per-section counts. It never writes —
// the only write in this file is in main(), which is what lets --check render,
// compare, and exit without touching the working tree.
function render() {
  EMITTED_LINKS.length = 0; // one registry per render; --check renders twice
  // ── build sections ─────────────────────────────────────────────────────────
  const decisionsDir = join(ROOT, 'docs', 'decisions');
  const auditDir = join(ROOT, 'audit');
  const observabilityDir = join(ROOT, 'docs', 'observability');

  const numbered = [];
  const research = [];
  const phases = [];
  const audits = [];
  const observability = [];

  if (existsSync(decisionsDir)) {
    // Scan the base directory AND the archived/ subdirectory (superseded /
    // re-scoped ADRs live there). Archived ADRs keep their number and title
    // but get an "Archived — " status prefix so the index shows their state.
    const scans = [['', false], ['archived', true]];
    for (const [sub, isArchived] of scans) {
      const dir = join(decisionsDir, sub);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
        if (f === 'README.md' || f.endsWith('.status.md')) continue;
        const rec = readRecord(join(dir, f));
        if (rec.num !== undefined && Number.isFinite(rec.num)) {
          const statusFile = join(dir, f.replace(/\.md$/, '.status.md'));
          // Kept as data, not as pre-rendered markdown: the sibling link is composed at
          // the row site so the sanitiser runs exactly once per cell.
          numbered.push({
            ...rec,
            num: rec.num,
            status: isArchived ? `Archived — ${rec.status}` : rec.status,
            statusHref: existsSync(statusFile) ? relFromRecords(statusFile) : undefined,
          });
        } else if (f.includes('research')) {
          research.push(rec);
        } else {
          phases.push(rec);
        }
      }
    }
  }
  numbered.sort((a, b) => a.num - b.num);

  // ── audit section ──────────────────────────────────────────────────────────
  // After the sector reports were consolidated into docs/records/audit-open-findings.md,
  // the registry points at that summary instead of the per-sector files. If the
  // `audit/` folder still exists (e.g. mid-migration), list its files; otherwise
  // emit the pointer to the consolidated summary.
  //
  // DECISION 2026-09-13, left in deliberately rather than repointed or deleted:
  // root `audit/` is gone — `0689d5652` (docs: unify audit + decision records, add
  // area tags + generator) deleted it and created docs/records/audit-open-findings.md
  // in the same commit, which is also the commit that wrote this script. So the
  // existsSync() below has never been true in this file's history: the branch is
  // inert and the `else` is the live path. It is NOT a stale pointer to fix, and
  // deleting it is a different decision than a typo repair — the entry encodes what
  // the index claims exists, so it stays until whoever owns the audit records says
  // otherwise. The new `records` scan above is what actually covers that directory.
  if (existsSync(auditDir)) {
    for (const f of readdirSync(auditDir).filter((f) => f.endsWith('.md'))) {
      if (f === 'AUDIT_JULY_2026.md') continue;
      const rec = readRecord(join(auditDir, f));
      const num = parseInt(rec.slug, 10);
      audits.push({ ...rec, num: Number.isNaN(num) ? null : num });
    }
    audits.sort((a, b) => (a.num ?? 99) - (b.num ?? 99));
  }

  if (existsSync(observabilityDir)) {
    for (const f of readdirSync(observabilityDir).filter((f) => f.endsWith('.md'))) {
      observability.push(readRecord(join(observabilityDir, f)));
    }
  }

  // ── records filed beside the index ─────────────────────────────────────────
  // docs/records/ was never an input until now: the generator writes its output
  // INTO this directory but only ever enumerated docs/decisions/, audit/ (if
  // present), docs/observability/ and the explicit `scattered` list above. Every
  // record parked here — measurement records, the journal, the standing audits —
  // has been missing from the one page that claims to be the entry point for it.
  // README.md is excluded the way the decisions scan excludes its own README, and the
  // filenames are sorted: a committed file must not depend on directory order, because
  // --check now compares it byte for byte. Load-bearing, not cosmetic. Front matter
  // overrides title/status/area.
  // Status is NOT scraped from the body here, unlike the other scans: these
  // files are journals and ledgers that contain many `Status:` lines belonging to
  // individual findings (JOURNAL.md's first one is an unrelated zone-filtering
  // note). Lifting the first of them into the index would put a claim in the
  // registry that the record does not make about itself. So: front-matter `status:`
  // if a record declares one, otherwise the same em-dash the other sections use
  // when there is no status.
  const records = existsSync(RECORDS)
    ? readdirSync(RECORDS)
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .sort()
        .map((f) => {
          const file = join(RECORDS, f);
          const rec = readRecord(file);
          const fm = frontMatter(readFileSync(file, 'utf8').replace(/\r/g, ''));
          rec.status = fm?.status ? fm.status.replace(/\r/g, '').trim() : '—';
          return rec;
        })
    : [];

  // ── scattered docs list (kept explicit — they have no folder pattern) ──────
  // 2026-08-31 audit: the standalone audit reports moved from docs/ root to
  // docs/archived/ (retirement pass). Update the list here when one moves.
  // 2026-08-31 retirement pass #2: the three remaining repo-root docs
  // (unify-auth-and-sync, the GLM-5.3 crates audit, and the GLM-5.3 Tauri app
  // review journal) joined them; every citation was rewritten to the new path.
  const scattered = [
    'docs/archived/2026-07-28-retail-pos-theming-audit.md',
    'docs/archived/2026-07-29-retail-pos-ux-audit.md',
    'docs/archived/2026-08-15-unify-auth-and-sync.md',
    'docs/archived/2026-08-30-glm-5.3-tauri-app-review.md',
    'docs/archived/2026-08-31-glm-5.3f-crates-audit.md',
    'docs/archived/code-quality-2026-07-20.md',
    'docs/archived/database-optimization-2026-07-20.md',
    'docs/archived/dev-experience-2026-07-20.md',
    'docs/archived/dev-mock-state-audit.md',
    'docs/archived/ui-state-audit-2026-07-20.md',
    'docs/archived/modal-audit-checklist.md',
    'docs/archived/TODO-shadow-audit.md',
    'docs/archived/plan-product-images-review.md',
    'docs/archived/design-exceptions.md',
  ].filter((p) => existsSync(join(ROOT, p))).map((p) => readRecord(join(ROOT, p)));

  // ── emit ───────────────────────────────────────────────────────────────────
  const L = [];
  const row = (cells) => `| ${cells.join(' | ')} |`;

  L.push('# Engineering Records');
  L.push('');
  L.push('> **Generated by [`scripts/generate-records-index.mjs`](../../scripts/generate-records-index.mjs)** — do not edit by hand. Run `node scripts/generate-records-index.mjs` after adding or changing a record.');
  L.push('');
  L.push('Unified registry for architectural decisions (ADRs), audits, verifications, measurement records and system analyses. `area` is derived from the record filename (overridable via YAML front-matter `area:`). Files live at their current paths; this index is the single entry point. Still-open audit findings live in [**Audit Open Findings**](./audit-open-findings.md).');
  L.push('');

  // ── Numbered ADRs ──
  L.push('## Architectural Decision Records (`docs/decisions/`)');
  L.push('');
  L.push('### Numbered ADRs');
  L.push('');
  L.push(row(['#', 'Area', 'Title', 'Status']));
  L.push(row(['---', '---', '---', '---']));
  for (const r of numbered) {
    L.push(
      row([
        String(r.num),
        mdCell(r.area),
        linkCell(r.title, relFromRecords(r.file)),
        mdCell(r.status) + (r.statusHref ? ` (see ${linkCell('status', r.statusHref)})` : ''),
      ]),
    );
  }
  L.push('');

  // ── Research notes ──
  if (research.length) {
    L.push('### Research Notes');
    L.push('');
    for (const r of research) {
      L.push(`- **${mdCell(r.area)}** — ${linkCell(r.title, relFromRecords(r.file))}`);
    }
    L.push('');
  }

  // ── Phased implementation docs ──
  if (phases.length) {
    L.push('### Phased Implementation Docs');
    L.push('');
    const byArea = {};
    for (const r of phases) {
      (byArea[r.area] ??= []).push(r);
    }
    for (const [area, list] of Object.entries(byArea)) {
      L.push(`**${area}:**`);
      for (const r of list) {
        L.push(`- ${linkCell(r.title, relFromRecords(r.file))}`);
      }
      L.push('');
    }
  }

  // ── Records in this directory ──
  L.push('## Engineering Records (`docs/records/`)');
  L.push('');
  L.push(
    'Measurement records, journals and standing analyses filed beside this index. They are indexed by the',
  );
  L.push(
    'same scan that lists the other documentation directories; `README.md` itself is not a record.',
  );
  L.push('');
  L.push(row(['Area', 'Title', 'Status']));
  L.push(row(['---', '---', '---']));
  for (const r of records) {
    L.push(row([mdCell(r.area), linkCell(r.title, relFromRecords(r.file)), mdCell(r.status)]));
  }
  L.push('');

  // ── Audits ──
  if (audits.length) {
    L.push('## Audit Reports (consolidated)');
    L.push('');
    L.push(row(['#', 'Area', 'Title', 'Status']));
    L.push(row(['---', '---', '---', '---']));
    for (const r of audits) {
      L.push(row([r.num ?? '—', mdCell(r.area), linkCell(r.title, relFromRecords(r.file)), mdCell(r.status)]));
    }
    L.push('');
  } else {
    L.push('## Audit Reports');
    L.push('');
    L.push(`The per-sector audit reports were consolidated into [**Audit Open Findings**](./audit-open-findings.md) (${existsSync(join(RECORDS, 'audit-open-findings.md')) ? 'current' : 'generated — run the script again'}); fully-remediated sectors are closed by the commits recorded there.`);
    L.push('');
  }

  // ── Scattered audit reports ──
  L.push('## Scattered Audit Reports (`docs/`)');
  L.push('');
  for (const r of scattered) {
    L.push(`- **${r.area}** — [${r.title}](${relFromRecords(r.file)})`);
  }
  L.push('');

  // ── Observability ──
  L.push('## System Analysis / Observability (`docs/observability/`)');
  L.push('');
  L.push(row(['Area', 'Title', 'Status']));
  L.push(row(['---', '---', '---']));
  for (const r of observability) {
    L.push(row([mdCell(r.area), linkCell(r.title, relFromRecords(r.file)), mdCell(r.status)]));
  }
  L.push('');

  // ── Conventions ──
  L.push('## Conventions');
  L.push('');
  L.push('- **ADR naming:** `YYYY-MM-DD-adrNN-<slug>.md` in `docs/decisions/`');
  L.push('- **Audit records:** per-sector reports were consolidated into [`audit-open-findings.md`](./audit-open-findings.md); open findings are tracked there');
  L.push('- **`area:` tag:** derived from the filename slug (see `AREA_KEYWORDS` in the generator); set `area:` in YAML front-matter to override');
  L.push('- **Status vocabulary:** ADRs use *proposed / accepted / implemented / superseded / re-scoped*; audits use *remediated / partially remediated / audited / open*');
  L.push('- **Adding a new record:** drop the file in the right folder, then run `node scripts/generate-records-index.mjs`');
  L.push('- **Records under `docs/records/`:** every `.md` here except `README.md` is listed automatically — no front matter required, and no edit to this script needed');

  const text = L.join('\n') + '\n';
  const counts = [
    [numbered.length, 'ADRs'],
    [research.length, 'research'],
    [phases.length, 'phased'],
    [audits.length, 'audits'],
    [scattered.length, 'scattered'],
    [observability.length, 'observability'],
    [records.length, 'records'],
  ];
  return { text, counts };
}

// ── main ───────────────────────────────────────────────────────────────────
// The contract mirrors scripts/generate-pg-migration.py --check, the closest
// neighbour among the verifiers in this directory: render, then prove the render
// is byte-stable by rendering a second time, compare against the committed
// file with newlines normalized, exit 1 on drift having written nothing, exit 0 with
// one ok: line when fresh. Unknown arguments are a usage error (2), not a
// silent fallback.
function main(argv) {
  const unknown = argv.filter((a) => a !== '--check');
  if (unknown.length) {
    console.error('usage: node scripts/generate-records-index.mjs [--check]');
    console.error('  unknown argument(s): ' + unknown.join(' '));
    return 2;
  }

  const { text, counts } = render();
  const summary = counts.map(([n, k]) => n + ' ' + k).join(', ');

  if (argv.includes('--check')) {
    // Determinism self-proof, asserted in check mode only: the double render is
    // what makes an exit code trustworthy, so it runs where the exit code is read
    // as an assertion. Plain generation renders once and writes, exactly as it did
    // before, so a record file caught mid-write by another session can never fail
    // a writer that was only asked to refresh the index.
    const again = render();
    if (again.text !== text) {
      console.error('error: generator output is not deterministic across renders; refusing to assert anything');
      return 1;
    }
    const gen = text.replace(/\r\n/g, '\n');
    // Sanity leg, not determinism: --check could always prove the generator agrees
    // with itself and never once ask whether the result means anything. Every href
    // this run emitted came from a path on disk, so a link to a file that does not
    // exist is either a bug here or content that restructured a label — the
    // JOURNAL-TAMPERED.md shape. Author text can no longer create a target; assert it.
    const missingLinks = [...new Set(EMITTED_LINKS)].filter(
      (h) => !h.startsWith('http') && !existsSync(join(RECORDS, h)),
    );
    if (missingLinks.length) {
      console.error('error: generator emitted ' + missingLinks.length + ' link(s) to a path that does not exist:');
      for (const h of missingLinks.slice(0, 10)) console.error('  - ' + h);
      return 1;
    }
    const committed = (existsSync(OUT) ? readFileSync(OUT, 'utf8') : '').replace(/\r\n/g, '\n');
    if (committed === gen) {
      console.log('ok: docs/records/README.md matches the generator (' + summary + ')');
      return 0;
    }
    const g = gen.split('\n');
    const c = committed.split('\n');
    let differing = Math.abs(g.length - c.length);
    const shown = [];
    for (let i = 0; i < Math.min(g.length, c.length); i++) {
      if (g[i] === c[i]) continue;
      differing++;
      if (shown.length < 10) shown.push('  - ' + c[i] + '\n  + ' + g[i]);
    }
    console.error(
      'error: docs/records/README.md has drifted from the generator (' +
        differing +
        ' differing lines; ' +
        g.length +
        ' generated vs ' +
        c.length +
        ' committed). Generated is authoritative.\n' +
        'Never hand-edit the index — run: node scripts/generate-records-index.mjs',
    );
    for (const pair of shown) console.error(pair);
    return 1;
  }

  writeFileSync(OUT, text, 'utf8');
  console.log('Wrote ' + OUT + ' (' + summary + ')');
  return 0;
}

process.exit(main(process.argv.slice(2)));
