#!/usr/bin/env sh
# Run the docs-auditor checkers' own self-tests.
#
# Nothing else runs them, and that cost twice in one session: check-nav-paths.py reported
# SELF-TEST WRONG (it read the live nav, so a screen rename broke it) and check-api-surface.py
# could not run at all after apps/desktop-client became apps/desktop-tauri. A checker that
# cannot run looks exactly like a checker that found nothing, which is the failure this step
# exists to catch. check-env-docs, check-ci-claims and check-nav-paths shipped first;
# check-dead-refs joined on 2026-09-24 with its source-relative resolution cases (the
# 2026-09-23 documentation audit, open item 3; +8 fragment cases the same day, 18
# total), check-adr-status the same day for open item 2 (status-word comparator; two
# of its cases are deliberately red), and check-site-links for open item 4
# (route-vs-filesystem resolution; its red cases are ghost routes, over-escaping above
# the locale root, empty targets, unmapped collections, out-of-config locales, and --
# since the fragment pass -- dead heading anchors, 27 cases). check-api-surface joined
# 2026-09-29 once its classification was split out of main() as a pure function, so its
# cases need no filesystem and survive the crate renames that silenced it once.
set -e
cd "$(git rev-parse --show-toplevel)"

# EXPLICIT CALLS, not a `for t in ...; do python3 ".../$t.py" --self-test; done` loop.
# The loop was correct and unreadable to every tool that audits wiring: a checker looking
# for "<name>.py --self-test" sees only the literal "$t.py", so verify-selftests-wired.py
# reported six of these eight as UNCALLED once its scope was widened to this directory.
# That was a false finding, and the fix could have been either side -- teach the auditor
# to read shell loops, or stop using one. This side is better: the list of self-tests is
# now greppable by a human and by any tool, and adding a checker means adding a line that
# names it, instead of editing a semicolon-separated string where a typo silently drops a
# case. Verified 2026-10-23: the same eight run, and the auditor now sees all eight.
python3 .agents/skills/docs-auditor/scripts/check-env-docs.py --self-test
python3 .agents/skills/docs-auditor/scripts/check-ci-claims.py --self-test
python3 .agents/skills/docs-auditor/scripts/check-nav-paths.py --self-test
python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py --self-test
python3 .agents/skills/docs-auditor/scripts/check-adr-status.py --self-test
python3 .agents/skills/docs-auditor/scripts/check-site-links.py --self-test
python3 .agents/skills/docs-auditor/scripts/check-api-surface.py --self-test
python3 .agents/skills/docs-auditor/scripts/check-cite-lines.py --self-test
python3 .agents/skills/docs-auditor/scripts/check-orphans.py --self-test
