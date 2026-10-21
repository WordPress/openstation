#!/usr/bin/env bash
#
# Turn a fresh Claude Code cloud container into one that can run this
# repo's PHPUnit suite the way CI does, and serve a real WordPress for
# browser checks.
#
#   bin/cloud-test-env.sh                          # prepare (idempotent)
#   bin/cloud-test-env.sh phpunit [args…]          # prepare, run the suite
#   WP_MULTISITE=1 bin/cloud-test-env.sh phpunit   # …as a network
#   bin/cloud-test-env.sh serve                    # prepare, serve a site
#
# `phpunit` passes its arguments through: `phpunit --filter Tests_Foo`.
#
# Safe to run from an environment setup script and to run again: every
# step checks before it acts and reuses what is already there.
#
# WHY NOT wp-env. `npm run test:php` is the contributor path and CI's,
# and stays so, but it cannot start behind a cloud container's egress
# proxy, for two reasons no wp-env setting reaches:
#
#   - wp-env decides it is offline by resolving WordPress.org over DNS.
#     The container has no outside DNS — only an HTTPS proxy — so the
#     check fails even when wordpress.org is reachable, and wp-env stops
#     at "Could not find the current WordPress version".
#   - wp-env builds its own images at start-up, and those builds run
#     `apk` / `apt-get` inside containers that cannot see the proxy.
#
# So this rebuilds, by hand, the part of wp-env the suite depends on.
# Each piece is load-bearing: a test fails without it.
#
#   - PHPUnit runs in the image CI's tests run in (`wordpress:cli-phpX.Y`,
#     PHP 8.3 by default, CI's first matrix row), with the checkout
#     mounted at wp-content/plugins/desktop-mode of a pinned WordPress
#     core. The plugin has to live under WP_PLUGIN_DIR, under its slug.
#   - The core carries a wp-config.php, and wp-tests-config.php is that
#     file minus the wp-settings.php line, as wp-env derives it. The
#     constants are wp-env's defaults overlaid with .wp-env.tests.json:
#     WP_DEBUG off, the test domain localhost:<its port>, salts defined.
#     Subprocess tests boot through the core's wp-load.php, so the
#     wp-config.php has to be there too.
#   - The test library is `wp-phpunit/wp-phpunit` from Packagist, at the
#     same version as the core.
#   - The container shares the host network, so it reaches MariaDB on
#     127.0.0.1 and the egress proxy. WordPress is pointed at the proxy
#     (WP_PROXY_*), and the proxy's CA is added to this test core's CA
#     bundle: a few tests make real requests to wordpress.org, as in CI.
#   - Docker pulls go through mirror.gcr.io because Docker Hub
#     rate-limits the container's shared egress (429 Too Many Requests).
#
# Needs: php + composer on the host (vendor/ and the config generator),
# curl, unzip, docker + dockerd, and the environment's network allowlist
# to include wordpress.org, api.wordpress.org and downloads.wordpress.org.
#
# Environment overrides:
#   OPENSTATION_TESTS_WP_VERSION   WordPress + wp-phpunit version (both
#                                  pinned to the same one). Default
#                                  7.1.1, the newest wp-phpunit tag on
#                                  Packagist.
#   OPENSTATION_TESTS_PHP_VERSION  PHP of the test image. Default 8.3;
#                                  CI also runs 8.4.
#   OPENSTATION_TESTS_CACHE        Download/cache root.
#                                  Default $HOME/.cache/openstation-tests.
#   OPENSTATION_TESTS_NODE_DIR     Where Node 24 goes when the host's is
#                                  older. Default $HOME/.local/node24.
#   OPENSTATION_SERVE_PORT         Port for `serve`. Default 8890.

set -euo pipefail

