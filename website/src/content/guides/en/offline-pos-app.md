---
title: "Offline POS: Keep Selling When the Internet Drops"
description: "An offline POS stores each sale on the device and syncs it when the connection returns. Here is what to check before you trust one."
target: "offline pos app"
commercialParent: "kasir-gratis"
pair: "aplikasi-kasir-offline"
updated: "2026-09-24"
order: 1
---

Small shops rarely have a connection they can rely on. Heavy rain, a data
allowance that ran out, a router that restarted itself, or a network that slows
to nothing at the evening rush — all of it lands on the same day you are busiest.
So the useful question is not whether a point-of-sale app *can* work offline,
but what happens to your money and your records while the connection is gone.

## "Works offline" is used to mean two different things

Plenty of apps advertise an offline mode and mean different things by it. Some
only let you open the app again without signing in; the sale itself still fails
when the network drops. A genuinely offline POS writes the transaction **onto the
device** — the local storage of the phone, tablet or computer — and sends it to
the server later, without waiting for a network.

You cannot tell the two apart until the connection drops, and by then it is too
late to check. So do not ask "does it work offline"; ask "what happens when I
press Pay with no signal".

## The four things that must keep working

Four things must not stop just because the connection did:

1. **Recording the sale.** The customer does not care about your network. The
   receipt still has to print or send, and the change still has to be counted.
2. **Reducing stock.** If stock only updates after tomorrow's sync, you will
   sell something today that you ran out of yesterday.
3. **Closing the till.** Today's takings have to be reconciled tonight, not
   whenever the server next hears about them.
4. **Keeping the history.** A completed sale must survive the app being closed,
   the device being switched off, or the battery dying.

If any one of those four depends on the network, the app is not an offline POS —
it is an online one that happens to open.

## Where your data sits in the meantime

The usual and safe arrangement: every sale is written to the device's local
storage the moment it is paid, and marked "not yet sent". The app uploads it as
soon as a connection exists and clears the mark once the server confirms. Until
that confirmation arrives, the sale is safe on the device.

Two consequences worth understanding before you choose:

- **The device is the primary storage for a while.** If the phone is lost or
  broken before it syncs, whatever was still queued goes with it. Which is why a
  queue should never be left to build up for weeks.
- **Each device can be a slightly late source of truth.** In a shop with two
  tills, both devices may record sales of the same item independently. Stock is
  only truly accurate once both have synced.

## Test it yourself in five minutes

Do not take a features page on trust — including ours. Run the test:

1. **Switch on airplane mode** and ring up one real sale. Take it all the way to
   the receipt. If the app refuses or hangs, that is not an offline mode.
2. **Open the daily sales report** while still offline. The sale you just made
   has to be in it.
3. **Force-close the app and reopen it**, still offline. The sale must still be
   there. A history that vanished means the data only ever lived in memory.
4. **Turn the connection back on** and wait. The sale should upload on its own,
   with nothing for you to press.
5. **Check on a second device** — your phone, or a computer at home. After the
   sync, the sale appears there too.

The first four steps separate an offline POS from an online one that apologises.
The fifth proves the sync actually works rather than merely claiming to finish.

## The questions people ask

**Does QRIS still work?** QRIS payments do need a connection, because the
confirmation arrives from the bank or the payment gateway. So a QRIS transaction
cannot be completed while offline. What you can do is record the sale offline and
confirm the payment later, or keep cash as the fallback. That limit belongs to
every POS, not to one brand.

**How long can data be held?** It depends on the device's storage, and it is
almost always far longer than you will need. The habit matters more than the
number: connect once a day so the queue never piles up.

**Are monthly and tax reports still accurate?** Yes, as long as every device has
synced before you close the period. Close a period when the queue is empty, not
merely when the date has rolled over.

## Start on the free plan

You do not have to pay to find any of this out. Install it, switch on airplane
mode, and run the five checks above — [kasir.mu is free to start for small shops
and warungs](/en/kasir-gratis/), and its offline mode is on by default with
nothing to configure. If it does not convince you, you will know within five
minutes rather than after a year of subscriptions.
