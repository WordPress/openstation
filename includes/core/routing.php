<?php
/**
 * Desktop Mode — request routing helpers.
 *
 * Chromeless / classic admin-bar suppression and the
 * `wp_redirect` filter pair that re-stamps the desktop-mode
 * flags onto server-built redirects. Extracted from the
 * 1,609-LOC `helpers.php` during the architecture-0.8.1 PHP
 * slicing (phase 6).
 *
 * Behaviour is unchanged. Plugins that registered against any of
 * these filters keep working: PHP looks function references up by
 * name at hook-fire time, and `desktop-mode.php` requires this
 * file before `helpers.php`, so the function definitions are
 * always present by the time WordPress wants them.
 *
 * Functions in this file:
 *   - {@see desktop_mode_chromeless_hide_admin_bar()} — `show_admin_bar` filter
 *   - {@see desktop_mode_chromeless_suppress_admin_bar()} — `admin_init` action
 *   - {@see desktop_mode_chromeless_preserve_redirect()} — `wp_redirect` filter
 *   - {@see desktop_mode_classic_preserve_redirect()}    — `wp_redirect` filter
 *   - {@see desktop_mode_is_admin_redirect_target()}     — internal predicate
 *
 * The chromeless / classic *request-detection* helpers
 * (`desktop_mode_is_chromeless_request()`,
 * `desktop_mode_is_classic_request()`) still live in
 * `helpers.php` for now — moving them is the next phase-6 cut.
 *
 * @package Desktop_Mode
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;

/**
 * Disables the admin bar on chromeless (iframe) requests.
 *
 * Hooked on the `show_admin_bar` filter so the front-end bar path
 * also sees a false return. In admin, `is_admin_bar_showing()`
 * short-circuits to true for any `is_admin()` request regardless
 * of this filter, so the actual render is stopped by
 * {@see desktop_mode_chromeless_suppress_admin_bar()} below; this
 * filter is kept for completeness + tests.
 *
 * @since 0.1.0
 *
 * @param bool $show Whether the admin bar should be shown.
 * @return bool
 */
function desktop_mode_chromeless_hide_admin_bar( $show ) {
	if ( desktop_mode_is_chromeless_request() ) {
		return false;
	}
	return $show;
}
add_filter( 'show_admin_bar', 'desktop_mode_chromeless_hide_admin_bar' );

/**
 * Suppresses the admin bar render inside chromeless iframes.
 *
 * `is_admin_bar_showing()` unconditionally returns true in admin
 * context, so the `show_admin_bar` filter alone can't stop
 * `wp_admin_bar_render()` from firing on `in_admin_header`. We
 * detach the render action instead and let chromeless.css hide
 * the `wp-toolbar` padding on `<html>`.
 *
 * @since 0.1.0
 */
function desktop_mode_chromeless_suppress_admin_bar() {
	if ( desktop_mode_is_chromeless_request() ) {
		remove_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
		remove_action( 'wp_body_open', 'wp_admin_bar_render', 0 );
	}
}
add_action( 'admin_init', 'desktop_mode_chromeless_suppress_admin_bar' );

/**
 * Preserves the `desktop_mode_chromeless` flag through admin
 * redirects.
 *
 * A chromeless iframe can be navigated away from chromeless mode
 * by any redirect that drops the query string —
 * `wp_redirect( admin_url( 'edit.php' ) )` after saving a
 * classic-editor post is the canonical example. The client-side
 * form interceptor handles the outgoing request, but the
 * server-built redirect URL is what the browser follows.
 * Re-append the flag here so the landing page stays chromeless
 * and the window doesn't "break out" into a nested admin.
 *
 * Scope is intentionally narrow: only same-site admin URLs are
 * touched, and only when the current request is itself
 * chromeless. Anything else passes through unchanged.
 *
 * @since 0.1.0
 *
 * @param string $location The redirect URL.
 * @return string The redirect URL, with `desktop_mode_chromeless=1` appended when applicable.
 */
