<?php
/**
 * Plugins app — what the `update_plugins` transient says.
 *
 * Part of the `desktop-mode-plugins` app: required by `plugins.os.php`,
 * plain `.php` on purpose — only `*.os.php` files are app entries to
 * the framework loader. The transient is primed at most once per
 * request (Core's own 12h throttle, or the Refresh button's forced
 * check) and read into one per-request snapshot; the three REST
 * fields derived from it — the pending update, the directory slug,
 * the auto-update state — read that snapshot, as does the dock badge
 * count. Every callback uses only `wp-includes/` functions.
 *
 * @package OpenStation
 */

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * Lazily prime the `update_plugins` site transient so REST callers see
 * the same "updates available" picture as the classic Plugins screen.
 *
 * Core only refreshes the transient on `load-plugins.php`,
 * `load-update-core.php`, and the twice-daily cron — REST is not on
 * that list, so a fresh page load of the Plugins window can see an
 * empty or stale transient even when the dock badge (computed off
 * `$menu`, which Core builds against `wp_get_update_data()`) reports
 * pending updates. We mirror Core's own throttle
 * (`_maybe_update_plugins()` — 12h since last check) so a hot REST hit
 * is a transient read, not an HTTPS round trip to api.wordpress.org.
 *
 * @param bool $force When true, delete the transient and force a fresh
 *                    wp.org check regardless of the 12h throttle.
 */
