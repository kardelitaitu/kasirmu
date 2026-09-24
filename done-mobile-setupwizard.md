# todo-mobile-setupwizard.md

> Status: COMPLETED · last reviewed 2026-09-24 · branch 0.0.40

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
CSS: single shared module `MobileWelcomeFlow.module.css` (incl. orientation queries and animations).  
All files live at `ui/src/features/setup/mobile/`.

---

## Done

- [x] All 5 screens built matching Figma specs (dark background, dark tokens) — commit `7c2ee4133`
- [x] Shared CSS module with full dark token palette — `MobileWelcomeFlow.module.css`
- [x] 44 English FTL strings (`setup-mobile-*`) — `shared-ui/locales/settings.ftl`
- [x] 44 Indonesian FTL strings — `shared-ui/locales/settings.id.ftl`
- [x] 12 unit tests passing — `ui/src/__tests__/MobileWelcomeFlow.test.tsx`
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
- [x] #5: Page route registration (`ui/src/features/setup/mobile/register.tsx`, route `mobile-setup`, registered in `ui/src/features/index.ts`)
- [x] #6: `pairingUrl` / `pairingCode` async loading support with animated `.codeSkeleton` placeholder
- [x] #7: Async `isLoading` and `error` states across Google, Email, and QR Pairing views with spinner & error alerts
- [x] #8: Live camera feed support with `<video>` element and graceful fallback placeholder in `MobileQrPairingModal`

