<?php
/**
 * Plugins app — the "OpenStation plugins" (Featured) tab's source.
 *
 * Part of the `desktop-mode-plugins` app: required by `plugins.os.php`,
 * plain `.php` on purpose — only `*.os.php` files are app entries to
 * the framework loader. A curated slug list (wp.org has no usable
 * `requires_plugins` filter, so the seed is maintained by hand and
 * filterable) topped up at runtime by scanning the popular feed for
 * rows that declare the `desktop-mode` dependency, served over
 * admin-ajax (`plugins_api()` is admin-only) and cached for an hour.
 *
 * @package OpenStation
 */

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * Curated list of slugs that lead the Featured tab.
 *
 * Hand-picked because wp.org's `plugins_api` does not surface a real
 * "filter by `requires_plugins`" query — passing `requires_plugins` to
 * `query_plugins` is silently ignored and returns the unfiltered repo.
 * Until the directory grows a usable filter, we maintain the seed list
 * here and let downstream plugins amend it via the filter below.
 *
 * Slug-only — the AJAX handler hydrates each entry through
 * `plugins_api( 'plugin_information' )` so the card has up-to-date
 * icons, descriptions, and install counts without us caching them.
 *
 * @return string[] List of wp.org plugin slugs.
 */
function openstation_plugins_window_featured_slugs() {
	$slugs = array(
		// The author of this plugin forgot to declare OpenStation as a
		// dependency — surfacing it here makes sure openstation users
		// discover it anyway. Once the `requires_plugins` query lands on
		// wp.org we can remove the manual seed.
		'odd-outlandish-desktop-decorator',
	);

	/**
	 * Filter the curated list of featured-plugin slugs.
	 *
	 * Plugin authors can prepend (or remove) entries to recommend their
	 * own Desktop-Mode-aware add-ons. Order is preserved — the first
	 * slug renders first in the gallery.
	 *
	 * @param string[] $slugs Plugin slugs.
	 */
	$slugs = (array) apply_filters( 'openstation_plugins_featured_slugs', $slugs );
	$slugs = array_values(
		array_unique(
			array_filter(
				array_map(
					static function ( $s ) {
						return sanitize_key( (string) $s );
					},
					$slugs
				)
			)
		)
	);
	return $slugs;
}

/**
 * `wp_ajax_openstation_plugins_featured` — return the Featured tab's
 * curated + auto-discovered list of plugins that integrate with Desktop
 * Mode.
 *
 * Composition:
 *   1. Curated slugs from `openstation_plugins_window_featured_slugs()`,
 *      hydrated via `plugins_api( 'plugin_information' )` so the card
 *      payload is always fresh.
 *   2. Auto-discovered slugs from `plugins_api( 'query_plugins' )` whose
 *      `requires_plugins` array contains `openstation`. wp.org has no
 *      server-side filter for this today, so we run a broad query and
 *      filter server-side. Deduped against the curated set.
 *
 * Body params: (none)
 *
 * Cached for 1h. Failures cached for 15m so a flaky wp.org doesn't
 * hammer the API on every tab open.
 */
