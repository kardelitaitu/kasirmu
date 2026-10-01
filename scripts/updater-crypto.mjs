#!/usr/bin/env node
// ── kasir.mu Updater Crypto (minisign-format, client-compatible) ──────────
//
// Shared Ed25519/minisign helpers used by `generate-latest-json.mjs` and
// `verify-updater-signature.mjs`.
//
// AUDIT-28 RELEASE-04 — compatibility contract, verified empirically against
// tauri-cli 2.11.1 + tauri-plugin-updater 2.10.1 source (updater.rs
// `verify_signature` → `minisign_verify::Signature::decode` + `PublicKey`):
//
//   * The manifest `signature` field is base64 of a 4-line minisign `.sig`
//     TEXT blob:
//         untrusted comment: signature from tauri secret key
//         <base64 of 74 bytes: [0x45, 0x44] + keyid(8) + ed25519 sig(64)>
//         trusted comment: timestamp:<unix>\tfile:<filename>
//         <base64 of 64 bytes: global ed25519 signature>
//   * Alg bytes 0x45 0x44 mean PREHASHED: the main signature is computed over
//     BLAKE2b-512(file bytes), NOT the raw bytes (verified: raw-file verify
//     fails, BLAKE2b-512 verify passes).
//   * The GLOBAL signature is computed over `sig64 || trusted_comment_content`
//     where the content is everything after the 17-char "trusted comment: "
//     prefix (verified with the real signer's output).
//   * The pubkey is base64 of a 2-line minisign.pub TEXT blob:
//         untrusted comment: minisign public key: <KEYID_HEX>
//         <base64 of 42 bytes: [0x45, 0x64] + keyid(8) + raw key(32)>
//   * The 8-byte keyid embedded in the signature blob MUST equal the keyid
//     embedded in the pubkey blob (minisign_verify checks this before any
//     crypto). The keyid is NOT a slice of the raw key, so it must be
//     extracted from the committed pubkey and reused verbatim.
//
// The client's verification path is:
//     base64_to_string(pub_key) -> PublicKey::decode
//     base64_to_string(signature) -> Signature::decode
//     public_key.verify(data, &sig, /* allow_legacy = */ true)
// with `allow_legacy` meaning a legacy (0x45 0x64) signature over raw bytes is
// also accepted. We always emit the prehashed form to match the real signer.

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

// DER prefixes (RFC 8410):
//   PKCS8 private: SEQUENCE(30 2e) { INTEGER 0, AlgId Ed25519, OCTET STRING { OCTET STRING seed } }
//   SPKI public:   SEQUENCE(30 2a) { AlgId Ed25519, BIT STRING pubkey }
export const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
export const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// ── Key parsing / derivation ────────────────────────────────────────────

// Accepts 64-hex (32 bytes) or base64 of the raw 32-byte Ed25519 seed.
export function parsePrivateKey(env) {
  let bytes;
  if (/^[0-9a-fA-F]{64}$/.test(env)) {
    bytes = Buffer.from(env, "hex");
  } else {
    bytes = Buffer.from(env, "base64");
  }
  if (bytes.length !== 32) {
    throw new Error(
      `Ed25519 private key must be 32 bytes, got ${bytes.length} (secret must be the raw 32-byte seed, hex or base64)`
    );
  }
  return bytes;
}

export function privateKeyFromSeed(seed) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

// Derive the raw 32-byte Ed25519 public key from the seed.
export function derivePublicKey(seed) {
  const jwk = privateKeyFromSeed(seed).export({ format: "jwk" });
  return Buffer.from(jwk.x, "base64url");
}

// Parse a public key that may be:
//   - base64 of a minisign.pub TEXT blob (2 lines; last line = base64 of 42 bytes)
//   - base64 of a raw 32-byte Ed25519 key
//   - base64 of a 33-byte 0x45-tagged key
// Returns { raw: Buffer(32), keyid: Buffer(8) }.
export function parsePublicKey(pubkeyB64) {
  const buf = Buffer.from(pubkeyB64, "base64");
  const text = buf.toString("utf8");
  if (text.includes("untrusted comment") || text.includes("\n")) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const keyLine = lines[lines.length - 1];
    const bytes = Buffer.from(keyLine, "base64");
    return splitMinisignKey(bytes);
  }
  return splitMinisignKey(buf);
}

function splitMinisignKey(bytes) {
  // minisign key blob: [0x45, 0x64] + keyid(8) + raw key(32) = 42 bytes
  if (bytes.length === 42 && bytes[0] === 0x45) {
    return { raw: bytes.subarray(10, 42), keyid: bytes.subarray(2, 10) };
  }
  // 0x45-tagged raw key: [0x45] + raw(32)
  if (bytes.length === 33 && bytes[0] === 0x45) {
    return { raw: bytes.subarray(1), keyid: bytes.subarray(1, 9) };
  }
  if (bytes.length === 32) {
    return { raw: bytes, keyid: bytes.subarray(0, 8) };
  }
  throw new Error(`Unsupported public key encoding (${bytes.length} bytes)`);
}

// ── Minisign format builders ────────────────────────────────────────────

