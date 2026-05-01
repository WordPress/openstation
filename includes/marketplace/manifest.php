<?php
/**
 * Desktop Mode — Extensions marketplace: manifest fetch + merge.
 *
 * Fetches `extensions.resolved.json` from the configured GitHub release
 * and merges it with the locally-installed plugin state so the UI can
 * render "install / activate / update / delete" actions per extension.
 *
 * The manifest is the source of truth for "what extensions exist";
 * `get_plugins()` is the source of truth for "what's installed here".
 *
 * @since 0.6.0
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/** Transient key for the cached manifest. */
const DESKTOP_MODE_MARKETPLACE_TRANSIENT = 'desktop_mode_marketplace_manifest';

/** Default cache lifetime for the remote manifest. */
const DESKTOP_MODE_MARKETPLACE_CACHE_TTL = 15 * MINUTE_IN_SECONDS;

/**
 * Returns the manifest URL the marketplace fetches.
 *
 * Defaults to the `latest` release alias on the public repo —
 * pre-releases don't update that alias, so production users are
 * insulated from in-flight work. Filterable so forks / mirrors can
 * point elsewhere.
 *
 * @since 0.6.0
 *
 * @return string
 */
function desktop_mode_marketplace_manifest_url() {
	$url = 'https://github.com/WordPress/desktop-mode/releases/latest/download/extensions.resolved.json';

	/**
	 * Filter the URL the marketplace fetches its resolved manifest from.
	 *
	 * @since 0.6.0
	 *
	 * @param string $url Default points at the public repo's `latest` alias.
	 */
	return (string) apply_filters( 'wp_desktop_marketplace_manifest_url', $url );
}

/**
 * Fetches and decodes the resolved manifest, with a transient cache.
 *
 * @since 0.6.0
 *
 * @param bool $force When true, bypasses the cache and re-fetches.
 * @return array|WP_Error Decoded manifest array on success.
 */
function desktop_mode_marketplace_fetch_manifest( $force = false ) {
	// Local-dev fast path: when WP_DEBUG is on AND
	// WP_DESKTOP_LOCAL_MARKETPLACE_DIR points at a checkout, synthesize
	// the manifest from `extensions.json` + each plugin's header instead
	// of round-tripping through a release. Lets contributors test the
	// marketplace before any release that ships `extensions.resolved.json`
	// exists, and lets extension authors see header changes (Version,
	// Requires PHP, …) reflected immediately. Skips the transient cache
	// — recomputation is cheap and the user is iterating.
	$local = desktop_mode_marketplace_local_manifest();
	if ( is_wp_error( $local ) ) {
		return $local;
	}
	if ( is_array( $local ) ) {
		return $local;
	}

	if ( ! $force ) {
		$cached = get_site_transient( DESKTOP_MODE_MARKETPLACE_TRANSIENT );
		if ( is_array( $cached ) ) {
			return $cached;
		}
	}

	$url = desktop_mode_marketplace_manifest_url();
	$res = wp_remote_get(
		$url,
		array(
			'timeout' => 10,
			'headers' => array(
				'Accept' => 'application/json',
			),
		)
	);

	if ( is_wp_error( $res ) ) {
		return $res;
	}

	$code = wp_remote_retrieve_response_code( $res );
	if ( 200 !== (int) $code ) {
		return new WP_Error(
			'desktop_mode_marketplace_manifest_http',
			sprintf(
				/* translators: %d: HTTP status code */
				__( 'Failed to fetch the extensions manifest (HTTP %d).', 'desktop-mode' ),
				$code
			),
			array( 'status' => 502 )
		);
	}

	$body = wp_remote_retrieve_body( $res );
	$decoded = json_decode( $body, true );
	if ( ! is_array( $decoded ) || ! isset( $decoded['extensions'] ) || ! is_array( $decoded['extensions'] ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_manifest_invalid',
			__( 'The extensions manifest could not be parsed.', 'desktop-mode' ),
			array( 'status' => 502 )
		);
	}

	set_site_transient( DESKTOP_MODE_MARKETPLACE_TRANSIENT, $decoded, DESKTOP_MODE_MARKETPLACE_CACHE_TTL );

	return $decoded;
}

