# todo-mobile-setupwizard.md

> Status: IN PROGRESS · last reviewed 2026-09-24 · branch 0.0.40

## Context

Five screens matching Figma section `3:13 — Kasirmu Mobile Welcome Screen (Portrait 720×1280)`:

| Screen | Component | Figma node |
|---|---|---|
| Welcome | `MobileWelcomeScreen.tsx` | `3:142` |
| Setup Hub | `MobileSetupHub.tsx` | `3:4` |
| Google Auth | `MobileGoogleAuthModal.tsx` | `3:15` |
| Email Auth | `MobileEmailAuthModal.tsx` | `3:26` |
| QR Pairing | `MobileQrPairingModal.tsx` | `3:35` |

Orchestrator: `MobileWelcomeFlow.tsx` — `useState<MobileScreenState>` machine.  
CSS: single shared module `MobileWelcomeFlow.module.css` (897 lines incl. orientation queries).  
All files live at `ui/src/features/setup/mobile/`.

---

## Open issues (from code review)

### 🔴 P1 — Bugs / Correctness

- [ ] **#3 — Auth modal root class wrong**  
  `MobileGoogleAuthModal`, `MobileEmailAuthModal`, and `MobileQrPairingModal` all use
  `.hubContainer` as their root `<div>`.  
  In landscape `.hubContainer` becomes `flex-direction: row` with `.heroCard` pinned sticky-left —
  a layout that makes no sense for auth modals (they have no heroCard child).  
  **Fix:** give each auth modal its own `.authModalRoot` class (flex column, no 2-col split).

- [ ] **#2 — `onSignUp` called even when `undefined`**  
  `MobileWelcomeScreen.tsx` line 44: `onClick={onSignUp}` — React accepts `undefined` here without
  error but it is semantically wrong (button appears clickable).  
  **Fix:** `onClick={onSignUp ?? undefined}` _and_ add `disabled={!onSignUp}` so the button is
  inert when the prop is absent, or hide it entirely with a conditional render.

### 🟡 P2 — Missing real data / props

- [ ] **#1 — Google account list is hardcoded**  
  `MobileGoogleAuthModal.tsx` lines 49–83: two static demo accounts (`jokosusilo@gmail.com`,
  `valentino1234@gmail.com`).  
  **Fix:** add `accounts: GoogleAccount[]` prop (type: `{ name: string; email: string; avatarColor?: string }`).
  When `accounts` is empty, show an "Add Google account" placeholder button.  
  Wire real accounts from the Tauri IPC `list_google_accounts` command when available.

- [ ] **#4 — `hubSectionPrompt` used as `aria-labelledby` target in email modal**  
  `MobileEmailAuthModal.tsx` line 45: the `<p>` with class `.hubSectionPrompt` is referenced by
  `aria-labelledby="email-auth-heading"` but `.hubSectionPrompt` gets `display: none` in landscape,
  which removes the accessible name from the section entirely.  
  **Fix:** swap to a dedicated `<h2>` heading styled separately, or use `.modalTitle` class which
  is always visible.

### 🟢 P3 — Integration / wiring

- [ ] **#5 — No route or `register.tsx` — component is dead code**  
  `MobileWelcomeFlow` is exported but never imported by any router, app shell, or Tauri entrypoint.  
  **Fix (when ready to wire up):**
  1. Create `ui/src/features/setup/mobile/register.tsx` with a lazy import + `registerPage` /
     `registerNavItem` call matching the project's page-registration pattern.
  2. Add the route to the mobile Tauri app's router (check `apps/mobile-tauri/src/`).
  3. Add a platform guard so the route is only reachable inside the mobile Tauri target — prevents
     the landscape CSS 2-col split firing on a Windows desktop window (width always > height).

- [ ] **#6 — `pairingUrl` / `pairingCode` defaults are placeholder values**  
  `MobileQrPairingModal.tsx` line 13–14: defaults `'https://kasir.mu/login?=1234-ABCD'` and
  `'1234-ABCD'`.  
  **Fix:** remove defaults; require the parent to supply real values from the Tauri IPC
  `generate_pairing_code` command. Show a loading skeleton while the code is being generated.

- [ ] **#7 — No loading / error states in any auth modal**  
  All three auth modals (`Google`, `Email`, `QR`) call `onProvisioned?.()` / `onSubmit()`
  synchronously. In production these will be async (network + IPC).  
  **Fix:** add `isLoading: boolean` and `error?: string` props; disable submit buttons and show
  a spinner while in-flight; surface error messages inline.

- [ ] **#8 — QR camera viewfinder is a placeholder emoji**  
  `MobileQrPairingModal.tsx` line 54–56: `📷` emoji stands in for a real camera feed.  
  **Fix:** integrate a WebView camera API (via Tauri `camera` plugin or a `<video>` element fed
  by `getUserMedia`) and render the live stream inside `.scannerReticleBox`.

---

## Done

- [x] All 5 screens built matching Figma specs (dark background, dark tokens) — commit `7c2ee4133`
- [x] Shared CSS module with full dark token palette — `MobileWelcomeFlow.module.css`
- [x] 44 English FTL strings (`setup-mobile-*`) — `shared-ui/locales/settings.ftl`
- [x] 44 Indonesian FTL strings — `shared-ui/locales/settings.id.ftl`
- [x] 6 unit tests passing — `ui/src/__tests__/MobileWelcomeFlow.test.tsx`
- [x] TypeScript clean — `tsc --noEmit` exit 0
- [x] ESLint clean — 0 errors
- [x] Portrait / landscape adaptive CSS — commit `69f80d70f`
  - `@media (orientation: landscape)` → 2-col split (Welcome brand|actions, Hub hero|auth-list)
  - `@media (orientation: landscape) and (max-height: 480px)` → ultra-compact for small devices
- [x] figma-bridge skill written — `.agents/skills/figma-bridge/SKILL.md` — commit `a2460e0cb`
