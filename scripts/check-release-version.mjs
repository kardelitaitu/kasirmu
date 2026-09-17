#!/usr/bin/env node
// ── OZ-POS Release Version Gate (AUDIT-28 RELEASE-05) ──────────────────
//
// Validates that a release tag matches every shipping application's version
// source AND that the canonical CHANGELOG.md carries the version heading.
// Runs BEFORE any artifact is built or uploaded so a mismatched tag can
// never produce a misleading release.
//
// Usage:
//   node scripts/check-release-version.mjs v0.0.24   # validate tag (leading v optional)
//   node scripts/check-release-version.mjs 0.0.24
//   node scripts/check-release-version.mjs --self-test
//
// Exit codes:
//   0 — gate passed
//   1 — gate failed (mismatch found)
//   2 — usage error
//
// The gate is intentionally file-based (regex over raw text) so it works on
// Cargo.toml (TOML), tauri.conf.json / package.json (JSON) without needing
// any parser dependencies. The same check is reused by the GitHub release
// workflow (release-validate job) and by scripts/release.sh before tagging.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const TAG_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

// Every source that must agree with the tag version.
const VERSION_FILES = [
  { path: "Cargo.toml", label: "Cargo workspace manifest", re: /^version\s*=\s*"([^"]+)"/m },
  { path: "ui/package.json", label: "UI package.json", re: /"version"\s*:\s*"([^"]+)"/ },
  { path: "apps/desktop-tauri/tauri.conf.json", label: "Desktop tauri.conf.json", re: /"version"\s*:\s*"([^"]+)"/ },
  { path: "apps/mobile-tauri/tauri.conf.json", label: "Tablet tauri.conf.json", re: /"version"\s*:\s*"([^"]+)"/ },
];

const CHANGELOG_PATH = "CHANGELOG.md";

/**
 * Collect gate errors for a tag against a virtual file map.
 * @param {string} tag      e.g. "v0.0.24" or "0.0.24"
 * @param {(path: string) => string} read  file reader (real fs or fixture map)
 * @returns {string[]} non-empty when the gate fails
 */
export function collectErrors(tag, read) {
  const errors = [];
  const m = TAG_RE.exec(tag);
  if (!m) {
    errors.push(`tag '${tag}' is not a valid vMAJOR.MINOR.PATCH tag`);
    return errors;
  }
  const version = `${m[1]}.${m[2]}.${m[3]}`;

  for (const f of VERSION_FILES) {
    let text;
    try {
      text = read(f.path);
    } catch {
      errors.push(`${f.label}: cannot read ${f.path}`);
      continue;
    }
    const mm = f.re.exec(text);
    if (!mm) {
      errors.push(`${f.label}: no version field found in ${f.path}`);
      continue;
    }
    if (mm[1] !== version) {
      errors.push(
        `${f.label} version '${mm[1]}' (${f.path}) != tag version '${version}'`
      );
    }
  }

  let changelog;
  try {
    changelog = read(CHANGELOG_PATH);
  } catch {
    errors.push(`cannot read ${CHANGELOG_PATH}`);
    return errors;
  }
  const heading = new RegExp(`^##\\s*\\[${version.replace(/\./g, "\\.")}\\]`, "m");
  if (!heading.test(changelog)) {
    errors.push(`CHANGELOG.md is missing a '## [${version}]' heading`);
  }

  return errors;
}

function realRead(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function selfTest() {
  const base = {
    "Cargo.toml": 'version = "0.0.24"',
    "ui/package.json": '{"version": "0.0.24"}',
    "apps/desktop-tauri/tauri.conf.json": '{"version": "0.0.24"}',
    "apps/mobile-tauri/tauri.conf.json": '{"version": "0.0.24"}',
    "CHANGELOG.md": "## [0.0.24] — 2026-01-01\n",
  };
  const cases = [
    { name: "synchronized version set passes", tag: "v0.0.24", fs: base, expectPass: true },
    { name: "tag without leading v passes", tag: "0.0.24", fs: base, expectPass: true },
    {
      name: "mismatched tag fails",
      tag: "v0.0.24",
      fs: { ...base, "Cargo.toml": 'version = "0.0.23"' },
      expectPass: false,
    },
    {
      name: "missing changelog heading fails",
      tag: "v0.0.24",
      fs: { ...base, "CHANGELOG.md": "## [0.0.23] — 2026-01-01\n" },
      expectPass: false,
    },
    { name: "invalid tag fails", tag: "v24", fs: base, expectPass: false },
  ];

  let failed = 0;
  for (const c of cases) {
    const errors = collectErrors(c.tag, (p) => {
      if (!(p in c.fs)) throw new Error(`fixture missing ${p}`);
      return c.fs[p];
    });
    const pass = errors.length === 0;
    if (pass !== c.expectPass) {
      failed += 1;
      console.error(
        `FAIL ${c.name}: expected ${c.expectPass ? "pass" : "fail"}, got ${
          pass ? "pass" : "fail"
        } — ${errors.join("; ") || "no errors"}`
      );
    } else {
      console.log(`ok ${c.name}`);
    }
  }
  if (failed > 0) {
    console.error(`self-test: ${failed} case(s) failed`);
    process.exit(1);
  }
  console.log("self-test: all cases passed");
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const tag = args[0];
if (!tag) {
  console.error("Usage: node scripts/check-release-version.mjs <vMAJOR.MINOR.PATCH|--self-test>");
  process.exit(2);
}

const errors = collectErrors(tag, realRead);
if (errors.length > 0) {
  console.error("release version gate FAILED:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`release version gate PASSED for ${tag}`);
