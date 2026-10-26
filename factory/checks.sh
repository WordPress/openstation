#!/usr/bin/env bash
# The repo's checks. Exit 0 only when the branch is fit to review.
#
# The gate runs this script from the main checkout with the job's worktree as
# the working directory. Keep it deterministic and non-interactive: no watch
# modes, no prompts, nothing that rewrites tracked files.
#
# FACTORY_CHECKS picks how much runs:
#   full (the gate): everything, against the job's own wp-env stacks. Needs
#        Docker and FACTORY_PORT, the job's port: its site is on FACTORY_PORT,
#        PHPUnit on +1, Plugin Check on +2. The stacks are keyed to the
#        worktree, so they never touch another checkout's.
#   fast (the builder's stop hook): the host-only part, no Docker.
set -euo pipefail

mode="${FACTORY_CHECKS:-full}"
factory="$(cd "$(dirname "$0")" && pwd)"

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

[ "$mode" = fast ] && exit 0

port="${FACTORY_PORT:?FACTORY_PORT must be the port of the job, as factory/bin/gate sets it}"

WP_ENV_PORT=$(( port + 1 )) npm run env:start:tests
npm run test:php:install
npm run test:php
npm run test:php:multisite
npm run lint:php

WP_ENV_PORT=$(( port + 2 )) bin/plugin-check.sh

# The main checkout's copy, like this script, so a branch can't weaken it.
bash "$factory/smoke.sh"
