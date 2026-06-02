<?php
/**
 * Desktop Mode — "Seen intros" registry.
 *
 * Tracks which one-time introduction dialogs the current user has
 * already dismissed, so the shell can show a "what's new in this
 * native app" dialog the first time a ported native window opens
 * and never bother the user again afterwards.
 *
 * Today the surface is the native Posts window. The same key is
 * intentionally generic — any future ported native app (Pages,
 * Comments, Users, Plugins, …) registers its own slug and reuses
 * this storage. OS Settings → Features exposes a "Reset what's-new
 * dialogs" button that clears the whole list so the user can see
 * every intro again from scratch.
 *
 * Storage shape:
 *   user meta `desktop_mode_seen_intros` → array<string> of slugs.
 *   `[ 'posts' ]`, `[ 'posts', 'pages' ]`, etc. Slug values pass
 *   through `sanitize_key()` and the list is capped at 64 entries
 *   so a runaway client cannot bloat user-meta indefinitely.
 *
 * @package WPDesktopMode
 * @since   0.8.0
 */

defined( 'ABSPATH' ) || exit;

/** User meta key — see file header for shape. */
const DESKTOP_MODE_SEEN_INTROS_META_KEY = 'desktop_mode_seen_intros';

/** Hard cap so a malicious client cannot grow the list unbounded. */
const DESKTOP_MODE_SEEN_INTROS_MAX = 64;

/**
 * Returns the list of intro slugs the user has dismissed.
 *
 * @since 0.8.0
 *
 * @param int $user_id User ID.
 * @return string[] Sanitized list (may be empty).
 */
function desktop_mode_get_seen_intros( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return array();
	}

	$raw = get_user_meta( $user_id, DESKTOP_MODE_SEEN_INTROS_META_KEY, true );
	if ( ! is_array( $raw ) ) {
		return array();
	}

	return desktop_mode_sanitize_seen_intros( $raw );
}

/**
 * Whether the user has already dismissed the given intro.
 *
 * @since 0.8.0
 *
 * @param int    $user_id User ID.
 * @param string $slug    Intro slug (e.g. `'posts'`).
 * @return bool
 */
function desktop_mode_has_seen_intro( $user_id, $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return false;
	}
	return in_array( $slug, desktop_mode_get_seen_intros( $user_id ), true );
}

/**
 * Adds a slug to the user's seen-intros list.
 *
 * Idempotent — re-marking an already-seen intro is a no-op that
 * still returns true.
 *
 * @since 0.8.0
 *
 * @param int    $user_id User ID.
 * @param string $slug    Intro slug.
 * @return bool True on successful write (or no-op), false otherwise.
 */
function desktop_mode_mark_intro_seen( $user_id, $slug ) {
	$user_id = (int) $user_id;
	$slug    = sanitize_key( (string) $slug );
	if ( $user_id <= 0 || '' === $slug ) {
		return false;
	}

	$current = desktop_mode_get_seen_intros( $user_id );
	if ( in_array( $slug, $current, true ) ) {
		return true;
	}

	$current[] = $slug;
	$current   = array_slice( $current, 0, DESKTOP_MODE_SEEN_INTROS_MAX );

	return false !== update_user_meta(
		$user_id,
		DESKTOP_MODE_SEEN_INTROS_META_KEY,
		$current
	);
}

/**
 * Wipes every seen-intro entry for the user. Used by the OS
 * Settings → Features "Reset what's-new dialogs" button.
 *
 * @since 0.8.0
 *
 * @param int $user_id User ID.
 * @return bool True on success.
 */
function desktop_mode_clear_seen_intros( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	return (bool) delete_user_meta( $user_id, DESKTOP_MODE_SEEN_INTROS_META_KEY );
}

/**
 * Coerces a raw payload to a clean list of slugs.
 *
 * @since 0.8.0
 *
 * @param mixed $raw Raw value.
 * @return string[]
 */
function desktop_mode_sanitize_seen_intros( $raw ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$out = array();
	foreach ( $raw as $entry ) {
		if ( ! is_string( $entry ) ) {
			continue;
		}
		$slug = sanitize_key( $entry );
		if ( '' === $slug ) {
			continue;
		}
		$out[] = $slug;
	}
	return array_slice( array_values( array_unique( $out ) ), 0, DESKTOP_MODE_SEEN_INTROS_MAX );
}

/**
 * Registers REST routes for the seen-intros surface.
 *
 * Routes:
 *   POST   /desktop-mode/v1/intros/seen   body: { slug: string }
 *   DELETE /desktop-mode/v1/intros        no body — clears the list
 *
 * Both return the post-mutation list so the client can refresh its
 * local snapshot without a follow-up GET.
 *
 * @since 0.8.0
 */
function desktop_mode_register_seen_intros_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/intros/seen',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'desktop_mode_rest_mark_intro_seen',
			'permission_callback' => 'desktop_mode_rest_seen_intros_permission',
			'args'                => array(
				'slug' => array(
					'required' => true,
					'type'     => 'string',
				),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/intros',
		array(
			'methods'             => WP_REST_Server::DELETABLE,
			'callback'            => 'desktop_mode_rest_clear_seen_intros',
			'permission_callback' => 'desktop_mode_rest_seen_intros_permission',
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_register_seen_intros_routes' );

/**
 * Permission gate — any logged-in user with desktop mode enabled may
 * manage their own seen-intros list. See
 * {@see desktop_mode_rest_require_enabled()} for why `read` alone is
 * insufficient.
 *
 * @since 0.8.0
 * @since 0.8.10 Hardened to require desktop mode enabled (was `read`).
 *
 * @return true|WP_Error
 */
function desktop_mode_rest_seen_intros_permission() {
	return desktop_mode_rest_require_enabled();
}

/**
 * REST handler for `POST /desktop-mode/v1/intros/seen`.
 *
 * @since 0.8.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_rest_mark_intro_seen( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$slug    = sanitize_key( (string) $request->get_param( 'slug' ) );
	if ( '' === $slug ) {
		return new WP_Error(
			'desktop_mode_invalid_intro_slug',
			__( 'The `slug` parameter must be a non-empty string.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	desktop_mode_mark_intro_seen( $user_id, $slug );
	return rest_ensure_response(
		array( 'seenIntros' => desktop_mode_get_seen_intros( $user_id ) )
	);
}

/**
 * REST handler for `DELETE /desktop-mode/v1/intros`.
 *
 * @since 0.8.0
 *
 * @return WP_REST_Response
 */
function desktop_mode_rest_clear_seen_intros() {
	$user_id = get_current_user_id();
	desktop_mode_clear_seen_intros( $user_id );
	return rest_ensure_response(
		array( 'seenIntros' => desktop_mode_get_seen_intros( $user_id ) )
	);
}
