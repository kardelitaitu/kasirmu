# A dead button nothing was rescuing — 2026-10-18

<!-- Audit stamp: 2026-10-18 - autonomous goal round 156 - status: 1 real defect fixed
     (toolbar profile button with no handler and no ancestor), 1 test artefact found by
     its own unhandled error - branch: 0.0.41 - commit: a3eb001ea -->

<!-- Scope: workspace home toolbar (usability), per the active goal. Opened from round 155
     own carry-forward, which named this control and KioskScreen.tsx:247. -->

## Round 155 left a question this round answered

The static sweep had flagged `WorkspaceHome.tsx:288` as a control with no handler, and round
155 closed by saying both it and `KioskScreen.tsx:247` "need the same bubbling check before
anyone calls them dead". This round ran that check, and the answer differed between them.

`TransactionLogScreen` (round 155) was rescued by bubbling: the click reached the row.
Here the immediate parent is a **fragment** and the only wrapper is `div.ws-header-buttons`
(:274), which has no handler either. So the profile button was dead **outright** --
focusable, labelled with an aria-label, rendered, and inert to pointer AND keyboard. No
ancestor anywhere in its chain was absorbing the click.

That distinction is the reason the same sweep needed two rounds: "no onClick" is not one
defect, it is two, and only an ancestor check tells them apart.

## The fix follows the existing navigation contract

The destination is the registered `staff` route (`tools.tsx:88-89`), reached through the
same `handleShortcutNav` the Tools cards use -- so the toolbar cannot disagree with the
grid about where a user's own account lives. Wrapped in a stable `useCallback` rather than
passed directly, because `handleShortcutNav` takes a ROUTE and an onClick hands it the
MouseEvent.

## A passing test that was passing for the wrong reason, caught by its own error

The first version passed **with an unhandled exception attached**:
`TypeError: setActiveWorkspace is not a function`, thrown from the 150ms exit timer. The
assertion ran before the timer fired, so the case was green while the navigation crashed.
Vitest said as much in the summary -- "This might cause false positive tests".

That is the round-155 lesson one step further: last round a passing test hid a DEAD button
through bubbling; this time a passing test hid a CRASHING code path. Both were caught by the
same discipline of reading the error output rather than the pass count.

Fixing the mock exposed a second, subtler artefact. With the harness default,
`setActiveWorkspace` **was** called once -- because `getPage('staff')` returned undefined in a
file that never imports the feature registry, so `getPage(route)?.fullscreen !== true` took
the rebind branch. Production imports the feature modules, so the case now imports the real
`registerStaffFeature()` rather than stubbing the registry, and the assertion
`expect(mockSetActiveWorkspace).not.toHaveBeenCalled()` pins the contract the comment at
WorkspaceHome.tsx:520-529 documents: a fullscreen destination must NOT rebind the workspace,
because that rebind is precisely what made Staff Management unreachable on the tablet.

An unregistered-registry assertion would have been testing the harness, not the product.

## Evidence

- Red then green: removing the handler gives `expected '' to be '#/staff'` -- a clean,
  unambiguous red with NO ancestor fallback, which is the difference from round 155.
  58/58 in WorkspaceHome.test.tsx after, with no unhandled errors.
- Kill-test: `onClick={onOpenProfile}` removed -> red; restored byte-identical.
- Real registry: `fullscreen: true` for 'staff' confirmed at features/staff/register.tsx:29,
  and the rebind contract pinned by assertion rather than by comment.
- Gates: `npm run lint` PASS (0 errors, 116 warnings), `npm run lint:i18n` PASS, and zero
  typecheck errors naming my files.
- Full suite: 809 passed | 5 failed files of 814; **12949 passed**. All six failures are
  cross-lane and none is mine: featureCommentPaths, nativeDialogCompliance,
  noiseDitherCompliance, both OrderTypeDependentValueRule cases, and screenExtraction/
  ReceiptPreview. The typecheck failure is `completedSale.test.ts` -- DIRTY IN MY WORKTREE
  BUT NOT MINE, another lane editing sales/ -- verified by path-scoped status plus a
  findstr for my own files returning nothing.

## Carried forward

The sweep list is down to `KioskScreen.tsx:247` plus 50 design-showcase buttons, which need
no action. `KioskScreen.tsx:247` is the last real candidate from that sweep and should get
the same ancestor check.

Worth stating because it changes how the sweep should be read: **"no onClick" splits into
two classes, and only the ancestor check separates them.** Round 155 found one that worked
by accident (bubbling); this round found one that was inert. A future sweep that reports the
count without the distinction will under-report the dead ones and over-report the harmless
ones.

> last audited 18-10-26 by docs-auditor