function desktop_mode_chromeless_preserve_redirect( $location ) {
	if ( empty( $location ) || ! desktop_mode_is_chromeless_request() ) {
		return $location;
	}

	if ( ! desktop_mode_is_admin_redirect_target( $location ) ) {
		return $location;
	}

	// Don't double-append if the URL already carries the flag.
	if ( false !== strpos( $location, 'desktop_mode_chromeless=' ) ) {
		return $location;
	}

	return add_query_arg( 'desktop_mode_chromeless', '1', $location );
}
add_filter( 'wp_redirect', 'desktop_mode_chromeless_preserve_redirect', 999 );

/**
 * Preserves the `desktop_mode_classic` flag through admin
 * redirects.
 *
 * The detached-tab workflow depends on the classic flag living
 * on every same-tab navigation — otherwise a `wp_redirect()`
 * after saving a post (for instance) would drop it and the very
 * next page would fall back into the desktop shell. The JS
 * interceptor stamps the flag onto every outbound link and form,
 * but it can't touch server-built redirect URLs.
 *
 * Scope mirrors the chromeless preserver: only same-site
 * wp-admin targets, only when the current request is itself a
 * classic-override request, and the flag is never appended
 * twice.
 *
 * @since 0.4.0
 *
 * @param string $location The redirect URL.
 * @return string The redirect URL, with `desktop_mode_classic=1` appended when applicable.
 */
function desktop_mode_classic_preserve_redirect( $location ) {
	if ( empty( $location ) || ! desktop_mode_is_classic_request() ) {
		return $location;
	}

	if ( ! desktop_mode_is_admin_redirect_target( $location ) ) {
		return $location;
	}

	if ( false !== strpos( $location, DESKTOP_MODE_CLASSIC_FLAG . '=' ) ) {
		return $location;
	}

	return add_query_arg( DESKTOP_MODE_CLASSIC_FLAG, '1', $location );
}
add_filter( 'wp_redirect', 'desktop_mode_classic_preserve_redirect', 999 );

/**
 * Whether `$location` is a redirect target that lands inside
 * wp-admin on the current site. Handles all four shapes WP core
 * actually emits:
 *
 *   - Absolute, same-host:    `https://example.com/wp-admin/users.php?...`
 *   - Absolute path:          `/wp-admin/users.php?...`
 *   - Relative to wp-admin:   `users.php?update=add&id=42` (used by
 *                              `user-new.php`, `edit-tags.php`, and
 *                              quite a few other core admin scripts)
 *   - Same-host without path: `?paged=2`
 *
 * Off-site redirects (login → external SSO, e.g.) and frontend
 * redirects (`/`, `/?p=42`) return false so we never paint our
 * query flag on URLs that don't run our admin code.
 *
 * @since 0.8.0
 *
 * @internal
 *
 * @param string $location Raw redirect URL handed to `wp_redirect`.
 * @return bool
 */
function desktop_mode_is_admin_redirect_target( $location ) {
	$location = (string) $location;
	if ( '' === $location ) {
		return false;
	}

	$parts = wp_parse_url( $location );
	if ( false === $parts ) {
		return false;
	}

	// External host? Bail — we don't own that page.
	if ( ! empty( $parts['host'] ) ) {
		$site_host = wp_parse_url( site_url(), PHP_URL_HOST );
		if ( $site_host && 0 !== strcasecmp( (string) $parts['host'], (string) $site_host ) ) {
			return false;
		}
	}

	$path = isset( $parts['path'] ) ? (string) $parts['path'] : '';

	// Absolute path (URL-with-host or leading-slash variant).
	if ( '' !== $path ) {
		// `/wp-admin/foo.php` — definitive admin target.
		if ( false !== strpos( $path, '/wp-admin/' ) ) {
			return true;
		}
		// Absolute path NOT into wp-admin (e.g. `/`, `/wp-login.php`,
		// `/wp-json/...`). Frontend or login flow — leave alone.
		if ( '/' === $path[ 0 ] ) {
			return false;
		}
	}

	// Relative URL (or pure query string). Only safe to treat as
	// an admin target when the redirect was issued from inside
	// wp-admin — that's where wp_redirect( 'users.php?...' )
	// actually resolves to /wp-admin/users.php?... at the
	// browser. is_admin() is the canonical signal.
	return is_admin();
}
