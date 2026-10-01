/**
 * The audit footer is an INTERNAL marker (`> last audited DD-MM-YY by <who>`) read by
 * check-audit-stamps.py and skill-drift-guard. Half the website docs carry one because
 * pages are copied out of docs/, and nothing filtered the markdown body — so it rendered
 * as visible text to customers. rehype-strip-audit-footer removes it at build time.
 *
 * The cases below pin BOTH directions, which is the point: the plugin deletes a
 * blockquote, and over-deleting would silently eat real callouts or a page that
 * documents the convention by quoting it. Every 'survives' case is a shape the regex
 * could plausibly have matched.
 */

import { describe, expect, it } from 'vitest';
import rehypeStripAuditFooter from '../../plugins/rehype-strip-audit-footer.mjs';

const blockquote = (text) => ({
  type: 'element',
  tagName: 'blockquote',
  children: [{ type: 'element', tagName: 'p', children: [{ type: 'text', value: text }] }],
});

const paragraph = (text) => ({
  type: 'element',
  tagName: 'p',
  children: [{ type: 'text', value: text }],
});

function run(children) {
  const tree = { type: 'root', children };
  rehypeStripAuditFooter()(tree);
  return tree.children;
}

describe('rehype-strip-audit-footer', () => {
  it('removes a bare footer blockquote', () => {
    expect(run([blockquote('last audited 30-09-26 by docs-auditor')])).toHaveLength(0);
  });

  it('removes it for any auditor name', () => {
    expect(run([blockquote('last audited 04-10-26 by Budak-Korporat')])).toHaveLength(0);
  });

  it('keeps a real callout', () => {
    expect(run([blockquote('Warning: stock will not sync offline')])).toHaveLength(1);
  });

  it('keeps a blockquote that only QUOTES the convention', () => {
    expect(run([blockquote('last audited DD-MM-YY by <who>')])).toHaveLength(1);
  });

  it('keeps a footer line with prose after it', () => {
    expect(
      run([blockquote('last audited 30-09-26 by docs-auditor and more below')]),
    ).toHaveLength(1);
  });

  it('keeps the surrounding content', () => {
    const out = run([paragraph('Keep reading'), blockquote('last audited 30-09-26 by x'), paragraph('Tail')]);
    expect(out.map((n) => n.children[0].value)).toEqual(['Keep reading', 'Tail']);
  });

  it('reaches a footer nested deeper in the tree', () => {
    const section = { type: 'element', tagName: 'section', children: [blockquote('last audited 30-09-26 by x')] };
    const out = run([section]);
    expect(out).toHaveLength(1);
    expect(out[0].children).toHaveLength(0);
  });
});
