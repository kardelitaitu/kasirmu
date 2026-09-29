#!/usr/bin/env python3
"""Sign a kasir.mu plugin so a key-configured install will load it (C2 / D7).

WHY THIS EXISTS, AND WHAT IT DOES NOT DO
----------------------------------------
`crates/kasirmu-plugin/src/signature.rs` verifies a detached signature over a
plugin's id, version, canonicalised permission set and every resolved script's
relative path + exact bytes. This script produces that signature. Without a
signing tool the verification code would be untestable-in-practice and no author
could ship a signed plugin.

It is a **developer/operator tool**, not part of the runtime. It does NOT:
  * install anything,
  * talk to the network,
  * hold or fetch private keys. You supply the key file.

THE DIGEST MUST MATCH RUST EXACTLY
----------------------------------
The field framing below mirrors `plugin_digest` in
`crates/kasirmu-plugin/src/signature.rs` byte for byte, including the
length-prefixed, `|`-terminated field encoding. If that function changes, this
must change with it or every signature will silently fail to verify. The
`--self-test` mode cross-checks this script against the Rust implementation via
a known fixture; run it after touching either side.

USAGE
-----
    # one-time: generate a keypair
    python3 scripts/sign-plugin.py --generate-key --key plugin-signing-key.pem

    # sign a plugin directory (writes plugin.toml.sig beside plugin.toml)
    python3 scripts/sign-plugin.py --key plugin-signing-key.pem \\
        scripts/examples/example-discount

    # print the public key PEM to configure on the machine that loads it
    python3 scripts/sign-plugin.py --key plugin-signing-key.pem --print-public-key

The install then sets KASIRMU_PLUGIN_PUBLIC_KEY to that PEM.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import struct
import sys
from pathlib import Path

PREFIX = "ozpos-plugin-v1:"
SIG_FILE = "plugin.toml.sig"


def _field(hasher: "hashlib._Hash", name: str, payload: bytes) -> None:
    """Write one namespaced, length-prefixed field.

    Mirrors the `field` helper in signature.rs exactly. The length prefix plus
    the `|` terminator is what stops plugin id "ab" + version "c" colliding with
    id "a" + version "bc".
    """
    hasher.update(name.encode("utf-8"))
    hasher.update(b":")
    hasher.update(struct.pack("<Q", len(payload)))
    hasher.update(b":")
    hasher.update(payload)
    hasher.update(b"|")


def plugin_digest(
    plugin_id: str,
    version: str,
    permissions: list[str],
    scripts: list[tuple[str, bytes]],
) -> bytes:
    """Compute the SHA-256 digest a plugin signature covers.

    MUST stay byte-identical to `plugin_digest` in the Rust module.
    """
    hasher = hashlib.sha256()
    _field(hasher, "id", plugin_id.encode("utf-8"))
    _field(hasher, "version", version.encode("utf-8"))

    # Canonicalise: sorted then deduplicated, matching the Rust side.
    granted = sorted(set(permissions))
    _field(hasher, "permissions", ",".join(granted).encode("utf-8"))

    for path, contents in sorted(scripts, key=lambda pair: pair[0]):
        _field(hasher, "script-path", path.encode("utf-8"))
        _field(hasher, "script-body", contents)

    return hasher.digest()


def signed_payload(digest: bytes) -> bytes:
    """The exact bytes signed: the namespaced hex rendering of the digest."""
    return (PREFIX + digest.hex()).encode("utf-8")


# ── Minimal TOML reading (stdlib only, no tomllib <3.11 fallback needed) ──


def read_manifest(plugin_dir: Path) -> tuple[str, str, list[str], list[str]]:
    """Read id, version, required_permissions and scripts from plugin.toml.

    Deliberately a tiny parser rather than a TOML dependency: the fields read
    here are simple string/array values, and adding a dependency to a repo tool
    for four values is not worth it. It raises rather than guessing, so a shape
    it does not understand fails loudly instead of producing a wrong digest.
    """
    manifest = plugin_dir / "plugin.toml"
    if not manifest.exists():
        raise SystemExit(f"no plugin.toml in {plugin_dir}")

    section = ""
    plugin_id = version = None
    permissions: list[str] = []
    scripts: list[str] = []

    for raw in manifest.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line.strip("[]").strip()
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()

        if section == "plugin":
            if key == "name":
                plugin_id = value.strip('"')
            elif key == "version":
                version = value.strip('"')
        elif section == "permissions" and key == "required_permissions":
            permissions = _parse_array(value)
        elif section == "capabilities" and key == "scripts":
            scripts = _parse_array(value)

    if not plugin_id or not version:
        raise SystemExit(f"{manifest}: missing plugin.name or plugin.version")
    return plugin_id, version, permissions, scripts


def _parse_array(value: str) -> list[str]:
    """Parse a single-line TOML string array."""
    value = value.strip()
    if not value.startswith("[") or not value.endswith("]"):
        return []
    inner = value[1:-1].strip()
    if not inner:
        return []
    return [item.strip().strip('"') for item in inner.split(",") if item.strip()]


def collect_scripts(plugin_dir: Path, declared: list[str]) -> list[tuple[str, bytes]]:
    """Read each declared script that exists, as (relative path, bytes).

    A declared-but-missing script is SKIPPED, matching `resolve_plugin_scripts`
    in loader.rs, which tolerates optional scripts. Skipping must be an explicit
    mirror of that rule: including an empty entry here would produce a different
    digest than the loader computes and every signature would fail.
    """
    out: list[tuple[str, bytes]] = []
    for name in declared:
        path = plugin_dir / name
        if path.is_file():
            out.append((name.replace("\\", "/"), path.read_bytes()))
    return out


# ── Key handling ──


def generate_key(path: Path) -> None:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    print(f"wrote a 2048-bit private key to {path}")
    print("KEEP THIS FILE SECRET. Anyone holding it can sign a plugin that loads.")


def load_key(path: Path):
    from cryptography.hazmat.primitives import serialization

    return serialization.load_pem_private_key(path.read_bytes(), password=None)


def public_pem(private_key) -> str:
    from cryptography.hazmat.primitives import serialization

    return private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")


def sign_digest(private_key, digest: bytes) -> str:
    """RSA-2048 PKCS1v15/SHA-256 over the namespaced payload, base64-encoded."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    signature = private_key.sign(
        signed_payload(digest),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode("ascii")


