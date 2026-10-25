#!/usr/bin/env python3
"""check-reentry-guards.py -- list write handlers whose only busy-guard is state.

WHY THIS EXISTS
Rounds 136-144 of the restaurant-POS work found the same defect eight times, one file per
round, always by hand: a handler sets a busy flag (setSaving(true)), awaits an IPC write,
and has NO synchronous re-entry guard. The flag is STATE, and React commits state on the
NEXT render -- after the second dispatch of a real double tap. So a double tap sends the
write twice. Measured on four separate screens, in one act() batch: expected 2 to be 1.

What the double tap costs depends entirely on the BACKEND, and that is what makes a raw
list of candidates useless -- so this script only reports the SHAPE and does NOT claim a
defect:

  * a unique index REFUSES the replay (suppliers, purchase orders, staff, shift
    open/close, stock-count complete) -> the write is safe, but the rejection lands in the
    same catch that reports genuine failures, so the operator is told it FAILED when it
    succeeded;
  * no unique index -> a DUPLICATE ROW (customers, cash payouts, memos), or worse, a
    fixed-path overwrite where the last write wins (the restore request).

ALREADY CHECKED AND REFUTED (rounds 141, 144-146, by reading the backend). Do not
re-derive these: each is protected, and the protection is named so the search ends.

  * purchase orders  -- idx_purchase_orders_po_number (UNIQUE) refuses the replay
  * suppliers        -- idx_suppliers_code ON suppliers(code) (UNIQUE)
  * products         -- products.sku TEXT NOT NULL UNIQUE + UNIQUE barcode
  * staff            -- username UNIQUE + idx_users_tenant_username; create_user_in_tx
                        maps ConstraintViolation to CoreError::Conflict (staff.rs:593-600)
  * gift-card redeem -- EXPLICIT idempotency on (card_id, sale_id), fail-closed
                        (gift_cards.rs:330-419)
  * gift-card issue  -- gift_cards.card_number TEXT UNIQUE
  * void sale        -- compare-and-set `WHERE id = ?2 AND status = 'active'`, rows == 0
                        -> Conflict (sales_lifecycle.rs:903-914)
                        BUT the CAS is the defence and the REFUSAL is the defect: the catch
                        reports `void-orders-error-void` / `sales-history-void-error`, so a
                        double tap says "failed to void" over a sale that was voided. Round 175
                        FIXED both call sites -- VoidOrdersScreen.handleVoid and
                        SalesHistoryScreen.handleConfirmVoid -- each with a ref taken after its
                        validation returns, and a case that fails `expected 2 to be 1` with the
                        ref disabled. Two handlers, ONE backend fact: the second call site was
                        found only because this list names the COMMAND rather than a screen.
  * stock transfer
    - create         -- mints a DISTINCT transfer_number (`TRF-{ts}-{random tail}`, the
                        tail exists so two calls cannot collide) -- round 142 FIXED
    - receive        -- idempotent by DIFFERENCE: validated received_qty >=
                        previous_received_qty, and only the delta is credited
                        (stock_transfers.rs:654-661)
  * stock count complete -- compare-and-set, claimed != 1 -> Validation
                        (stock_counts.rs:529-539) -- round 144 FIXED
  * checkout / sale -- COR-7 replay guard + UNIQUE payments.idempotency_key returns the
                        ORIGINAL receipt (pos/checkout.rs)
  * categories      -- categories.name TEXT NOT NULL UNIQUE (20260813_init.sql) and
                        create_category maps ConstraintViolation to CoreError::Conflict
                        (products_categories.rs:52-60); products_tests.rs:614 pins it.
                        CORRECTION to round 146, which listed categories among the
                        leads with no unique constraint. That claim was wrong and came
                        from a hand-picked table list rather than a full sweep -- which
                        is the argument for enumerating the schema, not sampling it.
  * stock counts    -- round 147 FIXED (no dedupe: the bridge mints a fresh UUID and
                        the next count_number per call, so two calls produce two real
                        drafts)
  * tax invoice / e-Faktur -- IDEMPOTENT ONCE WRITTEN, but that is not enough:
                        `issue_tax_invoice_for_sale` returns the existing number when
                        `sales.statutory_number` already carries the series prefix
                        (fiscal.rs:572-587), and that column is set by the SAME
                        transaction -- so two issues in one tick both read NULL and both
                        fall through to `claim_statutory_number_for_sale`, an atomic
                        `UPDATE ... RETURNING` (fiscal.rs:438-455). The statutory sequence
                        advances TWICE: a gap or duplicate in a legally numbered series.
                        NOTE this defect had TWO call sites and round 148 fixed only the
                        receipt one: PaymentModal.handleIssueTaxInvoice, then round 149
                        SalesHistoryScreen.handleIssueTaxInvoice. The first round's record
                        named the second as outstanding, which is why it is written down here
                        rather than left to be rediscovered.
  * audit review checkpoint -- the WORST arm of this class. `save_review_checkpoint` is a
                        plain INSERT with no idempotency and no unique key
                        (audit.rs:909-944), it appends an `audit.review` event to the SAME
                        hash-chained log it attests about, and the payload is a
                        CLIENT-DERIVED high-water mark (AuditLogScreen.tsx:228-234) that
                        after the first refresh points at the review event itself. Round 151
                        FIXED in AuditLogScreen. If a new review surface appears, this is
                        the one that must not be missed.
  * fiscal document numbers / receipt sequence -- already defended in core:
                        claim_statutory_number_for_sale is an atomic `UPDATE ... RETURNING`
                        and claim_receipt_sequence an upsert, both inside the checkout
                        transaction, and the COR-7 replay guard returns the original receipt.
                        The counters are NOT the gap; the UI double-tap was.
  * credit settle   -- PER-ROW, and that is the design. `settle_credit_scoped` runs
                        `UPDATE payments SET settled_at = ?1 WHERE sale_id = ?2 AND
                        method = 'credit'` (settings.rs:657) with no status predicate and no
                        row-count check, so it also reports success for a sale already
                        settled or never a credit sale. Round 152 FIXED with a per-sale-id
                        ref set, NOT a global flag: two DIFFERENT rows must settle
                        concurrently. Any per-item list of writes is this shape, and a global
                        guard there is the wrong fix.
  * staff / role restore -- the CAS is the defence, the refusal is the defect.
                        `restore_user` and `restore_role` are both compare-and-sets
                        (`deleted_at IS NOT NULL AND purged_at IS NULL AND deleted_at >=
                        cutoff`, `rows == 0` -> NotFound; staff.rs:831-841,
                        roles.rs:627-637), so a replay restores nothing. But the refusal
                        lands in the catch that reports a genuine failure, so a double tap
                        says 'Failed to restore' for a member who WAS restored. Round 153
                        FIXED with a per-key ref Set (a staff row and a role row must not
                        block each other).
  * create_role     -- REFUSED by the backend: ConstraintViolation -> CoreError::Conflict on
                        a duplicate id or name (roles.rs:313-337, map_role_conflict).
  * sync conflict resolve -- REFUSED and reported HONESTLY: the command returns ok=false and
                        the UI surfaces 'already resolved elsewhere' rather than an error
                        (SyncConflictReviewScreen.tsx:96-106). A claim-check worth copying.
  * assignTableOrderScoped -- inside the checkout, which the COR-7 replay guard already
                        serialises; not a double-tap surface.
  * cash payout     -- round 139 FIXED (was: no dedupe at all)
  * refund          -- round 145 FIXED (was: bounded only by the cumulative total)

  * resolved-shortfalls retry -- PROTECTED, and the backend says so in its own words.
                        `shortfall_basket_key` (pos/checkout/replay.rs:84-115) hashes the
                        basket CONTENTS -- currency, total, discount and sorted lines --
                        and its docstring states why: "The resolved-shortfalls command
                        re-builds its cart from the request body under a SYNTHETIC
                        `resolved-<timestamp>` cart id that is regenerated on every submit,
                        so the cart id cannot anchor a re-key -- the basket CONTENTS can."
                        The UI does send `cartId: `resolved-${Date.now()}``
                        (StockShortfallDialog.tsx:353), which looks like a replay hole and is
                        not: the key ignores the id by design. Recorded round 179 so the next
                        sweep does not re-open it -- this entry sat unlisted for seven rounds
                        while the code already answered it.
  * shift open / close -- BOTH REFUSED BY CORE, and NEITHER reports it well. `open_shift`
                        counts the caller's open shifts under an IMMEDIATE transaction and
                        returns Validation "user already has an open shift"
                        (db/shifts.rs:95-107); `close_shift` refuses an already-closed shift
                        (:193-198). Both replays are therefore refused. What differs is the
                        catch: EodReportScreen.handleConfirmCloseShift routes through
                        l10nErrorMessage, so the second tap reported "failed to close" over a
                        shift that closed -- round 180 FIXED that with a ref. But
                        RetailPosScreen.handleOpenShift is a bare `catch {}` that discards the
                        error entirely (RetailPosScreen.tsx:1192-1193) and toasts only
                        `retail-toast-failed-open-shift`, so core's accurate "you already have
                        an open shift" never reaches the cashier either. Left on the report:
                        the message-not-the-guard is the defect there, and fixing it means
                        routing through l10nErrorMessage, not adding a ref.
  * staff soft-delete -- REFUSED, and the catch threw the reason away. `soft_delete_user`
                        compare-and-sets on `deleted_at IS NULL` (db/staff.rs:830-840) and
                        refuses with "this member is already in the trash";
                        StaffManagementScreen.confirmDelete was a bare `catch {}` toasting
                        `staff-delete-failed`, so a replay said the delete failed on a member
                        already gone from every list. Round 181 FIXED it with a ref. Note the
                        sibling `restore_user` / `restore_role` were fixed in round 153 with a
                        per-key ref Set -- the same backend fact showing up on both sides of
                        the same lifecycle, which is why this list names commands and not
                        screens.
  * tax rate create -- SILENT DUPLICATION, the other arm of this class. `tax_rates` carries
                        only `id TEXT PRIMARY KEY` (minted per call) and NO unique on `name`
                        (20260813_init.sql), and `create_tax_rate` is a plain INSERT inside a
                        transaction (db/tax/rates.rs:165-172) -- so the replay is NOT refused
                        and the store ends up with two rates the merchant cannot tell apart,
                        both selectable and both applicable to categories. Round 185 FIXED it
                        with a ref in `commitSave`, the single write tail shared by the
                        direct save and the tier-move continuation. Note the gate still lists
                        `confirmTierMove`, because the ref lives in the function it CALLS and
                        REF_GUARD_RE only reads the handler's own body -- a known limit of
                        this reader, not an unguarded path.
  * category tax rates -- IDEMPOTENT and left alone. `set_category_tax_rates` is
                        DELETE-then-`INSERT OR IGNORE` over a PRIMARY KEY
                        (category_id, tax_rate_id) (db/tax/assignments.rs:158-168), so a
                        replay writes the same set twice and the second is a no-op.
  * menu item create -- SILENT DUPLICATION, and NOT the products.sku guard. The entry above
                        refutes "products" on the strength of sku UNIQUE, which is right for a
                        typed sku and does not apply here: RestaurantMenuEditorScreen mints the
                        sku itself with generateMenuSku (menuEditorLogic.ts:39-48), a counter
                        plus Math.random(), so a replay makes a SECOND real product for the
                        same dish with a different sku -- nothing refuses it. Round 186 FIXED
                        handleSaveDraft with a ref; the case fails `expected 2 to be 1` with it
                        disabled. NOTE the existing refuted entry is about a sku the operator
                        chooses, not one the screen invents.
  * location ticket prefix -- idempotent write, reported wrong. set_location_ticket_prefix is
                        `UPDATE locations SET ticket_prefix = ?1 WHERE id = ?2`
                        (db/locations.rs:107-126), so a replay cannot corrupt the row; what it
                        CAN do is echo into the same `prefixSaved`, showing the operator the
                        value from the tap that lost, and report a save failure twice for a save
                        that landed. Round 186 FIXED handleSavePrefix with a ref.
  * stock transfer receive -- the entry above ("receive ... idempotent by DIFFERENCE")
                        answered the wrong question. It is idempotent when the transfer is
                        received PARTIALLY (received_qty >= previous_received_qty, only the
                        delta credited); it is REFUSED when the first call completed the
                        receipt, because receive_transfer only claims a status of
                        in_transit/received_partial (stock_transfers.rs:622-629, :733-743) --
                        so the replay lands in the catch as stock-transfers-error-receive, an
                        error banner over a receipt that succeeded. The "Confirm receipt"
                        button shows a spinner but is NOT disabled. Round 186 FIXED
                        handleReceive with a ref. The correction is the useful part: "idempotent
                        by difference" is a property of ONE status, not of the command.
  * split-bill confirm -- DOUBLE BILL. SplitBillModal.handleConfirm is a CALLBACK the parent
                        turns into a sale; a replay bills the same selected partition twice. Its
                        button's `state` only flips to 'processing' on the next render. Round 186
                        FIXED with a ref. Note the test needed the two clicks inside ONE `act()`:
                        outside it, react-testing-library wraps each `fireEvent` in its own act and
                        the first flush disables the button, so the ref mutation stayed green.
  * e-Faktur stamp -- a legally numbered field, replayed. Round 186 FIXED handleConfirmStamp
                        with a ref taken AFTER the 13-digit validation; and, in the same file,
                        handleExportCsv -- whose `if (csvExporting) return` was state only, so two
                        taps exported two files over the same download name.
  * purchase order receive -- REFUSED, and the worst catch of the class. receive_purchase_order
                        refuses any status other than 'approved' (db/purchase_orders.rs:383-388),
                        so the replay errors -- but on the On-Account path the FIRST call already
                        created the payable, so ReceivePoModal reported po-error-receive over a
                        receipt that landed AND a supplier debt that now exists. Round 186 FIXED
                        handleSubmit with a ref.
  * branch delete (TopologyScreen) -- the confirm button is `disabled={deleteBranchSaving}`,
                        and for a DISCRETE click React flushes the state update to the DOM before
                        the next click, so the second tap is on a really disabled button. Measured
                        round 186: the handler ran ONCE for two fireEvent.click()s, and a ref added
                        above it changed nothing -- a mutation that disabled the ref left the case
                        green, which is how the redundancy showed itself. The general rule this
                        sharpens: a handler whose BUSY FLAG is rendered as the trigger's `disabled`
                        is already gated by React's discrete-event flush; one whose trigger is only
                        `loading`/`state` styled needs a ref, because the second click lands before
                        the re-render. `<Button state="processing">` and `loading` DO disable, so
                        those are gated for the same reason -- check the component, not the call.
  * table move / merge -- the WORST replay shape found so far in the class. Move is
                        create-first/delete-second BY DESIGN (TableManagementScreen's own
                        comment explains why: a duplicate open bill is recoverable, a deleted
                        one is not), so a replay holds a SECOND copy of the bill under the
                        destination name before deleting the original -- the very duplicate the
                        ordering trades for, produced without any failure at all. Round 186 FIXED
                        both confirms with refs taken after every refusal.
  * money writes on a legacy/parallel path -- the four tabs of this list that resolve to a
                        CALLBACK rather than an IPC command (SplitBillModal's onConfirmSplit) are
                        where the money defect hides: the handler itself looks harmless and the
                        cost is in the parent.
  * bulk requeue (SyncConflictsPanel.handleRequeueAll) -- a LOOP, not one write: the replay
                        re-walks the same dead-letter list and restarts the progress bar at
                        1 of N mid-run. Round 187 FIXED with a ref; its case holds the FIRST
                        row's call open so the second walk cannot hide behind the first, and
                        asserts the per-row call SEQUENCE rather than a count -- a count of
                        two is what a correct single walk produces for two rows.
  * billing pause / resume (LicenseSettings) and the exit survey that confirms it -- TWO
                        handlers on ONE decision, so the survey needed its own ref even after
                        the card had one: onConfirm is a parent callback, and the survey's
                        feedback write was being sent twice as well (round 187).
  * license activation + the three email sign-in steps -- one screen, four commands. The
                        activation records a licence against the device fingerprint (refused
                        on replay, reported as a failure); a second Send code delivers a SECOND
                        one-time code, so the one the operator is reading stops matching
                        (round 187, each with its own ref).
  * installer (app/UpdateBanner.handleInstall) -- downloadAndInstall() downloads, installs
                        and RESTARTS, and it is preceded by a full database backup, so a
                        replay takes TWO backups and races two installers over one download
                        directory. Round 187 FIXED. Its two flags (installing/backingUp) are
                        two names for one handler: guarding either one alone measures
                        nothing.
  * SettingsPopup save button -- a SHARED DOOR over every settings form that hosts one. It
                        passed `disabled={saveDisabled}` into a Button that spread its own props
                        LAST, so the popup's `loading`-derived disabled was overridden: with a
                        host sending saveDisabled={false} (the tax rate and category dialogs do,
                        the moment a field is filled) the Save spun and stayed clickable. Round
                        188 FIXED both halves -- Button now spreads `...rest` before its derived
                        `disabled`, and the popup asks for `saving || saveDisabled`. NOTE the
                        mutation lesson: reverting EITHER half alone leaves the case green,
                        because the other half independently disables the button. A one-step
                        mutation here would have "proved" a working guard that was not there.
  * tax category assign -- DELETE-then-INSERT-OR-IGNORE over (category_id, tax_rate_id), so
                        the replay is harmless to the schema; the cost is the shared state (one
                        `savingCat`, a modal the first run already closed). Round 188 FIXED with
                        a ref, documented as the SECOND door beside the popup's disabled Save.
  * gift-card redeem -- the previous entry refuted "products" on `products.sku UNIQUE` and
                        then said gift-card REDEEM was protected by an explicit idempotency on
                        (card_id, sale_id). Both are true and neither is the whole answer: the
                        idempotency makes the SECOND CALL FOR THE SAME PAIR a no-op in the
                        database, while the component has already told the operator the card
                        was applied `amountToRedeem` twice through two `onApplied` calls. So the
                        money is safe and the SCREEN lies. Round 189 FIXED with a ref and a
                        case that fails `expected 2 to be 1` with it disabled. NOTE the component
                        is currently mounted by its own test only (git grep GiftCardPayment --
                        ui/src finds no production caller); the guard is in place for the day
                        the checkout reaches for it.
  * tax tier move (confirmTierMove) -- the LAST handler on this list, and the only one whose
                        guard was already correct. `commitSave` (its write tail) carries
                        `savePendingRef` from round 185, and this reader cannot see it because it
                        only reads a handler's OWN body. What round 189 added is an EARLY
                        refusal: without it the replay was refused in commitSave only AFTER
                        `setPendingTierMove(null)` had closed the consent dialog, so the second
                        tap dismissed the dialog and did nothing. The case that proves the path
                        drives the edit modal -> scope change -> Save -> ConfirmDialog and fails
                        `expected 2 to be 1` when commitSave's guard is mutated.
  * settings upserts (setStoreSettingsScoped, setHardwareSettingsScoped, ...) --
                        idempotent by construction: the same key is overwritten
The point of the list is that it is SHORT: filtering to handlers that (a) await something
other than a list/get read and (b) have a write-shaped name narrows ~143 raw busy-flag
sites to a handful. Two of the three in the first run were settings upserts -- idempotent
by construction -- which is exactly why the backend question cannot be skipped.
  * create_table     -- round 173 FIXED. NOT refused: a plain INSERT minting a fresh UUID
                        (tables.rs:146-153) against a DDL whose only key is `id TEXT
                        PRIMARY KEY` (20260813_init.sql:863) and no uniqueness on `name`, so
                        a replay writes a SECOND table. The handler already carried
                        `if (tableModalSaving) return` -- STATE, so it read the value from the
                        render that built the closure and let both submits through. Replaced
                        with a ref; the existing double-submit case fails `expected 2 to be 1`
                        with the ref disabled.
  * kasbon payment  -- round 173 FIXED, and the WORST arm: it double-counts MONEY rather than
                        misreporting. record_receivable_payment reads the receivable at
                        :242-247, computes new_paid at :272-279, and only THEN opens its
                        transaction at :300; its CAS matches status IN ('open','partial'),
                        which a PARTIAL payment leaves unchanged. So with a partial amount
                        BOTH calls pass the overpayment check and both INSERT a
                        receivable_payments row -- no error at all, the customer reads as
                        having paid twice. With the defaulted full balance the second is
                        refused by the CAS and then reported as 'Failed to record repayment'.
                        The core function cannot tell an instalment from a replay; the guard
                        lives in KasbonSettlementModal and
                        receivables_tests.rs::a_second_partial_payment_is_accepted_not_refused
                        pins the backend behaviour so a second caller knows it needs its own.
  * kasbon write-off -- round 173 FIXED. CAS `WHERE status IN ('open','partial')` ->
                        'written_off' (receivables.rs:381-394), so a replay is REFUSED and the
                        catch says 'Failed to write off receivable' over a write-off that landed.
  * record_receivable_payment / write_off / retry_offline_sync / requeue_remote_failure --
                        audited round 173. retry_offline_sync is SAFE: an empty queue returns
                        Ok(0,0,0,false) (bridge offline.rs:351-358) and a duplicate-id server
                        rejection is deliberately folded into success (sync_client.rs:120-133).
                        requeue_remote_failure's refusal is INTENTIONAL and documented
                        (remote.rs:181-195) but its catch shows a RAW error string and
                        handleRequeueAll aborts the remaining items -- a message-and-flow
                        defect, not corruption; left on the report.
  * setStockThreshold / deleteStockThreshold / setCategoryTaxRatesScoped /
    setLocationTicketPrefixScoped / updateTable / updateTerminal /
    setTerminalOverrideScoped -- audited round 173, all SAFE: same-row UPDATE, no-op DELETE,
                        DELETE+INSERT OR IGNORE, or ON CONFLICT DO UPDATE. registerTerminal
                        reuses the supplied UUID against `device_id UNIQUE` (init.sql:929) so
                        it IS refused, but `saving` is set before the first await and stops an
                        ordinary tap; latent, left on the report.

WHAT IT DOES NOT DO
It is a heuristic over text, not a type-aware analysis. It misses a guard written as
anything other than <name>Ref.current, and it does not read the backend at all. Treat the
output as a reading list, never as a finding.

USAGE
  python3 scripts/check-reentry-guards.py            # report, exit 0
  python3 scripts/check-reentry-guards.py --strict   # exit 1 on any candidate
"""

