#!/usr/bin/env node
/**
 * validate-env.mjs — pre-flight check for dotenv files consumed by Docker
 * Compose (fix for the 2026-08-31 e2e outage).
 *
 * Compose auto-reads the repo-root `.env` for variable interpolation and
 * dies with the terse `failed to read .env: line N: key cannot contain a
 * space` when a note line like `PADDLE PROD IDS = ...` sneaks in. This
 * validator reports EVERY offending line with a reason, up front, so the
 * failure is diagnosable without running compose at all.
 *
 * Grammar covered (compose's dotenv subset):
 *   - blank lines and `#` comment lines are fine;
 *   - `KEY=VALUE` where KEY matches [A-Za-z_][A-Za-z0-9_]* (spaces in the
 *     key are the classic poison);
 *   - quoted values may span multiple lines (real case: a PEM private key
 *     in `OZ_LICENSE_PRIVATE_KEY="-----BEGIN ..."`), so the parser must
 *     track quote state across lines;
 *   - `export KEY=...` prefix is tolerated.
 *
 * Usage: node scripts/validate-env.mjs [path ...]   (default: .env if present)
 * Exit:  0 = all files parse, 1 = problems found, 2 = usage/IO error.
 * Never prints file CONTENTS — only line numbers and reasons (these files
 * hold secrets by design).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_FILES = ['.env'];
// Leading whitespace is allowed: compose-go parses dotenv with
// github.com/joho/godotenv's grammar, whose key pattern is
// `^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)?\s*$`, so an indented `KEY=value`
// is a file compose reads happily. Before this, such a line fell through to
// "unparseable line" — a pre-flight that refused a file compose accepts, which
// is the same defect as a gate that cannot pass on a clean tree. A key with an
// interior space ("PADDLE PROD IDS = ...") still fails, at the space, because
// it cannot match this charset even when indented.
const KEY_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * Validate dotenv TEXT; returns an array of {line, reason}.
 *
 * Split out from validateFile() so the grammar can be exercised without a
 * file on disk: this is the whole of the parser, and until 2026-11-06 it had
 * no test at all — the multi-line quote state in particular is the part most
 * likely to be wrong and the least likely to be noticed, since its failure
 * mode is a CLEAN report on a file compose then refuses to read.
 */
function validateText(text) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  let quote = null; // open quote char + the line number it opened on
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const raw = lines[i];
    const trimmed = raw.trim();

    // Inside a multi-line quoted value: scan for the closing quote.
    if (quote) {
      if (trimmed.includes(quote.char)) quote = null;
      continue;
    }

    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const m = KEY_RE.exec(raw);
    if (!m) {
      // Distinguish the two failure shapes for a useful message.
      const eq = trimmed.indexOf('=');
      if (eq === -1) {
        problems.push({ line: n, reason: 'not a KEY=VALUE pair (comment it out with #?)' });
      } else {
        const key = trimmed.slice(0, eq).trimEnd();
        if (/\s/.test(key)) {
          problems.push({ line: n, reason: `key cannot contain a space: "${key}"` });
        } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          problems.push({ line: n, reason: `invalid key characters: "${key}"` });
        } else {
          problems.push({ line: n, reason: `unparseable line: "${key}=..."` });
        }
      }
      continue;
    }

    // Value side: detect an opened quote that must close on a later line.
    const value = raw.slice(m.index + m[0].length);
    const first = value.trimStart()[0];
    if (first === '"' || first === "'") {
      const rest = value.trimStart().slice(1);
      if (!rest.includes(first)) quote = { char: first, openedAt: n };
    }
  }
  if (quote) {
    problems.push({
      line: quote.openedAt,
      reason: `unterminated ${quote.char === '"' ? 'double' : 'single'}-quoted value`,
    });
  }
  return problems;
}

/** Validate one dotenv file; returns an array of {line, reason}. */
function validateFile(path) {
  return validateText(readFileSync(path, 'utf8'));
}

/**
 * CLI entry. Guarded so the module can be imported by its tests: without
 * this, importing it would resolve argv and call process.exit.
 */
function cli() {
  const args = process.argv.slice(2);
  const files = (args.length ? args : DEFAULT_FILES).map((f) => resolve(f));
  let failed = false;
  for (const f of files) {
    if (!existsSync(f)) {
      if (args.length) {
        console.error(`validate-env: no such file: ${f}`);
        process.exit(2);
      }
      continue; // default .env absent is fine
    }
    const problems = validateFile(f);
    if (problems.length) {
      failed = true;
      console.error(`validate-env: ${f} has ${problems.length} problem(s):`);
      for (const p of problems) console.error(`  line ${p.line}: ${p.reason}`);
    } else {
      console.log(`validate-env: ${f} parses cleanly.`);
    }
  }
  process.exit(failed ? 1 : 0);
}

export { validateText, validateFile };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli();
