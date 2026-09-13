#!/usr/bin/env python3
"""Fail when production code calls an ambient IPC command that the desktop shell does not register.

WHY THIS EXISTS

`scripts/ipc-parity-allowlist.json` records, per shell, "UI command strings not yet registered in
that shell". The file cannot distinguish two very different situations that look identical in a
list:

  * a wrapper called only from the `else` branch of an ADR #7 conditional, which is dead surface on
    that shell and harmless, and
  * a wrapper called unconditionally, which throws `command not found` at runtime on that shell.

Round 66 found the second case filed as accepted debt: `get_cart_deduction_location` was allowlisted
for desktop while `PosScreen` called it unconditionally, so every desktop sale started with a
stock-target item threw and then reported the already-created cart as a failure. Round 67 found a
second one -- `getSale(result.saleId)` in PaymentModal's shortfall-retry callback -- which had been
missed days earlier by a fix that searched for the literal text `getSale(saleResult.saleId)` and so
never matched the site whose parameter was named `result` instead of `saleResult`. **Two sites, one
bug class, and a literal-string search that looked complete.** That is the gap this gate closes.

HOW IT DECIDES

For each command the allowlist says a shell does not register, find the TS wrapper that invokes it,
find every production call site, and ask whether that call sits in an ADR #7 conditional -- the
established `sessionToken ? xScoped(token, ...) : x(...)` shape (see useProducts.ts). Guarded is
accepted; unguarded is a violation, because the call will run on that shell with no token check.

WHICH ENTRY SHAPES IT READS

An allowlist member is normally a bare command name. scripts/verify-ipc-parity.py -- the gate
that validates and writes that file -- also accepts the object form {"name": ..., "reason": ...}
in the two sections nothing outside it reads, "dev_mock" and "scoped_orphans". This reader takes
both shapes there and the bare shape only in "desktop" and "tablet", because that validator
refuses an object in a shell section and names this script as its reason; the two gates have to
agree about what the file may contain. A member that cannot become a command name fails this
gate with a sentence naming the section, the entry's position and the value found -- never a
traceback, and never a quiet skip.

Above the entries sits the file itself, and that needed a guard of its own: a body that
parses as JSON but is not a dict keyed by shell -- "{}", or {"entries": []} -- used to read
as an allowlist with nothing in it, so the gate walked the whole tree, compared zero command
names and exited 0, while a top-level list died in an uncaught AttributeError. Require the
dict and the section --shell names, and refuse what is left, is now the first thing done to
a parsed allowlist.

One level in from that guard sits the shell list itself, and it needed its own refusal: the
list drives WHICH section the guard above is allowed to ask about, so `--shell ''` named none,
left the guard nothing to demand, walked 568 files, compared zero commands and exited 0
printing `clean for .`. resolve_shells() refuses it before the walk -- with no shell named
there is nothing to grade, and a caller who wants every shell passes them explicitly
(--shell desktop,tablet) rather than leaving the value blank for this gate to guess at.
Comments are stripped before matching. Without that, prose mentioning `getSale()` reads as a call
site -- which is exactly the false positive this script's own first draft produced against a
comment written by the fix that missed the real site.

usage:
    python scripts/verify-scoped-reads.py                # check the tree
    python scripts/verify-scoped-reads.py --self-test    # classifier + entry-shape reader
    python scripts/verify-scoped-reads.py --allowlist PATH  # grade PATH instead of the
                                                       # checkout copy (F-1 seam)
"""
import argparse
import io
import json
import os
import re
import sys
import tempfile
import time

# F-2, STILL OPEN IN THIS FILE, stamped with the reproduction so the next reader does not
# have to rebuild the temp directory. The root below comes from __file__, and that is NOT
# a reasoned refusal of git rev-parse --show-toplevel: nothing in this script argues for
# the script-relative anchor, so do not read the assignment below as a decision. It is the
# default this file shipped with, and the default fails in a direction nobody can notice.
# Measured 12:46, against a HEAD-identical copy of this script sitting in a temp directory
# beside a copy of the allowlist, run with nothing rebound and no fixture at all:
#   python3 $TMP/oz-headcopy/scripts/verify-scoped-reads.py    -> exit 0
#   verify-scoped-reads: clean for desktop.
#   REPO -> $TMP/oz-headcopy ; ui/src exists? False ; files walked: 0 ; violations: 0
# A gate whose default on an empty corpus is clean will report a repository it is not
# looking at. The closure is being taken in scripts/verify-agents-mirrors.py -- git first,
# script-relative only when git cannot answer, and a refusal when the walk yields nothing.
# This file has the same anchor and is not part of that change. main() now prints the
# corpus size and the allowlist it graded on every run, so a zero walk is at least visible
# in the log; what is still missing is the refusal that turns a visible zero into a red.

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWLIST = os.path.join(REPO, "scripts", "ipc-parity-allowlist.json")

# WHO DECIDES AN ENTRY SHAPE, written where the rule is read rather than in a commit
# message from whichever lane noticed the drift last.
#
# scripts/ipc-parity-allowlist.json is validated and written by scripts/verify-ipc-parity.py,
# and that file -- not this one -- owns the answer to "may an entry be an object
# {"name": ..., "reason": ...} instead of a bare command name?". Its answer is two tuples:
# OBJECT_ALLOWED_SECTIONS ("dev_mock", "scoped_orphans" -- read by nobody outside that
# script) and EXTERNALLY_READ_SECTIONS ("desktop", "tablet" -- read by this one), and its
# refusal for an object in a shell section names THIS script as the reason. So the policy
# is mirrored below, not reinvented: a member this reader refuses has to be a member that
# validator refuses too, or the two gates disagree about what the file may contain and
# neither says which of them is wrong. If that file ever moves desktop or tablet into the
# allowed tuple, move the tuple below in the same change.
OBJECT_ALLOWED_SECTIONS = ("dev_mock", "scoped_orphans")

# What is NOT delegated to the other gate is the crash. Reading a section used to hand
# every member straight to a dict lookup, so one object member came out as
# "TypeError: cannot use 'dict' as a dict key" after the whole UI tree had been walked --
# no section, no index, no file name, and nothing to tell the operator that a second gate
# had just blessed that exact entry. Both halves live here now: read the shapes a section
# is allowed to hold, and refuse the rest in a sentence. A member is never quietly dropped
# either -- an allowlist entry that stops matching anything turns "clean" into a lie.

# THE SAME FILE IS ALSO A RACE, and this is the other half of reading it correctly.
# verify-ipc-parity.py is the only writer, and it publishes with os.replace -- atomic for
# a reader, not invisible: mid-swap Windows denies the open. Measured on the writer's side
# at 252 PermissionError denials out of 30,461 bare io.open calls of this path, and this
# script had no handler at all, so one denial in the microsecond of someone else's reseed
# reds a bare run in dev-ci.yml#static-gates and scripts/check.sh with a traceback that
# names neither the file nor the race. The numbers, the ceiling and the interval are the
# writer owner's (READ_ATTEMPTS / READ_RETRY_SECONDS there, matching values here): a
# denial that has already passed costs one sleep, and a real, persistent lock ends in a
# sentence naming the path and how many times it was tried.
READ_ATTEMPTS = 50
READ_RETRY_SECONDS = 0.001

# Where this gate is run with no flags, which is where a denial used to become a red build.
# Named once so the sentence below and the case that checks it cannot drift apart.
READER_RUNS_BARE_AT = ("dev-ci.yml:596", "scripts/check.sh:72")


class AllowlistUnreadable(RuntimeError):
    """The allowlist would not open, so there is no verdict to report -- clean or dirty."""


class AllowlistWrongShape(AllowlistUnreadable):
    """The bytes opened and parsed as JSON; the JSON is not an allowlist.

    A subclass on purpose: main() keeps ONE handler, so the gate keeps ONE voice --
    `error: <sentence>` on stderr, exit 2 -- while a reader can still tell "the bytes
    would not arrive" from "the bytes are not an allowlist". Nothing about the busy-file
    arm changes and no except clause widens: a denial still raises the parent, and this
    class is raised only where a parsed object is already in hand.

    Exit 2 and not 1, because 1 is this gate's VERDICT code -- the two FAIL lines at the
    end of main() -- and a shape this gate never read is not a claim about anybody's
    call sites. That is the same split the writer gate keeps for this file at its
    AllowlistUnusable, landed here at e931220d9a.
    """


