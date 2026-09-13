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

EXIT CODES, and the gap between them is the contract: 0 is a clean verdict, 1 is a VERDICT
that found something -- 'FAIL: N unguarded ambient IPC call(s)', or a member of the allowlist
this gate could read as a file and could not read as a command name -- and 2 is a REFUSAL that
graded nothing: the allowlist missing, a directory, busy past the retry ceiling, undecodable,
not JSON, not an object, a named section absent or holding a non-list; a --shell value naming
no shell; a corpus whose walk returns zero gradeable production files; or an api layer that
resolves to zero command-to-wrapper pairs, which is the same zero one level deeper -- the tree
was walked, the file was read, and the surface every command is looked up in was not there.
Refusals print one
'error:' line on stderr, verdicts print 'FAIL:' on stdout. Before that split both left as
'FAIL:' at exit 1, so a file nobody could read was told apart from a broken tree only by its
wording, and anything reading the number -- dev-ci.yml#static-gates, scripts/check.sh, a grep
for a red build -- saw one code for 'the tree is broken' and for 'nobody read a file'. This is
the law scripts/verify-ftl-orphans.py keeps at its _refusal() and scripts/verify-ipc-parity.py
keeps at its AllowlistUnusable, and all three read the one shared allowlist. The last two refusals
are the same rule aimed outward at the checkout instead of the file: an allowlist nobody read
cannot make a claim about commands, a tree nobody walked cannot make a claim about call sites,
and a wrapper map that found nothing cannot make a claim about either one.

One level in from that guard sits the shell list itself, and it needed its own refusal: the
list drives WHICH section the guard above is allowed to ask about, so `--shell ''` named none,
left the guard nothing to demand, walked 568 files, compared zero commands and exited 0
printing `clean for .`. resolve_shells() refuses it before the walk -- with no shell named
there is nothing to grade, and a caller who wants every shell passes them explicitly
(--shell desktop,tablet) rather than leaving the value blank for this gate to guess at.
Comments are stripped before matching. Without that, prose mentioning `getSale()` reads as a call
site -- which is exactly the false positive this script's own first draft produced against a
comment written by the fix that missed the real site.

WHAT EVERY RUN PRINTS

Two lines above the verdict, on stdout, before any FAIL and before any 'clean for': how many
production files were walked, against which allowlist file; and how many allowlisted names
resolved to a wrapper, per shell. Both are reports about the SITUATION, and neither is a
verdict -- nothing in this file reads either number to decide an exit code, which is the
difference between making a thin wrapper map legible and pretending this gate owns the
threshold that would call one insufficient. Measured on the real tree the moment the line
landed: 26 of 27 on the default desktop run, 150 of 181 across both shells. Read straight, that
says 31 allowlisted names have no wrapper to search for and never could have produced a finding.
Read a day later it says something else: the ratio is only as honest as the pattern that builds
the map, and WRAPPER_RE could not see the 'export async function' idiom at all, so most of those
31 were wrappers this file was blind to rather than gaps in the front end. It now reads 27 of 27
and 180 of 181, and the single remaining name is a deleted command with no wrapper to find. The
lesson is the reason the line exists and the reason it stays informational: a number printed is a
number somebody checks, and what they check next is the tool that produced it. The ninth guard
still cannot see a thin map (it refuses only a map with ZERO rows), which is what case 21 pins on
a synthetic fixture instead of on a tree that will drift.

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
# corpus size and the allowlist it graded on every run, so a zero walk is visible in the
# log -- and visibility is now backed by a refusal: require_gradeable_corpus() ends the run at
# exit 2 when the walk returns nothing to walk, measured over a missing ui/, an empty ui/src
# and a ui/src holding only a README, all three of which used to print '0 production file(s)
# graded' and exit 0 on it. What is STILL open in this file is the other half of the anchor:
# REPO is still __file__-derived, so the refusal fires in the wrong checkout rather than
# pointing at the right one, and --repo does not exist to say which tree was meant.

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


class EmptyWrapperSurface(AllowlistUnreadable):
    """The api layer resolved to nothing, so no allowlisted command could have been looked up.

    The fourth member of the family and the deepest one: the allowlist was read and is
    well-shaped, the corpus is non-empty and was walked, and BOTH guards above cleared -- what
    is empty is the third surface a verdict is drawn from, the command-string to wrapper-name
    map this gate looks every allowlisted command UP in. An empty map makes the inner loop
    iterate nothing for every name, so zero call sites can be found, and the run prints
    'clean for desktop.' at exit 0 on 3 graded production files. Measured tonight after the
    corpus guard landed: delete ui/src/api from an otherwise populated tree and the gate that
    just learned to refuse an empty walk still grades clean, because a non-empty corpus is not
    the same thing as a non-empty SURFACE.

    Subclass of AllowlistUnreadable for the same reason EmptyCorpus is: main() keeps ONE
    handler, one 'error:' line on stderr and exit 2. Never the verdict code 1 -- an api layer
    nobody found is not evidence about anybody's call sites -- and never the 0 it used to
    return, which is how this survived three rounds of guards.
    """


class AllowlistSchemaMissing(AllowlistUnreadable):
    """The shared schema validator itself could not be loaded, so document shape is UNKNOWN.

    A refusal, at the gate's refusal code, and the only honest alternative to a silent skip:
    require_allowlist_shape() now asks scripts/allowlist-schema.py whether the parsed document is
    an allowlist at all, and if that file cannot be imported the answer is not 'yes' -- it is 'not
    asked'. A gate that carried on in that state would grade a top-level JSON list exactly as
    though two gates still disagreed about what a document is, which is the disagreement the
    shared module exists to end.

    It cannot happen in a checkout that has the committed file, which is exactly why it gets a
    class and a case: 'cannot happen' is what a skipped check grows from, and the skip would be
    invisible -- the run prints a verdict either way.
    """


