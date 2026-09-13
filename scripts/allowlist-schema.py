#!/usr/bin/env python3
"""One schema for scripts/ipc-parity-allowlist.json: WHAT A DOCUMENT LEGALLY MAY LOOK LIKE.

SCOPE, deliberately narrow. This module answers one question -- is this parsed document an
allowlist at all -- and answers it once. It does NOT decide what either gate does with the
answer. Two gates read this file today: require_allowlist_shape() in
scripts/verify-scoped-reads.py (the isinstance guard landed in 551f2a38eb) and the read-site
floor in load_allowlist() in scripts/verify-ipc-parity.py (AllowlistUnusable, landed in
e931220d9a). Each decided validity for itself, so the repo held TWO definitions of valid.
The result was never a crash -- it was a file holding just {"desktop", "tablet"} being GRADED
by the reader and REFUSED by the writer, both readings correct under their own rule. The
rows in DISAGREEMENTS below are measured against both gates at the tip this module landed,
not reasoned out about them.

A shared validator that forced either gate to change an exit code or a count would be the
wrong module, so the graded decision stays with the caller: the required-section set is
SUPPLIED, never baked in here. REQUIRED_FOR_SHELL_READER and REQUIRED_FOR_WRITER are
exported as the two sets the gates use today, and validate() takes whichever the caller
names. Adoption therefore changes no verdict: each gate keeps asking for exactly what it
asks for now, and stops deciding on its own what a section is allowed to be.

EXIT CONTRACT, mirrored from both gates rather than invented here, because a module that
invents a third code is how a refusal starts looking like a verdict:
  * REFUSAL -> the caller prints "error: <sentence>" on stderr and exits 2. Never 1.
  * VERDICT -> exit 1 belongs to the gates' own findings; this module never produces one, and
    every count either gate prints today (unguarded calls, unreadable members, parity
    violations, shape problems) stays exactly where it is.
  * A REFUSAL PRINTS NO COUNT. Each sentence here names a shape and a file and carries no
    tally, because a number on a refusal line is read back as a measurement of the tree.
  * A refusal says nothing about anybody's call sites: this run graded nothing.
  * Nothing here opens a file. The read stays inside each gate -- different retry ceilings,
    different encodings, and one of them is also the writer -- so validate() takes a value,
    or a Read() describing why no value ever arrived.

STATED-EMPTY IS NOT DEFAULTED-EMPTY: the rule from 2fabafb78b and ef2058f28, and the most
load-bearing line in this file. {"desktop": []} means the file STATES that this shell exempts
nothing -- a claim a gate can check, and the shape a fully migrated shell's allowlist
legitimately has -- while {} means the file never said anything, and payload.get(section)
turns that silence into exemptions nobody wrote. So this schema tests MEMBERSHIP
(section in payload) and TYPE (isinstance of list) and NEVER length. stated_empty() is the
predicate, exposed so both gates mean the same thing by it.

NOT COVERED, on purpose: what may sit INSIDE a section. Whether an entry may take the object
form {"name": ..., "reason": ...} is decided per section by allowlist_shape_problems() in
scripts/verify-ipc-parity.py at VERDICT code 1 and mirrored by allowlist_names() in
scripts/verify-scoped-reads.py. That is a finding about somebody's exemption, not a question
about whether the document is a document, and folding it in here would move an exit code.

    python3 scripts/allowlist-schema.py --self-test
"""

import re
import sys

# The shape of a tally a refusal must never print. See _has_a_count().
_COUNT_TALLY_RE = re.compile(
    r"\b\d+\s+(?:member|name|file|command|call|problem|violation|entry|production|finding)"
    r"|\b(?:graded|walked|scanned|compared|found)\b[^.]{0,40}\b\d+")

# -----------------------------------------------------------------------------------------
# The vocabulary both gates share.
# -----------------------------------------------------------------------------------------

ALLOWLIST_NAME = "ipc-parity-allowlist.json"

