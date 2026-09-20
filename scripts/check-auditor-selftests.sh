#!/usr/bin/env sh
# Run the docs-auditor checkers' own self-tests.
#
# Nothing else runs them, and that cost twice in one session: check-nav-paths.py reported
# SELF-TEST WRONG (it read the live nav, so a screen rename broke it) and check-api-surface.py
# could not run at all after apps/desktop-client became apps/desktop-tauri. A checker that
# cannot run looks exactly like a checker that found nothing, which is the failure this step
# exists to catch. Only these three ship a self-test today.
set -e
cd "$(git rev-parse --show-toplevel)"
for t in check-env-docs check-ci-claims check-nav-paths; do
  python3 ".agents/skills/docs-auditor/scripts/$t.py" --self-test
done
