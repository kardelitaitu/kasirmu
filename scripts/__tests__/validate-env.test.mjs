#!/usr/bin/env node
/**
 * scripts/__tests__/validate-env.test.mjs
 *
 * Unit tests for scripts/validate-env.mjs — the pre-flight that stands between
 * a poisoned repo-root .env and `docker compose up` (2026-08-31 outage: compose
 * died on "key cannot contain a space" with no line number).
 *
 * Validate the GRAMMAR here, not a copy of it: validateText() is the parser and
 * the module exports it. Until 2026-11-06 this file did not exist, so the
 * multi-line quote tracking — the subtlest branch, and the one whose failure
 * mode is a clean report on a file compose then rejects — had never been run
 * against a fixture.
 *
 * Run:  node --test scripts/__tests__/validate-env.test.mjs
 *   Or: npm run test:scripts   (from ui/)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateText } from '../validate-env.mjs';

/** One-line summary of a problem list, for readable assertion failures. */
const shape = (problems) => problems.map((p) => `${p.line}:${p.reason}`);

describe('validateText() — lines compose accepts', () => {
  it('accepts blank lines, comments, and plain KEY=value', () => {
    const text = [
      '# a note',
      '',
      'CLOUDFLARE_API_TOKEN=abc123',
      'OZ_ENFORCE_PLANS=false',
    ].join('\n');
    assert.deepStrictEqual(shape(validateText(text)), []);
  });

  it('tolerates spaces around = and an export prefix', () => {
    const text = 'OZ_API_SECRET = s3cret\nexport KASIRMU_MASTER_KEY=deadbeef\n';
    assert.deepStrictEqual(shape(validateText(text)), []);
  });

  it('allows an indented key, which compose reads but the old pattern refused', () => {
    // godotenv's key pattern is `^\s*(?:export\s+)?([\w.-]+)\s*=`, so the
    // indentation is not a key character; refusing it blocked a valid .env.
    assert.deepStrictEqual(shape(validateText('  OZ_ADMIN_KEY=abc\n')), []);
  });

  it('tracks a multi-line quoted value (the PEM case) to its closing quote', () => {
    const text = [
      'OZ_LICENSE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----',
      'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ==',
      '# this line starts with a hash INSIDE the value and must not be read as a comment',
      '-----END PRIVATE KEY-----"',
      'NEXT_KEY=ok',
    ].join('\n');
    assert.deepStrictEqual(shape(validateText(text)), []);
  });

  it('does not open a quote when the value closes on its own line', () => {
    assert.deepStrictEqual(shape(validateText('A="x"\nB=2\nC=\'y\'\n')), []);
  });
});

describe('validateText() — lines compose rejects, each named', () => {
  it('flags a key containing a space (the 2026-08-31 poison) at its line', () => {
    const text = 'OK=1\nPADDLE PROD IDS = 123\n';
    const problems = validateText(text);
    assert.strictEqual(problems.length, 1);
    assert.strictEqual(problems[0].line, 2);
    assert.match(problems[0].reason, /key cannot contain a space: "PADDLE PROD IDS"/);
  });

  it('flags a line with no = at all', () => {
    const problems = validateText('just some prose\n');
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0].reason, /not a KEY=VALUE pair/);
  });

  it('flags an invalid character in the key', () => {
    const problems = validateText('KEY-NAME=1\n');
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0].reason, /invalid key characters: "KEY-NAME"/);
  });

  it('flags an unterminated quoted value at the line that opened it', () => {
    const problems = validateText('A=1\nPEM="-----BEGIN-----\nMIIE\n');
    assert.strictEqual(problems.length, 1);
    assert.strictEqual(problems[0].line, 2);
    assert.match(problems[0].reason, /unterminated double-quoted value/);
  });

  it('reports every problem in the file, not just the first', () => {
    const problems = validateText('A B=1\nC D=2\nE F=3\n');
    assert.strictEqual(problems.length, 3);
    assert.deepStrictEqual(problems.map((p) => p.line), [1, 2, 3]);
  });
});