class EmptyCorpus(AllowlistUnreadable):
    """The walk found nothing to walk, so there is no verdict to print -- clean or dirty.

    A subclass on purpose, exactly as AllowlistWrongShape, AllowlistUndecodable and
    NoShellsNamed are one: main() keeps ONE handler, so the gate keeps ONE voice --
    'error: <sentence>' on stderr at exit 2, never the verdict code 1 -- and no except clause
    widens and no second handler is invented. The name says WHICH refusal a reader is looking
    at, and it is not a complaint about the allowlist: the file it read was well-shaped and
    every section parsed. What is missing is the other surface a verdict is drawn from, which
    is why it shares the parent -- all four of these mean the same sentence, this run graded
    nothing.

    Exit 2 rather than 1 for the reason the others moved too: 1 is this gate's FINDING code,
    'FAIL: N unguarded ambient IPC call(s)', and a number read off an empty checkout is not
    evidence about anybody's call sites. Nor is it the 0 it used to return, which is the point
    -- measured tonight, three hollow corpora each exited 0 printing 'clean for desktop.'.
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


# The shared schema, loaded by path because 'allowlist-schema.py' has a hyphen and cannot be a
# module name. importlib is the whole trick; the file is NOT renamed -- a rename would move the
# path every other gate, its own docstring and its git history point at, for a reason this file
# does not own. Resolved through REPO rather than sys.path, so a copy of this script run from
# outside a checkout fails on the missing module (a refusal, below) instead of quietly grading a
# tree nobody is standing in.
SCHEMA_PATH = os.path.join(REPO, "scripts", "allowlist-schema.py")
_schema = None


def allowlist_schema():
    """The shared validator module, imported once and cached.

    A failure to import is not survivable as a skip, so it raises AllowlistSchemaMissing through
    main()'s one handler rather than returning None and letting the caller decide what an
    un-checked document means.
    """
    global _schema
    if _schema is None:
        import importlib.util
        try:
            spec = importlib.util.spec_from_file_location("allowlist_schema", SCHEMA_PATH)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        except Exception as exc:
            raise AllowlistSchemaMissing(
                f"{SCHEMA_PATH} could not be loaded as the shared allowlist schema "
                f"({type(exc).__name__}: {exc}), so this gate cannot say whether the document it "
                f"read is an allowlist at all. That is a refusal, not a pass: the alternative is "
                f"grading a top-level JSON list as though the two readers of this file had never "
                f"disagreed about what a document is.")
        _schema = module
    return _schema


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
    # WHAT IS ASKED is this reader's own policy and stays so: the required sections are the ones
    # --shell named, never the writer's KNOWN_SECTIONS. A file that carries desktop and tablet and
    # no dev_mock is complete for this gate, and asking it for a section it never reads would turn a
    # graded exit 1 with FAIL: into an ungraded exit 2 -- a refusal invented by the schema, over a
    # document this run can grade perfectly well.
    filename = os.path.basename(path)
    wanted = tuple(s for s in ([s for s in shells if s] or list(SHELL_SECTIONS)))
    # WHAT IS ANSWERED is shared: one document, one schema, one set of words. Two gates reading
    # the same file each decided for themselves what a valid allowlist is, and the repo therefore
    # held two answers to one question -- the disagreement table in scripts/allowlist-schema.py
    # records the rows. Adopting validate() removes the second definition without moving a verdict
    # or a count here.
    schema = allowlist_schema()
    refusals = schema.validate(allow, wanted, filename)
    # ONE sentence, raised, never two joined: primary() is the first refusal and validate() orders
    # mistyped before absent, which is exactly what this function did by hand -- it raised on the
    # mistyped section and never reached the absent check. Joining the list would keep the exit code
    # and change the words, and a refusal's wording is the operator's diagnosis.
    top = schema.primary(refusals)
    if top is None:
        return
    # The classes are the shared module's; the exception is this gate's, so main()'s single
    # AllowlistUnreadable handler, its error: voice and its exit 2 are untouched by the adoption.
    raise AllowlistWrongShape(top.sentence)


# A wrapper is an EXPORTED function whose body reaches loggedInvoke. Two idioms write that, and
# for its whole life this pattern saw only one of them:
#
#     export const name = (args): Ret => loggedInvoke<T>('cmd', {...});   // the arrow form
#     export async function name(args): Promise<Ret> {
#       return loggedInvoke('cmd');                                       // the function form
#
# The comment above used to describe the first as THE form, and 27 of the 30 allowlisted names
# that resolved to nothing were written the second way (ui/src/api/license.ts:34-35 and
# workspaces.ts:83-86 are two of them). The gate could not see those wrappers, so it reported the
# commands they wrap as having no call site to find -- 'clean', at exit 0, with the call site in
# plain sight. A pattern that matches nothing is not a conservative pattern, it is a silent one,
# and this file has now spent three guards on exactly that distinction.
#
# The other half of the blindness was the span. '[^;]*?' stopped at ANY semicolon between the
# name and the invoke, and a semicolon in that span is ordinary TypeScript, not a statement
# boundary: an inline param type ('args: { userId: string; sku: string }', products.ts:213) and an
# early-return guard ('if (!sessionToken) { return Promise.reject(...); }' ahead of the invoke,
# settings.ts:279-282) each put one there. So delete_product and set_settings_scoped were invisible
# while a plain one-line arrow was found.
#
# Tolerating ';' is only safe if the span still cannot walk into the NEXT declaration: a pattern
# that pairs one wrapper's name with another wrapper's command turns every call site of the first
# into a violation blamed on the second shell. That is THE failure mode of this change, and the
# tempered token below is the guard -- the span now consumes anything (semicolons included) but
# stops dead at another 'export', so two declarations can never share one command and one
# declaration can never borrow its neighbour's. Verified on the real tree, not by inspection:
# every (command, wrapper) pair the widened pattern adds names a declaration whose own body is
# where that loggedInvoke sits, and the pairs the old pattern already found are unchanged.
#
# One allowlisted name still resolves to nothing after this and is expected to:
# 'rotate_encryption_key'. There is no wrapper because the command was ungated and deleted
# (ui/src/api/security.ts:29-36 says so in its own voice), which makes the entry stale in the
# allowlist rather than invisible to this file. It is named here instead of special-cased in
# code: a gate that forgives one known name on a ratio it does not read is a gate starting to
# own a threshold it was told not to invent.
WRAPPER_RE = re.compile(
    r"export\s+(?:async\s+)?(?:const|let|var|function)\s+(\w+)"
    r"(?:(?!export\s+(?:async\s+)?(?:const|let|var|function)\b).)*?"
    r"loggedInvoke(?:<[^>]*>)?\(\s*'(\w+)'", re.S)

# An ADR #7 conditional: the scoped twin appears before this call, within a few lines.
#
# The '?' in the first arm is the ternary's '?' and nothing else. It used to be ANY '?', and the
# two characters that look like one and are not are the two commonest null-handling idioms in
# this front end: '??' (a nullish DEFAULT) and '?.' (an optional chain). \s*\? matched the FIRST
# question mark of '??', so the window
#
#     const token = sessionToken ?? '';
#     ...  await getActiveStockAlerts(token, ...)          // ProductManagementScreen.tsx:121-125
#
# was certified guarded by the very expression that supplies the token's ABSENCE as a value.
# A null default is the opposite of a test: it guarantees the call happens, with '' or null, on
# the shell that must not make it. Measured before this comment was written: the classifier
# returned True for 'sessionToken ?? null' three times in the real tree, at
# WorkspaceInventorySettings.tsx:97, WorkspaceKdsSettings.tsx:136 and
# WorkspaceRestaurantPosSettings.tsx:114, and each of those calls is now reported. The same fix
# in the other direction is the bail arm below, which is why both changes are in this one regex
# group and NOT in one behaviour: a '?', a bail and a Scoped call are three different facts.
GUARD_RE = re.compile(
    r"(?:sessionToken|token)\s*\?(?![?.])"      # a ternary on the token, not '??' or '?.'
    r"|(?<![?.])\?\s*(?:await\s+)?\w+Scoped\s*\(", re.S)

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
    r"|\b(?:sessionToken|token)\s*\?(?![?.])"
    r"|\b(?:sessionToken|token)\s*(?:!==|!=|&&|\|\|)")
SCOPED_CALL_RE = re.compile(r"\b\w+Scoped\s*\(")


# The repo's other guard spelling, and the one this classifier used to get backwards. A negated
# bail -- 'if (!sessionToken) { return; }', or the braceless 'if (!token) return;' -- means every
# line after it runs ONLY with a truthy token, which is the same promise the ADR #7 ternary makes.
# It is carried in 54 files here, and the classifier answered False for it: the token arm wanted a
# '?' and the Scoped arm wanted a Scoped call, and a bail has neither. So the shape this front end
# writes most often to say 'I checked' was the one shape the gate could not see, while '??', which
# says the opposite, was seen. Both directions of one missing idea, and they stay two behaviours:
# nullish/optional-chain no longer counts, a dominating bail does.
#
# 'Dominating' is the load-bearing word and it is computed rather than assumed: the bail counts only
# if the block that contained it is still open at the call. That is what the depth walk decides.
# If the depth ever drops below the bail's own depth between the bail and the call, the bail's
# function or block ended and the call belongs to someone else -- which is precisely the case a
# text search for 'return' would wave through, since a callback that bails on a null token does
# nothing at all to protect an ambient call forty lines later in the enclosing component.
# Depth is counted over comment-stripped source, so a brace inside a string literal can skew the
# walk; skewing means the bail is NOT believed, which is the direction that reports rather than
# hides.
#
# WHAT IT COST, measured on this tree the night it landed, because the cost is a claim about the
# front end and not about this regex: the nullish/chain change alone moved the finding count UP
# (130 to 135, five sites, the direction a widening should move in). The bail arm then cleared 28
# of the 130 -- 54 files carry the idiom, and a dominating bail is the statement form of the same
# ADR #7 promise -- so the two changes together reported 105. One of the 28 had become visible
# only hours earlier (StaffDetailDrawer.tsx:354, bailed at 349-351), and 11 of them are windows
# whose only Scoped call belongs to a DIFFERENT wrapper than the one being graded. Narrowing the
# arm to 'a dominating bail AND a Scoped call in the window' measures 116 instead of 105, which
# is why the two ideas stay two behaviours in two functions: that choice is ADR #7's owner's,
# answerable by editing one line here, and is not something to be decided quietly by the file
# that also prints the count.
BAIL_RE = re.compile(
    r"\bif\s*\(\s*!\s*(?:sessionToken|token)\b(?:\s*\|\|\s*[^)]*)?\)"
    r"\s*\{?\s*(?:return|throw)\b", re.S)


def _dominating_bail(window):
    """True when a negated token bail is still in force at the end of the window.

    The window's last line IS the graded call, so the only question is whether anything between
    the bail and that line closed the block the bail sat in. Answered with a brace-depth walk, not
    with a search: a bail inside a callback that has already returned to its caller guards nothing.
    """
    # The window's LAST line is the graded call, and depth at the call equals depth at the end of
    # the line before it, so the walk stops there. Reading the whole string instead would let a
    # trailing '}' -- the line that closes the function in every fixture, and in the tree -- look
    # like the bail's own block had ended, and every bail in this repo sits inside a function that
    # closes eventually. That mistake was caught by case 3 below, which stayed a violation.
    head = window.rstrip()
    cut = head.rfind("\n")
    if cut > 0:
        head = head[:cut + 1]
    for m in BAIL_RE.finditer(head):
        depth = 0
        bail_depth = None
        for i, ch in enumerate(head):
            if i == m.start():
                bail_depth = depth
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if bail_depth is not None and depth < bail_depth:
                    break
        if bail_depth is not None and depth >= bail_depth:
            return True
    return False


def _window_is_guarded(window):
    # Three independent facts make a window guarded, tested in the order that says the most first:
    # a negated bail dominating the call, an ADR #7 ternary, or an explicit token test that
    # reaches a Scoped call. None of them is 'the word token appeared nearby'.
    if _dominating_bail(window):
        return True
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


def require_gradeable_corpus(ui_dir, files):
    """Refuse a corpus of zero gradeable production files WHERE THE CORPUS IS BUILT.

    Called by audit() the moment production_files() answers -- before find_wrappers opens the
    api layer, before a single file body is read, and long before main() could print anything.
    This is the third member of the family this file has been closing tonight and the only one
    about the TREE rather than the allowlist: '{}' or '{"entries": []}' graded 612 files over
    zero command names, --shell '' graded the tree over zero shells, and each now refuses
    where its own value resolves. This one is the same shape one level out -- a walk that
    returns nothing is a verdict drawn from nothing.

    Measured tonight before this function existed, over three copies of this script sitting
    beside a copy of the allowlist so the shape guard cleared and only the corpus differed --
    no ui/ at all; ui/ present with ui/src empty; ui/src holding a README and nothing else.
    All three printed '0 production file(s) graded against ...' and then 'clean for desktop.'
    and exited 0. Three different accidents, one green. Printing the count was visibility, not
    a check: a run that reports its own nothing and returns 0 teaches a reader that the number
    is decoration. A missing ui/ was never guarded either -- the isdir check a reader might
    point at belongs to read_allowlist() and asks about the ALLOWLIST path, not the tree.

    The control is as load-bearing as the refusal. A populated corpus whose verdict happens to
    be zero violations is a claim about 612 files and MUST still grade: files non-empty means
    this returns before raising, whatever main() then decides. Zero files and zero findings are
    not the same zero -- only the first is nothing at all.
    """
    if files:
        return
    if not os.path.isdir(ui_dir):
        raise EmptyCorpus(
            'the corpus this gate grades is not there: ' + ui_dir + ' is not a directory, so '
            'the walk found 0 production files. That is not a clean tree, it is no tree -- the '
            'verdict is drawn FROM these files. REPO is derived from __file__ (the F-2 note at '
            'the top of this script), so a copy of this script living outside a checkout grades '
            'the tree beside it, not the one you are standing in. Run it from the repository '
            'root, and if this IS the root then the checkout is incomplete and nothing can tell '
            'you from here whether the code is clean.')
    on_disk = sum(len(found) for _root, _dirs, found in os.walk(ui_dir))
    raise EmptyCorpus(
        ui_dir + ' exists and holds ' + str(on_disk) + ' file(s), but 0 of them are gradeable '
        'production source: the walk drops __tests__, the ui/src/api layer this gate looks UP '
        'through, and every name that is not .ts or .tsx. Nothing was read, no wrapper was '
        'looked up and no call site could have been found, so a zero here is the absence of '
        'evidence and not evidence of absence. If you expected files, run this from the '
        'repository root; if the tree really is empty, this gate has nothing to say about it '
        'and says that instead of clean.')


def require_wrapper_surface(api_dir, cmd_to_wrapper, names_by_shell):
    """Refuse an api layer that resolves to zero command-to-wrapper pairs, BEFORE the verdict.

    Called from audit() the moment find_wrappers() answers -- before a single production file
    body is opened, and so before main() can print anything at all. This is the same law
    applied one level deeper than the corpus, and it took the corpus guard to expose it: with
    ui/src/api deleted from an otherwise populated tree, the allowlist cleared its shape guard,
    the walk found 3 gradeable production files, require_gradeable_corpus() cleared on them,
    and the run still printed 'clean for desktop.' at exit 0. Nothing was wrong with the
    corpus; the surface the corpus is graded AGAINST was gone, and every inner loop over
    cmd_to_wrapper.get(cmd, ()) silently iterated nothing.

    A non-empty walk over an empty lookup is not a smaller verdict, it is no verdict: the
    command names on one side and the wrappers that call them on the other are BOTH inputs to
    every finding this gate can make, and an empty map makes the intersection empty by
    construction, whatever the tree holds. So the refusal says which surface went missing, and
    how much grading it would have cancelled, because that number is the size of the blind
    spot and '3 files graded' was not.

    The distinction this file keeps everywhere still holds: a POPULATED surface whose verdict
    happens to be zero findings is a claim about the tree and it grades -- cmd_to_wrapper
    non-empty returns here before anything raises. What is refused is a surface that resolves
    to nothing, which is never a claim about call sites at all.
    """
    if cmd_to_wrapper:
        return
    pending = sum(len(names) for _shell, names in names_by_shell)
    per_shell = ", ".join(shell + ": " + str(len(names)) for shell, names in names_by_shell)
    if not os.path.isdir(api_dir):
        raise EmptyWrapperSurface(
            'the wrapper surface this gate grades is not there: ' + api_dir + ' is not a '
            'directory, so find_wrappers() returned an empty command-to-wrapper map. The corpus '
            'guard above cleared -- the walk found production files -- and that is exactly why '
            'this refusal is separate: every allowlisted command would look itself up in a map '
            'with nothing in it, iterated zero call sites apiece, and the run would still print '
            'a verdict. This run had ' + str(pending) + ' command name(s) awaiting that lookup '
            '(' + per_shell + '). Run it from the repository root; if the api layer has moved, '
            'this gate reads exactly one path and does not go looking for it.')
    ts_seen = sum(1 for _root, _dirs, found in os.walk(api_dir)
                  for fn in found if fn.endswith('.ts'))
    raise EmptyWrapperSurface(
        api_dir + ' exists and its ' + str(ts_seen) + ' .ts file(s) were read, but '
        'WRAPPER_RE matched 0 command strings, so the command-to-wrapper map is empty. A layer '
        'of ' + str(ts_seen) + ' source file(s) with no wrapper in it is not a clean api '
        'surface, it is a lookup table with no rows: ' + str(pending) + ' allowlisted command '
        'name(s) for this run (' + per_shell + ') would each resolve to zero wrappers and zero '
        'call sites, which is the same zero as an empty tree and reads the same on the page. '
        'If the wrapper syntax changed, the pattern in this file is the thing to fix -- not the '
        'run that reports clean while it matches nothing.')


def audit(shells, repo=REPO, allowlist=ALLOWLIST):
    """Return (violations, shape_problems, production_files_scanned, coverage).

    violations is [(shell, command, file, line, snippet), ...]; shape_problems is one
    sentence per allowlist member this gate could not turn into a command name. Both have to
    be empty for the gate to pass: an entry that was neither read nor refused is how a
    policy line stops enforcing while the output still says clean. The third value is how
    many production files the verdict was drawn from, printed by main() because a zero is a
    number a reader has to be able to see (F-2). coverage is one row per graded shell, (shell,
    names read, names that resolved to at least one wrapper), also printed by main() and also
    never read by anything that decides an exit code -- it is the second half of the same idea:
    after the refusal on an empty map, the thin map was the remaining way to grade nothing and
    look clean, and a ratio is the honest way to show it without owning a threshold.

    The allowlist argument is the seam F-1 asked for: which file to grade. It defaults to
    ALLOWLIST, so a bare run grades the checkout copy exactly as it did before the option
    existed.

    allow is put through require_allowlist_shape the moment it exists and before anything
    calls .get on it, so a file that parses as JSON but is not shaped like an allowlist ends
    the run there -- before the walk, before any verdict, and in a sentence rather than in a
    traceback out of allowlist_names.

    The corpus gets the same treatment from the other side: production_files() is asked, and
    require_gradeable_corpus() ends the run if the answer is empty, before find_wrappers() and
    before any file body is opened. Both surfaces a verdict is drawn from are verified at the
    moment they are built, and neither may be empty by accident -- the allowlist because
    payload.get() would invent an exemption list, the tree because an empty os.walk would
    invent a clean bill of health. So 'scanned' below is never 0 on a run that returns.

    The third surface gets the same treatment from the inside: find_wrappers() is asked, and
    require_wrapper_surface() ends the run if the map comes back empty, before a single
    production file body is opened. That one took the corpus guard to find -- with ui/src/api
    deleted the walk still found 3 files, so the corpus guard cleared, every command resolved
    to zero wrappers, and the run printed 'clean for desktop.' at exit 0. Three inputs now
    stand behind any verdict this function returns: a file that was read, a tree that was
    walked, and a wrapper map with rows in it. The per-shell names are hoisted above that
    guard (same call, same order) only so the refusal can state how much grading an empty map
    would have cancelled -- the hoist is why the sentence and the verdict cannot disagree
    about what was pending.
    """
    allow = read_allowlist(allowlist)
    require_allowlist_shape(allow, shells, allowlist)
    ui_dir = os.path.join(repo, "ui", "src")
    files = production_files(ui_dir)
    # Refused HERE, at the corpus build, before find_wrappers() opens the api layer
    # and before any file body is read. The order is the whole change: the walk used to happen
    # first, the zero was computed, and it was only ever PRINTED -- by which point main() had a
    # verdict in hand and returned 0 with it.
    require_gradeable_corpus(ui_dir, files)
    api_dir = os.path.join(ui_dir, "api")
    cmd_to_wrapper = find_wrappers(api_dir)
    shape_problems = []
    # The per-shell names are read HERE, before the surface guard and before any file body is
    # opened: the sentence that refuses needs to say how many command names an empty map would
    # have cancelled, and that count is exactly what the loop below would have iterated. Same
    # call, same arguments, same shell order -- hoisted, not duplicated, so the refusal and the
    # verdict cannot disagree about what was pending.
    names_by_shell = [(shell, allowlist_names(allow, shell, shape_problems, allowlist))
                      for shell in shells]
    require_wrapper_surface(api_dir, cmd_to_wrapper, names_by_shell)

    texts = {}
    for p in files:
        with io.open(p, encoding="utf-8", errors="replace") as fh:
            texts[p] = strip_comments(fh.read())

    violations = []
    for shell, names in names_by_shell:
        # Read through allowlist_names so an entry in the object form contributes its
        # command name here instead of reaching the lookup below as a dict.
        for cmd in names:
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
    # Coverage is counted HERE, from the same names_by_shell the loop above walked and the
    # same map it looked up in, so the printed ratio cannot disagree with the grading that
    # ran. It is returned, not printed: audit() has never written to stdout, and main() owns
    # the report's order. Each row is (shell, names read, names resolving to a wrapper).
    coverage = [(shell, len(names), sum(1 for cmd in names if cmd_to_wrapper.get(cmd)))
                for shell, names in names_by_shell]
    return violations, shape_problems, len(files), coverage


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


def describe_coverage(coverage):
    """One line: how many allowlisted names actually RESOLVED to a wrapper, and per shell.

    Informational by contract, not by accident: this prints a ratio and nothing in this file
    reads it back. No exit code branches on it, no threshold lives anywhere in the script. The
    distinction matters because the guard above refuses an api map with ZERO rows and a map
    with one row clears it, so a thin map has always been able to grade a genuinely missing
    command as clean -- case 19 of the wrapper self-test is exactly that shape, a wrapper for a
    command nobody allowlisted while the allowlisted command resolves to nothing. A threshold
    is a number somebody else owns, so it is not invented here. What is added is the
    legibility, on every run, printed beside the file count that made the last zero visible.

    Units are per-shell-per-name, which is the unit the audit loop itself works in: a command
    listed in both shells is looked up twice and counts twice. Resolving means the lookup found
    at least one wrapper, NOT that any wrapper was ever called. So N == M says every allowlisted
    name had a wrapper to search for; N < M says how many did not, and could not have produced
    a finding whatever the tree holds.
    """
    total = sum(count for _shell, count, _got in coverage)
    got = sum(hits for _shell, _count, hits in coverage)
    per_shell = ", ".join(shell + " " + str(hits) + " of " + str(count)
                         for shell, count, hits in coverage)
    return ("verify-scoped-reads: allowlisted names resolving to a wrapper: "
            + str(got) + " of " + str(total) + " (" + per_shell + ").")


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
    # '??' is a null DEFAULT, not a test of the token: this window guarantees the ambient call
    # runs, passing an empty string, on the shell that cannot register the command. The classifier
    # used to match the FIRST '?' of '??' and certify it guarded -- measured, three real sites
    # (WorkspaceInventorySettings.tsx:97, WorkspaceKdsSettings.tsx:136 and
    # WorkspaceRestaurantPosSettings.tsx:114) were being hidden by exactly this shape.
    ("a nullish default is not a token test",
     "const x = async () => {\n  const token = sessionToken ?? '';\n"
     "  const s = await getSale(id);\n};\n",
     True),
    # Same idea one character over: '?.' is an optional CHAIN. It reads a token, it does not
    # branch on one, so the call below it happens with or without a token.
    ("an optional chain is not a token test",
     "const x = async () => {\n  const label = sessionToken?.slice(0);\n"
     "  const s = await getSale(id);\n};\n",
     True),
    # The repo's own bail idiom, carried in 54 files: 'if (!sessionToken) return;' makes every
    # line under it a token-present line. The classifier answered False for it, because it wanted
    # a '?' or a Scoped call and a bail has neither -- the wrong direction as loudly as '??' was,
    # and the two are separate behaviours with separate cases rather than one clever regex.
    ("a negated token bail dominating the window is a guard",
     "const x = async () => {\n  if (!sessionToken) return;\n"
     "  const s = await getSale(id);\n};\n",
     False),
    # ...but a bail guards its own function, not the file it lives in. This is the case the depth
    # walk exists for: searching the window for 'if (!token) return' clears the second call too,
    # nine words away, and that callback tests nothing at all.
    ("a bail does not clear an ambient call in a different callback",
     "const a = async () => {\n  if (!token) return;\n"
     "  const s = await getSaleScoped(t);\n};\n"
     "const b = async () => {\n  const s = await getSale(id);\n};\n",
     True),
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


def _schema_self_test():
    """Cases 31-32: the ADOPTION, which is about who answers, not what the answer is.

    Both cases exist because a shared validator can be adopted in a way that changes behaviour
    while every refusal still looks right on the page. Case 31 is the adoption contract in one
    line: this gate asks for the sections --shell named, not for every section the writer owns,
    so a document carrying desktop and tablet and nothing else is a complete allowlist HERE and
    must grade -- refuse it because dev_mock is absent and this run silently stops grading
    anything. Case 32 is the drift pin: the sentence the operator reads is the shared module's
    own primary() output for the same document, compared byte for byte, because the moment the
    gate keeps a local copy of the wording the two definitions are back and the table in the
    module is fiction.
    """
    print("  verify-scoped-reads self-test / the shared schema is the one answering")
    failures = 0
    schema = allowlist_schema()

    only_shells = {"desktop": [], "tablet": []}
    try:
        require_allowlist_shape(only_shells, ("desktop",), ALLOWLIST)
        print("    ok   case 31 a document stating desktop and tablet and no writer-only "
              "section is complete for this reader and GRADES -- required comes from --shell, "
              "never from KNOWN_SECTIONS")
    except AllowlistWrongShape as exc:
        print(f"    FAIL case 31  the required set was widened: {exc}")
        failures += 1

    for doc, label in (([], "a top-level list"), ({"entries": []}, "foreign keys"),
                       ({"desktop": "abc"}, "a mistyped section")):
        shared = schema.primary(schema.validate(doc, ("desktop",), "probe.json"))
        try:
            require_allowlist_shape(doc, ("desktop",), "/tmp/probe.json")
            print(f"    FAIL case 32 {label} -- the gate accepted what the schema refuses")
            failures += 1
        except AllowlistWrongShape as exc:
            if str(exc) == shared.sentence:
                print(f"    ok   case 32 the refusal for {label} is the shared module's "
                      "sentence, byte for byte -- no local copy to drift")
            else:
                print(f"    FAIL case 32 {label} wording diverged:\n"

                      f"           gate:   {str(exc)[:120]}\n           shared: "
                      f"{shared.sentence[:120]}")
                failures += 1
    return failures

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


def _wrapper_self_test():
    """Cases 17-20: the WRAPPER surface, which is the same zero one level deeper.

    The corpus guard landed and this file's own case 16 then found the hazard from the other
    side: a temp checkout with a populated ui/src and no ui/src/api cleared every guard in
    the chain and still reported on nothing. Measured again after the guard landed -- delete
    the api layer from an otherwise healthy tree and the run prints
    'clean for desktop.' at exit 0 on 2-3 graded files, because the corpus is not what went
    missing; the surface the corpus is graded against is.

    Each case pins the SENTENCE, not the number: an exit 2 is shared by five refusals, and
    reading a generic 2 as 'my guard fired' is exactly the mistake this file's history has
    made twice. So case 17 forbids the corpus wording, and case 18 asks for the words only
    the wrapper arm can print. Case 19 is the control that keeps the guard from being
    satisfied by a tree with no api layer at all -- the same fixture plus one wrapper file
    must grade -- and case 20 is the one that keeps the refusal from becoming the verdict
    path: a populated surface that DOES find an unguarded call still returns 1 and still
    says FAIL, because 1 is the finding code and a guard that quieted it would be worse than
    the hole it closed.
    """
    print("  verify-scoped-reads self-test / the wrapper surface")
    failures = 0
    saved_defaults = audit.__defaults__

    def tree(root, api, cmd=None):
        src = os.path.join(root, "ui", "src")
        os.makedirs(os.path.join(src, "features"))
        with io.open(os.path.join(src, "features", "Thing.tsx"), "w", encoding="utf-8") as fh:
            fh.write("export const Thing = () => null;\n")
        if api:
            os.makedirs(os.path.join(src, "api"))
            body = ("export const zzProbe = (t: string) => loggedInvoke<any>('" + cmd
                    + "', { t });\n") if cmd else "export const nothing = 1;\n"
            with io.open(os.path.join(src, "api", "probe.ts"), "w", encoding="utf-8") as fh:
                fh.write(body)
        return os.path.join(src, "api")

    def drive(root, allowlist):
        buf, ebuf = io.StringIO(), io.StringIO()
        saved, saved_err = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = buf, ebuf
        try:
            audit.__defaults__ = (root, ALLOWLIST)
            rc = main(["--allowlist", allowlist])
        except BaseException as exc:
            rc = "bare " + type(exc).__name__ + ": " + str(exc)
        finally:
            sys.stdout, sys.stderr = saved, saved_err
            audit.__defaults__ = saved_defaults
        return rc, buf.getvalue() + ebuf.getvalue()

    probe = os.path.join(tempfile.mkdtemp(prefix="oz-scoped-surface-"),
                         "allowlist.json")
    with io.open(probe, "w", encoding="utf-8") as fh:
        json.dump({"desktop": ["zz_probe_cmd"], "tablet": []}, fh)

    for kind, api, cmd, label, want, forbid in (
            ("no-api", False, None,
             "case 17 a populated corpus with NO ui/src/api",
             ["wrapper surface", "is not a directory",
              "1 command name(s) awaiting that lookup", "desktop: 1"],
             ["0 of them are gradeable", "clean for", "production file(s) graded"]),
            ("empty-api", True, None,
             "case 18 a ui/src/api whose .ts files hold no wrapper at all",
             ["WRAPPER_RE matched 0 command strings",
              "1 allowlisted command name(s) for this run", "desktop: 1"],
             ["0 of them are gradeable", "clean for", "production file(s) graded",
              "is not a directory"]),
    ):
        root = tempfile.mkdtemp(prefix="oz-scoped-surface-")
        tree(root, api, cmd)
        try:
            rc, out = drive(root, probe)
        finally:
            import shutil
            shutil.rmtree(root, ignore_errors=True)
        lines = [ln for ln in out.splitlines() if ln.strip()]
        said = all(w in out for w in want)
        quieted = [w for w in forbid if w in out]
        if (rc == 2 and said and len(lines) == 1
                and lines[0].startswith("error: ") and not quieted):
            print(f"    ok   {label} -- refused at exit 2 by the WRAPPER arm: it says "
                  f"{want[0]!r}, not the corpus, and prints no verdict")
        else:
            print(f"    FAIL {label}  rc={rc!r}, says={said}, forbidden={quieted}")
            for ln in lines[:2]:
                print("           | " + ln[:150])
            failures += 1

    # Case 19: the same tree, one wrapper file added. Nothing about the corpus changed, so
    # the only thing that can move the answer is the surface -- and it must move, to a grade.
    root = tempfile.mkdtemp(prefix="oz-scoped-surface-")
    tree(root, True, "some_other_cmd")
    try:
        rc, out = drive(root, probe)
    finally:
        import shutil
        shutil.rmtree(root, ignore_errors=True)
    if rc == 0 and "clean for" in out and "error:" not in out:
        print("    ok   case 19 the same tree PLUS a populated api surface grades and returns "
              "its verdict -- the refusal was the empty map, not the small tree")
    else:
        print(f"    FAIL case 19  rc={rc!r} verdict={'clean for' in out} "
              f"error={'error:' in out}")
        for ln in out.splitlines()[:3]:
            print("           | " + ln[:150])
        failures += 1

    # Case 20: and a populated surface that FINDS something still spends the verdict code.
    root = tempfile.mkdtemp(prefix="oz-scoped-surface-")
    tree(root, True, "zz_probe_cmd")
    src = os.path.join(root, "ui", "src", "features")
    with io.open(os.path.join(src, "Uses.tsx"), "w", encoding="utf-8") as fh:
        fh.write("export const use = async () => {\n  await zzProbe(t);\n};\n")
    try:
        rc, out = drive(root, probe)
    finally:
        import shutil
        shutil.rmtree(root, ignore_errors=True)
    if rc == 1 and "FAIL: 1 unguarded ambient IPC call(s)" in out and "error:" not in out:
        print("    ok   case 20 a populated surface with a real violation still returns 1 and "
              "still says FAIL -- the refusal did not become the verdict path")
    else:
        print(f"    FAIL case 20  rc={rc!r} verdict=", repr(out[:120]))
        failures += 1
    if audit.__defaults__ != saved_defaults:
        print("    FAIL the wrapper self-test left audit()'s defaults rebound")
        failures += 1
    return failures

def _pattern_self_test():
    """Cases 26-30: the wrapper PATTERN, which is the surface every lookup is built from.

    The four groups above all ask what the gate does with a map it was handed. These ask
    whether the map is the right one, because the gate was blind in two specific ways and
    each blindness was invisible from inside the run: 27 of the 30 allowlisted names that
    resolved to nothing were written as 'export async function' and the pattern required
    'export const', and two more had a semicolon between the name and the invoke -- an inline
    param type, an early-return guard -- which the old '[^;]*?' span refused to cross. Both
    produced the same wrong output as a real absence: 'resolving to a wrapper: 26 of 27',
    and a clean verdict, and no way to tell the two apart on the page.

    Case 29 is the one that matters most and it asserts that NOTHING was found: widening a
    lazy span to admit semicolons also admits the next declaration, and a pattern that pairs
    one export's name with another export's command converts every call site of the first
    into a violation blamed on the second shell. The tempered token is the only thing standing
    between those two readings, so it gets a case whose pass condition is an empty set.
    """
    print("  verify-scoped-reads self-test / what counts as a wrapper")
    failures = 0

    def wrappers_from(body):
        root = tempfile.mkdtemp(prefix="oz-scoped-pattern-")
        with io.open(os.path.join(root, "one.ts"), "w", encoding="utf-8") as fh:
            fh.write(body)
        try:
            return find_wrappers(root)
        finally:
            import shutil
            shutil.rmtree(root, ignore_errors=True)

    for label, body, cmd, want in (
            ("case 26 the async-function idiom (license.ts:34-35), which the old pattern could "
             "not see at all",
             "/** Doc comment. */\nexport async function getLicenseStatus(): "
             "Promise<LicenseStatusDto> {\n  return loggedInvoke('get_license_status');\n}\n",
             "get_license_status", {"getLicenseStatus"}),
            ("case 27 a semicolon inside an inline param type (products.ts:213)",
             "export const deleteProduct = (args: { userId: string; sku: string }): "
             "Promise<void> =>\n  loggedInvoke('delete_product', { args });\n",
             "delete_product", {"deleteProduct"}),
            ("case 28 a semicolon from an early-return guard before the invoke "
             "(settings.ts:279-282)",
             "export const setSettingsScoped = (\n  sessionToken: string | null,\n"
             "  entries: Record<string, string>,\n): Promise<void> => {\n"
             "  if (!sessionToken) {\n    return Promise.reject(new Error('No token'));\n  }\n"
             "  return loggedInvoke<void>('set_settings_scoped', { sessionToken, entries });\n};\n",
             "set_settings_scoped", {"setSettingsScoped"}),
    ):
        got = wrappers_from(body).get(cmd, set())
        if got == want:
            print(f"    ok   {label} -- resolves {cmd!r} to {sorted(want)}")
        else:
            print(f"    FAIL {label}  got={sorted(got)} want={sorted(want)}")
            failures += 1

    two = ("export const MAX_ITEMS = 5;\n"
           "export const listThings = () => loggedInvoke('list_things');\n")
    got = wrappers_from(two)
    if got.get("list_things") == {"listThings"} and "MAX_ITEMS" not in got.get("list_things", set()):
        print("    ok   case 29 two declarations in one file, one with no invoke -- the span "
              "stops at 'export' and does not borrow its neighbour's command")
    else:
        print(f"    FAIL case 29  map={ {k: sorted(v) for k, v in got.items()} }")
        failures += 1

    # Case 30: and a wrapper declaration is not a call to the wrapper. The api layer IS walked
    # as production source here (see the ui/src/api exclusion note in production_files), so an
    # unguarded-looking 'export async function name(...)' sits in a graded file and would be
    # reported as a violation of its own definition if _is_call_site did not reject a leading
    # 'function'/'async' token. A tree whose ONLY occurrence of the name is the declaration must
    # therefore grade clean -- and clean here means the wrapper counted (1 of 1), not skipped.
    saved_defaults = audit.__defaults__
    root = tempfile.mkdtemp(prefix="oz-scoped-decl-")
    src = os.path.join(root, "ui", "src")
    os.makedirs(os.path.join(src, "api"))
    os.makedirs(os.path.join(src, "features"))
    with io.open(os.path.join(src, "features", "Blank.tsx"), "w", encoding="utf-8") as fh:
        fh.write("export const Blank = () => null;\n")
    with io.open(os.path.join(src, "api", "license.ts"), "w", encoding="utf-8") as fh:
        fh.write("export async function getLicenseStatus(): Promise<Status> {\n"
                 "  return loggedInvoke('get_license_status');\n}\n")
    al = os.path.join(root, "allowlist.json")
    with io.open(al, "w", encoding="utf-8") as fh:
        json.dump({"desktop": ["get_license_status"], "tablet": []}, fh)
    buf, ebuf = io.StringIO(), io.StringIO()
    saved, saved_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = buf, ebuf
    try:
        audit.__defaults__ = (root, ALLOWLIST)
        rc = main(["--allowlist", al])
    except BaseException as exc:
        rc = "bare " + type(exc).__name__ + ": " + str(exc)
    finally:
        sys.stdout, sys.stderr = saved, saved_err
        audit.__defaults__ = saved_defaults
        import shutil
        shutil.rmtree(root, ignore_errors=True)
    out = buf.getvalue() + ebuf.getvalue()
    if (rc == 0 and "FAIL:" not in out
            and "resolving to a wrapper: 1 of 1 (desktop 1 of 1)." in out):
        print("    ok   case 30 a file whose only mention of a wrapper is its own async "
              "declaration counts the wrapper and reports no call site")
    else:
        print(f"    FAIL case 30  rc={rc!r} findings={'FAIL:' in out}")
        for ln in out.splitlines()[:4]:
            print("           | " + ln[:150])
        failures += 1
    if audit.__defaults__ != saved_defaults:
        print("    FAIL the pattern self-test left audit()'s defaults rebound")
        failures += 1
    return failures

def _coverage_self_test():
    """Cases 21-25: the coverage line, whose numbers are pinned on synthetic trees.

    This group tests a PRINT, so the assertion is the exact string -- 'N of M' with the N and
    M this fixture was built to produce, counted by hand from the file below and not read back
    out of the gate. A line whose number came from the same code that prints it would prove
    nothing about the number.

    Case 21 is the shape the ninth guard could not see: a non-empty api map holding a wrapper
    for a command nobody allowlisted, with the allowlisted commands resolving to nothing. The
    surface guard clears on it, the run is clean, and the ONLY trace of the hole is this line
    saying 0 of 2. Case 25 is the other half of the contract: the line carries a shortfall
    while a real finding is reported at exit 1, so making coverage legible did not become a
    second verdict path and did not quiet the first one.
    """
    print("  verify-scoped-reads self-test / how much of the allowlist resolved")
    failures = 0
    saved_defaults = audit.__defaults__

    def build(names, wrapper_cmds, unguarded=None):
        root = tempfile.mkdtemp(prefix="oz-scoped-cov-")
        src = os.path.join(root, "ui", "src")
        os.makedirs(os.path.join(src, "api"))
        os.makedirs(os.path.join(src, "features"))
        probe_dir = os.path.join(root, "allowlist.json")
        with io.open(probe_dir, "w", encoding="utf-8") as fh:
            json.dump(names, fh)
        body = ""
        for i, cmd in enumerate(wrapper_cmds):
            body += ("export const wv" + str(i) + "_" + cmd + " = (t: string) => "
                     "loggedInvoke<any>('" + cmd + "', { t });\n")
        with io.open(os.path.join(src, "api", "probe.ts"), "w", encoding="utf-8") as fh:
            fh.write(body)
        if unguarded:
            with io.open(os.path.join(src, "features", "Uses.tsx"), "w",
                         encoding="utf-8") as fh:
                fh.write("export const use = async (t: string) => {\n  await " + unguarded
                         + "(t);\n};\n")
        return root, probe_dir

    def drive(root, allowlist, argv=()):
        buf, ebuf = io.StringIO(), io.StringIO()
        saved, saved_err = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = buf, ebuf
        try:
            audit.__defaults__ = (root, ALLOWLIST)
            rc = main(["--allowlist", allowlist] + list(argv))
        except BaseException as exc:
            rc = "bare " + type(exc).__name__ + ": " + str(exc)
        finally:
            sys.stdout, sys.stderr = saved, saved_err
            audit.__defaults__ = saved_defaults
        return rc, buf.getvalue() + ebuf.getvalue()

    def covered_line(out):
        hits = [ln for ln in out.splitlines()
                if "resolving to a wrapper" in ln]
        return (hits[0] if len(hits) == 1 else None)

    cases = (
        ({"desktop": ["zz_alpha", "zz_beta"], "tablet": []}, ["zz_unrelated"], None, (),
         "case 21 the case-19 shape -- a stray wrapper for a command nobody allowlisted, and "
         "the allowlisted two resolve to nothing",
         "verify-scoped-reads: allowlisted names resolving to a wrapper: 0 of 2 "
         "(desktop 0 of 2).", 0),
        ({"desktop": ["zz_alpha", "zz_beta"], "tablet": []}, ["zz_alpha"], None, (),
         "case 22 one of two allowlisted names has a wrapper",
         "verify-scoped-reads: allowlisted names resolving to a wrapper: 1 of 2 "
         "(desktop 1 of 2).", 0),
        ({"desktop": ["zz_alpha", "zz_beta"], "tablet": []},
         ["zz_alpha", "zz_beta"], None, (),
         "case 23 full coverage reads as full coverage",
         "verify-scoped-reads: allowlisted names resolving to a wrapper: 2 of 2 "
         "(desktop 2 of 2).", 0),
        ({"desktop": ["zz_alpha", "zz_beta"], "tablet": ["zz_gamma"]},
         ["zz_alpha"], None, ("--shell", "desktop,tablet"),
         "case 24 the per-shell breakdown is per shell, and the totals add up across shells",
         "verify-scoped-reads: allowlisted names resolving to a wrapper: 1 of 3 "
         "(desktop 1 of 2, tablet 0 of 1).", 0),
    )
    for names, wrappers, unguarded, argv, label, want, want_rc in cases:
        root, al = build(names, wrappers, unguarded)
        try:
            rc, out = drive(root, al, argv)
        finally:
            import shutil
            shutil.rmtree(root, ignore_errors=True)
        line = covered_line(out)
        after_surfaces = out.splitlines()[1:2] == [want] if out.splitlines() else False
        if rc == want_rc and line == want and after_surfaces and "error:" not in out:
            print(f"    ok   {label} -- prints exactly {want.split(': ', 1)[1]!r} above the "
                  f"verdict and STILL exits {rc}")
        else:
            print(f"    FAIL {label}  rc={rc!r} want={want!r} got={line!r} "
                  f"second-line={after_surfaces}")
            failures += 1

    # Case 25: a shortfall in the ratio while a REAL finding is on the page. Both facts have
    # to survive together -- the line must not become a verdict, and it must not eat one.
    root, al = build({"desktop": ["zz_alpha", "zz_missing"], "tablet": []}, ["zz_alpha"],
                      "wv0_zz_alpha")
    try:
        rc, out = drive(root, al)
    finally:
        import shutil
        shutil.rmtree(root, ignore_errors=True)
    line = covered_line(out)
    if (rc == 1 and line == "verify-scoped-reads: allowlisted names resolving to a wrapper: "
                      "1 of 2 (desktop 1 of 2)."
            and "FAIL: 1 unguarded ambient IPC call(s)" in out
            and out.index("resolving to a wrapper") < out.index("FAIL:")):
        print("    ok   case 25 a coverage shortfall printed beside a real finding still exits "
              "1 on the finding -- the ratio is above the verdict, never a second one")
    else:
        print(f"    FAIL case 25  rc={rc!r} line={line!r} verdict=",
              repr("FAIL: 1 unguarded" in out))
        failures += 1
    if audit.__defaults__ != saved_defaults:
        print("    FAIL the coverage self-test left audit()'s defaults rebound")
        failures += 1
    return failures

def _corpus_self_test():
    """Case 13-16: the CORPUS, which is the empty-corpus hazard one level further out.

    Everything the guard cases above plant is a bad allowlist in a good checkout. This group
    keeps the allowlist well-shaped -- case 8 already proves the checkout copy clears that
    door -- and hollows out the tree instead, because that is the remaining way this gate can
    report on nothing. Measured before require_gradeable_corpus() existed, over copies of this
    script sitting beside a copy of the allowlist so only the corpus differed: no ui/, empty
    ui/src, and ui/src holding a README each printed '0 production file(s) graded' plus
    'clean for desktop.' and exited 0.

    main() is driven for real, with audit()'s own defaults rebound through __defaults__ and
    restored in a finally: audit(shells, repo=REPO) captures REPO at definition, so rebinding
    the module global alone would grade the real checkout and the case would prove nothing.
    That is the same trick the sibling gate's writer cases play on ALLOWLIST_PATH, and it is
    the difference between testing the gate and testing a copy of it.

    Case 16 is the load-bearing control: a POPULATED corpus with genuinely nothing wrong in it
    must still grade and still print its verdict. A guard that refused every small tree would
    be a redder hazard than the one it closes, and it is the half of the line this file keeps
    everywhere -- stated-empty is a claim and gets graded; defaulted-empty is nothing and does
    not.
    """
    print("  verify-scoped-reads self-test / how big the corpus was")
    failures = 0
    saved_defaults = audit.__defaults__

    def drive(repo):
        buf, ebuf = io.StringIO(), io.StringIO()
        saved, saved_err = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = buf, ebuf
        try:
            audit.__defaults__ = (repo, ALLOWLIST)
            rc = main(["--allowlist", ALLOWLIST])
        except BaseException as exc:
            rc = "bare " + type(exc).__name__ + ": " + str(exc)
        finally:
            sys.stdout, sys.stderr = saved, saved_err
            audit.__defaults__ = saved_defaults
        return rc, buf.getvalue() + ebuf.getvalue()

    def hollow(kind):
        root = tempfile.mkdtemp(prefix="oz-scoped-corpus-")
        ui = os.path.join(root, "ui")
        src = os.path.join(ui, "src")
        if kind == "no-ui":
            pass
        elif kind == "empty-src":
            os.makedirs(src)
        elif kind == "docs-only":
            os.makedirs(src)
            with io.open(os.path.join(src, "README.md"), "w", encoding="utf-8") as fh:
                fh.write("nothing to walk here\n")
        elif kind == "populated-clean":
            # A corpus alone is not enough to reach the verdict any more, and this fixture is
            # the first place that showed up: with no ui/src/api the run now refuses on the
            # WRAPPER surface at exit 2, which is the ninth guard doing its job on a test that
            # meant to exercise the eighth. The api file below is the surface this case needs
            # to be out of the way -- and note the command it names is in the real allowlist,
            # so the surface is populated AND the verdict stays clean.
            os.makedirs(os.path.join(src, "features"))
            os.makedirs(os.path.join(src, "api"))
            with io.open(os.path.join(src, "api", "probe.ts"), "w", encoding="utf-8") as fh:
                fh.write("export const getActiveCart = (t: string) => "
                         "loggedInvoke<any>('get_active_cart', { t});\n")
            with io.open(os.path.join(src, "features", "Thing.tsx"), "w",
                         encoding="utf-8") as fh:
                fh.write("export const Thing = () => null;\n")
        return root

    for kind, label, want in (
            ("no-ui", "case 13 a checkout with no ui/ at all", "is not a directory"),
            ("empty-src", "case 14 a ui/src that exists and holds nothing",
             "0 of them are gradeable"),
            ("docs-only", "case 15 a ui/src holding only non-source files",
             "0 of them are gradeable")):
        root = hollow(kind)
        try:
            rc, out = drive(root)
        finally:
            import shutil
            shutil.rmtree(root, ignore_errors=True)
        lines = [ln for ln in out.splitlines() if ln.strip()]
        ok = (rc == 2 and len(lines) == 1 and lines[0].startswith("error: ")
              and want in out and "clean for" not in out
              and "production file(s) graded" not in out and "FAIL:" not in out
              and "Traceback" not in out)
        if ok:
            print(f"    ok   {label} -- refused at exit 2 in one error: line, no graded "
                  f"line and no verdict")
        else:
            print(f"    FAIL {label}  rc={rc!r}, says {want!r}={want in out}, "
                  f"graded-line={'production file(s) graded' in out}, "
                  f"verdict={'clean for' in out}")
            for ln in lines[:2]:
                print("           | " + ln[:150])
            failures += 1

    root = hollow("populated-clean")
    try:
        rc, out = drive(root)
    finally:
        import shutil
        shutil.rmtree(root, ignore_errors=True)
    # The count is PARSED, never asserted as a literal: this fixture's api file also lands in
    # the walk (the ui/src/api exclusion compares an unnormalized join against a normalized
    # root, so it does not fire on Windows), and a case that demanded exactly 1 would fail on
    # a number that is not the claim. The claim is nonzero -- a populated corpus grades.
    marker = " production file(s) graded"
    at = out.find(marker)
    head = out[:at].rsplit(': ', 1)[-1] if at > 0 else ""
    graded = head.isdigit() and int(head) > 0
    if rc == 0 and graded and "clean for" in out and "error:" not in out:
        print("    ok   case 16 a populated corpus with nothing wrong in it STILL grades and "
              "returns its verdict -- zero files is refused, zero findings is not")
    else:
        print(f"    FAIL case 16  rc={rc!r}, graded={graded}, verdict={'clean for' in out}")
        for ln in out.splitlines()[:3]:
            print("           | " + ln[:150])
        failures += 1
    if audit.__defaults__ != saved_defaults:
        print("    FAIL the corpus self-test left audit()'s defaults rebound")
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
    failures += _corpus_self_test()
    failures += _wrapper_self_test()
    failures += _coverage_self_test()
    failures += _pattern_self_test()
    failures += _schema_self_test()
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
        violations, shape_problems, scanned, coverage = audit(shells, allowlist=allowlist)
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
    # One line above EVERY verdict, clean or red, and it changes no code on any path: a ratio
    # nobody gates on is the difference between a thin map being legible and a thin map being
    # declared an error by the one file that does not own that number.
    print(describe_coverage(coverage))
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
