#!/usr/bin/env python3
"""scripts/extract-updater-seed.py — unlock a Tauri updater private key file.

Recovers the raw Ed25519 **seed** from an `oz-pos-updater.key` file so it can
be stored as the `UPDATER_PRIVATE_KEY` GitHub Actions secret.

Key file format (Tauri's vendored rsign, "untrusted comment: rsign encrypted
secret key"): the file is base64 of the rsign text wrapper, whose second line
is base64 of a 158-byte binary blob:

    [0:2]  sig_alg     "Ed"                    (Ed25519)
    [2:4]  kdf_alg     "Sc"                    (scrypt)
    [4:6]  chk_alg     "B2"                    (BLAKE2b-256)
    [6:38] kdf_salt    32 bytes                (scrypt salt)
    [38:46] opslimit   u64 LE                  (scrypt opslimit)
    [46:54] memlimit   u64 LE                  (scrypt memlimit)
    [54:62] keynum     8 bytes                 (encrypted with stream)
    [62:126] sk        64 bytes = seed(32) || pubkey(32)  (encrypted)
    [126:158] chk      32 bytes = BLAKE2b-256(sig_alg || keynum || sk)

The stream is libsodium scrypt (crypto_pwhash_scryptsalsa208sha256) with
params derived via pickparams(opslimit, memlimit) -> N=2^N_log2, r=8, p=1,
dklen = 8+64+32 = 104 bytes. Every field after the salt/limit header is
XORed with the stream.

Usage:
    python scripts/extract-updater-seed.py                     # prompts for password
    python scripts/extract-updater-seed.py --password-stdin    # non-interactive
    python scripts/extract-updater-seed.py --self-test         # round-trip self check

On success prints the 64-hex seed (UPDATER_PRIVATE_KEY value) and verifies
the derived public key against the committed tauri.conf.json pubkey.
"""

import argparse
import base64
import getpass
import hashlib
import json
import os
import struct
import sys

MAGIC = b"EdScB2"
SALTBYTES = 32
KEYNUMBYTES = 8
SECRETKEYBYTES = 64
BYTES = 32  # BLAKE2b-256 digest size
STREAM_LEN = BYTES + SECRETKEYBYTES + KEYNUMBYTES  # 104

KEY_FILE_DEFAULT = "kasirmu-updater.key"
TAURI_CONF = "apps/desktop-tauri/tauri.conf.json"


class KeyFormatError(Exception):
    pass


