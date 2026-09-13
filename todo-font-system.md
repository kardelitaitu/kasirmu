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

- [ ] **Add to the existing ui/src/__tests__/themeTokenCompliance.test.ts, do NOT create a new file** — on review, a new fontTokenCompliance.test.ts would duplicate a live gate, :313 already fails any font-family lacking var(--font- with KNOWN_VIOLATIONS_BASELINE = 0 at :35, inside dev-ci.yml#ui-test. A second compliance test in a second file is the mirror-churn mistake of the cancelled gate, at smaller scale
- [ ] Rule 1, no http:// or https:// font reference in ui/index.html
- [ ] Rule 2, both --font-* tokens end in a generic keyword — **already true, verified**, this is regression cover only. Not the same check as the existing one, themeTokenCompliance.test.ts:313 asserts a declaration must use a var(--font-*) token, not that the token value ends generic, and its list at :101-103 holds sans-serif, monospace and ui-monospace for a different validation
- [ ] Rule 3, every @font-face url() is **relative** — **downgraded on review, this is near-vacuous today**, 0 @font-face and 0 remote url() exist, so it is cheap future insurance and must not be sold as the finding
- [ ] It **fails today**, naming ui/index.html:99

**Confirmation** — cd ui && npx vitest run src/__tests__/fontTokenCompliance.test.ts -> **exit 1** on todays tree, then **exit 0** after Phase 2. It runs inside the existing dev-ci.yml#ui-test job, so **no new CI step, no gates.json record, no check.sh edit, no mirror churn.** Precedent is established, not invented, themeTokenCompliance.test.ts already parses all CSS via readFileSync with drift baselines, and autofillCompliance.test.ts **already parses ui/index.html** (3 refs).

---

## Phase 2 — the zero-byte fix (correctness only, changes nothing a customer sees)

- [ ] Delete the dead CDN link and its two preconnect hints from ui/index.html
- [ ] Re-read the splash/loading fallback in ui/index.html (around :88, offset **unverified**, I hit a truncated print there and will not cite a line I could not read) and remove Inter from any first position production cannot satisfy
- [ ] One pathspec commit, chore(ui)

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

Untracked. To version it, the sanctioned AGENTS.md section 3 new-file chain, ONE line, git add -- todo-font-system.md && git commit -m docs(agents): add cross-os font portability plan -- todo-font-system.md, then git show --stat to prove the create mode entries are exactly this file. Never git add as a separate step, never -a / amend / stash / reset / push. **Never git clean -xdf** — this checkout holds uncommitted work that cannot be reproduced.