import argparse
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCAN_ROOT = os.path.join(ROOT, "ui", "src")
SKIP_DIRS = {"node_modules", "dist", "__tests__", "__mocks__"}

# setFoo(true); alone on a line -- the busy-flag set. A `setFoo(true)` inside an
# expression (a modal-open flag, an argument) is deliberately not matched.
BUSY_RE = re.compile(r"^\s*set([A-Z]\w*)\(true\);\s*$")
# The enclosing handler: `const name = useCallback(async (...` or `async function name(`.
HANDLER_RE = re.compile(r"const\s+(\w+)\s*=\s*(?:useCallback\(\s*)?(?:async\s*)?\(")
FUNCTION_RE = re.compile(r"(?:async\s+)?function\s+(\w+)")
# A ref read is the only guard this recognises -- see WHAT IT DOES NOT DO.
REF_GUARD_RE = re.compile(r"\w+Ref\.current")
AWAIT_RE = re.compile(r"\bawait\s+(\w+)\s*\(")
# Reads are not writes, so a handler that only re-reads cannot double-write.
READ_PREFIX = re.compile(r"^(list|get|load|refresh|fetch)", re.I)
# A write-shaped handler name, so a generic `handleConfirm` in a pure-read screen drops out.
WRITE_NAME = re.compile(
    r"(create|save|confirm|submit|issue|apply|void|refund|deactivate|delete|move|merge|bind|"
    r"clear|override|pause|resume|reset|activate|end|start|open|close|complete|sync|pull|"
    r"requeue|mark|stamp|send|receive|import|export|install|switch|rotate|adjust|post|"
    r"record|dispatch)",
    re.I,
)


