# An IPC door the desktop does not have, reached by an empty-string fallback — 2026-10-19

**Scope:** `scripts/verify-ipc-parity.py` (required gate, red at HEAD), reached while sweeping the
required gates this session had never exercised.
**Result:** 1 real defect recorded and left unfixed (it is UI code, not documentation);
27 disposable root artifacts cleaned; `verify-root-policy.py` repaired and green.

## The defect

`verify-ipc-parity.py` reports one violation:

```
desktop: UI invokes 'get_cart_deduction_location' from a file that branches on the
shell (so this shell runs it) but this shell registers no door for it --
at desktop::ui/src/features/sales/PosScreen.tsx:893#getCartDeductionLocation.
This is the C40 shape: the invoke is rejected as an unknown command at runtime,
so the caller silently renders its failure path.
```

The mechanism, traced:

- `PosScreen.tsx:157` is `const sessionToken = rawToken || ''` — so the token defaults to the
  **empty string**, never to `null`.
- `PosScreen.tsx:891-893` selects the wrapper with `sessionToken ?`: a truthiness test. An empty
  string is falsy, so it takes the **ambient** branch and calls `getCartDeductionLocation(locId)`.
- `ui/src/api/sales.ts:183` sends the ambient `get_cart_deduction_location`.
- The **tablet** shell registers that name (`apps/mobile-tauri/src/commands/pos.rs:445`). The
  **desktop** shell registers only `get_cart_deduction_location_scoped`
  (`apps/desktop-tauri/src/lib.rs:1804`).
- So on desktop, when no workspace session is present, the invoke is rejected as an unknown
  command, and `PosScreen.tsx:896-898`'s bare `catch` sets the badge to the **raw location id**.
  The user sees an id where a location name belongs, and no error surfaces.

`ui/src/api/sales.ts:188-191` already documents the asymmetry in prose — "the ambient
`get_cart_deduction_location` above is registered by tablet only, so calling it from the desktop
shell throws 'command not found'; that asymmetry is what this wrapper exists to route around."
The wrapper exists and is correct. **The fallback branch is what still reaches around it.**

## Why the test suite misses it

`ui/src/__tests__/PosScreenDeductionLocation.test.tsx` has a `describe` block specifically for this
ADR (`:205-214`) whose comment names the original "command not found" bug. But its cases stub the
**scoped** wrapper and assert the badge, i.e. they exercise the populated-token path. **The empty-token
fallback that reaches the ambient command is not covered**, so 7/7 tests pass while the gate stays
red. Verified by running the file: `7 tests passed`.

That is the general lesson, and it is the same one this corpus records elsewhere: **a test named
after a bug proves the bug's headline path is fixed, not that every branch that reached it is.**
The gate reads the code shape (does this shell register a door for every name a shell-branching
file can invoke); the test reads behaviour on one path. Neither subsumes the other, and here the
one that reads shape is right.

## Why it was not fixed here

The repair is a one-line UI change — drop the ambient fallback and either require a session or
guard the call — but it touches sale-checkout behaviour in a screen with a documented double-fire
history, and this session's mandate is documentation. **Recorded, not patched**, so it is not lost.
The gate is `required` and will keep it visible; `verify-ipc-parity.py --self-test` passes (27 cases,
192 assertions), so the failure is the tree, not the checker.

## Also this pass: root-policy debris

`verify-root-policy.py` was red with **66 stray root files**. Its own docstring explains why it does
not consult `.gitignore`: gitignored scratch is invisible to `git status`, so nothing prompts a look,
and on a parallel-agent branch clean status is a coordination primitive. Categories found and acted on:

- **27 disposable** — 26 `.tmp-*.png` / `diag*.log` / `e2e-cap*.log` debug captures, plus one
  `ui_dump.xml` Android hierarchy dump. Removed.
- **39 tablet-HMR lane artifacts** — `tablet_*.png` screenshots and five `*.db` copies from
  2026-09-30..10-17, referenced by no tracked file. Removed after confirming no references.
- **1 kept and allowlisted** — `START_TABLET_HMR.bat`, a 151-byte launcher whose body is
  `powershell -File "%~dp0scripts\android-dev-hmr.ps1"`. It is a **human entry point**,
  double-clicked from the root, which is exactly the class `deploy-website.bat` was allowlisted for.
  Allowlisted with the reasoning in a comment; `--self-test` (6 cases) still passes.

`todo-docs-restructure.md:926-931` records that this debris class **regenerates from lanes the plan
does not own**. That is why the allowlist gained one entry rather than the gate gaining an exemption:
the gate is right, the debris is real, and the sources are still running.

> last audited 19-10-26 by docs-auditor
