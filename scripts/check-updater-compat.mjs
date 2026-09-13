#!/usr/bin/env node
// ── OZ-POS Updater Client Compatibility Check (AUDIT-28 RELEASE-04) ─────
//
// End-to-end proof that signatures produced by `scripts/generate-latest-json.mjs`
// are accepted by the REAL Tauri updater client verification code path:
//
//   1. BUILD — compiles `scripts/updater-compat-check`, a Rust harness that
//      replicates tauri-plugin-updater 2.10.1 `verify_signature` line-for-line
//      using the SAME pinned crates the client resolves (minisign-verify
//      =0.2.5, base64 0.22 — both pinned in the harness Cargo.toml).
//   2. FIDELITY — a signature + pubkey produced by the REAL tauri-cli 2.11.1
//      (committed fixture) must VERIFY through the harness. This proves the
//      harness is faithful to the real toolchain (not just self-consistent).
//   3. GENERATE SCRIPTS — a fresh test keypair signs a dummy installer via
//      `generate-latest-json.mjs`; the harness must accept that signature.
//      If it is accepted here — by the exact crate the real client runs — it
//      will be accepted by the real updater client.
//   4. TAMPER REJECTION — a single flipped byte must be REJECTED.
//
// This closes the RELEASE-04 key-format compatibility loop end to end.
//
// Usage:
//   node scripts/check-updater-compat.mjs
//   node scripts/check-updater-compat.mjs --no-build   (use prebuilt harness)
//   node scripts/check-updater-compat.mjs --keep-temp  (inspect temp workdir)
//
// Exit codes:
//   0 — all checks passed
//   1 — a check failed
//   2 — usage/environment error (e.g. no cargo)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildMinisignPubkey,
  buildMinisignSignature,
  decodeMinisignSignature,
  parsePublicKey,
  testKeypair,
  verifyMinisignSignature,
} from "./updater-crypto.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIR = join(ROOT, "scripts", "updater-compat-check");
const EXE = join(HARNESS_DIR, "target", "release", process.platform === "win32" ? "oz-updater-compat-check.exe" : "oz-updater-compat-check");
const FIXTURES = join(HARNESS_DIR, "fixtures");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Harness invocation ────────────────────────────────────────────────
// The harness takes base64 via FILES (very long base64 can exceed Windows
// command-line limits / get mangled by shell quoting) and writes a verdict
// file which is the SINGLE source of truth for the outcome (exit codes can
// be lost when PowerShell's $LASTEXITCODE is unset, e.g. if the native
// process fails to launch).
//
// Windows hardening learned empirically in this repo's sandbox:
//   * the harness exe must run from a path WITHOUT spaces — the repo path
//     "C:\My Script\oz-pos\..." breaks native launches via cmd/PowerShell,
//     so we copy the exe into the (space-free) temp workdir;
//   * a freshly copied exe can be briefly locked by AV scanning, so a run
//     that produces no verdict file is retried a few times.
// Each call gets its OWN subdirectory so pub/sig/verdict files can never
// collide or go stale across checks (a shared verdict file races with the
// previous call's spawn, which produced the spurious REJECTED/VERIFIED
// results seen before this fix).
let callCounter = 0;
function runHarness(pubkeyB64, signatureB64, installerPath, workdir) {
  callCounter += 1;
  const callDir = join(workdir, `call-${callCounter}`);
  mkdirSync(callDir, { recursive: true });
  const pubF = join(callDir, "pub.b64");
  const sigF = join(callDir, "sig.b64");
  const verdictF = join(callDir, "verdict.txt");
  writeFileSync(pubF, pubkeyB64);
  writeFileSync(sigF, signatureB64);
  const args = ["--pubkey-file", pubF, "--signature-file", sigF, installerPath, "--output", verdictF];
  let lastStatus = null;
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let r;
    if (process.platform === "win32") {
      const quoted = args.map((a) => `"${a}"`).join(" ");
      // `*> log` forces PowerShell to fully drain the native process's
      // streams; the verdict file remains the authoritative result.
      const logF = join(callDir, "run.log");
      const ps = `& "${workdirExe}" ${quoted} *> "${logF}"`;
      r = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8", timeout: 60_000 });
    } else {
      r = spawnSync(workdirExe, args, { encoding: "utf8", timeout: 60_000 });
    }
    lastStatus = r.status;
    lastError = r.error?.message || "";
    if (existsSync(verdictF)) {
      return { status: lastStatus, error: lastError, verdict: readFileSync(verdictF, "utf8").trim() };
    }
    // No verdict file → the exe never actually ran (launch failure / AV
    // lock). Wait and retry; the final attempt reports the launch error.
    spawnSync(process.platform === "win32" ? "powershell.exe" : "true", process.platform === "win32" ? ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 1500"] : [], { timeout: 10_000 });
  }
  return { status: lastStatus, error: lastError || "harness produced no verdict after retries", verdict: "" };
}

