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
 * Builds a zip of an extension folder from a local checkout, in pure
 * PHP via ZipArchive.
 *
 * Why not shell out to `bin/package-extensions.sh`? That script needs
 * `bin/`, `git`, `bash`, `tar`, and `zip` to be present at the
 * checkout — none of which are guaranteed in a typical wp-env / Studio
 * setup, which mounts only the plugin folder (not the source tree) and
 * runs PHP in a sandbox where `exec()` may be disabled. Doing it in
 * PHP keeps this hatch usable across environments.
 *
 * Skips the dev/build artifacts that have no business in a plugin zip
 * (`.git`, `.DS_Store`, `node_modules`, OS junk). Vendored content
 * (e.g. `assets/vendor/phpmyadmin/` for the phpMyAdmin extension) IS
 * included verbatim — that's the same behaviour
 * `bin/package-extensions.sh` produces in CI via its splice step. If
 * the vendor dir is missing locally, run the extension's
 * `bin/fetch-*.sh` once on the host before installing.
 *
 * @since 0.6.0
 *
 * @param string $slug
 * @return string|WP_Error|null Absolute path on success; WP_Error if
 *                              local-dev mode is on but the build
 *                              failed; null when local-dev mode is off.
 */
function desktop_mode_marketplace_local_zip( $slug ) {
	$checkout = desktop_mode_marketplace_local_checkout();
	if ( null === $checkout ) {
		return null;
	}
	$src = $checkout . '/extensions/' . $slug;
	if ( ! is_dir( $src ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_local_missing_ext',
			sprintf(
				/* translators: %s: filesystem path */
				__( 'Extension folder not found in checkout: %s', 'desktop-mode' ),
				$src
			),
			array( 'status' => 500 )
		);
	}
	if ( ! class_exists( 'ZipArchive' ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_no_zip_archive',
			__( 'PHP ZipArchive is required for local-dev install.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	require_once ABSPATH . 'wp-admin/includes/file.php';
	$tmp_zip = wp_tempnam( $slug . '.zip' );
	if ( ! $tmp_zip ) {
		return new WP_Error(
			'desktop_mode_marketplace_tmp_failed',
			__( 'Could not allocate a temp file for the local zip.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$zip = new ZipArchive();
	if ( true !== $zip->open( $tmp_zip, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
		@unlink( $tmp_zip );
		return new WP_Error(
			'desktop_mode_marketplace_zip_open_failed',
			__( 'Could not create the local zip.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$src_real = realpath( $src );
	$prefix_len = strlen( $src_real ) + 1;
	$skip_pattern = '#(^|/)(\.git|\.DS_Store|node_modules|\.cache|dist)(/|$)#';

	$iter = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator( $src_real, FilesystemIterator::SKIP_DOTS ),
		RecursiveIteratorIterator::SELF_FIRST
	);
	foreach ( $iter as $item ) {
		/** @var SplFileInfo $item */
		$abs = $item->getPathname();
		$rel = (string) substr( $abs, $prefix_len );
		if ( '' === $rel ) {
			continue;
		}
		if ( preg_match( $skip_pattern, $rel ) ) {
			continue;
		}
		$entry = $slug . '/' . $rel;
		if ( $item->isDir() ) {
			$zip->addEmptyDir( $entry );
		} else {
			$zip->addFile( $abs, $entry );
		}
	}

	if ( true !== $zip->close() ) {
		@unlink( $tmp_zip );
		return new WP_Error(
			'desktop_mode_marketplace_zip_close_failed',
			__( 'Could not finalize the local zip.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	return $tmp_zip;
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
