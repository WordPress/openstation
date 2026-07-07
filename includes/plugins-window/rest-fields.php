<?php
/**
 * Desktop Mode — Native Plugins Window: REST field decorators.
 *
 * Adds enrichment fields to Core's `/wp/v2/plugins` REST resource so
 * the JS bundle can render rich rows in one round-trip:
 *
 *   - desktop_mode_update_available — `{ available, new_version }`
 *   - desktop_mode_can_manage       — `{ activate, deactivate, delete }`
 *   - desktop_mode_icon_url         — local-folder icon, falling back to wp.org
 *   - desktop_mode_size_kb          — disk size of plugin folder
 *   - desktop_mode_auto_update      — `{ enabled, forced, supported }`
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
 * Register the five enrichment fields on the `plugin` REST resource.
 *
 * @since 0.9.0
 * @since 0.8.6 Added `desktop_mode_auto_update`.
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
				'description' => __( 'Best-effort card icon URL. Prefers a local file in the plugin folder, falling back to the wp.org SVN URL; null when neither resolves.', 'desktop-mode' ),
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

	register_rest_field(
		'plugin',
		'desktop_mode_auto_update',
		array(
			'get_callback' => 'desktop_mode_plugins_window_field_auto_update',
			'schema'       => array(
				'description' => __( 'Auto-update state for this plugin (enabled / forced / supported), mirroring Core\'s plugins.php column.', 'desktop-mode' ),
				'type'        => 'object',
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
 * @since 0.8.3
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
 * @since 0.8.3
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
	 * @since 0.8.3
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
 * Count plugin updates visible to the Plugins window — i.e. updates in
 * the `update_plugins` site transient whose key corresponds to an
 * actually-installed plugin file (`get_plugins()`).
 *
 * Core's `wp_get_update_data()` reports `count( $update_plugins->response )`
 * verbatim, which is what `wp-admin/menu.php` embeds in the Plugins
 * menu title (the source the dock-builder regex captures). That raw
 * count can drift above the in-window "Update available" filter when
 * the transient holds orphan entries — rows for plugin files that no
 * longer exist on disk, or rows injected via the standard `Update URI`
 * mechanism that key on a file `get_plugins()` doesn't return.
 *
 * The Plugins window iterates `get_plugins()` via REST and shows each
 * row as updatable iff `update_plugins->response[ $plugin_file ]` is
 * set — exactly the intersection we compute here. Using this count for
 * the dock badge guarantees the two surfaces agree (GH#258).
 *
 * @since 0.8.8
 *
 * @return int Number of installed plugins with a pending update.
 */
function desktop_mode_plugins_window_count_visible_updates() {
	$updates = get_site_transient( 'update_plugins' );
	if ( ! is_object( $updates ) || empty( $updates->response ) || ! is_array( $updates->response ) ) {
		return 0;
	}

	// `get_plugins()` lives in `wp-admin/includes/plugin.php`. Loaded by
	// default on every admin request (which is where `$menu` is built),
	// but require it explicitly so REST + cron + WP-CLI callers can use
	// this helper without depending on the admin runtime.
	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	$installed = get_plugins();

	$count = 0;
	foreach ( array_keys( $updates->response ) as $plugin_file ) {
		if ( isset( $installed[ $plugin_file ] ) ) {
			++$count;
		}
	}
	return $count;
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
 * Resolves a card icon URL for an installed plugin row, in priority:
 *
 *   1. **Local file** — if the plugin's own folder ships an icon at a
 *      conventional path (`assets/icon.svg`, `assets/icon-256x256.png`,
 *      `assets/icon-128x128.png`, or the same names at the folder
 *      root), return its `plugins_url()`. This is what makes premium /
 *      internal / native-bundled plugins (alcazaba-*, desktop-mode-*,
 *      and any private plugin that ships its own art) display
 *      correctly — they aren't on `ps.w.org/<slug>/`, so the wp.org
 *      candidate chain 404s through every variant before the
 *      placeholder paints.
 *   2. **wp.org SVN asset** — `https://ps.w.org/<slug>/assets/icon.svg`,
 *      keyed off the plugin's **folder name** (which is the .org repo
 *      slug). Folder beats textdomain because the two often diverge
 *      (`woocommerce` vs textdomain `woo`, `wordpress-seo` vs
 *      `yoast-seo`). Falls back to textdomain for single-file plugins.
 *
 * We don't HEAD-check the URL — the JS card walks a candidate chain
 * (SVG → 256 PNG → 256 GIF → 128 PNG → 128 GIF) on `<img>` error for wp.org URLs, then
 * drops to a `<wpd-icon name="dashicons-admin-plugins">` placeholder.
 * A 404 here costs nothing.
 *
 * @since 0.9.0
 * @since 0.8.6 Probes the plugin's own folder for an icon before
 *              falling back to the wp.org SVN URL.
 *
 * @param array $row Core REST plugin row.
 * @return string|null
 */
