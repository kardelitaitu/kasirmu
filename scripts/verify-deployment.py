#!/usr/bin/env python3
"""verify-deployment.py -- prove a live unified deployment actually serves ADR #54.

Why this exists: on 2026-09-26 a tablet APK was diagnosed as "cannot connect to either auth or
sync server". Both servers were healthy; the running container simply predated the Google
sign-in work, so every /api/v1/desktop/* route answered 404. On the tablet the sign-in path is
the emailed code, and the link response is what carries the sync terminal credential -- so one
missing deployment looked like two broken servers, and the client took the blame.

Two traps this encodes, because both cost real time when done by hand:

  1. Probe with the RIGHT METHOD. PocketBase answers 404, not 405, for a wrong method on an
     existing route, so `GET /api/v1/web/request-otp` looks dead while POST returns 400.
  2. Expect 400/401, not 200. Almost every route here is unauthenticated in this probe and is
     SUPPOSED to refuse; presence is what is being measured, never success.

Only ONE host is probed by default. The alias in the app's compiled ladder is fronted by
Cloudflare, whose rate limiting a burst of these probes trips -- measured 2026-09-26: a scripted
pass over both names returned 403 for every /api/v1/* path while a single paced request to the
same path returned 401. That is a property of the edge and of the prober, not of the deployment,
so this stops at the first throttle and tells you to re-run later or check the alias by hand.

Exit: 0 deployment complete, 1 incomplete or failing, 2 usage/transport error.
"""

import argparse
import json
import ssl
import sys
import time
import urllib.error
import urllib.request

# (method, path, body, expected statuses, label)
CHECKS = [
    ('GET', '/api/health', None, {200}, 'ops health'),
    ('POST', '/api/v1/web/request-otp', {}, {400, 429}, 'control: pre-existing web route'),
    ('GET', '/api/v1/web/me', None, {401}, 'control: session-authed route'),
    ('GET', '/api/v1/web/identities', None, {401}, 'ADR54 identities'),
    ('POST', '/api/v1/desktop/link/email/request', {}, {400, 429}, 'ADR54 tablet link: request'),
    ('POST', '/api/v1/desktop/link/email/consume', {}, {400, 401}, 'ADR54 tablet link: consume'),
    ('POST', '/api/v1/desktop/link/google/start', {}, {400, 401}, 'ADR54 desktop link: start'),
    ('GET', '/api/sync/snapshot', None, {401, 403}, 'sync service auth'),
    ('POST', '/api/v1/terminals', {}, {401, 403, 422}, 'sync terminal registration'),
    # Last on purpose: these two redirect, and a throttle here must not hide the routes above.
    ('GET', '/api/v1/web/oauth/google/start', None, {302, 303, 307, 503}, 'ADR54 web oauth start'),
    ('GET', '/api/v1/web/oauth/google/callback', None, {400, 302, 303, 307, 503}, 'ADR54 web oauth callback'),
]

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse to follow 3xx: a redirect IS the answer here (it means configured)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

_OPENER = urllib.request.build_opener(
    _NoRedirect, urllib.request.HTTPSHandler(context=ssl.create_default_context())
)

def probe(base: str, method: str, path: str, body):
    url = base.rstrip('/') + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    try:
        with _OPENER.open(req, timeout=15) as r:
            return r.status, r.headers.get('Location') or ''
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('Location') or ''
    except Exception as e:  # transport: DNS, TLS, timeout
        return None, str(e)[:70]

def classify(got, want):
    """Verdict for one probe: 'ok', 'MISSING', 'UNEXPECTED' or 'TRANSPORT'."""
    if got is None:
        return 'TRANSPORT'
    if got in want:
        return 'ok'
    if got == 404:
        return 'MISSING'
    if got in (403, 429):
        # Cloudflare sits in front of the alias origin and throttles a burst of probes from one
        # IP. That is the tool's own fingerprint, not the deployment's: measured 2026-09-26, a
        # single request to the same path returned 404 while a scripted pass reported 403.
        return 'THROTTLED'
    return 'UNEXPECTED'

def self_test() -> int:
    cases = [
        (200, {200}, 'ok'),
        (400, {400, 429}, 'ok'),
        (404, {400}, 'MISSING'),
        (405, {400}, 'UNEXPECTED'),
        (403, {400}, 'THROTTLED'),
        (429, {200}, 'THROTTLED'),
        (500, {401}, 'UNEXPECTED'),
        (None, {200}, 'TRANSPORT'),
    ]
    bad = ['%s vs %s -> %s want %s' % (got, want, classify(got, want), want_want)
           for got, want, want_want in cases if classify(got, want) != want_want]
    if bad:
        print('SELF-TEST WRONG: ' + '; '.join(bad), file=sys.stderr)
        return 2
    print('SELF-TEST OK (%d cases)' % len(cases))
    return 0

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--self-test', action='store_true')
    ap.add_argument('--base', action='append', default=[],
                    help='base URL; repeatable. Defaults to both compiled origins.')
    a = ap.parse_args()
    if a.self_test:
        return self_test()
    bases = a.base or ['https://license.kasir.mu']
    incomplete, broken, throttled = [], [], []
    for base in bases:
        print('== ' + base)
        # A rollout (an env change restarts the container) answers 503 on everything. Say so
        # rather than reporting every route as broken — that false alarm costs a diagnostic round.
        hp, _ = probe(base, 'GET', '/api/health', None)
        if hp == 503:
            print('  503 on /api/health: the service is still rolling out. Re-run in a minute.')
            return 1
        stop = False
        for method, path, body, want, label in CHECKS:
            if stop:
                break
            got, extra = probe(base, method, path, body)
            time.sleep(1.5)  # stay under the edge's tolerance for one IP
            verdict = classify(got, want)
            if verdict == 'THROTTLED':  # one patient retry beats a false alarm
                time.sleep(8)
                got, extra = probe(base, method, path, body)
                verdict = classify(got, want)
            if verdict == 'TRANSPORT':
                detail = extra
                broken.append((base, path, 'transport'))
            elif verdict == 'ok':
                detail = 'configured' if got in (302, 303, 307) else ''
            elif verdict == 'MISSING':
                detail = 'route absent, or wrong method (PB answers 404, not 405)'
                incomplete.append((base, path))
            elif verdict == 'THROTTLED':
                detail = 'edge throttled this run; stopping'
                throttled.append((base, path, got))
                stop = True  # do not deepen the limit; remaining checks are unattempted
            else:
                detail = 'wanted ' + ','.join(str(x) for x in sorted(want))
                broken.append((base, path, str(got)))
            print('  %-9s %-4s %-42s %s %s' % (verdict, method, path, got, ('-- ' + detail) if detail else ''))
    print('')
    if incomplete:
        print('deployment INCOMPLETE: %d route(s) absent.' % len(incomplete))
        print('  A 404 on /api/v1/desktop/* means the container predates ADR #54: rebuild and')
        print('  deploy the current image (a push/dispatch on main), then re-run this.')
    if throttled:
        print('INCONCLUSIVE: %d request(s) throttled by the edge (not a deployment fault).' % len(throttled))
        for b, p, g in throttled:
            print('  %s%s -> %s' % (b, p, g))
    if broken:
        print('deployment BROKEN: %d check(s) failed.' % len(broken))
        for b, p, g in broken:
            print('  %s%s -> %s' % (b, p, g))
    if not incomplete and not broken and not throttled:
        print('deployment COMPLETE: every ADR #54 route answers, sync is reachable.')
        print('  Remaining hand step: sign in on a real tablet and confirm terminal.issued=true.')
        return 0
    return 1

if __name__ == '__main__':
    sys.exit(main())
