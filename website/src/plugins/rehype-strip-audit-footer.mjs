/**
 * rehype-strip-audit-footer — remove the internal audit footer from published pages.
 *
 * The repository stamps most docs with two dates: a house stamp comment and a
 * machine-read footer line, `> last audited DD-MM-YY by <who>`. That footer exists so
 * `check-audit-stamps.py` and `skill-drift-guard` can decide whether a doc needs
 * re-auditing. It is an INTERNAL marker and has no meaning to a reader.
 *
 * Half the website docs carry one anyway (20 of 40), because pages are copied out of
 * `docs/` and bring the footer with them — the import arrived with the pages in
 * 8d9e7f66f, not from any decision to show it. Nothing filters the markdown body on
 * the way out, so a trailing blockquote renders as visible text: under those articles a
 * customer reads "last audited 30-09-26 by docs-auditor".
 *
 * This strips it at BUILD time rather than by editing 20 files, for the reason that
 * makes the leak recur: a hand-edit fixes today's pages and leaves the next copied page
 * to leak again. A rule in the pipeline fixes the class. It also keeps the footer in the
 * SOURCE, where the audit checker still needs it — the checker reads files, not the
 * built site, so removing it in the tree would have silenced the audit instead.
 *
 * Narrow on purpose: only a blockquote whose ENTIRE text is the footer is dropped, so a
 * page that quotes the line while documenting the convention keeps its prose.
 *
 * Dependency-free, like its siblings here: it walks the hast tree by hand.
 */

const FOOTER = /^\s*last audited\s+(\d{2})-(\d{2})-(\d{2})\s+by\s+\S+\s*$/i;

function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return String(node.value ?? '');
  if (!Array.isArray(node.children)) return '';
  return node.children.map(textOf).join('');
}

// A footer may be the ONLY thing in its node, or the LAST LINE of a node that also
// carries prose. Both shapes occur in the corpus and the second is why this removes a
// LINE rather than a node:
//
//   docs/en/location.md   the footer is the last line of a multi-line changelog
//                         blockquote ("2026-09-30 · Customer rename sweep: ...")
//   docs/id/inventory.md  the footer is its own line, but the paragraph after it is
//                         NOT in the blockquote, so it shares a <p> with that prose
//
// Dropping the whole blockquote for those would delete the changelog note with it.
function stripText(value) {
  const lines = String(value ?? '').split('\n');
  const kept = lines.filter((l) => !FOOTER.test(l));
  if (kept.length === lines.length) return value;
  // Drop the node entirely when the footer was all it held.
  return kept.join('\n').trim() === '' ? null : kept.join('\n');
}

function strip(node) {
  if (!node || typeof node !== 'object') return;

  if (node.type === 'text') {
    const next = stripText(node.value);
    if (next === null) node.value = '';
    else node.value = next;
    return;
  }

  const children = node.children;
  if (!Array.isArray(children)) return;

  node.children = children.filter((child) => {
    if (child?.type === 'element' && child.tagName === 'blockquote') {
      // Only a blockquote whose whole content IS the footer is a marker.
      if (FOOTER.test(textOf(child))) return false;
    }
    return true;
  });

  for (const child of node.children) strip(child);

  // A container left holding nothing but whitespace (its only text was the footer)
  // is dropped so no empty <p>/<blockquote> reaches the page.
  if (node.children.length && node.children.every((c) => (c.type === 'text' ? String(c.value).trim() === '' : false))) {
    node.children = [];
  }
}

export default function rehypeStripAuditFooter() {
  return (tree) => strip(tree);
}