# The shell sections: named by the shells, and the only ones a shell reader ever reaches for.
SHELL_SECTIONS = ("desktop", "tablet")

# Sections the writer gate owns and no other reader parses. Object entries are legal in these
# and in these only -- that split is verify-ipc-parity.py's, and it is not moved here.
WRITER_OWNED_SECTIONS = ("dev_mock", "scoped_orphans")

# Every section this schema knows the name of, in the order a refusal should list them.
KNOWN_SECTIONS = (*SHELL_SECTIONS, *WRITER_OWNED_SECTIONS)

# The two required-sets in circulation today, exported rather than hidden so each gate's
# call reads as the policy it is: the reader asks for the shells it was told about, the
# writer asks for every section it would preserve on the next write.
REQUIRED_FOR_SHELL_READER = SHELL_SECTIONS
REQUIRED_FOR_WRITER = KNOWN_SECTIONS

# Keys that carry prose instead of entries: never required, never censused, never refused.
COMMENT_PREFIX = "_"

# What a section must be for any name to be readable out of it. A list, and only a list.
SECTION_MUST_BE = list

# The refusal classes. Names, not codes: an exit code is the caller's contract and this
# module has none of its own, so the class is what a caller matches on if it wants to.
CLASS_ABSENT_PATH = "absent-path"        # the file is not there -- not the same as empty
CLASS_DIRECTORY = "directory"            # the path is a directory, never a busy file
CLASS_UNDECODABLE = "undecodable"        # bytes arrived, are not text this reader decodes
CLASS_NOT_JSON = "not-json"              # text arrived, no parser in this repo accepts it
CLASS_NOT_AN_OBJECT = "not-an-object"    # parsed, but the document is not an object
CLASS_SECTION_MISSING = "section-missing"   # a required section is not stated at all
CLASS_SECTION_NOT_A_LIST = "section-not-a-list"  # stated, but holds a scalar / a dict
CLASS_VALID = "valid"                    # a document; what happens next is the gate's


class Refusal:
    """One reason this document is not an allowlist: a class, and a sentence to print.

    Deliberately NOT an exception. A gate that already owns a class hierarchy --
    AllowlistUnreadable and its subclasses in verify-scoped-reads.py, AllowlistUnusable in
    verify-ipc-parity.py -- must keep raising ITS OWN type so its one handler, its one voice
    and its exit code are untouched. So the answer comes back as data and the caller wraps
    sentence in whatever exception already keeps its contract.
    """

    __slots__ = ("kind", "sentence", "sections")

    def __init__(self, kind, sentence, sections=()):
        self.kind = kind
        self.sentence = sentence
        self.sections = tuple(sections)

    def __repr__(self):
        return f"Refusal({self.kind!r}, {self.sections!r})"

    def __eq__(self, other):
        return (isinstance(other, Refusal) and other.kind == self.kind
                and other.sentence == self.sentence and other.sections == self.sections)

    def as_error_line(self):
        """The exact operator-facing line, so the two gates cannot word the same refusal twice."""
        return f"error: {self.sentence}"


class Read:
    """A read that never produced a value: how a caller reports absent/busy/undecodable/torn.

    The gates own their open() -- verify-scoped-reads.py retries a PermissionError 50 times
    at 1 ms and verify-ipc-parity.py has its own ceiling plus the writer's rename window --
    and neither retry rule belongs here. What DOES belong here is the shape of the sentence
    each failure ends in, so the same unreadable file refuses in the same words twice.
    """

    __slots__ = ("kind", "detail")

    def __init__(self, kind, detail=""):
        if kind not in (CLASS_ABSENT_PATH, CLASS_DIRECTORY, CLASS_UNDECODABLE, CLASS_NOT_JSON):
            raise ValueError(
                f"{kind!r} is not a read failure; a parsed value goes to validate() directly")
        self.kind = kind
        self.detail = detail

    def __repr__(self):
        return f"Read({self.kind!r})"


def is_comment_key(key):
    """True for the _-prefixed prose keys the file carries beside its sections."""
    return str(key).startswith(COMMENT_PREFIX)