WP_VERSION="${OPENSTATION_TESTS_WP_VERSION:-7.1.1}"
PHP_VERSION="${OPENSTATION_TESTS_PHP_VERSION:-8.3}"
TEST_IMAGE="wordpress:cli-php${PHP_VERSION}"
CACHE_ROOT="${OPENSTATION_TESTS_CACHE:-$HOME/.cache/openstation-tests}"
NODE_DIR="${OPENSTATION_TESTS_NODE_DIR:-$HOME/.local/node24}"
SERVE_PORT="${OPENSTATION_SERVE_PORT:-8890}"
NODE_MAJOR=24

DB_CONTAINER="os-tests-db"
DB_IMAGE="mariadb:lts"
DB_PASSWORD="password"
DB_NAME="wordpress_test"
DB_SITE_NAME="wordpress_site"

REPO_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
VERSION_DIR="${CACHE_ROOT}/${WP_VERSION}"
CORE_DIR="${VERSION_DIR}/wordpress"
LIB_DIR="${VERSION_DIR}/lib"
TESTS_CONFIG="${VERSION_DIR}/wp-tests-config.php"
SALTS_FILE="${VERSION_DIR}/salts.php"

log() { printf '\033[1m[cloud-test-env]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[cloud-test-env] %s\033[0m\n' "$*" >&2; exit 1; }

need() {
	command -v "$1" >/dev/null 2>&1 || die "missing '$1' — $2"
}

# ---------------------------------------------------------------------
# 1. Node 24, the JS dependencies, the app client views
# ---------------------------------------------------------------------

ensure_node() {
	local current=0
	if command -v node >/dev/null 2>&1; then
		current="$( node -p 'process.versions.node.split(".")[0]' )"
	fi
	if [ "${current}" -ge "${NODE_MAJOR}" ]; then
		log "node $( node --version ) is new enough"
	elif [ -x "${NODE_DIR}/bin/node" ]; then
		log "using node $( "${NODE_DIR}/bin/node" --version ) from ${NODE_DIR}"
	else
		log "node ${current} is older than ${NODE_MAJOR}; installing the latest v${NODE_MAJOR}.x into ${NODE_DIR}"
		local base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
		local tmp line tarball sum
		tmp="$( mktemp -d )"
		line="$( curl -fsSL "${base}/SHASUMS256.txt" | grep -E ' node-v[0-9.]+-linux-x64\.tar\.xz$' )" \
			|| die "could not read ${base}/SHASUMS256.txt"
		sum="${line%% *}"
		tarball="${line##* }"
		curl -fsSL -o "${tmp}/${tarball}" "${base}/${tarball}"
		( cd "${tmp}" && printf '%s  %s\n' "${sum}" "${tarball}" | sha256sum -c --quiet - ) \
			|| die "checksum mismatch for ${tarball}"
		mkdir -p "${NODE_DIR}"
		tar -xJf "${tmp}/${tarball}" -C "${NODE_DIR}" --strip-components=1
		rm -rf "${tmp}"
		log "installed node $( "${NODE_DIR}/bin/node" --version )"
	fi
	if [ -x "${NODE_DIR}/bin/node" ] && [ "${current}" -lt "${NODE_MAJOR}" ]; then
		export PATH="${NODE_DIR}/bin:${PATH}"
		log "put ${NODE_DIR}/bin first on PATH for this run; in your shell: export PATH=\"${NODE_DIR}/bin:\$PATH\""
	fi

	if [ -d "${REPO_ROOT}/node_modules" ]; then
		log "node_modules present; skipping npm ci"
	else
		log "npm ci"
		( cd "${REPO_ROOT}" && npm ci --no-audit --no-fund )
	fi

	# The one piece of build output the PHP suite reads from disk, built
	# in CI for the same reason: an app's client view only counts when
	# its bundle exists.
	if compgen -G "${REPO_ROOT}/assets/js/apps/*.js" >/dev/null; then
		log "app client views already built"
	else
		log "npm run build:apps"
		( cd "${REPO_ROOT}" && npm run --silent build:apps )
	fi
}

# ---------------------------------------------------------------------
# 2. Composer (PHPUnit, polyfills, PHPCS)
# ---------------------------------------------------------------------

