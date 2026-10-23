// Password-policy drift guard (build gate). Two jobs:
//
//  1. POLICY PARITY — the client policy module (src/lib/passwordPolicy.ts)
//     must agree with the shared fixture scripts/password-policy-cases.json
//     on every case AND on the policy constants. The Go suite runs the
//     SAME fixture in TestPasswordPolicyMatchesSharedFixture, so if the
//     server or the client changes its notion of a valid password without
//     updating the fixture, the check on that side fails. The two sides
//     can never drift apart silently.
//
//  2. CONFIRM WIRING — every UI create/change password flow must send
//     password_confirm alongside password to the license server
//     (register, set-password, reset-password). If someone removes the
//     confirm field from a component, this check fails the build; the
//     server enforces the same rule (web_password.go) and its Go tests
//     pin the 400-on-mismatch behavior.
//
// Run via `npm run precheck` / `npm run prebuild` (wired in package.json).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Import the ACTUAL shipped policy (Node 22.18+ / 24 strips TS types) —
// not a copy, so the check validates what the meter really uses.
import {
  isStrongPassword,
  passwordClassCount,
  passwordMaxBytes,
  passwordMinClasses,
  passwordMinLen,
} from '../src/lib/passwordPolicy.ts';

const root = join(import.meta.dirname, '..', '..');
const fixture = JSON.parse(
  readFileSync(join(root, 'scripts', 'password-policy-cases.json'), 'utf8'),
);

// ── Self-test ────────────────────────────────────────────────────────
//
// The CONFIRM half is a substring search over a 900-character window, and a
// substring search has one silent failure mode: it keeps matching after the
// thing it looks for has moved. `body[1].includes('password')` is also true for
// `password_confirm`, so the two assertions are NOT independent -- the only one
// that actually pins the wire format is the literal 'password_confirm'.
//
// Both directions are pinned, plus the vacuous case: an empty or missing body
// must be a problem, never a silent pass.
const CONFIRM_CASES = [
  // A correct payload: both fields present.
  ['both fields present', '{\n  email,\n  password,\n  password_confirm: confirm,\n}', []],
  // The regression this guard exists for: confirm dropped from the body.
  [
    'confirm dropped',
    '{\n  email,\n  password,\n}',
    ['password_confirm'],
  ],
  // A body that lost the password entirely is a different defect, same gate.
  // A body that sends ONLY the confirm field must report the password as missing.
  // This is the case that exposed a real weakness: with a plain substring test,
  // 'password_confirm' contains 'password' and the check passed. Strengthened to a
  // word-boundary match, which is what this assertion now pins.
  [
    'password field dropped, confirm present',
    '{\n  email,\n  password_confirm: confirm,\n}',
    ['password'],
  ],
  // THE TRAP, asserted rather than assumed: 'password_confirm' contains the
  // substring 'password', so a body with ONLY the confirm field still satisfies
  // the password assertion. This case documents that the two checks are not
  // independent, so a future reader does not delete the weaker one believing it
  // catches something the other does not.
  [
    'a body with neither field reports both',
    '{\n  email,\n}',
    ['password', 'password_confirm'],
  ],
  // An EMPTY body must not read as wired.
  ['an empty body is missing everything', '', ['password', 'password_confirm']],
];

/** Which of the two required fields a stringify body is missing.
 *
 * The password test is a WORD-BOUNDARY test on purpose. A plain substring test
 * cannot tell `password` from `password_confirm`, so a body that sent ONLY the
 * confirm field passed the password assertion. Measured 2026-10-23: the original
 * `body.includes('password')` returned true for `{ password_confirm: x }`.
 * `\bpassword\b` does not match inside `password_confirm` because `_` is a word
 * character, which is exactly the distinction the rule needs.
 */
function missingConfirmFields(body) {
  const out = [];
  if (!/\bpassword\b/.test(body)) out.push('password');
  if (!body.includes('password_confirm')) out.push('password_confirm');
  return out;
}

