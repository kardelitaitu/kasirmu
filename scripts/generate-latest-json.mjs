#!/usr/bin/env node
// ── OZ-POS Updater Manifest Generator ─────────────────────────────────
//
// Generates a Tauri v2 updater `latest.json` manifest with minisign-format
// Ed25519 signatures over the installer binaries. Used by the release
// workflow to attach a signed manifest to every GitHub Release.
//
// Usage:
//   node scripts/generate-latest-json.mjs <version> <notes> <platform> <installer-path> [--min-version <version>]
//   node scripts/generate-latest-json.mjs <version> <notes> <platform> <installer-path> --merge <manifest.json> [--verify-pubkey <base64>] [--min-version <version>]
//   node scripts/generate-latest-json.mjs --self-test
//
// Examples:
//   node scripts/generate-latest-json.mjs 0.1.0 "Bug fixes" windows-x86_64 ./bundle/nsis/OZ-POS_0.1.0_x64-setup.exe --min-version 0.0.18
//   # Multi-platform: run once per platform, merging into one manifest:
//   node scripts/generate-latest-json.mjs 0.1.0 "Notes" linux-x86_64 ./x.AppImage --verify-pubkey "$PUBKEY" > latest.json
//   node scripts/generate-latest-json.mjs 0.1.0 "Notes" windows-x86_64 ./x-setup.exe --merge latest.json --verify-pubkey "$PUBKEY" > latest.json.tmp && mv latest.json.tmp latest.json
//
// Environment:
//   UPDATER_PRIVATE_KEY — Ed25519 private key seed (64 hex chars or base64 of 32 bytes)
//   REPO               — GitHub repo for deterministic release URLs (default kardelitaitu/kasirmu)
//
// Output:
//   A valid latest.json platform manifest (single platform, or merged when --merge is used).
//
// Requirements:
//   Node.js 20+ (node:crypto Ed25519 via PKCS8/SPKI DER + BLAKE2b-512)
//
// AUDIT-28 RELEASE-04: the emitted `signature` field is base64 of a 4-line
// minisign `.sig` text blob — the exact format the real Tauri updater client
// (tauri-plugin-updater, minisign_verify) decodes and verifies. The keyid
// embedded in the signature is extracted from the committed pubkey
// (--verify-pubkey) so minisign_verify's keyid-equality check passes, and
// the signature is computed over BLAKE2b-512 of the installer bytes
// (prehashed mode) plus a global signature over sig64 || trusted comment —
// matching `tauri signer sign` byte-for-byte (validated against real
// tauri-cli 2.11.1 output).
// `--self-test` runs a sign → derive → verify round-trip so CI can prove
// the toolchain works without real key material.
//
// NOTE: uses node:crypto (PKCS8/SPKI DER) rather than crypto.subtle — Node 24's
// WebCrypto rejects raw Ed25519 key imports with the `sign` usage, so the
// low-level API is the deterministic path across Node versions.

import { createHash, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  buildMinisignPubkey,
  buildMinisignSignature,
  derivePublicKey,
  parsePrivateKey,
  parsePublicKey,
  privateKeyFromSeed,
  testKeypair,
  verifyMinisignSignature,
} from "./updater-crypto.mjs";

// ── Argument parsing ───────────────────────────────────────────────
function parseArgs(argv) {
  let minVersion;
  let mergePath;
  let verifyPubkey;
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--min-version") {
      minVersion = argv[++i];
    } else if (arg === "--merge") {
      mergePath = argv[++i];
    } else if (arg === "--verify-pubkey") {
      verifyPubkey = argv[++i];
    } else if (arg === "--self-test") {
      positional.push("--self-test");
    } else {
      positional.push(arg);
    }
  }
  return { minVersion, mergePath, verifyPubkey, positional };
}

// ── Manifest assembly ──────────────────────────────────────────────
function buildFragment({ version, notes, platform, signature, url, minVersion }) {
  const fragment = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      [platform]: { signature, url },
    },
  };
  if (minVersion) fragment.min_version = minVersion;
  return fragment;
}

function mergeManifest(existing, fragment) {
  return {
    ...existing,
    ...fragment,
    platforms: {
      ...(existing.platforms || {}),
      ...fragment.platforms,
    },
  };
}

