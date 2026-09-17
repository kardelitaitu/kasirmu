#!/usr/bin/env python3
"""Apply targeted clippy lint fixes to crates/kasirmu-api/src/pg.rs."""
import pathlib

# Resolve the target from THIS script's location so it works from any
# checkout/worktree, not just a repository-root CWD.
path = pathlib.Path(__file__).resolve().parents[1] / "crates" / "kasirmu-api" / "src" / "pg.rs"
raw = path.read_bytes()
text = raw.decode("utf-8")

# Fix 1: b[7] == '-' -> b[7] == b'-'
old1 = "&& b[7] == '-'\n"
new1 = "&& b[7] == b'-'\n"
count = text.count(old1)
assert count == 1, f"Fix 1: expected 1 occurrence, found {count}"
text = text.replace(old1, new1, 1)
print("Fix 1: b[7] == '-' -> b[7] == b'-'")

# Fix 2: map_or(false, ...) -> is_ok_and(...)
old2a = ".map_or(false, |m| (1..=12).contains(&m))"
new2a = ".is_ok_and(|m| (1..=12).contains(&m))"
count = text.count(old2a)
assert count == 1, f"Fix 2a: expected 1 occurrence, found {count}"
text = text.replace(old2a, new2a, 1)
print("Fix 2a: map_or -> is_ok_and for month")

old2b = ".map_or(false, |day| (1..=31).contains(&day))"
new2b = ".is_ok_and(|day| (1..=31).contains(&day))"
count = text.count(old2b)
assert count == 1, f"Fix 2b: expected 1 occurrence, found {count}"
text = text.replace(old2b, new2b, 1)
print("Fix 2b: map_or -> is_ok_and for day")

# Fix 3: useless format! in list_latest_exchange_rates_pg
# This query has no format interpolation args, so format! is useless.
# tokio_postgres::ToStatement is implemented for both str and String.
old3 = """            &format!(
                "SELECT er.id, er.from_currency, er.to_currency, er.rate_millionths,
                        er.source, er.effective_date, er.created_at
                 FROM exchange_rates er
                 WHERE er.id = (
                     SELECT e2.id FROM exchange_rates e2
                     WHERE e2.from_currency = er.from_currency
                       AND e2.to_currency = er.to_currency
                     ORDER BY e2.effective_date DESC, e2.created_at DESC
                     LIMIT 1
                 )
                 ORDER BY er.from_currency, er.to_currency\"
            ),"""
new3 = """            "SELECT er.id, er.from_currency, er.to_currency, er.rate_millionths,
                        er.source, er.effective_date, er.created_at
                 FROM exchange_rates er
                 WHERE er.id = (
                     SELECT e2.id FROM exchange_rates e2
                     WHERE e2.from_currency = er.from_currency
                       AND e2.to_currency = er.to_currency
                     ORDER BY e2.effective_date DESC, e2.created_at DESC
                     LIMIT 1
                 )
                 ORDER BY er.from_currency, er.to_currency","""
count = text.count(old3)
assert count == 1, f"Fix 3: expected 1 occurrence, found {count}"
text = text.replace(old3, new3, 1)
print("Fix 3: remove useless format! in list_latest_exchange_rates_pg")

path.write_bytes(text.encode("utf-8"))
print("All fixes applied successfully.")
