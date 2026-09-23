#!/usr/bin/env node
/**
 * scripts/check-ui-strings.mjs — gate: no hardcoded English UI strings.
 *
 * The rule and its allowlist live in `src/lib/ui-strings.ts`, next to the site
 * source they scan, and `src/__tests__/ui-strings.test.ts` runs the same
 * function inside `npm test`. This wrapper is for the build: `prebuild.mjs`
 * runs it in phase 1 beside `audit-i18n.mjs`, so a literal that bypasses the
 * dictionaries stops a build instead of shipping.
 *
 * An `is:inline` script cannot import the dictionaries, so a string for one is
 * injected with `define:vars` — that is the fix for a reported literal, not an
 * allowlist entry.
 *
 * Run: node --experimental-strip-types scripts/check-ui-strings.mjs
 */
import { findUiStringOffenders } from '../src/lib/ui-strings.ts';

const offenders = findUiStringOffenders();

if (offenders.length === 0) {
  console.log('UI strings OK — no undeclared literal UI strings in src/');
  process.exit(0);
}

console.error(`Hardcoded UI strings: ${offenders.length}\n`);
for (const item of offenders) {
  console.error(`  ${item.file}:${item.line}  [${item.rule}]  ${JSON.stringify(item.value)}`);
}
console.error(
  '\nRoute each one through the dictionaries (t(locale, …), an island labels prop, ' +
    'or define:vars for an is:inline script), or declare it in ALLOWED_LITERALS ' +
    '(src/lib/ui-strings.ts) with the reason it must stay English.',
);
process.exit(1);
