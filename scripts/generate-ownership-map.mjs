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
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const sourcePath = resolve(root, "modules/ownership.json");
const targetPath = resolve(root, "crates/kasirmu-core/src/db/ownership.rs");

function parseSource() {
  const raw = readFileSync(sourcePath, "utf8");
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

function main() {
  const check = process.argv.includes("--check");
  const rendered = render(parseSource());
  const current = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  if (check) {
    if (current !== rendered) {
      console.error("ownership map drift: " + targetPath + " does not match modules/ownership.json");
      console.error("run: node scripts/generate-ownership-map.mjs");
      process.exit(1);
    }
    console.log("ok: crates/kasirmu-core/src/db/ownership.rs matches modules/ownership.json");
    return;
  }
  writeFileSync(targetPath, rendered, "utf8");
  console.log("wrote " + targetPath);
}

main();