function desktop_mode_plugins_window_field_icon_url( $row ) {
	$plugin_file = desktop_mode_plugins_window_row_plugin_file( $row );
	$folder      = '' !== $plugin_file ? dirname( $plugin_file ) : '';
	$slug        = ( '' !== $folder && '.' !== $folder ) ? $folder : '';

	if ( '' === $slug ) {
		// Single-file plugin (e.g. hello.php at the plugins root) —
		// no folder slug, so fall back to the text domain.
		$slug = isset( $row['textdomain'] ) ? (string) $row['textdomain'] : '';
	}

	$slug = sanitize_key( $slug );
	if ( '' === $slug ) {
		return null;
	}

	$default = desktop_mode_plugins_window_local_icon_url( $plugin_file );
	if ( null === $default ) {
		$default = 'https://ps.w.org/' . $slug . '/assets/icon.svg';
	}

	/**
	 * Filter the resolved icon URL for a plugin row.
	 *
	 * Return `null` to suppress the icon (forces the placeholder).
	 * Return a different URL to override the default — useful for
	 * custom CDN art or for overriding the auto-detected local icon.
	 *
	 * The `$url` parameter is either a local `plugins_url()` (when the
	 * plugin's own folder ships an icon at a conventional path) or the
	 * wp.org `ps.w.org/<slug>/assets/icon.svg` URL. The JS receiver
	 * walks a candidate chain on `<img>` error (`icon.svg` → 256 PNG →
	 * 256 GIF → 128 PNG → 128 GIF) only when the URL matches the
	 * wp.org SVN pattern;
	 * custom URLs and local URLs are one-shot, then placeholder.
	 *
	 * @since 0.9.0
	 *
	 * @param string|null $url  Default URL (local file if the plugin's
	 *                          folder ships one, else wp.org SVG).
	 * @param string      $slug Plugin slug (folder name, or textdomain
	 *                          for single-file plugins).
	 * @param array       $row  Core REST plugin row.
	 */
	return apply_filters(
		'desktop_mode_plugins_window_icon_url',
		$default,
		$slug,
		$row
	);
}

/**
 * Probe an installed plugin's own folder for a card icon.
 *
 * Many premium and private plugins (and our own native extensions —
 * alcazaba-*, desktop-mode-*) aren't on the .org repo, so the wp.org
 * SVN URL 404s through every candidate before the placeholder paints.
 * Most that ship art do so at a conventional location inside their
 * own folder — typically `assets/icon.svg` mirroring the wp.org SVN
 * /assets/ layout, occasionally bare `icon.svg` at the root for
 * minimal plugins. We probe both shapes and return the first URL we
 * resolve, or `null` when nothing matches.
 *
 * Single-file plugins (no folder) return `null` immediately — there's
 * no folder to scan.
 *
 * Cost: 1–6 `file_exists()` calls per row, ~1µs each with warm OS
 * cache. For a 50-row paint this is well under a millisecond — not
 * worth caching, and a cache would have to invalidate on plugin
 * install/update/delete.
 *
 * The candidate list is filterable via
 * `desktop_mode_plugins_window_local_icon_candidates` so a host can
 * support a custom convention (e.g. an `icon@2x.svg` shape).
 *
 * @since 0.8.6
 *
 * @param string $plugin_file Plugin file (e.g. `"akismet/akismet.php"`).
 * @return string|null URL of the first local icon found, or null.
 */
