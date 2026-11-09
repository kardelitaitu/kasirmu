#!/usr/bin/env python3
"""verify-deployment.py -- prove a live unified deployment actually serves ADR #54.

Why this exists: on 2026-09-20 a tablet APK was diagnosed as "cannot connect to either auth or
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
Cloudflare, whose rate limiting a burst of these probes trips -- measured 2026-09-20: a scripted
pass over both names returned 403 for every /api/v1/* path while a single paced request to the
same path returned 401. That is a property of the edge and of the prober, not of the deployment,
so this stops at the first throttle and tells you to re-run later or check the alias by hand.

Exit: 0 deployment complete, 1 incomplete or failing, 2 usage/transport error.
"""

import argparse
import contextlib
import http.server
import io
import json
import os
import socket
import ssl
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies its default temp (measured 2026-11-09 on the agent host: every
#: write into a TemporaryDirectory is EPERM) can point this at a directory it allows;
#: unset leaves tempfile's own default in force (the r166 contract).
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root this file's ladder fixtures are written under (None = system default).

    The makedirs is the r250 lesson: a scratch dir that was removed between runs
    otherwise makes EVERY fixture die with FileNotFoundError before it grades
    anything. exist_ok keeps the common case a no-op.
    """
    root = next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)
    if root:
        os.makedirs(root, exist_ok=True)
    return root


#: r166: the ladder's HTTP policy. The rungs grade main()'s VERDICT COMPOSITION
#: (which bucket each status lands in, what the summary says, which rc) and nothing
#: about pacing or retrying, so the 1.5s per-probe pace and the 8s throttle retry are
#: zeroed while a rung runs. Every rung body that touches this restores it in finally,
#: and self_test() puts it back before the ladder starts, so rung 5's nested self-test
#: cannot inherit a fixture's zeroed pace.
DEFAULT_PACING = (1.5, 8.0)  # per-probe pace, throttle retry
_LADDER_PACING = DEFAULT_PACING

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

#: The opener this tool actually probes with. It is a module-level BINDING rather
#: than a constant so the ladder's rungs can grade the redirect policy in isolation
#: (see _ladder_opener): _PROBE_OPENER is what main() always restores.
_PROBE_OPENER = urllib.request.build_opener(
    _NoRedirect, urllib.request.HTTPSHandler(context=ssl.create_default_context())
)
_OPENER = _PROBE_OPENER

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
        # IP. That is the tool's own fingerprint, not the deployment's: measured 2026-09-20, a
        # single request to the same path returned 404 while a scripted pass reported 403.
        return 'THROTTLED'
    return 'UNEXPECTED'


#: The redirect policy's own proof, in isolation from every other limb: a 3xx
#: must be answered, never followed. This is one leg of what the ladder grades.
def _ladder_redirect_policy() -> str:
    """'OK' when a 302 is an answer and not a follow, otherwise the reason it is not."""
    our = [h for h in _PROBE_OPENER.handlers if type(h).__name__ == '_NoRedirect']
    if not our:
        return 'the probe opener no longer installs _NoRedirect'
    if self_redirects(our[0]):
        return '_NoRedirect still returns a request: a 3xx would be followed'
    return 'OK'


def self_redirects(handler) -> bool:
    """True when the handler asks for a request, i.e. a 3xx would be followed.

    A REDIRECT IS THE ANSWER here (it means the route is configured), so
    _NoRedirect.redirect_request returning None is the whole contract.
    """
    return handler.redirect_request(None, None, 302, 'Found', {}, 'http://elsewhere') is not None


def _ladder_opener():
    """The opener a fixture rung probes with: the probe's OWN policy, no network leg.

    _PROBE_OPENER carries an HTTPSHandler built from an SSL context -- a leg a
    fixture must never depend on. A fixture opener installs the SAME _NoRedirect
    handler, the code whose behaviour is graded, over nothing else.
    """
    return urllib.request.build_opener(_NoRedirect)


def self_test() -> int:
    """r257: the cases, then the ladder. The classify() sweep runs first and is
    still MODULE-LEVEL -- it reads no file and opens no socket -- so a broken
    predicate fails before any loopback server is started."""
    global _OPENER, _LADDER_PACING
    _OPENER, _LADDER_PACING = _PROBE_OPENER, DEFAULT_PACING
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
    # RESTORED (r258): probe() is the only leg that leaves the process, and the
    # classify() cases above run on constants -- so a sweep that blanked the
    # prober was invisible to them (2026-11-06). These six cases are the ones
    # that notice: a dropped body/header, the HTTPError branch read as
    # transport (every expected-4xx route would misreport), a lost Location
    # header (the redirect IS the answer), and a transport error that raises
    # instead of returning (None, detail). They were present at HEAD and were
    # LOST when this self-test was reworked for the ladder -- measured before
    # restoring: all six assertions absent from the file. Graded against a
    # LOOPBACK http.server in a daemon thread: real HTTP, real sockets, no DNS,
    # no TLS, no external network.
    def want2(name, got, expect):
        if got != expect:
            bad.append('%s: expected %r, got %r' % (name, expect, got))

    seen = []  # (method, path, content_type, body) per request the server accepted
    RESP = {'/ok': (200, {'Location': 'http://x/there'}),
            '/missing': (404, {}),
            '/redirect': (302, {'Location': 'http://x/there'}),
            '/echo': (400, {})}
    srv = http.server.HTTPServer(('127.0.0.1', 0), type('H', (http.server.BaseHTTPRequestHandler,), {
        'log_message': lambda self, *a: None,
    }))
    def _one(self):
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length else b''
        seen.append((self.command, self.path, self.headers.get('Content-Type'), body))
        status, hdrs = RESP.get(self.path, (500, {}))
        self.send_response(status)
        for k, v in hdrs.items():
            self.send_header(k, v)
        self.end_headers()
    hcls = srv.RequestHandlerClass
    hcls.do_GET = _one
    hcls.do_POST = _one
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    n_net = 0
    try:
        base = 'http://127.0.0.1:%d' % srv.server_port
        want2('a 200 answers with its Location header', probe(base, 'GET', '/ok', None),
              (200, 'http://x/there')); n_net += 1
        got, extra = probe(base, 'POST', '/echo', {'x': 1})
        try:
            sent = json.loads(seen[-1][3].decode())
        except Exception:
            sent = '<unparseable>'   # a dropped body must NAME itself, not crash the case
        want2('a POST body travels as JSON with its Content-Type',
              (got, seen[-1][0], seen[-1][2], sent),
              (400, 'POST', 'application/json', {'x': 1})); n_net += 1
        before = len(seen)
        want2('a 404 arrives through the HTTPError branch', probe(base, 'GET', '/missing', None), (404, ''))
        want2('a trailing-slash base is rstripped, not doubled',
              (len(seen) == before + 1, seen[-1][1]), (True, '/missing')); n_net += 2
        want2('a redirect is the answer, never a follow', probe(base, 'GET', '/redirect', None),
              (302, 'http://x/there')); n_net += 1
        free = socket.socket()
        free.bind(('127.0.0.1', 0))
        dead = 'http://127.0.0.1:%d' % free.getsockname()[1]
        free.close()
        try:
            got, extra = probe(dead, 'GET', '/x', None)
            want2('an unreachable port reports transport, with the reason',
                  (got, bool(extra)), (None, True))
        except Exception as exc:
            bad.append('transport: expected (None, reason), got ' + type(exc).__name__)
        n_net += 1
    finally:
        srv.shutdown()
        srv.server_close()

    if bad:
        print('SELF-TEST WRONG: ' + '; '.join(bad), file=sys.stderr)
        return 2
    print('SELF-TEST OK (%d cases: %d pure + %d over a loopback HTTP server)' % (len(cases) + n_net, len(cases), n_net))
    if bad:
        print('SELF-TEST WRONG: ' + '; '.join(bad), file=sys.stderr)
        return 2
    return shell_ladder()


def _ladder_ledger():
    """The nested ladder skip's one-line record, in ONE indirection.

    One indirection, because a rung grades the skip by recording this call rather
    than by reading captured text: a nested self_test() prints after its own
    redirect has returned, so under an outer capture the line lands in the outer
    buffer, and under a file sink in the file -- measured both ways while writing
    rung 5. The ledger is what stays observable either way.
    """
    print('  (ladder re-entry from a nested --self-test: skipped)')


def main(argv=None, root=None) -> int:
    """r206: argv parameterized, the r166..r205 contract -- with one honest
    difference. This tool's evidence source is the --base URL it probes,
    not any checkout path: CHECKS are fixed route names appended to the
    caller's base, and the tool reads no repository file. So there is no
    CHECKOUT to redirect; the contract's load-bearing half HERE is explicit
    argv -- an in-process call must not inherit the caller's command line
    (with sys.argv still holding --self-test, a ladder call would recurse,
    not probe).

    r257: root does NOT resolve a repository path (there is none to resolve);
    it is the FIXTURE TREE the ladder's rungs are written under, and it is
    threaded to the only thing this tool scans that is not the network --
    probe()'s urllib opener, whose HTTPRedirectHandler is the scope through
    which any 3xx can reach the verdict. A fixture rung hands main() a
    protocol-only opener and restores the probe opener in finally, so a
    normal run never leaves the process."""
    ap = argparse.ArgumentParser()
    ap.add_argument('--self-test', action='store_true')
    ap.add_argument('--base', action='append', default=[],
                    help='base URL; repeatable. Defaults to both compiled origins.')
    a = ap.parse_args(argv)
    if a.self_test:
        return self_test()
    global _OPENER
    if _OPENER is not _PROBE_OPENER:
        _OPENER = _PROBE_OPENER
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
            pace, retry_after = _LADDER_PACING  # (1.5, 8.0) outside a ladder rung
            got, extra = probe(base, method, path, body)
            time.sleep(pace)  # stay under the edge's tolerance for one IP
            verdict = classify(got, want)
            if verdict == 'THROTTLED':  # one patient retry beats a false alarm
                time.sleep(retry_after)
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

_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard (the r228 pattern): rung 5 drives --self-test through argv
    from inside the ladder, and the self-test ends in this call."""
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        _ladder_ledger()
        return 0
    _LADDER_RUNNING = True
    try:
        return _shell_ladder_body()
    finally:
        _LADDER_RUNNING = False


def _shell_ladder_body() -> int:
    """r257: the root contract, graded on fixture deployments through main().

    This tool's evidence is a live service, so every rung answers a LOOPBACK
    http.server and never dials the default origin -- real HTTP, real sockets,
    no DNS, no TLS, no external network. What the rungs grade is main()'s
    VERDICT COMPOSITION: which bucket a status lands in, what the summary
    sentence says, which rc that earns, and -- in rung 1 -- that the one 404 it
    reports is the FIXTURE's route and nothing else is named.

    Rung 1 is a KILLING rung and it grades a VERDICT, not a refusal. Its fixture
    answers every route and 404s exactly one: /api/v1/desktop/link/google/start.
    The line it asserts, "deployment INCOMPLETE: 1 route(s) absent.", is one this
    checkout cannot print -- measured 2026-11-09 the real deployment answers all
    eleven routes and prints "deployment COMPLETE", and a main() whose FINDING
    half ignores the fixture prints COMPLETE here. The rung also requires the
    reported name to be the fixture's route and, as a negative, that no other
    verdict (TRANSPORT / BROKEN) appears. A ladder that only asserted rc 2 on a
    broken root would die at a refusal floor and grade no verdict at all.

    Rungs 2-5 are the sister verdicts: clean (rc 0 + COMPLETE), an unexpected
    status (rc 1 + BROKEN naming the status wanted), a rollout 503 (rc 1 + "still
    rolling out", nothing graded), and argv --self-test (rc 0 with both the
    SELF-TEST OK line and the nested-ladder-skipped line).

    SCOPE NOTE (measured while writing this): redirects are NOT graded through
    main() here. A test fixture whose opener is _NoRedirect answers its own 302
    with Location: the loopback base, so the client never follows it and main()
    reads 302-for-configured whether the handler refuses to follow or not. Rung
    6 grades that policy on the handler itself (_ladder_redirect_policy) instead
    of asserting a behaviour this harness cannot make observable end to end.
    """
    ANSWERS = {
        '/api/health': 200,
        '/api/v1/web/request-otp': 400,
        '/api/v1/web/me': 401,
        '/api/v1/web/identities': 401,
        '/api/v1/desktop/link/email/request': 400,
        '/api/v1/desktop/link/email/consume': 400,
        '/api/v1/desktop/link/google/start': 400,
        '/api/sync/snapshot': 401,
        '/api/v1/terminals': 401,
        '/api/v1/web/oauth/google/start': 302,
        '/api/v1/web/oauth/google/callback': 400,
    }

    def serve(overrides):
        """A loopback fixture answering the overridden CHECKS paths (default 404)."""
        resp = dict(ANSWERS)
        resp.update(overrides)
        srv = http.server.HTTPServer(('127.0.0.1', 0), type('H', (http.server.BaseHTTPRequestHandler,), {
            'log_message': lambda self, *unused: None,
        }))
        def _one(self):
            length = int(self.headers.get('Content-Length') or 0)
            if length:
                self.rfile.read(length)
            self.send_response(resp.get(self.path, 404))
            self.end_headers()
        hcls = srv.RequestHandlerClass
        hcls.do_GET = _one
        hcls.do_POST = _one
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return srv, 'http://127.0.0.1:%d' % srv.server_port

    def run_over(overrides, fixture_root_dir):
        """main() against one fixture deployment, verdict captured, scope restored."""
        global _OPENER, _LADDER_PACING
        srv, base = serve(overrides)
        saved_opener, saved_pace = _OPENER, _LADDER_PACING
        _OPENER, _LADDER_PACING = _ladder_opener(), (0.0, 0.0)
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
                rc = main(argv=['--base', base], root=fixture_root_dir)
        except SystemExit as se:
            rc = se.code
        finally:
            _OPENER, _LADDER_PACING = saved_opener, saved_pace
            srv.shutdown()
            srv.server_close()
        return rc, out.getvalue()

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: ONE 404, and the verdict is the fixture's.
        rc, said = run_over({'/api/v1/desktop/link/google/start': 404}, tmp)
        if (rc != 1 or 'deployment INCOMPLETE: 1 route(s) absent.' not in said
                or said.count('/api/v1/desktop/link/google/start') < 1
                or 'deployment COMPLETE' in said
                or '  TRANSPORT' in said or '  BROKEN' in said):
            print('  x rung 1: a fixture with one 404 must read "deployment INCOMPLETE: '
                  '1 route(s) absent." naming the fixture route (rc=%r said=%r)'
                  % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- the clean arm: every route answered, exit 0.
        rc, said = run_over({}, tmp)
        if rc != 0 or 'deployment COMPLETE: every ADR #54 route answers' not in said:
            print('  x rung 2: a fully answering fixture must read COMPLETE rc 0 '
                  '(rc=%r said=%r)' % (rc, said[-300:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- a status no check wanted is BROKEN, and the detail names what it wanted.
        rc, said = run_over({'/api/v1/web/identities': 500}, tmp)
        if (rc != 1 or 'deployment BROKEN: 1 check(s) failed.' not in said
                or 'wanted 401' not in said or 'deployment COMPLETE' in said):
            print('  x rung 3: an unexpected status must read BROKEN rc 1 naming '
                  '"wanted 401" (rc=%r said=%r)' % (rc, said[-300:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- a rollout is named, not graded: 503 on health stops the sweep.
        rc, said = run_over({'/api/health': 503}, tmp)
        if (rc != 1 or 'still rolling out' not in said or ' ok  ' in said
                or 'deployment COMPLETE' in said):
            print('  x rung 4: a 503 rollout must be named and stop the sweep '
                  '(rc=%r said=%r)' % (rc, said[-300:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5 -- argv --self-test: its predicates pass, and self_test() ends at the
        # ladder through the re-entry guard instead of running a second copy.
        #
        # Graded on the LEDGER plus the exit code, and that is measured, not stylistic.
        # Everything a nested self_test() prints AFTER its redirect returns is written
        # to the stream that was installed when the OUTER capture went up (a StringIO
        # parent receives the skip line and not the summary; the CLI, with no parent
        # capture, receives both), so no capture inside a rung can witness the nested
        # run's text. What is witnessable is the thing this rung protects: the guard
        # fired exactly once, so no second ladder ran.
        global _OPENER, _LADDER_PACING
        # A LIST that already exists at module level, appended to -- not a local
        # captured by the probe. MEASURED: a local assigned here but read by a
        # nested probe is a module-scope name inside the probe, so the append lands
        # on the MODULE's list while this frame's own list stays empty, and the rung
        # reads the empty one. The module attribute is the only binding both frames
        # agree on.
        ledger_calls = globals().setdefault('_LEDGER_CALLS', [])
        del ledger_calls[:]
        real_ledger = globals()['_ladder_ledger']
        def _ledger_probe():
            ledger_calls.append('skipped')
        globals()['_ladder_ledger'] = _ledger_probe
        own_stdout, own_stderr = sys.stdout, sys.stderr
        saved_opener, saved_pace = _OPENER, _LADDER_PACING
        try:
            with contextlib.redirect_stdout(io.StringIO()), \
                    contextlib.redirect_stderr(io.StringIO()):
                rc = main(argv=['--self-test'])
        except SystemExit as se:
            rc = se.code
        finally:
            _OPENER, _LADDER_PACING = saved_opener, saved_pace
            globals()['_ladder_ledger'] = real_ledger
            # A nested run leaves ITS stream installed; this rung restores the one it
            # was entered with, so it never silently lends main() a closed buffer.
            sys.stdout, sys.stderr = own_stdout, own_stderr
        if rc != 0 or ledger_calls != ['skipped']:
            print('  x rung 5: --self-test through argv must pass rc 0 and skip the nested '
                  'ladder exactly once (rc=%r ledger=%r)' % (rc, list(ledger_calls)),
                  file=sys.stderr)
            return 1
        shell += 1

    policy = _ladder_redirect_policy()
    if policy != 'OK':
        print('  x rung 6: ' + policy, file=sys.stderr)
        return 1
    shell += 1
    print('SELF-TEST OK (%d pure classify() cases; %d fixture-deployment shell cases over a '
          'loopback HTTP server; the redirect policy graded on its handler)' % (8, shell))
    return 0


if __name__ == '__main__':
    sys.exit(main())
