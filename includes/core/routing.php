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
 *   - {@see desktop_mode_url_is_same_admin()}      — same-origin admin URL predicate
 *   - {@see desktop_mode_resolve_admin_target()}   — admin filename → URL resolver
 *   - {@see desktop_mode_admin_target_allowlist()} — wp-admin filename allowlist
 *   - {@see desktop_mode_is_chromeless_request()}  — chromeless request detection
 *   - {@see desktop_mode_is_classic_request()}     — classic-override request detection
 *   - {@see desktop_mode_chromeless_hide_admin_bar()} — `show_admin_bar` filter
 *   - {@see desktop_mode_chromeless_suppress_admin_bar()} — `admin_init` action
 *   - {@see desktop_mode_chromeless_preserve_redirect()} — `wp_redirect` filter
 *   - {@see desktop_mode_classic_preserve_redirect()}    — `wp_redirect` filter
 *   - {@see desktop_mode_is_admin_redirect_target()}     — internal predicate
 *
 * @package Desktop_Mode
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns true when `$url` is a same-origin admin URL.
 *
 * Uses parsed-URL host + path comparison rather than a prefix
 * `strpos` check so `//evil.com/wp-admin/…` or a URL whose
 * normalisation happens to share the admin-URL prefix can't
 * sneak through.
 *
 * An empty string returns false — a missing URL is never
 * "same-origin admin" for the purposes of any caller.
 *
 * @since 0.8.1
 *
 * @param string $url URL to test.
 * @return bool
 */
function desktop_mode_url_is_same_admin( $url ) {
	if ( ! is_string( $url ) || '' === $url ) {
		return false;
	}

	$parts       = wp_parse_url( $url );
	$admin_parts = wp_parse_url( admin_url() );
	if ( ! is_array( $parts ) || ! is_array( $admin_parts ) ) {
		return false;
	}

	// Host comparison is case-insensitive per RFC 3986. Missing
	// host on the tested URL (relative or scheme-only) is a
	// reject — callers should only be handing us fully-qualified
	// URLs.
	$url_host   = isset( $parts['host'] ) ? strtolower( $parts['host'] ) : '';
	$admin_host = isset( $admin_parts['host'] ) ? strtolower( $admin_parts['host'] ) : '';
	if ( '' === $url_host || $url_host !== $admin_host ) {
		return false;
	}

	// Path comparison is case-sensitive. The admin path always
	// ends in `/` (e.g. `/wp-admin/`), so a prefix test is
	// accurate — nothing at `/wp-administrator/…` can match.
	$url_path   = isset( $parts['path'] ) ? $parts['path'] : '';
	$admin_path = isset( $admin_parts['path'] ) ? $admin_parts['path'] : '/wp-admin/';
	return 0 === strpos( $url_path, $admin_path );
}

/**
 * Resolves an admin-page filename (e.g. `edit.php`) to its
 * absolute admin URL, allowlisted against the canonical set of
 * wp-admin top-level filenames.
 *
 * Returns a `WP_Error` when the input contains path traversal,
 * isn't a bare `.php` filename, or points at a file that doesn't
 * exist in the static allowlist. A regex-only check would accept
 * `custom_admin_page.php` if a plugin named something that way;
 * the explicit allowlist closes that.
 *
 * @since 0.8.1
 *
 * @param string $file Bare admin filename (no path, no query string).
 * @return string|WP_Error Absolute admin URL on success, `WP_Error` otherwise.
 */
function desktop_mode_resolve_admin_target( $file ) {
	$file = is_string( $file ) ? trim( $file ) : '';
	if ( '' === $file ) {
		return new WP_Error(
			'desktop_mode_empty_target',
			__( 'Admin target cannot be empty.', 'desktop-mode' )
		);
	}

	if ( false !== strpos( $file, '..' ) || false !== strpos( $file, '/' ) || false !== strpos( $file, '\\' ) ) {
		return new WP_Error(
			'desktop_mode_invalid_target',
			__( 'Admin target contains invalid path characters.', 'desktop-mode' )
		);
	}

	// Lowercase match mirrors WP's filesystem assumptions on
	// case-insensitive volumes (macOS, Windows). The allowlist
	// below is the final arbiter; this regex just pre-filters
	// clearly bad inputs cheaply.
	if ( ! preg_match( '/^[a-z0-9_-]+\.php$/i', $file ) ) {
		return new WP_Error(
			'desktop_mode_invalid_target',
			__( 'Admin target must be a plain .php filename.', 'desktop-mode' )
		);
	}

	if ( ! in_array( strtolower( $file ), desktop_mode_admin_target_allowlist(), true ) ) {
		return new WP_Error(
			'desktop_mode_unknown_target',
			__( 'Admin target does not exist.', 'desktop-mode' )
		);
	}

	return admin_url( $file );
}

