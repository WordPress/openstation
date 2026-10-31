---
name: factory
description: Run the software factory. Use when the user types /factory run, /factory issue <n>, /factory <feature>, or /factory rework <n>. The session that runs it becomes the one orchestrator for every job, building GitHub issues labeled `factory` through intake → spec → build → gate → review → approve, one PR per issue.
---

# Factory

You are the orchestrator for every job in this run. You start jobs, spawn
every agent, and call the factory's scripts. You never write code, specs,
reviews, decisions or `job.json` yourself: agents write their files, and
`factory/bin/job` is the only writer of `job.json`. When it refuses a move,
it says why; do what it says instead of working around it.

## The pipeline

```
intake (fable)     → ACCEPT (scope possibly changed) | NEEDS-INFO | REJECT, posted as an issue comment
route (script)     → reviewers + models from risk/surfaces via config.json
worktree           → factory/<job-id> from origin/<base_branch>
spec-writer (opus) → spec.md
builder            → commits; first round pushes + opens draft PR "Closes #<n>"
gate (script)      → checks.sh; FAIL → builder gets the log, no reviewers spawned
reviewers (routed) → parallel with CI (job ci), WAIT FOR ALL; CHANGES or red CI → builder → gate → … (max rounds)
approver (opus)    → APPROVE: job merge (sync, gate, then gh pr merge, or hand over when auto_merge is off)
                     ESCALATE: PR ready, decision as PR comment, label factory:needs-human
```

| Step    | Agent (`subagent_type`) | Model                          | Writes                                   |
| ------- | ----------------------- | ------------------------------ | ---------------------------------------- |
| intake  | `intake`                | its own (fable)                | `intake.md`                              |
| spec    | `spec-writer`           | its own (opus)                 | `spec.md`                                |
| build   | `builder`               | `agents.builder`               | `build.md`, commits, the PR              |
| review  | `reviewer-<r>`          | `agents.reviewers.<r>`         | `round-<N>/review-<r>.md`                |
| approve | `approver`              | its own (opus)                 | `decision.md`                            |

`agents` is in the job's `job.json`, written by `factory/bin/route`. Pass the
routed model as the Agent tool's `model`. Only the routed reviewers run.

Every agent reads `AGENTS.md` (or `CLAUDE.md`) for the repo's setup, its site,
its checks and its rules. Nothing repo-specific lives in this file.

## Files

`<repo>` is the main checkout (`git rev-parse --show-toplevel` from your
session). You stay there; agents work in the job's worktree.

```
<repo>/factory/config.json                     concurrency, rounds, labels, routing, ports
<repo>/factory/jobs/<job-id>/job.json          state, written only by factory/bin/job
<repo>/factory/jobs/<job-id>/issue.md          the issue, quoted (factory/bin/job writes it)
<repo>/factory/jobs/<job-id>/intake.md
<repo>/factory/jobs/<job-id>/spec.md
<repo>/factory/jobs/<job-id>/build.md
<repo>/factory/jobs/<job-id>/rework-<k>.md     from /factory rework
<repo>/factory/jobs/<job-id>/round-<N>/checks.md, review-<r>.md, merge-checks.md
<repo>/factory/jobs/<job-id>/decision.md
```

Read a job with `cat factory/jobs/<job-id>/job.json`. Its `worktree` and
`branch` are the job's paths.

### Prompts

Every agent prompt starts with the job's paths:
`Job folder: <repo>/factory/jobs/<job-id>/. Job: <job-id>. Worktree: <worktree>. Branch: <branch>.`
Below, `<paths>` stands for that sentence. Keep it exact: the cost figures
find a job's transcripts by `Job folder: <path>/`, and the builder's check hook
finds its job by `Job: <job-id>.`

The builder and the ux and ui reviewers also get the job's port, appended as
` Port: <port>.` With `n` the job number (`004` → 4), the port is
`ports.base + ports.step × n` from `config.json`. Every agent of a job shares
it: the job has one site. The gate keeps `port + 1` for its PHPUnit stack.
Both stacks are keyed to the job's worktree.

The factory needs Docker running and the `agent-browser` CLI. Check both
(`docker info`, `agent-browser --version`) before starting any job, and stop
with a clear message if either is missing: no job can pass the gate without
them.

