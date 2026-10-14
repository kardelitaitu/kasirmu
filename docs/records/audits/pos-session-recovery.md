# POS session-lifecycle: what happens between expiry and re-auth (round 78)

## The question

Round 77 wired a banner so the operator LEARNS the session died mid-shift, and round 78
render-tested that it appears. Neither proved the operator can RECOVER. This note is the
third part: what state survives `goToWorkspacePicker` -> picker -> new session, and what
happens to async work that captured the dead token.

## The recovery path is a remount

`useWorkspaceNav.goToWorkspacePicker` is two lines — `setActiveWorkspace(null)` and
`window.location.hash = ''` (`ui/src/hooks/useWorkspaceNav.ts:13-16`). So "recovery" is:
the POS unmounts, the picker renders, a new session mints, the POS remounts. Everything
that matters therefore has to live in storage, not in React state.

### Cart: survives, and is already covered

The cart writes to `localStorage` on every change under `pos-active-draft`, plus a 
one-shot `pos-locked-cart` for the lock path. The mount effect at `PosScreen.tsx:185-247`
restores both, including `orderType` — a field rounds 40-45 added because a restored
takeaway came back as dine-in and printed the wrong kitchen ticket.

Coverage already exists and this round did not need to add it:
`PosScreenCoreFlow.test.tsx:1793` (active draft), `PosScreen.integration.test.tsx:546,577`
(locked cart), `useLockedCartPersistence.test.tsx` (the lock hook on its own, incl. refusing
malformed JSON). A new test here would restate those.

## The stale-token question, and why the POS is already bounded

A remount gets a fresh token, so the hazard is not the new session — it is async work
started under the OLD one. `ExpoScreen` documents this precisely at lines 166-173: a stale
closure captures BOTH the token and the store id, so a client-side store filter cannot
detect it, "because staleness is not a property of the response." It guards with
`ordersTokenRef.current !== forToken` after the await.

`PosScreen` has three of the same shape, all on READS: `receiptSettingsSeq`,
`courseFiringSeq`, `orderTypePromptSeq` (lines 1172-1276). Each bumps a ref on
unmount/change and drops a response that arrives late.

The one unchecked write is the dine-in table RELEASE inside `handlePaymentComplete`
(`PosScreen.tsx:779-807`): it captures `sessionToken` and carries it across two awaits with
no staleness check. Read in full, it is bounded and correct:

  1. It runs AFTER the sale is recorded, deliberately fire-and-forget — stated at :798-803,
     "a floor-plan hiccup must never fail the sale that just completed".
  2. A stale token does not fail silently. `release_table_scoped` begins with
     `ctx.resolve_session(session_token)?` (`kasirmu-bridge/src/tables.rs:196`), which
     returns `InvalidSession` for an expired token, so the promise REJECTS and the `.catch`
     at :804 raises `tables-action-error` as a warning.
  3. Guarding it with a token comparison would not obviously improve matters: releasing
     against the NEW session's token from a closure formed under the old one is a worse
     failure than a visible warning about a table that stays occupied.

So the residual case is: session dies exactly as a sale completes, the table reads
Occupied when it is free, and the cashier is TOLD. That is the designed direction.

## What this does NOT cover

The recovery was reasoned from the code and from existing tests, not driven end-to-end
(expire -> picker -> re-auth -> complete a sale). No such test exists; building one means
standing up the workspace provider, the auth context and the bridge mocks together, which
is a larger piece of work than the finding warranted.

`RetailPosScreen` was not re-checked for the same stale-token shape. It shares
`usePosState` but not `handlePaymentComplete`, so the table-release path above is
restaurant-only — but other writes there were not audited.

## Re-verify with

  cd ui && npx vitest run PosScreenCoreFlow.test.tsx PosScreen.integration.test.tsx \
    useLockedCartPersistence.test.tsx sessionBannerRenders.test.tsx