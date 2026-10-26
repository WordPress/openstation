#!/usr/bin/env bash
# The repo's checks. Exit 0 only when the branch is fit to review.
#
# The gate runs this script from the main checkout with the job's worktree as
# the working directory. Keep it fast, deterministic and non-interactive: no
# watch modes, no prompts, nothing that rewrites files.
#
# PHPUnit and Plugin Check are not here: both need a wp-env stack (Docker) per
# worktree. They run in GitHub CI on the job's PR, and the approver reads
# `gh pr checks` before it approves.
set -euo pipefail

# phpcs.xml.dist excludes every path containing /.claude/, so a worktree under
# a Claude Code worktree would pass phpcs without scanning a file.
case "$PWD/" in
	*/.claude/*)
		echo "factory/checks.sh: $PWD is under a .claude/ directory, where phpcs scans nothing. Run the factory from the main checkout." >&2
		exit 1
		;;
esac

# A fresh worktree is bare; a changed lockfile needs a reinstall.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
	npm ci --prefer-offline --no-audit --no-fund
fi
if [ ! -f vendor/autoload.php ] || [ composer.lock -nt vendor/autoload.php ]; then
	composer install --no-interaction --no-progress
fi

npm run lint
npm run typecheck
npm run build
npm run test:js
vendor/bin/phpcs -n