def _enclosing_handler(lines, index):
    """Name and first line of the handler body enclosing `index`, best effort."""
    indent = len(lines[index]) - len(lines[index].lstrip())
    for n in range(index - 1, max(-1, index - 80), -1):
        stripped = lines[n].strip()
        if not stripped or stripped.startswith("//") or stripped.startswith("*"):
            continue
        this_indent = len(lines[n]) - len(lines[n].lstrip())
        if this_indent >= indent:
            continue
        m = HANDLER_RE.search(lines[n]) or FUNCTION_RE.search(lines[n])
        if m:
            return n, m.group(1)
        return None, None
    return None, None


def _handler_body(lines, start):
    """From the handler head to its dependency array (or EOF)."""
    body = []
    for n in range(start, len(lines)):
        body.append(lines[n])
        if n > start and re.match(r"^\s*\}, \[", lines[n]):
            break
    return "\n".join(body)


def scan_text(text):
    """Same logic as scan_file, on an in-memory string (used by --self-test)."""
    import tempfile
    with tempfile.NamedTemporaryFile(
            mode="w", suffix=".ts", delete=False, encoding="utf-8") as handle:
        handle.write(text)
        path = handle.name
    try:
        return scan_file(path)
    finally:
        os.unlink(path)

def scan_file(path):
    with open(path, encoding="utf-8", errors="replace") as handle:
        lines = handle.read().splitlines()
    found = []
    for i, line in enumerate(lines):
        m = BUSY_RE.match(line)
        if not m:
            continue
        start, name = _enclosing_handler(lines, i)
        if start is None:
            continue
        body = _handler_body(lines, start)
        if REF_GUARD_RE.search(body):
            continue
        awaited = AWAIT_RE.findall(body)
        writes = [a for a in awaited if not READ_PREFIX.match(a)]
        if not writes or not WRITE_NAME.search(name):
            continue
        found.append({
            "file": os.path.relpath(path, ROOT).replace(os.sep, "/"),
            "line": i + 1,
            "flag": "set%s" % m.group(1),
            "handler": name,
            "calls": ", ".join(sorted(set(writes))),
        })
    return found


