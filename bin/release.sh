#!/usr/bin/env bash
# End-to-end local release: bump, commit, push, wait for CI, tag, push tag.
# Idempotent — safe to re-run if a previous attempt failed mid-flow.
#
# Flags:
#   --skip-i18n             Skip the translation-file refresh (extract + build).
#                           Use for hotfix releases where you do not want
#                           .pot/.po/.json churn in the bump commit.
#   --skip-changelog        Skip drafting the readme.txt changelog from
#                           GitHub's auto-generated release notes. Use when
#                           you've already hand-written the changelog block,
#                           or for hotfixes with nothing notable to log.
#   --dry-run-changelog     Print the changelog draft that would be inserted
#                           into readme.txt, then exit without modifying any
#                           files or pushing. Useful for previewing the
#                           draft and the editor pause before a real release.

set -euo pipefail

skip_i18n=0
skip_changelog=0
dry_run_changelog=0
new=""
for arg in "$@"; do
	case "$arg" in
		--skip-i18n)
			skip_i18n=1
			;;
		--skip-changelog)
			skip_changelog=1
			;;
		--dry-run-changelog)
			dry_run_changelog=1
			;;
		-h|--help)
			echo "usage: $0 <version> [--skip-i18n] [--skip-changelog] [--dry-run-changelog]  (e.g., 0.5.0 or 0.5.0-rc1)"
			exit 0
			;;
		-*)
			echo "error: unknown flag '$arg'" >&2
			echo "usage: $0 <version> [--skip-i18n] [--skip-changelog] [--dry-run-changelog]" >&2
			exit 1
			;;
		*)
			if [[ -n "$new" ]]; then
				echo "error: unexpected extra positional argument '$arg'" >&2
				echo "usage: $0 <version> [--skip-i18n] [--skip-changelog] [--dry-run-changelog]" >&2
				exit 1
			fi
			new="$arg"
			;;
	esac
done

if [[ -z "$new" ]]; then
	echo "usage: $0 <version> [--skip-i18n] [--skip-changelog] [--dry-run-changelog]  (e.g., 0.5.0 or 0.5.0-rc1)" >&2
	exit 1
fi

tag="v$new"

command -v gh >/dev/null || { echo "error: 'gh' CLI required (for CI polling)" >&2; exit 1; }
if ! gh auth status >/dev/null 2>&1; then
	echo "error: gh CLI is not authenticated. Run:  gh auth login" >&2
	exit 1
fi