// ── Self-test: proves sign → derive → verify round-trip ───────────
function selfTest() {
  const { seed, raw, keyid } = testKeypair();
  const payload = Buffer.from("oz-pos updater self-test payload", "utf8");

  if (raw.length !== 32 || keyid.length !== 8) {
    console.error("FAIL test keypair derivation");
    process.exit(1);
  }

  // Build a minisign.pub blob from the derived key + keyid and re-parse it.
  const pubkeyB64 = buildMinisignPubkey(raw, keyid);
  const parsed = parsePublicKey(pubkeyB64);
  if (!parsed.raw.equals(raw) || !parsed.keyid.equals(keyid)) {
    console.error("FAIL minisign pubkey round-trip");
    process.exit(1);
  }

  // Sign → verify round-trip through the minisign format.
  const signature = buildMinisignSignature(seed, payload, "self-test.bin", keyid);
  if (!verifyMinisignSignature(raw, payload, signature)) {
    console.error("FAIL minisign signature verify");
    process.exit(1);
  }

  // tampered payload must be rejected
  if (verifyMinisignSignature(raw, Buffer.concat([payload, Buffer.from([0])]), signature)) {
    console.error("FAIL tampered payload accepted");
    process.exit(1);
  }

  console.log("self-test: minisign sign/verify + pubkey round-trip PASSED");
  process.exit(0);
}

// ── Main ───────────────────────────────────────────────────────────
const { minVersion, mergePath, verifyPubkey, positional } = parseArgs(process.argv);

if (positional[0] === "--self-test") {
  selfTest();
}

const [version, notes, platform, installerPath] = positional;

if (!version || !notes || !platform || !installerPath) {
  console.error(
    "Usage: node generate-latest-json.mjs <version> <notes> <platform> <installer-path> [--min-version <version>] [--merge <manifest.json>] [--verify-pubkey <base64>]"
  );
  process.exit(1);
}

const privateKeyEnv = process.env.UPDATER_PRIVATE_KEY;
if (!privateKeyEnv) {
  console.error("UPDATER_PRIVATE_KEY environment variable is not set");
  process.exit(1);
}

let seed;
try {
  seed = parsePrivateKey(privateKeyEnv);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// Read the installer binary. The Ed25519 signature is computed over
// BLAKE2b-512 of the raw bytes (prehashed mode, matching `tauri signer sign`).
let installerBytes;
try {
  installerBytes = readFileSync(installerPath);
} catch (e) {
  console.error(`Failed to read installer: ${e.message}`);
  process.exit(1);
}

const installerHash = createHash("sha256").update(installerBytes).digest("hex");
console.error(`Installer SHA-256: ${installerHash}`);

// RELEASE-04: the signature blob must carry the SAME keyid as the committed
// pubkey (minisign_verify rejects keyid mismatch before any crypto). Extract
// it from --verify-pubkey; when the pubkey is a raw 32-byte key we fall back
// to the keyid derived from the seed (self-consistent).
let keyid;
if (verifyPubkey) {
  let expected;
  try {
    expected = parsePublicKey(verifyPubkey);
  } catch {
    console.error("Failed to decode --verify-pubkey value (expected base64)");
    process.exit(1);
  }
  const derived = derivePublicKey(seed);
  if (!derived.equals(expected.raw)) {
    console.error(
      `PUBKEY MISMATCH: private seed derives to ${derived.toString("hex")} but ` +
        `--verify-pubkey decodes to ${expected.raw.toString("hex")}. The signing secret ` +
        `does not match the pubkey embedded in tauri.conf.json — refusing to sign.`
    );
    process.exit(1);
  }
  keyid = expected.keyid;
  console.error("Pubkey check PASSED: seed matches the committed updater pubkey");
} else {
  keyid = derivePublicKey(seed).subarray(0, 8);
  console.error("WARNING: no --verify-pubkey given — using seed-derived keyid");
}

const filename = installerPath.split("/").pop().split("\\").pop();
const signature = buildMinisignSignature(seed, installerBytes, filename, keyid);

// The release URL is deterministic based on the tag name.
const repo = process.env.REPO || "kardelitaitu/kasirmu";
const url = `https://github.com/${repo}/releases/download/v${version}/${filename}`;

const fragment = buildFragment({ version, notes, platform, signature, url, minVersion });

let manifest;
if (mergePath) {
  let existing;
  try {
    existing = JSON.parse(readFileSync(mergePath, "utf8"));
  } catch (e) {
    console.error(`Failed to read --merge manifest ${mergePath}: ${e.message}`);
    process.exit(1);
  }
  manifest = mergeManifest(existing, fragment);
} else {
  manifest = fragment;
}

process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
