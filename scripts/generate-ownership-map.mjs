#!/usr/bin/env node
// Generate the Rust table-ownership map from the single source
// (modules/ownership.json). Run with --check in CI to fail on drift.
//
// Consumers of the single source:
//   1. this generator -> crates/kasirmu-core/src/db/ownership.rs
//   2. scripts/verify-namespace-governance.py (its TABLE_OWNERS constant)
// Both must agree with modules/ownership.json; the parity is what stops a
// fourth hand-maintained list from appearing.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const sourcePath = resolve(root, "modules/ownership.json");
// KASIRMU_OWNERSHIP_TARGET points --check at a throwaway file, the same
// arrangement KASIRMU_RECORDS_ROOT gives scripts/generate-records-index.mjs.
// It exists so the DRIFT exit path can be driven end to end by a test: the
// default target is a real Rust file, and a test that tampered with it to prove
// the message would be editing the tree it is grading. Unset (the CI and
// pre-commit case) means the committed map, exactly as before.
const targetPath = process.env.KASIRMU_OWNERSHIP_TARGET
  ? resolve(process.env.KASIRMU_OWNERSHIP_TARGET)
  : resolve(root, "crates/kasirmu-core/src/db/ownership.rs");

/**
 * Read and validate the single source. `path` is injectable so the refusals
 * below can be exercised against fixtures: until 2026-11-06 nothing did, which
 * made every one of them a claim rather than a check. They are the only thing
 * standing between `modules/ownership.json` and two modules silently claiming
 * one table, so a deleted branch would have stayed green until someone hit it.
 */
function parseSource(path = sourcePath) {
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || typeof data.owners !== "object") {
    throw new Error("modules/ownership.json must have an owners object");
  }
  const entries = Object.entries(data.owners);
  if (entries.length === 0) {
    throw new Error("modules/ownership.json owners must not be empty");
  }
  const seenTables = new Map();
  for (const [module, tables] of entries) {
    if (!/^[a-z][a-z0-9_]*$/.test(module)) {
      throw new Error("invalid module id in ownership.json: " + module);
    }
    if (!Array.isArray(tables)) {
      throw new Error("ownership.json: " + module + " must map to an array");
    }
    for (const table of tables) {
      if (!/^[a-z][a-z0-9_]*$/.test(table)) {
        throw new Error("invalid table name in ownership.json: " + table);
      }
      if (seenTables.has(table)) {
        throw new Error(
          "table " + table + " is claimed by both " + seenTables.get(table) +
          " and " + module
        );
      }
      seenTables.set(table, module);
    }
  }
  return entries;
}

function render(entries) {
  const header = [
    "//! Table ownership map (plan §7) — GENERATED, DO NOT EDIT.",
    "//!",
    "//! Generated from `modules/ownership.json` by",
    "//! `scripts/generate-ownership-map.mjs`. The same source feeds",
    "//! `scripts/verify-namespace-governance.py`; a parity test fails when",
    "//! the two disagree. Change the JSON, re-run the generator, commit both.",
    "//!",
    "//! A module that owns no tables (reporting) still appears, with an empty",
    "//! slice: absence from this map is a governance gap, not permission.",
    "",
    "/// The module id that owns each table, per `modules/ownership.json`.",
    "pub const TABLE_OWNERS: &[(&str, &[&str])] = &[",
  ];
  const body = entries.map(([module, tables]) => {
    const inner = tables.map((t) => "\"" + t + "\"").join(", ");
    const slice = "&[" + inner + "]";
    const single = "    (\"" + module + "\", " + slice + "),";
    // Two measured rustfmt (edition 2024) thresholds, verified against the
    // real map so a plain `rustfmt` run leaves this file unchanged:
    //   * the tuple expands when the slice literal reaches 56 chars;
    //   * the slice then expands one-table-per-line when its indented line
    //     reaches 74 chars.
    if (slice.length < 56) {
      return single;
    }
    const sliceLine = "        " + slice + ",";
    if (sliceLine.length < 74) {
      return "    (\n        \"" + module + "\",\n" + sliceLine + "\n    ),";
    }
    const sliceLines = tables.map((tb) => "            \"" + tb + "\",").join("\n");
    return (
      "    (\n        \"" + module + "\",\n        &[\n" +
      sliceLines +
      "\n        ],\n    ),"
    );
  });
  const footer = [
    "];",
    "",
    "/// The owning module for a table, or `None` when the map does not name it.",
    "///",
    "/// `None` is a governance gap, not permission: callers must treat an",
    "/// unmapped table the same as a foreign one (fail closed).",
    "pub fn owner_of(table: &str) -> Option<&'static str> {",
    "    for (module, tables) in TABLE_OWNERS {",
    "        if tables.contains(&table) {",
    "            return Some(module);",
    "        }",
    "    }",
    "    None",
    "}",
    "",
    "#[cfg(test)]",
    "#[path = \"ownership_tests.rs\"]",
    "mod tests;",
    "",
  ];
  return header.concat(body, footer).join("\n");
}

/**
 * Compare generated text against what is committed. Extracted so the DRIFT
 * direction can be exercised: until 2026-11-06 only the clean direction ran
 * anywhere (scripts/check.sh on a matching tree), which left the one branch a
 * reader actually sees -- the failure -- as an unexecuted claim. An ABSENT
 * target counts as drift, deliberately: deleting ownership.rs removes
 * owner_of() from the build, and a --check that regenerated it in memory and
 * said nothing would pass a tree that no longer compiles the governance map.
 */
function compareWithTarget(rendered, target = targetPath) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  return { ok: current === rendered, current, target };
}

/** Write generated text to its destination; returns the path written. */
function writeTarget(rendered, target = targetPath) {
  writeFileSync(target, rendered, "utf8");
  return target;
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes("--check");
  const rendered = render(parseSource());
  if (check) {
    const { ok, target } = compareWithTarget(rendered);
    if (!ok) {
      console.error("ownership map drift: " + target + " does not match modules/ownership.json");
      console.error("run: node scripts/generate-ownership-map.mjs");
      process.exit(1);
    }
    console.log("ok: crates/kasirmu-core/src/db/ownership.rs matches modules/ownership.json");
    return;
  }
  console.log("wrote " + writeTarget(rendered));
}

export { parseSource, render, compareWithTarget, writeTarget };

// Guarded so the module can be imported by its tests: an unguarded main()
// would rewrite the real ownership.rs from a test process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
