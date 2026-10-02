<!-- Superseded audit stamp (2026-07-22, body kept verbatim) · Hermes-Agent · status: STALE (1 finding — tracked gap now closed) · F1: the doc lists 4 bundles (gift-cards.id.ftl, purchasing.id.ftl, stock-counting.id.ftl, stock-transfers.id.ftl) as EXCLUDED/byte-identical awaiting translation, but all 4 .id.ftl files now EXIST in shared-ui/locales/ — the gap it tracks is closed; the table + "Total gap: 4 bundles" is outdated · verified: scripts/translate-stub.py, verify-bundle-parity.py, lint-i18n.sh all exist; fallback-path rationale remains valid · re-audit when the id bundles are confirmed fully translated or the rows are removed -->

<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 structural finding + 1 stale path base) — tracked gap CONFIRMED CLOSED · Audited on branch 0.0.40. STAMPS MERGED INTO THIS ONE: the 2026-07-22 Hermes-Agent stamp above is retained verbatim; its conclusion is correct and this pass independently confirms it, but it reached that conclusion through a path that no longer exists, which is the detail worth adding. THE STRUCTURAL FINDING: as with `docs/archived/code-quality-2026-07-20.md`, this file carried a top stamp saying "status: STALE" and describing a tracked gap, directly above a footer asserting "status: ACCURATE (0 findings) · … all file references valid". The footer is the machine-read freshness signal, so the file was claiming to be clean while its own evidence said otherwise. Repaired — the false footer is replaced by the single machine-read line. Across all 28 archived `.md` files only these two carried that contradiction, so this is now fully closed rather than merely reduced. · THE GAP IS CLOSED, verified at the current location: all four bundles this file tracks now exist — `gift-cards.id.ftl`, `purchasing.id.ftl`, `stock-counting.id.ftl` and `stock-transfers.id.ftl` — and all six screens the table names (`GiftCardsScreen`, `IssueGiftCardModal`, `PurchaseOrdersScreen`, `SuppliersScreen`, `StockCountsScreen`, `StockTransfersScreen`) are real. Every translator-facing path in this document was repaired from `shared-ui/locales/` to `shared-ui/locales/`, because `shared-ui/locales/` no longer exists as a directory at all; a translator following the old instructions would have been pointed at a missing tree. That is a real repair rather than cosmetic, and it is the one place I departed from leaving an archived document byte-for-byte: this file is an ACTIONABLE work list, not an audit snapshot, so a stale path in it breaks the next person who acts on it. A historical record's paths are evidence; a to-do list's paths are instructions. · What I did NOT do: I did not delete the table or mark the rows struck-through, and I did not rewrite the "Total gap: 4 bundles, ~2 hours" summary. Closing those out is an owner decision about whether the bundles are merely present or fully translated — presence is what I measured, and the file's own acceptance criteria (same key set, placeholders verbatim, no `[i18n]` warnings) are a translation-quality judgement I have no way to make from the tree. The bundle count also grew from the "20 other `.id.ftl` bundles" this file cites to 27 today. · The fallback-path rationale in "Why these are excluded specifically" remains correct as written and is the durable part of the document: shipping a byte-identical `.id.ftl` presents English text under an Indonesian flag, which is worse than the transparent runtime fallback. -->

# i18n followup: 4 untranslated Indonesian bundles

When `feat(i18n): ...` lands, the survey of `shared-ui/locales/*.id.ftl`
turned up **4 byte-identical-to-English** bundles. The user specifically
named `gift-cards.id.ftl` + `purchasing.id.ftl` as excluded; the survey
also caught `stock-counting.id.ftl` + `stock-transfers.id.ftl`. All 4 were
excluded from the commit per the principle "drop byte-identical" — shipping
a stub `.id.ftl` that is byte-identical to its `.ftl` sibling would present
**English text falsely labelled as Indonesian** rather than honestly falling
back. This file tracks the gap so translators + reviewers can prioritize.

## Bundles awaiting translation

| English source           | Indonesian stub (excluded)        | Affected screen(s)                                       | Est. effort |
| ------------------------ | --------------------------------- | -------------------------------------------------------- | ----------- |
| `gift-cards.ftl`         | `gift-cards.id.ftl`               | `GiftCardsScreen`, `IssueGiftCardModal`                  | ~30 min     |
| `purchasing.ftl`         | `purchasing.id.ftl`               | `PurchaseOrdersScreen`, `PurchaseOrderForm`, `SuppliersScreen` | ~45 min |
| `stock-counting.ftl`     | `stock-counting.id.ftl`           | `StockCountsScreen`, `StockCountDetail`, `StockCountHistory`    | ~30 min |
| `stock-transfers.ftl`    | `stock-transfers.id.ftl`          | `StockTransfersScreen`                                  | ~15 min     |

