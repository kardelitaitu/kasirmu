#!/usr/bin/env node
// ── OZ-POS Updater Signature Verifier (AUDIT-28 RELEASE-04/06) ────────
//
// Verifies that an installer/update asset matches the signature recorded in
// a Tauri updater `latest.json` manifest, using the public key embedded in
// tauri.conf.json::plugins.updater.pubkey (base64 of a minisign.pub text
// blob). This is the post-build check the release workflow runs before
// publishing: a release must never go live with a signature that does not
// verify against the committed pubkey.
//
// Usage:
//   node scripts/verify-updater-signature.mjs <manifest.json> <platform> <installer-path>
//   node scripts/verify-updater-signature.mjs --self-test
//
// Exit codes:
//   0 — signature verified
//   1 — verification failed
//   2 — usage error
//
// The signature field is base64 of a 4-line minisign .sig TEXT blob and the
// pubkey is base64 of a minisign.pub TEXT blob — exactly what the real Tauri
// updater client (tauri-plugin-updater → minisign_verify) decodes. The main
// signature is verified over BLAKE2b-512 of the installer bytes (prehashed
// mode) and the global signature over sig64 || trusted-comment content,
// mirroring minisign_verify::PublicKey::verify(_, _, allow_legacy = true).
//
// NOTE: uses node:crypto (SPKI DER) rather than crypto.subtle — Node 24's
// WebCrypto rejects raw Ed25519 key imports with the `sign` usage, so the
// low-level API is the deterministic path across Node versions.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildMinisignPubkey,
  buildMinisignSignature,
  parsePublicKey,
  testKeypair,
  verifyMinisignSignature,
} from "./updater-crypto.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function selfTest() {
  const { seed, raw, keyid } = testKeypair();
  const payload = Buffer.from("oz-pos signature verifier self-test", "utf8");
  const pubkeyB64 = buildMinisignPubkey(raw, keyid);
  const decoded = parsePublicKey(pubkeyB64);
  if (!decoded.raw.equals(raw) || !decoded.keyid.equals(keyid)) {
    console.error("FAIL minisign pubkey decode round-trip");
    process.exit(1);
  }

  const signature = buildMinisignSignature(seed, payload, "self-test.bin", keyid);
  const ok = verifyMinisignSignature(raw, payload, signature);
  if (!ok) {
    console.error("FAIL signature verification");
    process.exit(1);
  }

  const tampered = verifyMinisignSignature(
    raw,
    Buffer.concat([payload, Buffer.from([0])]),
    signature
  );
  if (tampered) {
    console.error("FAIL tampered payload accepted");
    process.exit(1);
  }

  console.log("self-test: signature verification (incl. tamper rejection) PASSED");
  process.exit(0);
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  selfTest();
} else {
  const [manifestPath, platform, installerPath] = args;
  if (!manifestPath || !platform || !installerPath) {
    console.error(
      "Usage: node scripts/verify-updater-signature.mjs <manifest.json> <platform> <installer-path>"
    );
    process.exit(2);
  }

  const pubkey = JSON.parse(
    readFileSync(join(ROOT, "apps/desktop-tauri/tauri.conf.json"), "utf8")
  ).plugins.updater.pubkey;
  if (!pubkey) {
    console.error("tauri.conf.json::plugins.updater.pubkey is missing");
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    console.error(`Failed to read manifest: ${e.message}`);
    process.exit(1);
  }
  const entry = manifest.platforms?.[platform];
  if (!entry || !entry.signature) {
    console.error(`Manifest has no signature for platform '${platform}'`);
    process.exit(1);
  }

  let bytes;
  try {
    bytes = readFileSync(installerPath);
  } catch (e) {
    console.error(`Failed to read installer: ${e.message}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = parsePublicKey(pubkey);
  } catch (e) {
    console.error(`Failed to parse updater pubkey: ${e.message}`);
    process.exit(1);
  }

  const ok = verifyMinisignSignature(parsed.raw, bytes, entry.signature);
  if (!ok) {
    console.error(`SIGNATURE VERIFICATION FAILED for ${installerPath} (${platform})`);
    process.exit(1);
  }
  console.log(`Signature verified: ${installerPath} (${platform})`);
}