Never paste issue text into a prompt. Agents read it from `issue.md`, where it
is quoted as data.

## Running jobs

Spawn every agent as a **background** subagent and keep going: start other
jobs' steps while one job's agents work. When an agent finishes, act on that
job's next step. Agents reply with one line; read their file for the rest.

Keep at most `concurrency` jobs active. A job is active from `job create` (or
resuming it) until it reaches `needs-info`, `needs-human`, `merged`,
`rejected` or `abandoned`. When one stops being active, start the next job from the queue.

Run every script from `<repo>`. Each prints one line; a non-zero exit with
`job:`, `gate:` or `route:` on stderr is a refusal or an error. Read it, fix
the cause if it's yours (a missing file, a step skipped), and otherwise stop
that job and tell the user.

### Step by stage

Do the step for the job's `stage`, then the next one.

**intake.** If `intake.md` doesn't exist, spawn `intake` with
`<paths> Issue: #<n>.` (there is no worktree yet; the paths still name it).
Then read its header:

- `DECISION: ACCEPT`: run `factory/bin/route <job-id>`, then
  `factory/bin/job advance <job-id> spec`. That posts the decision on the issue
  and creates the worktree.
- `DECISION: NEEDS-INFO`: `factory/bin/job advance <job-id> needs-info`.
- `DECISION: REJECT`: `factory/bin/job advance <job-id> rejected`.

**needs-info.** When the queue says `resume`, the author has replied:
`factory/bin/job advance <job-id> intake`, then do **intake**.

**spec.** In the worktree, run the fresh-checkout setup AGENTS.md gives. If it
fails, stop the job and tell the user. If `spec.md` doesn't exist, spawn
`spec-writer` with `<paths> Write the spec.` Then
`factory/bin/job advance <job-id> build` (round 1).

**build.** Spawn `builder` **named `builder-<job-id>`**, with the routed model
and `<paths> Build round <N>. Port: <port>.` When it finishes, read the first
line of `build.md`:

- `STATUS: READY`: `factory/bin/job advance <job-id> gate`, then do **gate**.
- `STATUS: BLOCKED`: `factory/bin/job advance <job-id> needs-human`.

**gate.** Run `factory/bin/gate <job-id>`.

- Exit 0 (`GATE: PASS`): `factory/bin/job advance <job-id> review`, then do
  **review**.
- Exit 1 (`GATE: FAIL`): `factory/bin/job advance <job-id> build`. If it
  refuses because this was the last round, `advance <job-id> needs-human`
  instead. Otherwise resume the builder with `SendMessage` to
  `builder-<job-id>`:
  `The gate failed round <N-1>: read factory/jobs/<job-id>/round-<N-1>/checks.md and checks.log. Fix it, commit, push, and update build.md for round <N>.`
  Then continue from **build**'s status check.
- Exit 2: the gate itself broke. Stop the job and tell the user what it said.

No reviewer runs on a failing gate.

**review.** Spawn every routed reviewer **in one message**, so they run in
parallel, each with its model and `<paths> Review round <N>.` (plus
` Port: <port>.` for `reviewer-ux` and `reviewer-ui`). In the same message,
start `factory/bin/job ci <job-id>` as a background command: it waits for the
PR's CI on this round's commit (up to `ci_timeout_minutes`) and writes
`round-<N>/ci.md`, whose first line is `CI: PASS`, `FAIL`, `TIMEOUT` or `NONE`.
Plugin Check and the PHP matrix run only there.

**WAIT FOR ALL**, reviewers and CI. Each time one finishes, run
`factory/bin/job sync <job-id>` so the dashboard fills in. The round is done
only when every routed reviewer's file and `ci.md` exist. Never resume the
builder mid-round. If a reviewer finishes without its file, or `sync` shows
`invalid`, spawn it once more; if it fails again, stop the job and tell the
user. Then:

- every review `PASS` and `CI: PASS`: `factory/bin/job advance <job-id> approve`,
  then do **approve**.
- `CI: TIMEOUT` or `CI: NONE`: `factory/bin/job advance <job-id> needs-human`.
  Never re-run CI yourself.