(20 other `.id.ftl` bundles are correctly translated and ship in the
`feat(i18n):` commit.)

## Why these are excluded specifically

The fallback path for `@fluent/react` is: if a key is missing from the
locale bundle (or the bundle file itself is absent), the next-most-relevant
fallback is used (typically the `en` bundle). This is a clean, well-tested
UX. A byte-identical `.id.ftl` loses this — it claims a translation that
doesn't exist, and the user gets English text presented under the
Indonesian flag, which is worse than the fallback happening transparently.

## Acceptance criteria for each translation PR

A translation PR lands once ALL of the following are true:

0. **Scaffolded properly.** Run `python3 scripts/translate-stub.py --bundle=<name> --write`
   to generate scaffolding. The script injects a `# HINT:` comment at the
   top with the per-domain translator guidance, prepends `[TODO]` to every
   value, and verifies the scaffold is NOT byte-identical to the source
   before writing to disk. Required because shipping the byte-identical
   `.id.ftl` would render English content under the Indonesian locale
   tag — worse than the runtime `[i18n]` fallback warning. The scaffold's
   dry-run (`--dry-run`, the default) is the recommended first step so
   the translator can preview what will be written.

1. **Same key set as the `.ftl` sibling.** No missing or extra keys.
   Verified by exit 0 from `scripts/verify-bundle-parity.py --staged-only`.
2. **Variable references preserved verbatim.** `{ $count }`, `{ $name }`,
   `{ $date }` etc. must match the source bundle character-for-character.
   The scaffold script protects these automatically; `scripts/translate-stub.py`
   has its own `validate_scaffold()` pass that catches placeholder drift
   before write.
3. **Multi-line values use the Fluent continuation form correctly.**
   A source value like

   ```
   long-text = {""first line
   second line with { $variable }""}
   ```

   requires leading-space indentation on continuation lines.

4. **No `[i18n]` lint warnings.** `bash scripts/lint-i18n.sh` exits 0
   without print the byte-identical sentinel — that no longer triggers
   because the bytes now differ. Also run `bash scripts/lint-i18n.sh`
   pre-push — it warns (yellow `[i18n]` prefix) if you ship a bundle
   whose bytes still match the English source.

5. **Indonesian-appropriate content.** Formal Indonesian uses Latin
   script; tooling does not require any specific UTF-8 encoding.

When a translation PR lands, update this file (remove the resolved table
row + ticket) and run `git commit --amend` on the feat(i18n) commit, OR
add a followup `fix(i18n): translate <bundle>` commit that closes out
the audit entry.

## Translator pointers

Translation PRs target `shared-ui/locales/<bundle>.id.ftl`. The
acceptance criteria above are the de-facto submission contract; ping
the brand review team in the PR description so they can sign off on
copy-sensitive bundles (especially `gift-cards.id.ftl`).

The recommended workflow:

1. `python3 scripts/translate-stub.py --bundle=<name> --dry-run` to
   preview what the scaffold will look like.
2. `python3 scripts/translate-stub.py --bundle=<name> --write` once the
   preview looks right.
3. Open the resulting `shared-ui/locales/<bundle>.id.ftl` and replace each
   `[TODO]` sentinel with the actual Indonesian translation.
4. Run `python3 scripts/verify-bundle-parity.py --staged-only` and
   `bash scripts/lint-i18n.sh` to confirm gates pass.

If a translator sees `@fluent/react` warnings at runtime after landing,
that's typically the bundle-parity gate rejecting an unmatched key; re-run
`python3 scripts/verify-bundle-parity.py --staged-only` and fix the
reported missing keys before re-merging. Also run `bash scripts/lint-i18n.sh`
pre-push — it warns (yellow `[i18n]` prefix) if you ship a bundle whose
bytes still match the English source.

## Total gap

4 bundles, ~2 hours of translation work to close. None are user-blocking;
the fallback path serves users with `locale="id"` correctly in the
interim.

> last audited 29-09-26 by docs-auditor

