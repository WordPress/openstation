#!/usr/bin/env bash
# End-to-end local release: bump, commit, push, wait for CI, tag, push tag.
# Idempotent — safe to re-run if a previous attempt failed mid-flow.

set -euo pipefail

if [[ $# -ne 1 ]]; then
	echo "usage: $0 <version>  (e.g., 0.5.0 or 0.5.0-rc1)" >&2
	exit 1
fi

new="$1"
tag="v$new"

command -v gh >/dev/null || { echo "error: 'gh' CLI required (for CI polling)" >&2; exit 1; }

branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "trunk" ]]; then
	echo "error: must be on trunk (currently on '$branch')" >&2
	exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
	echo "error: working tree is dirty. Commit or stash first." >&2
	exit 1
fi

git fetch origin trunk --quiet
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/trunk)" ]]; then
	echo "error: local trunk is out of sync with origin/trunk. Pull or push first." >&2
	exit 1
fi

# Refuse to clobber an existing release.
if git rev-parse "$tag" >/dev/null 2>&1; then
	echo "error: tag $tag already exists locally." >&2
	echo "  delete it with:  git tag -d $tag" >&2
	echo "  or choose a different version." >&2
	exit 1
fi
if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
	echo "error: tag $tag already exists on origin." >&2
	echo "  delete it with:  git push --delete origin $tag" >&2
	echo "  or choose a different version." >&2
	exit 1
fi

# Resume-friendly: skip bump+commit+push only if ALL version locations
# already match the target. Checking just package.json is not enough —
# a previous mid-flow failure (or a past bug in bump-version.sh) may
# have left some files out of sync, and a naive resume would silently
# skip the catch-up.
# awk (instead of `grep -oP`) for BSD/macOS portability — `-P` is GNU-only.
pkg=$(node -p "require('./package.json').version")
header=$(awk '/^[[:space:]]*\*[[:space:]]*Version:/ { print $3; exit }' desktop-mode.php)
constant=$(awk -F"'" '/DESKTOP_MODE_VERSION/ { print $4; exit }' desktop-mode.php)
stable=$(awk '/^Stable tag:/ { print $3; exit }' readme.txt)

if [[ "$pkg" == "$new" && "$header" == "$new" && "$constant" == "$new" && "$stable" == "$new" ]]; then
	echo "All version locations already at $new — skipping bump, resuming at CI wait."
else
	./bin/bump-version.sh "$new"
	if git diff --quiet; then
		echo "bump-version.sh produced no changes — versions already in sync."
	else
		git commit -am "chore: bump to $new"
		# Skip the interactive pre-push trunk prompt — the preflight checks above
		# already verify this is an intentional release push.
		git push --no-verify origin trunk
	fi
fi

sha=$(git rev-parse HEAD)
echo "Waiting for CI on ${sha}..."

# CI may take a few minutes to register the run after the push.
run_id=""
for _ in $(seq 1 100); do
	run_id=$(gh run list --branch trunk --workflow ci.yml --commit "$sha" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
	[[ -n "$run_id" ]] && break
	sleep 3
done

if [[ -z "$run_id" ]]; then
	echo "error: no CI run found for $sha after 5 minutes" >&2
	exit 1
fi

gh run watch "$run_id" --exit-status

git tag "$tag"
git push origin "$tag"

echo "Tagged $tag. Release workflow now building — watch with:"
echo "  gh run watch \$(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')"