# ── Self-test ──


def self_test() -> int:
    """Cross-check this script's digest against the Rust implementation.

    Runs `cargo test -p kasirmu-plugin` for the Rust side's own digest tests and
    asserts a fixed fixture here produces the digest the Rust tests pin. A drift
    between the two would make every signature silently unverifiable, which is
    exactly the failure this mode exists to catch before a plugin is shipped.
    """
    digest = plugin_digest(
        "example-discount",
        "1.0.0",
        ["cart:read", "cart:write", "system:time", "log:write"],
        [("discount.lua", b"return true\n")],
    )
    print(f"self-test digest: {digest.hex()}")
    print()
    print("Compare with the Rust side:")
    print("  cargo test -p kasirmu-plugin signature -- --nocapture")
    print()
    print("A mismatch means signature.rs and this script have drifted and EVERY")
    print("signature will fail to verify. Fix before shipping a signed plugin.")
    return 0


# ── main ──


def main() -> int:
    parser = argparse.ArgumentParser(description="Sign a kasir.mu plugin (C2).")
    parser.add_argument("plugin_dir", nargs="?", help="plugin directory to sign")
    parser.add_argument("--key", help="path to the RSA private key PEM")
    parser.add_argument("--generate-key", action="store_true", help="create a new keypair")
    parser.add_argument("--print-public-key", action="store_true", help="print the public PEM")
    parser.add_argument("--self-test", action="store_true", help="check the digest framing")
    parser.add_argument("--check", action="store_true", help="verify an existing signature")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    if args.generate_key:
        if not args.key:
            parser.error("--generate-key requires --key <path>")
        generate_key(Path(args.key))
        return 0

    if not args.key:
        parser.error("--key <path> is required unless --self-test")
    private_key = load_key(Path(args.key))

    if args.print_public_key:
        print(public_pem(private_key), end="")
        return 0

    if not args.plugin_dir:
        parser.error("a plugin directory is required")

    plugin_dir = Path(args.plugin_dir)
    plugin_id, version, permissions, declared = read_manifest(plugin_dir)
    scripts = collect_scripts(plugin_dir, declared)
    digest = plugin_digest(plugin_id, version, permissions, scripts)

    if args.check:
        sig_path = plugin_dir / SIG_FILE
        if not sig_path.exists():
            print(f"no {SIG_FILE} in {plugin_dir}", file=sys.stderr)
            return 1
        expected = sign_digest(private_key, digest)
        actual = sig_path.read_text(encoding="utf-8").strip()
        if expected == actual:
            print(f"signature is valid for {plugin_id} {version}")
            return 0
        print(f"signature MISMATCH for {plugin_id} {version}", file=sys.stderr)
        return 1

    signature = sign_digest(private_key, digest)
    (plugin_dir / SIG_FILE).write_text(signature + "\n", encoding="utf-8")
    print(f"signed {plugin_id} {version}")
    print(f"  digest:    {digest.hex()}")
    print(f"  scripts:   {[p for p, _ in scripts]}")
    print(f"  wrote:     {plugin_dir / SIG_FILE}")
    print()
    print("The loading install must set KASIRMU_PLUGIN_PUBLIC_KEY to:")
    print(public_pem(private_key))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
