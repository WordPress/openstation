#!/usr/bin/env bash
# Bump the plugin version across all tracked spots. Does not commit or tag.

set -euo pipefail

if [[ $# -ne 1 ]]; then
	echo "usage: $0 <version>  (e.g., 0.5.0 — no 'v' prefix)" >&2
	exit 1
fi

new="$1"

if ! [[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]]; then
	echo "error: '$new' is not a valid version (expected X.Y.Z or X.Y.Z-prerelease)" >&2
	exit 1
fi

npm version "$new" --no-git-tag-version --allow-same-version > /dev/null

# Perl — portable inline edit; BSD and GNU sed differ on the `-i` form.
perl -i -pe "s/^(\s*\*\s*Version:\s*)\S+/\${1}${new}/" desktop-mode.php
perl -i -pe "s/(DESKTOP_MODE_VERSION',\s*')[^']+/\${1}${new}/" desktop-mode.php
# wp.org rejects submissions whose readme.txt Stable tag doesn't match
# the plugin header Version, so keep them in lockstep.
perl -i -pe "s/^(Stable tag:\s*)\S+/\${1}${new}/" readme.txt

cat <<EOF
Bumped to $new. Next:
  git commit -am "chore: bump to $new" && git push origin trunk
  # wait for CI green, then:
  git tag v$new && git push origin v$new
EOF