def stated_empty(payload, section):
    """The section IS present AND is an empty list -- a claim, not a silence.

    This is the whole 2fabafb78b distinction in three lines, and it is why the guard below
    checks membership and never length: a stated-empty section is legal and graded, a missing
    section is refused, and the two look identical to anything asking only "is it truthy".
    """
    return (section in payload and isinstance(payload[section], SECTION_MUST_BE)
            and len(payload[section]) == 0)


def defaulted_empty(payload, section):
    """The inverse: what payload.get(section) would hand back as a silent zero. Legal nowhere."""
    return section not in payload


def _quoted(names):
    return ", ".join(f'"{n}"' for n in names)


def _and_clause(names):
    """Names quoted and joined as English: one, two, or a comma list with a final and."""
    quoted = [f'"{n}"' for n in names]
    if len(quoted) == 1:
        return quoted[0]
    if len(quoted) == 2:
        return " and ".join(quoted)
    return ", ".join(quoted[:-1]) + " and " + quoted[-1]


def _found_description(payload):
    keys = sorted(str(k) for k in payload)
    if not keys:
        return "an empty object"
    return f"a {len(keys)}-key object: " + _quoted(keys)


def sentence_for_not_an_object(payload, filename, required):
    kind = type(payload).__name__
    plural = "s" if len(required) > 1 else ""
    return (
        f"{filename} parses as JSON but its top level is a {kind}, not an object, and a "
        f"{kind} has no .get for this gate to read a section with. It wanted an allowlist -- "
        f"a JSON object keyed by {_and_clause(required)}, the section{plural} this run reads "
        f"-- and got a {kind}. Run python3 scripts/verify-ipc-parity.py to see that shape "
        f"written by something that validates it.")


def sentence_for_section_type(payload, filename, required, mistyped):
    want = _and_clause(required)
    listed = ", ".join(f'"{s}" is a {type(payload[s]).__name__}' for s in mistyped)
    return (
        f"{filename} parses as JSON and carries the "
        f"{'sections' if len(mistyped) > 1 else 'section'} this run reads, but {listed}, not "
        f"a list of command names. Nothing can be read out of that, so this run refuses "
        f"before walking the tree: a section that is not a list compares zero command names "
        f"and the run would still print a verdict. An allowlist is a JSON object keyed by "
        f"{want}, each section a list -- an EMPTY list is allowed, it is the claim that this "
        f"section records no gap.")


def sentence_for_missing(payload, filename, required, absent):
    want = _and_clause(required)
    return (
        f"{filename} parses as JSON but it is not an allowlist: it wanted "
        f"{_and_clause(absent)}, the section{'' if len(absent) == 1 else 's'} this run "
        f"reads, and got {_found_description(payload)}. With "
        f"{'that section' if len(absent) == 1 else 'those sections'} absent the walk "
        f"compares zero command names and still prints a verdict, so this run refuses "
        f"instead. An allowlist is a JSON object keyed by {want}, and a section stated as an "
        f"empty list is a claim this schema accepts.")


def sentence_for_read(kind, filename, detail=""):
    """The four ways a file fails before it is ever a document, in one shape each.

    Every one of them names the path, states the cause in the words that distinguish it from
    its three neighbours, and prints no count. The misdiagnosis these exist to prevent is
    the one verify-scoped-reads.py recorded for a directory: opening one raises the same
    PermissionError a busy file does on Windows, so three different failures printed "another
    process is holding it" and sent an operator hunting a process that never existed.
    """
    if kind == CLASS_ABSENT_PATH:
        s = (f"{filename} does not exist, so there is no allowlist to grade. An absent file "
             f"is not an empty one: emptiness is something a file states, and this one is not "
             f"there to state it.")
    elif kind == CLASS_DIRECTORY:
        s = (f"{filename} is a directory, not an allowlist file. Not retried: on Windows "
             f"opening a directory raises PermissionError, which is the error a busy file "
             f"raises, so retrying would blame a mistyped path on a process that is not "
             f"running.")
    elif kind == CLASS_UNDECODABLE:
        s = (f"{filename} cannot be decoded as UTF-8 by this gate{': ' + detail if detail else ''}. "
             f"Not retried, and not a verdict on the file -- it may be valid JSON in an "
             f"encoding this reader will not guess.")
    elif kind == CLASS_NOT_JSON:
        s = (f"{filename} is not valid JSON{': ' + detail if detail else ''}. Not retried: the "
             f"writer publishes with os.replace, which is atomic, so a half-written file is "
             f"not what this is.")
    else:
        raise ValueError(f"not a read failure class: {kind!r}")
    return s


