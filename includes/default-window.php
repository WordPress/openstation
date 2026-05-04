<?php
/**
 * Desktop Mode — Default window preference.
 *
 * Stores the user's choice of "what window opens when I enter the
 * desktop with nothing currently in session." Two signals matter:
 *
 *   1. `enabled` — false when the user has explicitly opted out of
 *      auto-opening anything. Entering an empty session under this
 *      flag gives the user a blank desktop, no surprise Dashboard.
 *   2. `url` — the admin URL that opens when enabled. Populated on
 *      first configure from whichever window the user marks as
 *      their startup window.
 *
 * Stored as a serialized array on user-meta `desktop_mode_default_window`.
 * A missing meta entry is treated as `{ enabled: true, url: <dashboard> }`
 * for backward compatibility with pre-0.6 installs.
 *
 * @package WPDesktopMode
 * @since   0.6.0
 */

defined( 'ABSPATH' ) || exit;

/** User-meta key. */
const DESKTOP_MODE_DEFAULT_WINDOW_META = 'desktop_mode_default_window';

/**
 * Fetch the user's default-window preference as a normalized array.
 *
 * @since 0.6.0
 *
 * @param int $user_id User ID. Falls back to the current user when 0.
 * @return array{enabled: bool, url: string} Always returns both keys.
 */
function desktop_mode_get_default_window( $user_id = 0 ) {
	$user_id = $user_id ? (int) $user_id : get_current_user_id();
	$fallback_url = admin_url( 'index.php' );
	$default = array(
		'enabled' => true,
		'url'     => $fallback_url,
	);

	if ( ! $user_id ) {
		return $default;
	}

	$raw = get_user_meta( $user_id, DESKTOP_MODE_DEFAULT_WINDOW_META, true );
	if ( ! is_array( $raw ) ) {
		return $default;
	}

	$enabled = ! empty( $raw['enabled'] );
	$url     = isset( $raw['url'] ) && is_string( $raw['url'] ) ? $raw['url'] : $fallback_url;
	if ( '' === $url ) {
		$url = $fallback_url;
	}

	return array(
		'enabled' => $enabled,
		'url'     => $url,
	);
}

/**
 * Persist the user's default-window preference.
 *
 * Passing `null` for $url disables the default entirely — the shell
 * will open an empty desktop on portal entry. Passing a URL enables
 * the default and sets it.
 *
 * @since 0.6.0
 *
 * @param int         $user_id User ID. Must be positive.
 * @param string|null $url     URL to set, or null to disable.
 * @return bool True on success, false on invalid URL or unknown user.
 */
function desktop_mode_set_default_window( $user_id, $url ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}

	if ( null === $url ) {
		update_user_meta(
			$user_id,
			DESKTOP_MODE_DEFAULT_WINDOW_META,
			array(
				'enabled' => false,
				'url'     => admin_url( 'index.php' ),
			)
		);
		return true;
	}

	$clean = desktop_mode_validate_default_window_url( $url );
	if ( '' === $clean ) {
		return false;
	}

	update_user_meta(
		$user_id,
		DESKTOP_MODE_DEFAULT_WINDOW_META,
		array(
			'enabled' => true,
			'url'     => $clean,
		)
	);
	return true;
}

/**
 * Only accept URLs that resolve to a same-origin `wp-admin/` path. A
 * stricter net than `esc_url_raw` because the value flows back into
 * the portal-entry redirect — we don't want an attacker's CSRF-seeded
 * preference to hijack the user into an off-site landing page.
 *
 * @since 0.6.0
 *
 * @param string $url Raw input.
 * @return string Fully-qualified URL, or empty string if rejected.
 */
