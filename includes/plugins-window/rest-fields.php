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
 * Resolve the plugin file path (relative to `WP_PLUGIN_DIR`, ending in
 * `.php`) for a Core REST plugin row.
 *
 * Core's `WP_REST_Plugins_Controller::prepare_item_for_response` emits
 * the `plugin` field with the trailing `.php` STRIPPED — e.g.
 * `"elementor/elementor"` rather than `"elementor/elementor.php"`. But
 * every internal WordPress data structure that keys off the plugin
 * file — `update_plugins` site transient, `active_plugins` option,
 * `plugin_basename()`, `WP_PLUGIN_DIR` paths — uses the full filename.
 * Mixing the two yields silent lookup misses (the symptom that hid
 * the "Update available" tab).
 *
 * This helper re-appends `.php` when missing so callers can use the
 * result as a transient/option key or filesystem path directly.
 *
 * @since 0.18.0
 *
 * @param array $row Core REST plugin row.
 * @return string Plugin file (e.g. `"elementor/elementor.php"`), or `''`
 *                when the row has no `plugin` field.
 */
function desktop_mode_plugins_window_row_plugin_file( $row ) {
	$file = isset( $row['plugin'] ) ? (string) $row['plugin'] : '';
	if ( '' === $file ) {
		return '';
	}
	if ( '.php' !== substr( $file, -4 ) ) {
		$file .= '.php';
	}
	return $file;
}

/**
 * Lazily prime the `update_plugins` site transient so REST callers see
 * the same "updates available" picture as the classic Plugins screen.
 *
 * Core only refreshes the transient on `load-plugins.php`,
 * `load-update-core.php`, and the twice-daily cron — REST is not on
 * that list, so a fresh page load of the desktop Plugins window can
 * see an empty/stale transient even when the dock badge (computed
 * off `$menu`, which Core builds against `wp_get_update_data()`)
 * reports pending updates. We mirror Core's own throttle
 * (`wp-admin/includes/update.php::_maybe_update_plugins()` — 12h since
 * last check) so a hot REST hit is a transient read, not an HTTPS
 * round-trip to api.wordpress.org.
 *
 * Idempotent on its own (Core's 12h throttle); callers that hit this
 * many times per request should additionally guard with their own
 * static so they don't pay the transient-read overhead per row.
 *
 * @since 0.18.0
 * @since 0.8.5 Accepts a `$force` flag — set by the in-window Refresh
 *               button via `?desktop_mode_force_refresh=1`. Bypasses
 *               the 12h throttle and runs `wp_clean_plugins_cache( true )`
 *               so the next read sees a fresh wp.org snapshot. Without
 *               this escape hatch the Refresh button was misleading:
 *               within 12h of the last check it returned the same
 *               cached "no updates" result Core had stored, while
 *               classic admin's `plugins.php` (which always calls
 *               `wp_clean_plugins_cache( true )`) showed pending updates.
 *
 * @param bool $force When true, delete the transient and force a fresh
 *                    wp.org check regardless of the 12h throttle.
 */
function desktop_mode_plugins_window_maybe_refresh_update_transient( $force = false ) {
	/**
	 * Short-circuit the lazy refresh of the `update_plugins` transient.
	 *
	 * Return `false` to skip the refresh — useful for hosts that run
	 * their own update orchestration (managed WordPress, internal
	 * mirrors) and don't want every REST hit to the plugins endpoint
	 * to potentially trigger a wp.org check. The filter also gates the
	 * explicit force-refresh path so hosts that block wp.org calls
	 * outright keep that posture even when the user clicks Refresh.
	 *
	 * @since 0.18.0
	 * @since 0.8.5 `$force` parameter added so filter callbacks can
	 *               distinguish opportunistic refreshes from explicit
	 *               user-initiated ones.
	 *
	 * @param bool $refresh Whether to call `wp_update_plugins()`.
	 * @param bool $force   Whether the caller asked to bypass the throttle.
	 */
	if ( ! apply_filters( 'desktop_mode_plugins_window_refresh_updates', true, $force ) ) {
		return;
	}

	if ( ! function_exists( 'wp_update_plugins' ) ) {
		// `wp-includes/update.php` is normally autoloaded on every
		// request; guard anyway so an unusual bootstrap (mu-plugin
		// CLI harness, stripped-down REST runtime) doesn't fatal.
		return;
	}

	if ( $force ) {
		// Explicit user-initiated refresh — bypass the throttle.
		// Two steps:
		//   1. Delete the `update_plugins` site transient (and the
		//      `plugins` cache group) via `wp_clean_plugins_cache()`,
		//      OR fall back to `delete_site_transient()` directly when
		//      the admin-side helper isn't loaded.
		//   2. Call `wp_update_plugins()` to repopulate the transient
		//      with a fresh wp.org snapshot. Without step 2 the field
		//      callback reads `false` for the rest of this request and
		//      every row reports "no updates" — that's the exact
		//      regression from the first cut of this fix (GH#202).
		if ( function_exists( 'wp_clean_plugins_cache' ) ) {
			wp_clean_plugins_cache( true );
		} else {
			delete_site_transient( 'update_plugins' );
		}
		wp_update_plugins();
		return;
	}

	$current = get_site_transient( 'update_plugins' );
	if (
		is_object( $current ) &&
		isset( $current->last_checked ) &&
		12 * HOUR_IN_SECONDS > ( time() - (int) $current->last_checked )
	) {
		// Inside Core's standard refresh window — trust the cached
		// snapshot, identical to `_maybe_update_plugins()`'s posture.
		return;
	}

	wp_update_plugins();
}

