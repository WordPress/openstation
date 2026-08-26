<?php
/**
 * OpenStation helper functions.
 *
 * @package OpenStation
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
 * don't exist and 404 every openstation script. Probe one
 * canonical dev bundle; if it's absent, this is a minified-only
 * install and `.min` is the only truth available.
 *
 * @return string `'.min'` or `''`.
 */
function openstation_asset_suffix() {
	static $suffix = null;
	if ( null !== $suffix ) {
		return $suffix;
	}
	if ( ! ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ) {
		$suffix = '.min';
		return $suffix;
	}
	$suffix = file_exists( OPENSTATION_DIR . 'assets/js/desktop.js' ) ? '' : '.min';
	return $suffix;
}

/**
 * Checks whether a user has OpenStation enabled.
 *
 * Two gates, both must pass:
 *
 * 1. The user's `desktop_mode_mode` user-meta is `'1'` (the per-user
 *    opt-in toggle the admin-bar button writes via the AJAX endpoint).
 * 2. The `openstation_mode_enabled` filter returns truthy for that user.
 *
 * Centralising the filter check here means render-time gates (chromeless
 * detection, payload generation, REST permission callbacks) can rely on
 * a single helper instead of every call site re-running the filter.
 * A user whose meta is `'1'` but whose filter denies them is treated as
 * not-enabled everywhere, which is the documented contract of the
 * filter — see docs/examples/gate-by-role.md.
 *
 * @param int $user_id Optional. User ID to check. Defaults to the
 *                     current user.
 * @return bool True if the user has OpenStation active.
 */
function openstation_is_enabled( $user_id = 0 ) {
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
	 * Filters whether OpenStation is available for this user.
	 *
	 * See `docs/hooks-reference.md` (`openstation_mode_enabled`) for the
	 * full contract. Returning `false` here makes the helper return
	 * `false` for the user even when their meta is set, which propagates
	 * to every render-time gate that consults the helper.
	 *
	 * @param bool $enabled Whether OpenStation is enabled. Default true.
	 * @param int  $user_id The user ID being checked.
	 */
	return (bool) apply_filters( 'openstation_mode_enabled', true, $user_id );
}

/**
 * Shared REST permission gate for OpenStation's per-user endpoints.
 *
 * Routes that only ever read or write the *current* user's own Desktop
 * Mode state (OS settings, session, default-window, seen-intros, PWA
 * state, presence) must not be reachable by accounts that haven't
 * actually entered OpenStation.
 *
 * `current_user_can( 'read' )` alone is too loose: every authenticated
 * role — Subscriber included — carries `read`, so the old gate let any
 * logged-in user touch these routes without ever enabling OpenStation.
 * We gate on {@see openstation_is_enabled()} instead (the same opt-in +
 * `openstation_mode_enabled` filter the shell itself uses) and return
 * the conventional 401/403 split so REST clients can tell "log in" from
 * "not allowed".
 *
 * This is the canonical gate; `openstation_presence_rest_permission()`
 * pioneered the shape and now delegates here.
 *
 * @return true|WP_Error True when allowed; a `rest_forbidden` WP_Error
 *                       (401 when logged out, 403 when OpenStation is
 *                       not enabled for the account) otherwise.
 */
function openstation_rest_require_enabled() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'Authentication required.', 'desktop-mode' ),
			array( 'status' => 401 )
		);
	}

	if ( ! openstation_is_enabled() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'OpenStation is not enabled for your account.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	return true;
}

// Chromeless / classic admin-bar suppression and the `wp_redirect`
// flag-preservation filter pair were moved to
// `includes/core/routing.php`. The functions and the
// add_filter / add_action hookings live there now; this file
// remains the home of `openstation_is_enabled()` (called from the
// routing helpers at hook-fire time, after every include has
// loaded), which is why `desktop-mode.php` can safely require
// routing.php BEFORE helpers.php.

/**
 * `openstation_is_chromeless_request()` and `openstation_is_classic_request()`
 * were moved to `includes/core/routing.php` — see that
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
 * add_filter( 'openstation_default_wallpaper', function () {
 *     return 'my-plugin/brand';
 * } );
 * ```
 *
 * The returned string is passed through `sanitize_key()` so a filter
 * that returns an invalid slug degrades to the empty string (and the
 * shell falls back to its hard-coded default preset).
 *
 * @return string Wallpaper id. Empty string if the filter returns
 *                an invalid value.
 */