/**
 * Returns the allowlist of canonical wp-admin top-level
 * filenames that {@see desktop_mode_resolve_admin_target()}
 * accepts.
 *
 * Hardcoded rather than read from disk so the plugin doesn't
 * depend on a particular WordPress install layout (and doesn't
 * reference `ABSPATH` to probe core files). Plugins that ship
 * their own top-level admin pages (rare) can extend the list
 * via the filter.
 *
 * @since 0.6.2
 *
 * @return string[] Lowercased filenames including extension.
 */
function desktop_mode_admin_target_allowlist() {
	$files = array(
		'about.php',
		'admin-ajax.php',
		'admin-footer.php',
		'admin-header.php',
		'admin-post.php',
		'admin.php',
		'async-upload.php',
		'authorize-application.php',
		'comment.php',
		'credits.php',
		'custom-background.php',
		'custom-header.php',
		'customize.php',
		'edit-comments.php',
		'edit-form-advanced.php',
		'edit-form-blocks.php',
		'edit-form-comment.php',
		'edit-link-form.php',
		'edit-tag-form.php',
		'edit-tags.php',
		'edit.php',
		'erase-personal-data.php',
		'export-personal-data.php',
		'export.php',
		'freedoms.php',
		'import.php',
		'index.php',
		'install.php',
		'link-add.php',
		'link-manager.php',
		'link.php',
		'load-scripts.php',
		'load-styles.php',
		'media-new.php',
		'media-upload.php',
		'media.php',
		'menu-header.php',
		'menu.php',
		'moderation.php',
		'ms-admin.php',
		'ms-delete-site.php',
		'ms-edit.php',
		'ms-options.php',
		'ms-sites.php',
		'ms-themes.php',
		'ms-upgrade-network.php',
		'ms-users.php',
		'my-sites.php',
		'nav-menus.php',
		'network.php',
		'options-discussion.php',
		'options-general.php',
		'options-head.php',
		'options-media.php',
		'options-permalink.php',
		'options-privacy.php',
		'options-reading.php',
		'options-writing.php',
		'options.php',
		'plugin-editor.php',
		'plugin-install.php',
		'plugins.php',
		'post-new.php',
		'post.php',
		'press-this.php',
		'privacy-policy-guide.php',
		'privacy.php',
		'profile.php',
		'revision.php',
		'setup-config.php',
		'site-editor.php',
		'site-health-info.php',
		'site-health.php',
		'sidebar.php',
		'term.php',
		'theme-editor.php',
		'theme-install.php',
		'themes.php',
		'tools.php',
		'update-core.php',
		'update.php',
		'upgrade.php',
		'upload.php',
		'user-edit.php',
		'user-new.php',
		'users.php',
		'widgets.php',
	);

	/**
	 * Filters the wp-admin filename allowlist used when resolving
	 * portal `target=` query args.
	 *
	 * @since 0.6.2
	 *
	 * @param string[] $files Default allowlist.
	 */
	$files = (array) apply_filters( 'desktop_mode_admin_target_allowlist', $files );

	return array_values( array_unique( array_map( 'strtolower', array_filter( $files, 'is_string' ) ) ) );
}

/**
 * Checks whether the current request is a chromeless request.
 *
 * Chromeless requests are admin pages loaded inside desktop-mode
 * windows (iframes). They render only the page content without
 * the admin shell (sidebar, admin bar, footer).
 *
 * @since 0.1.0
 *
 * @return bool True if this is a chromeless (iframe) request.
 */
