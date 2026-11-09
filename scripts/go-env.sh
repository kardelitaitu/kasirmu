#!/usr/bin/env bash
# scripts/go-env.sh — Go cache derivation for stripped environments (the r133
# sibling of msvc-env.sh's r122 extraction, same contract: inert on healthy
# machines, loud on derivation, fail-loud when nothing is found). `go` derives
# GOPATH/GOMODCACHE/GOCACHE from %LOCALAPPDATA% and %USERPROFILE%; a runner that
# strips BOTH (measured 2026-11-08: check.sh step 103 died with "go: module
# cache not found: neither GOMODCACHE nor GOPATH is set") leaves the Go lane
# unable to start at all, even with populated caches on disk. Source this before
# any go invocation:  . "$(dirname -- "$0")/go-env.sh"
if [ -n "${GOPATH:-}" ] && [ -n "${GOMODCACHE:-}" ] && [ -n "${GOCACHE:-}" ]; then
    return 0
fi
_h="${HOME:-${USERPROFILE:-}}"
if [ -n "$_h" ] && [ -d "$_h/go/pkg/mod" ]; then
    export GOPATH="${GOPATH:-$_h/go}"
    export GOMODCACHE="${GOMODCACHE:-$_h/go/pkg/mod}"
    export GOCACHE="${GOCACHE:-$_h/AppData/Local/go-build}"
    return 0
fi
for _d in /c/Users/*/go; do
    [ -d "$_d/pkg/mod" ] || continue
    _gocache="${_d%/go}/AppData/Local/go-build"
    [ -d "$_gocache" ] || continue
    export GOPATH="${GOPATH:-$_d}"
    export GOMODCACHE="${GOMODCACHE:-$_d/pkg/mod}"
    export GOCACHE="${GOCACHE:-$_gocache}"
    echo "go-env.sh: HOME/USERPROFILE unusable; derived Go caches from disk (GOPATH $_d, GOCACHE $_gocache)" >&2
    return 0
done
echo "go-env.sh: no populated Go module cache under /c/Users/*/go and no usable HOME — set GOPATH/GOMODCACHE/GOCACHE explicitly" >&2
return 1