ensure_composer_deps() {
	if [ -x "${REPO_ROOT}/vendor/bin/phpunit" ]; then
		log "vendor/ present; skipping composer install"
		return
	fi
	need composer "install Composer"
	log "composer install"
	( cd "${REPO_ROOT}" && composer install --no-interaction --no-progress )
}

# ---------------------------------------------------------------------
# 3. Docker, through the Docker Hub mirror
# ---------------------------------------------------------------------

ensure_docker() {
	need docker "install the Docker CLI"
	if docker info >/dev/null 2>&1; then
		log "dockerd already running"
		if ! docker info 2>/dev/null | grep -q 'mirror.gcr.io'; then
			log "note: the running dockerd has no mirror.gcr.io registry mirror; Docker Hub pulls may hit 429"
		fi
		return
	fi
	need dockerd "install the Docker engine"
	if [ ! -f /etc/docker/daemon.json ]; then
		mkdir -p /etc/docker
		printf '{ "registry-mirrors": [ "https://mirror.gcr.io" ] }\n' > /etc/docker/daemon.json
		log "wrote /etc/docker/daemon.json (registry mirror)"
	elif ! grep -q 'mirror.gcr.io' /etc/docker/daemon.json; then
		log "note: /etc/docker/daemon.json exists without mirror.gcr.io; leaving it as is"
	fi
	log "starting dockerd"
	mkdir -p "${CACHE_ROOT}"
	nohup dockerd >"${CACHE_ROOT}/dockerd.log" 2>&1 &
	local i
	for i in $( seq 1 60 ); do
		docker info >/dev/null 2>&1 && { log "dockerd is up"; return; }
		sleep 1
	done
	die "dockerd did not come up; see ${CACHE_ROOT}/dockerd.log"
}

# ---------------------------------------------------------------------
# 4. MariaDB
# ---------------------------------------------------------------------

db_query() {
	docker exec "${DB_CONTAINER}" mariadb -uroot -p"${DB_PASSWORD}" -e "$1"
}

ensure_db() {
	local state
	state="$( docker inspect -f '{{.State.Running}}' "${DB_CONTAINER}" 2>/dev/null || true )"
	if [ "${state}" = "true" ]; then
		log "database container ${DB_CONTAINER} already running"
	elif [ -n "${state}" ]; then
		log "starting existing database container ${DB_CONTAINER}"
		docker start "${DB_CONTAINER}" >/dev/null
	else
		log "starting ${DB_IMAGE} as ${DB_CONTAINER} on 127.0.0.1:3306"
		docker run -d --name "${DB_CONTAINER}" \
			-p 127.0.0.1:3306:3306 \
			-e MARIADB_ROOT_PASSWORD="${DB_PASSWORD}" \
			-e MARIADB_DATABASE="${DB_NAME}" \
			"${DB_IMAGE}" >/dev/null
	fi
	local i
	for i in $( seq 1 60 ); do
		if db_query 'SELECT 1' >/dev/null 2>&1; then
			db_query "CREATE DATABASE IF NOT EXISTS ${DB_NAME}; CREATE DATABASE IF NOT EXISTS ${DB_SITE_NAME};"
			log "database accepts connections"
			return
		fi
		sleep 1
	done
	die "database did not accept connections; see: docker logs ${DB_CONTAINER}"
}

# ---------------------------------------------------------------------
# 5. Pinned WordPress core + the matching test library
# ---------------------------------------------------------------------

