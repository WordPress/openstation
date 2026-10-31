---
name: pr-writer
description: Write and open a pull request for the current branch the way this repo expects. Use when the user asks to open, create, draft or write up a PR, or types /pr-writer. Fills the body from `.github/pull_request_template.md`, checks the branch against the rulebook first, and opens the PR only after the user's go-ahead.
---

# PR writer

A PR here has one layout, the one in `.github/pull_request_template.md`, and
one set of rules, the ones in `AGENTS.md` ("Always branch + PR, never commit to
trunk" and "No version-history annotations"). This skill turns the branch into
a PR that follows both. It never invents a layout of its own.

## 1. Check the branch is ready

Do these before writing a word of the body:

1. **Not on trunk.** `git branch --show-current` must not print `trunk`. If it
   does, stop and branch first.
2. **Clean tree, pushed.** `git status --porcelain` prints nothing and the
   branch is pushed (`git push -u origin <branch>`). Don't push anything the
   user hasn't seen: AGENTS.md says to let the user test before committing.
3. **Re-read the rulebook if the branch is older than a day.** A merge brings
   the code in, not the rules:

   ```bash
   git fetch origin trunk
   git diff $( git merge-base HEAD origin/trunk )..origin/trunk -- AGENTS.md docs/
   ```

   Re-check the branch against anything new before asking for review.
4. **The checks for what changed have run**, and you know their result:
   - JS/TS: `npm run build`, `npm run lint`, `npm run typecheck`, `npm run test:js`.
   - PHP: `npm run lint:php` and the relevant `npm run test:php -- --filter=…`.
     In a Claude Code cloud container, `bin/cloud-test-env.sh lint` and
     `bin/cloud-test-env.sh phpunit` instead.
   - Anything that could not run (no network, no Docker) is named in
     Testing instructions, not glossed over.
5. **Docs updated with the change.** If the diff touches a surface in the doc
   map in `AGENTS.md`, the matching `docs/` page is in the same branch.

## 2. Gather what the body needs

```bash
git log --oneline origin/trunk..HEAD
git diff --stat origin/trunk...HEAD
git diff origin/trunk...HEAD
```

Also find the issue the branch fixes, if any, and the docs page it updated.
For the title, match recent merged PRs: short, imperative, sentence case, no
trailing period, no `type:` prefix unless the repo's recent titles use one.

## 3. Write the body from the template

Read `.github/pull_request_template.md` fresh every time (it may have
changed) and keep its headings in its order:

- **What it does**: the behaviour a user or plugin author will notice, in a
  sentence or two.
- **Rationale**: why. The bug, the race, the missing capability. Name any
  approach considered and why it lost.
- **Implementation**: how it works now. Show code for the non-obvious part.
  Link the `docs/` page updated when the change touches a public surface.
- **Testing instructions**: concrete steps a reviewer can follow on a local
  wp-env, or the exact test command. Say what to look for on trunk and on the
  branch when that helps. Say plainly what was not tested and why.

Rules, from the template's comments and `AGENTS.md`:

- Describe what the branch delivers **now**, not the steps taken to get there.
- Delete every `<!-- … -->` comment from the template.
- A small change may drop a section it doesn't need. Never add new headings.
- No emoji, no buzzwords ("enhanced", "robust", "seamless"), no list of
  changed files.
- No version stamps ("since 0.9", "as of", "fixed in").
- `code` for names: functions, hooks, files, options.
- First line `Closes #<n>` (or `Fixes #<n>`) when the branch resolves an
  issue. Reference other repos' issues as `owner/repo#n`.
- End with the attribution footer the session's instructions give for PR
  descriptions, if there is one.

## 4. Show it, then open it on the user's go-ahead

Show the title and body to the user and wait for an explicit yes. AGENTS.md:
"Wait for the user's green light before running `gh pr create`; once given,
run it yourself."

Then open it against `trunk`:

- Locally: `gh pr create --base trunk --head <branch> --title "…" --body-file <file>`
  (add `--draft` when the user asked for a draft).
- In a Claude Code cloud session, where `gh` is not available: the GitHub MCP
  `create_pull_request` tool with the same base, head, title and body.

Give the user the PR as a full markdown link.

## 5. Watch CI

`.github/workflows/ci.yml` runs on pull requests to `trunk`, so CI starts
only once the PR exists. That includes Plugin Check and the PHPUnit
single-site and multisite runs, which may be the first time the full suite
runs on the change.

Offer to watch the PR (in a cloud session, `subscribe_pr_activity`) and see
CI through to green. Fix a red check by reproducing it locally first. Never
skip or disable a test to get green, and never push an empty commit to
re-run CI.