- any `CHANGES`, or `CI: FAIL`: `factory/bin/job advance <job-id> build`, or
  `needs-human` when it refuses because the rounds are used up. A red CI counts
  as a failed round. Otherwise resume `builder-<job-id>` with
  `Round <N-1> is in factory/jobs/<job-id>/round-<N-1>/: address every review with VERDICT: CHANGES and, if ci.md says CI: FAIL, the failing checks. Commit, push, and update build.md for round <N>.`
  and continue from **build**'s status check.

**approve.** Spawn `approver` with `<paths> Final round: <N>. PR: #<pr>.`
Then read the first line of `decision.md`:

- `APPROVE`: `factory/bin/job merge <job-id>`. It syncs the branch with the
  base branch, gates it again, and merges the PR, or, with `auto_merge` off,
  marks it ready and hands it to the user. Any failure lands the job in
  `needs-human` with the reason posted on the PR.
- `ESCALATE`: `factory/bin/job advance <job-id> needs-human`.

**merging.** A run stopped mid-merge: `factory/bin/job merge <job-id>`.

**needs-human, merged, rejected, abandoned.** Nothing to do. `factory/bin/job queue`
moves a `needs-human` job to `merged` once its PR is merged on GitHub, and a
waiting job to `abandoned` once its PR is closed unmerged or its issue is
closed. Both tear down its stacks and remove its worktree; neither posts
anything.

### Resuming

State is files, so a new run picks every job up from its stage. An agent from
an earlier session can't be resumed, so:

- **build**: spawn a fresh `builder-<job-id>` with
  `<paths> Build round <N>. Port: <port>. You are resuming an interrupted round: read build.md, the round folders and any rework-*.md, check the branch, and finish the round.`
- **review**: spawn only the routed reviewers whose `round-<N>/review-<r>.md`
  is missing, and run `factory/bin/job ci <job-id>` again unless `ci.md` is
  there for the branch's current commit.
- **intake**, **spec**, **approve**: if the agent's file is already there and
  newer than the files it reads, act on it; otherwise spawn the agent.
- **gate**: run the gate again.

## /factory run

Drain the queue. Run `factory/bin/job queue`. It prints one tab-separated line
per labeled issue and per unfinished job: `action issue job stage note`.

- `new`: `factory/bin/job create <issue>` prints the job id; then do
  **intake**.
- `resume`: do the job's step for its stage.
- `wait`, `skip`: leave it, and list it in the summary with its note.

Start up to `concurrency` jobs, oldest issue first, and keep the slots full
until no `new` or `resume` line is left. Then run `factory/bin/job queue` once
more, in case issues were labeled during the run, and finish with **Summary**.

## /factory issue <n>

Run that one issue now, ignoring `concurrency`: `factory/bin/job create <n>`
if it has no job (the issue must be open and labeled), otherwise resume its
job from its stage.

## /factory <feature>

Create the issue, then run it. Title: the feature in a few words. Body: the
user's words, verbatim.

```bash
gh issue create --title "<title>" --body "<feature>" --label factory
```

Then do **/factory issue** with the number it printed.

## /factory rework <n>

For a `needs-human` job whose PR (or issue) the user has commented on.
`factory/bin/job rework <n>` collects the user's comments since the
escalation into `rework-<k>.md` and moves the job to `build` for a new round,
with a fresh set of rounds. Spawn a fresh `builder-<job-id>` with
`<paths> Rework: read rework-<k>.md and address it, then commit, push, and update build.md for round <N>. Port: <port>.`
and continue from **build**'s status check.

## Reporting

Keep the user posted with one short line per transition, for example
`004-dark-mode-toggle: round 2, gate PASS, code CHANGES, ux PASS → resuming builder`.

When a job reaches `needs-human`, say which job, link the PR, and quote the
first lines of `decision.md` (the question the approver needs answered). The
worktree stays, and its site may still be running on the job's port.

### Summary

At the end of the run, print `factory/bin/job summary`: every job with its
issue, stage, PR, cost and time, and the total. Then one line per job that
needs the user, with the PR link and what it waits for. Cost is the
API-equivalent price of the factory's agents, not the user's bill.
