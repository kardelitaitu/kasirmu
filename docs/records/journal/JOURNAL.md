
<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, and at 13,271 lines it is THE LARGEST DOCUMENT IN THE REPOSITORY — roughly three times the largest backlog, and larger than every other file audited in this campaign combined. That fact alone makes it worth a careful stamp, because a file this size in a documentation tree is not a document so much as a sediment record, and the question worth asking is whether it still functions as one. · THE STRUCTURE ANSWERS THAT IN ITS FAVOUR, and the structure is the finding. It is a reverse-chronological log of dated entries, each headed by a claim and then the evidence for or against it — the opening entry, for instance, records what a coverage gate reported, notes that the manifest's own recorded figure disagreed with it, and then explains that the floor had been calibrated against a shape the code no longer had. That entry does not say the gate was wrong; it says the gate was measuring a surface that had moved underneath a threshold calibrated for a different one. · AND IT PREFERS DELETING DEAD CODE TO WRITING TESTS FOR IT, which is the most interesting thing in it. The entries name specific methods with no caller, and cite the repository's own test files saying the columns they used did not exist in the current schema — then conclude the methods should go rather than be covered. A coverage floor pushing an author toward writing tests for functions that cannot work is a gate producing the wrong incentive, and a journal that records the incentive problem is more useful than one that records only the number. · THE HONESTY IS SYSTEMATIC ACROSS ENTRIES, and it is the same discipline this campaign has been enforcing on audit stamps for fifty rounds: each entry distinguishes what a tool SAID from what was actually TRUE, and the usual finding is that the tool was right about the number and wrong about the cause. That is the same pattern as the settings-ingest census, the rate-limit collapse, and the tablet-driving method record — all of which this campaign audited and found to hold up. A repository that logs its own misdiagnoses in this way can be audited at all. · WHY IT IS IN THE RECORDS DIRECTORY RATHER THAN ARCHIVED, and the answer is the same one this campaign gave for the very large backlog: a journal that is still receiving entries is live, and it is receiving them — the newest entry is dated on the day of this audit. A reader who wants the project's reasoning over time starts here; a reader who wants a decision starts in the decision directory. · WHAT WAS NOT DONE, stated plainly because at this size the omission is large: the individual entries were not re-derived. Thirteen thousand lines of dated engineering reasoning is the original work, and a documentation audit can establish only what this stamp records — that the file is structured as a dated evidence-bearing log, that it is actively maintained, and that the reasoning pattern in its entries is the one this campaign has independently found reliable elsewhere. · No stamp existed; this is the first. -->

# Engineering Journal - index

This file was a single 13,433-line, 1,338 KB append-only engineering journal. It was split on 2026-10-02 into the parts listed below, because AGENTS.md E4 requires reading a whole file in one call and the 2,000-line cap made that impossible. **Content is unchanged and in original order**; the only edit is one heading promoted from ### to ## where a cut landed mid-section (part 3, old line 5093).

## Why it was split

E4: *read whole files, one call, up to 2,000 lines*. At 13,433 lines the journal could not be read whole, so every agent either broke the rule or spent its entire context on a file it needed one paragraph from. That is a running cost on every task, not a one-off.

## The parts

| Part | Pre-split lines | Lines | Size |
|---|---|---:|---:|
| [part 1](JOURNAL-part-1.md) | 4-1983 | 1980 | 188 KB |
| [part 2](JOURNAL-part-2.md) | 1984-3088 | 1105 | 177 KB |
| [part 3](JOURNAL-part-3.md) | 3089-5076 | 1988 | 291 KB |
| [part 4](JOURNAL-part-4.md) | 5077-6265 | 1189 | 157 KB |
| [part 5](JOURNAL-part-5.md) | 6266-8222 | 1957 | 146 KB |
| [part 6](JOURNAL-part-6.md) | 8223-10168 | 1946 | 112 KB |
| [part 7](JOURNAL-part-7.md) | 10169-12153 | 1985 | 177 KB |
| [part 8](JOURNAL-part-8.md) | 12154-13432 | 1341 | 105 KB |

## Reading a legacy JOURNAL.md:<line> citation

Citations of the form `JOURNAL.md:<line>` exist in other documents, most of them in other agents' journals under `.agents/planning/` and `.agents/reviews/`. They were deliberately **not** repointed: this is a shared checkout and those are other sessions' records. They still resolve, by lookup — find the row above whose pre-split range contains the cited line, then read that line offset **within the part**.

Worked example: `JOURNAL.md:11057` falls in part 7 (10169-12153), so it is **part 7 line 897**.

The offset is **not** `cited - first`: each part carries an 8-line header, so it is
`cited - first + 9`. (This example originally said **889** — exactly the header length short,
because the offset forgot to add it. Found by measuring the real header on 2026-10-02 rather than
trusting the arithmetic I had written.)

Do not quote a citation count here either; re-derive it:

```bash
git grep -ohE 'JOURNAL\.md:[0-9]+' -- '*.md' | wc -l
```

That currently reports **14**. `-o` is defensive rather than currently load-bearing: no line in the
repo cites this form twice, so `git grep -n` happens to give the same answer. It is kept because
`-o` is what makes the count *mean* occurrences, and the sibling command in `docs/specs/README.md`
**does** need it — there, `-c` reports 18 where the true count is 23.

(An earlier version of this note claimed `-o` was required here and quoted 13 against 21. Both
numbers were wrong — they came from comparing a `git grep` line count against a Python regex that
also matched colon-less forms like `journal.md 2026`. Corrected 2026-10-02 by measuring.)

## Ordering caveat

The original file was not chronologically ordered. It descends 2026-10-02 to 2026-07-02 by old line 2389, then jumps back to 2026-08-07 and climbs to 2026-10-06. It is a merge of several source journals. **A by-month split was therefore rejected** - it would have required reordering, which risks invalidating the file:line citations the entries themselves make. The split above is contiguous and order-preserving for exactly that reason.

> last audited 29-09-26 by docs-auditor
