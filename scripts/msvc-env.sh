#!/usr/bin/env bash
# msvc-env.sh -- derive LIB/INCLUDE/PATH from disk when VS instance registration
# is broken. SOURCED, not executed: `source scripts/msvc-env.sh` before any cargo
# invocation that links (check, build, test) when this checkout's toolchain
# registration is damaged. Extracted verbatim from scripts/check.sh in round 122
# (the r115 block, one sourceable home now): the matrix sources it at load time,
# and r121 measured that a scripted session running BARE cargo outside check.sh
# hits 18 kernel32.lib-class linker errors without it -- build scripts link too.
#
# Rust's windows-msvc target locates link.exe through the VS instance
# registration. When that registration is broken the toolset files can still be
# intact on disk -- measured r113: vswhere returned no instances while
# BuildTools 14.44.35207 + SDK 10.0.26100.0 were healthy, and every linking step
# of the matrix died on "linker `link.exe` not found" (the r114 register
# documents the manual bypass this block generalizes). Derive LIB/INCLUDE/PATH
# from disk the way vcvars would, but ONLY when vswhere finds no instance: on a
# healthy machine the block is inert (rustc resolves the toolset itself, and
# link.exe is normally not on PATH anywhere, so absence alone is not a trigger);
# on a machine with no VS at all the derivation finds nothing and the steps fail
# exactly as before. Newest toolset and SDK win, matching vcvars's preference.

# Rust's windows-msvc target locates link.exe through the VS instance
# registration. When that registration is broken the toolset files can still be
# intact on disk -- measured r113: vswhere returned no instances while
# BuildTools 14.44.35207 + SDK 10.0.26100.0 were healthy, and every linking step
# of this matrix died on "linker `link.exe` not found" (the r114 register
# documents the manual bypass this block generalizes). Derive LIB/INCLUDE/PATH
# from disk the way vcvars would, but ONLY when vswhere finds no instance: on a
# healthy machine the block is inert (rustc resolves the toolset itself, and
# link.exe is normally not on PATH anywhere, so absence alone is not a trigger);
# on a machine with no VS at all the derivation finds nothing and the steps fail
# exactly as before. Newest toolset and SDK win, matching vcvars's preference.
MSX86=""
if [ -d "/c/Program Files (x86)" ]; then
    MSX86="/c/Program Files (x86)"
elif command -v cygpath &>/dev/null && [ -n "$(printenv 'ProgramFiles(x86)' 2>/dev/null || true)" ]; then
    MSX86="$(cygpath -u "$(printenv 'ProgramFiles(x86)')" 2>/dev/null || true)"
fi
if [ -n "$MSX86" ]; then
    VSWHERE_EXE="$MSX86/Microsoft Visual Studio/Installer/vswhere.exe"
    VS_INSTANCE=""
    if [ -x "$VSWHERE_EXE" ]; then
        VS_INSTANCE="$("$VSWHERE_EXE" -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>/dev/null | head -n 1 | tr -d '\r' || true)"
    fi
    if [ -z "$VS_INSTANCE" ]; then
        TOOLSET_POSIX="$(ls -d "$MSX86/Microsoft Visual Studio"/*/*/VC/Tools/MSVC/* 2>/dev/null | sort -V | tail -n 1 || true)"
        KITS10_POSIX="$MSX86/Windows Kits/10"
        if [ -n "$TOOLSET_POSIX" ] && [ -d "$KITS10_POSIX/Lib" ]; then
            SDK_VER="$(basename "$(ls -d "$KITS10_POSIX/Lib"/* 2>/dev/null | sort -V | tail -n 1 || true)" || true)"
            if [ -n "$SDK_VER" ] && command -v cygpath &>/dev/null; then
                TOOLSET_WIN="$(cygpath -w "$TOOLSET_POSIX")"
                KITS10_WIN="$(cygpath -w "$KITS10_POSIX")"
                export LIB="$TOOLSET_WIN\\lib\\x64;$KITS10_WIN\\Lib\\$SDK_VER\\um\\x64;$KITS10_WIN\\Lib\\$SDK_VER\\ucrt\\x64"
                export INCLUDE="$TOOLSET_WIN\\include;$KITS10_WIN\\Include\\$SDK_VER\\um;$KITS10_WIN\\Include\\$SDK_VER\\ucrt;$KITS10_WIN\\Include\\$SDK_VER\\shared"
                export PATH="$TOOLSET_POSIX/bin/Hostx64/x64:$KITS10_POSIX/bin/$SDK_VER/x64:$PATH"
                echo "msvc-env.sh: VS registration unusable; derived MSVC env from disk (toolset ${TOOLSET_POSIX##*/}, SDK $SDK_VER)" >&2
            fi
        fi
    fi
fi