/**
 * Detect whether the current REST request asked for an explicit
 * `update_plugins` refresh via `?desktop_mode_force_refresh=1`.
 *
 * The flag is set by the in-window Refresh button (see
 * `fetchInstalledPlugins({ force: true })` in `src/plugins-window/rest.ts`)
 * and read from the query string on the way through Core's REST
 * dispatcher. Querystring is the canonical channel — the value is an
 * idempotent "use the slow path" hint, not a state-changing action,
 * so no additional nonce is required beyond REST's standard
 * `X-WP-Nonce` cookie-auth check.
 *
 * @since 0.8.5
 *
 * @return bool True when the request asked for a force-refresh.
 */
function desktop_mode_plugins_window_force_refresh_requested() {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only hint flag; REST auth is enforced separately.
	if ( ! isset( $_GET['desktop_mode_force_refresh'] ) ) {
		return false;
	}
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only hint flag; REST auth is enforced separately.
	$value = sanitize_text_field( wp_unslash( (string) $_GET['desktop_mode_force_refresh'] ) );
	return '1' === $value || 'true' === $value;
}

/**
 * `desktop_mode_update_available` callback.
 *
 * @since 0.9.0
 *
 * @param array $row Core REST plugin row.
 * @return array{available:bool,new_version:string|null,package:string,slug:string}
 */
function desktop_mode_plugins_window_field_update_available( $row ) {
	$plugin_file = desktop_mode_plugins_window_row_plugin_file( $row );
	if ( '' === $plugin_file ) {
		return array(
			'available'   => false,
			'new_version' => null,
			'package'     => '',
			'slug'        => '',
		);
	}

	// Prime the transient once per request before reading it —
	// otherwise REST callers see a stale/empty snapshot relative to
	// the classic Plugins screen and the dock update badge. Static
	// guard keeps the transient read off the hot per-row path. When
	// the request carries `?desktop_mode_force_refresh=1` we always
	// take the slow path so the in-window Refresh button can actually
	// pull a fresh wp.org snapshot (the original throttle made it a
	// no-op within 12h of the last check — see GH#202).
	static $primed = false;
	if ( ! $primed ) {
		$primed = true;
		desktop_mode_plugins_window_maybe_refresh_update_transient(
			desktop_mode_plugins_window_force_refresh_requested()
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
			'package'     => '',
			'slug'        => '',
		);
	}

	if ( ! isset( $updates->response[ $plugin_file ] ) ) {
		return array(
			'available'   => false,
			'new_version' => null,
			'package'     => '',
			'slug'        => '',
		);
	}

	$entry = $updates->response[ $plugin_file ];
	$ver   = is_object( $entry ) && isset( $entry->new_version )
		? (string) $entry->new_version
		: null;
	// `package` is the download URL Core's upgrader hits to fetch the
	// new .zip. Empty for plugins that don't ship a wp.org package
	// (premium / private hosts) — Core renders an "Automatic update is
	// unavailable for this plugin" notice in that case rather than the
	// "Update now" link. We surface the URL so JS can apply the same
	// gating without needing a second round-trip.
	$package = is_object( $entry ) && ! empty( $entry->package )
		? (string) $entry->package
		: '';
	// `slug` is what Core's `wp_ajax_update_plugin` echoes back in its
	// success / error envelope. We forward what the transient already
	// carries; the AJAX handler doesn't require it on the request
	// side (it derives slug from `plugin`), but having it client-side
	// keeps event payloads symmetric with Core's own.
	$slug = is_object( $entry ) && ! empty( $entry->slug )
		? (string) $entry->slug
		: '';

	return array(
		'available'   => true,
		'new_version' => $ver,
		'package'     => $package,
		'slug'        => $slug,
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
	$plugin_file = desktop_mode_plugins_window_row_plugin_file( $row );
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
