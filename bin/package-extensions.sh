#!/usr/bin/env bash
#
# Build WordPress-installable plugin zips for every extension under
# extensions/. One zip per extension, written to dist/ by default
# (or to a directory passed as $1). Pass a slug as $2 to package only
# that extension.
#
# Why not `git archive --format=zip` directly? Git's zip output stores
# Unix mode 0600 for files / 0700 for dirs — after extraction by the
# WP plugin installer those are unreadable by the web-server user.
# Round-tripping through `tar` + `zip` lands the entries at the tools'
# defaults (0644 / 0755), which is what WordPress expects.
#
# Vendored content (e.g. extensions/desktop-mode-phpmyadmin/assets/
# vendor/phpmyadmin/) is gitignored — `git archive` skips it. After
# extraction this script splices any working-tree assets/vendor/*
# back in for each extension, so end users get a single zip that "just
# works" on activation.
#
# Vendor content is fetched on demand: any `bin/fetch-*.sh` script an
# extension ships with is invoked before staging. They're expected to
# be idempotent — bailing out cheaply when their target is already
# present — so running them unconditionally is safe.

set -euo pipefail

cd "$(dirname "$0")/.."
root=$(pwd)

out_dir="${1:-$root/dist}"
only_slug="${2:-}"
mkdir -p "$out_dir"

if [[ ! -d "extensions" ]]; then
	echo "error: no extensions/ directory at $root" >&2
	exit 1
fi

if [[ -n "$only_slug" ]]; then
	if [[ ! "$only_slug" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
		echo "error: invalid extension slug: $only_slug" >&2
		exit 1
	fi
	if [[ ! -d "extensions/$only_slug" ]]; then
		echo "error: extension not found: $only_slug" >&2
		exit 1
	fi
	extensions=( "extensions/$only_slug/" )
else
	shopt -s nullglob
	extensions=( extensions/*/ )
	shopt -u nullglob
fi

if [[ ${#extensions[@]} -eq 0 ]]; then
	echo "No extensions found under extensions/. Nothing to package."
	exit 0
fi

tmp_root=$(mktemp -d)
trap 'rm -rf "$tmp_root"' EXIT

for ext_dir in "${extensions[@]}"; do
	# Strip trailing slash, then drop the "extensions/" prefix to get the slug.
	slug="${ext_dir%/}"
	slug="${slug#extensions/}"

	plugin_file="extensions/$slug/$slug.php"
	if [[ ! -f "$plugin_file" ]]; then
		echo "skip: $slug (no $slug.php — not a plugin)"
		continue
	fi

	echo "Packaging $slug..."

	# Run any fetcher scripts the extension ships with. Convention:
	# `bin/fetch-*.sh` populates a gitignored vendor dir and is
	# idempotent — bails early when its target is already present.
	for fetcher in "$ext_dir"bin/fetch-*.sh; do
		[[ -f "$fetcher" ]] || continue
		echo "  running $(basename "$fetcher")"
		"$fetcher"
	done

	stage="$tmp_root/$slug"
	mkdir -p "$stage/$slug"

	# `git ls-files -co --exclude-standard` lists tracked + untracked-but-
	# not-gitignored files — exactly the source of truth for "what's part
	# of this plugin." This works whether the extension has been committed
	# or is still in the working tree. The vendor dir, being gitignored,
	# is correctly excluded; we splice it back in below. An extension may
	# use .distignore to remove repository-only files from its release zip.
	(
		cd "extensions/$slug"
		tar_args=( -cf - )
		if [[ -f ".distignore" ]]; then
			tar_args+=( --exclude-from=.distignore )
		fi
		git ls-files -co --exclude-standard | tar "${tar_args[@]}" -T -
	) | tar -x -C "$stage/$slug"

	# Splice in any vendored content from the working tree. Anything under
	# assets/vendor/* that's gitignored (and therefore missing from the
	# archive) gets copied verbatim. This is intentionally generic so a
	# new extension that bundles its own vendor only needs the gitignore
	# entry — no changes to this script.
	if [[ -d "$ext_dir/assets/vendor" ]]; then
		for sub in "$ext_dir"assets/vendor/*/; do
			[[ -d "$sub" ]] || continue
			sub_name=$(basename "$sub")
			dest="$stage/$slug/assets/vendor/$sub_name"
			if [[ -d "$dest" ]]; then
				continue  # tracked in git, already in the archive
			fi
			mkdir -p "$(dirname "$dest")"
			cp -R "$sub" "$dest"
			echo "  spliced vendor: assets/vendor/$sub_name"
		done
	fi

	# Sanity check for the phpmyadmin extension specifically — the
	# vendor dir is mandatory; without it the plugin gates closed and
	# the icon never appears. Fail loudly here rather than ship a dead
	# zip. Should be unreachable now that fetchers run automatically,
	# but kept as a defense against a fetcher silently producing the
	# wrong layout.
	if [[ "$slug" == "desktop-mode-phpmyadmin" \
		&& ! -f "$stage/$slug/assets/vendor/phpmyadmin/index.php" ]]; then
		echo "error: $slug is missing assets/vendor/phpmyadmin/ after fetch." >&2
		echo "       Inspect extensions/$slug/bin/fetch-phpmyadmin.sh output above." >&2
		exit 1
	fi

	out="$out_dir/$slug.zip"
	rm -f "$out"
	( cd "$stage" && zip -qr "$out" "$slug" )
	echo "Wrote $out"
done