// Path of the harness exe copied into the (space-free) workdir.
// Initialized after the build step; see main().
let workdirExe = EXE;

// ── Main ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const noBuild = argv.includes("--no-build");
const keepTemp = argv.includes("--keep-temp");

console.log("=== OZ-POS updater client compatibility check ===");
console.log(`Harness: ${EXE}`);

// 1. Build the harness (unless --no-build).
if (!noBuild) {
  if (!existsSync(join(HARNESS_DIR, "Cargo.toml"))) {
    console.error("FATAL: harness Cargo.toml missing at " + join(HARNESS_DIR, "Cargo.toml"));
    process.exit(2);
  }
  console.log("Building harness (cargo build --release)...");
  // Build environment: if sccache is not available on PATH, explicitly unset
  // RUSTC_WRAPPER so .cargo/config.toml's `rustc-wrapper = "sccache"` doesn't fail.
  const cargoEnv = { ...process.env };
  const sccacheProbe = spawnSync("sccache", ["--version"], { stdio: "ignore" });
  if (sccacheProbe.error || sccacheProbe.status !== 0) {
    cargoEnv.RUSTC_WRAPPER = "";
  }
  const b = spawnSync("cargo", ["build", "--release", "--manifest-path", join(HARNESS_DIR, "Cargo.toml")], {
    encoding: "utf8",
    cwd: HARNESS_DIR,
    timeout: 300_000,
    env: cargoEnv,
  });
  if (b.status !== 0) {
    console.error(b.stderr || b.stdout);
    console.error("FATAL: cargo build failed — cannot run compatibility check");
    process.exit(2);
  }
}

if (!existsSync(EXE)) {
  console.error(`FATAL: harness binary not found at ${EXE} (build failed?)`);
  process.exit(2);
}

const workdir = keepTemp
  ? (() => {
      rmSync(join(ROOT, ".tmp-updater-compat"), { recursive: true, force: true });
      mkdirSync(join(ROOT, ".tmp-updater-compat"), { recursive: true });
      return join(ROOT, ".tmp-updater-compat");
    })()
  : mkdtempSync(join(tmpdir(), "oz-updater-compat-"));

// Windows: copy the harness into the space-free workdir before any run.
if (process.platform === "win32") {
  const dest = join(workdir, "oz-updater-compat-check.exe");
  const { copyFileSync } = await import("node:fs");
  copyFileSync(EXE, dest);
  workdirExe = dest;
  console.log(`Copied harness to space-free path: ${dest}`);
}

