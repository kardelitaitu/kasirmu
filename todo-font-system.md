# todo-font-system.md — cross-OS typography

Goal: every named font face resolves **on a counter terminal with no egress**, on all three shipped OS targets, and a gate proves it. Nothing here is pushed. Measured 03:53, corrected 04:25, reformatted 04:30. Re-derive any number before acting, this tree drifts by the minute.

Owner rulings: **URGENT** not cosmetic (03:50) · approach **D2, recommendation (c)** — bundle both faces, keep the fallback tails, remove the network dependency, and a gate that proves no face needs the network.

---

## Phase 0 — close the last unknowns (read-only, no code)

- [ ] Does any chosen mono face carry **Rp (U+20A5 RUPEE SIGN)** on screen — inspect the candidate faces, not the docs
- [ ] Does the **kiosk** surface need a different size or weight from the counter UI — a designer decides, a measurement cannot
- [ ] Is an **OFL notice file** acceptable to add to a proprietary deb — one file, normally a formality, owner sign-off
- [ ] Confirm `--font-sans`/`--font-mono` are defined on `:root` and never redefined in a `[data-theme]` block — the first two looked true, re-run it, the last check of this plan nearly shipped a false negative

**Confirmation** — four one-line answers, each citing a file and a line, and a written call on whether Phase 2 is urgent or cosmetic for the *on-screen* surfaces. **No file edited in this phase.**

---

## Phase 1 — the gate. Ships **before** the fix, always

- [ ] `scripts/font-system.expect.json` — stack-neutral contract: ideal faces, required generic tails, system-face allowlist, no-network rule, `required_scripts`
- [ ] `scripts/verify-font-ports.py` — the gate, with a per-stack adapter, `css_adapter` being the only file that knows what CSS looks like
- [ ] It **FAILS on today’s tree**, naming `tokens.css:148` and `index.html:99` — a fix landing first leaves no proof the check can fail
- [ ] `--self-test` **blocking**, `--census` **informational** in CI (the `verify-ftl-orphans` shape)
- [ ] Wire into `dev-ci.yml#static-gates` and `scripts/check.sh` — census step only
- [ ] Owner adds the `scripts/gates.json` record — `verify-ci-docs-drift` is **blocking**, so a step without a record looks unenforced

**Confirmation** — `--self-test` exit **0** and PASS; the gate exit **1** on today’s tree with a count **and its unit**; refusal cases exit **2**, `error:` on stderr, **0 bytes stdout, no count printed**; five forced mutations each redden it — print deleted · tail removed · a new bare family added · a network-only face · **an empty `adapters` section in the contract**; healthy path byte-identical to a baseline placed inside `scripts/`; **0 findings** on a synthetic tree where every face is bundled.

---

## Phase 2 — bundle the faces (blocked on the Phase 0 notice answer)

- [ ] Inter woff2 subset to `latin` + `latin-ext` under `ui/src/assets/fonts/`
- [ ] A mono face carrying **`Rp`** and box-drawing
- [ ] `@font-face` block — `ui/src` currently has **0**
- [ ] **Remove** the CDN `<link>` at `ui/index.html:99` and its two `preconnect` hints at `:96`/`:97`
- [ ] Add the OFL text + third-party notice, placed beside `packaging/linux/deb/`
- [ ] `tokens.css:146`/`:148` fallback tails stay **byte-identical** — they are correct and they are the safety net
- [ ] One pathspec commit, `feat(ui)`

**Confirmation** — bundled font files **> 0** · `@font-face` count **> 0** · `grep -c googleapis ui/index.html` → **0** · census findings move by **exactly the number of faces bundled** · **the app renders identically with the network disabled** — the assertion this whole plan exists to make true · `dev-ci.yml` census still exit **1** only if a real gap remains.

---

## Phase 3 — promote census → blocking

- [ ] **Two consecutive green census waves** first
- [ ] Narrow **hard** check: the two token tails end in a generic keyword
- [ ] Wide check stays **census**: every named face resolves

**Confirmation** — `dev-ci.yml` step exit **0** blocking · the `docs/records/audit-open-findings.md` entry closed by a **code** commit, not a docs one — *a sha in a docs commit proves a sentence was filed, not a defect removed.*

---

## Phase 4 — optional hardening, decide after Phase 3

- [ ] Give the **120 bare `var(--font-mono)`** call sites a fallback value, or accept them, measured 12 of 132 carry one
- [ ] Add a real `fc-match monospace` run to a Linux CI job — Linux **is** a shipped target, see notes

**Confirmation** — either the call sites changed with the census count moving accordingly, or the decision to leave them is written here with its reason. Silence is not a decision.

---

## Notes

**The finding, in one line.** `README.md` promises *"Operates without internet connectivity"*; `ui/index.html:99` fetches `fonts.googleapis.com/css2?family=Inter:wght@10…` — **the only stylesheet, one family, no second.** An offline-first POS with a network-fetched UI font is not offline-first in the sense anyone means. **Mono is worse than sans: it has no source at all**, bundled *or* CDN, so four absent faces fall through the generic keyword to **Courier New on Windows — narrower than characters**, on the platform we ship. Cost of fixing, roughly **60–120 KB** subset Inter + **40–80 KB** subset mono, against an installer already shipping **53 asset files** plus a webview runtime. **The CDN was never chosen for size; it was convenience, and convenience is exactly what a POS cannot buy.**