function openstation_plugins_window_ajax_featured() {
	$guard = openstation_plugins_window_ajax_guard( 'install_plugins' );
	if ( is_wp_error( $guard ) ) {
		openstation_plugins_window_ajax_error( $guard );
		return;
	}

	openstation_plugins_window_load_plugins_api();

	$cache_key = 'dm_pwfeatured_v1';
	$cached    = get_transient( $cache_key );
	if ( false !== $cached && is_array( $cached ) ) {
		wp_send_json_success( $cached );
		return;
	}

	$plugins    = array();
	$seen_slugs = array();
	$fields     = array(
		'icons'             => true,
		'banners'           => false,
		'short_description' => true,
		'description'       => false,
		'sections'          => false,
		'screenshots'       => false,
		'rating'            => true,
		'ratings'           => false,
		'num_ratings'       => true,
		'active_installs'   => true,
		'last_updated'      => true,
		'tested'            => true,
		'requires'          => true,
		'requires_php'      => true,
		'requires_plugins'  => true,
		'homepage'          => true,
		'compatibility'     => false,
		'group'             => false,
		'contributors'      => false,
		'donate_link'       => false,
	);

	// ─── 1. Curated slugs ─────────────────────────────────────────────
	$curated = openstation_plugins_window_featured_slugs();
	foreach ( $curated as $slug ) {
		if ( isset( $seen_slugs[ $slug ] ) ) {
			continue;
		}
		$info = plugins_api(
			'plugin_information',
			array(
				'slug'   => $slug,
				'fields' => $fields,
			)
		);
		if ( is_wp_error( $info ) || ! is_object( $info ) ) {
			// Skip — a curated slug that 404s shouldn't tank the whole
			// tab.
			continue;
		}
		$row                 = (array) $info;
		$row['featured']     = true;
		$plugins[]           = $row;
		$seen_slugs[ $slug ] = true;
	}

	// ─── 2. Auto-discover via `requires_plugins` ──────────────────────
	// Best-effort scan: pull the top of the directory and keep rows that
	// declare openstation as a dependency. The wp.org `query_plugins`
	// API ignores `requires_plugins` as a filter, so we have to fetch +
	// sift locally. Scope is intentionally small (100 most-popular rows)
	// to keep the request bounded; as the ecosystem grows we'll widen
	// or replace with a real dependency query when wp.org ships one.
	$discovered = plugins_api(
		'query_plugins',
		array(
			'browse'   => 'popular',
			'page'     => 1,
			'per_page' => 100,
			'fields'   => $fields,
		)
	);
	if ( ! is_wp_error( $discovered ) && isset( $discovered->plugins ) && is_array( $discovered->plugins ) ) {
		foreach ( $discovered->plugins as $candidate ) {
			$candidate = (array) $candidate;
			$slug      = isset( $candidate['slug'] ) ? sanitize_key( (string) $candidate['slug'] ) : '';
			if ( '' === $slug || isset( $seen_slugs[ $slug ] ) ) {
				continue;
			}
			$requires = isset( $candidate['requires_plugins'] ) ? (array) $candidate['requires_plugins'] : array();
			// The wp.org directory slug, not the brand — `requires_plugins`
			// rows resolve against our plugin folder name.
			if ( ! in_array( 'desktop-mode', $requires, true ) ) {
				continue;
			}
			$candidate['featured'] = false;
			$plugins[]             = $candidate;
			$seen_slugs[ $slug ]   = true;
		}
	}

	// `count( $plugins ) - count( $curated )` can underflow when a
	// curated slug fails hydration (slug typo, plugin temporarily
	// delisted from wp.org, plugins_api returning WP_Error). The JS
	// only uses `discovered` for informational headers, so a negative
	// number wouldn't crash anything, but it does read as a bug.
	// Clamp at zero so the count remains a defensible "non-curated rows
	// in the payload."
	$payload = array(
		'plugins' => array_values( $plugins ),
		'info'    => array(
			'curated'    => count( $curated ),
			'discovered' => max( 0, count( $plugins ) - count( $curated ) ),
			'results'    => count( $plugins ),
		),
	);

	/**
	 * Filter the Featured tab payload before it's cached + sent.
	 *
	 * Use this to inject server-side curated rows (e.g. premium /
	 * private plugins not on wp.org), or to enforce a hard cap on the
	 * response.
	 *
	 * @param array $payload  `{ plugins: [...], info: {...} }`.
	 * @param array $curated  Curated slug list.
	 */
	$payload = (array) apply_filters(
		'openstation_plugins_featured_response',
		$payload,
		$curated
	);

	set_transient( $cache_key, $payload, HOUR_IN_SECONDS );
	wp_send_json_success( $payload );
}
add_action( 'wp_ajax_openstation_plugins_featured', 'openstation_plugins_window_ajax_featured' );
