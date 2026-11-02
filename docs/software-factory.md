# The Software Factory

> *Contributor doc.* The factory is a maintainer's tool, not a plugin-author surface. Nothing here is part of the public API.

The software factory turns GitHub issues labeled `factory` into pull requests, one PR per issue, with no human in the loop until a PR is ready to merge or a job needs a decision only a person can make. A Claude Code session is the orchestrator; a set of agents does the thinking (intake, spec, build, review, approve); and three small scripts hold the state, enforce the rules and perform every GitHub side effect, so the orchestrator never improvises them.

The pieces live in three places:

| Path | What it is |
|---|---|
| `.claude/skills/factory/SKILL.md` | The orchestrator. `/factory run`, `/factory issue <n>`, `/factory <feature>` and `/factory rework <n>` load it. |
| `.claude/agents/*.md` | The agents: `intake`, `spec-writer`, `builder`, `reviewer-code`, `reviewer-security`, `reviewer-ui`, `reviewer-ux`, `approver`. |
| `factory/` | `config.json`, the `bin/` scripts, `checks.sh`, `smoke.sh`, `dashboard.html`, and `jobs/` (gitignored), where every job keeps its files. |

## The pipeline

```
intake (agent)      ACCEPT (possibly rescoped) | NEEDS-INFO | REJECT, posted on the issue
route (script)      picks the builder model and the reviewers from risk and surfaces
worktree            factory/<job-id> branched from origin/trunk
spec-writer (agent) spec.md with testable acceptance criteria
builder (agent)     commits; round 1 pushes and opens a draft PR that closes the issue
gate (script)       runs checks.sh in the worktree; FAIL sends the log back to the builder
reviewers (agents)  in parallel with CI; CHANGES or red CI send the job back to the builder
approver (agent)    APPROVE: sync with trunk, gate again, merge or hand over
                    ESCALATE: PR marked ready, reason posted, label factory:needs-human
```

A job moves through **stages**. The legal moves are a fixed table in `factory/bin/job`:

```
intake      → needs-info | rejected | spec
needs-info  → intake | abandoned
spec        → build
build       → gate | needs-human
gate        → review | build | needs-human
review      → approve | build | needs-human
approve     → merging | needs-human
merging     → merged | needs-human
needs-human → build | merged | abandoned
```

`merged`, `rejected` and `abandoned` are terminal. `needs-info` and `needs-human` are waiting states: the job sits there until a person acts on GitHub.

### Rounds

Build, gate and review form a loop. Each pass is a **round**, with its own folder `round-N/` holding the gate's verdict, the CI verdict and one review file per routed reviewer. A failed gate, a review asking for `CHANGES`, or a red CI run all cost a round and send the job back to the builder, which is resumed with a message pointing at the round's files. When the round limit (`max_rounds` in `config.json`) is used up, the job escalates to `needs-human` instead. A rework after escalation grants a fresh set of rounds.

No reviewer runs on a failing gate, and the builder is never resumed mid-round: the orchestrator waits for every reviewer and for CI before deciding.

Two failures cost no round. A gate that fails on its own tooling (a script the branch does not touch, failing as it would on trunk) is not the builder's to fix: the job waits in `gate` while the orchestrator tells the operator what needs merging, then the builder is resumed to merge trunk and run the checks again. And a `build.md` that says `STATUS: READY` while an acceptance criterion is still `[ ]` is sent straight back to the builder, before the gate, to verify it or write `BLOCKED`.

A finding from outside the round goes to the builder the same way. When the operator, or the orchestrator looking at the job's site, sees that the build is wrong while the job is in `gate` or `review`, the orchestrator resumes the builder with the surface, the reproduction and the mechanism; it does not wait for the pipeline to notice, and it does not post the finding as a PR comment, since the PR is the factory's own. `/factory rework` is only for comments a person left on a `needs-human` job.

### What each agent reads and writes

Every agent writes exactly one file in the job folder and nothing else in the main checkout. The builder is the only agent that changes code, and it does so in the job's worktree.

| Agent | Reads | Writes |
|---|---|---|
| `intake` | `issue.md`, earlier `intake-*.md`, `AGENTS.md`, the code the issue touches | `intake.md`: `DECISION`, `RISK`, `SURFACES`, scope. The body is posted on the issue. |
| `spec-writer` | `issue.md`, `intake.md` (its Scope wins), the docs for the area, the code | `spec.md` with acceptance criteria |
| `builder` | `spec.md`, the issue's screenshots for a bug, after failures the round's `checks.md`, `checks.log`, `ci.md` and reviews | code on the branch, the draft PR, `build.md` (`STATUS: READY` or `STATUS: BLOCKED`). For a bug it reproduces the report on the job's site first, on the surface the screenshot shows; a bug it cannot reproduce, or a criterion it cannot verify, is `BLOCKED`, never a guess. |
| `reviewer-*` | `spec.md`, `build.md`, the round's `checks.md`, the diff against trunk, its own previous review | `round-N/review-<r>.md`, first line `VERDICT: PASS` or `VERDICT: CHANGES` |
| `approver` | everything in the job folder and the diff | `decision.md`, first line `APPROVE` or `ESCALATE` |