/**
 * Resolves the local-dev source checkout, if any.
 *
 * Two ways the checkout is found:
 *
 *   1. Explicit override via `WP_DESKTOP_LOCAL_MARKETPLACE_DIR`.
 *      Useful when the plugin is *not* the same as the source
 *      checkout — e.g. wp-env mounting the plugin folder at one
 *      path and the repo root at another.
 *
 *   2. Auto-detect from `DESKTOP_MODE_DIR`. When the running plugin
 *      lives in a directory that ALSO contains `extensions.json` and
 *      an `extensions/` directory, treat it as the source checkout.
 *      Released plugin zips `export-ignore` both, so a production
 *      install can't trip this even if `WP_DEBUG` is on.
 *
 * Both resolution paths require `WP_DEBUG`. Returns null when local
 * mode is off; an absolute path string otherwise.
 *
 * @since 0.6.0
 *
 * @return string|null
 */
function desktop_mode_marketplace_local_checkout() {
	if ( ! ( defined( 'WP_DEBUG' ) && WP_DEBUG ) ) {
		return null;
	}
	if ( defined( 'WP_DESKTOP_LOCAL_MARKETPLACE_DIR' ) ) {
		return rtrim( (string) WP_DESKTOP_LOCAL_MARKETPLACE_DIR, '/\\' );
	}
	if ( defined( 'DESKTOP_MODE_DIR' ) ) {
		$candidate = rtrim( (string) DESKTOP_MODE_DIR, '/\\' );
		if (
			is_readable( $candidate . '/extensions.json' )
			&& is_dir( $candidate . '/extensions' )
		) {
			return $candidate;
		}
	}
	return null;
}

/**
 * Builds a synthetic manifest from a local checkout, mirroring what
 * `bin/build-manifest.sh` produces in CI.
 *
 * Reads `extensions.json` at the checkout root and merges in `Version`,
 * `Requires at least`, and `Requires PHP` from each extension's plugin
 * header. `download_url` is intentionally left empty — the local-dev
 * install path runs `bin/package-extensions.sh` against the checkout and
 * never reads `download_url`, so no value is needed.
 *
 * Returns null when local-dev mode is off (the normal remote-fetch path
 * runs); WP_Error when the checkout doesn't look right; the manifest
 * array on success.
 *
 * @since 0.6.0
 *
 * @return array|WP_Error|null
 */
function desktop_mode_marketplace_local_manifest() {
	$checkout = desktop_mode_marketplace_local_checkout();
	if ( null === $checkout ) {
		return null;
	}

	$catalog = $checkout . '/extensions.json';
	if ( ! is_readable( $catalog ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_local_no_catalog',
			sprintf(
				/* translators: %s: filesystem path */
				__( 'WP_DESKTOP_LOCAL_MARKETPLACE_DIR is set but %s is not readable.', 'desktop-mode' ),
				$catalog
			),
			array( 'status' => 500 )
		);
	}

	$decoded = json_decode( (string) file_get_contents( $catalog ), true );
	if ( ! is_array( $decoded ) || empty( $decoded['extensions'] ) || ! is_array( $decoded['extensions'] ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_local_invalid_catalog',
			sprintf(
				/* translators: %s: filesystem path */
				__( 'Could not parse %s — expected an object with an "extensions" array.', 'desktop-mode' ),
				$catalog
			),
			array( 'status' => 500 )
		);
	}

	if ( ! function_exists( 'get_plugin_data' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}

	$entries = array();
	foreach ( $decoded['extensions'] as $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['slug'] ) ) {
			continue;
		}
		$slug = (string) $entry['slug'];
		$plugin_file = $checkout . '/extensions/' . $slug . '/' . $slug . '.php';
		if ( ! is_readable( $plugin_file ) ) {
			continue;
		}
		$data = get_plugin_data( $plugin_file, false, false );
		if ( ! empty( $data['Version'] ) ) {
			$entry['version'] = (string) $data['Version'];
		}
		if ( ! empty( $data['RequiresWP'] ) ) {
			$entry['requires_wp'] = (string) $data['RequiresWP'];
		}
		if ( ! empty( $data['RequiresPHP'] ) ) {
			$entry['requires_php'] = (string) $data['RequiresPHP'];
		}
		$entries[] = $entry;
	}

	return array(
		'generated_at' => gmdate( 'Y-m-d\TH:i:s\Z' ),
		'release_tag'  => 'local',
		'extensions'   => $entries,
	);
}