def pickparams(opslimit, memlimit):
    """Port of libsodium pickparams() — returns (N, r, p)."""
    if opslimit < 32768:
        opslimit = 32768
    r = 8
    if opslimit < memlimit // 32:
        p = 1
        maxN = opslimit // (r * 4)
        n_log2 = 1
        while n_log2 < 63 and (1 << n_log2) <= maxN // 2:
            n_log2 += 1
    else:
        maxN = memlimit // (r * 128)
        n_log2 = 1
        while n_log2 < 63 and (1 << n_log2) <= maxN // 2:
            n_log2 += 1
        maxrp = (opslimit // 4) // (1 << n_log2)
        maxrp = min(maxrp, 0x3FFFFFFF)
        p = maxrp // r
    return (1 << n_log2), r, p


def scrypt_stream(password, salt, opslimit, memlimit):
    """Derive the 104-byte XOR stream exactly as libsodium would."""
    n, r, p = pickparams(opslimit, memlimit)
    # scrypt uses 128 * N * r bytes of memory; derive the limit from the
    # actual params so larger keys (e.g. SENSITIVE constants) still work.
    maxmem = 128 * n * r * 2 + 4096
    return hashlib.scrypt(
        password,
        salt=salt,
        n=n,
        r=r,
        p=p,
        dklen=STREAM_LEN,
        maxmem=maxmem,
    )


def parse_blob(blob):
    """Split a 158-byte rsign binary blob into its fields."""
    sig_alg = blob[0:2]
    kdf_alg = blob[2:4]
    chk_alg = blob[4:6]
    if sig_alg != b"Ed" or kdf_alg != b"Sc" or chk_alg != b"B2":
        raise KeyFormatError(f"unexpected algorithm header {sig_alg!r} {kdf_alg!r} {chk_alg!r}")
    salt = blob[6:6 + SALTBYTES]
    opslimit = struct.unpack("<Q", blob[38:46])[0]
    memlimit = struct.unpack("<Q", blob[46:54])[0]
    enc_keynum = blob[54:54 + KEYNUMBYTES]
    enc_sk = blob[62:62 + SECRETKEYBYTES]
    enc_chk = blob[126:126 + BYTES]
    return sig_alg, salt, opslimit, memlimit, enc_keynum, enc_sk, enc_chk


def parse_key_file(path):
    """Parse the key file into (sig_alg, salt, opslimit, memlimit, enc_keynum,
    enc_sk, enc_chk). Handles both the plaintext rsign text wrapper and the
    base64-wrapped variant seen in the repo's oz-pos-updater.key."""
    with open(path, "rb") as f:
        raw = f.read()
    text = raw.decode("utf-8", "replace")
    # The repo's key file is the whole rsign text wrapper base64-encoded.
    if not text.lstrip().startswith("untrusted comment"):
        try:
            text = base64.b64decode(raw).decode("utf-8", "replace")
        except Exception:
            pass
    blob_b64 = None
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("untrusted comment") or line.startswith("trusted comment"):
            continue
        try:
            candidate = base64.b64decode(line, validate=True)
        except Exception:
            continue
        if len(candidate) == 158 and candidate[:6] == MAGIC:
            blob_b64 = line
            break
    if blob_b64 is None:
        raise KeyFormatError(
            "could not locate the rsign binary blob (158 bytes, 'EdScB2' magic)"
        )
    return parse_blob(base64.b64decode(blob_b64))


def decrypt(password, path=KEY_FILE_DEFAULT):
    sig_alg, salt, opslimit, memlimit, enc_keynum, enc_sk, enc_chk = parse_key_file(path)
    stream = scrypt_stream(password.encode("utf-8"), salt, opslimit, memlimit)
    keynum = bytes(a ^ b for a, b in zip(enc_keynum, stream[0:KEYNUMBYTES]))
    sk = bytes(a ^ b for a, b in zip(enc_sk, stream[KEYNUMBYTES:KEYNUMBYTES + SECRETKEYBYTES]))
    chk = bytes(a ^ b for a, b in zip(enc_chk, stream[KEYNUMBYTES + SECRETKEYBYTES:STREAM_LEN]))
    # BLAKE2b-256 (rsign's generichash default digest size is 32 bytes —
    # NOT hashlib.blake2b's 64-byte default).
    expected = hashlib.blake2b(sig_alg + keynum + sk, digest_size=32).digest()
    if expected != chk:
        raise KeyFormatError(
            "BLAKE2b-256 checksum mismatch - wrong password, or the key file is corrupt"
        )
    seed = sk[0:32]
    pubkey = sk[32:64]
    return seed, pubkey


def load_committed_pubkey():
    """Return the raw 32-byte Ed25519 pubkey from tauri.conf.json (minisign
    encoding, mirroring updater-crypto.mjs parsePublicKey)."""
    with open(TAURI_CONF, "r", encoding="utf-8") as f:
        conf = json.load(f)
    b64 = conf["plugins"]["updater"]["pubkey"]
    buf = base64.b64decode(b64)
    text = buf.decode("utf-8", "replace")
    if "untrusted comment" in text or "\n" in text:
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        key_line = lines[-1]
        bytes_ = base64.b64decode(key_line)
    else:
        bytes_ = buf
    if len(bytes_) == 42 and bytes_[0] == 0x45:
        return bytes_[10:42]
    if len(bytes_) == 33 and bytes_[0] == 0x45:
        return bytes_[1:]
    if len(bytes_) == 32:
        return bytes_
    raise KeyFormatError(f"unsupported public key encoding ({len(bytes_)} bytes)")


def build_blob_for_self_test(password, salt=None, keynum=None, sk=None, opslimit=(1 << 20), memlimit=(1 << 25)):
    """Encrypt side used only by --self-test (mirrors rsign generate())."""
    import random

    if salt is None:
        salt = random.randbytes(SALTBYTES)
    if keynum is None:
        keynum = random.randbytes(KEYNUMBYTES)
    if sk is None:
        sk = random.randbytes(SECRETKEYBYTES)
    sig_alg = b"Ed"
    chk = hashlib.blake2b(sig_alg + keynum + sk, digest_size=32).digest()
    stream = scrypt_stream(password.encode("utf-8"), salt, opslimit, memlimit)
    enc_keynum = bytes(a ^ b for a, b in zip(keynum, stream[0:KEYNUMBYTES]))
    enc_sk = bytes(a ^ b for a, b in zip(sk, stream[KEYNUMBYTES:KEYNUMBYTES + SECRETKEYBYTES]))
    enc_chk = bytes(a ^ b for a, b in zip(chk, stream[KEYNUMBYTES + SECRETKEYBYTES:STREAM_LEN]))
    blob = (
        sig_alg
        + b"Sc"
        + b"B2"
        + salt
        + struct.pack("<Q", opslimit)
        + struct.pack("<Q", memlimit)
        + enc_keynum
        + enc_sk
        + enc_chk
    )
    # Wrap in the same text+base64 form the repo's key file uses.
    inner = base64.b64encode(blob).decode("ascii")
    wrapper = "untrusted comment: rsign encrypted secret key\n" + inner + "\n"
    return base64.b64encode(wrapper.encode("utf-8")).decode("ascii")


def self_test():
    password = "self-test-password-123"
    sk = bytes(range(64))
    keynum = bytes(range(8, 16))
    salt = bytes(range(32, 64))
    wrapped = build_blob_for_self_test(password, salt=salt, keynum=keynum, sk=sk)
    seed, pubkey = _decrypt_from_wrapped(wrapped, password)
    if seed != sk[0:32] or pubkey != sk[32:64]:
        raise KeyFormatError("self-test round-trip mismatch")
    # Wrong password must fail the checksum.
    try:
        _decrypt_from_wrapped(wrapped, "wrong-password")
    except KeyFormatError:
        pass
    else:
        raise KeyFormatError("self-test: wrong password unexpectedly succeeded")
    print("self-test OK: encrypt -> decrypt round-trip + wrong-password rejection passed")
    return 0


def _decrypt_from_wrapped(wrapped, password):
    # Reuse the same base64-wrapper unwrap + blob parse as parse_key_file,
    # but operate on in-memory bytes so the self-test needs no temp file.
    text = base64.b64decode(wrapped.encode("utf-8")).decode("utf-8", "replace")
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("untrusted comment") or line.startswith("trusted comment"):
            continue
        try:
            candidate = base64.b64decode(line, validate=True)
        except Exception:
            continue
        if len(candidate) == 158 and candidate[:6] == MAGIC:
            sig_alg, salt, opslimit, memlimit, enc_keynum, enc_sk, enc_chk = parse_blob(candidate)
            stream = scrypt_stream(password.encode("utf-8"), salt, opslimit, memlimit)
            keynum = bytes(a ^ b for a, b in zip(enc_keynum, stream[0:KEYNUMBYTES]))
            sk = bytes(a ^ b for a, b in zip(enc_sk, stream[KEYNUMBYTES:KEYNUMBYTES + SECRETKEYBYTES]))
            chk = bytes(a ^ b for a, b in zip(enc_chk, stream[KEYNUMBYTES + SECRETKEYBYTES:STREAM_LEN]))
            expected = hashlib.blake2b(sig_alg + keynum + sk, digest_size=32).digest()
            if expected != chk:
                raise KeyFormatError("checksum mismatch (self-test)")
            return sk[0:32], sk[32:64]
    raise KeyFormatError("could not locate the rsign binary blob (self-test)")


def main():
    ap = argparse.ArgumentParser(description="Extract the Ed25519 seed from a Tauri updater key file")
    ap.add_argument("--key-file", default=KEY_FILE_DEFAULT, help=f"path to the rsign key file (default: {KEY_FILE_DEFAULT})")
    ap.add_argument("--password-stdin", action="store_true", help="read the password from stdin instead of prompting")
    ap.add_argument("--self-test", action="store_true", help="run the encrypt/decrypt round-trip self check")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    if not os.path.exists(args.key_file):
        print(f"error: key file not found: {args.key_file}", file=sys.stderr)
        return 2
    if not os.path.exists(TAURI_CONF):
        print(f"error: could not read {TAURI_CONF} for pubkey verification", file=sys.stderr)
        return 2

    if args.password_stdin:
        password = sys.stdin.readline().rstrip("\n")
    else:
        password = getpass.getpass("Password for {}: ".format(args.key_file))

    try:
        seed, pubkey = decrypt(password, path=args.key_file)
    except KeyFormatError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    committed = load_committed_pubkey()
    if pubkey != committed:
        print(
            "error: decrypted public key does not match the committed tauri.conf.json pubkey — "
            "this key file belongs to a different keypair (or the wrong file).",
            file=sys.stderr,
        )
        return 1

    print("PASSWORD OK — public key matches the committed updater pubkey.")
    print(f"UPDATER_PRIVATE_KEY={seed.hex()}")
    print("Store this value in the GitHub Actions secret UPDATER_PRIVATE_KEY. Do not commit it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
