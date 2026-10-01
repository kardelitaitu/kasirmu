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

function strip(node) {
  if (!node || typeof node !== 'object') return;
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
}

export default function rehypeStripAuditFooter() {
  return (tree) => strip(tree);
}