def iter_sources(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if not name.endswith((".ts", ".tsx")):
                continue
            if ".test." in name or ".spec." in name:
                continue
            yield os.path.join(dirpath, name)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--strict", action="store_true", help="exit 1 on any candidate")
    parser.add_argument("--self-test", action="store_true", help="assert the matcher's shapes")
    args = parser.parse_args()
    if args.self_test:
        return self_test()

    findings = []
    for path in iter_sources(SCAN_ROOT):
        findings.extend(scan_file(path))

    if not findings:
        print("reentry-guards: 0 candidate(s) in ui/src")
    else:
        print("reentry-guards: %d write handler(s) whose only guard is a state flag."
              % len(findings))
        print("Each is a CANDIDATE, not a defect: the cost of the replay depends on the"
              " backend.")
        print("Ask first whether a unique index REFUSES it, then whether the UI still"
              " reports success.")
        print()
        for f in findings:
            print("  %s:%d  %s  in %s()  -> %s"
                  % (f["file"], f["line"], f["flag"], f["handler"], f["calls"]))
    return 1 if (args.strict and findings) else 0


def self_test():
    """Assert the matcher on the shapes that must and must not fire.

    The fixtures are deliberately the two shapes this script exists to tell apart, and
    the one that makes it safe: a ref-guarded handler must NOT be reported even though it
    is otherwise identical. Round 145 shipped a fix with the check but not the set; a
    matcher that only looked for the check would have called that guarded.
    """
    cases = [
        # (label, source, expected_count)
        ('unguarded write after await', 
         "const [saving, setSaving] = useState(false);\n"
         "const save = useCallback(async () => {\n"
         "  setSaving(true);\n"
         "  await createThing();\n"
         "  setSaving(false);\n"
         "}, []);\n", 1),
        ('ref-guarded write is not a candidate', 
         "const [saving, setSaving] = useState(false);\n"
         "const pendingRef = useRef(false);\n"
         "const save = useCallback(async () => {\n"
         "  if (pendingRef.current) return;\n"
         "  setSaving(true);\n"
         "  await createThing();\n"
         "  setSaving(false);\n"
         "}, []);\n", 0),
        ('a read-only handler is not a candidate', 
         "const [loading, setLoading] = useState(false);\n"
         "const load = useCallback(async () => {\n"
         "  setLoading(true);\n"
         "  await listThings();\n"
         "  setLoading(false);\n"
         "}, []);\n", 0),
        ('a write with no await cannot double-send', 
         "const [saving, setSaving] = useState(false);\n"
         "const save = useCallback(() => {\n"
         "  setSaving(true);\n"
         "  createThingSync();\n"
         "  setSaving(false);\n"
         "}, []);\n", 0),
    ]
    failures = 0
    for label, source, expected in cases:
        got = len(scan_text(source))
        if got != expected:
            failures += 1
            print("  FAIL %-40s expected %d, got %d" % (label, expected, got))
        else:
            print("  ok   %-40s (%d)" % (label, got))
    if failures:
        print("self-test: %d failure(s)" % failures)
        return 2
    print("self-test: all %d cases pass" % len(cases))
    return 0



if __name__ == "__main__":
    sys.exit(main())