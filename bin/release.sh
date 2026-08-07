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
#                           The interactive changelog confirmation still
#                           runs; only the drafting step is skipped.
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

# Print the '= $new =' changelog block from readme.txt (heading included,
# up to the next '=' heading). Prints nothing if the block is absent.
changelog_block() {
	awk -v ver="$new" '
		$0 == "= " ver " =" { found = 1; print; next }
		found && /^=/ { exit }
		found { print }
	' readme.txt
}

# The single interactive gate of the release. Shows the '= $new ='
# changelog block currently in readme.txt (or a loud warning when there
# is none) and requires an explicit yes before the release continues.
# Editing readme.txt WHILE the prompt waits is fine: the bump commit
# picks up the file as saved, and the final block is re-printed for the
# record when it changed. Anything but yes stops the release, and
# stopping costs nothing: the preflight checks tolerate the leftovers,
# the draft merge is idempotent, and edits to the block survive, so
# fixing readme.txt and re-running lands right back here. Runs on EVERY
# path — drafted, hand-written, --skip-changelog, and resume.
confirm_changelog() {
	local block reply after
	block=$(changelog_block)
	echo ""
	echo "=========================================================="
	if [[ -n "$block" ]]; then
		echo "readme.txt changelog for $new (what WordPress.org users will see):"
		echo "----------------------------------------------------------"
		printf '%s\n' "$block"
	else
		echo "WARNING: readme.txt has NO '= $new =' changelog block."
		echo "WordPress.org users would see no notes for this release."
	fi
	echo "=========================================================="
	echo "Edit readme.txt now if it needs changes, save, then answer."
	read -r -p "Is this changelog complete and correct? [y/N] " reply
	if [[ ! "$reply" =~ ^[Yy]$ ]]; then
		echo "Release stopped. Edit the '= $new =' block in readme.txt, then re-run:" >&2
		echo "    $0 $new" >&2
		echo "The draft and your edits are kept; the re-run returns to this confirmation." >&2
		echo "('git checkout readme.txt' discards the draft entirely.)" >&2
		echo "(If a resume run already pushed the bump commit, commit and push the" >&2
		echo "readme.txt fix before re-running so it reaches the tag.)" >&2
		exit 1
	fi
	# The block may have been edited while the prompt was waiting; show
	# the version that will actually ship when it differs.
	after=$(changelog_block)
	if [[ "$after" != "$block" ]]; then
		echo ""
		echo "readme.txt was edited during the prompt. Shipping this '= $new =' block:"
		echo "----------------------------------------------------------"
		printf '%s\n' "$after"
	fi
}

# --dry-run-changelog short-circuits before any preflight checks so it
# works from any branch and any working-tree state. Use it to preview
# the draft + interaction without mutating anything.
if [[ "$dry_run_changelog" == "1" ]]; then
	echo "Dry run: previewing changelog draft for $tag (no files will be modified)."
	echo ""
	if draft=$(generate_changelog_draft "$tag"); then
		if grep -q "^= $new =$" readme.txt; then
			new_bullets=$(printf '%s\n' "$draft" | grep -Fxv -f <(changelog_block) || true)
			echo "=========================================================="
			echo "readme.txt already has a '= $new =' block. The release would"
			echo "keep its entries and append the drafted bullets not already"
			echo "present:"
			echo "----------------------------------------------------------"
			if [[ -n "$new_bullets" ]]; then
				printf '%s\n' "$new_bullets"
			else
				echo "(nothing: every drafted entry is already in the block)"
			fi
			echo "=========================================================="
		else
			echo "=========================================================="
			echo "Would prepend this '= $new =' block to readme.txt:"
			echo "----------------------------------------------------------"
			echo "= $new ="
			printf '%s\n' "$draft"
			echo "=========================================================="
		fi
		echo ""
		echo "At this point the real release script would show the final block and ask:"
		echo "  Is this changelog complete and correct? [y/N]"
		echo "y continues the release; anything else stops it (draft kept for re-run)."
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

# Leftovers from an aborted release attempt are regenerated or
# re-reviewed on every run and belong in the bump commit, so they must
# not block a re-run: the i18n refresh under languages/, a
# drafted-but-unconfirmed changelog in readme.txt, and the version
# strings themselves. The version files are on this list because
# `bump-version.sh` runs before the changelog gate, so answering `n`
# there leaves them written but uncommitted; without the exemption the
# re-run that gate promises would abort instead of returning to the
# prompt. `bump-version.sh` rewrites them deterministically on every
# run, so a stale value cannot survive.
#
# Anything else dirty still aborts: the bump uses `git commit -am` and
# would silently sweep it up.
dirty=$(git status --porcelain --untracked-files=no | grep -vE '^.{3}(languages/|readme\.txt$|package\.json$|package-lock\.json$|desktop-mode\.php$|packages/openstation-types/)' || true)
if [[ -n "$dirty" ]]; then
	echo "error: working tree has changes beyond the release-owned files. Commit or stash first:" >&2
	printf '%s\n' "$dirty" >&2
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
constant=$(awk -F"'" '/OPENSTATION_VERSION/ { print $4; exit }' desktop-mode.php)
stable=$(awk '/^Stable tag:/ { print $3; exit }' readme.txt)

