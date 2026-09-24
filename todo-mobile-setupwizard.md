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
- [x] 8 unit tests passing — `ui/src/__tests__/MobileWelcomeFlow.test.tsx`
- [x] TypeScript clean — `tsc --noEmit` exit 0
- [x] ESLint clean — 0 errors
- [x] Portrait / landscape adaptive CSS — commit `69f80d70f`
  - `@media (orientation: landscape)` → 2-col split (Welcome brand|actions, Hub hero|auth-list)
  - `@media (orientation: landscape) and (max-height: 480px)` → ultra-compact for small devices
- [x] figma-bridge skill written — `.agents/skills/figma-bridge/SKILL.md` — commit `a2460e0cb`
- [x] #1: Dynamic `googleAccounts: GoogleAccount[]` prop + fallback defaults in `MobileGoogleAuthModal`
- [x] #2: `onSignUp` semantic button fix (`disabled={!onSignUp}` + `onClick={onSignUp}`)
- [x] #3: Auth modal root class separation (`.authModalRoot` instead of `.hubContainer`) and responsive `.qrPairingLayout`
- [x] #4: Email modal heading accessibility fix (dedicated `.modalTitleSection` h2 visible in landscape & portrait)