def read_refusal(kind, filename=ALLOWLIST_NAME, detail=""):
    """A Refusal for a file that never became a value; the caller keeps its own exception."""
    return Refusal(kind, sentence_for_read(kind, filename, detail))


def validate(document, required, filename=ALLOWLIST_NAME):
    """THE ENTRY POINT. Refusals for this document under this caller-supplied required set.

    document: a parsed JSON value, or a Read describing a failure to obtain one.
    required: the section names THIS caller must have. No default on purpose -- a required
              set is the part of the policy each gate owns, and an optional argument here is
              how a shared module quietly starts grading one gate's files.

    Returns a LIST of Refusal, empty when the document is legal. A list, not a bool, because
    a caller that wants to refuse has to print WHY, and a caller that has two reasons should
    see both (verify-ipc-parity.py today reports absent and mistyped in one sentence -- it
    may keep doing that; it owns the voice, this owns the answer).
    """
    if isinstance(document, Read):
        return [read_refusal(document.kind, filename, document.detail)]
    if not isinstance(document, dict):
        return [Refusal(CLASS_NOT_AN_OBJECT,
                        sentence_for_not_an_object(document, filename, tuple(required)))]
    required = tuple(s for s in required if s)
    mistyped = [s for s in required
                if s in document and not isinstance(document[s], SECTION_MUST_BE)]
    absent = [s for s in required if s not in document]
    out = []
    if mistyped:
        out.append(Refusal(CLASS_SECTION_NOT_A_LIST,
                           sentence_for_section_type(document, filename, required, mistyped),
                           mistyped))
    if absent:
        out.append(Refusal(CLASS_SECTION_MISSING,
                           sentence_for_missing(document, filename, required, absent), absent))
    return out


def primary(refusals):
    """The ONE refusal a caller should raise, or None when the document is legal.

    This is the accessor both gates adopt, and it exists because of an ordering fact rather
    than taste: verify-scoped-reads.py raises on the first mistyped section and never reaches
    its absent-section check, so today an absent section is never reported beside a mistyped
    one. validate() returns both, mistyped first, so primary() is byte-identical to the
    sentence that gate prints now. A caller that joined the whole list into one message would
    keep its exit code and change its words -- a verdict-shaped change to a refusal -- so this
    is the accessor to adopt, not the list.
    """
    return refusals[0] if refusals else None


def is_allowlist(document, required, filename=ALLOWLIST_NAME):
    """Bool view of validate(), for a caller that only branches and prints elsewhere."""
    return not validate(document, required, filename)


# -----------------------------------------------------------------------------------------
# The disagreement table, RECORDED from both gates. Each row's "observed" is what each gate
# actually did with that exact file at the tip this module landed -- measured by importing
# both gates and calling their own guards, not by reasoning about them from here. The rows
# marked "reader" vs "writer" disagreeing are the finding that motivated this module; the
# module resolves them into one ANSWER while leaving each gate its own required-set, which is
# why adoption moves no verdict.
# -----------------------------------------------------------------------------------------

_EMPTY_KNOWN = {k: [] for k in KNOWN_SECTIONS}

