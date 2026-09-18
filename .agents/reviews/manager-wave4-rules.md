# Wave 4 shared rules (read fully before editing)

Repo C:/dev/ozpos, branch `main`. SHARED CHECKOUT with concurrent agents.

## Hard repo rules (AGENTS.md)
- NEVER create a branch, NEVER switch a branch, NEVER push.
- Version is locked at `0.0.37` - do not touch any version string anywhere.
- Use forward slashes in path arguments.
- Do NOT run any state-changing git command: no `git add`, no `git commit`, no `git stash`, no `--amend`, no
  `git checkout`/`restore`. The manager commits at the gate as ONE LINE with an explicit pathspec.
- Never leave anything staged. Use `git --no-optional-locks` for every git read.
- 43 tracked files are deleted in the worktree by ANOTHER SESSION (37 root `done-todo-*.md` moved into the
  untracked `.agents/archived/`, plus 6 `coder-N-journal.md`). Do not restore, touch, judge, or sweep them.
- `cargo fmt --all` is FORBIDDEN here: it reformats other agents' in-flight `.rs` files in the working tree.

## Do not rewrite dated history
`AGENTS.md` and `README.md` open with dated HTML audit stamps and `<!-- Amendment: ... -->` blocks. Those are
POINT-IN-TIME RECORDS: leave every number and claim inside them EXACTLY as written, even where it is now wrong -
that is the file's own convention and one amendment block in the file says so. Correct the LIVE prose, then append
your own new dated stamp/amendment note in the same house style recording what you changed, why, and how it was

## Rule added 2026-09-14 after a review finding (D7)
**D7 - a claim is its command, not its number.** When you write a number into a doc, the command printed beside it must
be run VERBATIM, as pasted, and must print that number. An equivalent command you chose yourself is not a substitute:
`ls ui/src/__tests__/* | wc -l` prints 575 while the (correct) claim is 572, because `ls dir/*` emits a `dir:` header
per non-empty subdirectory and omits dotfiles that `find -type f` counts. Same trap for `*.rs` globs that silently
include `*_tests.rs`. Manager gates now re-run the cited string from the file, not a paraphrase of it.