**Measured state, 03:53.** font files in repo **0** (`woff woff2 ttf otf`) · `@font-face` in `ui/src` **0** · remote `url()` font in any CSS **0** · `font-family` declarations under `ui` **267**, 11 distinct, `var(--font-mono)` 120 / `var(--font-sans)` 68 / `inherit` 64 · hardcoded OS paths in `.rs` **1**, in a test · `dirs`/`directories` in any `Cargo.toml` **0** · CI steps mentioning `font` in `dev-ci.yml` **0** · second UI stack **0** `.slint`, **0** `pubspec.yaml`.

```css
/* tokens.css:146 */ --font-sans: Inter, -apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif;
/* tokens.css:148 */ --font-mono: JetBrains Mono, SF Mono, Cascadia Code, Fira Code, ui-monospace, monospace;
```

**Blueprint rules, assessed.** 1 ideal-face-first **FAIL** (mono has no source whatsoever) · 2 Apple tokens second **PASS** · 3 Microsoft target **PASS on sans / PARTIAL on mono** (no Segoe UI Mono, no Consolas; `Cascadia Code` ships only with VS 2022+) · 4 Roboto/Noto tail **WEAK by construction** (fontconfig aliases generic keywords to installed fonts — no CSS tail guarantees anything on a foreign distro) · 5 generic net last **PASS** (both present).

**Linux is real.** `release.yml` matrix — `:110 desktop-linux`, `:118 desktop-windows`, `:126 desktop-macos` — plus `packaging/linux/deb/{postinst,prerm}` and `oz-pos.desktop`. So **3 of the blueprint’s 5 rows apply**; iOS/Android do not (`packaging/mobile/` is a README; `android.yml.bak`/`ios.yml.bak` retired). Earlier "evidence" here was a 3-occurrence word count, **not proof of a build target** — replaced by the matrix lines.

**Printer is out of scope.** `crates/oz-hal` has a function named `default_print_raw_handles_*` and 29 HAL files touch receipts → the printer is fed **raw bytes**; ESC/POS firmware renders with its **own codepage fonts**. **No webfont can affect printed output**, and a webfont cannot fix a codepage. Whether an attached printer needs an `Rp` codepage mapping belongs to whoever owns `oz-hal`.

**Kiosk carries the same exposure.** `ui/src/features/kiosk` exists with 6 `.ftl` pairs; `apps/tablet-client` registers **0** license commands (no `license.rs` at all) — the same tablet-license decision parked elsewhere in this repo.

**Licensing.** `grep -icE "ofl|open font|font" LICENSE` → **0**: our licence is **silent** on fonts, so nothing we wrote blocks OFL embedding. SIL OFL 1.1 permits embedding in proprietary closed-source software without relicensing your code — ship the notice, don’t sell the font standalone. Inter and JetBrains Mono are both OFL 1.1, which is why Slack, Notion, Figma and VS Code ship Inter. Hotlinking trades a licence-clean embed for a **service dependency you neither control nor pay for**.

### Design law — for a future we do not have yet
The **rule** is stack-neutral (ideal face first · generic keyword last · every named face resolves **without the network** · glyph coverage covers the scripts we ship — `26 .id.ftl` Indonesian bundles and `Rp` are a **coverage requirement, not taste**). The **parse** is per-stack. Hence *contract + adapters*, never a CSS linter — fusing them today costs nothing, and a rewrite after the second stack lands does. Corollary for tonight’s 14 gates: **the rules worth keeping are the ones statable without naming a file format.**

### Claims I retired, so nobody re-buys them
- *"Inter is missing from the repo"* — **false.** It is CDN-fetched; a network dependency, not an absent asset. Different fix, different risk.
- *"Rule 5 fails"* / *"Segoe UI is absent"* — **false.** Both were a **90-char output cut** hiding a wrapped line. The tails were there all along.
- *"0 other `--font-*` definitions"* — **VOID.** Two broken `git grep` invocations (`Invalid preceding regular expression`, `option -e must come before non-option arguments`). **A broken pipeline is not a zero.**
- *"17 files need the reword"* — **false,** 17 of 20 were `__pycache__`. Same lesson, twice in one day.
- *"all nine probes present"* — my own regex-from-string check (`new RegExp("Font\\s+x")`) is **not** equivalent to the shell’s `s`. A regex hit is a hypothesis; the printed line is the evidence.

### Not in scope
No Slint/Flutter/native code (designed for, not built — 0 files exist) · no mobile · no typography redesign or token renames (`--text-2xs` upward untouched; generated files reference them) · no printer codepage work · **no `cargo fmt` on the workspace** — check-only and off the commit path since 2026-09-13.

### Housekeeping
This file is **untracked**. To version it, the sanctioned §3 new-file chain, ONE line: `git add -- todo-font-system.md && git commit -m "docs(agents): add cross-os font portability plan" -- todo-font-system.md`, then `git show --stat` to prove the `create mode` entries are exactly this file. Never `git add` as a separate step, never `-a`/`--amend`/`stash`/`reset`/`push` — the index is shared and racing in this checkout. **Never `git clean -xdf`**.
