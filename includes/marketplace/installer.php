<?php
/**
 * Desktop Mode — Extensions marketplace: install / activate / delete.
 *
 * Thin wrappers around `Plugin_Upgrader` and friends, gated by the
 * standard plugin-management capabilities. Every mutation re-fetches
 * the manifest first to (a) guarantee the slug is one we know about
 * and (b) re-validate the download URL against an SSRF allowlist.
 *
 * Local-dev escape hatch: when `WP_DEBUG` is on AND
 * `WP_DESKTOP_LOCAL_MARKETPLACE_DIR` points at a checkout of this repo,
 * install/update will run `bin/package-extensions.sh` against that
 * checkout and install the resulting zip from disk — letting an
 * extension developer iterate without cutting a release.
 *
 * @since 0.6.0
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns true when the current user can install/update/delete plugins.
 *
 * On multisite this returns false for non-super-admins (matching
 * `install_plugins` semantics), giving us the "visible read-only" UX
 * for subsite admins.
 *
 * @since 0.6.0
 *
 * @return bool
 */
function desktop_mode_marketplace_user_can_modify() {
	return current_user_can( 'install_plugins' )
		&& current_user_can( 'delete_plugins' )
		&& current_user_can( 'activate_plugins' );
}

/**
 * Hosts the marketplace will accept download URLs from.
 *
 * Filterable so a fork pointing at a private mirror can extend the
 * list — but the default keeps us inside github.com / its release
 * asset CDN, which is what the resolved manifest produces.
 *
 * @since 0.6.0
 *
 * @return string[]
 */
function desktop_mode_marketplace_allowed_hosts() {
	$hosts = array( 'github.com', 'objects.githubusercontent.com', 'codeload.github.com' );

	$manifest_host = wp_parse_url( desktop_mode_marketplace_manifest_url(), PHP_URL_HOST );
	if ( $manifest_host && ! in_array( $manifest_host, $hosts, true ) ) {
		$hosts[] = $manifest_host;
	}

	/**
	 * Filter the host allowlist used to validate marketplace download URLs.
	 *
	 * @since 0.6.0
	 *
	 * @param string[] $hosts Lowercase hostnames.
	 */
	return (array) apply_filters( 'wp_desktop_marketplace_allowed_hosts', $hosts );
}

/**
 * Returns true when `$url` is safe to pass to `Plugin_Upgrader::install()`.
 *
 * @since 0.6.0
 *
 * @param string $url
 * @return bool
 */
function desktop_mode_marketplace_is_allowed_url( $url ) {
	$parts = wp_parse_url( $url );
	if ( ! is_array( $parts ) ) {
		return false;
	}
	$scheme = isset( $parts['scheme'] ) ? strtolower( $parts['scheme'] ) : '';
	$host = isset( $parts['host'] ) ? strtolower( $parts['host'] ) : '';
	if ( 'https' !== $scheme || '' === $host ) {
		return false;
	}
	return in_array( $host, desktop_mode_marketplace_allowed_hosts(), true );
}

/**
 * Looks up a manifest entry by slug.
 *
 * @since 0.6.0
 *
 * @param string $slug
 * @return array|WP_Error
 */
function desktop_mode_marketplace_get_entry( $slug ) {
	$merged = desktop_mode_marketplace_get_extensions();
	if ( is_wp_error( $merged ) ) {
		return $merged;
	}
	foreach ( $merged['extensions'] as $entry ) {
		if ( isset( $entry['slug'] ) && $entry['slug'] === $slug ) {
			return $entry;
		}
	}
	return new WP_Error(
		'desktop_mode_marketplace_unknown_slug',
		sprintf(
			/* translators: %s: extension slug */
			__( 'Unknown extension: %s', 'desktop-mode' ),
			$slug
		),
		array( 'status' => 404 )
	);
}

/**
 * Returns the path to a built zip from a local checkout, building it
 * on demand via `bin/package-extensions.sh`. Only fires when the
 * dev-mode constant is set; otherwise returns null and the standard
 * download-from-release path runs.
 *
 * @since 0.6.0
 *
 * @param string $slug
 * @return string|WP_Error|null Absolute path on success; WP_Error if dev
 *                              mode is on but the build failed; null when
 *                              dev mode is off.
 */
