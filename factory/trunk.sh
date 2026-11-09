#!/usr/bin/env bash
# The shared trunk site every review compares against: the latest trunk, built,
# on `ports.trunk` (8900), in its own worktree next to the checkout. Without it
# a reviewer can't tell "fixed" from "never reproduced", or a regression from a
# bug that was already there.
#
# Usage:
#   factory/trunk.sh            bring it up at the latest origin/trunk (start of every /factory run)
#   factory/trunk.sh destroy    remove its stack and its worktree
#
# Bringing it up ends with the same smoke test the gate runs, so a broken trunk
# stops the run before any job is judged against it. Jobs seed it through
# factory/seed.sh and never change its code.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
dir="$(dirname "$repo")/$(basename "$repo")-factory/trunk"
read -r port base < <(python3 -c 'import json, sys; c = json.load(open(sys.argv[1])); print(c["ports"]["trunk"], c["base_branch"])' "$repo/factory/config.json")

if [ "${1:-}" = destroy ]; then
	if [ -d "$dir" ]; then
		(cd "$dir" && npx wp-env destroy --force) || true
		git -C "$repo" worktree remove --force "$dir"
	fi
	exit 0
fi

git -C "$repo" fetch -q origin "$base"
if [ -d "$dir" ]; then
	git -C "$dir" checkout -q --detach "origin/$base"
else
	mkdir -p "$(dirname "$dir")"
	git -C "$repo" worktree add -q --detach "$dir" "origin/$base"
fi
cd "$dir"

# A fresh worktree is bare; a changed lockfile needs a reinstall.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
	npm ci --prefer-offline --no-audit --no-fund
fi
if [ ! -f vendor/autoload.php ] || [ composer.lock -nt vendor/autoload.php ]; then
	composer install --no-interaction --no-progress
fi
npm run build

FACTORY_PORT="$port" bash "$repo/factory/smoke.sh"
echo "trunk: $(git rev-parse --short HEAD) on http://localhost:$port/wp-admin/ ($dir)"