function desktop_mode_validate_default_window_url( $url ) {
	$url = trim( (string) $url );
	if ( '' === $url ) {
		return '';
	}

	// Native-window marker: "native:<slug>" stores a registered native
	// window id (OS Settings, Recycle Bin, plugin-registered native
	// apps) instead of an admin URL. The slug must match
	// /^[a-z0-9_-]+$/i so a malicious save cannot smuggle path
	// traversal or whitespace through the marker. The shell handles
	// the actual open-on-startup at boot via nativeWindows.openById.
	if ( 0 === strpos( $url, 'native:' ) ) {
		$slug = substr( $url, strlen( 'native:' ) );
		if ( '' === $slug || ! preg_match( '/^[a-z0-9_\-]+$/i', $slug ) ) {
			return '';
		}
		return 'native:' . $slug;
	}

	// Allow same-origin http(s) URLs only.
	$parsed = wp_parse_url( $url );
	if ( ! is_array( $parsed ) || empty( $parsed['path'] ) ) {
		return '';
	}

	$home_origin  = wp_parse_url( home_url( '/' ) );
	$url_host     = isset( $parsed['host'] ) ? strtolower( $parsed['host'] ) : '';
	$url_scheme   = isset( $parsed['scheme'] ) ? strtolower( $parsed['scheme'] ) : '';
	$home_host    = is_array( $home_origin ) && isset( $home_origin['host'] ) ? strtolower( $home_origin['host'] ) : '';
	$home_scheme  = is_array( $home_origin ) && isset( $home_origin['scheme'] ) ? strtolower( $home_origin['scheme'] ) : '';

	if ( '' !== $url_host && $url_host !== $home_host ) {
		return '';
	}
	if ( '' !== $url_scheme && ! in_array( $url_scheme, array( 'http', 'https' ), true ) ) {
		return '';
	}
	// Make sure the path is inside wp-admin/.
	$admin_path = wp_parse_url( admin_url(), PHP_URL_PATH );
	if ( ! is_string( $admin_path ) ) {
		return '';
	}
	if ( 0 !== strpos( $parsed['path'], $admin_path ) ) {
		return '';
	}

	// Reassemble as a clean same-origin URL so downstream consumers
	// always get a fully-qualified string.
	$query = isset( $parsed['query'] ) ? '?' . $parsed['query'] : '';
	return esc_url_raw( home_url( $parsed['path'] . $query ), array( $home_scheme ?: 'https', 'http', 'https' ) );
}

/**
 * REST route: `POST /desktop-mode/v1/default-window`.
 *
 * Body: `{ url: string | null }`. Null disables the default.
 *
 * @since 0.6.0
 */
function desktop_mode_register_default_window_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/default-window',
		array(
			'methods'             => 'POST',
			'callback'            => 'desktop_mode_rest_set_default_window',
			'permission_callback' => function () {
				return is_user_logged_in() && current_user_can( 'read' );
			},
			// No schema type on `url` — the param is fundamentally
			// mixed (string | null) and WP REST's multi-type schema
			// validation has historically been flaky for this case
			// across core versions. Validate in the callback instead,
			// where both branches are explicit.
			'args'                => array(
				'url' => array(
					'description' => __( 'Admin URL to open on portal entry, or null to disable.', 'desktop-mode' ),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_register_default_window_routes' );

/**
 * REST handler — writes the default-window meta and returns the
 * normalized state.
 *
 * Accepts:
 *   - `{"url": "<same-origin wp-admin URL>"}` → sets this as default.
 *   - `{"url": null}` → explicitly disables the default.
 *   - `{}` (missing key) → treated same as null, for clients that
 *      encode "clear this value" as an absent key rather than an
 *      explicit null.
 *
 * @since 0.6.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_rest_set_default_window( $request ) {
	$user_id = get_current_user_id();
	$params  = $request->get_json_params();

	// Distinguish "url was sent" (possibly null or '') from "url key
	// absent entirely." For JSON payloads we look at get_json_params()
	// directly because get_param() loses the null-vs-missing distinction
	// when combined with a null-type schema.
	$has_url = is_array( $params ) && array_key_exists( 'url', $params );
	$url     = $has_url ? $params['url'] : null;

	// Null / missing / empty string all disable the default.
	if ( null === $url || '' === $url ) {
		desktop_mode_set_default_window( $user_id, null );
		return rest_ensure_response( desktop_mode_get_default_window( $user_id ) );
	}

	if ( ! is_string( $url ) ) {
		return new WP_Error(
			'desktop_mode_invalid_url',
			__( 'The `url` parameter must be a string or null.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$ok = desktop_mode_set_default_window( $user_id, $url );
	if ( ! $ok ) {
		return new WP_Error(
			'desktop_mode_invalid_url',
			__( 'The URL is not a valid same-origin wp-admin URL.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	return rest_ensure_response( desktop_mode_get_default_window( $user_id ) );
}
