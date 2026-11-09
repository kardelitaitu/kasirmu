# A failed barcode lookup was silently dropped at the till

**Date:** 2026-10-11 · **Round:** 48 (session) · **Status:** FIXED
**Area:** `ui/src/features/sales/PosScreen.tsx` — the barcode scanner's `onProductFound`

## The handler and its three outcomes

`useBarcodeScanner`'s `onProductFound` (PosScreen.tsx:613-673) is what turns a scan into a
cart line. It has three exits, and before this round two of them reported:

| Outcome | Behaviour |
|---|---|
| product found | added to the cart |
| clean miss (not our barcode) | warning toast `pos-no-barcode-match` |
| **lookup threw** | **bare `catch { }`** |

```ts
} catch {
  // Silently ignore — the scanner will beep, user retries.
}
```

The scanner's own `onError` handler, in the same options object (:674), toasts
`pos-scanner-error`. So the missing report is not a design choice.

## Why the comment was wrong

"The scanner will beep, user retries" is true of a scanner mis-read. It is untrue of a
failed IPC or a dead session: **every retry fails too**, so the item never arrives and the
cashier is given no reason. At a busy till that reads exactly like a dead scanner, and the
operator's next move is to key the item in by hand or re-scan the same code indefinitely.

The whole screen is the store POS checkout — this is the highest-traffic input surface in
the app.

## Fix

```ts
} catch (err) {
  console.error('barcode lookup failed', err);
  addToast({
    message: requiredLocalized(l10nRef.current, 'pos-barcode-lookup-failed'),
    type: 'warning',
  });
}
```

New bilingual key, deliberately worded as *could not check* rather than reusing
`pos-no-barcode-match`:

- `pos-barcode-lookup-failed = Could not check this barcode — please try again`
- `pos-barcode-lookup-failed = Tidak dapat memeriksa barcode ini — silakan coba lagi`

Reusing the "no match" string would tell the cashier the code is not ours when in fact we
could not tell — the same class of misleading message as round 41's tender finding.

## Evidence

New test at the END of `PosScreenCoreFlow.test.tsx` — *SAYS SOMETHING when the barcode
lookup itself FAILS, instead of doing nothing at all*. It rejects the lookup, drives a real
scan, and requires a `.toast`. **RED before the fix**:
`a failed barcode lookup produced no toast at all: expected null not to be null`.

**Kill-tested** by replacing the report with `void err;`: red again, green on restore.

- `PosScreenCoreFlow.test.tsx` **33 passed**, 1 skipped (pre-existing skip at :1879)
- full UI suite **807 files, 12,809 passed**
- `typecheck` clean · `eslint` no new findings · `lint:i18n` clean

## Two things worth recording

### The test had to go LAST in the suite, and that is a finding in itself

This case installs a permanently-rejecting lookup mock. With the test at the head of the
suite, **30 following cases failed** on 'no product in the cart' — the rejection answered
every later scan. The file's own header (:491-503) documents this exact hazard
("a `mockResolvedValueOnce` from a case that never consumed it SURVIVES both
clearAllMocks() and a later mockImplementation"), and it still bit me. The test now sits at
the end and restores the suite default on the way out; the comment says why it is there so
nobody "tidies" it back to the top.

### The first version of this test passed for the wrong reason

Two false greens before the real assertion:

1. asserting on `document.body.textContent` matched the word "Error" from unrelated UI;
2. rendering without a shift let the handler return early at :614 on the *open-shift*
   toast, so the test was asserting a different message entirely.

Both would have shipped a green test that proves nothing about the defect. The final
assertion targets `.toast` specifically, after `renderPosScreenWithShift()`.

## Related

Round 47 (`kds-item-status-failure-was-silent.md`) is the same shape one feature over: a
reported path beside a mute one. Round 48's sweep started from that finding rather than a
random file, which is why this one was found in the checkout path specifically.

> last audited 11-10-26 by docs-auditor