# Matching strings are not proof the bump was committed. `bump-version.sh`
# writes the files and never commits, and the changelog gate below can
# exit between the write and the commit, so an aborted run leaves the
# tree bumped and uncommitted. Resuming on the strings alone would skip
# the commit and tag whatever HEAD already is, which is the pre-bump
# commit. Require the bump to be committed as well; when it is not, the
# else branch below re-runs `bump-version.sh` as a no-op and commits
# normally.
if git diff HEAD --quiet -- package.json package-lock.json packages/openstation-types/package.json desktop-mode.php; then
	bump_committed=1
else
	bump_committed=0
fi

if [[ "$pkg" == "$new" && "$header" == "$new" && "$constant" == "$new" && "$stable" == "$new" && "$bump_committed" == "1" ]]; then
	echo "All version locations already at $new — skipping bump, resuming at CI wait."
	confirm_changelog
	# In resume mode the bump commit is already pushed; readme.txt edits
	# made during the confirmation pause exist only in the working tree
	# and would NOT reach the tag. Force them through trunk first.
	if ! git diff --quiet -- readme.txt; then
		echo "error: readme.txt was edited, but the bump commit is already pushed." >&2
		echo "  Commit and push the fix, then re-run:" >&2
		echo "    git add readme.txt && git commit -m \"Update $new changelog\" && git push origin trunk" >&2
		exit 1
	fi
else
	# Bump the version BEFORE refreshing translations, because
	# `wp i18n make-pot` reads Project-Id-Version straight from the
	# plugin header in desktop-mode.php. Extracting first stamps the
	# catalogues with the PREVIOUS version, which is how the shipped
	# POT came to say "Desktop Mode 0.9.7" while the plugin was at
	# 0.9.8. Nothing is committed here, so the Ctrl-C escape below
	# still covers the bump too.
	./bin/bump-version.sh "$new"

	# Refresh translation files after the bump but BEFORE any commit,
	# so the catalogues carry $new and any churn (renumbered #: source
	# refs, fresh POT-Creation-Date, fuzzy flags, new JSON bundles)
	# still ends up in the same commit as the bump. If the
	# language-file diff looks wrong, abort now — nothing has been
	# committed or pushed yet.
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
	# release notes. The draft ALWAYS runs: if readme.txt already has a
	# "= $new =" block (hand-written, committed by a feature PR, or left
	# by a prior aborted attempt), its entries are kept and only drafted
	# bullets not already present verbatim are appended, so re-runs stay
	# idempotent and a partial block can never mask the real release
	# contents. Curation happens at the confirm_changelog gate below,
	# the release's only interactive stop.
	if [[ "$skip_changelog" == "0" ]]; then
		echo "Drafting readme.txt changelog from GitHub notes for $tag..."
		if draft=$(generate_changelog_draft "$tag"); then
			if grep -q "^= $new =$" readme.txt; then
				new_bullets=$(printf '%s\n' "$draft" | grep -Fxv -f <(changelog_block) || true)
				if [[ -z "$new_bullets" ]]; then
					echo "The existing '= $new =' block already contains every drafted entry."
				else
					draft_file=$(mktemp)
					printf '%s\n' "$new_bullets" > "$draft_file"
					tmp=$(mktemp)
					awk -v ver="$new" -v draft_file="$draft_file" '
						$0 == "= " ver " =" { print; inblock = 1; next }
						inblock && !done && ($0 == "" || $0 ~ /^=/) {
							while ((getline line < draft_file) > 0) print line
							close(draft_file)
							done = 1
						}
						{ print }
						END {
							if (inblock && !done) {
								while ((getline line < draft_file) > 0) print line
								close(draft_file)
							}
						}
					' readme.txt > "$tmp"
					mv "$tmp" readme.txt
					rm -f "$draft_file"

					echo ""
					echo "readme.txt already had a '= $new =' block. Kept its entries and"
					echo "appended these drafted bullets:"
					printf '%s\n' "$new_bullets"
					echo "Watch for semantic duplicates: an existing entry may describe"
					echo "the same change as an appended bullet."
				fi
			else
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

				echo "Drafted a fresh '= $new =' block in readme.txt."
			fi
		fi
	else
		echo "Skipping changelog draft (--skip-changelog)."
	fi

	# However the block got here (drafted above, hand-written beforehand,
	# left over from an aborted attempt, or absent), show the final state
	# and require an explicit yes before the bump commit.
	confirm_changelog

	if git diff --quiet; then
		echo "Nothing to commit — versions already in sync and no language churn."
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