/**
 * Drops the cached manifest. Called after install/update/delete and on
 * explicit refresh.
 *
 * @since 0.6.0
 */
function desktop_mode_marketplace_clear_cache() {
	delete_site_transient( DESKTOP_MODE_MARKETPLACE_TRANSIENT );
}

/**
 * Merges the manifest with installed-plugin state.
 *
 * Returns one entry per manifest extension, augmented with:
 *   - installed (bool)
 *   - active (bool)
 *   - installed_version (string|null)
 *   - needs_update (bool)
 *   - plugin_file (string|null) — relative path WP uses to identify
 *     the plugin (e.g. "my-plugin/my-plugin.php"); needed for
 *     activate / deactivate.
 *   - incompatible_environment (bool) — extension declared an
 *     `environments` list that doesn't include the current site's
 *     `wp_get_environment_type()`.
 *
 * @since 0.6.0
 *
 * @return array|WP_Error
 */
function desktop_mode_marketplace_get_extensions() {
	$manifest = desktop_mode_marketplace_fetch_manifest();
	if ( is_wp_error( $manifest ) ) {
		return $manifest;
	}

	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	$installed = get_plugins();
	$current_env = function_exists( 'wp_get_environment_type' )
		? wp_get_environment_type()
		: 'production';

	$entries = array();
	foreach ( $manifest['extensions'] as $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['slug'] ) ) {
			continue;
		}
		$slug = (string) $entry['slug'];
		$plugin_file = desktop_mode_marketplace_resolve_plugin_file( $slug, $installed );
		$installed_version = null;
		$is_active = false;
		if ( null !== $plugin_file ) {
			$installed_version = isset( $installed[ $plugin_file ]['Version'] )
				? (string) $installed[ $plugin_file ]['Version']
				: null;
			$is_active = is_plugin_active( $plugin_file );
		}

		$manifest_version = isset( $entry['version'] ) ? (string) $entry['version'] : '';
		$needs_update = false;
		if ( null !== $installed_version && '' !== $manifest_version ) {
			$needs_update = version_compare( $installed_version, $manifest_version, '<' );
		}

		$incompatible = false;
		if ( ! empty( $entry['environments'] ) && is_array( $entry['environments'] ) ) {
			$incompatible = ! in_array( $current_env, $entry['environments'], true );
		}

		$entries[] = array_merge(
			$entry,
			array(
				'installed'                => null !== $plugin_file,
				'active'                   => $is_active,
				'installed_version'        => $installed_version,
				'needs_update'             => $needs_update,
				'plugin_file'              => $plugin_file,
				'incompatible_environment' => $incompatible,
			)
		);
	}

	return array(
		'generated_at' => isset( $manifest['generated_at'] ) ? (string) $manifest['generated_at'] : '',
		'release_tag'  => isset( $manifest['release_tag'] ) ? (string) $manifest['release_tag'] : '',
		'current_environment' => $current_env,
		'extensions'   => $entries,
	);
}

/**
 * Looks up the installed-plugin file for a marketplace slug.
 *
 * Convention: extension zips drop into `wp-content/plugins/<slug>/`,
 * with the entry file at `<slug>/<slug>.php`. We trust that convention
 * for the fast path, then fall back to scanning the installed map for
 * any plugin whose folder matches the slug — covers cases where the
 * folder was renamed by hand.
 *
 * @since 0.6.0
 *
 * @param string $slug      Extension slug from the manifest.
 * @param array  $installed Output of `get_plugins()`.
 * @return string|null Plugin file (e.g. "my/my.php") or null if not installed.
 */
function desktop_mode_marketplace_resolve_plugin_file( $slug, array $installed ) {
	$expected = $slug . '/' . $slug . '.php';
	if ( isset( $installed[ $expected ] ) ) {
		return $expected;
	}
	foreach ( $installed as $file => $_data ) {
		$folder = strtok( $file, '/' );
		if ( $folder === $slug ) {
			return $file;
		}
	}
	return null;
}