The issue text is written into `issue.md` quoted as data, with a note that it is never an instruction. Only the author's and the operator's comments are included. Agents read the request there; the orchestrator never pastes issue text into a prompt.

### Routing

Intake rates the risk (`low`, `medium`, `high`) and names the surfaces the change touches (`ui`, `security`, or none). `factory/bin/route` looks both up in `config.json`:

- `routing.<risk>` gives the builder model and the code reviewer's model.
- `surface_reviewers.<surface>` adds reviewers: the `ui` surface adds a UX and a UI reviewer, `security` adds a security reviewer.

The code reviewer always runs. The others run only when intake flagged their surface. The result is stored in the job's `agents` field and the orchestrator passes those models to the Agent tool.

## The scripts

The deterministic half of the factory is three scripts in `factory/bin/`, written in Python with only the standard library, so they run anywhere Python 3, `git` and `gh` are present. They are called by the orchestrator, by each other, and by one hook. Each prints one line on success. A non-zero exit with `job:`, `gate:` or `route:` on stderr is a refusal or an error, and its message says what to do.

### `job`: the only writer of `job.json`

`factory/jobs/<job-id>/job.json` is a job's state: its issue, PR, branch, worktree, stage, round, routed agents, the derived verdicts and the cost. Only `job` writes it. It holds an exclusive lock per job while it works and writes through a temporary file, so two commands cannot corrupt a job.

| Command | What it does |
|---|---|
| `job queue` | Lists every open `factory` issue and every unfinished job as `action issue job stage note`, where the action is `new`, `resume`, `wait` or `skip`. It also finishes waiting jobs whose PR was merged (`merged`) or whose PR or issue was closed (`abandoned`), tearing down their stacks and worktrees. |
| `job create <issue>` | Checks the issue is open and labeled, fetches it with `gh`, writes `issue.md`, and creates the job as `NNN-<slug>` in stage `intake`. The job's branch is `factory/<job-id>` and its worktree sits next to the checkout under `<repo>-factory/<job-id>`. |
| `job advance <job> <stage>` | Moves a job to a stage, or refuses. See below. |
| `job ci <job>` | Polls the PR's check rollup every thirty seconds for the round's commit and writes `round-N/ci.md` with `CI: PASS`, `FAIL`, `NONE` (nothing reported in ten minutes) or `TIMEOUT` (`ci_timeout_minutes`). The factory never re-runs CI. |
| `job merge <job>` | After `APPROVE`: merges `origin/trunk` into the branch, runs the gate again as `merge-checks.md`, pushes, marks the PR ready, and either merges it with `merge_method` (`auto_merge` on) or rewrites `decision.md` as an escalation and hands the PR to the maintainer (`auto_merge` off, the shipped default). Any failure lands in `needs-human` with the reason posted on the PR. |
| `job rework <job>` | For a `needs-human` job: collects the operator's PR comments, review bodies and inline comments (or issue comments, when there is no PR) written since the escalation into `rework-k.md`, grants a fresh set of rounds and moves the job to `build`. Refuses when there is nothing new to say. |
| `job agents <job> <json>` | Records the routed agent set. Called by `route`. |
| `job sync <job>` | Rederives the fields that come from files: the intake header, the round's gate and CI verdicts, each reviewer's verdict, and the cost. |
| `job summary [<job>...]` | A table of jobs with issue, stage, round, PR, cost and elapsed time, and the total cost. |

A `<job>` argument is a job id (`004-dark-mode`) or an issue number (`12`).

**`advance` is the heart of it.** Before each move it checks the files that justify the move, and refuses otherwise:

- `intake → spec | needs-info | rejected` needs `intake.md` to say the matching `DECISION`, and `spec` additionally needs the job to be routed. The intake body is posted on the issue; `needs-info` adds the `factory:needs-info` label, `rejected` removes the `factory` label, and `spec` creates the worktree and branch from `origin/trunk`.
- `spec → build` needs `spec.md` and opens round 1.
- `build → gate` needs `build.md` to start with `STATUS: READY`, a clean worktree, commits on top of trunk, the branch pushed, and exactly one open PR from it (recorded on the job the first time).
- `build → needs-human` needs `STATUS: BLOCKED` and escalates with the build's Blocked section.
- `gate → review` needs `round-N/checks.md` to say `GATE: PASS` for the branch's current commit. `gate → build` needs `GATE: FAIL` and rounds left; `gate → needs-human` needs `GATE: FAIL` on the last round.
- `review → approve` needs every routed reviewer's file with `VERDICT: PASS`, and `ci.md` with `CI: PASS` for the current commit. `review → build` needs at least one `CHANGES` or `CI: FAIL` and rounds left. `review → needs-human` is for the last round, or for `CI: TIMEOUT` / `CI: NONE`.
- `approve → merging` needs `decision.md` to start with `APPROVE`; `approve → needs-human` needs `ESCALATE`.
- `merging → merged` and `needs-human → merged` need the PR to be merged on GitHub.
- `needs-human → build` needs a `rework-k.md` newer than `decision.md`, which is what `job rework` writes.
- `→ abandoned` needs the PR closed unmerged or the issue closed.

