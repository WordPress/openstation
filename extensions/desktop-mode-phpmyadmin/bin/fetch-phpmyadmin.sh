#!/usr/bin/env bash
#
# Download + extract phpMyAdmin into assets/vendor/phpmyadmin/.
#
# The plugin's window registration is a no-op until this script
# populates the vendor directory — it's gitignored because the
# extracted distribution is ~50MB and changes on phpMyAdmin's release
# cadence, not this plugin's. Run before packaging to bundle
# phpMyAdmin in the release zip.
#
# Idempotent: bails early if assets/vendor/phpmyadmin/index.php already
# exists. Pass --force to refetch.
#
# Verifies the download against a SHA-256 hardcoded in this script.
# The hash was captured once from phpmyadmin.net's published .sha256
# companion file — pinning here closes the MITM-with-valid-cert
# attack on the same host serving both the zip and the hash. When
# bumping VERSION, also refresh EXPECTED_SHA256 from
# https://files.phpmyadmin.net/phpMyAdmin/<VERSION>/<basename>.sha256.

set -euo pipefail

VERSION="5.2.3"
ZIP_BASENAME="phpMyAdmin-${VERSION}-english.zip"
URL="https://files.phpmyadmin.net/phpMyAdmin/${VERSION}/${ZIP_BASENAME}"
EXPECTED_SHA256="a59e54436489a9676edc0a8b2294ade4092bdad1c25919f857b20ec96b944920"

cd "$(dirname "$0")/.."

DEST="assets/vendor/phpmyadmin"

force=0
if [[ "${1:-}" == "--force" ]]; then
	force=1
fi

if [[ -f "${DEST}/index.php" && $force -eq 0 ]]; then
	echo "phpMyAdmin already present at ${DEST} — pass --force to refetch."
	exit 0
fi

command -v curl  >/dev/null || { echo "error: curl is required"  >&2; exit 1; }
command -v unzip >/dev/null || { echo "error: unzip is required" >&2; exit 1; }
command -v shasum >/dev/null || { echo "error: shasum is required" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading phpMyAdmin ${VERSION}..."
curl -fsSL "$URL" -o "${tmp}/${ZIP_BASENAME}"

echo "Verifying SHA-256 against pinned hash..."
echo "${EXPECTED_SHA256}  ${ZIP_BASENAME}" > "${tmp}/${ZIP_BASENAME}.sha256"
( cd "$tmp" && shasum -a 256 -c "${ZIP_BASENAME}.sha256" )

echo "Extracting..."
( cd "$tmp" && unzip -q "${ZIP_BASENAME}" )

extracted="${tmp}/phpMyAdmin-${VERSION}-english"
if [[ ! -d "$extracted" ]]; then
	echo "error: expected ${extracted} after unzip" >&2
	exit 1
fi

# Replace the destination atomically — refetches don't leave partial state.
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$extracted" "$DEST"

# Trim attack surface. setup/ ships an interactive config builder that
# would let any visitor reconfigure the install. examples/ is reference
# material with no runtime purpose.
rm -rf "${DEST}/setup" "${DEST}/examples"

# Stash the stock MySQL driver alongside our adapter so install_config
# can restore it when the plugin is moved to a non-SQLite install. The
# adapter overwrites this file in place; without the .stock backup the
# only way to recover the original is a full re-fetch.
stock_driver="${DEST}/libraries/classes/Dbal/DbiMysqli.php"
if [[ -f "$stock_driver" ]]; then
	cp "$stock_driver" "${stock_driver}.stock"
fi

# unzip preserves the upstream zip's file mtimes (the phpMyAdmin release
# date). PHP OPcache uses mtime to invalidate cached compiled files —
# if a previous install had our adapter at this path, OPcache may keep
# serving the cached adapter even after a fresh extraction because the
# new file's mtime matches what was there before the adapter overwrite.
# Touch every PHP file so OPcache notices and re-reads from disk.
find "$DEST" -name '*.php' -exec touch {} +

echo "phpMyAdmin ${VERSION} installed at ${DEST}"