function openstation_get_default_wallpaper() {
	/**
	 * Filters the wallpaper id loaded on first boot / new user.
	 *
	 * @param string $id Default wallpaper slug.
	 */
	$id = apply_filters( 'openstation_default_wallpaper', 'galaxy' );
	if ( ! is_string( $id ) ) {
		return '';
	}
	return sanitize_key( $id );
}

/**
 * The site's own name, ready to use as a window / icon title.
 *
 * The desktop shows objects, not the software running it — so the
 * *root folder* of a site's content is named after the site itself
 * ("Izzi's Gym"), not after WordPress. That is the breadcrumb root and
 * the Content Graph's site label; the app that browses it is called WP
 * Explorer, which is a different string (see
 * `openstation_my_wordpress_app_title()`). This is the single source
 * for the site one.
 *
 * `get_bloginfo( 'name' )` returns the display-filtered option, which
 * carries HTML entities (`&amp;`, `&#039;`). Titles land in
 * `title=` attributes and JS-rendered text nodes, so the entities are
 * decoded here — leaving them encoded would render a literal
 * `Ben &amp; Jerry` on the desktop.
 *
 * @return string Decoded site title. Falls back to `WordPress` when
 *                the site has no name set.
 */
function openstation_site_title() {
	$title = wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES );
	$title = trim( $title );

	if ( '' === $title ) {
		$title = __( 'WordPress', 'desktop-mode' );
	}

	/**
	 * Filters the site title used for openstation window and icon
	 * titles — WP Explorer's breadcrumb root, the Content Graph's site
	 * label, and any "Open in <site>" action.
	 *
	 * Return a different string to label the desktop objects after
	 * something other than `blogname` (a brand, a network name, a
	 * per-user workspace label).
	 *
	 * @param string $title Decoded site title, never empty.
	 */
	$filtered = apply_filters( 'openstation_site_title', $title );

	return is_string( $filtered ) && '' !== trim( $filtered ) ? $filtered : $title;
}

/**
 * Decode a rendered title into the plain text the desktop paints with.
 *
 * `wptexturize()` encodes the characters titles are full of — `&` as
 * `&#038;`, an apostrophe as `&#8217;` — and the shell writes titles
 * into text nodes, where the entity renders as itself. Same reasoning
 * as {@see openstation_site_title()}, one layer down.
 *
 * Decode BEFORE the tag strip, never after: `&lt;script&gt;` decodes
 * into a real tag, and stripping second is what removes it.
 *
 * @param string $rendered A title that has been through a display filter.
 * @return string Plain text, tag-free.
 */
function openstation_plain_text_title( $rendered ) {
	$decoded = html_entity_decode(
		(string) $rendered,
		ENT_QUOTES,
		get_bloginfo( 'charset' )
	);

	return trim( wp_strip_all_tags( $decoded ) );
}

/**
 * Build a `WP_Error` for a openstation registration failure.
 *
 * Centralises the error-code vocabulary used by every
 * `openstation_register_*()` function so plugin authors see a
 * consistent contract. The canonical error-code list lives in
 * `docs/hooks-reference.md`.
 *
 * @param string $code    Short error slug (e.g. `openstation_missing_title`).
 * @param string $message Human-readable message. Should be translated.
 * @param array  $data    Optional extra context attached to the error.
 * @return WP_Error
 */
function openstation_registration_error( $code, $message, $data = array() ) {
	return new WP_Error(
		(string) $code,
		(string) $message,
		is_array( $data ) ? $data : array()
	);
}

// `openstation_url_is_same_admin()`,
// `openstation_resolve_admin_target()` and
// `openstation_admin_target_allowlist()` were moved to
// `includes/core/routing.php` — see that file for the
// canonical definitions. Function names didn't change; PHP's
// runtime resolution finds them across the module split.


// Dock building, menu / native-windows payload assembly and the
// script/style handle resolvers were moved to
// `includes/core/payload.php`. Function names didn't
// change; existing callers find them via PHP's runtime function
// resolution. desktop-mode.php loads payload.php right after
// helpers.php so the foundational helpers (openstation_is_enabled
// etc.) are present when payload functions are invoked.
