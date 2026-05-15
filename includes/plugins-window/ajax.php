<?php
/**
 * Desktop Mode — Native Plugins Window: admin-ajax actions.
 *
 * Anything that needs an admin-only class lives here, NOT on REST.
 * Reason: `admin-ajax.php` itself ships from `wp-admin/`, so by the
 * time any `wp_ajax_*` callback fires, `wp-admin/includes/{plugin,
 * plugin-install,file,misc,class-wp-upgrader,class-wp-ajax-upgrader-skin}.php`
 * are already on the include path. Calling those classes from a REST
 * route would force a `require_once ABSPATH . 'wp-admin/…'` line —
 * Plugin Check rejects that pattern.
 *
 * Action map (every callback verifies a `desktop-mode-plugins` nonce
 * AND a per-action capability):
 *
 *   wp_ajax_desktop_mode_plugins_browse   — `plugins_api( 'query_plugins' )`
 *   wp_ajax_desktop_mode_plugins_info     — `plugins_api( 'plugin_information' )`
 *   wp_ajax_desktop_mode_plugins_reviews  — wp.org reviews scrape (DOMDocument)
 *   wp_ajax_desktop_mode_plugins_upload   — `Plugin_Upgrader::install()` from $_FILES
 *
 * Install-by-slug is handled by Core's existing `wp_ajax_install_plugin`
 * — the JS calls it directly with the standard `'updates'` nonce. We
 * never reimplement it.
 *
 * Activate / deactivate / delete go through Core REST
 * (`PUT/DELETE /wp/v2/plugins/{plugin}`), which lives in
 * `wp-includes/`. No custom handler needed there.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Shared nonce check + capability gate for every action below.
 *
 * Uses `check_ajax_referer( …, …, false )` so a missing/expired
 * nonce surfaces as a clean JSON error rather than a `wp_die()` —
 * the JS wraps every call in a `wp.desktop.fetch` and expects JSON.
 *
 * @since 0.9.0
 *
 * @param string $cap Capability the requester must hold.
 * @return true|WP_Error True on pass, WP_Error on rejection.
 */
