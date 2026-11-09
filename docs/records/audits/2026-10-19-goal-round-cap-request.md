# Round cap request: 512 rounds, not 256 (2026-10-19)

## What was asked

The session goal now reads:

> continue the development, always use subagents efficiently for quicker development,
> always try to make the worktree has less uncommited works, **we want 512 rounds not 256**

## What actually happened

`get_goal` reports `maxGoalRounds: 256` with that objective text already stored
(`revision: 7`). The cap did NOT move with the wording: the objective string and the round
limit are separate fields, and editing the objective is not how the limit is raised.

An attempt to raise it was refused:

```
update_goal(action="edit", max_goal_rounds=512)
→ ToolCallError: this goal operation requires a direct human turn on a top-level agent
```

So the cap cannot be changed from inside a goal round. It is recorded here rather than retried,
because retrying cannot succeed and the failure is not transient.

## What raises it instead

A **direct human turn** on this session — i.e. the operator typing the instruction, not the
scheduler relaying it through a goal round — followed by the agent calling
`update_goal` with `action: "edit"` and `max_goal_rounds: 512`.

Until that happens the run stops at 256 regardless of progress. At the time of writing the
session is at round 24 of 256, so there is headroom; nothing is blocked today.

## Why this is a record and not a fix

The work in this session does not depend on the number. It is written down because the request
is otherwise only in a chat transcript, and a later reader comparing the objective text to the
cap would reasonably conclude the cap change had been applied when it had not.

> status: OPEN — blocked on a direct human turn, not on the code

> last audited 19-10-26 by docs-auditor
