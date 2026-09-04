<?php
/**
 * Plugins app — the wp.org marketplace over admin-ajax.
 *
 * Part of the `desktop-mode-plugins` app: required by `plugins.os.php`,
 * plain `.php` on purpose — only `*.os.php` files are app entries to
 * the framework loader. Anything that needs an admin-only include
 * lives on admin-ajax, NOT on REST and NOT in an app action (a
 * dispatch is a REST request too): `admin-ajax.php` ships from
 * `wp-admin/`, so `plugins_api()` and the upgrader classes may be
 * required there, where a REST route requiring `wp-admin/…` fails
 * Plugin Check.
 *
 * The guard and the error envelope every handler shares are here,
 * with the two `plugins_api()` proxies:
 *
 *   wp_ajax_openstation_plugins_browse   — `plugins_api( 'query_plugins' )`
 *   wp_ajax_openstation_plugins_info     — `plugins_api( 'plugin_information' )`
 *
 * The reviews scrape is `parts/reviews.php`, the .zip upload
 * `parts/upload.php`, the Featured tab `parts/featured.php`.
 * Install-by-slug is Core's own `wp_ajax_install_plugin` (the client
 * calls it with the `updates` nonce); activate / deactivate / delete
 * are the app's server actions, which run Core's REST controller.
 *
 * @package OpenStation
 */

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * Shared nonce check + capability gate for every marketplace action.
 *
 * Uses `check_ajax_referer( …, …, false )` so a missing or expired
 * nonce surfaces as a clean JSON error rather than a `wp_die()` — the
 * client expects JSON on every call.
 *
 * @param string $cap Capability the requester must hold.
 * @return true|WP_Error True on pass, WP_Error on rejection.
 */
