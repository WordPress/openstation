<?php
/**
 * Desktop Mode helper functions.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Filename suffix for built JS/CSS bundles: `.min` in production,
 * `''` (the unminified dev build) under SCRIPT_DEBUG.
 *
 * Centralised because the SCRIPT_DEBUG branch needs a guard the old
 * per-file ternaries didn't have: release zips ship the minified
 * bundles only (the ~4–5 MB of dev bundles are a source-checkout
 * artifact — see bin/package.sh), so a production site that happens
 * to define SCRIPT_DEBUG would otherwise request dev files that
 * don't exist and 404 every desktop-mode script. Probe one
 * canonical dev bundle; if it's absent, this is a minified-only
 * install and `.min` is the only truth available.
 *
 * @since 0.9.7
 *
 * @return string `'.min'` or `''`.
 */
function desktop_mode_asset_suffix() {
	static $suffix = null;
	if ( null !== $suffix ) {
		return $suffix;
	}
	if ( ! ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ) {
		$suffix = '.min';
		return $suffix;
	}
	$suffix = file_exists( DESKTOP_MODE_DIR . 'assets/js/desktop.js' ) ? '' : '.min';
	return $suffix;
}

/**
 * Checks whether a user has desktop mode enabled.
 *
 * Two gates, both must pass:
 *
 * 1. The user's `desktop_mode_mode` user-meta is `'1'` (the per-user
 *    opt-in toggle the admin-bar button writes via the AJAX endpoint).
 * 2. The `desktop_mode_mode_enabled` filter returns truthy for that user.
 *
 * Centralising the filter check here means render-time gates (chromeless
 * detection, payload generation, REST permission callbacks) can rely on
 * a single helper instead of every call site re-running the filter.
 * A user whose meta is `'1'` but whose filter denies them is treated as
 * not-enabled everywhere, which is the documented contract of the
 * filter — see docs/examples/gate-by-role.md.
 *
 * @since 0.1.0
 *
 * @param int $user_id Optional. User ID to check. Defaults to the
 *                     current user.
 * @return bool True if the user has desktop mode active.
 */
function desktop_mode_is_enabled( $user_id = 0 ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		if ( ! is_user_logged_in() ) {
			return false;
		}
		$user_id = get_current_user_id();
	}

	if ( '1' !== (string) get_user_meta( $user_id, 'desktop_mode_mode', true ) ) {
		return false;
	}

	/**
	 * Filters whether desktop mode is available for this user.
	 *
	 * See `docs/hooks-reference.md` (`desktop_mode_mode_enabled`) for the
	 * full contract. Returning `false` here makes the helper return
	 * `false` for the user even when their meta is set, which propagates
	 * to every render-time gate that consults the helper.
	 *
	 * @since 0.1.0
	 *
	 * @param bool $enabled Whether desktop mode is enabled. Default true.
	 * @param int  $user_id The user ID being checked.
	 */
	return (bool) apply_filters( 'desktop_mode_mode_enabled', true, $user_id );
}

/**
 * Shared REST permission gate for Desktop Mode's per-user endpoints.
 *
 * Routes that only ever read or write the *current* user's own Desktop
 * Mode state (OS settings, session, default-window, seen-intros, PWA
 * state, presence) must not be reachable by accounts that haven't
 * actually entered Desktop Mode.
 *
 * `current_user_can( 'read' )` alone is too loose: every authenticated
 * role — Subscriber included — carries `read`, so the old gate let any
 * logged-in user touch these routes without ever enabling Desktop Mode.
 * We gate on {@see desktop_mode_is_enabled()} instead (the same opt-in +
 * `desktop_mode_mode_enabled` filter the shell itself uses) and return
 * the conventional 401/403 split so REST clients can tell "log in" from
 * "not allowed".
 *
 * This is the canonical gate; `desktop_mode_presence_rest_permission()`
 * pioneered the shape and now delegates here.
 *
 * @since 0.8.10
 *
 * @return true|WP_Error True when allowed; a `rest_forbidden` WP_Error
 *                       (401 when logged out, 403 when desktop mode is
 *                       not enabled for the account) otherwise.
 */