try {
  // 2. FIDELITY: real tauri-cli 2.11.1 fixture must verify through the harness.
  console.log("\n[1/4] Real-signer fidelity (tauri-cli 2.11.1 fixture)");
  const realPub = readFileSync(join(FIXTURES, "real-tauri-cli-2.11.1.pub"), "utf8").trim();
  const realSig = readFileSync(join(FIXTURES, "real-tauri-cli-2.11.1.sig"), "utf8").trim();
  const realInst = join(FIXTURES, "real-tauri-cli-2.11.1.installer.bin");
  let r = runHarness(realPub, realSig, realInst, workdir);
  // The verdict FILE is authoritative: the harness writes it via --output,
  // and on Windows the PowerShell wrapper's own exit code is always 0 even
  // when the native process rejects.
  check(
    "real tauri-cli signature verifies through the client's minisign-verify",
    r.verdict === "VERIFIED",
    `verdict=${r.verdict || "(none)"} ${r.error || ""}`.trim()
  );

  // 3. GENERATE SCRIPTS: fresh keypair + generate-latest-json.mjs → harness accepts.
  console.log("\n[2/4] scripts/generate-latest-json.mjs output → real client verifier");
  const { seed, raw, keyid } = testKeypair();
  const testPubkeyB64 = buildMinisignPubkey(raw, keyid);
  const dummyInstaller = join(workdir, "dummy-installer.bin");
  writeFileSync(dummyInstaller, Buffer.concat([
    Buffer.from("OZ-POS fake installer payload for compat check\n"),
    Buffer.alloc(1024, 0x5a),
  ]));
  const version = "9.9.9";
  const notes = "updater-compat integration check";
  const platform = "linux-x86_64";
  const gen = spawnSync(
    process.execPath,
    [
      join(ROOT, "scripts", "generate-latest-json.mjs"),
      version, notes, platform, dummyInstaller,
      "--verify-pubkey", testPubkeyB64,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, UPDATER_PRIVATE_KEY: seed.toString("hex") },
      timeout: 60_000,
    }
  );
  if (gen.status !== 0) {
    check("generate-latest-json.mjs ran successfully", false, (gen.stderr || gen.stdout || "").slice(0, 300));
  } else {
    check("generate-latest-json.mjs ran successfully", true);
    const manifest = JSON.parse(gen.stdout);
    const entry = manifest.platforms?.[platform];
    check("manifest has platform entry + signature", Boolean(entry?.signature));
    if (entry?.signature) {
      // Feed the generated signature through the REAL client verifier.
      r = runHarness(testPubkeyB64, entry.signature, dummyInstaller, workdir);
      check(
        "generated signature accepted by real client code path",
        r.verdict === "VERIFIED",
        `verdict=${r.verdict || "(none)"} ${r.error || ""}`.trim()
      );
      // The Node verifier must agree with the harness (cross-consistency).
      const okNode = verifyMinisignSignature(raw, readFileSync(dummyInstaller), entry.signature);
      check("Node verifier agrees with the Rust harness", okNode === true);
      // Keyid in the signature must equal the pubkey keyid.
      const sigParts = decodeMinisignSignature(entry.signature);
      check("signature keyid matches pubkey keyid", sigParts.keyid.equals(keyid));
      // The committed tauri.conf.json pubkey must parse (minisign format).
      const confPubkey = JSON.parse(
        readFileSync(join(ROOT, "apps/desktop-client/tauri.conf.json"), "utf8")
      ).plugins.updater.pubkey;
      let committedKeyid = null;
      try {
        committedKeyid = parsePublicKey(confPubkey).keyid;
      } catch {
        /* handled below */
      }
      check("committed tauri.conf.json pubkey parses (minisign format)", Boolean(committedKeyid));
    }
  }

  // 4. TAMPER REJECTION: flip a byte → harness must reject.
  console.log("\n[3/4] Tamper rejection");
  const tampered = join(workdir, "tampered.bin");
  const original = readFileSync(dummyInstaller);
  const tamperedBytes = Buffer.from(original);
  tamperedBytes[0] ^= 0xff;
  writeFileSync(tampered, tamperedBytes);
  // Re-sign the ORIGINAL bytes, then verify against TAMPERED bytes.
  const sigForOriginal = buildMinisignSignature(seed, original, "dummy-installer.bin", keyid);
  r = runHarness(testPubkeyB64, sigForOriginal, tampered, workdir);
  // Rejection verdicts carry a reason suffix (e.g. "REJECTED: verify: ..."),
  // so match the prefix. Verification writes exactly "VERIFIED".
  check(
    "tampered installer rejected by real client code path",
    (r.verdict || "").startsWith("REJECTED"),
    `verdict=${r.verdict || "(none)"} ${r.error || ""}`.trim()
  );

  // 5. Self-tests of the Node scripts themselves.
  console.log("\n[4/4] Node script self-tests");
  for (const script of ["generate-latest-json.mjs", "verify-updater-signature.mjs"]) {
    const s = spawnSync(process.execPath, [join(ROOT, "scripts", script), "--self-test"], {
      encoding: "utf8",
      timeout: 60_000,
    });
    check(
      `${script} --self-test`,
      s.status === 0,
      s.status === 0 ? (s.stdout || "").trim() : (s.stderr || "").slice(0, 200)
    );
  }

  console.log("\n=== RESULT ===");
  if (failures === 0) {
    console.log("ALL CHECKS PASSED — generated updater signatures are accepted by the real Tauri client verifier.");
  } else {
    console.error(`${failures} check(s) FAILED.`);
  }
} finally {
  if (!keepTemp) {
    rmSync(workdir, { recursive: true, force: true });
  }
}

process.exit(failures === 0 ? 0 : 1);