function desktop_mode_marketplace_local_zip( $slug ) {
	if ( ! ( defined( 'WP_DEBUG' ) && WP_DEBUG ) ) {
		return null;
	}
	if ( ! defined( 'WP_DESKTOP_LOCAL_MARKETPLACE_DIR' ) ) {
		return null;
	}
	$checkout = (string) WP_DESKTOP_LOCAL_MARKETPLACE_DIR;
	$script = $checkout . '/bin/package-extensions.sh';
	if ( ! is_executable( $script ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_local_missing',
			sprintf(
				/* translators: %s: filesystem path */
				__( 'WP_DESKTOP_LOCAL_MARKETPLACE_DIR is set but %s is not executable.', 'desktop-mode' ),
				$script
			),
			array( 'status' => 500 )
		);
	}
	if ( ! function_exists( 'exec' ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_exec_disabled',
			__( 'PHP exec() is disabled — local dev mode cannot run the package script.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$out = array();
	$rc = 0;
	$cmd = 'cd ' . escapeshellarg( $checkout ) . ' && ' . escapeshellarg( $script ) . ' 2>&1';
	exec( $cmd, $out, $rc );
	if ( 0 !== $rc ) {
		return new WP_Error(
			'desktop_mode_marketplace_local_build_failed',
			__( 'package-extensions.sh exited non-zero.', 'desktop-mode' ),
			array(
				'status' => 500,
				'output' => implode( "\n", $out ),
			)
		);
	}

	$zip = $checkout . '/dist/' . $slug . '.zip';
	if ( ! is_readable( $zip ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_local_missing_zip',
			sprintf(
				/* translators: %s: filesystem path */
				__( 'Expected zip not found after build: %s', 'desktop-mode' ),
				$zip
			),
			array( 'status' => 500 )
		);
	}
	return $zip;
}

/**
 * Resolves the install source (URL or absolute path) for a slug.
 *
 * @since 0.6.0
 *
 * @param array $entry Merged manifest entry.
 * @return string|WP_Error
 */
function desktop_mode_marketplace_resolve_source( array $entry ) {
	$slug = isset( $entry['slug'] ) ? (string) $entry['slug'] : '';
	$local = desktop_mode_marketplace_local_zip( $slug );
	if ( is_wp_error( $local ) ) {
		return $local;
	}
	if ( is_string( $local ) ) {
		return $local;
	}

	$url = isset( $entry['download_url'] ) ? (string) $entry['download_url'] : '';
	if ( '' === $url ) {
		return new WP_Error(
			'desktop_mode_marketplace_no_download_url',
			__( 'Manifest entry has no download_url.', 'desktop-mode' ),
			array( 'status' => 502 )
		);
	}
	if ( ! desktop_mode_marketplace_is_allowed_url( $url ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_blocked_url',
			__( 'Refusing to download from a host that is not on the allowlist.', 'desktop-mode' ),
			array( 'status' => 502 )
		);
	}
	return $url;
}

/**
 * Loads the upgrader stack. Idempotent.
 *
 * @since 0.6.0
 */
function desktop_mode_marketplace_require_upgrader() {
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/misc.php';
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
	require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
}

/**
 * Installs an extension from the manifest.
 *
 * @since 0.6.0
 *
 * @param string $slug
 * @return array|WP_Error Merged manifest entry (post-install) on success.
 */
function desktop_mode_marketplace_install_extension( $slug ) {
	$entry = desktop_mode_marketplace_get_entry( $slug );
	if ( is_wp_error( $entry ) ) {
		return $entry;
	}
	if ( ! empty( $entry['installed'] ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_already_installed',
			__( 'Extension is already installed.', 'desktop-mode' ),
			array( 'status' => 409 )
		);
	}

	$source = desktop_mode_marketplace_resolve_source( $entry );
	if ( is_wp_error( $source ) ) {
		return $source;
	}

	desktop_mode_marketplace_require_upgrader();
	$skin = new WP_Ajax_Upgrader_Skin();
	$upgrader = new Plugin_Upgrader( $skin );
	$result = $upgrader->install( $source );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	if ( is_wp_error( $skin->result ) ) {
		return $skin->result;
	}
	if ( false === $result ) {
		$errors = $skin->get_errors();
		if ( is_wp_error( $errors ) && $errors->has_errors() ) {
			return $errors;
		}
		return new WP_Error(
			'desktop_mode_marketplace_install_failed',
			__( 'Plugin_Upgrader::install() returned false.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	desktop_mode_marketplace_clear_cache();

	/**
	 * Fires after an extension is installed via the marketplace.
	 *
	 * @since 0.6.0
	 *
	 * @param string $slug
	 * @param array  $entry The manifest entry.
	 */
	do_action( 'wp_desktop_marketplace_extension_installed', $slug, $entry );

	return desktop_mode_marketplace_get_entry( $slug );
}

/**
 * Updates an installed extension to the manifest version.
 *
 * @since 0.6.0
 *
 * @param string $slug
 * @return array|WP_Error
 */
function desktop_mode_marketplace_update_extension( $slug ) {
	$entry = desktop_mode_marketplace_get_entry( $slug );
	if ( is_wp_error( $entry ) ) {
		return $entry;
	}
	if ( empty( $entry['installed'] ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_not_installed',
			__( 'Extension is not installed.', 'desktop-mode' ),
			array( 'status' => 409 )
		);
	}
	$source = desktop_mode_marketplace_resolve_source( $entry );
	if ( is_wp_error( $source ) ) {
		return $source;
	}

	desktop_mode_marketplace_require_upgrader();

	// Plugin_Upgrader::install() refuses if the destination already
	// exists; updates use the same install path with a "clear
	// destination" override so we don't have to translate the source
	// into the WP-update transient shape.
	add_filter( 'upgrader_package_options', 'desktop_mode_marketplace_force_clear_destination' );
	$skin = new WP_Ajax_Upgrader_Skin();
	$upgrader = new Plugin_Upgrader( $skin );
	$result = $upgrader->install( $source );
	remove_filter( 'upgrader_package_options', 'desktop_mode_marketplace_force_clear_destination' );

	if ( is_wp_error( $result ) ) {
		return $result;
	}
	if ( is_wp_error( $skin->result ) ) {
		return $skin->result;
	}

	desktop_mode_marketplace_clear_cache();

	/** @since 0.6.0 */
	do_action( 'wp_desktop_marketplace_extension_updated', $slug, $entry );

	return desktop_mode_marketplace_get_entry( $slug );
}

/**
 * Forces `Plugin_Upgrader::install()` to overwrite an existing folder.
 * Bound only for the duration of an update call.
 *
 * @since 0.6.0
 *
 * @param array $options
 * @return array
 */
function desktop_mode_marketplace_force_clear_destination( $options ) {
	$options['clear_destination'] = true;
	$options['abort_if_destination_exists'] = false;
	return $options;
}

/**
 * Activates an installed extension.
 *
 * @since 0.6.0
 *
 * @param string $slug
 * @return array|WP_Error
 */
function desktop_mode_marketplace_activate_extension( $slug ) {
	$entry = desktop_mode_marketplace_get_entry( $slug );
	if ( is_wp_error( $entry ) ) {
		return $entry;
	}
	if ( empty( $entry['installed'] ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_not_installed',
			__( 'Extension is not installed.', 'desktop-mode' ),
			array( 'status' => 409 )
		);
	}
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	$result = activate_plugin( $entry['plugin_file'] );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return desktop_mode_marketplace_get_entry( $slug );
}

/**
 * Deactivates an active extension.
 *
 * @since 0.6.0
 *
 * @param string $slug
 * @return array|WP_Error
 */
function desktop_mode_marketplace_deactivate_extension( $slug ) {
	$entry = desktop_mode_marketplace_get_entry( $slug );
	if ( is_wp_error( $entry ) ) {
		return $entry;
	}
	if ( empty( $entry['plugin_file'] ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_not_installed',
			__( 'Extension is not installed.', 'desktop-mode' ),
			array( 'status' => 409 )
		);
	}
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	deactivate_plugins( $entry['plugin_file'] );
	return desktop_mode_marketplace_get_entry( $slug );
}

/**
 * Deletes an installed extension. Auto-deactivates first if active.
 *
 * @since 0.6.0
 *
 * @param string $slug
 * @return array|WP_Error
 */
function desktop_mode_marketplace_delete_extension( $slug ) {
	$entry = desktop_mode_marketplace_get_entry( $slug );
	if ( is_wp_error( $entry ) ) {
		return $entry;
	}
	if ( empty( $entry['plugin_file'] ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_not_installed',
			__( 'Extension is not installed.', 'desktop-mode' ),
			array( 'status' => 409 )
		);
	}
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	if ( is_plugin_active( $entry['plugin_file'] ) ) {
		deactivate_plugins( $entry['plugin_file'] );
	}
	$result = delete_plugins( array( $entry['plugin_file'] ) );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	if ( false === $result ) {
		return new WP_Error(
			'desktop_mode_marketplace_delete_failed',
			__( 'delete_plugins() returned false.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	desktop_mode_marketplace_clear_cache();

	/** @since 0.6.0 */
	do_action( 'wp_desktop_marketplace_extension_deleted', $slug, $entry );

	return desktop_mode_marketplace_get_entry( $slug );
}
