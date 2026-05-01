#!/usr/bin/env bash
#
# Build extensions.resolved.json by merging the curated extensions.json
# with version metadata read from each extension's plugin header, plus
# per-tag download URLs.
#
# Inputs:
#   - extensions.json (curated catalog at the repo root)
#   - extensions/<slug>/<slug>.php (plugin headers)
#
# Output:
#   - <out_dir>/extensions.resolved.json
#
# Args:
#   $1 — release tag (e.g. v0.5.5). Used to template per-asset download
#        URLs against the GitHub Releases page. If omitted, download_url
#        is omitted from each entry — the consumer is then expected to
#        fall back to its own resolution (e.g. a "latest" alias).
#   $2 — output directory. Defaults to "$repo_root/dist".
#
# Env:
#   WP_DESKTOP_MARKETPLACE_REPO — owner/name of the GitHub repo that
#       hosts the release assets. Defaults to "WordPress/desktop-mode".

set -euo pipefail

cd "$(dirname "$0")/.."
root=$(pwd)

tag="${1:-}"
out_dir="${2:-$root/dist}"
mkdir -p "$out_dir"

if [[ ! -f extensions.json ]]; then
	echo "error: extensions.json not found at $root" >&2
	exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
	echo "error: jq is required (apt-get install jq / brew install jq)" >&2
	exit 1
fi

repo="${WP_DESKTOP_MARKETPLACE_REPO:-WordPress/desktop-mode}"

# Reads a single WordPress plugin header value. Portable across
# BSD/GNU sed (no -P/Perl, no \K) so this script works the same on
# macOS dev machines and Linux CI runners.
read_header() {
	local file="$1"
	local key="$2"
	sed -n "s/^[[:space:]]*\*[[:space:]]*${key}:[[:space:]]*\(.*\)$/\1/p" "$file" \
		| head -n 1 \
		| sed 's/[[:space:]]*$//'
}

resolved=$(jq '.extensions' extensions.json)
count=$(jq 'length' <<<"$resolved")

for (( i=0; i<count; i++ )); do
	slug=$(jq -r ".[$i].slug" <<<"$resolved")
	plugin_file="extensions/$slug/$slug.php"

	if [[ ! -f "$plugin_file" ]]; then
		echo "error: missing plugin file $plugin_file for slug '$slug'" >&2
		exit 1
	fi

	version=$(read_header "$plugin_file" "Version")
	requires_wp=$(read_header "$plugin_file" "Requires at least")
	requires_php=$(read_header "$plugin_file" "Requires PHP")

	if [[ -z "$version" ]]; then
		echo "error: $plugin_file has no Version header" >&2
		exit 1
	fi

	download_url=""
	if [[ -n "$tag" ]]; then
		download_url="https://github.com/$repo/releases/download/$tag/$slug.zip"
	fi

	resolved=$(
		jq \
			--argjson i "$i" \
			--arg version "$version" \
			--arg requires_wp "$requires_wp" \
			--arg requires_php "$requires_php" \
			--arg download_url "$download_url" \
			'.[$i] += (
				{ version: $version }
				+ ( if $requires_wp  != "" then { requires_wp:  $requires_wp  } else {} end )
				+ ( if $requires_php != "" then { requires_php: $requires_php } else {} end )
				+ ( if $download_url != "" then { download_url: $download_url } else {} end )
			)' <<<"$resolved"
	)
done

generated_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

jq -n \
	--arg generated_at "$generated_at" \
	--arg release_tag "$tag" \
	--arg repo "$repo" \
	--argjson extensions "$resolved" \
	'{
		generated_at: $generated_at,
		repo: $repo,
		extensions: $extensions
	} + ( if $release_tag != "" then { release_tag: $release_tag } else {} end )' \
	> "$out_dir/extensions.resolved.json"

echo "Wrote $out_dir/extensions.resolved.json"