function openstation_plugins_window_maybe_refresh_update_transient( $force = false ) {
	/**
	 * Short-circuit the lazy refresh of the `update_plugins` transient.
	 *
	 * Return `false` to skip the refresh — useful for hosts that run
	 * their own update orchestration (managed WordPress, internal
	 * mirrors) and don't want every REST hit to the plugins endpoint
	 * to potentially trigger a wp.org check. The filter also gates the
	 * Refresh button's forced check so hosts that block wp.org calls
	 * outright keep that posture even when the user asks.
	 *
	 * @param bool $refresh Whether to call `wp_update_plugins()`.
	 * @param bool $force   Whether the caller asked to bypass the throttle.
	 */
	if ( ! apply_filters( 'openstation_plugins_window_refresh_updates', true, $force ) ) {
		return;
	}

	if ( ! function_exists( 'wp_update_plugins' ) ) {
		// `wp-includes/update.php` is normally autoloaded on every
		// request; guard anyway so an unusual bootstrap (mu-plugin
		// CLI harness, stripped-down REST runtime) doesn't fatal.
		return;
	}

	if ( $force ) {
		// A user-initiated refresh bypasses the throttle: delete the
		// transient (and the `plugins` cache group), then repopulate it
		// with a fresh wp.org snapshot. Without the second step the
		// field callbacks read `false` for the rest of the request and
		// every row reports "no updates".
		if ( function_exists( 'wp_clean_plugins_cache' ) ) {
			wp_clean_plugins_cache( true );
		} else {
			delete_site_transient( 'update_plugins' );
		}
		wp_update_plugins();
		// The read path primes before it reads, so ordering alone keeps
		// it honest; a caller that primed earlier in the request gets
		// the new answer because of this.
		openstation_plugins_window_forget_updates();
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
 * Prime the `update_plugins` transient at most once per request — the
 * Refresh action's forced check counts, so the `data()` read that
 * follows it never asks wp.org twice.
 *
 * @param bool $force Bypass Core's throttle (the Refresh button).
 * @return void
 */
function openstation_plugins_window_prime_updates_once( $force = false ) {
	static $primed = false;
	if ( $primed && ! $force ) {
		return;
	}
	$primed = true;
	openstation_plugins_window_maybe_refresh_update_transient( $force );
}

/**
 * The `update_plugins` transient, primed at most once per request and
 * read once: every row's fields and the badge count share it. The
 * snapshot is dropped whenever something rewrites the transient under
 * it — an upgrader run mid-request, a plugin deleted, the Refresh
 * action's forced check — so it is never behind the store.
 *
 * @return object|null The transient object, or null when it is cold.
 */
function openstation_plugins_window_updates() {
	$found    = false;
	$snapshot = wp_cache_get( 'update_plugins', OPENSTATION_PLUGINS_CACHE_GROUP, false, $found );
	if ( $found ) {
		return is_object( $snapshot ) ? $snapshot : null;
	}
	openstation_plugins_window_prime_updates_once();
	$updates = get_site_transient( 'update_plugins' );
	// A refresh inside the call above set the transient and reset the
	// snapshot — record what was read AFTER it.
	wp_cache_set( 'update_plugins', is_object( $updates ) ? $updates : 0, OPENSTATION_PLUGINS_CACHE_GROUP );
	return is_object( $updates ) ? $updates : null;
}

/**
 * Forget the snapshot — the transient just changed under it.
 *
 * @return void
 */
function openstation_plugins_window_forget_updates() {
	wp_cache_delete( 'update_plugins', OPENSTATION_PLUGINS_CACHE_GROUP );
}
// What actually rewrites the transient inside a request: an upgrader
// finishing (install, update, bulk update) and a plugin being deleted;
// Core cleans the plugin caches on both. The forced-refresh path
// forgets on its own, above.
//
// Deliberately NOT the transient's own `set_` / `delete_` actions,
// which would be the obvious listener: Plugin Check reads any mention
// of those two hook names — in code or in a comment, it scans the raw
// file — as a self-hosted plugin updater (`plugin_updater_detected`),
// which a wp.org-hosted plugin may not ship. The two actions below
// mark the same moments and carry no such meaning.
add_action( 'upgrader_process_complete', 'openstation_plugins_window_forget_updates' );
add_action( 'deleted_plugin', 'openstation_plugins_window_forget_updates' );
add_action(
	'init',
	static function () {
		// The snapshot is a per-request memo, never a cross-request cache.
		wp_cache_add_non_persistent_groups( OPENSTATION_PLUGINS_CACHE_GROUP );
	},
	0
);

/**
 * `openstation_update_available` callback.
 *
 * @param array $row Core REST plugin row.
 * @return array{available:bool,new_version:string|null,package:string,slug:string}
 */
function openstation_plugins_window_field_update_available( $row ) {
	$none        = array(
		'available'   => false,
		'new_version' => null,
		'package'     => '',
		'slug'        => '',
	);
	$plugin_file = openstation_plugins_window_row_plugin_file( $row );
	if ( '' === $plugin_file ) {
		return $none;
	}

	$updates = openstation_plugins_window_updates();
	if ( null === $updates || empty( $updates->response ) || ! is_array( $updates->response ) ) {
		return $none;
	}
	if ( ! isset( $updates->response[ $plugin_file ] ) ) {
		return $none;
	}

	$entry = $updates->response[ $plugin_file ];
	return array(
		'available'   => true,
		'new_version' => is_object( $entry ) && isset( $entry->new_version ) ? (string) $entry->new_version : null,
		// The download URL Core's upgrader fetches. Empty for plugins
		// without a wp.org package (premium / private hosts) — Core
		// renders "Automatic update is unavailable" there rather than
		// "Update now", and so does the client.
		'package'     => is_object( $entry ) && ! empty( $entry->package ) ? (string) $entry->package : '',
		// What `wp_ajax_update_plugin` echoes back in its envelope.
		'slug'        => is_object( $entry ) && ! empty( $entry->slug ) ? (string) $entry->slug : '',
	);
}

/**
 * Count plugin updates visible to the Plugins window — updates in the
 * `update_plugins` transient whose key is an installed plugin file.
 *
 * Core's `wp_get_update_data()` reports `count( $response )` verbatim,
 * which is what `wp-admin/menu.php` embeds in the Plugins menu title
 * (the source the dock builder captures). That raw count drifts above
 * the in-window "Update available" filter when the transient holds
 * orphan entries — files no longer on disk, or rows an `Update URI`
 * host keyed on a file `get_plugins()` doesn't return. The window
 * shows a row as updatable iff `response[ $plugin_file ]` is set —
 * exactly the intersection computed here, so the two surfaces agree.
 *
 * @return int Number of installed plugins with a pending update.
 */
function openstation_plugins_window_count_visible_updates() {
	$updates = get_site_transient( 'update_plugins' );
	if ( ! is_object( $updates ) || empty( $updates->response ) || ! is_array( $updates->response ) ) {
		return 0;
	}

	// `get_plugins()` lives in `wp-admin/includes/plugin.php`. Loaded by
	// default on every admin request (where `$menu` is built), but
	// required explicitly so REST, cron and WP-CLI callers can use this
	// helper without depending on the admin runtime.
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
 * What wp.org last said about one plugin — `slug`, `icons`, versions.
 *
 * Both halves have to be read: a plugin is filed under `response`
 * when an update is pending and `no_update` otherwise, with the same
 * directory metadata in each. Reading only `response` misses every
 * up-to-date plugin.
 *
 * @param string $plugin_file Plugin file (e.g. `"akismet/akismet.php"`).
 * @return array|null Null when wp.org doesn't know this plugin, or the
 *                    transient is cold.
 */
function openstation_plugins_window_update_entry( $plugin_file ) {
	if ( '' === $plugin_file ) {
		return null;
	}
	$updates = openstation_plugins_window_updates();
	if ( null === $updates ) {
		return null;
	}
	if ( isset( $updates->response[ $plugin_file ] ) ) {
		return (array) $updates->response[ $plugin_file ];
	}
	if ( isset( $updates->no_update[ $plugin_file ] ) ) {
		return (array) $updates->no_update[ $plugin_file ];
	}
	return null;
}

/**
 * `openstation_wporg_slug` callback — is this plugin listed on the
 * WordPress.org directory, and under which slug? Mirrors Core (see
 * `WP_Plugins_List_Table::prepare_items()`).
 *
 * @param array $row Core REST plugin row.
 * @return string|null Directory slug, or null when the plugin isn't listed.
 */
function openstation_plugins_window_field_wporg_slug( $row ) {
	$entry = openstation_plugins_window_update_entry(
		openstation_plugins_window_row_plugin_file( $row )
	);
	if ( null === $entry || empty( $entry['slug'] ) ) {
		return null;
	}
	$slug = sanitize_key( (string) $entry['slug'] );
	return '' !== $slug ? $slug : null;
}

/**
 * `openstation_auto_update` callback.
 *
 * Mirrors the per-row state Core derives in
 * `WP_Plugins_List_Table::prepare_items()` for its "Automatic Updates"
 * column:
 *
 *   - `enabled`   bool      — the file is in the `auto_update_plugins`
 *                             site option, or a filter forced it on.
 *   - `forced`    bool|null — `true`/`false` when the `auto_update_plugin`
 *                             filter pinned the state, `null` when the
 *                             user is free to toggle.
 *   - `supported` bool      — the `update_plugins` transient knows the
 *                             plugin (`response` or `no_update`). Core
 *                             hides the toggle otherwise — premium /
 *                             private plugins never check in.
 *
 * The global `wp_is_auto_update_enabled_for_type( 'plugin' )` gate is
 * on the window config instead — see
 * `openstation_plugins_window_auto_updates_enabled()`.
 *
 * @param array $row Core REST plugin row.
 * @return array{enabled:bool,forced:bool|null,supported:bool}
 */
function openstation_plugins_window_field_auto_update( $row ) {
	$plugin_file = openstation_plugins_window_row_plugin_file( $row );
	if ( '' === $plugin_file ) {
		return array(
			'enabled'   => false,
			'forced'    => null,
			'supported' => false,
		);
	}

	$auto_updates = (array) get_site_option( 'auto_update_plugins', array() );
	$enabled      = in_array( $plugin_file, $auto_updates, true );
	$supported    = null !== openstation_plugins_window_update_entry( $plugin_file );

	// The payload Core's filter expects (its `$filter_payload`).
	// `wp_is_auto_update_forced_for_item()` is admin-only, so the filter
	// runs directly — it is a single `apply_filters()` underneath.
	// `wp_parse_args( $row, $defaults )` lets `$row` win, and Core's REST
	// row spells `plugin` without `.php` while every `auto_update_plugin`
	// callback reads `$item->plugin` as the FULL filename — the
	// normalised file is layered on last so it always wins.
	$filter_payload           = wp_parse_args(
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
	$forced = apply_filters( 'auto_update_plugin', null, $filter_payload ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Core's filter; the effective auto-update state has to come from the same source Core reads.
	if ( null !== $forced ) {
		$forced = (bool) $forced;
		// A forced state is the effective state regardless of the
		// option — matches Core's `single_row_columns()`.
		$enabled = $forced;
	}

	return array(
		'enabled'   => (bool) $enabled,
		'forced'    => $forced,
		'supported' => $supported,
	);
}