function desktop_mode_rest_require_enabled() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'Authentication required.', 'desktop-mode' ),
			array( 'status' => 401 )
		);
	}

	if ( ! desktop_mode_is_enabled() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'Desktop mode is not enabled for your account.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	return true;
}

// Chromeless / classic admin-bar suppression and the `wp_redirect`
// flag-preservation filter pair were moved to
// `includes/core/routing.php` in 0.8.1. The functions and the
// add_filter / add_action hookings live there now; this file
// remains the home of `desktop_mode_is_enabled()` (called from the
// routing helpers at hook-fire time, after every include has
// loaded), which is why `desktop-mode.php` can safely require
// routing.php BEFORE helpers.php.

/**
 * `desktop_mode_is_chromeless_request()` and `desktop_mode_is_classic_request()`
 * were moved to `includes/core/routing.php` in 0.8.1 — see that
 * file for the canonical definitions. The function names didn't
 * change; PHP looks them up by name at call time, so every
 * existing caller (helpers, render, hooks) keeps working.
 */

/**
 * Returns the default wallpaper id used when a user has no saved
 * selection (or their saved selection was unregistered by a plugin
 * deactivation).
 *
 * Exposed as a filter so themes/plugins can set a site-wide default
 * without forking the TS build.
 *
 * ```php
 * add_filter( 'desktop_mode_default_wallpaper', function () {
 *     return 'my-plugin/brand';
 * } );
 * ```
 *
 * The returned string is passed through `sanitize_key()` so a filter
 * that returns an invalid slug degrades to the empty string (and the
 * shell falls back to its hard-coded `'dark'` preset).
 *
 * @since 0.5.0
 *
 * @return string Wallpaper id. Empty string if the filter returns
 *                an invalid value.
 */
function desktop_mode_get_default_wallpaper() {
	/**
	 * Filters the wallpaper id loaded on first boot / new user.
	 *
	 * @since 0.5.0
	 *
	 * @param string $id Default wallpaper slug.
	 */
	$id = apply_filters( 'desktop_mode_default_wallpaper', 'dark' );
	if ( ! is_string( $id ) ) {
		return '';
	}
	return sanitize_key( $id );
}

/**
 * Build a `WP_Error` for a desktop-mode registration failure.
 *
 * Centralises the error-code vocabulary used by every
 * `desktop_mode_register_*()` function so plugin authors see a
 * consistent contract. The canonical error-code list lives in
 * `docs/hooks-reference.md`.
 *
 * @since 0.5.0
 *
 * @param string $code    Short error slug (e.g. `desktop_mode_missing_title`).
 * @param string $message Human-readable message. Should be translated.
 * @param array  $data    Optional extra context attached to the error.
 * @return WP_Error
 */
function desktop_mode_registration_error( $code, $message, $data = array() ) {
	return new WP_Error(
		(string) $code,
		(string) $message,
		is_array( $data ) ? $data : array()
	);
}

// `desktop_mode_url_is_same_admin()`,
// `desktop_mode_resolve_admin_target()` and
// `desktop_mode_admin_target_allowlist()` were moved to
// `includes/core/routing.php` in 0.8.1 — see that file for the
// canonical definitions. Function names didn't change; PHP's
// runtime resolution finds them across the module split.


// Dock building, menu / native-windows payload assembly and the
// script/style handle resolvers were moved to
// `includes/core/payload.php` in 0.8.1. Function names didn't
// change; existing callers find them via PHP's runtime function
// resolution. desktop-mode.php loads payload.php right after
// helpers.php so the foundational helpers (desktop_mode_is_enabled
// etc.) are present when payload functions are invoked.
