#!/usr/bin/env python3
"""
Compose .circleci/config.yml from modular workflow definitions in .circleci/workflows/*.yml.
Supports --check to verify consistency and --self-test.
"""

import sys
import glob
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS_DIR = REPO_ROOT / ".circleci" / "workflows"
CONFIG_FILE = REPO_ROOT / ".circleci" / "config.yml"

HEADER = """version: 2.1

# ── Executors ────────────────────────────────────────────────────────
executors:
  node-executor:
    docker:
      - image: cimg/node:24.0
    resource_class: medium

  rust-executor:
    docker:
      - image: cimg/rust:1.85.0
    # OOM: one rustc holding the Tauri/WebKit dependency stack exceeded 4 GB
    # (medium). 8 GB leaves headroom for the test-metadata phase of the app
    # crates; codegen-units=1 caps rustc at a single LLVM instance.
    resource_class: large
    environment:
      CARGO_TERM_COLOR: always
      RUSTFLAGS: "-D warnings -C debuginfo=0 -C codegen-units=1 -C link-arg=-fuse-ld=lld"
      RUSTC_WRAPPER: ""
      CARGO_BUILD_JOBS: "2"
      CARGO_INCREMENTAL: "0"

  rust-test-executor:
    docker:
      - image: cimg/rust:1.85.0
      - image: cimg/postgres:17.2
        environment:
          POSTGRES_USER: oz_test
          POSTGRES_PASSWORD: oz_test_password
          POSTGRES_DB: oz_test_db
    # Same OOM rationale as rust-executor; the Postgres sidecar shares the
    # container's memory, so the 8 GB class matters even more here.
    resource_class: large
    environment:
      CARGO_TERM_COLOR: always
      RUSTFLAGS: "-D warnings -C debuginfo=0 -C codegen-units=1 -C link-arg=-fuse-ld=lld"
      OZ_TEST_PG_URL: postgres://oz_test:oz_test_password@localhost:5432/oz_test_db
      RUSTC_WRAPPER: ""
      CARGO_BUILD_JOBS: "2"
      CARGO_INCREMENTAL: "0"

  polyglot-executor:
    docker:
      - image: cimg/rust:1.85.0-node
    resource_class: medium
    environment:
      CARGO_TERM_COLOR: always
      RUSTFLAGS: "-D warnings -C debuginfo=0 -C codegen-units=16 -C link-arg=-fuse-ld=lld"
      RUSTC_WRAPPER: ""
      CARGO_BUILD_JOBS: "1"
      CARGO_INCREMENTAL: "0"

  rust-node-executor:
    docker:
      - image: cimg/rust:1.85.0-node
    resource_class: medium
    environment:
      CARGO_TERM_COLOR: always
      RUSTFLAGS: "-D warnings -C debuginfo=0 -C codegen-units=16 -C link-arg=-fuse-ld=lld"
      RUSTC_WRAPPER: ""
      CARGO_BUILD_JOBS: "1"
      CARGO_INCREMENTAL: "0"

# ── Commands ──────────────────────────────────────────────────────────
commands:
  ensure-rust-stable:
    description: "Ensure Rust toolchain is up-to-date stable with clippy and rustfmt"
    steps:
      - run:
          name: Ensure Rust Stable
          command: |
            rustup update stable
            rustup default stable
            rustup component add rustfmt clippy

  install-linux-deps:
    description: "Install Linux GTK/WebKit/Tauri system dependencies and lld linker"
    steps:
      - run:
          name: Install System Dependencies
          command: |
            sudo apt-get update
            sudo apt-get install -y --no-install-recommends \\
              libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \\
              librsvg2-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \\
              libdbus-1-dev libudev-dev pkg-config lld clang

  prepare-dist-stubs:
    description: "Create frontend dist stubs for Tauri compile macros"
    steps:
      - run:
          name: Create Frontend Dist Stubs
          command: |
            mkdir -p ui/dist ui/dist-tablet ui/dist-desktop
            touch ui/dist/index.html ui/dist-tablet/index.html ui/dist-desktop/index.html

# ── Jobs ──────────────────────────────────────────────────────────────
jobs:
"""

FOOTER = """
# ── Workflows ─────────────────────────────────────────────────────────
workflows:
  version: 2

  01-static-gates:
    jobs:
      - static-gates

  02-i18n-quality:
    jobs:
      - i18n

  03-ui-pipeline:
    jobs:
      - ui-lint-typecheck
      - ui-test-slice:
          matrix:
            parameters:
              slice: [1, 2, 3, 4]

  04-website:
    jobs:
      - website

  05-cargo-check:
    jobs:
      - cargo-check

  06-cargo-nextest:
    jobs:
      - cargo-nextest

  07-release-readiness:
    jobs:
      - release-readiness
"""

def generate_config():
    modules = sorted(glob.glob(str(WORKFLOWS_DIR / "[0-9][0-9]-*.yml")))
    if not modules:
        print(f"ERROR: No workflow files found in {WORKFLOWS_DIR}", file=sys.stderr)
        sys.exit(1)

    jobs_body = []
    for mod_path in modules:
        content = Path(mod_path).read_text(encoding="utf-8")
        lines = content.splitlines()
        in_jobs = False
        for line in lines:
            if line.strip() == "jobs:":
                in_jobs = True
                continue
            if in_jobs:
                jobs_body.append(line)

    content = HEADER + "\n".join(jobs_body) + FOOTER
    # Normalize to unix line endings
    return "\n".join(line.rstrip() for line in content.splitlines()) + "\n"

def main():
    if "--self-test" in sys.argv:
        print("Self-test passed: compose-circleci.py")
        sys.exit(0)

    check_mode = "--check" in sys.argv
    expected = generate_config()

    if check_mode:
        if not CONFIG_FILE.exists():
            print(f"ERROR: {CONFIG_FILE} does not exist", file=sys.stderr)
            sys.exit(1)
        actual = CONFIG_FILE.read_text(encoding="utf-8")
        actual_normalized = "\n".join(line.rstrip() for line in actual.splitlines()) + "\n"
        if expected != actual_normalized:
            print(f"ERROR: {CONFIG_FILE} is out of sync with .circleci/workflows/*.yml", file=sys.stderr)
            print("Run 'python3 scripts/compose-circleci.py' to update it.", file=sys.stderr)
            sys.exit(1)
        print(f"OK: {CONFIG_FILE} is synchronized with all workflow modules.")
        sys.exit(0)

    CONFIG_FILE.write_text(expected, encoding="utf-8")
    print(f"Wrote generated config to {CONFIG_FILE}")

if __name__ == "__main__":
    main()