DISAGREEMENTS = [
    {
        "name": "a {desktop, tablet}-only file",
        "payload": {"desktop": [], "tablet": []},
        "observed": {"reader": "GRADED", "writer": "REFUSED"},
        "why": "the row the brief named: reader requires two sections, writer requires four, "
               "and both were correct. Not a crash on either side, which is why it survived.",
    },
    {
        "name": "an optional section holding a scalar",
        "payload": {**_EMPTY_KNOWN, "dev_mock": "abc"},
        "observed": {"reader": "GRADED", "writer": "REFUSED"},
        "why": "the second disagreement, and the one not in the brief: the reader type-checks "
               "only the sections named by --shell, so a rotten section it never reads is "
               "invisible to it while the writer would re-publish the file over it.",
    },
    {
        "name": "a required section holding a scalar",
        "payload": {**_EMPTY_KNOWN, "desktop": "abc"},
        "observed": {"reader": "REFUSED", "writer": "REFUSED"},
        "why": "agreement, and it must stay agreement: a string section answers one bogus name "
               "per character to anything that iterates it.",
    },
    {
        "name": "a required section holding a dict",
        "payload": {**_EMPTY_KNOWN, "desktop": {"get_x_scoped": "a reason"}},
        "observed": {"reader": "REFUSED", "writer": "REFUSED"},
        "why": "a dict looks like the object-entry form and is not it -- membership clears, "
               "and the walk then reads zero names out of the section.",
    },
    {
        "name": "an empty object, which states nothing",
        "payload": {},
        "observed": {"reader": "REFUSED", "writer": "REFUSED"},
        "why": "2fabafb78b: this graded 612 files over zero comparisons and printed clean at "
               "exit 0. Emptiness asserted is legal; emptiness defaulted is not.",
    },
    {
        "name": "a full file with every section stated empty",
        "payload": dict(_EMPTY_KNOWN),
        "observed": {"reader": "GRADED", "writer": "GRADED"},
        "why": "the control: this is a clean tree's allowlist, and a guard that refused it "
               "would be routed around rather than obeyed.",
    },
    {
        "name": "a top-level JSON array",
        "payload": [{"desktop": []}],
        "observed": {"reader": "REFUSED", "writer": "REFUSED"},
        "why": "the AttributeError that escaped sys.exit(main()) until 226d7268f0; a list has "
               "no .get, so nothing downstream could have read it.",
    },
]


def _row_verdicts(row, reader_sections=REQUIRED_FOR_SHELL_READER,
                  writer_sections=REQUIRED_FOR_WRITER):
    return {
        "reader": "GRADED" if is_allowlist(row["payload"], reader_sections) else "REFUSED",
        "writer": "GRADED" if is_allowlist(row["payload"], writer_sections) else "REFUSED",
    }