# Fetches GitHub's auto-generated release notes for the next tag, keeps
# only bullet lines, strips the trailing "by @user in <PR-URL>" suffix,
# and drops "first contribution" boilerplate. Echoes the transformed
# bullets on stdout; echoes a diagnostic on stderr and returns non-zero
# if there is nothing usable to write.
generate_changelog_draft() {
	local target_tag="$1"
	local prev
	prev=$(git describe --tags --abbrev=0 2>/dev/null || true)
	if [[ -z "$prev" ]]; then
		echo "warning: no previous tag found — skipping changelog draft." >&2
		return 1
	fi
	local repo raw
	repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
	raw=$(gh api -X POST "repos/$repo/releases/generate-notes" \
		-f tag_name="$target_tag" \
		-f previous_tag_name="$prev" \
		-f target_commitish=trunk \
		--jq '.body' 2>/dev/null || true)
	if [[ -z "$raw" ]]; then
		echo "warning: GitHub generate-notes API returned nothing — skipping draft." >&2
		return 1
	fi
	# Transformation pipeline (one awk pass):
	#  1. Keep only bullet lines, drop "first contribution" boilerplate.
	#  2. Strip the trailing "by @user in <PR-URL>" suffix.
	#  3. Strip trailing " (#NNN)" PR refs.
	#  4. Strip leading "Fix #NNN:" / "Closes #NNN:" / "Resolves #NNN:".
	#  5. Strip conventional-commit prefixes (type or type(scope) + colon)
	#     case-insensitively, using a tolower() mirror for matching
	#     because POSIX awk regex has no case-insensitive flag.
	#  6. Capitalize the first letter of what remains.
	local draft
	draft=$(printf '%s\n' "$raw" | awk '
		/^\* / && !/made their first contribution/ {
			sub(/ by @[^ ]+ in https:\/\/[^ ]+$/, "")
			sub(/[[:space:]]*\(#[0-9]+\)[[:space:]]*$/, "")

			lower = tolower($0)
			if (match(lower, /^\* (fix(es)?|close[sd]?|resolve[sd]?)[[:space:]]+#[0-9]+:[[:space:]]*/)) {
				$0 = "* " substr($0, RSTART + RLENGTH)
				lower = tolower($0)
			}
			if (match(lower, /^\* (feat|fix|chore|docs|refactor|perf|test|style|build|ci|revert)(\([^)]+\))?:[[:space:]]+/)) {
				$0 = "* " substr($0, RSTART + RLENGTH)
			}

			if (length($0) >= 3) {
				first = substr($0, 3, 1)
				upper = toupper(first)
				if (first != upper) {
					$0 = substr($0, 1, 2) upper substr($0, 4)
				}
			}

			print
		}
	')
	if [[ -z "$draft" ]]; then
		echo "warning: no bullet items in generated notes — skipping draft." >&2
		return 1
	fi
	printf '%s\n' "$draft"
}

# --dry-run-changelog short-circuits before any preflight checks so it
# works from any branch and any working-tree state. Use it to preview
# the draft + interaction without mutating anything.
if [[ "$dry_run_changelog" == "1" ]]; then
	echo "Dry run: previewing changelog draft for $tag (no files will be modified)."
	echo ""
	if draft=$(generate_changelog_draft "$tag"); then
		echo "=========================================================="
		echo "Would prepend this '= $new =' block to readme.txt:"
		echo "----------------------------------------------------------"
		echo "= $new ="
		printf '%s\n' "$draft"
		echo "=========================================================="
		echo ""
		echo "At this point the real release script would pause with:"
		echo "  Please update readme.txt if needed, save, and press Enter when done."
		echo "  (Ctrl-C to abort, then 'git checkout readme.txt' to undo.)"
		echo "  Press Enter when done..."
		echo ""
		echo "Dry run complete. No files changed."
	fi
	exit 0
fi

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
	# Refresh translation files BEFORE the version bump so any churn
	# (renumbered #: source refs, fresh POT-Creation-Date, fuzzy
	# flags, new JSON bundles) ends up in the same commit as the
	# bump. Running this here also gives a cheap Ctrl-C escape: if
	# the language-file diff looks wrong, abort now — nothing has
	# been committed or pushed yet.
	if [[ "$skip_i18n" == "0" ]]; then
		echo "Refreshing translation files (npm run i18n)..."
		npm run --silent i18n
		if git diff --quiet -- languages/; then
			echo "  -> no language-file changes."
		else
			echo "  -> languages/ updated:"
			git diff --stat -- languages/
		fi
	else
		echo "Skipping i18n refresh (--skip-i18n)."
	fi

	# Draft the readme.txt changelog block from GitHub's auto-generated
	# release notes, then pause so the releaser can curate before the
	# bump commit. Resume-safe: skips if readme.txt already has a
	# "= $new =" block (from a prior aborted attempt). If the editor
	# pause is aborted with Ctrl-C, readme.txt will be left modified;
	# undo with: git checkout readme.txt
	if [[ "$skip_changelog" == "0" ]]; then
		if grep -q "^= $new =$" readme.txt; then
			echo "readme.txt already has a '= $new =' block — skipping changelog draft."
		else
			echo "Drafting readme.txt changelog from GitHub notes for $tag..."
			if draft=$(generate_changelog_draft "$tag"); then
				draft_file=$(mktemp)
				printf '%s\n' "$draft" > "$draft_file"
				tmp=$(mktemp)
				awk -v ver="$new" -v draft_file="$draft_file" '
					{ print }
					!inserted && $0 == "== Changelog ==" {
						print ""
						print "= " ver " ="
						while ((getline line < draft_file) > 0) print line
						close(draft_file)
						inserted = 1
					}
				' readme.txt > "$tmp"
				mv "$tmp" readme.txt
				rm -f "$draft_file"

				echo ""
				echo "=========================================================="
				echo "Drafted '= $new =' block in readme.txt:"
				echo "----------------------------------------------------------"
				echo "= $new ="
				printf '%s\n' "$draft"
				echo "=========================================================="
				echo ""
				echo "Please update readme.txt if needed, save, and press Enter when done."
				echo "(WordPress.org users see this — keep it user-facing.)"
				echo "(Ctrl-C to abort, then 'git checkout readme.txt' to undo.)"
				read -r -p "Press Enter when done... " _
			fi
		fi
	else
		echo "Skipping changelog draft (--skip-changelog)."
	fi

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
echo "Waiting for CI to register a run on ${sha} (polling for up to 5 min)..."

# CI may take a few minutes to register the run after the push.
run_id=""
for i in $(seq 1 100); do
	run_id=$(gh run list --branch trunk --workflow ci.yml --commit "$sha" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
	[[ -n "$run_id" ]] && break
	# Heartbeat every 30 s so the script doesn't look frozen while CI registers.
	if (( i % 10 == 0 )); then
		printf '  …%ds elapsed, still polling\n' $((i * 3))
	fi
	sleep 3
done

if [[ -z "$run_id" ]]; then
	echo "error: no CI run found for $sha after 5 minutes" >&2
	exit 1
fi

run_url=$(gh run view "$run_id" --json url -q '.url' 2>/dev/null || true)
echo "CI run ${run_id} registered — watching until it finishes (typically 3-5 min)."
[[ -n "$run_url" ]] && echo "  ${run_url}"
echo "  (gh run watch is silent until each job completes; this is normal.)"

gh run watch "$run_id" --exit-status

echo "CI passed — tagging ${tag} and pushing..."

git tag "$tag"
git push origin "$tag"

echo "Tagged $tag. Release workflow now building — watch with:"
echo "  gh run watch \$(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')"