ensure_wordpress() {
	need unzip "install unzip"
	mkdir -p "${VERSION_DIR}"
	if [ -f "${CORE_DIR}/wp-includes/version.php" ]; then
		log "WordPress ${WP_VERSION} already in ${CORE_DIR}"
	else
		log "downloading WordPress ${WP_VERSION}"
		local zip="${VERSION_DIR}/wordpress.zip"
		curl -fsSL -o "${zip}" "https://wordpress.org/wordpress-${WP_VERSION}.zip" \
			|| die "could not download WordPress ${WP_VERSION} (is wordpress.org on the network allowlist?)"
		rm -rf "${CORE_DIR}"
		unzip -q "${zip}" -d "${VERSION_DIR}"
		rm -f "${zip}"
	fi

	if [ -f "${LIB_DIR}/vendor/wp-phpunit/wp-phpunit/includes/bootstrap.php" ]; then
		log "wp-phpunit ${WP_VERSION} already installed"
	else
		need composer "install Composer"
		log "installing wp-phpunit/wp-phpunit ${WP_VERSION} from Packagist"
		mkdir -p "${LIB_DIR}"
		[ -f "${LIB_DIR}/composer.json" ] || printf '{}\n' > "${LIB_DIR}/composer.json"
		( cd "${LIB_DIR}" && composer require --no-interaction --no-progress "wp-phpunit/wp-phpunit:${WP_VERSION}" ) \
			|| die "wp-phpunit/wp-phpunit ${WP_VERSION} is not on Packagist; pick a version it has (OPENSTATION_TESTS_WP_VERSION)"
	fi
}

# ---------------------------------------------------------------------
# 6. wp-config.php + wp-tests-config.php, the way wp-env writes them
# ---------------------------------------------------------------------

# The egress proxy as host:port, or nothing.
proxy_host_port() {
	local proxy="${HTTPS_PROXY:-${https_proxy:-}}"
	proxy="${proxy#*://}"
	proxy="${proxy##*@}"
	proxy="${proxy%%/*}"
	printf '%s' "${proxy}"
}

# The CA bundle that trusts the egress proxy, or nothing.
proxy_ca_file() {
	local candidate
	for candidate in "${SSL_CERT_FILE:-}" "${CURL_CA_BUNDLE:-}" /root/.ccr/ca-bundle.crt; do
		if [ -n "${candidate}" ] && [ -f "${candidate}" ]; then
			printf '%s' "${candidate}"
			return
		fi
	done
}

write_configs() {
	if [ ! -f "${SALTS_FILE}" ]; then
		php "${REPO_ROOT}/bin/cloud-test-env-config.php" salts "${SALTS_FILE}"
		log "generated salts"
	fi

	local proxy
	proxy="$( proxy_host_port )"
	php "${REPO_ROOT}/bin/cloud-test-env-config.php" configs \
		"${REPO_ROOT}/.wp-env.tests.json" "${SALTS_FILE}" \
		"${CORE_DIR}/wp-config.php" "${TESTS_CONFIG}" "${proxy}"
	log "wrote ${CORE_DIR}/wp-config.php and ${TESTS_CONFIG}"

	# WordPress verifies TLS against its own bundle, which does not know
	# the proxy's CA. This core is a disposable test copy; add it there.
	local ca bundle="${CORE_DIR}/wp-includes/certificates/ca-bundle.crt"
	ca="$( proxy_ca_file )"
	if [ -n "${proxy}" ] && [ -n "${ca}" ] && ! grep -q 'cloud-test-env: egress proxy CA' "${bundle}"; then
		{
			printf '\n# cloud-test-env: egress proxy CA\n'
			cat "${ca}"
		} >> "${bundle}"
		log "added the egress proxy's CA to the test core's CA bundle"
	fi
}

# ---------------------------------------------------------------------
# 7. The test image
# ---------------------------------------------------------------------

ensure_test_image() {
	if docker image inspect "${TEST_IMAGE}" >/dev/null 2>&1; then
		log "${TEST_IMAGE} already pulled"
	else
		log "pulling ${TEST_IMAGE}"
		docker pull -q "${TEST_IMAGE}" >/dev/null
	fi
}

# ---------------------------------------------------------------------
# phpunit: the suite, inside the test image
# ---------------------------------------------------------------------