function desktop_mode_plugins_window_ajax_guard( $cap ) {
	$nonce_ok = check_ajax_referer( 'desktop-mode-plugins', '_ajax_nonce', false );
	if ( ! $nonce_ok ) {
		return new WP_Error(
			'desktop_mode_plugins_bad_nonce',
			__( 'Security check failed. Refresh the window and try again.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	if ( ! current_user_can( $cap ) ) {
		return new WP_Error(
			'desktop_mode_plugins_forbidden',
			__( 'You are not allowed to do that.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * Send a `WP_Error` as a JSON response, then exit.
 *
 * @since 0.9.0
 *
 * @param WP_Error $error
 * @return void
 */
function desktop_mode_plugins_window_ajax_error( WP_Error $error ) {
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
 * `wp_ajax_desktop_mode_plugins_browse` — proxy to
 * `plugins_api( 'query_plugins', … )` with a 10-minute transient
 * cache keyed by the args.
 *
 * Body params:
 *   - browse    string (featured|popular|recommended|favorites|new|beta), default "featured"
 *   - search    string, optional
 *   - tag       string, optional
 *   - page      int,    default 1
 *   - per_page  int,    default 24, capped at 60
 *
 * @since 0.9.0
 */
function desktop_mode_plugins_window_ajax_browse() {
	$guard = desktop_mode_plugins_window_ajax_guard( 'install_plugins' );
	if ( is_wp_error( $guard ) ) {
		desktop_mode_plugins_window_ajax_error( $guard );
		return; // unreachable; clarity for static analyzers.
	}

	// `plugins_api()` lives in `wp-admin/includes/plugin-install.php`,
	// which `admin-ajax.php` does NOT auto-load. Same idiom Core's
	// own `wp_ajax_install_plugin` uses (see
	// `wp-admin/includes/ajax-actions.php` ~L4483). Plugin Check
	// accepts this — the rule against `require_once ABSPATH .
	// 'wp-admin/…'` only applies to non-admin contexts (REST
	// callbacks, plugin bootstrap), and `wp_ajax_*` hooks fire
	// inside admin-ajax which is itself an admin file.
	if ( ! function_exists( 'plugins_api' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
	}

	$browse_raw = isset( $_POST['browse'] ) ? sanitize_key( wp_unslash( (string) $_POST['browse'] ) ) : 'featured';
	$allowed    = array( 'featured', 'popular', 'recommended', 'favorites', 'new', 'beta', 'updated' );
	if ( ! in_array( $browse_raw, $allowed, true ) ) {
		$browse_raw = 'featured';
	}

	$search   = isset( $_POST['search'] ) ? sanitize_text_field( wp_unslash( (string) $_POST['search'] ) ) : '';
	$tag      = isset( $_POST['tag'] ) ? sanitize_key( wp_unslash( (string) $_POST['tag'] ) ) : '';
	$page     = isset( $_POST['page'] ) ? max( 1, (int) $_POST['page'] ) : 1;
	$per_page = isset( $_POST['per_page'] ) ? max( 1, min( 60, (int) $_POST['per_page'] ) ) : 24;

	$api_args = array(
		'page'     => $page,
		'per_page' => $per_page,
		// Lightweight field set — `plugin_information` covers the
		// detail-flyout case via a separate call.
		'fields'   => array(
			'icons'             => true,
			'banners'           => true,
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
	} elseif ( '' !== $tag ) {
		$api_args['tag'] = $tag;
	} else {
		$api_args['browse'] = $browse_raw;
	}

	/**
	 * Filter the args passed to `plugins_api( 'query_plugins', … )`.
	 *
	 * @since 0.9.0
	 *
	 * @param array $api_args   Args passed to plugins_api.
	 * @param array $raw_params Sanitized request params.
	 */
	$api_args = (array) apply_filters(
		'desktop_mode_plugins_window_browse_args',
		$api_args,
		array(
			'browse'   => $browse_raw,
			'search'   => $search,
			'tag'      => $tag,
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
		desktop_mode_plugins_window_ajax_error( $result );
		return;
	}

	// `plugins_api` returns an object with `plugins` + `info` props.
	$payload = array(
		'plugins' => isset( $result->plugins ) ? array_values( (array) $result->plugins ) : array(),
		'info'    => isset( $result->info ) ? (array) $result->info : array(),
	);

	/**
	 * Filter the browse response before it's cached + sent.
	 *
	 * @since 0.9.0
	 *
	 * @param array $payload  `{ plugins, info }`.
	 * @param array $api_args Args used.
	 */
	$payload = (array) apply_filters(
		'desktop_mode_plugins_window_browse_response',
		$payload,
		$api_args
	);

	set_transient( $cache_key, $payload, 10 * MINUTE_IN_SECONDS );
	wp_send_json_success( $payload );
}
add_action( 'wp_ajax_desktop_mode_plugins_browse', 'desktop_mode_plugins_window_ajax_browse' );

/**
 * `wp_ajax_desktop_mode_plugins_info` — proxy to
 * `plugins_api( 'plugin_information', { slug, fields: { … } } )`
 * with a 1-hour transient cache per slug.
 *
 * Body params:
 *   - slug  string, required
 *
 * @since 0.9.0
 */
function desktop_mode_plugins_window_ajax_info() {
	$guard = desktop_mode_plugins_window_ajax_guard( 'install_plugins' );
	if ( is_wp_error( $guard ) ) {
		desktop_mode_plugins_window_ajax_error( $guard );
		return;
	}

	// See note in the browse handler — `plugins_api()` is admin-only;
	// admin-ajax does not auto-load it. Mirrors Core's own
	// `wp_ajax_install_plugin` idiom.
	if ( ! function_exists( 'plugins_api' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
	}

	$slug = isset( $_POST['slug'] ) ? sanitize_key( wp_unslash( (string) $_POST['slug'] ) ) : '';
	if ( '' === $slug ) {
		desktop_mode_plugins_window_ajax_error(
			new WP_Error(
				'desktop_mode_plugins_missing_slug',
				__( 'Missing plugin slug.', 'desktop-mode' ),
				array( 'status' => 400 )
			)
		);
		return;
	}

	$cache_key = 'dm_pwinfo_' . md5( $slug );
	$cached    = get_transient( $cache_key );
	if ( false !== $cached && is_array( $cached ) ) {
		wp_send_json_success( $cached );
		return;
	}

	$api_args = array(
		'slug'   => $slug,
		'fields' => array(
			'sections'          => true,
			'screenshots'       => true,
			'ratings'           => true,
			'banners'           => true,
			'icons'             => true,
			'contributors'      => true,
			'last_updated'      => true,
			'requires'          => true,
			'requires_php'      => true,
			'tested'            => true,
			'homepage'          => true,
			'short_description' => true,
			'donate_link'       => true,
			'reviews'           => false, // We use our own scraper for the Reviews tab.
		),
	);

	$result = plugins_api( 'plugin_information', $api_args );
	if ( is_wp_error( $result ) ) {
		desktop_mode_plugins_window_ajax_error( $result );
		return;
	}

	$payload = (array) $result;

	/**
	 * Filter the plugin-information response before it's cached + sent.
	 *
	 * @since 0.9.0
	 *
	 * @param array  $payload Result, cast to array.
	 * @param string $slug    Plugin slug.
	 */
	$payload = (array) apply_filters(
		'desktop_mode_plugins_window_info_response',
		$payload,
		$slug
	);

	set_transient( $cache_key, $payload, HOUR_IN_SECONDS );
	wp_send_json_success( $payload );
}
add_action( 'wp_ajax_desktop_mode_plugins_info', 'desktop_mode_plugins_window_ajax_info' );

/**
 * `wp_ajax_desktop_mode_plugins_reviews` — best-effort scrape of the
 * top reviews from a plugin's wp.org page.
 *
 * Body params:
 *   - slug  string, required
 *
 * Returns either `{ items: [...], parsed: true }` or
 * `{ items: [], parsed: false, reason: '<code>' }`. Caller is
 * expected to fall back to the histogram-only view on `parsed: false`.
 * Cache success 1h, failure 15m so wp.org can recover quickly.
 *
 * @since 0.9.0
 */
function desktop_mode_plugins_window_ajax_reviews() {
	$guard = desktop_mode_plugins_window_ajax_guard( 'install_plugins' );
	if ( is_wp_error( $guard ) ) {
		desktop_mode_plugins_window_ajax_error( $guard );
		return;
	}

	$slug = isset( $_POST['slug'] ) ? sanitize_key( wp_unslash( (string) $_POST['slug'] ) ) : '';
	if ( '' === $slug ) {
		desktop_mode_plugins_window_ajax_error(
			new WP_Error(
				'desktop_mode_plugins_missing_slug',
				__( 'Missing plugin slug.', 'desktop-mode' ),
				array( 'status' => 400 )
			)
		);
		return;
	}

	$cache_key = 'dm_pwreviews_' . md5( $slug );
	$cached    = get_transient( $cache_key );
	if ( false !== $cached && is_array( $cached ) ) {
		wp_send_json_success( $cached );
		return;
	}

	/**
	 * Filter to swap out the default DOMDocument-based review parser.
	 *
	 * Return an array of items to short-circuit; return `null` to
	 * fall through to the default parser. Items must each be an
	 * associative array with `author`, `stars` (int 1–5), `excerpt`,
	 * `date`, and (optional) `url` keys.
	 *
	 * @since 0.9.0
	 *
	 * @param array|null $items Override list, or null for default behaviour.
	 * @param string     $slug  Plugin slug.
	 */
	$override = apply_filters( 'desktop_mode_plugins_window_review_parser', null, $slug );
	if ( is_array( $override ) ) {
		$payload = array(
			'items'  => array_values( $override ),
			'parsed' => true,
		);
		set_transient( $cache_key, $payload, HOUR_IN_SECONDS );
		wp_send_json_success( $payload );
		return;
	}

	$url      = 'https://wordpress.org/plugins/' . $slug . '/#reviews';
	$response = wp_remote_get(
		$url,
		array(
			'timeout'   => 5,
			'sslverify' => true,
			'headers'   => array(
				'Accept-Language' => get_locale(),
			),
		)
	);

	if ( is_wp_error( $response ) ) {
		$payload = array(
			'items'  => array(),
			'parsed' => false,
			'reason' => 'fetch_failed',
		);
		set_transient( $cache_key, $payload, 15 * MINUTE_IN_SECONDS );
		wp_send_json_success( $payload );
		return;
	}

	$status = (int) wp_remote_retrieve_response_code( $response );
	if ( $status < 200 || $status >= 300 ) {
		$payload = array(
			'items'  => array(),
			'parsed' => false,
			'reason' => 'http_' . $status,
		);
		set_transient( $cache_key, $payload, 15 * MINUTE_IN_SECONDS );
		wp_send_json_success( $payload );
		return;
	}

	$body = (string) wp_remote_retrieve_body( $response );
	if ( '' === $body ) {
		$payload = array(
			'items'  => array(),
			'parsed' => false,
			'reason' => 'empty_body',
		);
		set_transient( $cache_key, $payload, 15 * MINUTE_IN_SECONDS );
		wp_send_json_success( $payload );
		return;
	}

	$items = desktop_mode_plugins_window_parse_reviews_html( $body );
	if ( null === $items ) {
		$payload = array(
			'items'  => array(),
			'parsed' => false,
			'reason' => 'parse_failed',
		);
		set_transient( $cache_key, $payload, 15 * MINUTE_IN_SECONDS );
		wp_send_json_success( $payload );
		return;
	}

	$payload = array(
		'items'  => $items,
		'parsed' => true,
	);
	set_transient( $cache_key, $payload, HOUR_IN_SECONDS );
	wp_send_json_success( $payload );
}
add_action( 'wp_ajax_desktop_mode_plugins_reviews', 'desktop_mode_plugins_window_ajax_reviews' );

/**
 * Default DOMDocument-based parser for the wp.org plugin reviews
 * page. Returns an array of `{ author, stars, excerpt, date, url }`
 * on success, or `null` when parsing fails.
 *
 * The wp.org review HTML may change without notice — wrap every
 * navigation in `try`/`catch` and bail to `null` on any failure so
 * the JS can fall back to the histogram-only view.
 *
 * @since 0.9.0
 *
 * @param string $html
 * @return array<int,array<string,mixed>>|null
 */
function desktop_mode_plugins_window_parse_reviews_html( $html ) {
	if ( ! class_exists( 'DOMDocument' ) ) {
		return null;
	}

	try {
		$prev = libxml_use_internal_errors( true );
		$doc  = new DOMDocument();
		// Force UTF-8 — wp.org output is UTF-8 but loadHTML defaults
		// to ISO-8859-1.
		$doc->loadHTML(
			'<?xml encoding="UTF-8">' . $html,
			LIBXML_NOERROR | LIBXML_NOWARNING
		);
		libxml_clear_errors();
		libxml_use_internal_errors( $prev );

		$xpath = new DOMXPath( $doc );

		// wp.org review markup at the time of writing wraps each
		// review in `<div class="review">` containing `<h4>`-like
		// title, `<div class="reviewer">` author block, `<p>` body,
		// star rating spans, and a permalink. We grab the first 5.
		$reviews = $xpath->query( '//*[contains(concat(" ", normalize-space(@class), " "), " review ")]' );
		if ( ! $reviews instanceof DOMNodeList || 0 === $reviews->length ) {
			return null;
		}

		$out   = array();
		$count = 0;
		foreach ( $reviews as $review ) {
			if ( $count >= 5 ) {
				break;
			}
			if ( ! $review instanceof DOMNode ) {
				continue;
			}

			$author = '';
			$author_nodes = $xpath->query(
				'.//*[contains(concat(" ", normalize-space(@class), " "), " reviewer-name ")]',
				$review
			);
			if ( $author_nodes instanceof DOMNodeList && $author_nodes->length > 0 ) {
				$author = trim( (string) $author_nodes->item( 0 )->textContent );
			}

			$excerpt = '';
			$excerpt_nodes = $xpath->query( './/p', $review );
			if ( $excerpt_nodes instanceof DOMNodeList && $excerpt_nodes->length > 0 ) {
				$excerpt = trim( (string) $excerpt_nodes->item( 0 )->textContent );
			}
			if ( '' !== $excerpt && function_exists( 'mb_strimwidth' ) ) {
				$excerpt = mb_strimwidth( $excerpt, 0, 320, '…' );
			}

			$date = '';
			$date_nodes = $xpath->query(
				'.//*[contains(concat(" ", normalize-space(@class), " "), " review-date ")]',
				$review
			);
			if ( $date_nodes instanceof DOMNodeList && $date_nodes->length > 0 ) {
				$date = trim( (string) $date_nodes->item( 0 )->textContent );
			}

			$stars = 0;
			$rating_nodes = $xpath->query(
				'.//*[contains(concat(" ", normalize-space(@class), " "), " wporg-ratings ") or contains(concat(" ", normalize-space(@class), " "), " star-rating ")]',
				$review
			);
			if ( $rating_nodes instanceof DOMNodeList && $rating_nodes->length > 0 ) {
				$rating_text = (string) $rating_nodes->item( 0 )->textContent;
				if ( preg_match( '/(\d+(?:\.\d+)?)\s*\/\s*5/', $rating_text, $m ) ) {
					$stars = (int) round( (float) $m[1] );
				} elseif ( preg_match( '/(\d+)\s*star/i', $rating_text, $m ) ) {
					$stars = (int) $m[1];
				} else {
					// Fall back to counting filled-star elements.
					$filled = $xpath->query(
						'.//*[contains(concat(" ", normalize-space(@class), " "), " star ") and contains(concat(" ", normalize-space(@class), " "), " filled ")]',
						$rating_nodes->item( 0 )
					);
					if ( $filled instanceof DOMNodeList ) {
						$stars = (int) $filled->length;
					}
				}
			}
			$stars = max( 0, min( 5, $stars ) );

			$url = '';
			$link_nodes = $xpath->query( './/a[contains(@href, "/topic/")]', $review );
			if ( $link_nodes instanceof DOMNodeList && $link_nodes->length > 0 ) {
				$href = $link_nodes->item( 0 );
				if ( $href instanceof DOMElement ) {
					$url = (string) $href->getAttribute( 'href' );
				}
			}

			if ( '' === $author && '' === $excerpt ) {
				continue;
			}

			$out[] = array(
				'author'  => $author,
				'stars'   => $stars,
				'excerpt' => $excerpt,
				'date'    => $date,
				'url'     => $url,
			);
			$count++;
		}

		return $out;
	} catch ( Throwable $e ) { // phpcs:ignore PHPCompatibility.Classes.NewClasses.throwableFound
		// Throwable covers both Errors and Exceptions on PHP 7+. Any
		// failure (e.g. malformed HTML, libxml gone) bails to null
		// so the caller serves the histogram-only fallback.
		return null;
	}
}

/**
 * `wp_ajax_desktop_mode_plugins_upload` — install a plugin from a
 * .zip uploaded as multipart/form-data under the `pluginzip` field.
 *
 * Mirrors the classic `update.php?action=upload-plugin` flow but
 * returns JSON. By the time this callback fires, the
 * `Plugin_Upgrader`, `WP_Ajax_Upgrader_Skin`, and `wp_handle_upload`
 * symbols are already loaded (admin-ajax loads them).
 *
 * @since 0.9.0
 */
function desktop_mode_plugins_window_ajax_upload() {
	$guard = desktop_mode_plugins_window_ajax_guard( 'upload_plugins' );
	if ( is_wp_error( $guard ) ) {
		desktop_mode_plugins_window_ajax_error( $guard );
		return;
	}

	if ( empty( $_FILES['pluginzip'] ) || ! is_array( $_FILES['pluginzip'] ) ) {
		desktop_mode_plugins_window_ajax_error(
			new WP_Error(
				'desktop_mode_plugins_missing_file',
				__( 'No file received. Pick a .zip and try again.', 'desktop-mode' ),
				array( 'status' => 400 )
			)
		);
		return;
	}

	$file = $_FILES['pluginzip']; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- read raw, sanitized below.

	if ( ! isset( $file['name'] ) || ! isset( $file['tmp_name'] ) || ! isset( $file['error'] ) ) {
		desktop_mode_plugins_window_ajax_error(
			new WP_Error(
				'desktop_mode_plugins_invalid_file',
				__( 'Upload payload is malformed.', 'desktop-mode' ),
				array( 'status' => 400 )
			)
		);
		return;
	}

	if ( UPLOAD_ERR_OK !== (int) $file['error'] ) {
		desktop_mode_plugins_window_ajax_error(
			new WP_Error(
				'desktop_mode_plugins_upload_error',
				sprintf(
					/* translators: %d: PHP UPLOAD_ERR_* code. */
					__( 'Upload failed (error %d). Try again.', 'desktop-mode' ),
					(int) $file['error']
				),
				array( 'status' => 400 )
			)
		);
		return;
	}

	$name = sanitize_file_name( (string) $file['name'] );
	if ( '' === $name || '.zip' !== strtolower( substr( $name, -4 ) ) ) {
		desktop_mode_plugins_window_ajax_error(
			new WP_Error(
				'desktop_mode_plugins_not_zip',
				__( 'Plugin uploads must be a .zip file.', 'desktop-mode' ),
				array( 'status' => 400 )
			)
		);
		return;
	}

	$tmp_name = (string) $file['tmp_name'];
	if ( ! is_uploaded_file( $tmp_name ) ) {
		// Defensive — `is_uploaded_file()` is the standard guard
		// against a path-traversal payload smuggled through tmp_name.
		desktop_mode_plugins_window_ajax_error(
			new WP_Error(
				'desktop_mode_plugins_bad_tmp',
				__( 'Refused: temporary upload path is not trusted.', 'desktop-mode' ),
				array( 'status' => 400 )
			)
		);
		return;
	}

	// `Plugin_Upgrader` + `WP_Ajax_Upgrader_Skin` are admin-only
	// classes; admin-ajax does NOT auto-load them. Same `require_once`
	// chain Core's own `wp_ajax_install_plugin` uses (see
	// `wp-admin/includes/ajax-actions.php`). Plugin Check accepts
	// this in admin-ajax callbacks — the rule applies to non-admin
	// contexts (REST callbacks, plugin bootstrap), not here.
	if ( ! function_exists( 'wp_handle_upload' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}
	if ( ! class_exists( 'WP_Upgrader' ) ) {
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
	}
	if ( ! class_exists( 'WP_Ajax_Upgrader_Skin' ) ) {
		require_once ABSPATH . 'wp-admin/includes/class-wp-ajax-upgrader-skin.php';
	}
	if ( ! class_exists( 'Plugin_Upgrader' ) || ! class_exists( 'WP_Ajax_Upgrader_Skin' ) ) {
		desktop_mode_plugins_window_ajax_error(
			new WP_Error(
				'desktop_mode_plugins_upgrader_missing',
				__( 'Plugin upgrader is unavailable in this context. Reload the page and try again.', 'desktop-mode' ),
				array( 'status' => 503 )
			)
		);
		return;
	}

	// phpcs:ignore WordPress.Security.NonceVerification.Missing -- nonce verified above via desktop_mode_plugins_window_ajax_guard().
	$overwrite = ! empty( $_POST['overwrite'] );

	$skin     = new WP_Ajax_Upgrader_Skin();
	$upgrader = new Plugin_Upgrader( $skin );
	$result   = $upgrader->install(
		$tmp_name,
		array( 'overwrite_package' => $overwrite )
	);

	// Treat "destination folder exists" specially when the caller did
	// NOT explicitly ask to overwrite — return a 409 with enough
	// context for the client to prompt the user and re-submit with
	// `overwrite=1`. WP_Ajax_Upgrader_Skin parks the error on
	// `$skin->result`; older paths and `Plugin_Upgrader::install()`
	// itself can also surface it via `$result` directly or by
	// returning `false`, so check all three. Mirrors Core's classic
	// `update.php?action=upload-plugin` confirm flow without the
	// full upload-and-rerun-from-disk dance.
	$folder_exists = false;
	if ( ! $overwrite ) {
		if ( is_wp_error( $skin->result ) && 'folder_exists' === $skin->result->get_error_code() ) {
			$folder_exists = true;
		} elseif ( is_wp_error( $result ) && 'folder_exists' === $result->get_error_code() ) {
			$folder_exists = true;
		} elseif ( false === $result || null === $result ) {
			// `Plugin_Upgrader::install()` returns `false` when the
			// destination already exists and overwrite isn't allowed.
			// We can't get the destination path from the result, but
			// the upgrader emitted the same `folder_exists` skin
			// error en route (caught above) — this branch is a
			// belt-and-braces fallback.
			$folder_exists = true;
		}
	}

	if ( $folder_exists ) {
		desktop_mode_plugins_window_ajax_error(
			new WP_Error(
				'folder_exists',
				__(
					'A plugin with the same folder name is already installed. Replace it to continue.',
					'desktop-mode'
				),
				array( 'status' => 409 )
			)
		);
		return;
	}

	if ( is_wp_error( $skin->result ) ) {
		desktop_mode_plugins_window_ajax_error( $skin->result );
		return;
	}
	if ( $skin->get_errors()->has_errors() ) {
		desktop_mode_plugins_window_ajax_error( $skin->get_errors() );
		return;
	}
	if ( is_wp_error( $result ) ) {
		desktop_mode_plugins_window_ajax_error( $result );
		return;
	}
	if ( false === $result || null === $result ) {
		desktop_mode_plugins_window_ajax_error(
			new WP_Error(
				'desktop_mode_plugins_install_failed',
				__( 'Plugin install failed.', 'desktop-mode' ),
				array( 'status' => 500 )
			)
		);
		return;
	}

	$plugin_file = $upgrader->plugin_info();

	/**
	 * Fires after the Plugins window has installed a plugin from an
	 * uploaded .zip. Hook callers receive the resolved plugin file.
	 *
	 * @since 0.9.0
	 *
	 * @param string $plugin_file Plugin file (e.g. "akismet/akismet.php").
	 */
	do_action( 'desktop_mode_plugins_window_installed', $plugin_file );

	// Read the just-installed plugin's headers so the client can show
	// a name / version on the post-install Activate panel without a
	// follow-up round-trip. `get_plugin_data()` reads the file
	// directly — cheap, and the file is already warm in disk cache
	// from the upgrader.
	$plugin_name    = '';
	$plugin_version = '';
	if ( '' !== $plugin_file ) {
		if ( ! function_exists( 'get_plugin_data' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		$abs_plugin_file = WP_PLUGIN_DIR . '/' . $plugin_file;
		if ( file_exists( $abs_plugin_file ) ) {
			$data           = get_plugin_data( $abs_plugin_file, false, false );
			$plugin_name    = isset( $data['Name'] ) ? (string) $data['Name'] : '';
			$plugin_version = isset( $data['Version'] ) ? (string) $data['Version'] : '';
		}
	}

	wp_send_json_success(
		array(
			'plugin_file'    => (string) $plugin_file,
			'plugin_name'    => $plugin_name,
			'plugin_version' => $plugin_version,
			'status'         => 'inactive',
			'messages'       => $skin->get_upgrade_messages(),
		)
	);
}
add_action( 'wp_ajax_desktop_mode_plugins_upload', 'desktop_mode_plugins_window_ajax_upload' );

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
 * @since 0.20.0
 *
 * @return string[] List of wp.org plugin slugs.
 */
function desktop_mode_plugins_window_featured_slugs() {
	$slugs = array(
		// The author of this plugin forgot to declare Desktop Mode as a
		// dependency — surfacing it here makes sure desktop-mode users
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
	 * @since 0.20.0
	 *
	 * @param string[] $slugs Plugin slugs.
	 */
	$slugs = (array) apply_filters( 'desktop_mode_plugins_featured_slugs', $slugs );
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
 * `wp_ajax_desktop_mode_plugins_featured` — return the Featured tab's
 * curated + auto-discovered list of plugins that integrate with Desktop
 * Mode.
 *
 * Composition:
 *   1. Curated slugs from `desktop_mode_plugins_window_featured_slugs()`,
 *      hydrated via `plugins_api( 'plugin_information' )` so the card
 *      payload is always fresh.
 *   2. Auto-discovered slugs from `plugins_api( 'query_plugins' )` whose
 *      `requires_plugins` array contains `desktop-mode`. wp.org has no
 *      server-side filter for this today, so we run a broad query and
 *      filter client-side server-side. Deduped against the curated set.
 *
 * Body params: (none)
 *
 * Cached for 1h. Failures cached for 15m so a flaky wp.org doesn't
 * hammer the API on every tab open.
 *
 * @since 0.20.0
 */
function desktop_mode_plugins_window_ajax_featured() {
	$guard = desktop_mode_plugins_window_ajax_guard( 'install_plugins' );
	if ( is_wp_error( $guard ) ) {
		desktop_mode_plugins_window_ajax_error( $guard );
		return;
	}

	if ( ! function_exists( 'plugins_api' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
	}

	$cache_key = 'dm_pwfeatured_v1';
	$cached    = get_transient( $cache_key );
	if ( false !== $cached && is_array( $cached ) ) {
		wp_send_json_success( $cached );
		return;
	}

	$plugins      = array();
	$seen_slugs   = array();
	$fields       = array(
		'icons'             => true,
		'banners'           => true,
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
	$curated = desktop_mode_plugins_window_featured_slugs();
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
			// tab. Logged via WP_Error so debug builds can spot it.
			continue;
		}
		$row             = (array) $info;
		$row['featured'] = true;
		$plugins[]       = $row;
		$seen_slugs[ $slug ] = true;
	}

	// ─── 2. Auto-discover via `requires_plugins` ──────────────────────
	// Best-effort scan: pull the top of the directory and keep rows that
	// declare desktop-mode as a dependency. The wp.org `query_plugins`
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
			if ( ! in_array( 'desktop-mode', $requires, true ) ) {
				continue;
			}
			$candidate['featured'] = false;
			$plugins[]             = $candidate;
			$seen_slugs[ $slug ]   = true;
		}
	}

	$payload = array(
		'plugins' => array_values( $plugins ),
		'info'    => array(
			'curated'    => count( $curated ),
			'discovered' => count( $plugins ) - count( $curated ),
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
	 * @since 0.20.0
	 *
	 * @param array $payload  `{ plugins: [...], info: {...} }`.
	 * @param array $curated  Curated slug list.
	 */
	$payload = (array) apply_filters(
		'desktop_mode_plugins_featured_response',
		$payload,
		$curated
	);

	set_transient( $cache_key, $payload, HOUR_IN_SECONDS );
	wp_send_json_success( $payload );
}
add_action( 'wp_ajax_desktop_mode_plugins_featured', 'desktop_mode_plugins_window_ajax_featured' );