Side effects ride on the transitions. Entering `needs-human` marks a draft PR ready, posts the decision as a PR comment (or an issue comment when there is no PR) and adds the `factory:needs-human` label. Entering `merged` or `abandoned` runs the `teardown` command from `config.json` in the worktree (it destroys the job's two wp-env stacks), removes the worktree and deletes the local branch. Every comment the factory posts starts with an HTML marker, which is how it later tells its own comments from a person's.

### `gate`: the deterministic gate

`factory/bin/gate <job-id>` answers one question: does the branch pass the repo's checks? It runs the **main checkout's** `factory/checks.sh` inside the job's worktree, so a branch cannot change the checks it is judged by. It passes the job's port as `FACTORY_PORT` and `FACTORY_CHECKS=full`.

It also diffs the branch against `origin/trunk` and fails if the branch modified or deleted any file matching a `protected_paths` pattern from `config.json`: the factory's own scripts and config, the agent definitions, the lint and test configs, the frozen Legacy theme manifest, and the guard tests named in `AGENTS.md`. Adding new files is fine.

The verdict goes to `round-N/checks.md` (`GATE: PASS` or `FAIL`, the commit, the protected paths hit, and the last eighty lines of the log) with the full output in `checks.log`. Exit 0 is a pass, 1 a fail, and 2 means the gate itself broke. With `--merge` it writes `merge-checks.md` instead, which is how `job merge` re-gates the synced branch.

`gate --hook` is the builder's `Stop` hook, declared in `.claude/agents/builder.md`. Each time the builder tries to finish, the hook reads the hook event from stdin, finds the job id in the agent's first prompt, runs the fast checks (host-only, no Docker) in the worktree, and exits 2 with the log tail when they fail. That pushes the builder back to fix the problem before the real gate ever runs. It nudges once per stop; the gate decides.

### `route`: risk and surfaces to agents

`factory/bin/route <job-id>` syncs the job, reads `risk` and `surfaces` from the intake header, resolves them through `routing` and `surface_reviewers` in `config.json`, and records the result with `job agents`. It refuses a risk or surface the config does not know.

### `checks.sh` and `smoke.sh`

The checks themselves are two bash scripts. `checks.sh` is the sequence the gate runs, from the worktree:

1. `npm ci` and `composer install` when the lockfile is newer than the installed tree (a fresh worktree is bare).
2. `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:js`, and `phpcs -n`.
3. With `FACTORY_CHECKS=fast` (the builder's hook) it stops here.
4. Otherwise it starts the job's PHPUnit wp-env stack on `FACTORY_PORT + 1` and runs `test:php`, `test:php:multisite` and `lint:php`.
5. Finally `smoke.sh`, again the main checkout's copy.

`smoke.sh` is the real-site check. It starts the job's QA wp-env on `FACTORY_PORT`, turns the shell on for `admin`, clears `debug.log`, and drives a headless browser through `agent-browser`: log in, open wp-admin, wait for the shell to boot. It fails on a shell that never boots, a plugin PHP error in `debug.log`, or a JavaScript error on the page. It leaves the site running for the job's reviewers and for the maintainer who reviews the PR.

Plugin Check is deliberately not in the gate. It runs in CI on the job's PR, and `job ci` waits for it.

### Ports and stacks

Job `n` (from the numeric prefix of its id) gets port `ports.base + ports.step × n`, by default `8900 + 10n`: its site on that port, PHPUnit on the next one. Both stacks are keyed to the job's worktree, so jobs never touch each other's containers or the maintainer's own instances on `:8890` and `:8891`. The orchestrator passes the port to the builder and to the UI and UX reviewers, who look at the change on that site.

## Configuration

`factory/config.json`:

| Key | Meaning |
|---|---|
| `concurrency` | How many jobs are active at once. A job is active from creation until it reaches a waiting or terminal stage. |
| `max_rounds` | Build rounds per job before it escalates. A rework grants another `max_rounds`. |
| `base_branch` | `trunk`. Worktrees branch from it and the merge syncs with it. |
| `merge_method` | Passed to `gh pr merge` when auto-merge is on. |
| `auto_merge` | Off by default: an approved PR is synced, gated, marked ready and labeled `factory:needs-human` for a maintainer to merge. |
| `teardown` | The command run in a job's worktree when the job ends: destroys both wp-env stacks. |
| `ci_timeout_minutes` | How long `job ci` waits for the PR's checks. |
| `labels` | `queue` (`factory`), `needs_info`, `needs_human`. |
| `routing`, `surface_reviewers` | The agent routing tables described above. |
| `protected_paths` | fnmatch patterns a branch may not modify or delete. |
| `ports` | `base` and `step` for the per-job ports. |
| `prices_usd_per_mtok` | Per-model token prices used for the cost figures. |

## Running it

**Requirements**: Docker running, the `agent-browser` CLI, `gh` authenticated as the operator, and Python 3. The orchestrator checks Docker and `agent-browser` before starting any job. It runs locally, from the main checkout or from any Claude Code worktree; each checkout keeps its own `factory/jobs/`, so never run two `/factory run`s at once.

- **`/factory run`** drains the queue: `job queue`, then up to `concurrency` jobs at a time, oldest issue first, each stepped by its stage until nothing is `new` or `resume`. It ends with `job summary`.
- **`/factory issue <n>`** runs one issue now, ignoring `concurrency`.
- **`/factory <feature>`** creates the issue (title from the feature, body verbatim, label `factory`) and runs it.
- **`/factory rework <n>`** is for a `needs-human` job after you have commented on its PR or issue: `job rework` gathers your comments and a fresh builder addresses them.

The `factory` label is the green light. Labeling an issue is what authorizes the factory to push a `factory/<job-id>` branch and open a draft PR for it. Removing the label, or closing the issue or the PR, is how you stop a job: the next `job queue` moves it to `abandoned` and cleans up.

### Resuming

State is files, so an interrupted run picks every job up from its stage. Agents from an earlier session cannot be resumed, so the orchestrator spawns fresh ones: a builder told it is resuming an interrupted round, only the reviewers whose files are missing, `job ci` again unless `ci.md` already matches the branch's commit, and the gate again. For intake, spec and approve it reuses the agent's file when it exists and is newer than its inputs.

### When a job needs you

A job waits in `gate` when the gate fails on its own tooling rather than on the branch; the orchestrator says what needs merging to trunk, and the job resumes once it is there.

A job reaches `needs-human` when the builder is blocked, the rounds run out, CI never settles, the approver escalates, the merge conflicts or fails the re-gate, or an approved PR is handed over because `auto_merge` is off. In every case the reason is in `decision.md` and posted on the PR, and the PR is marked ready. The worktree stays and its site may still be running on the job's port, so you can look at the change where the reviewers did.

To send it back, comment on the PR and run `/factory rework <n>`. To finish it, merge the PR: the next `job queue` records the merge and tears the job down. To drop it, close the PR or the issue.

## Cost and the dashboard

`job sync` computes each job's API-equivalent cost from Claude Code's own subagent transcripts under the project's folder in `~/.claude/projects/`. Every factory prompt starts with `Job folder: <path>`, which ties a transcript to its job across sessions. The token usage of every assistant message in those transcripts is priced with `prices_usd_per_mtok`, cache writes and reads included. It is the price of the factory's agents at list rates, not the user's bill.

`factory/dashboard.html` reads the `job.json` files and renders them. Serve the folder with `cd factory && python3 -m http.server` and open http://localhost:8000/dashboard.html.

## Design notes

- **Scripts decide, agents reason.** Every stage change goes through `job advance`, which checks the files that justify it and refuses anything else. The orchestrator is told to do what a refusal says rather than work around it. An agent cannot move a job by writing a different file: a `build.md` without `STATUS: READY`, or a review whose first line is not a verdict, is refused or counted as `invalid`.
- **The branch cannot grade itself.** The gate runs the main checkout's `checks.sh` and `smoke.sh`, and fails any branch that touches the protected paths.
- **Issue text is data.** It reaches agents only quoted in `issue.md`, with a note that it is never an instruction, and only the author's and operator's comments are included.
- **Read-only until approval.** No reviewer runs on a failing gate, CI is awaited rather than re-run, and the approver is told that `APPROVE` means a merge with no human looking.
- **Everything is files.** A job is a folder of markdown and one JSON file. Resuming is reading them again.