function openstation_plugins_window_ajax_guard( $cap ) {
	if ( ! check_ajax_referer( 'desktop-mode-plugins', '_ajax_nonce', false ) ) {
		return new WP_Error(
			'openstation_plugins_bad_nonce',
			__( 'Security check failed. Refresh the window and try again.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	// The marketplace surfaces (browse, info, reviews, featured,
	// upload) don't exist on a multisite SITE admin — Core routes all
	// of them to the network admin, which has no native windows. The
	// caps map already hides the UI; this is the server half of the
	// same gate, so a stale client can't reach them either.
	if (
		is_multisite() &&
		in_array( $cap, array( 'install_plugins', 'upload_plugins', 'delete_plugins' ), true )
	) {
		return new WP_Error(
			'openstation_plugins_network_managed',
			__( 'Plugins are managed from the network admin on this site.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	if ( ! current_user_can( $cap ) ) {
		return new WP_Error(
			'openstation_plugins_forbidden',
			__( 'You are not allowed to do that.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * Send a `WP_Error` as a JSON response, then exit.
 *
 * @param WP_Error $error The error.
 * @return void
 */
function openstation_plugins_window_ajax_error( WP_Error $error ) {
	$status = 500;
	$data   = $error->get_error_data();
	if ( is_array( $data ) && isset( $data['status'] ) ) {
		$status = (int) $data['status'];
	}
	wp_send_json_error(
		array(
			'code'    => $error->get_error_code(),
			'message' => $error->get_error_message(),
		),
		$status
	);
}

/**
 * Load `plugins_api()` — `wp-admin/includes/plugin-install.php`, which
 * `admin-ajax.php` does not auto-load. The same idiom Core's own
 * `wp_ajax_install_plugin` uses.
 *
 * @return void
 */
function openstation_plugins_window_load_plugins_api() {
	if ( ! function_exists( 'plugins_api' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
	}
}

/**
 * The slug a marketplace request names, or a 400 sent and `''`.
 *
 * @return string
 */
function openstation_plugins_window_ajax_slug() {
	// phpcs:ignore WordPress.Security.NonceVerification.Missing -- verified in openstation_plugins_window_ajax_guard() by every caller.
	$slug = isset( $_POST['slug'] ) ? sanitize_key( wp_unslash( (string) $_POST['slug'] ) ) : '';
	if ( '' === $slug ) {
		openstation_plugins_window_ajax_error(
			new WP_Error(
				'openstation_plugins_missing_slug',
				__( 'Missing plugin slug.', 'desktop-mode' ),
				array( 'status' => 400 )
			)
		);
	}
	return $slug;
}

/**
 * `wp_ajax_openstation_plugins_browse` — proxy to
 * `plugins_api( 'query_plugins', … )` with a 10-minute transient
 * cache keyed by the args.
 *
 * Body params:
 *   - browse    string (featured|popular|recommended|favorites|new|beta), default "featured"
 *   - search    string, optional — wins over `browse`
 *   - page      int,    default 1
 *   - per_page  int,    default 24, capped at 60
 */
function openstation_plugins_window_ajax_browse() {
	$guard = openstation_plugins_window_ajax_guard( 'install_plugins' );
	if ( is_wp_error( $guard ) ) {
		openstation_plugins_window_ajax_error( $guard );
		return;
	}
	openstation_plugins_window_load_plugins_api();

	// phpcs:disable WordPress.Security.NonceVerification.Missing -- verified in openstation_plugins_window_ajax_guard() above; the sniff cannot follow the check across a function boundary.
	$browse  = isset( $_POST['browse'] ) ? sanitize_key( wp_unslash( (string) $_POST['browse'] ) ) : 'featured';
	$allowed = array( 'featured', 'popular', 'recommended', 'favorites', 'new', 'beta' );
	if ( ! in_array( $browse, $allowed, true ) ) {
		$browse = 'featured';
	}
	$search   = isset( $_POST['search'] ) ? sanitize_text_field( wp_unslash( (string) $_POST['search'] ) ) : '';
	$page     = isset( $_POST['page'] ) ? max( 1, (int) $_POST['page'] ) : 1;
	$per_page = isset( $_POST['per_page'] ) ? max( 1, min( 60, (int) $_POST['per_page'] ) ) : 24;
	// phpcs:enable WordPress.Security.NonceVerification.Missing

	$api_args = array(
		'page'     => $page,
		'per_page' => $per_page,
		// The card's fields only — the flyout asks `plugin_information`.
		'fields'   => array(
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
			'homepage'          => true,
			'compatibility'     => false,
			'group'             => false,
			'contributors'      => false,
			'donate_link'       => false,
		),
	);
	if ( '' !== $search ) {
		$api_args['search'] = $search;
	} else {
		$api_args['browse'] = $browse;
	}

	/**
	 * Filter the args passed to `plugins_api( 'query_plugins', … )`.
	 *
	 * @param array $api_args   Args passed to plugins_api.
	 * @param array $raw_params Sanitized request params.
	 */
	$api_args = (array) apply_filters(
		'openstation_plugins_window_browse_args',
		$api_args,
		array(
			'browse'   => $browse,
			'search'   => $search,
			'page'     => $page,
			'per_page' => $per_page,
		)
	);

	$cache_key = 'dm_pwbrowse_' . md5( wp_json_encode( $api_args ) );
	$cached    = get_transient( $cache_key );
	if ( false !== $cached && is_array( $cached ) ) {
		wp_send_json_success( $cached );
		return;
	}

	$result = plugins_api( 'query_plugins', $api_args );
	if ( is_wp_error( $result ) ) {
		openstation_plugins_window_ajax_error( $result );
		return;
	}

	$payload = array(
		'plugins' => isset( $result->plugins ) ? array_values( (array) $result->plugins ) : array(),
		'info'    => isset( $result->info ) ? (array) $result->info : array(),
	);

	/**
	 * Filter the browse response before it's cached + sent.
	 *
	 * @param array $payload  `{ plugins, info }`.
	 * @param array $api_args Args used.
	 */
	$payload = (array) apply_filters( 'openstation_plugins_window_browse_response', $payload, $api_args );

	set_transient( $cache_key, $payload, 10 * MINUTE_IN_SECONDS );
	wp_send_json_success( $payload );
}
add_action( 'wp_ajax_openstation_plugins_browse', 'openstation_plugins_window_ajax_browse' );

/**
 * `wp_ajax_openstation_plugins_info` — proxy to
 * `plugins_api( 'plugin_information', { slug, fields } )` with a
 * 1-hour transient cache per slug.
 *
 * Body params:
 *   - slug  string, required
 */
function openstation_plugins_window_ajax_info() {
	$guard = openstation_plugins_window_ajax_guard( 'install_plugins' );
	if ( is_wp_error( $guard ) ) {
		openstation_plugins_window_ajax_error( $guard );
		return;
	}
	openstation_plugins_window_load_plugins_api();

	$slug = openstation_plugins_window_ajax_slug();
	if ( '' === $slug ) {
		return;
	}

	$cache_key = 'dm_pwinfo_' . md5( $slug );
	$cached    = get_transient( $cache_key );
	if ( false !== $cached && is_array( $cached ) ) {
		wp_send_json_success( $cached );
		return;
	}

	$result = plugins_api(
		'plugin_information',
		array(
			'slug'   => $slug,
			'fields' => array(
				'sections'          => true,
				'screenshots'       => true,
				'ratings'           => true,
				'banners'           => true,
				'icons'             => true,
				'contributors'      => false,
				'last_updated'      => true,
				'requires'          => true,
				'requires_php'      => true,
				'tested'            => true,
				'homepage'          => true,
				'short_description' => true,
				'donate_link'       => false,
				'reviews'           => false, // The Reviews tab has its own scraper.
			),
		)
	);
	if ( is_wp_error( $result ) ) {
		openstation_plugins_window_ajax_error( $result );
		return;
	}

	/**
	 * Filter the plugin-information response before it's cached + sent.
	 *
	 * @param array  $payload Result, cast to array.
	 * @param string $slug    Plugin slug.
	 */
	$payload = (array) apply_filters( 'openstation_plugins_window_info_response', (array) $result, $slug );

	set_transient( $cache_key, $payload, HOUR_IN_SECONDS );
	wp_send_json_success( $payload );
}
add_action( 'wp_ajax_openstation_plugins_info', 'openstation_plugins_window_ajax_info' );
