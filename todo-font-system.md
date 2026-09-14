# todo-font-system.md — cross-OS typography

**REVISION 3, 04:47. Two independent reviews, then my own re-measurement of both.** Revision 2 was written on a claim set that a fact-checker widened and partly corrected again; five counts drifted and two claims of mine were still false. **Owner: the D2 re-ruling request in Phase 3 still stands, and it is now better informed.**

Goal: state honestly what is broken, fix the part that is a real defect at **zero bytes**, and separate that from the part that is a **visual change** needing design sign-off.

---

## What is actually true (each re-measured)

- **Correction to the above, from review.** Revision 2 said **0 font files**, and that is true only of *tracked* files, which the line did not say. On disk there are **12 woff/woff2 files in `website/dist/_astro/`** (gitignored build output, `.gitignore:17`) and **~129 in `node_modules`**. Both faces are therefore already vendored, built and shipped **for the website**. That strengthens the plan, the mechanism is proven in-house, and it weakens my phrasing.
- **Correction, second one.** Revision 2 said one stylesheet, **no second family**. Wrong at repo scope — **JetBrains Mono is CDN-hotlinked in 4 HTML files**: `dev/design-language.html:9`, `dev/kds-prototype.html:11`, `website/public/admin/login.html:10`, `website/public/admin/index.html:10`. True within `ui/`, false in the repo. My grep was scoped to one directory and reported as if it were global.
- **The pre-existing gate nobody counted.** `ui/src/__tests__/themeTokenCompliance.test.ts` asserts font-family values already, baseline 0, blocking, in `dev-ci.yml#ui-test`. So **CI steps mentioning `font` = 0 is literally true and materially misleading**, the check exists, it is just a test rather than a step. Both critics and I said tonight proved nothing watches fonts. **Something does.** My claim is retired.
- **Count drift between my two measurements, same hour:** bare `var(--font-mono)` **120 to 117** (total 129, not 132) · HAL receipt files **29 to 31** · `.id.ftl` **26 to 27** (54 `.ftl` total, README's 52 stale too) · CSS files mentioning `font-family` **84 to 86** · kiosk is **1** `.ftl` pair, not 6 · the CDN `link` **element** opens at `index.html:98`, `:99` is its `href` · `oz-pos.desktop` is at `packaging/linux/`, not under `deb/` · hardcoded `C:` in `.rs` is **3 lines in 3 files, all tests**, plus 17 with forward-slash form, so "1, in a test" understates it

- **CSP already kills every remote face in the shipped app.** Both apps/desktop-client/tauri.conf.json and apps/tablet-client/tauri.conf.json set font-src to self plus data:, and fonts.googleapis.com / fonts.gstatic.com appear in **neither**. In every packaged artifact on all three targets, **Inter has never loaded and the app has never touched the network for fonts**.
- **So the offline-first promise is NOT broken in shipped builds.** It is broken in **dev/prod fidelity** — bare-browser vite dev has no such CSP, so designers and E2E see **Inter** while customers have only ever seen **system-ui**. Smaller and different defect.
- **ui/index.html:99 is dead code in production and live code in development** — the most misleading shape an asset reference can take. The link plus its two preconnect hints have never done anything in what we ship.
- **The repo already solves this, in the other app.** website/src/styles/global.css carries @import of @fontsource-variable/inter and @fontsource-variable/jetbrains-mono under the comment Self-hosted variable fonts (fontsource). **ui/package.json has 0 fontsource deps.** Both faces, already vendored, already used, and the precedent is merged.
- **0 font files are tracked in git** (git ls-files *.woff2 *.woff *.ttf -> 0). The fontsource files live in node_modules and are pulled at build, so licensing is **not** an open question, the npm packages carry their own licences.
- Fleet scale for context: **23** tracked scripts/verify-*.py gates. A new one is **#24**, not a rounding error.

---

## Claims retired — mine, three of them, all falsified by measurement

- **D5, URGENT as an offline-first violation.** False as stated. Nothing remote loads in production. The urgency came from believing a link tag was an actual fetch, and I ran no CSP check before writing the verdict.
- **mono lands on Courier New.** Overstated to the point of wrong. tokens.css:148 orders ui-monospace **before** monospace (verified, the literal string ui-monospace, monospace is present), so the generic keyword is not first in line. *What ui-monospace resolves to inside WebView2 / WKWebView / WebKitGTK is an external fact I cannot measure from this repo* — the critic asserts Consolas/Cascadia and DejaVu Sans Mono, plausibly, unverified here.
- **the mono face must carry Rp (U+20A5).** Invented from a wrong codepoint. U+20A5 occurrences in ui/src -> **0**. U+20B9 -> **0**. **IDR renders as the ASCII bigram Rp, 27 occurrences.** I conflated a two-letter string with a currency glyph, then built a Phase 0 step and a Phase 2 selection constraint on it. For the record, U+20A5 is KIP SIGN and RUPEE SIGN is U+20B9. I had both wrong.
- **Also still standing from revision 1:** the original claim Inter is missing from the repo was *closer* to the shipped truth than my correction away from it. And revision 1 prose cites styles/tokens.css; the real path is ui/src/frontend/themes/tokens.css.

**The lesson, which is why revision 1 was confident: the check that inverts the answer is the one you did not think to run.** I verified the link existed. I never verified it could fire.

---

## Phase 1 — the red test (real defect, ~60 lines, existing idiomatic mechanism)

- [x] **Add to the existing ui/src/__tests__/themeTokenCompliance.test.ts, do NOT create a new file** — on review, a new fontTokenCompliance.test.ts would duplicate a live gate, :313 already fails any font-family lacking var(--font- with KNOWN_VIOLATIONS_BASELINE = 0 at :35, inside dev-ci.yml#ui-test. A second compliance test in a second file is the mirror-churn mistake of the cancelled gate, at smaller scale — **(verified 2026-09-14: 93c367ba7 --stat -> exactly two files, ui/index.html 13 lines + themeTokenCompliance.test.ts +297; find ui/src -iname '*font*' -> 0, so no second file exists; npx vitest run themeTokenCompliance -> 9 passed).** **The three pointers in this box have drifted by +5** and were correct when written: re-measured against 93c367ba7^, KNOWN_VIOLATIONS_BASELINE :35 -> **:40**, the font-family assertion :313 -> **:318**, the generic list :101-103 -> **:106-107**. The commit appended below :486 and its own comment says "Nothing above was changed" — true of the code, false of the numbering, because the header comment it added is five lines long.
- [x] Rule 1, no http:// or https:// font reference in ui/index.html — **(verified 2026-09-14: grep -c 'fonts.googleapis\|fonts.gstatic\|preconnect' ui/index.html -> 0; grep -n http ui/index.html -> no matches at all; rule 1 + rule 1 probe green in the 9 passed)**
- [x] Rule 2, both --font-* tokens end in a generic keyword — **already true, verified**, this is regression cover only. Not the same check as the existing one, themeTokenCompliance.test.ts:313 asserts a declaration must use a var(--font-*) token, not that the token value ends generic, and its list at :101-103 holds sans-serif, monospace and ui-monospace for a different validation — **(verified 2026-09-14: tokens.css:147 ends 'system-ui, sans-serif' and :149 ends 'ui-monospace, monospace'; the shipped detectors run verbatim over that file -> stacks without a generic tail = 0; rule 2 + rule 2 probe green in the 9 passed)**
- [x] Rule 3, every @font-face url() is **relative** — **downgraded on review, this is near-vacuous today**, 0 @font-face and 0 remote url() exist, so it is cheap future insurance and must not be sold as the finding — **(verified 2026-09-14: grep -rn '@font-face' ui/src --include='*.css' -> 0 and remote url() -> 0, exactly as downgraded; the coverage is the probe, which names hits [5, 7] for a remote and a protocol-relative src, green in the 9 passed)**
- [x] It **fails today**, naming ui/index.html:99 — **(verified 2026-09-14 against history, since Phase 2 deleted the input: the shipped detector, helpers taken verbatim from :514-685 with no re-implementation, run over git show 93c367ba7^:ui/index.html -> 3 hits at :96, :97 and :99 — :99 is the link's href, matching the "element opens at :98" note above; over the current ui/index.html -> 0 hits. Read this box as "the rule was red before Phase 2", which it demonstrably was; on today's tree it cannot be re-observed red)**

**Confirmation** — cd ui && npx vitest run src/__tests__/fontTokenCompliance.test.ts -> **exit 1** on todays tree, then **exit 0** after Phase 2. It runs inside the existing dev-ci.yml#ui-test job, so **no new CI step, no gates.json record, no check.sh edit, no mirror churn.** Precedent is established, not invented, themeTokenCompliance.test.ts already parses all CSS via readFileSync with drift baselines, and autofillCompliance.test.ts **already parses ui/index.html** (3 refs).

---

## Phase 2 — the zero-byte fix (correctness only, changes nothing a customer sees)

- [x] Delete the dead CDN link and its two preconnect hints from ui/index.html — **(verified 2026-09-14: the 93c367ba7 diff removes exactly those three elements, formerly :96, :97, :99, and leaves a comment naming the CSP reason; grep -c 'fonts.googleapis\|preconnect' ui/index.html -> 0)**
- [x] Re-read the splash/loading fallback in ui/index.html (around :88, offset **since measured**, I hit a truncated print there and will not cite a line I could not read) and remove Inter from any first position production cannot satisfy — **(verified 2026-09-14: that splash font-family line sits at **:88** in 93c367ba7^ and still at **:88** now, so the guess was right; its fallback now opens -apple-system and grep -c Inter ui/index.html -> 0, in either position)**
- [x] One pathspec commit, chore(ui) — **(verified 2026-09-14: ONE commit, 93c367ba7, --name-only -> ui/index.html + ui/src/__tests__/themeTokenCompliance.test.ts, i.e. nothing outside this plan rode along; **the subject is fix(ui), not chore(ui)**, which is a permitted type and arguably the truer one. The pathspec form itself is not recoverable from git history — only the file list is, and the file list is exactly this plan's two files)**

**Confirmation** — Phase 1 test (now an added case in the existing file) **exit 0** · grep -c googleapis ui/index.html -> **0** · **zero pixels change in the packaged app**, which is the point, this deletes code that never executed · ui/dist builds clean.

---

## Phase 3 — the visual change (owner re-ruling required; NOT a bug fix)

**Nobody has ever seen this app in Inter on a POS terminal.** Bundling it is a **design change** that shifts line metrics across **84 CSS files** under ui/src that mention font-family (measured, the critic said 61). Buttons, columns and dense tables reflow. That is the only real regression surface in this plan and it deserves screenshots and sign-off, not a fix message.

- [ ] **Owner, re-rule:** do we want the app to *look like* the design token claims, or to *be* honest that it renders in system-ui? Both are defensible. Revision 1 assumed the first because I mis-measured the second.
- [ ] If bundling, follow the **website precedent**, @fontsource-variable/inter and @fontsource-variable/jetbrains-mono into ui/package.json (no postinstall script, so no install-approval hurdle), a new ui/src/frontend/themes/fonts.css with the @font-face rules, imported beside tokens.css
- [ ] tokens.css:146 and :148 fallback tails stay **byte-identical** — they are correct and they are the safety net
- [ ] No CSP change needed, bundled assets are same-origin self. **Verify the face actually renders after bundling** — that verification is the exact link I skipped tonight
- [ ] Separate commit, feat(ui), with before and after screenshots, and the bundle-budget check

**Confirmation** — a real visual review, not a green exit code. If Phase 3 is declined, Phase 1 + 2 still stand on their own and this file becomes dev/prod fidelity fixed.

**What these five boxes are waiting on, in this file's own words:** the owner's re-ruling — "do we want the app to *look like* the design token claims, or to *be* honest that it renders in system-ui?" Nothing in Phase 3 is runnable: its confirmation is "a real visual review, not a green exit code", i.e. before/after screenshots and sign-off across the 84 CSS files under ui/src that mention font-family (verified 2026-09-14: `grep -rl font-family ui/src --include='*.css' | wc -l` -> 84, which agrees with the Phase 3 prose and not with the 86 in the drift list above). Phase 1 + Phase 2 have now landed on their own, so the ruling is the only thing still open here.

---

## Cancelled from revision 1, with the reason, so nobody resurrects it

- **scripts/verify-font-ports.py (gate #24) plus font-system.expect.json contract plus per-stack adapters.** Cancelled. It builds a Python parser and an abstraction with one implementer to prove a production defect that **does not exist**, at 500 to 900 LOC across a new gate, its gates.json record, a dev-ci step, a check.sh step and doc mirrors policed by a blocking drift gate. **The same proof lives in ~60 lines of an established test shape.** Keep the design law below as a sentence, not as code.
- **mono face must carry Rp plus box-drawing.** Cancelled, wrong codepoint, see retired claims.
- **120 bare var(--font-mono) sites need a fallback.** Deferred, not urgent, the tokens are defined on :root and never redefined in any data-theme block, so those sites resolve today.
- **Not cancelled, still genuinely open:** is kiosk size and weight a design question. That is a designers answer, not a measurement.

---

## Notes

**Review accounting, mine too.** The design critic asserted 12 woff2 subsets measured in-tree and 0 font files, both true of git, neither true of disk, its own figure came from node_modules. Its 61 CSS files measured **86**. Its 44 tabular-nums sites measured **42**. Its 70 gates.json records I could not reproduce, my python attempt died on shell quoting, and **a broken pipeline is not a zero**. Its 23 verify-py gates reproduced exactly. **Every one of my five reviewers corrected at least one of my numbers and every one of them was itself corrected on at least one.**

> **The rule this file is written under:** a value received is not a value verified, in **either direction**. The unit of a number is the set it counts, and the set must be named every time.

**Design law, kept as prose, deliberately not as code.** The *rule* is stack-neutral, ideal face first, generic keyword last, every named face resolves **through every layer between declaration and pixels**. The *parse* is per stack. Today there is **one** UI implementation and two shells, so the smallest stack-neutral thing that permits a future stack is this sentence, not a css_adapter. Corollary for the 23 existing gates, **the rules worth keeping are the ones statable without naming a file format.**

**The layering lesson, which generalises past fonts.** Asset resolution is a chain, named in a token, declared as @font-face or a bundled file, served on a protocol the webview allows, **permitted by CSP**, rendered. Revision 1 checked links 1, 2 and 5 and skipped 3 and 4. A link tag in HTML is not evidence of a fetch, **the CSP is the authority, and it sat in a config file I had already opened once for targets all.** I read that file for one key and reported it as a font fact.

- receipts printing goes through an ESC/POS driver we own (crates/oz-hal/src/drivers/escpos.rs exists, 1 tracked) and 31 hal files mention receipts. I asserted **no webfont can affect printed output** and that claim is **inference, not measurement**: the function I cited, default_print_raw_handles_utf8_lossy, is **a test**, not production (traits/printer_tests.rs), and grep for codepage, cp437 or iconv in crates/oz-hal returns **0**, so how the printer resolves glyphs is unknown to me. The conclusion is probably right, ESC/POS text commands do not carry a webfont, but it is now labelled a hypothesis rather than a fact, and the out-of-scope call belongs to whoever owns oz-hal.

**A finding outside this plan fence, for whoever owns the updater.** The same CSP sets connect-src to self plus https://github.com plus https://license.ozpos.my.id, and objects.githubusercontent.com appears **nowhere** in it, while the updater endpoint is https://github.com/kardelitaitu/oz-pos/releases. GitHub release downloads **302 to objects.githubusercontent.com**, and a browser evaluates the **final** URL of a redirect against connect-src. **IF** the Tauri updater downloads through a webview fetch, auto-update fails in the packaged app, the same rhyme as the font case, a shipped feature whose network path the CSP does not permit. **I have NOT verified webview vs reqwest, if it is Rust this evaporates.** Unpin that before acting.

**Numbers I could not verify and therefore do not assert:** the critics 70 gates.json records, my python3 -c attempt died on a shell-quoting NameError and a broken pipeline is not a zero · the exact resolved face of ui-monospace per engine · whether the splash really names Inter at :88.

---

## Housekeeping

TRACKED — added by cc1dbfd45, updated by 9775b8b0f. The sentence that used to sit here ("Untracked. To version it, run the §3 new-file chain: git add -- todo-font-system.md && ...") was a TRAP: git add on a TRACKED file with pending edits is exactly what AGENTS.md §3 forbids in a shared checkout, and an agent obeying it would have left this file staged for whoever committed next. Correct form here is a one-line pathspec commit with NO add step: git commit -m "docs(agents): ..." -- todo-font-system.md, then git show --name-status to prove the file list is yours. (corrected 2026-09-14; re-derive with git ls-files --error-unmatch todo-font-system.md, which resolves) Never git add as a separate step, never -a / amend / stash / reset / push. **Never git clean -xdf** — this checkout holds uncommitted work that cannot be reproduced.

---

## Correction (2026-09-14) - measured against HEAD 828247454

Nothing above is rewritten; the originals stand as dated records. Two measurements a coder needs before touching this plan, both re-taken with read/grep against the working tree (they also hold at `bb484066b` — the two commits after `828247454` touched `AppShell.tsx`, `WorkspaceContext.tsx` and two test files, none of them measured here).

- **(a) NOTHING IN THIS PLAN IS IMPLEMENTABLE BEFORE THE RULING AT `:62`.** All five open boxes (`:62`-`:66`) are conditional on the owner's re-ruling — "do we want the app to *look like* the design token claims, or to *be* honest that it renders in system-ui?" — and the four boxes after it are downstream "if bundling" work, so none of the five can be started, ticked, or committed today. Measured, not inferred:
  - `grep -c fontsource ui/package.json` -> **0**: neither `@fontsource-variable/inter` nor `@fontsource-variable/jetbrains-mono` is a dependency.
  - `ls ui/src/frontend/themes/` -> **components.css · reset.css · responsive.css · tokens.css**. The `fonts.css` that `:63` wants to create does not exist.
  - `:64`'s "byte-identical safety net" is already byte-identical: `sed -n '146,149p' ui/src/frontend/themes/tokens.css` returns the two `--font-*` declarations (opening at `:146` and `:148`) exactly as this file quotes them. There is nothing to preserve by editing, and editing that range is the one thing `:64` forbids.

- **(b) THIS PLAN'S ACCEPTANCE COMMAND IS FALSE AS WRITTEN, AND THAT ALONE DISQUALIFIES A RENAME.** `:44` states the confirmation as `cd ui && npx vitest run src/__tests__/fontTokenCompliance.test.ts`. **That file does not exist anywhere and never did:** `find ui/src -iname '*font*'` -> **0 hits**; `git grep -n fontTokenCompliance -- ui` -> 0. It is not merely missing — `:38`, this plan's own Phase 1 box, **forbids creating it** ("Add to the existing `ui/src/__tests__/themeTokenCompliance.test.ts`, do NOT create a new file ... a new fontTokenCompliance.test.ts would duplicate a live gate"). So the written acceptance names a file the plan rules out, and running it proves nothing: vitest matches zero test files. **The command that actually runs is:**

  ```bash
  cd ui && npx vitest run src/__tests__/themeTokenCompliance.test.ts
  ```

  **A plan whose acceptance cannot execute is not renameable** — per AGENTS.md §4, `done-todo-*` is earned only when *that file's own* acceptance command was RUN and PASSED, and an unrunnable command can never pass. Whatever of Phase 1 + 2 landed, this file stays `todo-`; the reason belongs in a dated line like this one, never in the filename.

- **THE RULING IS PARKED ON THIS FILE: `todo-font-system.md`.** The `:62` decision has no other home to be answered in — no ADR, no `docs/decisions/` row, no sibling plan. Whoever owns the design tokens rules here; until then Phase 3 is not blocked on code, it is blocked on a ruling, and the acceptance above stays unexecutable either way.
---

## Acceptance runs (2026-09-14, HEAD 6a32cc9dd)

Nothing above is rewritten; the originals stand as dated records. The **corrected** acceptance named by the correction at `:116`-`:120` was RUN at `6a32cc9dd` and it PASSED. **No box was flipped by this run — reason in (b) — and no rename follows — reason in (e).**

- **(a) THE CORRECTED ACCEPTANCE RAN AND PASSED.** `cd ui && npx vitest run src/__tests__/themeTokenCompliance.test.ts` -> **exit 0, 11 tests** at `6a32cc9dd`. The file exists at that revision (`git ls-tree -r --name-only 6a32cc9dd -- ui/src/__tests__ | grep -c themeTokenCompliance` -> 1), so the command printed at `:119` is executable as written, and its result is green. This is the run the correction at `:116` said "the command that actually runs is:" — it now has an answer.
- **(b) `:119` IS NOT A CHECKBOX, SO THERE WAS NOTHING TO TICK — and this file's open count did not move.** `:119` is the command line **inside** the fenced `bash` block at `:118`-`:120`; it carries no `- [ ]` token. The only open boxes in this file are `:62`, `:63`, `:64`, `:65`, `:66` — `grep -cE '^[[:space:]]*- \[ \]' todo-font-system.md` = **5 before, 5 after**, ticked **8 before, 8 after** — and all five are Phase 3 items conditional on the owner ruling at `:62`, i.e. design work, not verification boxes a test run can answer. So the green is recorded in this dated line instead of as a tick; the tick this brief named does not exist, and inventing one elsewhere would have been the false claim.
- **(c) THE ORIGINAL WRITTEN ACCEPTANCE AT `:44` IS STILL UNRUNNABLE AS WRITTEN.** It names `cd ui && npx vitest run src/__tests__/fontTokenCompliance.test.ts`. That file **does not exist** at `6a32cc9dd` — `git ls-tree -r --name-only 6a32cc9dd -- ui/src | grep -i fonttoken` -> **0 hits**, exit 1 — and `:38` **forbids creating it** ("Add to the existing `ui/src/__tests__/themeTokenCompliance.test.ts`, do NOT create a new file … a new fontTokenCompliance.test.ts would duplicate a live gate"). Vitest matches zero test files, so `:44` can never pass and never has. The run in (a) does not repair it: it ran a **different file's** name. `:116`'s finding and `:122`'s conclusion — an unrunnable acceptance disqualifies a rename — stand untouched by this block.
- **(d) THE RUN EXPOSED NEW STALENESS: TWO VERIFICATION LINES ARE 2 CASES BEHIND.** The command reports **11 tests**. `:38` records "npx vitest run themeTokenCompliance -> **9 passed**" and `:40` records its rule-2 coverage as "green in the **9 passed**"; both are now **2 cases stale** (the extra two are additions to the same suite, not a disproof of anything asserted there — the checks those boxes describe still ran, they just ran inside a suite that has since grown). For completeness, `:39` and `:41` carry the same "9 passed" wording and are stale in the same way. None of the four is edited in place: they are dated verification records and `:109` keeps them verbatim. A reader re-checking Phase 1 against the reporter should expect **11**, not 9.
- **(e) NO RENAME, AND NOTHING HERE SETTLES `:62`.** This file stays `todo-font-system.md` on two independent grounds, both already in it: the owner ruling at `:62` is outstanding and `:124` parks it **in this file** ("Whoever owns the design tokens rules here"), so Phase 3's five boxes stay open; and `:44`'s acceptance — the plan's OWN written command — remains unexecutable per (c). Per root `AGENTS.md` §4 a `done-` prefix is earned by that plan's own acceptance running **and** passing. A green run of the corrected command is a fact about a test file, not a ruling about a design, and a filename is a claim about the whole plan.
