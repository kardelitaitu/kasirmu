#!/usr/bin/env python3
"""
Process-Kill Simulation & SQLite WAL Recovery Verification
Roadmap: todo-beta-testing-january-2027.md (Phase 2.1 Fault Tolerance)

Simulates abrupt process termination (kill -9 / taskkill / TerminateProcess)
mid-transaction against an on-disk SQLite database running in WAL mode.
Verifies that:
1. The database suffers zero page corruption (PRAGMA integrity_check == 'ok').
2. Interrupted, uncommitted transactions are cleanly rolled back without orphan records.
3. Foreign key constraints remain 100% consistent (PRAGMA foreign_key_check is empty).
4. Committed transactions before the kill remain durable.
5. WAL recovery and checkpointing (PRAGMA wal_checkpoint(TRUNCATE)) succeed cleanly.
"""

import os
import sys
import time
import uuid
import sqlite3
import tempfile
import subprocess
from pathlib import Path

# Worker script code executed in child process
WORKER_CODE = """
import sys
import time
import sqlite3
import uuid

db_path = sys.argv[1]
conn = sqlite3.connect(db_path, timeout=10.0)
cursor = conn.cursor()

# Set production PRAGMAs
cursor.execute("PRAGMA journal_mode = WAL;")
cursor.execute("PRAGMA synchronous = NORMAL;")
cursor.execute("PRAGMA foreign_keys = ON;")

cursor.execute('''
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    total INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);
''')

cursor.execute('''
CREATE TABLE IF NOT EXISTS transaction_items (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    quantity INTEGER NOT NULL
);
''')

cursor.execute('''
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
''')
conn.commit()

tx_counter = 0
while True:
    tx_counter += 1
    tx_id = f"tx_{tx_counter}_{uuid.uuid4().hex[:8]}"
    
    # Begin transaction
    cursor.execute("BEGIN IMMEDIATE;")
    cursor.execute(
        "INSERT INTO transactions (id, total, status, created_at) VALUES (?, ?, ?, datetime('now'));",
        (tx_id, 150000, "COMMITTED")
    )
    
    # Insert 10 items with foreign keys
    for i in range(10):
        item_id = f"item_{tx_id}_{i}"
        cursor.execute(
            "INSERT INTO transaction_items (id, transaction_id, name, price, quantity) VALUES (?, ?, ?, ?, ?);",
            (item_id, tx_id, f"Product {i}", 15000, 1)
        )
        
    cursor.execute(
        "INSERT INTO audit_log (event, transaction_id, created_at) VALUES (?, ?, datetime('now'));",
        ("SALE_CREATED", tx_id)
    )
    
    # Notify parent that we are in flight
    sys.stdout.write(f"IN_TRANSACTION {tx_id}\\n")
    sys.stdout.flush()
    
    # Sleep small duration to maximize kill window during write/lock
    time.sleep(0.02)
    
    conn.commit()
    sys.stdout.write(f"COMMITTED {tx_id}\\n")
    sys.stdout.flush()
    
    time.sleep(0.01)
"""

