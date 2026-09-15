// ── Cart CSS extraction integrity test ────────────────────────────
//
// Regression guard: after every className used in PosScreen.tsx JSX
// is extracted, we assert that each class has a CSS rule defined in
// exactly one of the companion stylesheets. This prevents:
//   - Missing definitions  (a className is used but no rule exists)
//   - Accidental duplicates (the same class is defined in two files,
//     causing cascade-confusion when one file is later removed)
//
// The `.brand.css` override is intentionally excluded — it re-declares
// `.pos-cart-panel` only to scope CSS custom-property cascades, which
// is a safe and deliberate pattern.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  extractClassSelectors,
  extractUsedClassNames,
} from './screenExtraction.utils';

// ── File layout ───────────────────────────────────────────────────
// Test lives at  ui/src/__tests__/cartExtraction.test.ts
// CSS + TSX live at ui/src/features/sales/*.css / *.tsx

const SALES_DIR = path.resolve(process.cwd(), 'src', 'features', 'sales');

const TSX_FILE = 'PosScreen.tsx';

/**
 * Additional TSX files whose class names belong to the cart surface: the
 * presentation components extracted out of PosScreen.tsx byte-for-byte.
 * Mirrors the `additionalTsx` precedent in screenExtraction.test.ts:680-686.
 */
const ADDITIONAL_TSX_FILES = [
  'components/CartLineItem.tsx',
  'components/CourseSelectorBar.tsx',
  'components/CartFooterTotals.tsx',
  'components/CartActionBar.tsx',
  'components/CartPanel.tsx',
  // The three SHIFT modals (close-shift confirm, close-shift summary,
  // open-shift), moved out of PosScreen.tsx in the same byte-for-byte way.
  // Their classes live on in PosScreen.css, so without this entry the
  // reachability check below would read all 25 pos-close-shift-* rules as
  // dead the moment the markup left the screen file.
  'components/ShiftModals.tsx',
  // The last two inline modals (open-bill name input, open-bills list), moved
  // the same way. Their pos-hold-* / pos-held-list-* / pos-held-item-* rules
  // stay in PosScreen.css, and this file is the only .tsx that still names
  // them, so the entry is what keeps all 21 reachable now that the markup has
  // left the screen file.
  'components/OpenBillModals.tsx',
];

/**
 * All cart-surface CSS files that own class-selector rules.
 * `.brand.css` is excluded — it only carries `--brand-*` variable
 * declarations and a single `.pos-cart-panel` cascade, which is a
 * deliberate white-label override pattern.
 */
const CSS_FILES = [
  'PosScreen.css',
  'CartPanel.css',
  'CartPanelLineItem.css',
  'CartPanelFooterTotals.css',
  'CartPanelActions.css',
  'CartPanelCourseBar.css',
];

// ── Tests ─────────────────────────────────────────────────────────

describe('PosScreen CSS class integrity', () => {
  let tsxContent = fs.readFileSync(
    path.join(SALES_DIR, TSX_FILE),
    'utf8',
  );
  // Also scan additional TSX files (e.g. extracted section components)
  for (const extraTsx of ADDITIONAL_TSX_FILES) {
    const extraPath = path.join(SALES_DIR, extraTsx);
    tsxContent += fs.readFileSync(extraPath, 'utf8');
  }
  const used = extractUsedClassNames(tsxContent);

  // Build reverse map: className -> [file1, file2, ...]
  const fileIndex = new Map<string, string[]>();

  for (const cssFile of CSS_FILES) {
    const content = fs.readFileSync(
      path.join(SALES_DIR, cssFile),
      'utf8',
    );
    for (const cls of extractClassSelectors(content)) {
      if (!fileIndex.has(cls)) {
        fileIndex.set(cls, []);
      }
      fileIndex.get(cls)!.push(cssFile);
    }
  }

  it('every className used in PosScreen.tsx has a CSS rule defined', () => {
    const missing: string[] = [];
    for (const cls of used) {
      if (!fileIndex.has(cls)) {
        missing.push(cls);
      }
    }
    expect(
      missing,
      `className(s) used in PosScreen.tsx but not defined in any stylesheet: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('no className is defined in more than one CSS file', () => {
    const duplicates: string[] = [];
    for (const [cls, files] of fileIndex) {
      if (files.length > 1 && used.has(cls)) {
        duplicates.push(`${cls} -> ${files.join(', ')}`);
      }
    }
    expect(
      duplicates,
      `className(s) defined in multiple files (cascade conflicts):\n${duplicates.join('\n')}`,
    ).toEqual([]);
  });

  const CARTS_DYNAMIC_PREFIXES: string[] = ['pos-cart-line-wrap--'];

  // Exact-or-boundary, the convention scripts/verify-ftl-orphans.py:237 encodes
  // (n == p or n.startswith(p + '-')). A prefix that already ends in a delimiter
  // -- every entry in this ledger -- has no character left to demand, so its
  // boundary IS the prefix; anything shorter or longer without one is not covered.
  function cartsPrefixCovers(name: string, p: string): boolean {
    if (name === p) return true;
    if (name.startsWith(p + '-')) return true;
    return p.endsWith('-') && name.startsWith(p) && name.length > p.length;
  }

  it('every className defined in CSS is reachable from PosScreen.tsx (no dead classes)', () => {
    const dead: string[] = [];
    // The waiver used to be mute: a name excused here vanished from a census whose
    // entire job is to name things. This is the sibling file's credit census
    // (screenExtraction :1767-1771) lifted to carts -- WHAT was credited, TO WHICH
    // prefix, BY NAME -- so an unexplained longer sibling prints instead of
    // disappearing. The waiver list itself is unchanged: nothing was added to it.
    const credited: Array<[string, string]> = [];
    for (const [cls] of fileIndex) {
      if (used.has(cls)) continue;
      const by = CARTS_DYNAMIC_PREFIXES.find((p) => cartsPrefixCovers(cls, p));
      if (by) {
        credited.push([cls, by]);
        continue;
      }
      dead.push(cls);
    }
    console.log(
      `carts dead-class census: ${fileIndex.size} defined name(s), ${credited.length} credited away by a CARTS_DYNAMIC_PREFIXES entry, ${dead.length} dead`,
    );
    for (const [cls, by] of credited.sort()) console.log(`  credited: ${cls} -> prefix ${by}`);
    // Soft assertion — logs a warning rather than hard-failing,
    // because some classes may be shared with other components.
    if (dead.length > 0) {
      console.warn(
        `[WARN] className(s) defined in CSS but never referenced in PosScreen.tsx ` +
          `(consider removing if unused elsewhere):\n  ${dead.join('\n  ')}`,
      );
      expect.soft(dead, `Dead classes: ${dead.join(', ')}`).toEqual([]);
    }
  });
});
