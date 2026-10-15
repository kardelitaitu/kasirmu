# Sampling the class-selector pattern across the suite (round 200)

## Why this round

Round 199 isolated a rule: **a class selector plus `.first()` asserts about whichever element
happens to be first.** The four failures in rounds 196-198 were all that shape, and all four were
mine. The question this round asked is whether the SAME shape in the pre-existing specs — written
before this session — is hiding live defects.

## The scan, and why the first version was useless

A first pass counted every `locator('.class').first()` in the suite: **136 sites**. That is not a
finding, it is the normal way to address a card you intend to CLICK. The count was discarded and
the scan narrowed to the shape that actually fails — a locator **bound to a name and then
ASSERTED** without being clicked, which is a claim about identity:

```
const card = page.locator('.multi-store-card').first();   // bound
await expect(card).toBeVisible();                          // asserted, never clicked
```

That narrowed it to **120**, still too many to kill-test, and still mostly legitimate — asserting
a CONTAINER exists (`.shift-mgmt-overlay`, `.product-mgmt-overlay`) is not a claim about a shared
family.

## What was actually kill-tested

Five specs, chosen for the shape closest to the failures: an assertion that something CHANGED, on
a class-shared element.

| Spec | Mutation | Result |
|---|---|---|
| `restaurant-order-lifecycle` | make `handleIncreaseQty` a no-op | **failed correctly** |
| `restaurant-menu-editor-bulk` | 86 All targets nothing | failed correctly (round 184) |
| `restaurant-menu-editor-category` | duplicate-name rule disabled | failed correctly (round 199) |
| `restaurant-add-custom-rail` | duplicate-code check disabled | failed correctly (round 199) |
| `restaurant-receipt-preview-documents` | kitchen branch unreachable | failed correctly (round 199) |

## What this does and does not establish

**Does not**: prove the remaining ~115 sites are sound. Five kill-tests is a sample, and the
before-this-session specs were written by other hands against fixtures I have not audited.

**Does**: the shape is not inherently broken. Each of the five asserts something that changes and
fails when the change is removed, which is what a test is for. The distinguishing factor is not the
selector — it is whether the assertion NAMES the thing that must change or merely checks that *an*
element of the right kind is present.

## Verified

| Item | Result |
|---|---|
| Scan | 136 class+`.first()` sites, narrowed to 120 bound-and-asserted |
| Kill-tests | 5, all failed correctly |
| Sources | all restored, byte-identical to HEAD |
| Tree | no source changed by this round |

## The rule, now stated for the suite rather than one screen

An assertion binds when it is about a **named** element and a **specific** change. It does not bind
when it is about "an element matching this class" and a state that was already true. The fix in
every failing case was the same: address the subject uniquely — by testid, by captured index, or by
a stable attribute — and assert the change with `.poll()`.

> last audited 14-10-26 by docs-auditor