class AllowlistUndecodable(AllowlistUnreadable):
    """The bytes arrived; this reader's decoder cannot turn them into text.

    A subclass on purpose, exactly as AllowlistWrongShape is one: main() keeps ONE handler,
    so the gate keeps ONE voice -- `error: <sentence>` on stderr at exit 2, never the
    verdict code 1 -- and no traceback escapes `sys.exit(main())` over a file this script
    happens not to decode. The name says which
    of the two a reader is looking at: AllowlistUnreadable means the bytes would not
    arrive, this means they arrived and are not UTF-8. Nothing widens an except clause and
    nothing here is retried -- a decode failure is a property of the bytes on disk, like a
    bad parse, and unlike a denial it cannot clear on its own.
    """


class NoShellsNamed(AllowlistUnreadable):
    """--shell resolved to an empty list, so there is nothing here for this gate to grade.

    A subclass on purpose, exactly as AllowlistWrongShape and AllowlistUndecodable are one:
    main() keeps ONE handler, so the gate keeps ONE voice -- `error: <sentence>` on stderr
    at exit 2 -- and no except clause widens and no second handler is invented. This is a
    refusal by the same law as the others: a run that names no shell graded nothing, and
    nothing is not the verdict 1. The name says which of
    the refusals a reader is looking at: nothing about the file on disk went wrong here, the
    ARGUMENT asked for no shell.

    This is the empty-corpus class one level further in than the shape guard, and the shape
    guard cannot catch it by construction: a refusal needs a named section before a shape can
    be asked of it. Measured at tip dd4888194, `--shell ''` exited 0 printing
    `verify-scoped-reads: clean for .` -- 568 files walked, zero command names compared, and
    require_allowlist_shape cleared the run because an empty list handed to it falls back to
    asking for sections that are both present.
    """