function desktop_mode_is_chromeless_request() {
	if ( ! desktop_mode_is_enabled() ) {
		// Only allow chromeless mode if the user actually has
		// desktop mode enabled. Prevents stripping admin chrome via
		// a bare `?desktop_mode_chromeless=1` parameter from a
		// logged-out URL.
		return false;
	}

	// Primary signal — the explicit query flag the parent shell
	// adds when opening windows.
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only request flag, no state change.
	if ( ! empty( $_GET['desktop_mode_chromeless'] ) && '1' === sanitize_text_field( wp_unslash( $_GET['desktop_mode_chromeless'] ) ) ) {
		return true;
	}

	// Fallback signal — the request is a same-origin iframe load.
	// Modern browsers (Chrome 80+, Firefox 90+, Safari 16.4+) send
	// the `Sec-Fetch-*` headers reliably, and they are immune to
	// JavaScript spoofing (the browser sets them itself).
	//
	// This catches the failure mode where an internal admin
	// navigation drops the `?desktop_mode_chromeless=1` query flag —
	// Gutenberg's `window.location` assignments, meta-refresh
	// redirects, or any link the inline rewriter missed. The user
	// is in an iframe on the same origin, has desktop mode enabled,
	// so render as chromeless.
	//
	// `Sec-Fetch-Site: same-origin` is the cross-origin guard so a
	// foreign site that iframes the wp-admin page can't trick us
	// into stripping the chrome — the user agent reports the
	// embedding context honestly.
	$fetch_dest = isset( $_SERVER['HTTP_SEC_FETCH_DEST'] )
		? sanitize_text_field( wp_unslash( $_SERVER['HTTP_SEC_FETCH_DEST'] ) )
		: '';
	$fetch_site = isset( $_SERVER['HTTP_SEC_FETCH_SITE'] )
		? sanitize_text_field( wp_unslash( $_SERVER['HTTP_SEC_FETCH_SITE'] ) )
		: '';
	if ( 'iframe' === $fetch_dest && 'same-origin' === $fetch_site ) {
		/**
		 * Filter the Sec-Fetch fallback. Return false to require an
		 * explicit `?desktop_mode_chromeless=1` flag (matches
		 * pre-0.18 behaviour); useful for environments where a
		 * reverse proxy strips the `Sec-Fetch-*` headers and they
		 * can't be trusted.
		 *
		 * @since 0.8.1
		 *
		 * @param bool $allow Default true.
		 */
		return (bool) apply_filters( 'desktop_mode_chromeless_sec_fetch_fallback', true );
	}

	return false;
}

/**
 * Checks whether the current request carries the "classic
 * override" flag.
 *
 * The window-chrome "Detach" action opens an admin page in a new
 * browser tab with `?desktop_mode_classic=1` so the user can view
 * that one page outside the desktop shell without disabling
 * desktop mode account-wide. The flag is a per-request override:
 * `desktop_mode_is_enabled()` still returns true (the user's
 * preference hasn't changed), but the shell, shell assets, and
 * body class are skipped for this request so the classic admin
 * renders normally.
 *
 * Keep this separate from `desktop_mode_is_enabled()` so the
 * admin-bar toggle in the detached tab correctly reflects the
 * account state — letting the user disable desktop mode entirely
 * from the tab if they want to.
 *
 * @since 0.4.0
 *
 * @return bool True if the request carries `?desktop_mode_classic=1`.
 */
function desktop_mode_is_classic_request() {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only request flag.
	if ( empty( $_GET[ DESKTOP_MODE_CLASSIC_FLAG ] ) ) {
		return false;
	}
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only request flag.
	return '1' === sanitize_text_field( wp_unslash( $_GET[ DESKTOP_MODE_CLASSIC_FLAG ] ) );
}

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
 * Detaches core's update / maintenance nags inside chromeless iframes so
 * they don't repeat in every window — the shell surfaces the update once
 * instead.
 *
 * @since 0.9.4
 */
function desktop_mode_chromeless_suppress_update_nags() {
	if ( ! desktop_mode_is_chromeless_request() ) {
		return;
	}
	remove_action( 'admin_notices', 'update_nag', 3 );
	remove_action( 'network_admin_notices', 'update_nag', 3 );
	remove_action( 'admin_notices', 'maintenance_nag', 10 );
	remove_action( 'network_admin_notices', 'maintenance_nag', 10 );
}
add_action( 'admin_init', 'desktop_mode_chromeless_suppress_update_nags' );

/**
 * Detaches the remaining global core admin notices inside chromeless iframes
 * so they don't repeat in every window — the shell re-derives and surfaces
 * each once (see `desktop_mode_get_core_notices()`). The update / maintenance
 * nags are handled by `desktop_mode_chromeless_suppress_update_nags()`.
 *
 * @since 0.9.6
 */
function desktop_mode_chromeless_suppress_core_notices() {
	if ( ! desktop_mode_is_chromeless_request() ) {
		return;
	}
	remove_action( 'admin_notices', 'wp_recovery_mode_nag', 1 );
	remove_action( 'admin_notices', 'default_password_nag' );
	remove_action( 'admin_notices', 'deactivated_plugins_notice', 5 );
	remove_action( 'admin_notices', 'paused_plugins_notice', 5 );
	remove_action( 'admin_notices', 'paused_themes_notice', 5 );
}
add_action( 'admin_init', 'desktop_mode_chromeless_suppress_core_notices' );

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
