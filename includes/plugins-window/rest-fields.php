<?php
/**
 * Desktop Mode — Native Plugins Window: REST field decorators.
 *
 * Adds enrichment fields to Core's `/wp/v2/plugins` REST resource so
 * the JS bundle can render rich rows in one round-trip:
 *
 *   - desktop_mode_update_available — `{ available, new_version }`
 *   - desktop_mode_can_manage       — `{ activate, deactivate, delete }`
 *   - desktop_mode_icon_url         — best-effort wp.org icon URL
 *   - desktop_mode_size_kb          — disk size of plugin folder
 *
 * Plugin Check posture: every callback below uses ONLY functions
 * available in `wp-includes/` (current_user_can, get_site_transient,
 * filesize, glob, …). No admin-only includes are needed, so REST is
 * the right home — registering these fields on `rest_api_init` keeps
 * the contract consistent with Core's other plugin REST decorators.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the four enrichment fields on the `plugin` REST resource.
 *
 * @since 0.9.0
 */
function desktop_mode_plugins_window_register_rest_fields() {
	register_rest_field(
		'plugin',
		'desktop_mode_update_available',
		array(
			'get_callback' => 'desktop_mode_plugins_window_field_update_available',
			'schema'       => array(
				'description' => __( 'Whether an update is available for this plugin (and the available version).', 'desktop-mode' ),
				'type'        => 'object',
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'plugin',
		'desktop_mode_can_manage',
		array(
			'get_callback' => 'desktop_mode_plugins_window_field_can_manage',
			'schema'       => array(
				'description' => __( 'Per-plugin capability flags for the requester (activate / deactivate / delete).', 'desktop-mode' ),
				'type'        => 'object',
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'plugin',
		'desktop_mode_icon_url',
		array(
			'get_callback' => 'desktop_mode_plugins_window_field_icon_url',
			'schema'       => array(
				'description' => __( 'Best-effort icon URL for the plugin (resolves from the wp.org slug, null when unknown).', 'desktop-mode' ),
				'type'        => array( 'string', 'null' ),
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'plugin',
		'desktop_mode_size_kb',
		array(
			'get_callback' => 'desktop_mode_plugins_window_field_size_kb',
			'schema'       => array(
				'description' => __( 'Approximate disk footprint of the plugin folder, in kilobytes (cached 6h).', 'desktop-mode' ),
				'type'        => array( 'integer', 'null' ),
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_plugins_window_register_rest_fields' );

/**
 * `desktop_mode_update_available` callback.
 *
 * @since 0.9.0
 *
 * @param array $row Core REST plugin row.
 * @return array{available:bool,new_version:string|null}
 */
function desktop_mode_plugins_window_field_update_available( $row ) {
	$plugin_file = isset( $row['plugin'] ) ? (string) $row['plugin'] : '';
	if ( '' === $plugin_file ) {
		return array(
			'available'   => false,
			'new_version' => null,
		);
	}

	// `update_plugins` is the canonical site-wide cache of pending
	// updates, refreshed by `wp_update_plugins()` on the standard
	// schedule. Reading it costs nothing.
	$updates = get_site_transient( 'update_plugins' );
	if ( ! is_object( $updates ) || empty( $updates->response ) || ! is_array( $updates->response ) ) {
		return array(
			'available'   => false,
			'new_version' => null,
		);
	}

	if ( ! isset( $updates->response[ $plugin_file ] ) ) {
		return array(
			'available'   => false,
			'new_version' => null,
		);
	}

	$entry = $updates->response[ $plugin_file ];
	$ver   = is_object( $entry ) && isset( $entry->new_version )
		? (string) $entry->new_version
		: null;

	return array(
		'available'   => true,
		'new_version' => $ver,
	);
}

/**
 * `desktop_mode_can_manage` callback.
 *
 * Per-row cap surface so the JS UI can hide actions the viewer can't
 * perform without re-deriving caps client-side. Server still
 * re-validates every mutation.
 *
 * @since 0.9.0
 *
 * @param array $row Core REST plugin row.
 * @return array{activate:bool,deactivate:bool,delete:bool}
 */
function desktop_mode_plugins_window_field_can_manage( $row ) {
	$status = isset( $row['status'] ) ? (string) $row['status'] : '';

	$can_activate = current_user_can( 'activate_plugins' );
	$can_delete   = current_user_can( 'delete_plugins' );

	// Active plugins can only be deleted after deactivation; surface
	// that constraint so the JS can dim the Delete action while the
	// row is active.
	$can_delete_now = $can_delete && 'inactive' === $status;

	return array(
		'activate'   => $can_activate && 'inactive' === $status,
		'deactivate' => $can_activate && 'active' === $status,
		'delete'     => $can_delete_now,
	);
}

/**
 * `desktop_mode_icon_url` callback.
 *
 * Derives a wp.org icon URL from the plugin's slug. We prefer the
 * SVG (`icon.svg`), fall back to the 256×256 PNG, and finally the
 * 128×128 PNG. We don't HEAD-check the URL — the JS card has an
 * `onerror` fallback to a `<wpd-icon name="dashicons-admin-plugins">`
 * placeholder, so a 404 here costs nothing.
 *
 * Plugins not on the .org repo (premium, internal, single-site) get
 * `null` and the JS falls straight to the placeholder.
 *
 * @since 0.9.0
 *
 * @param array $row Core REST plugin row.
 * @return string|null
 */
function desktop_mode_plugins_window_field_icon_url( $row ) {
	// Core's controller exposes the directory slug under `textdomain`
	// for .org plugins (same as the wp.org repo slug). Empty when the
	// plugin doesn't ship a Text Domain header — fine, we just return
	// null and the placeholder paints.
	$slug = isset( $row['textdomain'] ) ? (string) $row['textdomain'] : '';
	$slug = sanitize_key( $slug );
	if ( '' === $slug ) {
		return null;
	}

	/**
	 * Filter the resolved icon URL for a plugin row.
	 *
	 * Return `null` to suppress the icon (forces the placeholder).
	 * Return a different URL to override the wp.org default — useful
	 * for custom CDN art or premium plugins shipping a known asset URL.
	 *
	 * @since 0.9.0
	 *
	 * @param string|null $url  Default URL (wp.org SVG by slug).
	 * @param string      $slug Plugin slug.
	 * @param array       $row  Core REST plugin row.
	 */
	return apply_filters(
		'desktop_mode_plugins_window_icon_url',
		'https://ps.w.org/' . $slug . '/assets/icon.svg',
		$slug,
		$row
	);
}

/**
 * `desktop_mode_size_kb` callback. Caches per-plugin for 6 hours so
 * a 50-row table doesn't `glob`+`filesize` 50 directories on every
 * fetch. Returns `null` when the folder can't be read.
 *
 * @since 0.9.0
 *
 * @param array $row Core REST plugin row.
 * @return int|null Size in kilobytes, or null on failure.
 */
function desktop_mode_plugins_window_field_size_kb( $row ) {
	$plugin_file = isset( $row['plugin'] ) ? (string) $row['plugin'] : '';
	if ( '' === $plugin_file ) {
		return null;
	}

	// `WP_PLUGIN_DIR` is defined in `wp-includes/default-constants.php`
	// — safe to reference anywhere.
	$plugin_dir = WP_PLUGIN_DIR;
	$root       = $plugin_dir . '/' . dirname( $plugin_file );
	if ( '.' === dirname( $plugin_file ) || ! is_dir( $root ) ) {
		// Single-file plugins (e.g. hello.php at the root of plugins/).
		$candidate = $plugin_dir . '/' . $plugin_file;
		if ( is_file( $candidate ) ) {
			$bytes = (int) filesize( $candidate );
			return $bytes > 0 ? max( 1, (int) round( $bytes / 1024 ) ) : 0;
		}
		return null;
	}

	$cache_key = 'dm_pwsz_' . md5( $plugin_file );
	$cached    = get_transient( $cache_key );
	if ( false !== $cached && is_int( $cached ) ) {
		return $cached;
	}

	$kb = desktop_mode_plugins_window_compute_dir_size_kb( $root );
	set_transient( $cache_key, $kb, 6 * HOUR_IN_SECONDS );
	return $kb;
}

/**
 * Recursively sum file sizes under `$dir`, returning kilobytes.
 *
 * Caps total iteration to 5,000 entries so a pathological symlink
 * loop (or an enormous plugin folder full of vendor cruft) can't
 * stall a REST response. When the cap trips we return whatever we
 * counted so far — a slight under-report is better than a hung
 * request.
 *
 * @since 0.9.0
 *
 * @param string $dir Absolute filesystem path.
 * @return int Kilobytes (rounded).
 */
function desktop_mode_plugins_window_compute_dir_size_kb( $dir ) {
	if ( ! is_dir( $dir ) ) {
		return 0;
	}

	$total_bytes = 0;
	$visited     = 0;
	$max_visit   = 5000;

	$stack = array( $dir );
	while ( ! empty( $stack ) && $visited < $max_visit ) {
		$current = array_pop( $stack );
		$entries = @scandir( $current ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- best-effort, errors fall back to null.
		if ( ! is_array( $entries ) ) {
			continue;
		}
		foreach ( $entries as $entry ) {
			if ( '.' === $entry || '..' === $entry ) {
				continue;
			}
			$path = $current . '/' . $entry;
			if ( is_link( $path ) ) {
				// Skip symlinks: they could escape the plugin folder
				// or recurse infinitely. The classic admin's plugin
				// list ignores symlink contents for the same reason.
				continue;
			}
			$visited++;
			if ( $visited >= $max_visit ) {
				break 2;
			}
			if ( is_dir( $path ) ) {
				$stack[] = $path;
			} elseif ( is_file( $path ) ) {
				$total_bytes += (int) filesize( $path );
			}
		}
	}

	return $total_bytes > 0 ? max( 1, (int) round( $total_bytes / 1024 ) ) : 0;
}