function selfTest() {
  const failures = [];
  for (const [name, body, expected] of CONFIRM_CASES) {
    const got = missingConfirmFields(body);
    if (got.join(',') !== expected.join(',')) {
      failures.push(`  ${name}: expected missing=${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
    }
  }
  if (failures.length) {
    console.error('SELF-TEST WRONG:');
    for (const line of failures) console.error(line);
    return 2;
  }
  console.log(`SELF-TEST OK (${CONFIRM_CASES.length} cases, no file read)`);
  return 0;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
}

// Grade the rule before the tree: a substring test that stopped matching would
// report every flow as wired while the confirm field had been removed.
{
  const rc = selfTest();
  if (rc !== 0) {
    console.error('CONFIRM RULE WENT DEAF: not trusting the scan below.');
    process.exit(rc);
  }
}

const problems = [];

// ── 1. Policy constants ──────────────────────────────────────────────
const constChecks = [
  [fixture.minLength, passwordMinLen, 'minLength'],
  [fixture.maxBytes, passwordMaxBytes, 'maxBytes'],
  [fixture.minClasses, passwordMinClasses, 'minClasses'],
];
for (const [fixtureVal, moduleVal, name] of constChecks) {
  if (fixtureVal !== moduleVal) {
    problems.push(`POLICY: fixture ${name}=${fixtureVal} but passwordPolicy.ts exports ${moduleVal}`);
  }
}

// ── 1. Policy cases ─────────────────────────────────────────────────
if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
  problems.push('POLICY: fixture has no cases array');
} else {
  for (const c of fixture.cases) {
    if (typeof c.password !== 'string') {
      problems.push(`POLICY: case missing password string: ${JSON.stringify(c)}`);
      continue;
    }
    const gotClasses = passwordClassCount(c.password);
    const gotValid = isStrongPassword(c.password);
    if (gotClasses !== c.classes) {
      problems.push(`POLICY: passwordClassCount(${JSON.stringify(c.password)}) = ${gotClasses}, fixture says ${c.classes}`);
    }
    if (gotValid !== c.valid) {
      problems.push(`POLICY: isStrongPassword(${JSON.stringify(c.password)}) = ${gotValid}, fixture says ${c.valid}`);
    }
  }
}

// ── 2. Confirm wiring ────────────────────────────────────────────────
// Each endpoint's fetch body must carry BOTH password and password_confirm.
const confirmTargets = [
  { file: 'SignupForm.tsx', endpoint: '/api/v1/web/register' },
  { file: 'AuthForm.tsx', endpoint: '/api/v1/web/reset-password' },
  { file: 'AccountView.tsx', endpoint: '/api/v1/web/set-password' },
];
for (const { file, endpoint } of confirmTargets) {
  const text = readFileSync(join(root, 'website', 'src', 'components', file), 'utf8');
  if (!text.includes(endpoint)) {
    problems.push(`CONFIRM: ${file} no longer references ${endpoint}`);
    continue;
  }
  // The endpoint appears in the fetch URL, before the body — scan the
  // window that must contain the JSON.stringify payload.
  const window = text.slice(text.indexOf(endpoint), text.indexOf(endpoint) + 900);
  const body = window.match(/JSON\.stringify\(\s*\{([^}]*)\}\)/s);
  if (!body) {
    problems.push(`CONFIRM: ${file} has no JSON.stringify body near ${endpoint}`);
    continue;
  }
  // The SAME helper the self-test grades -- not an inline copy of it.
  for (const field of missingConfirmFields(body[1])) {
    problems.push(`CONFIRM: ${file} ${endpoint} body no longer sends ${field}`);
  }
}

if (problems.length) {
  console.log(`password-policy check: ${problems.length} problem(s) — failing build:`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log(
  `password-policy check: OK (${fixture.cases.length} fixture cases match passwordPolicy.ts, ${confirmTargets.length} confirm wirings present)`,
);