def _read_json(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def read_allowlist(path=ALLOWLIST, opener=None):
    """The parsed allowlist, waiting out the microsecond a rename is mid-flight.

    `opener` is the seam that lets --self-test inject a denial instead of losing an hour
    trying to lose a race; production callers leave it None and get the real read.
    Raises AllowlistUnreadable -- never a bare PermissionError escaping this function --
    so main() can print a sentence and fail, rather than traceback over a file that was
    busy for one millisecond.

    ORDER, and why: exists, then isdir, both BEFORE the retry loop; a bad parse inside
    it. On Windows opening a directory raises PermissionError, the same exception a busy
    file raises (measured: --allowlist scripts printed "another process is holding it"
    with nothing holding anything), and a nonexistent path raises FileNotFoundError, so
    both are settled by asking the path what it is rather than by opening it -- a fact
    about the argument, knowable without reading, and wrong to time. A denial and a bad
    parse are facts about the READ, so they stay in the loop, and only the denial is
    retried, because only a denial can clear on its own. The busy sentence below is
    therefore reserved for a sharing violation on a file that exists.
    """
    opener = opener or _read_json
    if not os.path.exists(path):
        raise AllowlistUnreadable(
            f"{path} does not exist, so there is no allowlist to grade. --allowlist names "
            f"the file to read; with no flag this gate reads {ALLOWLIST} (the module "
            f"default).") from None
    if os.path.isdir(path):
        raise AllowlistUnreadable(
            f"{path} is a directory, not an allowlist file. Not retried: on Windows "
            f"opening a directory raises PermissionError, which is the error a busy file "
            f"raises, so retrying would blame a mistyped path on a process that is not "
            f"running.") from None
    for attempt in range(READ_ATTEMPTS):
        try:
            return opener(path)
        except PermissionError:
            if attempt + 1 == READ_ATTEMPTS:
                raise AllowlistUnreadable(
                    f"{path} would not open after {attempt + 1} tries (PermissionError); "
                    f"another process is holding it. This gate only reads that file: "
                    f"scripts/verify-ipc-parity.py owns the writer, and its os.replace is the "
                    f"window being waited out. It is run bare at "
                    f"{', '.join(READER_RUNS_BARE_AT)}, so a red here may be a busy file "
                    f"rather than a broken tree.",
                ) from None
            time.sleep(READ_RETRY_SECONDS)
        except json.JSONDecodeError as exc:
            # Caught by name, not as a bare Exception: this is one specific failure of the
            # bytes, and swallowing ValueError would also swallow a decoder bug. Not
            # retried, because a file that parses as neither is not racing anybody -- the
            # writer publishes with os.replace, which is atomic, so a half-written
            # allowlist is not a thing this loop can wait out.
            raise AllowlistUnreadable(
                f"{path} is not valid JSON: {exc}. Not retried: the writer publishes with "
                f"os.replace, which is atomic, so a half-written file is not what this "
                f"is.") from None
        except UnicodeDecodeError as exc:
            # Caught by name, as the arm above is, for the same reason: swallowing ValueError
            # would also swallow a decoder bug. This one is NOT called a bad parse, because it
            # is not one -- the bytes may be perfectly good JSON written in another encoding (a
            # UTF-16 file raises here, before a single character reaches json.load), and this
            # gate's job is to say plainly that it cannot read the file, not to transcode the
            # world by guessing at a codec. Not retried: like a bad parse, these bytes are a
            # property of the file rather than a race with the writer, so waiting out 50 tries
            # changes nothing but the runtime of the red.
            raise AllowlistUndecodable(
                f"{path} cannot be decoded as UTF-8 by this gate: {exc}. Not retried, and not "
                f"a verdict on the file -- it may be valid JSON in an encoding this reader will "
                f"not guess. scripts/verify-ipc-parity.py owns that file and writes it as UTF-8;"
                f" if you aimed --allowlist at something else, aim it at a UTF-8 copy.") from None
    raise AssertionError("unreachable")  # every path above returns or raises


# The two sections a wrong-shape file has to be measured against, named here rather than
# written twice: they are the shells -- and so the top-level keys -- this gate is ever run
# against, "desktop" by build_argparser's default and "tablet" by anyone passing --shell.
# The file carries "_"-prefixed comment keys beside them ("_comment", "_dev_mock_comment",
# "_scoped_orphans_comment"), which is why the guard below cannot census the whole object
# and asks only for the key the loader reaches for.
SHELL_SECTIONS = ("desktop", "tablet")


def require_allowlist_shape(allow, shells, path=ALLOWLIST):
    """Refuse an allowlist that parses as JSON but is not shaped like one.

    WHY THIS EXISTS -- four bodies aimed at this gate with --allowlist, measured at tip
    226d7268f0 against a HEAD copy in a temp directory (so the walk found 0 files and every
    number below is the whole of what was graded):

        {}              -> exit 0, "clean for desktop", 0 names compared
        {"entries": []} -> exit 0, "clean for desktop", 0 names compared
        not json        -> refused by the JSONDecodeError arm above (a89f1f12d)
        [{"a": 1}]      -> uncaught AttributeError: 'list' object has no attribute 'get',
                           escaping sys.exit(main())
    (measured before those arms existed, when every one of them left at exit 1; a refusal
    now leaves at 2, so none of these four is a verdict code any more). And the fifth row
    is the one membership could not catch, measured here before this change and refused at
    the read site after it:

        {"desktop": "abc"} -> cleared require_allowlist_shape, walked 612 files, THEN
                              reported one unreadable member at exit 1 -- a refusal
                              printed as a finding, one second late and one door too far

    The last two are loud, and loud is survivable: a traceback is ugly but nobody reads it
    as a pass. The first two are the hazard. `allowlist_names` reads a section with
    `payload.get(section)` and returns [] when the key is missing -- a correct answer for
    "this shell has no gaps recorded" and an indistinguishable one for "this is not an
    allowlist at all" -- so a dict of foreign keys walks 568 production files, compares zero
    commands, and prints a verdict. That is the empty-corpus class closed in the sibling
    gates tonight, c1fa2d0f9 and 1f7c2311c: a gate that graded nothing has no verdict, and
    the refusal has to cost the operator something.

    WHAT IT ASKS FOR is read off the live loader rather than guessed: a top-level dict, plus
    the key `allowlist_names` actually reaches for, which is the section named by --shell
    ("desktop" unless told otherwise). A section that is present but empty stays legal --
    "no gap is recorded for this shell" is a claim the gate can check, and it is what a
    fully migrated shell looks like; "this key is absent" is a type error in the input. So
    the guard checks membership, never length, and never the "_"-prefixed comment keys.

    Raises AllowlistWrongShape (an AllowlistUnreadable, so main()'s one refusal prints it);
    it never appends to a list and carries on, because the thing being refused here is a run
    that carries on.
    """
    filename = os.path.basename(path)
    wanted = [s for s in shells if s] or list(SHELL_SECTIONS)
    want = " and ".join(f'"{s}"' for s in wanted)
    if not isinstance(allow, dict):
        got = type(allow).__name__
        raise AllowlistWrongShape(
            f'{filename} parses as JSON but its top level is a {got}, not an object, and a '
            f'{got} has no .get for this gate to read a section with. It wanted an allowlist '
            f'-- a JSON object keyed by {want}, the section{"s" if len(wanted) > 1 else ""} '
            f'--shell names -- and got a {got}. Run python3 scripts/verify-ipc-parity.py to '
            f'see that shape written by something that validates it.')
    # Present-but-wrong-typed is refused HERE, not discovered in allowlist_names after the
    # walk. Membership alone was not enough: a section holding a scalar cleared this guard,
    # walked 612 production files, and only then reported a member it could not read --
    # under the VERDICT exit code, sitting beside the findings. And allowlist_names iterates
    # whatever it is handed, so a string section answers one bogus name per character. A
    # section that is not a list holds nothing this run can grade, so it ends the run here.
    # Stated-empty stays the claim case 8 protects: [] IS a list, and a zero-entry list is a
    # shell recording no gap -- this gate checks that claim, it never refuses it.
    Q = chr(34)
    mistyped = [s for s in wanted if s in allow and not isinstance(allow[s], list)]
    if mistyped:
        raise AllowlistWrongShape(
            filename + ' parses as JSON and carries the '
            + ('sections' if len(mistyped) > 1 else 'section')
            + ' this gate reads, but '
            + ', '.join(Q + s + Q + ' is a ' + type(allow[s]).__name__
                        for s in mistyped)
            + ', not a list of command names. Nothing can be read out of that, so this run '
              'refuses before walking the tree: a section that is not a list compares zero '
              'command names and the run would still print a verdict. An allowlist is a JSON '
              'object keyed by ' + want + ', each section a list -- an EMPTY list is allowed, '
              'it is the claim that this shell records no gap.')
    absent = [s for s in wanted if s not in allow]
    if absent:
        keys = sorted(str(k) for k in allow)
        found = ("a " + str(len(keys)) + "-key object: "
                 + ", ".join(f'"{k}"' for k in keys)) if keys else "an empty object"
        missing = " and ".join(f'"{s}"' for s in absent)
        raise AllowlistWrongShape(
            f'{filename} parses as JSON but it is not an allowlist: it wanted {missing}, the '
            f'section this gate reads for the '
            f'{"shell" if len(shells) < 2 else str(len(shells)) + " shells"} named by '
            f'--shell{"s" if len(shells) > 1 else ""}, and got {found}. With that section '
            f'absent the walk compares zero command names and still prints a verdict, so this '
            f'run refuses instead. An allowlist is a JSON object keyed by {want}.')


# Wrappers are `export const name = (args): Ret => loggedInvoke<T>('cmd', {...});`. The body is an
# arrow, so the pattern must cross `=>`; a character class that excludes `=` cannot, and matching
# nothing would report every entry as clean.
WRAPPER_RE = re.compile(
    r"export const (\w+)[^;]*?loggedInvoke(?:<[^>]*>)?\(\s*'(\w+)'", re.S)

# An ADR #7 conditional: the scoped twin appears before this call, within a few lines.
GUARD_RE = re.compile(
    r"(?:sessionToken|token)\s*\?|\?\s*(?:await\s+)?\w+Scoped\s*\(", re.S)

# The guard is not always a ternary. useTerminalHardware.ts writes it as a statement:
#     if (sessionToken) { await setHardwareSettingsScoped(...) } else { await setHardwareSettings(...) }
# Recognising only `?` flagged that already-correct code as a violation, and a gate whose first
# output includes a false positive gets ignored, which is worse than no gate. A window counts as
# guarded when it both tests a token and reaches a Scoped call -- requiring both keeps the
# catalog-cache shape (a Scoped call beside an untested `token` parameter) flagged, which is
# correct: there the ambient call had no guard at all.
# A token TEST, not merely a token appearing somewhere. The first version allowed a bare `token)`
# which made `listProductsScoped(token)` read as a guard -- the self-test fixture caught it. Each
# alternative here is a real branch condition: an if-test, a ternary, or an explicit comparison.
TOKEN_TEST_RE = re.compile(
    r"\bif\s*\(\s*(?:sessionToken|token)\s*\)"
    r"|\b(?:sessionToken|token)\s*\?"
    r"|\b(?:sessionToken|token)\s*(?:!==|!=|&&|\|\|)")
SCOPED_CALL_RE = re.compile(r"\b\w+Scoped\s*\(")


def _window_is_guarded(window):
    return bool(GUARD_RE.search(window)) or bool(
        TOKEN_TEST_RE.search(window) and SCOPED_CALL_RE.search(window))


def strip_comments(text):
    """Remove // line and /* */ block comments, preserving line numbers with blank fills."""
    out = []
    in_block = False
    for line in text.split("\n"):
        if in_block:
            end = line.find("*/")
            if end == -1:
                out.append("")
                continue
            in_block = False
            line = line[end + 2:]
        # A `//` inside a string literal would be a false strip; the call-site patterns below are
        # code-shaped enough that this simplification costs nothing in practice, and over-stripping
        # is the safe direction (it hides call sites rather than inventing them).
        cut = line.find("//")
        if cut != -1:
            line = line[:cut]
        start = line.find("/*")
        if start != -1:
            end = line.find("*/", start + 2)
            if end == -1:
                in_block = True
                line = line[:start]
            else:
                line = line[:start] + line[end + 2:]
        out.append(line)
    return "\n".join(out)


def find_wrappers(api_dir):
    """command string -> set of wrapper names, from the TS api layer."""
    cmd_to_wrapper = {}
    for root, _dirs, files in os.walk(api_dir):
        for fn in sorted(files):
            if not fn.endswith(".ts"):
                continue
            path = os.path.join(root, fn)
            with io.open(path, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
            for m in WRAPPER_RE.finditer(text):
                cmd_to_wrapper.setdefault(m.group(2), set()).add(m.group(1))
    return cmd_to_wrapper


def production_files(ui_dir):
    files = []
    for root, _dirs, fnames in os.walk(ui_dir):
        if "__tests__" in root or os.path.join("ui", "api") in root.replace("\\", "/"):
            continue
        for fn in fnames:
            if fn.endswith(".ts") or fn.endswith(".tsx"):
                files.append(os.path.join(root, fn))
    return files


# A match is a CALL only if the preceding token is not a declaration keyword. Without this, the
# method definition `async adjustStock(...)` reads as a call to `adjustStock` and the gate reports
# the api layer defining its own wrapper -- a false positive that would train people to distrust a
# gate whose first output is nonsense.
DECL_BEFORE_RE = re.compile(r"(?:\basync|\bfunction|\bpublic\b|\bprivate\b|\bdeclare\b)\s+$")


def _is_call_site(text, start):
    return not DECL_BEFORE_RE.search(text[max(0, start - 24):start])


def allowlist_names(payload, section, problems, source=ALLOWLIST):
    """The command names in one allowlist section, plus a sentence per member not read.

    Two shapes are in circulation in the file: a bare command name -- the shape every
    section has always used, and still the shape every entry on disk is written in today --
    and the object form {"name": ..., "reason": ...}, accepted by the validator in the two
    sections named in OBJECT_ALLOWED_SECTIONS above. `reason` exists to be read by a human
    and says nothing to this gate, so only `name` is taken out of an object.

    Anything that cannot become a command name is appended to `problems` and skipped in the
    local sense of "not added to the returned list" -- which is why the caller has to fail on
    a non-empty `problems`, and why a refusal here is not the silent drop the docstring warns
    about. Never raises: an unreadable member is a sentence naming the section, the 1-based
    index the file holds it at, and the value that was found.
    """
    # Named from the file actually being graded, so an aimed run refuses the probe it
    # read and not the checkout copy it never touched.
    filename = os.path.basename(source)
    members = payload.get(section)
    if members is None:
        return []
    if not isinstance(members, list):
        problems.append(
            f'the "{section}" section of {filename} is a {type(members).__name__}, not a '
            'list of command names, so nothing could be read from it.')
        return []

    names = []
    for index, raw in enumerate(members, 1):
        # 1-based, like the validator's message, so both gates point at the same line of
        # the same file with the same number.
        where = f'entry #{index} of the "{section}" section of {filename}'
        keys = sorted(str(k) for k in raw) if isinstance(raw, dict) else None
        if isinstance(raw, str):
            # Stripped, not verbatim: a name padded with whitespace can never match a
            # wrapper, so reading it as written would keep the entry on the page while it
            # enforced nothing. A blank is still refused, never stripped away.
            if raw.strip():
                names.append(raw.strip())
            else:
                problems.append(
                    f'{where} is blank. An empty command name matches no wrapper, so the '
                    'entry enforces nothing while the gate still prints clean.')
            continue
        if isinstance(raw, dict):
            if section not in OBJECT_ALLOWED_SECTIONS:
                problems.append(
                    f'{where} is an object with keys {keys}, and the "{section}" section '
                    'names one shell whose gaps are audited here. It takes one bare command '
                    'name per entry; "dev_mock" and "scoped_orphans" are the only sections '
                    'scripts/verify-ipc-parity.py lets carry a reason. That validator refuses '
                    'this shape in a shell section too and names this script as its reason, so '
                    'run it to see which of the two gates is wrong.')
                continue
            if "name" not in raw:
                problems.append(
                    f'{where} is an object with no "name" -- found keys {keys}. With no '
                    'command name there is nothing to match against a wrapper, so this entry '
                    'is not enforcing anything.')
                continue
            name = raw["name"]
            if not isinstance(name, str):
                problems.append(
                    f'{where} has a "name" of type {type(name).__name__} ({name!r}) -- not a '
                    'command name, so it cannot match a wrapper.')
                continue
            if not name.strip():
                problems.append(
                    f'{where} has a blank "name" ({name!r}), which matches no wrapper.')
                continue
            names.append(name.strip())
            continue
        # Anything else: a number, a nested list, None. Including 0 and False, which are
        # falsy and would vanish from an `if not raw: continue` guard -- dropped in
        # silence, which is precisely how a policy entry stops enforcing.
        problems.append(
            f'{where} is of type {type(raw).__name__} ({raw!r}) -- not a command name and '
            'not an object carrying one, so it cannot match a wrapper.')
    return names


def audit(shells, repo=REPO, allowlist=ALLOWLIST):
    """Return (violations, shape_problems, production_files_scanned).

    violations is [(shell, command, file, line, snippet), ...]; shape_problems is one
    sentence per allowlist member this gate could not turn into a command name. Both have to
    be empty for the gate to pass: an entry that was neither read nor refused is how a
    policy line stops enforcing while the output still says clean. The third value is how
    many production files the verdict was drawn from, printed by main() because a zero is a
    number a reader has to be able to see (F-2).

    The allowlist argument is the seam F-1 asked for: which file to grade. It defaults to
    ALLOWLIST, so a bare run grades the checkout copy exactly as it did before the option
    existed.

    allow is put through require_allowlist_shape the moment it exists and before anything
    calls .get on it, so a file that parses as JSON but is not shaped like an allowlist ends
    the run there -- before the walk, before any verdict, and in a sentence rather than in a
    traceback out of allowlist_names.
    """
    allow = read_allowlist(allowlist)
    require_allowlist_shape(allow, shells, allowlist)
    ui_dir = os.path.join(repo, "ui", "src")
    cmd_to_wrapper = find_wrappers(os.path.join(ui_dir, "api"))
    files = production_files(ui_dir)

    texts = {}
    for p in files:
        with io.open(p, encoding="utf-8", errors="replace") as fh:
            texts[p] = strip_comments(fh.read())

    violations = []
    shape_problems = []
    for shell in shells:
        # Read through allowlist_names so an entry in the object form contributes its
        # command name here instead of reaching the lookup below as a dict.
        for cmd in allowlist_names(allow, shell, shape_problems, allowlist):
            for wrapper in cmd_to_wrapper.get(cmd, ()):
                pat = re.compile(r"\b" + re.escape(wrapper) + r"\s*\(")
                for path, text in texts.items():
                    for m in pat.finditer(text):
                        if not _is_call_site(text, m.start()):
                            continue
                        upto = text[:m.start()].count("\n")
                        window = "\n".join(text.split("\n")[max(0, upto - 8):upto + 1])
                        if _window_is_guarded(window):
                            continue
                        line = text.split("\n")[upto].strip()
                        rel = os.path.relpath(path, repo).replace("\\", "/")
                        violations.append((shell, cmd, rel, upto + 1, line[:88]))
    return violations, shape_problems, len(files)


# F-1, CLOSED. Until this option existed, the only way to show anybody a hazard in
# scripts/ipc-parity-allowlist.json was to import this file as a module and rebind its
# ALLOWLIST global -- the trick every reproduction of the two hazards in this reader used,
# including the one that found F-2. An operator holding a candidate allowlist with a bad
# member had no way to ask this gate about it, which is why a hazard could be described in
# three scripts and survive: describing it was never the hard part, demonstrating it was.
# One flag is the fix, and the default is untouched, so the bare runs at dev-ci.yml:596 and
# scripts/check.sh:72 grade what they graded yesterday.
def build_argparser():
    """The parser, in a function so --self-test can assert its defaults through it.

    Asserting against the real parser is the point: a case that rebuilt the argument list
    would keep passing after somebody renamed the flag or moved its default.
    """
    ap = argparse.ArgumentParser(
        description="Fail on unguarded ambient IPC calls made by a shell that does not "
                    "register the command.")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--shell", default="desktop",
                    help="comma-separated shells to audit (default: desktop); at least one "
                         "shell has to be named -- an empty value is refused, not read as "
                         "all shells")
    ap.add_argument("--allowlist", default=None, metavar="PATH",
                    help="grade PATH instead of the checkout copy at scripts/ipc-parity-"
                         "allowlist.json. The file is only read, never written, and the "
                         "default is unchanged.")
    return ap


def resolve_shells(raw):
    """The shells to grade, split off one --shell value -- or a refusal, before the walk.

    WHY THIS EXISTS. The list this returns drives WHICH allowlist section is required, so an
    empty one leaves `require_allowlist_shape` nothing to demand: it falls back to asking for
    the sections that are present, the audit loop iterates over nothing, and the run still
    printed a verdict. Measured at tip dd4888194 and recorded in
    docs/records/audit-open-findings.md at 14:47: `--shell ''` exited 0 with
    `verify-scoped-reads: clean for .` having graded nothing -- the empty-corpus class one
    level further in than the shape guard, which cannot reach it because a refusal needs a
    named section before a shape can be asked of it.

    So the refusal sits HERE, where the argument becomes a list, not in the read and not in
    the verdict: whether there is anything to grade is a property of the argument. An empty
    value, a blank value, and a value of nothing but separators and blanks all land in the
    same arm, because all three name zero shells. And an empty value is NOT read as "all
    shells" -- guessing at what a blank argument meant is exactly how a typo becomes evidence,
    which is the same reason the shape guard refuses rather than defaults. A caller who wants
    every shell passes them explicitly; the sentence says so.

    Raises NoShellsNamed, a subclass of the AllowlistUnreadable main() already catches, so
    this refusal shares the gate's one voice and its exit code.
    """
    shells = [s.strip() for s in (raw or "").split(",") if s.strip()]
    if not shells:
        shown = "" if raw is None else str(raw)
        all_of_them = ",".join(SHELL_SECTIONS)
        raise NoShellsNamed(
            f'--shell received "{shown}", and with no shell named there is nothing to grade: '
            f'the shell list decides which allowlist section this run reads, and a run that '
            f'names no section compares zero command names -- it has graded nothing, it has '
            f'not passed. Name the shells you mean; the sections this gate reads are '
            f'{" and ".join(SHELL_SECTIONS)}, and a caller who wants every one of them passes '
            f'them explicitly (--shell {all_of_them}) rather than leaving the value empty, '
            f'because guessing what a blank argument meant is how a typo becomes evidence.')
    return shells


def resolve_allowlist(path=None):
    """(the file to grade, how it was chosen) -- the flag or the module default.

    A pair, so the sentence main() prints cannot drift from the value main() hands audit():
    one call, two uses, one source. An empty string counts as absent rather than opening a
    directory. A relative PATH resolves against the caller cwd, which is ordinary for a
    file argument and is exactly why the resolved answer is printed: the line names the file
    that was graded, so the ambiguity is not left for the reader to guess.
    """
    if not path:
        return ALLOWLIST, "module default"
    return os.path.abspath(path), "--allowlist"


def describe_surfaces(scanned, allowlist, how):
    """One line naming both surfaces a verdict is drawn from: the corpus and the file.

    Printed before any verdict, clean or not. The count is what makes an empty walk visible
    instead of clean-looking; the path is what makes an aimed run self-describing. A report
    that says clean without saying which allowlist it read is a claim about a file nobody
    has identified.
    """
    return (f"verify-scoped-reads: {scanned} production file(s) graded against "
            f"{allowlist} ({how}).")


# ── self-test ────────────────────────────────────────────────────────

FIXTURES = [
    # (name, file body, expect_violation)
    ("unguarded ambient call is a violation",
     "const x = async () => {\n  const s = await getSale(id);\n};\n", True),
    ("ADR #7 conditional is accepted",
     "const x = async () => {\n  const s = sessionToken\n    ? await getSaleScoped(sessionToken, id)\n    : await getSale(id);\n};\n",
     False),
    # Proximity to a scoped call does NOT guard anything: these are two independent statements, so
    # the second runs ambient regardless of the first. The first draft of this case expected
    # "accepted" and the classifier correctly disagreed -- a screen that calls the scoped twin for
    # one thing and the ambient one for another is exactly the SalesHistoryScreen shape from item
    # 65, which was a bug, not a pass.
    ("a separate scoped call does not guard this one",
     "const x = async () => {\n  const a = await getSaleScoped(t, id);\n  const b = await getSale(id);\n};\n",
     True),
    ("a comment mentioning the call is not a call site",
     "// getSale() used to be called here\nconst x = async () => {\n  return 1;\n};\n", False),
    ("a comment is stripped even mid-expression",
     "const x = async () => {\n  // await getSale(id);\n  return 1;\n};\n", False),
    ("block comment is stripped",
     "const x = async () => {\n  /* getSale(id) */\n  return 1;\n};\n", False),
    # The if/else statement form of the guard. Missing this made the gate flag
    # useTerminalHardware.ts, which was already correct -- a false positive on a brand-new gate.
    ("if/else token test with a scoped twin is accepted",
     "const x = async () => {\n  if (sessionToken) {\n    await setHardwareSettingsScoped(sessionToken, d);\n  } else {\n    await getSale(id);\n  }\n};\n",
     False),
    # A Scoped call nearby is NOT a guard if nothing tests the token: this is the catalog-cache
    # shape, where `token` is a required parameter and the ambient call simply had no branch.
    ("a scoped call beside an untested token parameter is still a violation",
     "const x = async (token) => {\n  return Promise.all([listProductsScoped(token), getSale(id)]);\n};\n",
     True),
    # A method DEFINITION is not a call. The first version of this gate reported the api layer as
    # violating itself because `async adjustStock(...)` matched the call pattern for `adjustStock`.
    ("a declaration is not a call site",
     "class C {\n  async getSale(id: string) {\n    return 1;\n  }\n}\n", False),
]


# ── allowlist entry-shape cases ──────────────────────────────────────
#
# The happy path is the first two cases: a bare name reads as itself, and an object in a
# section that is allowed to hold one contributes its "name". Case two is the reason this
# block exists -- that member used to reach a dict lookup and abort the gate with
# "TypeError: cannot use 'dict' as a dict key" after the whole UI tree had been parsed,
# with no section, index or file name anywhere in the output.
#
# Everything after them is the inverse case, and it matters more: each must produce ONE
# SENTENCE naming the section, the 1-based position of the member and the value that was
# found. Not a traceback, and not a skip -- an entry dropped quietly reads on screen
# exactly like an entry that was never needed, which is how a policy line stops
# enforcing while the gate still prints clean. `expect` lists substrings that must all
# appear in one problem sentence; None means the case must produce no problem at all.
SHAPE_CASES = [
    # (name, section, members, expect_names, expect)
    ("a bare name is read as itself",
     "desktop", ["get_active_cart_scoped"], ["get_active_cart_scoped"], None),
    ("an object in scoped_orphans yields its name; its reason is ignored",
     "scoped_orphans",
     [{"name": "get_active_cart_scoped", "reason": "host-only, recorded debt"}],
     ["get_active_cart_scoped"], None),
    ("both shapes in one section read through the same path",
     "dev_mock", ["a_scoped", {"name": "b_scoped", "reason": "x"}],
     ["a_scoped", "b_scoped"], None),
    ("an object that grew an extra key still yields its name",
     "scoped_orphans", [{"name": "c_scoped", "reason": "r", "owner": "licensing"}],
     ["c_scoped"], None),
    ("an object in desktop is refused, not read, and the sentence names desktop",
     "desktop", [{"name": "get_active_cart_scoped",
                  "reason": "copied the dev_mock shape"}], [],
     ['"desktop"', "entry #1", "verify-ipc-parity"]),
    ("an object in tablet is refused too -- the two shell sections stay strict",
     "tablet", [{"name": "x_scoped", "reason": "r"}], [], ['"tablet"', "entry #1"]),
    ("an object with no name is a sentence, not a crash and not a skip",
     "scoped_orphans", [{"reason": "orphan"}], [],
     ["entry #1", 'no "name"', "found keys"]),
    ("a name that is not a string is refused with the type and value found",
     "dev_mock", [{"name": 7, "reason": "r"}], [], ['"name"', "int", "7"]),
    ("a blank name is refused rather than stripped into nothing",
     "scoped_orphans", ["   "], [], ["entry #1", "blank"]),
    ("the number zero is refused, not treated as an absent entry",
     "dev_mock", [0], [], ["entry #1", "int", "0"]),
    ("a nested list is refused with the value it found",
     "scoped_orphans", [["a_scoped", "b_scoped"]], [], ["entry #1", "list"]),
    ("a section that is not a list is refused",
     "desktop", {"get_active_cart_scoped": True}, [], ['"desktop"', "dict"]),
    ("the position counts the members that read fine, not only the bad one",
     "dev_mock", ["ok_scoped", {"name": "also_ok_scoped"}, 0],
     ["ok_scoped", "also_ok_scoped"], ["entry #3"]),
]


def _shape_self_test():
    """Run allowlist_names over both shapes and over every way a member can go wrong.

    Kept a separate function but called from self_test(), so CI's blocking
    `--self-test` step cannot pass while the shape reader is broken. It calls the real
    reader, not a copy of it.
    """
    print("  verify-scoped-reads self-test / allowlist entry shapes")
    failures = 0
    for name, section, members, expect_names, expect in SHAPE_CASES:
        problems = []
        names = allowlist_names({section: members}, section, problems)
        ok = names == list(expect_names)
        if ok:
            if expect is None:
                ok = not problems
            else:
                ok = any(all(s in p for s in expect) for p in problems)
        if ok:
            tag = "" if expect is None else "  [refused in a sentence]"
            print(f"    ok   {name}{tag}")
        else:
            print(f"    FAIL {name}")
            print(f"           names read: {names}  expected: {list(expect_names)}")
            for p in problems:
                print(f"           problem: {p}")
            failures += 1
    # Both directions have to have actually happened: a reader that refused every member
    # would pass the refusal cases, and so would one that silently skipped them.
    refused = sum(1 for c in SHAPE_CASES if c[4])
    read = sum(1 for c in SHAPE_CASES if c[3])
    if refused and read:
        print(f"    ok   shape cases read names in {read} and refused in {refused}")
    else:
        print("    FAIL shape cases cover only one direction -- the checks are vacuous")
        failures += 1
    # The file on disk, read for real -- through read_allowlist, the same door audit() uses,
    # so this case cannot pass on a path the gate does not take. Every entry there today is
    # a bare name, so this is the case that fails if a tolerant reader invents or loses one.
    try:
        real = read_allowlist(ALLOWLIST)
    except AllowlistUnreadable as exc:
        # Same rule as everywhere else: a file that would not open is a sentence, not a
        # traceback out of the blocking self-test step.
        print(f"    FAIL on-disk allowlist unreadable: {exc}")
        return failures + 1
    disk_problems = []
    disk_names = disk_members = 0
    for section in ("desktop", "tablet", "dev_mock", "scoped_orphans"):
        members = real.get(section, [])
        disk_names += len(allowlist_names(real, section, disk_problems))
        disk_members += len(members)
    if not disk_problems and disk_names == disk_members and disk_names:
        print(f"    ok   on-disk allowlist: all {disk_names} entries read, no problem")
    else:
        print(f"    FAIL on-disk allowlist: {disk_names}/{disk_members} names read, "
              f"{len(disk_problems)} problem(s)")
        for p in disk_problems:
            print(f"           problem: {p}")
        failures += 1
    # The defended-against crash stays reproducible, so a regression to the raw loop shows
    # up as a live hazard rather than as a fixture that quietly stopped meaning anything.
    crashed = False
    try:
        {}.get({"name": "get_active_cart_scoped", "reason": "r"})
    except TypeError:
        crashed = True
    if crashed:
        print("    ok   an object member still crashes a raw dict lookup")
    else:
        print("    FAIL the lookup this reader defends is no longer a hazard -- suspect")
        print("           the object-form cases before believing the green")
        failures += 1
    return failures


def _read_retry_self_test():
    """Case 1 proves the retry is REACHED; case 2 proves the sentence it ends in.

    A real WinError 5 window is a microsecond wide and cannot be summoned on demand, so both
    cases inject the denial through read_allowlist's opener seam -- production callers pass
    nothing and get the real read. Each case catches exceptions on purpose: a build that loses
    the retry has to report FAIL and carry on with the other cases, not abort the self-test
    with the bare PermissionError the retry exists to swallow.
    """
    print("  verify-scoped-reads self-test / allowlist read retry")
    failures = 0

    # Case 1. Three denials that clear must cost three sleeps and still return the payload,
    # and the assertion is the OPEN COUNT: one open means no loop ran, and the payload by
    # itself would pass a reader that simply got lucky between two renames.
    seen = []

    def denies_then_reads(path):
        seen.append(path)
        if len(seen) <= 3:
            raise PermissionError(13, "simulated rename in flight")
        return _read_json(path)

    cleared = False
    why = ""
    try:
        payload = read_allowlist(ALLOWLIST, opener=denies_then_reads)
        cleared = (len(seen) == 4 and isinstance(payload, dict)
                   and isinstance(payload.get("desktop"), list))
        if not cleared:
            why = f"  got {type(payload).__name__} after {len(seen)} open(s)"
    except BaseException as exc:
        why = f"  {type(exc).__name__} escaped the retry: {exc}"
    if cleared:
        print(f"    ok   case 1  denial cleared on open {len(seen)} -- the retry was reached")
    else:
        print(f"    FAIL case 1  retry not reached{why}")
        failures += 1

    # Case 2. The sentence has to carry the path, the try count and the two bare call sites,
    # because that is the difference between 'this tree is broken' and 'a file happened to be
    # busy while CI ran'. A denial escaping as itself is the traceback being tested for, so
    # the except below records it as a failure rather than propagating it.
    tries = []

    def never_clears(path):
        tries.append(path)
        raise PermissionError(13, "simulated permanent lock")

    outcome = ""
    try:
        read_allowlist(ALLOWLIST, opener=never_clears)
        outcome = "NO EXCEPTION -- a permanent denial was swallowed"
    except AllowlistUnreadable as exc:
        outcome = str(exc)
    except BaseException as exc:
        outcome = f"bare {type(exc).__name__}: {exc}"
    must_name = [os.path.basename(ALLOWLIST), str(READ_ATTEMPTS), *READER_RUNS_BARE_AT]
    shaped = (len(tries) == READ_ATTEMPTS
              and not outcome.startswith("bare ")
              and not outcome.startswith("NO EXCEPTION")
              and all(needle in outcome for needle in must_name))
    if shaped:
        print(f"    ok   case 2  {READ_ATTEMPTS} tries, then a sentence naming the path, the "
              "count and both bare runs")
        print(f"           {outcome}")
    else:
        print(f"    FAIL case 2  {len(tries)} try(ies), outcome: {outcome}")
        for needle in must_name:
            if needle not in outcome:
                print(f"           sentence is missing: {needle}")
        failures += 1
    return failures
def _aim_self_test():
    """F-1: prove --allowlist moves the read, and that passing no flag leaves the default.

    Case 1 goes through the real main() with argv, not through audit(), because the claim
    under test is the wiring: an option that parses correctly and is then ignored by the one
    caller that matters is exactly the bug this case has to catch. The probe carries a member
    the checkout copy does not, so a run that ignored the flag has nothing to complain about
    and exits 0. Case 1 costs one full walk of the tree, about 1.6s, which is the price of
    testing the pipeline instead of a copy of it.
    """
    print("  verify-scoped-reads self-test / aiming the read")
    failures = 0
    real = read_allowlist(ALLOWLIST)
    planted = {"name": "zz_planted_only_in_probe", "reason": "an object in desktop is refused"}

    with tempfile.TemporaryDirectory(prefix="oz-scoped-aim-") as tmp:
        probe = os.path.join(tmp, "probe-aim-allowlist.json")
        payload = json.loads(json.dumps(real))
        payload.setdefault("desktop", []).append(planted)
        with io.open(probe, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)

        # A two-directional premise: the planted member must be absent from the file the bare
        # runners read, or case 1 proves nothing about which file was graded.
        premise = not any(isinstance(m, dict) and m.get("name") == planted["name"]
                          for m in real.get("desktop", []))
        if not premise:
            print("    FAIL premise  the planted member is already in the checkout allowlist")
            failures += 1

        captured = io.StringIO()
        saved, sys.stdout = sys.stdout, captured
        try:
            rc = main(["--allowlist", probe])
        except BaseException as exc:
            rc = f"bare {type(exc).__name__}: {exc}"
        finally:
            sys.stdout = saved
        out = captured.getvalue()

        # An object refused in a strict section is reported by its KEYS, not by the name
        # inside it, so what proves provenance is the entry index: the checkout copy holds 27
        # desktop members today, so entry #28 cannot have come from that file. Spelled as
        # len(default) + 1 rather than as a literal 28, or this case rots the first time the
        # allowlist gains an entry for an unrelated reason.
        default_count = len(real.get("desktop", []))
        only_index = f"entry #{default_count + 1}"
        named = (os.path.basename(probe) in out and only_index in out
                 and "ipc-parity-allowlist.json" not in out)
        if rc == 1 and named:
            print(f"    ok   case 1  the aimed probe was the file read -- it refused "
                  f"{only_index} of desktop, an entry the {default_count}-member checkout "
                  "copy cannot hold")
        else:
            print(f"    FAIL case 1  rc={rc!r}, probe named={os.path.basename(probe) in out}, "
                  f"{only_index} in output={only_index in out}, default blamed="
                  f"{'ipc-parity-allowlist.json' in out}")
            for line in out.splitlines()[:4]:
                print(f"           | {line}")
            failures += 1

    # Case 2. No flag is what dev-ci.yml:596 and scripts/check.sh:72 pass, so the default has
    # to be the same file, chosen the same way, and named as the default in the line that
    # reports it. Checked against the real parser and the real helpers rather than a restated
    # pair of literals, and without a second 1.6s walk: case 1 already drove main(), and what
    # is under test here is which file main() would have opened.
    no_flag = build_argparser().parse_args([])
    default_path, default_how = resolve_allowlist(no_flag.allowlist)
    # A truthful count, not a placeholder: production_files() only lists paths, so this is
    # milliseconds, and the line case 2 prints is the line a bare run prints.
    scanned = len(production_files(os.path.join(REPO, "ui", "src")))
    line = describe_surfaces(scanned, default_path, default_how)
    same_bytes = read_allowlist(default_path) == real
    unchanged = (no_flag.allowlist is None and default_path == ALLOWLIST
                 and default_how == "module default" and "ipc-parity-allowlist.json" in line
                 and "module default" in line and same_bytes)
    if unchanged:
        print("    ok   case 2  no flag still grades the checkout copy, named as the module "
              "default")
        print(f"           {line}")
    else:
        print("    FAIL case 2  the bare run no longer grades the default file")
        print(f"           flag default={no_flag.allowlist!r} resolved={default_path!r} "
              f"how={default_how!r} same_bytes={same_bytes}")
        print(f"           {line}")
        failures += 1
    return failures




def _guard_self_test():
    """The ways an aimed --allowlist path can fail to be a gradeable file.

    One case per input, each asserting the exact reason word, because the finding this
    closes is a MISDIAGNOSIS: a directory used to reach the busy-file handler and print
    that another process was holding it, sending an operator off to look for a process
    that does not exist. The busy sentence is not wrong, it was just being used for three
    failures that are not busy. Each case runs the real main() so the wiring, not just the
    helper, is under test; all of them short-circuit before the tree walk, so they are
    milliseconds.

    Cases 1-3 are the path, case 4 is the open, and cases 5-7 are the SHAPE of a file that
    both exists and parses -- the trio that sat unguarded until 226d7268f0, where two of
    them exited 0 having compared zero command names and the third exited 1 through an
    uncaught AttributeError. The shape cells therefore forbid more than the wrong reason:
    they forbid the verdict line, because a refusal that still printed a verdict would be
    the same hazard wearing a red exit code. Case 8 is the control that keeps the guard
    from being satisfied only by fixtures. Cases 9-10 are the DECODE of a file that exists,
    opens and never reaches the parser -- valid JSON to another codec, unreadable to this one,
    and the pair that used to escape as an uncaught UnicodeDecodeError traceback.
    """
    print("  verify-scoped-reads self-test / why a path could not be graded")
    failures = 0

    def run(argv):
        # Both streams, because a refusal now leaves on stderr: a case that captured only
        # stdout would read the absence of a verdict as the absence of a refusal, and pass on
        # a run that printed nothing at all in either place.
        buf, ebuf = io.StringIO(), io.StringIO()
        saved, saved_err = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = buf, ebuf
        try:
            rc = main(argv)
        except BaseException as exc:
            rc = f"bare {type(exc).__name__}: {exc}"
        finally:
            sys.stdout, sys.stderr = saved, saved_err
        return rc, buf.getvalue() + ebuf.getvalue()

    with tempfile.TemporaryDirectory(prefix="oz-scoped-guard-") as tmp:
        missing = os.path.join(tmp, "no-such-allowlist.json")
        bad = os.path.join(tmp, "not-json.json")
        with io.open(bad, "w", encoding="utf-8") as fh:
            fh.write("{ this is not json at all")
        # Case 4 needs a file that EXISTS, is not a directory, and still denies the open --
        # the one shape that must keep the busy sentence. Injected through the opener seam,
        # which is the only honest way to make a denial on a real path on demand.
        realfile = os.path.join(tmp, "exists-but-denied.json")
        with io.open(realfile, "w", encoding="utf-8") as fh:
            json.dump({"desktop": []}, fh)
        # Cases 5-7: files that EXIST and PARSE. Each was run against a HEAD copy at
        # 226d7268f0 and the first two exited 0 with a verdict line after comparing zero
        # command names; the third exited 1 with a traceback out of allowlist_names.
        shapes = {}
        for stem, body in (("empty-object", "{}"),
                           ("wrong-key", '{"entries": []}'),
                           ("top-level-list", '[{"a": 1}]'),
                           ("top-level-string", '"getSale"'),
                           # Cases 5-7 prove the guard on a MISSING section. These two prove it
                           # on a section that is PRESENT AND WRONGLY TYPED -- the half that
                           # membership alone could not catch: the file cleared the guard, the
                           # 612-file walk ran, and the sentence arrived afterwards under the
                           # verdict code, filed beside a real finding. The forbidden word in
                           # their cells is the surfaces line, whose absence is the proof the
                           # refusal came BEFORE the walk -- something no exit code shows.
                           ("section-is-a-string", '{"desktop": "abc", "tablet": []}'),
                           ("section-is-a-number", '{"desktop": 42, "tablet": []}')):
            shapes[stem] = os.path.join(tmp, f"shape-{stem}.json")
            with io.open(shapes[stem], "w", encoding="utf-8") as fh:
                fh.write(body)
        # Cases 9-10: bytes that exist, are not a directory, and never reach the
        # parser. Written as real UTF-16, which is the finding this closes: a
        # UTF-8 read of them raises UnicodeDecodeError, a class the reader caught
        # by nobody, so it escaped sys.exit(main()) as a traceback naming the wrong
        # gate. Case 9 is a WELL-SHAPED allowlist on purpose -- the file is valid
        # JSON to any tool that picks the right codec, so the honest sentence is
        # that this gate cannot read it, not that it is broken.
        undecodable = {}
        for stem, body in (("well-shaped", '{"desktop": []}'),
                           ("not-json", "not json")):
            undecodable[stem] = os.path.join(tmp, f"utf16-{stem}.json")
            with io.open(undecodable[stem], "w", encoding="utf-16") as fh:
                fh.write(body)

        cases = [
            ("case 1  a path that is not there", [missing], "does not exist",
             ["would not open after"]),
            ("case 2  a path that is a directory", [tmp], "is a directory",
             ["would not open after", "another process is holding it"]),
            ("case 3  a file that is not valid JSON", [bad], "is not valid JSON",
             ["would not open after", "another process is holding it"]),
            # The shape cells forbid the VERDICT line as well as the wrong reason: these
            # three used to be silent (or a traceback), and a refusal that still printed a
            # verdict would be the same hazard with a red exit code bolted on.
            ("case 5  an allowlist that is an empty JSON object", [shapes["empty-object"]],
             "and got an empty object",
             ["clean", "is not valid JSON", "would not open after", "entry #"]),
            ("case 6  a JSON object keyed by something else", [shapes["wrong-key"]],
             '1-key object: "entries"',
             ["clean", "is not valid JSON", "would not open after", "entry #"]),
            ("case 7  a JSON array at the top level", [shapes["top-level-list"]],
             "has no .get",
             ["clean", "is not valid JSON", "would not open after", "AttributeError"]),
            ("case 7b  a JSON string at the top level", [shapes["top-level-string"]],
             "has no .get",
             ["clean", "is not valid JSON", "would not open after", "AttributeError"]),
            ("case 7c a section holding a string", [shapes["section-is-a-string"]],
             "is a str, not a list of command names",
             ["clean", "production file(s) graded", "entry #", "is not valid JSON",
              "would not open after"]),
            ("case 7d a section holding a number", [shapes["section-is-a-number"]],
             "is a int, not a list of command names",
             ["clean", "production file(s) graded", "entry #", "is not valid JSON",
              "would not open after"]),
            # The decode cells: same refusal for both, because the bytes are given
            # up on before anything is parsed -- and both forbid the busy sentence,
            # which would send an operator off to hunt a process that is not
            # running, and the parse sentence, which would call a readable file
            # broken. Not retried, so these two also prove the retry loop is not
            # widened to a class that can never clear.
            ("case 9  a well-shaped allowlist this reader cannot decode",
             [undecodable["well-shaped"]], "cannot be decoded as UTF-8",
             ["clean", "is not valid JSON", "would not open after",
              "another process is holding it", "AttributeError"]),
            ("case 10 undecodable bytes that are not JSON either",
             [undecodable["not-json"]], "cannot be decoded as UTF-8",
             ["clean", "is not valid JSON", "would not open after",
              "another process is holding it"]),
        ]
        for label, extra, reason, forbidden in cases:
            rc, out = run(["--allowlist"] + extra)
            named = os.path.basename(extra[0].rstrip(os.sep)) in out or extra[0] in out
            bad_words = [w for w in forbidden if w in out]
            # rc 2, and the refusal must be the ONLY line and must carry the error: prefix --
            # 1 is this gate's verdict code and a refusal wearing it is the hazard this split
            # exists to close, so an rc check is load-bearing here rather than lazy.
            if (rc == 2 and out.startswith("error: ") and reason in out and named
                    and "Traceback" not in out and "FAIL:" not in out
                    and not bad_words):
                print(f"    ok   {label} -- says {reason!r} and names the path it was given")
            else:
                print(f"    FAIL {label}  rc={rc!r}, says {reason!r}={reason in out}, "
                      f"path named={named}, traceback={'Traceback' in out}, "
                      f"wrong words={bad_words}")
                for line in out.splitlines()[:3]:
                    print(f"           | {line[:150]}")
                failures += 1

        # Case 4: the distinction, kept honest. A denial on a file that exists and is not a
        # directory must still be reported as a busy file, or the preflight above has been
        # bought by breaking the retry.
        def always_denies(p):
            raise PermissionError(13, "simulated sharing violation on a real file")

        try:
            read_allowlist(realfile, opener=always_denies)
            outcome = "NO EXCEPTION"
        except AllowlistUnreadable as exc:
            outcome = str(exc)
        except BaseException as exc:
            outcome = f"bare {type(exc).__name__}: {exc}"
        stays_busy = ("would not open after" in outcome
                      and "another process is holding it" in outcome
                      and "is a directory" not in outcome and "does not exist" not in outcome)
        if stays_busy and not outcome.startswith("bare "):
            print(f"    ok   case 4  a denial on a real file still reads as a busy file, "
                  f"after {READ_ATTEMPTS} tries")
        else:
            print(f"    FAIL case 4  the busy path changed: {outcome[:160]}")
            failures += 1

        # Case 8, the control that stops the guard above from being a check that is only
        # ever satisfied by fixtures: the file every bare run actually grades has to clear
        # it, and so has a well-shaped allowlist that records no gap for either shell. The
        # second half is the load-bearing one -- a section that is PRESENT and EMPTY is a
        # claim this gate can check, and refusing it would turn a fully migrated shell into
        # a red build, which is how a guard gets routed around instead of obeyed. Asking
        # for both shells is deliberate too: the run the review recommended, --shell
        # desktop,tablet, must clear the same door.
        refusals = []
        try:
            require_allowlist_shape(read_allowlist(ALLOWLIST), list(SHELL_SECTIONS),
                                    ALLOWLIST)
        except AllowlistUnreadable as exc:
            refusals.append(f"checkout copy refused: {exc}")
        try:
            require_allowlist_shape({"desktop": [], "tablet": []}, list(SHELL_SECTIONS),
                                    "well-shaped-empty.json")
        except AllowlistUnreadable as exc:
            refusals.append(f"present-but-empty sections refused: {exc}")
        if not refusals:
            print("    ok   case 8  the checkout copy and a well-shaped empty allowlist "
                  "both clear the shape guard")
        else:
            for refusal in refusals:
                print(f"    FAIL case 8  {refusal}")
            failures += 1
    return failures


def _shell_self_test():
    """Case 11 and 12: the --shell LIST, which is the empty-corpus hazard one level in.

    The shape guard above cannot reach this one. It asks whether a named section exists, so a
    run that names no section answers its question with the sections that happen to be there:
    at tip dd4888194 `--shell ''` walked 568 files, compared zero command names and exited 0
    printing `clean for .`. The refusal therefore sits in resolve_shells(), where the argument
    becomes a list, and these cases drive the real main() so a wiring regression -- a guard
    that exists and is never called -- shows up red here rather than green in CI.

    Both cases forbid three things, not only the wrong reason: the verdict line, because a
    refusal that graded nothing must not describe a corpus it never touched, and the surfaces
    line, because that is the print that happens after the walk and its absence is the proof
    the refusal came first.
    """
    print("  verify-scoped-reads self-test / which shells were named")
    failures = 0

    def run(argv):
        # Both streams: the refusal this case exists to prove now leaves on stderr, and a
        # capture that watched only stdout would see an empty run and call it quiet.
        buf, ebuf = io.StringIO(), io.StringIO()
        saved, saved_err = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = buf, ebuf
        try:
            rc = main(argv)
        except BaseException as exc:
            rc = f"bare {type(exc).__name__}: {exc}"
        finally:
            sys.stdout, sys.stderr = saved, saved_err
        return rc, buf.getvalue() + ebuf.getvalue()

    empty_runs = [
        ("case 11 an empty --shell value", "",
         "the run grades no shell and still exits 0"),
        ("case 12 a --shell value of only blanks and commas", " , , ",
         "blank entries stripped into nothing"),
    ]
    for label, value, hazard in empty_runs:
        rc, out = run(["--shell", value])
        lines = [ln for ln in out.splitlines() if ln.strip()]
        # rc 2 with the error: voice: this is the refusal that graded nothing, and 1 is the
        # verdict code. One line, on stderr, and no FAIL: anywhere -- a run that refused must
        # not also report.
        refused = (rc == 2 and len(lines) == 1 and lines[0].startswith("error: ")
                   and "nothing to grade" in out and "desktop" in out and "tablet" in out
                   and "FAIL:" not in out)
        quiet = (not any(w in out for w in
                         ("clean", "production file(s) graded", "Traceback")))
        if refused and quiet:
            print(f"    ok   {label} -- one error: line on stderr at exit 2, refused before "
                  f"the walk, no verdict printed")
        else:
            print(f"    FAIL {label}  rc={rc!r} refused={refused} quiet={quiet} "
                  f"-- {hazard}")
            for ln in lines[:3]:
                print(f"           | {ln[:150]}")
            failures += 1

    # The controls, and they are the load-bearing half: a guard that refused every --shell
    # value would be redder than the hazard it closes, and `--shell desktop` is what
    # dev-ci.yml#static-gates and every operator type. Checked against resolve_shells and the
    # real parser rather than by running two more full walks.
    kept = [("desktop", ["desktop"]), (" desktop ", ["desktop"]),
            ("desktop,tablet", ["desktop", "tablet"]),
            ("desktop , , tablet", ["desktop", "tablet"])]
    wrong = []
    for raw, want in kept:
        try:
            got = resolve_shells(raw)
        except AllowlistUnreadable as exc:
            got = f"refused: {exc}"
        if got != want:
            wrong.append(f'--shell "{raw}" -> {got!r}, wanted {want!r}')
    default = resolve_shells(build_argparser().parse_args([]).shell)
    if default != ["desktop"]:
        wrong.append(f"the no-flag default resolved to {default!r}, wanted ['desktop'] -- "
                     "a bare run must grade what it graded before this guard existed")
    if wrong:
        for problem in wrong:
            print(f"    FAIL a named shell stopped being graded  {problem}")
        failures += 1
    else:
        print(f"    ok   {len(kept)} named values still resolve to their shells, and the "
              f"no-flag default is still ['desktop']")
    return failures



def self_test():
    print("  verify-scoped-reads self-test")
    failures = 0
    for name, body, expect in FIXTURES:
        # Exercise the same predicates audit() uses, so a fix to one cannot silently diverge from
        # the other -- a self-test that reimplements the logic tests its own copy, not the gate.
        stripped = strip_comments(body)
        m = re.search(r"\bgetSale\s*\(", stripped)
        has_call = bool(m) and _is_call_site(stripped, m.start())
        guarded = _window_is_guarded(stripped)
        violation = has_call and not guarded
        ok = (violation == expect)
        # The two "should be accepted" code cases must also prove the guard is what saves them.
        if ok and has_call:
            print(f"    ok   {name}  [call found, guarded={guarded}]")
        else:
            print(f"    {'ok  ' if ok else 'FAIL'} {name}")
        if not ok:
            failures += 1
    # Guard against a vacuous classifier: if nothing ever registers a violation, every check above
    # passes for the wrong reason.
    any_violation = any(
        (lambda s: (lambda m: bool(m) and _is_call_site(s, m.start())
                    and not _window_is_guarded(s))(re.search(r"\bgetSale\s*\(", s)))(strip_comments(b))
        for _n, b, e in FIXTURES if e)
    if not any_violation:
        print("    FAIL classifier can never report a violation -- checks are vacuous")
        failures += 1
    else:
        print("    ok   classifier can report a violation (not vacuous)")
    failures += _shape_self_test()
    failures += _read_retry_self_test()
    failures += _aim_self_test()
    failures += _guard_self_test()
    failures += _shell_self_test()
    print(f"  self-test: {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


def main(argv=None):
    # argv is a parameter, not only sys.argv, so --self-test can drive the real main() over
    # a probe allowlist and prove the wiring rather than prove a copy of the logic.
    ap = build_argparser()
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    allowlist, how = resolve_allowlist(args.allowlist)
    try:
        # Resolved INSIDE the try, ahead of audit() and so ahead of the walk: a run that
        # names no shell has nothing to grade, and that is a property of the argument, which
        # is why it is refused here rather than discovered in the verdict below. NoShellsNamed
        # is an AllowlistUnreadable, so it leaves through the handler under this one -- the
        # gate's one-line error: voice and its refusal code, no new handler.
        shells = resolve_shells(args.shell)
        violations, shape_problems, scanned = audit(shells, allowlist=allowlist)
    except AllowlistUnreadable as exc:
        # A file this gate cannot open is not a clean tree and not a dirty one; saying so
        # in a sentence is the whole difference between a red run someone can act on and a
        # traceback that blames the wrong gate. AllowlistWrongShape -- parsed, but not an
        # allowlist --, AllowlistUndecodable -- the bytes arrived and are not UTF-8 -- and
        # NoShellsNamed -- the argument named nothing to grade -- all arrive through THIS
        # handler on purpose: one handler, one voice, no second except clause.
        #
        # The voice is 'error:' on stderr and the code is 2, never 1. Two paths below here
        # spend 1 on a VERDICT -- 'FAIL: N member(s) ... this gate could not read' and
        # 'FAIL: N unguarded ambient IPC call(s)' -- so a refusal that also returned 1 was
        # indistinguishable from a finding to anything that reads the number: CI's step,
        # scripts/check.sh:72 and every log grep see one red code for 'the tree is broken'
        # and for 'nobody read a file'. 2 says this run graded nothing, which is the split
        # verify-ftl-orphans.py keeps at its _refusal() and verify-ipc-parity.py keeps at
        # its AllowlistUnusable, both for this same shared allowlist. It also goes to
        # stderr, because a refusal is not part of the report a bare run prints.
        print('error: ' + str(exc), file=sys.stderr)
        return 2
    print(describe_surfaces(scanned, allowlist, how))
    if shape_problems:
        # Ahead of the violations, because a member this gate could not read makes every
        # number it then prints -- including a reassuring zero -- a guess about a file it
        # has not actually parsed.
        print(f"FAIL: {len(shape_problems)} member(s) of {os.path.basename(allowlist)} "
              "this gate could not read:")
        for problem in shape_problems:
            print(f"  {problem}")
        print("\nThis script does not decide which sections may hold an object entry; it",
              "mirrors")
        print("scripts/verify-ipc-parity.py, the gate that validates and writes that file. "
              "Run it:")
        print("  python3 scripts/verify-ipc-parity.py")
        print("If that gate is clean, the entry sits in a section this reader rejects on "
              "purpose:")
        print("\"desktop\" and \"tablet\" stay lists of bare command names, one per gap in "
              "that shell.")
        return 1
    if violations:
        print(f"FAIL: {len(violations)} unguarded ambient IPC call(s):")
        for shell, cmd, path, line, snippet in violations:
            print(f"  [{shell}] {cmd} is not registered in that shell")
            print(f"    {path}:{line}: {snippet}")
        print("\nFix by routing through the scoped twin under the ADR #7 conditional:")
        print("  sessionToken ? await xScoped(sessionToken, ...) : await x(...)")
        print("If the ambient call is genuinely unreachable, remove the allowlist entry instead.")
        return 1
    print(f"verify-scoped-reads: clean for {', '.join(shells)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