def verify_db_integrity(db_path: Path, expected_committed: set, killed_tx_id: str) -> None:
    """Verifies that SQLite database recovers cleanly from dirty shutdown."""
    conn = sqlite3.connect(str(db_path), timeout=5.0)
    cursor = conn.cursor()
    
    # 1. PRAGMA integrity_check
    cursor.execute("PRAGMA integrity_check;")
    integrity = cursor.fetchall()
    assert integrity == [("ok",)], f"Integrity check failed: {integrity}"
    
    # 2. PRAGMA quick_check
    cursor.execute("PRAGMA quick_check;")
    quick = cursor.fetchall()
    assert quick == [("ok",)], f"Quick check failed: {quick}"
    
    # 3. PRAGMA foreign_key_check
    cursor.execute("PRAGMA foreign_key_check;")
    fk_violations = cursor.fetchall()
    assert len(fk_violations) == 0, f"Foreign key violations found: {fk_violations}"
    
    # 4. Atomicity check: the killed in-flight transaction MUST NOT exist
    if killed_tx_id:
        cursor.execute("SELECT COUNT(*) FROM transactions WHERE id = ?", (killed_tx_id,))
        count_tx = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM transaction_items WHERE transaction_id = ?", (killed_tx_id,))
        count_items = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM audit_log WHERE transaction_id = ?", (killed_tx_id,))
        count_audit = cursor.fetchone()[0]
        
        assert count_tx == 0, f"Killed transaction {killed_tx_id} partially committed in transactions table!"
        assert count_items == 0, f"Killed transaction {killed_tx_id} left {count_items} orphan items!"
        assert count_audit == 0, f"Killed transaction {killed_tx_id} left audit entries!"
        
    # 5. Durability check: all previously committed transactions must exist with exactly 10 items
    cursor.execute("SELECT id FROM transactions WHERE status = 'COMMITTED';")
    found_txs = {row[0] for row in cursor.fetchall()}
    for comm in expected_committed:
        assert comm in found_txs, f"Previously committed transaction {comm} missing after crash!"
        cursor.execute("SELECT COUNT(*) FROM transaction_items WHERE transaction_id = ?", (comm,))
        item_count = cursor.fetchone()[0]
        assert item_count == 10, f"Transaction {comm} has {item_count} items instead of 10!"

    # 6. Checkpoint recovery
    cursor.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    ckpt_result = cursor.fetchone()
    # (busy, log, checkpointed)
    assert ckpt_result[0] == 0, f"WAL checkpoint failed with busy status: {ckpt_result}"
    
    conn.close()

def run_simulation(iterations: int = 5) -> bool:
    print("=" * 70)
    print(" PROCESS-KILL SIMULATION & SQLITE WAL RECOVERY TEST")
    print(f" Iterations: {iterations} brutal terminations mid-transaction")
    print("=" * 70)

    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "chaos_wal_test.db"
        worker_py = Path(tmpdir) / "worker.py"
        worker_py.write_text(WORKER_CODE, encoding="utf-8")
        
        expected_committed = set()
        
        for cycle in range(1, iterations + 1):
            print(f"\\n--- Cycle {cycle}/{iterations}: Launching writer child process ---")
            proc = subprocess.Popen(
                [sys.executable, str(worker_py), str(db_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
            
            killed_tx = None
            in_flight = None
            
            try:
                # Read stdout lines from worker
                for line in proc.stdout:
                    line = line.strip()
                    if line.startswith("COMMITTED "):
                        tx_id = line.split(" ", 1)[1]
                        expected_committed.add(tx_id)
                        in_flight = None
                    elif line.startswith("IN_TRANSACTION "):
                        in_flight = line.split(" ", 1)[1]
                        # We caught it mid-transaction! Brutally terminate immediately!
                        print(f"  [Cycle {cycle}] Caught worker mid-transaction: {in_flight}")
                        print(f"  [Cycle {cycle}] Executing abrupt kernel termination (kill -9 / TerminateProcess)...")
                        proc.kill()
                        killed_tx = in_flight
                        break
            finally:
                proc.wait()
                
            print(f"  [Cycle {cycle}] Process terminated with exit code: {proc.returncode}")
            
            # Check WAL file exists
            wal_path = Path(str(db_path) + "-wal")
            if wal_path.exists():
                print(f"  [Cycle {cycle}] WAL file present: {wal_path.stat().st_size} bytes")
                
            # Verify SQLite WAL recovers cleanly
            print(f"  [Cycle {cycle}] Verifying recovery, integrity, and rollback consistency...")
            verify_db_integrity(db_path, expected_committed, killed_tx)
            print(f"  [Cycle {cycle}] PASSED! Zero corruption, 0 orphan records, committed data intact.")
            
    print("\\n" + "=" * 70)
    print(" ALL PROCESS-KILL WAL RECOVERY SIMULATION TESTS PASSED (100% OK)")
    print(f" Total verified brutal kills: {iterations}")
    print(" PRAGMA integrity_check: OK")
    print(" PRAGMA foreign_key_check: OK")
    print(" Atomic rollback of partial transactions: OK")
    print("=" * 70)
    return True

if __name__ == "__main__":
    success = run_simulation(5)
    sys.exit(0 if success else 1)
