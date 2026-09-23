#!/usr/bin/env sh
# Run the docs-auditor checkers' own self-tests.
#
# Nothing else runs them, and that cost twice in one session: check-nav-paths.py reported
# SELF-TEST WRONG (it read the live nav, so a screen rename broke it) and check-api-surface.py
# could not run at all after apps/desktop-client became apps/desktop-tauri. A checker that
# cannot run looks exactly like a checker that found nothing, which is the failure this step
# exists to catch. check-env-docs, check-ci-claims and check-nav-paths shipped first;
# check-dead-refs joined on 2026-09-24 with its source-relative resolution cases (the
# 2026-09-23 documentation audit, open item 3), check-adr-status the same day for
# open item 2 (status-word comparator; two of its cases are deliberately red), and
# check-site-links for open item 4 (route-vs-filesystem resolution; its red cases are
# ghost routes, over-escaping above the locale root, empty targets, unmapped
# collections and out-of-config locales).
set -e
cd "$(git rev-parse --show-toplevel)"
for t in check-env-docs check-ci-claims check-nav-paths check-dead-refs check-adr-status check-site-links; do
  python3 ".agents/skills/docs-auditor/scripts/$t.py" --self-test
done