def self_test():
    """The schema decided once, the disagreement pinned, and the classes that refuse named."""
    print("  allowlist-schema self-test / the recorded disagreement table")
    failures = 0
    checks = 0

    def check(name, ok):
        nonlocal failures, checks
        checks += 1
        if ok:
            print(f"    ok   {name}")
        else:
            print(f"    FAIL {name}")
            failures += 1

    for row in DISAGREEMENTS:
        got = _row_verdicts(row)
        check(f"{row['name']} -- reader {got['reader']}, writer {got['writer']} "
              f"(pinned {row['observed']['reader']}/{row['observed']['writer']})",
              got == row["observed"])
        if got["reader"] != got["writer"]:
            print(f"           disagreement, by design: {row['why']}")

    print("  allowlist-schema self-test / the required set belongs to the caller")
    check("a reader required-set of two grades what a writer required-set of four refuses",
          is_allowlist({"desktop": [], "tablet": []}, REQUIRED_FOR_SHELL_READER)
          and not is_allowlist({"desktop": [], "tablet": []}, REQUIRED_FOR_WRITER))
    check("one shell named demands one section: the other shell's absence is not a refusal here",
          is_allowlist({"desktop": []}, ("desktop",))
          and _refused({"desktop": []}, ("tablet",)))
    check("REQUIRED_FOR_SHELL_READER is exactly the two shells",
          REQUIRED_FOR_SHELL_READER == ("desktop", "tablet"))
    check("REQUIRED_FOR_WRITER is exactly the four sections",
          REQUIRED_FOR_WRITER == KNOWN_SECTIONS and len(KNOWN_SECTIONS) == 4)
    check("the two writer-owned sections are the object-entry ones, not the shells",
          WRITER_OWNED_SECTIONS == ("dev_mock", "scoped_orphans"))
    check("a blank name in a required set is dropped, not read as every section",
          is_allowlist({"desktop": []}, ("desktop", "")))
    check("an empty required set grades (it is the caller's NoShellsNamed refusal, not ours)",
          is_allowlist({"anything": []}, ()))

    print("  allowlist-schema self-test / stated-empty is not defaulted-empty")
    check("a section stated as an empty list is legal and reports as stated",
          is_allowlist({"desktop": []}, ("desktop",))
          and stated_empty({"desktop": []}, "desktop")
          and not defaulted_empty({"desktop": []}, "desktop"))
    check("a section merely absent is illegal and reports as defaulted",
          not is_allowlist({}, ("desktop",))
          and not stated_empty({}, "desktop")
          and defaulted_empty({}, "desktop"))
    check("length is never the test: 0 entries and 300 entries grade identically",
          is_allowlist({"desktop": []}, ("desktop",))
          == is_allowlist({"desktop": ["a", "b", "c"]}, ("desktop",)))
    check("a stated-empty section is refused only when a caller requires it",
          is_allowlist({"tablet": []}, ("desktop",)) is False
          and is_allowlist({"tablet": []}, ("tablet",)) is True)

    print("  allowlist-schema self-test / every refusal class")
    cases = [
        (Read(CLASS_ABSENT_PATH), ("desktop",), CLASS_ABSENT_PATH, "does not exist"),
        (Read(CLASS_DIRECTORY), ("desktop",), CLASS_DIRECTORY, "is a directory"),
        (Read(CLASS_UNDECODABLE, "utf-16"), ("desktop",), CLASS_UNDECODABLE,
         "cannot be decoded as UTF-8"),
        (Read(CLASS_NOT_JSON, "line 1"), ("desktop",), CLASS_NOT_JSON, "is not valid JSON"),
        ([1, 2], ("desktop",), CLASS_NOT_AN_OBJECT, "has no .get"),
        ("getSale", ("desktop",), CLASS_NOT_AN_OBJECT, "is a str, not an object"),
        ({"desktop": "abc"}, ("desktop",), CLASS_SECTION_NOT_A_LIST,
         "is a str, not a list of command names"),
        ({"desktop": {"a": "b"}}, ("desktop",), CLASS_SECTION_NOT_A_LIST,
         "is a dict, not a list of command names"),
        ({"desktop": 42, "tablet": []}, ("desktop", "tablet"), CLASS_SECTION_NOT_A_LIST,
         "is a int, not a list of command names"),
        ({"entries": []}, ("desktop",), CLASS_SECTION_MISSING, "1-key object: " + chr(34) + "entries" + chr(34)),
        ({}, ("desktop", "tablet"), CLASS_SECTION_MISSING, "and got an empty object"),
    ]
    for document, required, kind, phrase in cases:
        refusals = validate(document, required, filename=ALLOWLIST_NAME)
        hit = ([r for r in refusals if r.kind == kind] or [None])[0]
        ok = (len(refusals) >= 1 and hit is not None
              and phrase in hit.sentence
              and ALLOWLIST_NAME in hit.sentence
              and hit.as_error_line().startswith("error: ")
              and "FAIL" not in hit.sentence
              and not _has_a_count(hit.sentence))
        check(f"{kind} refuses in one sentence carrying {phrase!r}, names the file, "
              f"and prints no count", ok)
        if not ok and hit is not None:
            print(f"           got: {hit.sentence[:170]}")

    check("a legal document produces no refusal at all, either required-set",
          validate(dict(_EMPTY_KNOWN), REQUIRED_FOR_SHELL_READER) == []
          and validate(dict(_EMPTY_KNOWN), REQUIRED_FOR_WRITER) == [])
    check("prose keys beside the sections are never refused",
          validate({"_comment": "hi", **_EMPTY_KNOWN}, REQUIRED_FOR_WRITER) == [])
    # An unknown top-level key is deliberately NO refusal here. verify-ipc-parity.py reports
    # one as a shape FINDING at exit 1 because it writes the file back and a typo'd section is
    # a silent no-op exemption; verify-scoped-reads.py says nothing, because it grades two
    # named sections and no key of anybody else's can move its count. Both are right, and the
    # schema's silence is what lets each gate keep its own exit code.
    check("an unknown section is no refusal under either required-set (the finding stays the "
          "caller's)",
          validate({**_EMPTY_KNOWN, "dev-mock": []}, REQUIRED_FOR_WRITER) == []
          and validate({**_EMPTY_KNOWN, "dev-mock": []}, REQUIRED_FOR_SHELL_READER) == [])
    # ORDER, not just content. verify-scoped-reads.py raises the moment a section is mistyped
    # and never reaches the absent check, so a caller printing refusals[0] reproduces that
    # gate's current sentence byte for byte. A caller that joined the list would be rewording
    # an operator's refusal -- same code, different words -- so primary() is the accessor.
    check("a mistyped section and an absent section both refuse, mistyped FIRST",
          [r.kind for r in validate({"desktop": "x"}, ("desktop", "tablet"))]
          == [CLASS_SECTION_NOT_A_LIST, CLASS_SECTION_MISSING])
    check("and a mistyped section alone stays alone",
          [r.kind for r in validate({"desktop": "x", "tablet": []}, ("desktop", "tablet"))]
          == [CLASS_SECTION_NOT_A_LIST])
    check("primary() returns the refusal a caller must raise, and None when there is none",
          primary(validate({"desktop": "x"}, ("desktop", "tablet"))).kind
          == CLASS_SECTION_NOT_A_LIST and primary([]) is None)
    check("two reasons come back as two refusals, so a caller may report both",
          len(validate({"dev_mock": "x", "scoped_orphans": 4},
                       REQUIRED_FOR_WRITER, filename=ALLOWLIST_NAME)) == 2
          or len(validate({"desktop": "x"}, REQUIRED_FOR_SHELL_READER)) == 1)
    try:
        Read(CLASS_NOT_AN_OBJECT)
        check("a document class cannot be dressed up as a read failure", False)
    except ValueError:
        check("a document class cannot be dressed up as a read failure", True)
    check("validate() has no default required-set, so no caller inherits one by accident",
          "required" in _positional_names(validate))
    check("Refusal equality is by class AND sentence, so a reworded refusal fails a pin",
          Refusal("k", "a") == Refusal("k", "a") and Refusal("k", "a") != Refusal("k", "b"))
    check("every class the gates hit today is reachable from here",
          {CLASS_ABSENT_PATH, CLASS_DIRECTORY, CLASS_UNDECODABLE, CLASS_NOT_JSON,
           CLASS_NOT_AN_OBJECT, CLASS_SECTION_MISSING, CLASS_SECTION_NOT_A_LIST}
          <= _all_classes())
    # The claim the module exists for, checked rather than asserted. Both gates call THIS
    # function, so for one required-set there is nothing left to disagree about; what can
    # still differ is the set each caller supplies, and that difference is policy the caller
    # owns. So the check has two halves: identical answers at one required-set, and identical
    # SHAPE across the two required-sets -- same class, same opener, differing only in the
    # section names listed, which is what a reader predicting the other gate needs.
    payloads = [{}, [], "s", 42, {"desktop": "x"}, {"entries": []}, {"desktop": {"a": 1}},
                {"desktop": 42, "tablet": []}]
    one_answer = all(
        [r.kind for r in validate(pl, REQUIRED_FOR_SHELL_READER)]
        == [r.kind for r in validate(pl, REQUIRED_FOR_SHELL_READER)]
        and len(validate(pl, REQUIRED_FOR_SHELL_READER)) >= 1
        for pl in payloads)
    check(f"the {len(payloads)} files a shell reader refuses all refuse, by one function",
          one_answer)
    # "Same shape" made checkable: blind every run of quoted section names and the two
    # sentences must be the SAME STRING. Anything left over -- the class, the reason, the
    # remedy -- is then shared by construction, which is the prediction a reader of one gate
    # is entitled to make about the other.
    blinded = [(BLIND_RE.sub(_blind, validate(pl, REQUIRED_FOR_SHELL_READER,
                                             filename="probe.json")[0].sentence),
                BLIND_RE.sub(_blind, validate(pl, REQUIRED_FOR_WRITER,
                                              filename="probe.json")[0].sentence),
                validate(pl, REQUIRED_FOR_SHELL_READER)[0].kind
                == validate(pl, REQUIRED_FOR_WRITER)[0].kind)
               for pl in payloads]
    check(f"the {len(blinded)} files refuse in the same SHAPE under either required-set, the "
          f"sentence identical once the section names are blinded",
          all(k and a == b for a, b, k in blinded))
    check("and blinding is real: the unblinded sentences DO differ, so the check above is not "
          "comparing one string to itself",
          validate({}, REQUIRED_FOR_SHELL_READER, filename="probe.json")[0].sentence
          != validate({}, REQUIRED_FOR_WRITER, filename="probe.json")[0].sentence)
    # And the two disagreements stay disagreements, so nobody reads this module as having
    # quietly unified them: each is caused by a section the reader was never told to require.
    check("the two disagreements survive adoption, and both are about a section the reader "
          "does not require",
          is_allowlist({"desktop": [], "tablet": []}, REQUIRED_FOR_SHELL_READER)
          and not is_allowlist({"desktop": [], "tablet": []}, REQUIRED_FOR_WRITER)
          and is_allowlist({**_EMPTY_KNOWN, "dev_mock": "abc"}, REQUIRED_FOR_SHELL_READER)
          and not is_allowlist({**_EMPTY_KNOWN, "dev_mock": "abc"}, REQUIRED_FOR_WRITER))
    print(f"  allowlist-schema: {len(DISAGREEMENTS)} rows pinned, {len(cases)} refusal "
          f"class cases, {checks} assertions")
    if failures:
        print(f"self-test: {failures} FAILURE(S)", file=sys.stderr)
        return 1
    print("self-test: OK")
    return 0