function desktop_mode_plugins_window_local_icon_url( $plugin_file ) {
	if ( '' === $plugin_file ) {
		return null;
	}
	$folder = dirname( $plugin_file );
	if ( '' === $folder || '.' === $folder ) {
		// Single-file plugin — no folder to scan.
		return null;
	}

	/**
	 * Filter the ordered list of relative paths probed inside an
	 * installed plugin's folder when looking for a card icon. The
	 * first existing file wins; later entries are ignored.
	 *
	 * @since 0.8.6
	 *
	 * @param string[] $candidates Relative paths under the plugin folder.
	 * @param string   $folder     Plugin folder name (e.g. `"akismet"`).
	 */
	$candidates = apply_filters(
		'desktop_mode_plugins_window_local_icon_candidates',
		array(
			'assets/icon.svg',
			'assets/icon-256x256.png',
			'assets/icon-128x128.png',
			'icon.svg',
			'icon-256x256.png',
			'icon-128x128.png',
		),
		$folder
	);

	$plugin_root = WP_PLUGIN_DIR . '/' . $folder;
	foreach ( (array) $candidates as $relative ) {
		$relative = (string) $relative;
		if ( '' === $relative ) {
			continue;
		}
		if ( file_exists( $plugin_root . '/' . $relative ) ) {
			return plugins_url( $relative, WP_PLUGIN_DIR . '/' . $plugin_file );
		}
	}

	return null;
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

/**
 * `desktop_mode_auto_update` callback.
 *
 * Mirrors the per-row state Core derives in
 * `WP_Plugins_List_Table::prepare_items()` for its "Automatic Updates"
 * column. Shape:
 *
 *   - `enabled`   bool  — the plugin file is currently in the
 *                          `auto_update_plugins` site option, OR a
 *                          filter has forced auto-updates on.
 *   - `forced`    bool|null — `true`/`false` when the
 *                          `auto_update_plugin` filter pinned the state,
 *                          `null` when the user is free to toggle.
 *   - `supported` bool  — whether the `update_plugins` transient has an
 *                          entry for this plugin (either in `response` or
 *                          `no_update`). Core hides the toggle entirely
 *                          when this is false — premium / private plugins
 *                          that never check in with wp.org.
 *
 * NOT included here (lives on the window config instead): the global
 * `wp_is_auto_update_enabled_for_type( 'plugin' )` flag, which depends
 * on admin-only includes — see `desktop_mode_plugins_window_auto_updates_enabled()`.
 *
 * @since 0.8.6
 *
 * @param array $row Core REST plugin row.
 * @return array{enabled:bool,forced:bool|null,supported:bool}
 */
function desktop_mode_plugins_window_field_auto_update( $row ) {
	$plugin_file = desktop_mode_plugins_window_row_plugin_file( $row );
	if ( '' === $plugin_file ) {
		return array(
			'enabled'   => false,
			'forced'    => null,
			'supported' => false,
		);
	}

	$auto_updates = (array) get_site_option( 'auto_update_plugins', array() );
	$enabled      = in_array( $plugin_file, $auto_updates, true );

	// `update-supported` mirrors Core's logic: a plugin is "supported"
	// for auto-update toggling when wp.org has either a pending update
	// row OR an explicit no-update row in the `update_plugins` transient.
	// Premium / private plugins that never call home land in neither
	// bucket — Core hides the toggle so the user doesn't enable an
	// auto-update that can't ever fire.
	$supported = false;
	$updates   = get_site_transient( 'update_plugins' );
	if ( is_object( $updates ) ) {
		if ( isset( $updates->response[ $plugin_file ] ) || isset( $updates->no_update[ $plugin_file ] ) ) {
			$supported = true;
		}
	}

	// Build the payload Core's filter expects (mirrors
	// `WP_Plugins_List_Table::prepare_items()`'s `$filter_payload`).
	// `wp_is_auto_update_forced_for_item()` itself is in
	// `wp-admin/includes/update.php` — we can't include that from a REST
	// callback (Plugin Check), so we run the filter directly. It's a
	// single `apply_filters()` call under the hood.
	//
	// Important: `wp_parse_args( $row, $defaults )` lets `$row` keys
	// override `$defaults`. Core's REST controller strips `.php` from
	// the `plugin` field, but every filter that hooks `auto_update_plugin`
	// (including Core's own) reads `$item->plugin` expecting the FULL
	// filename. We layer the normalized `$plugin_file` AFTER the parse
	// so it always wins.
	$filter_payload = wp_parse_args(
		$row,
		array(
			'id'            => $plugin_file,
			'slug'          => isset( $row['textdomain'] ) ? (string) $row['textdomain'] : '',
			'plugin'        => $plugin_file,
			'new_version'   => '',
			'url'           => '',
			'package'       => '',
			'icons'         => array(),
			'banners'       => array(),
			'banners_rtl'   => array(),
			'tested'        => '',
			'requires_php'  => '',
			'compatibility' => new stdClass(),
		)
	);
	$filter_payload['plugin'] = $plugin_file;
	$filter_payload['id']     = $plugin_file;
	$filter_payload           = (object) $filter_payload;
	/** This filter is documented in wp-admin/includes/class-wp-automatic-updater.php */
	$forced = apply_filters( 'auto_update_plugin', null, $filter_payload );
	if ( null !== $forced ) {
		$forced = (bool) $forced;
		// When a filter forces the state, that's the effective state
		// regardless of the `auto_update_plugins` option — match Core's
		// rendering in `single_row_columns()`.
		$enabled = $forced;
	}

	return array(
		'enabled'   => (bool) $enabled,
		'forced'    => $forced,
		'supported' => $supported,
	);
}
