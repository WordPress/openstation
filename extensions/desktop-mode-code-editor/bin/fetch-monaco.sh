#!/usr/bin/env bash
#
# Populate assets/vendor/monaco-editor/ from node_modules/monaco-editor/.
#
# Monaco's AMD distributable (~14 MB) is gitignored — too large to
# commit, and reproducible from the npm package pinned in
# package.json. This script copies it into place so the plugin can
# load it at runtime via `osc_monaco_vendor_url()`.
#
# Idempotent: bails early if assets/vendor/monaco-editor/min/vs/loader.js
# is already present. Pass --force to refetch (the npm install + copy
# always runs in --force mode).
#
# Conventions used by ../bin/package-extensions.sh:
#   - Filename `fetch-*.sh` is auto-discovered and run before staging.
#   - The vendor dir is gitignored (.gitignore entry); the package
#     script splices it back into the zip after staging.

set -euo pipefail

cd "$(dirname "$0")/.."

DEST="assets/vendor/monaco-editor"
LOADER="${DEST}/min/vs/loader.js"

force=0
if [[ "${1:-}" == "--force" ]]; then
	force=1
fi

if [[ -f "$LOADER" && $force -eq 0 ]]; then
	echo "Monaco already present at ${DEST} — pass --force to refetch."
	exit 0
fi

command -v npm >/dev/null || { echo "error: npm is required" >&2; exit 1; }

# `npm install --no-audit --no-fund` is idempotent when node_modules is
# already populated and the lockfile matches; otherwise it installs.
echo "Installing extension dependencies..."
npm install --no-audit --no-fund

echo "Copying Monaco vendor distributable..."
npm run vendor:monaco

if [[ ! -f "$LOADER" ]]; then
	echo "error: ${LOADER} missing after vendor:monaco" >&2
	exit 1
fi

echo "Monaco installed at ${DEST}"