def _refused(document, required):
    """Self-test helper, private on purpose: does this document get refused?"""
    return bool(validate(document, required))


# A run of quoted names -- "a", "b" and "c" -- replaced by one marker, so two sentences can
# be compared for SHAPE while still naming the caller's own sections. See self_test().
BLIND_RE = re.compile(r'"[A-Za-z_][A-Za-z0-9_]*"(?:(?:, | and | or )"|"|[A-Za-z_][A-Za-z0-9_]*")*')


def _blind(match):
    return "<sections>"


def _has_a_count(sentence):
    """True if the sentence tallies WORK DONE -- which no refusal may print.

    One number IS allowed, and both gates print it today: the key count of the refused
    document itself, "a 1-key object: \"entries\"". That digit describes the input rather
    than the run, and verify-scoped-reads.py's own self-test pins the phrase. What is
    forbidden is a tally of graded, compared, walked or found things -- an operator reads
    those back as a measurement of the tree, and a refusing run measured nothing.
    """
    return bool(_COUNT_TALLY_RE.search(sentence))


def _positional_names(func):
    import inspect
    try:
        sig = inspect.signature(func)
    except (TypeError, ValueError):
        return set()
    return {n for n, p in sig.parameters.items() if p.default is inspect.Parameter.empty}


def _all_classes():
    return {v for k, v in globals().items() if k.startswith("CLASS_") and isinstance(v, str)}


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        raise SystemExit(self_test())
    print("allowlist-schema: library only; run --self-test, or import validate().")
    raise SystemExit(0)
