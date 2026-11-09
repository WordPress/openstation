#!/usr/bin/env bash
# Run one job's seed on both sites a review compares: trunk's and the job's.
#
# Usage: factory/seed.sh <job-id> <seed.php>
#
# The seed is a PHP file for `wp eval-file`. It prefixes everything it creates
# with `QA <job-id>:` and deletes what carries that prefix first, so running it
# again resets both sites to the same state, and jobs sharing the trunk site
# never see each other's rows.
set -euo pipefail

job="${1:?usage: factory/seed.sh <job-id> <seed.php>}"
seed="$(cd "$(dirname "${2:?usage: factory/seed.sh <job-id> <seed.php>}")" && pwd)/$(basename "$2")"
repo="$(cd "$(dirname "$0")/.." && pwd)"
worktree="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["worktree"])' "$repo/factory/jobs/$job/job.json")"
trunk="$(dirname "$repo")/$(basename "$repo")-factory/trunk"

for site in "$trunk" "$worktree"; do
	# Each wp-env instance mounts its own checkout as the plugin, so a copy under
	# .scratch/ (gitignored) is visible inside that instance's container.
	mkdir -p "$site/.scratch"
	cp "$seed" "$site/.scratch/factory-seed-$job.php"
	echo "seed: $(basename "$site")"
	(cd "$site" && npx wp-env run cli wp eval-file "wp-content/plugins/desktop-mode/.scratch/factory-seed-$job.php")
done
