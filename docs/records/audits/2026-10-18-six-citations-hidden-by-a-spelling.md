# Six more citations, hidden by a spelling the last pass skipped — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 185 · status: the cross-file pass from
     round 184 read only 113 of 330 citations; the other 217 hid SIX more drifts, now repaired,
     and the exemption list was itself wrong twice · branch: 0.0.41 · commits: 707a1c468, ef7d83343 -->

<!-- Scope: round 184 shipped a cross-file citation pass. Audit what it did not read. -->

## The blind spot was in my own new checker

Round 184 resolved citations by PATH only, so a bare-filename citation — the common prose form
"renders unconditionally (CartPanel.tsx:898)" — never resolved and was silently skipped among
the 217. Measured: **121 distinct bare basenames, 203 tokens** the pass had been walking past.

Adding a repo-wide basename index (test files excluded, so a comment citing a test by name is
not graded) exposed **six more drifted citations**, and one of them was the *same* `CartPanel`
target round 183 and 184 had each already fixed once:

| citing | cited | what it read | correct anchor |
|---|---|---|---|
| `tableLabel.ts:16` | `CartPanel.tsx:648` | blank | `:761` — `Table ${bareTableNumber(...)}` |
| `tableLabel.ts:15` | `sales.ftl:40` | blank | `:45` — the key it names |
| `useBackupStatus.ts:128` | `FastPINOverlay.tsx:334` | `}` | `:335` — the l10n re-render note |

Each repair was verified by reading the target, not by trusting the offset: `:761` holds
`Table ${bareTableNumber(tableNumber!)}`, `sales.ftl:45` holds `payment-table-number = Table { $number }`,
and `FastPINOverlay:335` is the comment naming the infinite re-render loop.

## My exemption list was wrong twice, and both times the checker told me

Widening coverage is only safe if the exemptions are principled, and mine were not:

1. **`AS OF <sha>^` was missing.** The eight KDS extractee headers read *"Extracted verbatim
   from KdsScreen.tsx:718-855 AS OF 7d0dc4d60^"* — a range pinned to a commit that is
   counterfactual by construction, so it is **supposed** to fail to resolve. My word list
   caught some by accident; three contained none of its words, so the exemption rested on luck.
2. **Past-tense prose about removed code was missing**, and this one is the interesting class. The
   two `tableLabel.ts` comments are the natural experiment:

   ```
   :12  Both places that render it ALSO add the word:     <- PRESENT tense
   :45  Two sites BUILT this string by hand, identically:  <- PAST tense
   ```

   The present-tense one was genuinely stale (`:648` was blank) and I repaired it. The
   past-tense one is correct **precisely because it does not resolve** — those two sites no longer
   build it, which is why the helper exists. Tense is the discriminator, and it is the only thing
   separating a stale pointer from a note about history.

Both exemptions are now explicit in the checker with the measurement behind them, rather than
resting on a word list that happened to be adequate.

## Kill-tested, and the self-test again earned its place

Reintroducing the repaired drift (`tableLabel.ts:16` back to `CartPanel.tsx:648`) turns the new
bare-filename arm red **naming that line and that target**, and the restore is byte-identical by
sha256 (`c41fb67bedc88da2`). The round-184 self-test also kept working: it is what would catch
this pass silently resolving nothing.

## The pattern worth naming

Three consecutive rounds have now fixed the SAME citation (`CartPanel` table field): round 183 found
one instance, round 184 found two more, round 185 found a third — each round by widening the
search rather than by looking harder. A drifted citation is never one instance; it is a
**target** that everything then starts pointing at wrongly, and the fix is to grep the target,
not to re-read the file you were already in. That is the lesson round 183 recorded and round 184
and 185 each had to re-learn at a wider radius.

## Evidence

- 121 distinct bare basenames; 203 bare tokens, of which 111 single-match citations are now
  graded, 14 ambiguous and 2 unknown are skipped (never guessed).
- Six offenders, every repair verified against the target line.
- All three owned passes green after the change; kill-test red-then-restored byte-identical.
- `npm run lint` 0 errors (116 pre-existing warnings), `npm run typecheck` clean, bundle parity
  0 missing on both commits.
- Committed as `707a1c468` (3 repairs across 2 files) and `ef7d83343` (the checker, 81 insertions).

## Carried forward

1. The ambiguous 14 basenames are skipped rather than guessed — correct, and now stated so a
   future pass does not "fix" them into a wrong resolution.
2. Round-177 Escape defect remains the top open item: `PosScreen.tsx` still dirty at
   `ff144486f`, re-verified this round.
3. No Android device attached; the tablet lane stays blocked on hardware.

> last audited 18-10-26 by docs-auditor
