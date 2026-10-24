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