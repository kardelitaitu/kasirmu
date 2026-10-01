#!/usr/bin/env bash
# build-docs.sh — Build the kasir.mu documentation portal (mdBook)
#
# Pipeline (order matters):
#   1. cargo doc        → target/doc/
#   2. typedoc          → docs/src/api/ts/
#   3. copy guides/ADRs → docs/src/guides/ + docs/src/decisions/
#   4. copy rustdoc     → docs/src/api/rust/
#   5. generate SUMMARY.md from the copied trees
#   6. mdbook build     → docs/book/
#
# See docs/plans/documentation-portal-plan.md for the plan behind this layout.
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BOOK_SRC="$WORKSPACE_ROOT/docs/src"

if ! command -v mdbook >/dev/null 2>&1; then
    echo "error: mdbook not found — install it with: cargo install mdbook --locked" >&2
    exit 1
fi

echo "=========================================="
echo " Building kasir.mu Documentation Portal"
echo "=========================================="

echo ""
echo "[1/7] Generating Rust workspace API docs (cargo doc)..."
(cd "$WORKSPACE_ROOT" && cargo doc --workspace --no-deps --document-private-items)
echo "✔ Rust docs in target/doc/"

echo ""
echo "[2/7] Generating TypeScript API docs (TypeDoc)..."
if command -v npx >/dev/null 2>&1; then
    (cd "$WORKSPACE_ROOT/ui" && npx -y typedoc --skipErrorChecking --entryPointStrategy expand ./src/api ./src/types ./src/hooks --out ../docs/src/api/ts 2>/dev/null) || true
    if [ ! -f "$BOOK_SRC/api/ts/index.html" ]; then
        echo "⚠ TypeDoc output missing — install typedoc in ui/ (npm i -D typedoc) or check the invocation."
    fi
else
    echo "⚠ npx not found on PATH, skipping TypeDoc generation."
fi

echo ""
echo "[3/7] Copying detailed docs into the book source..."
rm -rf "$BOOK_SRC/guides" "$BOOK_SRC/decisions" "$BOOK_SRC/releases" "$BOOK_SRC/operations"
mkdir -p "$BOOK_SRC/guides" "$BOOK_SRC/decisions/archived" "$BOOK_SRC/releases" "$BOOK_SRC/operations"
cp "$WORKSPACE_ROOT"/docs/guides/*.md "$BOOK_SRC/guides/" 2>/dev/null || true
cp "$WORKSPACE_ROOT"/docs/decisions/*.md "$BOOK_SRC/decisions/" 2>/dev/null || true
cp "$WORKSPACE_ROOT"/docs/decisions/archived/*.md "$BOOK_SRC/decisions/archived/" 2>/dev/null || true
cp "$WORKSPACE_ROOT"/docs/releases/*.md "$BOOK_SRC/releases/" 2>/dev/null || true
cp "$WORKSPACE_ROOT"/docs/operations/*.md "$BOOK_SRC/operations/" 2>/dev/null || true
echo "✔ guides + ADRs + releases + operations copied into docs/src/"

echo ""
echo "[4/7] Copying Rust API docs into the book source..."
rm -rf "$BOOK_SRC/api/rust"
mkdir -p "$BOOK_SRC/api/rust"
if [ -d "$WORKSPACE_ROOT/target/doc" ]; then
    cp -r "$WORKSPACE_ROOT/target/doc/." "$BOOK_SRC/api/rust/"
    echo "✔ rustdoc copied into docs/src/api/rust/"
else
    echo "⚠ target/doc missing — cargo doc failed; writing placeholder."
    echo '<!doctype html><meta charset="utf-8"><title>Rust API Reference</title><body style="font-family:sans-serif;padding:40px;max-width:720px"><h1>Rust API Reference</h1><p>Placeholder — run <code>cargo doc --workspace --no-deps</code> to generate this section.</p></body>' > "$BOOK_SRC/api/rust/index.html"
fi
if [ ! -f "$BOOK_SRC/api/ts/index.html" ]; then
    mkdir -p "$BOOK_SRC/api/ts"
    echo '<!doctype html><meta charset="utf-8"><title>TypeScript API Reference</title><body style="font-family:sans-serif;padding:40px;max-width:720px"><h1>TypeScript API Reference</h1><p>Placeholder — run typedoc to generate this section.</p></body>' > "$BOOK_SRC/api/ts/index.html"
fi

echo ""
echo "[5/7] Generating the sidebar (SUMMARY.md) from the copied trees..."
python3 "$SCRIPT_DIR/gen-summary.py"
echo "✔ docs/src/SUMMARY.md generated"

echo ""
echo "[6/7] Building the book..."
if ! MDBOOK_OUT="$(cd "$WORKSPACE_ROOT/docs" && mdbook build 2>&1)"; then
    echo "$MDBOOK_OUT"
    echo "error: mdBook build failed." >&2
    exit 1
fi
echo "$MDBOOK_OUT" | tail -5
if echo "$MDBOOK_OUT" | grep -Eq '^[[:space:]]*(WARN|ERROR)'; then
    echo "$MDBOOK_OUT" | grep -E '^[[:space:]]*(WARN|ERROR)'
    echo "error: mdBook emitted warnings/errors — fix the docs and rebuild. See the lines above." >&2
    exit 1
fi

echo ""
echo "[7/7] Verifying the portal hub..."
PORTAL_INDEX="$WORKSPACE_ROOT/docs/book/index.html"
if [ -f "$PORTAL_INDEX" ]; then
    echo "✔ Master Documentation Hub ready at: $PORTAL_INDEX"
    if [ "$1" == "--open" ]; then
        if command -v xdg-open >/dev/null 2>&1; then
            xdg-open "$PORTAL_INDEX"
        elif command -v open >/dev/null 2>&1; then
            open "$PORTAL_INDEX"
        else
            echo "Open $PORTAL_INDEX in your browser."
        fi
    fi
else
    echo "error: portal index not found at $PORTAL_INDEX" >&2
    exit 1
fi

echo ""
echo "=========================================="
echo " Documentation Build Complete!"
echo "=========================================="