run_phpunit() {
	local plugin="/var/www/html/wp-content/plugins/desktop-mode"
	local env_args=( -e WP_TESTS_DIR=/wordpress-phpunit -e WP_PHPUNIT__TESTS_CONFIG=/wp-tests-config.php )
	if [ -n "${WP_MULTISITE:-}" ]; then
		env_args+=( -e "WP_MULTISITE=${WP_MULTISITE}" )
	fi
	log "running PHPUnit in ${TEST_IMAGE}"
	docker run --rm --network host --user 0:0 \
		-v "${CORE_DIR}:/var/www/html" \
		-v "${REPO_ROOT}:${plugin}" \
		-v "${LIB_DIR}/vendor/wp-phpunit/wp-phpunit:/wordpress-phpunit:ro" \
		-v "${TESTS_CONFIG}:/wp-tests-config.php:ro" \
		"${env_args[@]}" \
		-w "${plugin}" \
		--entrypoint php \
		"${TEST_IMAGE}" \
		vendor/bin/phpunit --configuration tests/phpunit/phpunit.xml.dist "$@"
}

# ---------------------------------------------------------------------
# serve: a real site with this checkout as the plugin
# ---------------------------------------------------------------------

serve_site() {
	local site="${CACHE_ROOT}/site"
	local url="http://localhost:${SERVE_PORT}"
	if [ ! -f "${site}/wp-includes/version.php" ]; then
		log "copying WordPress ${WP_VERSION} into ${site}"
		mkdir -p "${site}"
		cp -R "${CORE_DIR}/." "${site}/"
	fi
	# `desktop-mode` is the plugin slug, which is frozen (see AGENTS.md).
	# A copy of the test core carries the empty directory the test image
	# mounts the checkout on; the link replaces it.
	local link="${site}/wp-content/plugins/desktop-mode"
	if [ -d "${link}" ] && [ ! -L "${link}" ]; then
		rmdir "${link}"
	fi
	ln -sfn "${REPO_ROOT}" "${link}"
	cat > "${site}/wp-config.php" <<EOF
<?php
// Written by bin/cloud-test-env.sh — regenerated on every run.
define( 'DB_NAME', '${DB_SITE_NAME}' );
define( 'DB_USER', 'root' );
define( 'DB_PASSWORD', '${DB_PASSWORD}' );
define( 'DB_HOST', '127.0.0.1:3306' );
define( 'DB_CHARSET', 'utf8mb4' );
define( 'DB_COLLATE', '' );
define( 'WP_HOME', '${url}' );
define( 'WP_SITEURL', '${url}' );
define( 'WP_ENVIRONMENT_TYPE', 'local' );
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_DISPLAY', false );
define( 'WP_DEBUG_LOG', true );
\$table_prefix = 'wp_';
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
EOF

	if curl -fsS -o /dev/null "${url}/wp-login.php" 2>/dev/null; then
		log "a server already answers on ${url}"
	else
		log "starting php -S on ${url}"
		( cd "${site}" && nohup php -S "127.0.0.1:${SERVE_PORT}" >"${CACHE_ROOT}/php-server.log" 2>&1 & )
		local i
		for i in $( seq 1 30 ); do
			curl -fsS -o /dev/null "${url}/wp-login.php" 2>/dev/null && break
			sleep 1
		done
	fi

	php "${REPO_ROOT}/bin/cloud-test-env-config.php" install-site "${site}" \
		| sed 's/^/[cloud-test-env] site: /'
	log "site ready: ${url}/wp-admin/ (admin / password). JS changes need npm run build."
}

# ---------------------------------------------------------------------

main() {
	local command="${1:-}"
	if [ $# -gt 0 ]; then
		shift
	fi

	need php "install PHP (it writes the configs and serves the site)"
	need curl "install curl"

	ensure_node
	ensure_composer_deps
	ensure_docker
	ensure_db
	ensure_wordpress
	write_configs
	ensure_test_image

	case "${command}" in
		phpunit)
			run_phpunit "$@"
			;;
		serve)
			php -m | grep -qi '^mysqli$' || die "the host PHP is missing the mysqli extension"
			serve_site
			;;
		'')
			log "done. Run the suite with: bin/cloud-test-env.sh phpunit"
			;;
		*)
			die "unknown command '${command}' (expected: phpunit, serve)"
			;;
	esac
}

main "$@"
