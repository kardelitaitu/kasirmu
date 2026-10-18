# Four doc claims that were true of the document, not of the tool

**Scope:** `assets/branding/**` (10 READMEs) and `ops/install/**`; plus the citation-checker
coverage extension that found the rest. **Result:** 4 major corrections, `ops/install` verified
clean, all 14 gates green.

## The pattern, stated once

Every finding this pass had the same shape: **a document describing a mechanism by reading a
*sibling document* rather than the code that owns the mechanism.** The stamps even said
"EVERY CLAIM RE-DERIVED, NOT INHERITED" while inheriting. That is worth naming because this
corpus already records the same failure in larger forms (the QRIS decision, the `seed` verb, the
`KASIRMU_*` deploy names) — and the smaller ones get through precisely because they look
harmless.

## 1. `assets.*` is inert, and the manifest table said otherwise

`assets/branding/README.md` listed `assets.*` as "the paths the script copies from".
`scripts/sync-branding.ps1:176` assigns `$assets = $manifest.assets` and **never dereferences
it — zero `$assets.` references in 491 lines.** Every source path is a literal (`:238-245`
desktop list, `:275` web glob, `:299` vector glob).

**Why it matters beyond the doc:** a tenant whose files are named differently syncs *silently*
and ships a stale or absent icon. The reference template's own manifest declares
`"trayIcon": "desktop/tray-icon.png"`; the file is absent, so the script logs `[SKIP]` and
**exits 0**. A naming convention presented as a validated schema is worse than no schema,
because it is trusted.

## 2. The `appName` row patched one shell, not two

The row claimed `appName` writes `productName` **and window titles** to *both* shells. The
desktop patch has a `title` replace (`:336`); the tablet patch has none (`:349-353`) and rewrites
`productName` **and `identifier`** — a field that changes the Android application id, and which
the table did not list at all.

## 3. `icon.png` was documented 1024×1024; every shipped tenant is smaller

Measured: `default/desktop/icon.png` is **256×256** (byte-identical to `256x256.png`, 6,859 B),
`acme-tenant`'s is **512×512**. Only `assets/source-icon.png` is 1024×1024, and it is the source
the `.icns` generator reads — not a size the sync copies. A tenant obeying the old table writes a
1 MP PNG into both shells' `icons/`.

## 4. `hardware/` "ends up in the print and PDF paths" — nothing reads it

No code path consumes `assets/branding/*/hardware/*.png`. The script regenerates the
`hardware/README.md` and can cut the three PNGs from the source icon with ImageMagick; getting
them onto a receipt or an invoice is a **manual** step. Corrected to say so.

`ops/install/README.md` and `ops/install/win/README.md` were audited the same way and are
**clean** — all four scripts, all six flags, the NSIS `currentUser` mode, the four release
assets and the required-asset loop all verified against `release.yml` and `install.ps1`.

## The checker extension that funded this pass

The citation checker gained **adjacent-line anchors**, raising graded coverage from 137 to
**176** live citations (+28%) while holding 0 DRIFTED / 0 SYMBOL-GONE. See
`2026-10-19-line-number-citation-residual.md` for the mechanism and the two false positives that
forced its narrow gate.

Three genuine defects it surfaced alongside the branding work: a tablet data-command range
starting 11 lines early (`1090-1102` → `1101-1103`), a CLI dispatch cited at `commands/mod.rs:90`
instead of `:183`, and one API-reference citation whose neighbouring line supplied the wrong
symbol. Every other finding was a *correct* citation the heuristic mis-anchored, and each is now
annotated with the evidence rather than "fixed".

> last audited 19-10-26 by docs-auditor