// Build the base64 of a minisign.pub TEXT blob from a raw key + keyid.
// Used by --self-test and to synthesize a pubkey for a fresh keypair.
export function buildMinisignPubkey(raw, keyid) {
  const keyLine = Buffer.concat([Buffer.from([0x45, 0x64]), keyid, raw]); // 42 bytes
  const text = [
    `untrusted comment: minisign public key: ${keyid.toString("hex").toUpperCase()}`,
    keyLine.toString("base64"),
    "",
  ].join("\n");
  return Buffer.from(text, "utf8").toString("base64");
}

// Sign file bytes and return the base64 `signature` field for a manifest.
// Format matches `tauri signer sign` output byte-for-byte (prehashed mode).
export function buildMinisignSignature(seed, fileBytes, filename, keyid) {
  const priv = privateKeyFromSeed(seed);
  // Main signature over BLAKE2b-512 of the file (prehashed mode).
  const hash = createHash("blake2b512").update(fileBytes).digest();
  const sig64 = sign(null, hash, priv);
  // Trusted comment content (the client signs sig64 || content[17:]).
  const timestamp = Math.floor(Date.now() / 1000);
  const trustedContent = `timestamp:${timestamp}\tfile:${filename}`;
  // Global signature over sig64 || trusted_comment_content bytes.
  const globalMsg = Buffer.concat([sig64, Buffer.from(trustedContent, "utf8")]);
  const globalSig = sign(null, globalMsg, priv);
  // Signature line: [0x45, 0x44] + keyid(8) + sig(64) = 74 bytes.
  const sigLine = Buffer.concat([Buffer.from([0x45, 0x44]), keyid, sig64]);
  const text = [
    "untrusted comment: signature from tauri secret key",
    sigLine.toString("base64"),
    `trusted comment: ${trustedContent}`,
    globalSig.toString("base64"),
    "",
  ].join("\n");
  return Buffer.from(text, "utf8").toString("base64");
}

// ── Verification (mirrors minisign_verify::PublicKey::verify) ───────────

// Parse the base64 `signature` field into its components, replicating
// minisign_verify::Signature::decode.
export function decodeMinisignSignature(signatureB64) {
  const text = Buffer.from(signatureB64, "base64").toString("utf8");
  const lines = text.split("\n");
  if (lines.length < 4) {
    throw new Error("Signature blob must contain 4 lines");
  }
  const bin1 = Buffer.from(lines[1].trim(), "base64");
  const bin2 = Buffer.from(lines[3].trim(), "base64");
  if (bin1.length !== 74 || bin2.length !== 64) {
    throw new Error(`Invalid signature blob lengths (${bin1.length}, ${bin2.length})`);
  }
  const alg = [bin1[0], bin1[1]];
  if (alg[0] !== 0x45 || (alg[1] !== 0x44 && alg[1] !== 0x64)) {
    throw new Error("Unsupported signature algorithm tag");
  }
  const trustedLine = lines[2];
  if (!trustedLine.startsWith("trusted comment: ")) {
    throw new Error("Signature trusted comment missing");
  }
  return {
    isPrehashed: alg[1] === 0x44,
    keyid: bin1.subarray(2, 10),
    sig64: bin1.subarray(10, 74),
    trustedContent: trustedLine.slice(17),
    globalSig: bin2,
  };
}

function verifyBytes(pubkeyRaw, bytes, signature) {
  const key = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, pubkeyRaw]),
    format: "der",
    type: "spki",
  });
  return verify(null, bytes, key, signature);
}

// Verify an installer against a manifest `signature` using the raw pubkey.
// Mirrors minisign_verify::PublicKey::verify(data, &sig, allow_legacy=true).
export function verifyMinisignSignature(pubkeyRaw, fileBytes, signatureB64) {
  const sig = decodeMinisignSignature(signatureB64);
  // keyid must match the pubkey's embedded keyid.
  if (!sig.keyid.equals(parsePublicKeyFromRaw(pubkeyRaw).keyid)) {
    return false;
  }
  const message = sig.isPrehashed
    ? createHash("blake2b512").update(fileBytes).digest()
    : fileBytes;
  if (!verifyBytes(pubkeyRaw, message, sig.sig64)) {
    return false;
  }
  // Global signature over sig64 || trusted-comment content.
  const globalMsg = Buffer.concat([sig.sig64, Buffer.from(sig.trustedContent, "utf8")]);
  return verifyBytes(pubkeyRaw, globalMsg, sig.globalSig);
}

function parsePublicKeyFromRaw(pubkeyRaw) {
  // keyid for a raw key defaults to its first 8 bytes (self-consistent).
  return { raw: pubkeyRaw, keyid: pubkeyRaw.subarray(0, 8) };
}

// ── Shared self-test primitives ─────────────────────────────────────────

// Deterministic test keypair used by both scripts' --self-test and the
// updater-compat integration check.
export function testKeypair() {
  const seed = Buffer.alloc(32, 0x42);
  const raw = derivePublicKey(seed);
  const keyid = raw.subarray(0, 8);
  return { seed, raw, keyid };
}
