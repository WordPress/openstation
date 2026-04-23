<?php
/**
 * Desktop Mode helper functions.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Checks whether the current user has desktop mode enabled.
 *
 * @since 0.1.0
 *
 * @return bool True if the current user has desktop mode active.
 */
function wpdm_is_enabled() {
	if ( ! is_user_logged_in() ) {
		return false;
	}

	return '1' === get_user_meta( get_current_user_id(), 'wp_desktop_mode', true );
}

/**
 * Disables the admin bar on chromeless (iframe) requests.
 *
 * Hooked on the `show_admin_bar` filter so the front-end bar path also
 * sees a false return. In admin, `is_admin_bar_showing()` short-circuits
 * to true for any is_admin() request regardless of this filter, so the
 * actual render is stopped by `wpdm_chromeless_suppress_admin_bar`
 * below; this filter is kept for completeness + tests.
 *
 * @since 0.1.0
 *
 * @param bool $show Whether the admin bar should be shown.
 * @return bool
 */
function wpdm_chromeless_hide_admin_bar( $show ) {
	if ( wpdm_is_chromeless_request() ) {
		return false;
	}
	return $show;
}
add_filter( 'show_admin_bar', 'wpdm_chromeless_hide_admin_bar' );

/**
 * Suppresses the admin bar render inside chromeless iframes.
 *
 * `is_admin_bar_showing()` unconditionally returns true in admin context,
 * so the `show_admin_bar` filter alone can't stop `wp_admin_bar_render()`
 * from firing on `in_admin_header`. We detach the render action instead
 * and let chromeless.css hide the `wp-toolbar` padding on `<html>`.
 *
 * @since 0.1.0
 */
function wpdm_chromeless_suppress_admin_bar() {
	if ( wpdm_is_chromeless_request() ) {
		remove_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
		remove_action( 'wp_body_open', 'wp_admin_bar_render', 0 );
	}
}
add_action( 'admin_init', 'wpdm_chromeless_suppress_admin_bar' );

/**
 * Preserves the `wp_desktop` flag through admin redirects.
 *
 * A chromeless iframe can be navigated away from chromeless mode by any
 * redirect that drops the query string — `wp_redirect( admin_url( 'edit.php' ) )`
 * after saving a classic-editor post is the canonical example. The client-side
 * form interceptor handles the outgoing request, but the server-built redirect
 * URL is what the browser follows. Re-append the flag here so the landing page
 * stays chromeless and the window doesn't "break out" into a nested admin.
 *
 * Scope is intentionally narrow: only same-site admin URLs are touched, and
 * only when the current request is itself chromeless. Anything else passes
 * through unchanged.
 *
 * @since 0.1.0
 *
 * @param string $location The redirect URL.
 * @return string The redirect URL, with `wp_desktop=1` appended when applicable.
 */
function wpdm_chromeless_preserve_redirect( $location ) {
	if ( empty( $location ) || ! wpdm_is_chromeless_request() ) {
		return $location;
	}

	// Only rewrite redirects that land inside wp-admin.
	if ( false === strpos( $location, '/wp-admin/' ) ) {
		return $location;
	}

	// Don't double-append if the URL already carries the flag.
	if ( false !== strpos( $location, 'wp_desktop=' ) ) {
		return $location;
	}

	return add_query_arg( 'wp_desktop', '1', $location );
}
add_filter( 'wp_redirect', 'wpdm_chromeless_preserve_redirect', 999 );

/**
 * Preserves the `wp_desktop_classic` flag through admin redirects.
 *
 * The detached-tab workflow depends on the classic flag living on every
 * same-tab navigation — otherwise a `wp_redirect()` after saving a post
 * (for instance) would drop it and the very next page would fall back
 * into the desktop shell. The JS interceptor stamps the flag onto every
 * outbound link and form, but it can't touch server-built redirect URLs.
 *
 * Scope mirrors the chromeless preserver: only same-site wp-admin
 * targets, only when the current request is itself a classic-override
 * request, and the flag is never appended twice.
 *
 * @since 0.4.0
 *
 * @param string $location The redirect URL.
 * @return string The redirect URL, with `wp_desktop_classic=1` appended when applicable.
 */
function wpdm_classic_preserve_redirect( $location ) {
	if ( empty( $location ) || ! wpdm_is_classic_request() ) {
		return $location;
	}

	if ( false === strpos( $location, '/wp-admin/' ) ) {
		return $location;
	}

	if ( false !== strpos( $location, WPDM_CLASSIC_FLAG . '=' ) ) {
		return $location;
	}

	return add_query_arg( WPDM_CLASSIC_FLAG, '1', $location );
}
add_filter( 'wp_redirect', 'wpdm_classic_preserve_redirect', 999 );

/**
 * Checks whether the current request is a chromeless request.
 *
 * Chromeless requests are admin pages loaded inside desktop mode
 * windows (iframes). They render only the page content without
 * the admin shell (sidebar, admin bar, footer).
 *
 * @since 0.1.0
 *
 * @return bool True if this is a chromeless (iframe) request.
 */
function wpdm_is_chromeless_request() {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only request flag, no state change.
	if ( empty( $_GET['wp_desktop'] ) || '1' !== wp_unslash( $_GET['wp_desktop'] ) ) {
		return false;
	}

	// Only allow chromeless mode if the user actually has desktop mode enabled.
	// This prevents stripping admin chrome via a bare ?wp_desktop=1 parameter.
	return wpdm_is_enabled();
}

/**
 * Checks whether the current request carries the "classic override" flag.
 *
 * The window-chrome "Detach" action opens an admin page in a new browser tab
 * with `?wp_desktop_classic=1` so the user can view that one page outside the
 * desktop shell without disabling desktop mode account-wide. The flag is a
 * per-request override: `wpdm_is_enabled()` still returns true (the user's
 * preference hasn't changed), but the shell, shell assets, and body class are
 * skipped for this request so the classic admin renders normally.
 *
 * Keep this separate from `wpdm_is_enabled()` so the admin-bar toggle in
 * the detached tab correctly reflects the account state — letting the user
 * disable desktop mode entirely from the tab if they want to.
 *
 * @since 0.4.0
 *
 * @return bool True if the request carries `?wp_desktop_classic=1`.
 */
function wpdm_is_classic_request() {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only request flag.
	if ( empty( $_GET[ WPDM_CLASSIC_FLAG ] ) ) {
		return false;
	}
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only request flag.
	return '1' === (string) wp_unslash( $_GET[ WPDM_CLASSIC_FLAG ] );
}

/**
 * Returns the default wallpaper id used when a user has no saved
 * selection (or their saved selection was unregistered by a plugin
 * deactivation).
 *
 * Exposed as a filter so themes/plugins can set a site-wide default
 * without forking the TS build.
 *
 * ```php
 * add_filter( 'wp_desktop_default_wallpaper', function () {
 *     return 'my-plugin/brand';
 * } );
 * ```
 *
 * The returned string is passed through `sanitize_key()` so a filter
 * that returns an invalid slug degrades to the empty string (and the
 * shell falls back to its hard-coded `'dark'` preset).
 *
 * @since 0.11.0
 *
 * @return string Wallpaper id. Empty string if the filter returns
 *                an invalid value.
 */
function wpdm_get_default_wallpaper() {
	/**
	 * Filters the wallpaper id loaded on first boot / new user.
	 *
	 * @since 0.11.0
	 *
	 * @param string $id Default wallpaper slug.
	 */
	$id = apply_filters( 'wp_desktop_default_wallpaper', 'dark' );
	if ( ! is_string( $id ) ) {
		return '';
	}
	return sanitize_key( $id );
}

/**
 * Build a `WP_Error` for a desktop-mode registration failure.
 *
 * Centralises the error-code vocabulary used by every
 * `wp_register_desktop_*()` function so plugin authors see a
 * consistent contract. The canonical error-code list lives in
 * `docs/hooks-reference.md`.
 *
 * @since 0.11.0
 *
 * @param string $code    Short error slug (e.g. `wp_desktop_missing_title`).
 * @param string $message Human-readable message. Should be translated.
 * @param array  $data    Optional extra context attached to the error.
 * @return WP_Error
 */
function wpdm_registration_error( $code, $message, $data = array() ) {
	return new WP_Error(
		(string) $code,
		(string) $message,
		is_array( $data ) ? $data : array()
	);
}

/**
 * Returns true when `$url` is a same-origin admin URL.
 *
 * Uses parsed-URL host + path comparison rather than a prefix `strpos`
 * check so `//evil.com/wp-admin/…` or an URL whose normalization
 * happens to share the admin-URL prefix can't sneak through.
 *
 * An empty string returns false — a missing URL is never "same-origin
 * admin" for the purposes of any caller.
 *
 * @since 0.11.0
 *
 * @param string $url URL to test.
 * @return bool
 */
function wpdm_url_is_same_admin( $url ) {
	if ( ! is_string( $url ) || '' === $url ) {
		return false;
	}

	$parts       = wp_parse_url( $url );
	$admin_parts = wp_parse_url( admin_url() );
	if ( ! is_array( $parts ) || ! is_array( $admin_parts ) ) {
		return false;
	}

	// Host comparison is case-insensitive per RFC 3986. Missing host on
	// the tested URL (relative or scheme-only) is a reject — callers
	// should only be handing us fully-qualified URLs.
	$url_host   = isset( $parts['host'] ) ? strtolower( $parts['host'] ) : '';
	$admin_host = isset( $admin_parts['host'] ) ? strtolower( $admin_parts['host'] ) : '';
	if ( '' === $url_host || $url_host !== $admin_host ) {
		return false;
	}

	// Path comparison is case-sensitive. The admin path always ends in
	// `/` (e.g. `/wp-admin/`), so a prefix test is accurate — nothing
	// at `/wp-administrator/…` can match.
	$url_path   = isset( $parts['path'] ) ? $parts['path'] : '';
	$admin_path = isset( $admin_parts['path'] ) ? $admin_parts['path'] : '/wp-admin/';
	return 0 === strpos( $url_path, $admin_path );
}

/**
 * Resolves an admin-page filename (e.g. `edit.php`) to its absolute
 * admin URL, whitelisted against the actual `wp-admin/` directory.
 *
 * Returns a `WP_Error` when the input contains path traversal, isn't a
 * bare `.php` filename, or points at a file that doesn't exist in
 * `ABSPATH . 'wp-admin/'`. The existence check is the key guard — a
 * regex-only whitelist would accept `custom_admin_page.php` if a plugin
 * named something that way, but only files that actually ship in
 * wp-admin are safe redirect targets.
 *
 * @since 0.11.0
 *
 * @param string $file Bare admin filename (no path, no query string).
 * @return string|WP_Error Absolute admin URL on success, `WP_Error` otherwise.
 */
function wpdm_resolve_admin_target( $file ) {
	$file = is_string( $file ) ? trim( $file ) : '';
	if ( '' === $file ) {
		return new WP_Error( 'wp_desktop_empty_target', __( 'Admin target cannot be empty.', 'wp-desktop-mode' ) );
	}

	if ( false !== strpos( $file, '..' ) || false !== strpos( $file, '/' ) || false !== strpos( $file, '\\' ) ) {
		return new WP_Error( 'wp_desktop_invalid_target', __( 'Admin target contains invalid path characters.', 'wp-desktop-mode' ) );
	}

	// Lowercase match mirrors WP's filesystem assumptions on case-
	// insensitive volumes (macOS, Windows). The actual file_exists
	// check below is the final arbiter; this regex just pre-filters
	// clearly bad inputs.
	if ( ! preg_match( '/^[a-z0-9_-]+\.php$/i', $file ) ) {
		return new WP_Error( 'wp_desktop_invalid_target', __( 'Admin target must be a plain .php filename.', 'wp-desktop-mode' ) );
	}

	$candidate = ABSPATH . 'wp-admin/' . $file;
	if ( ! file_exists( $candidate ) ) {
		return new WP_Error( 'wp_desktop_unknown_target', __( 'Admin target does not exist.', 'wp-desktop-mode' ) );
	}

	return admin_url( $file );
}

/**
 * Builds the dock items array from the admin menu data.
 *
 * Iterates through the global $menu and $submenu arrays, filters out
 * separators and items the current user can't access, and returns a
 * clean array of dock items ready for JSON serialization.
 *
 * @since 0.1.0
 *
 * @return array[] Array of dock item arrays, each containing:
 *                 id, title, icon, url, badge, submenu.
 */
function wpdm_build_dock_items() {
	global $menu, $submenu;

	if ( empty( $menu ) ) {
		return array();
	}

	$items = array();

	foreach ( $menu as $item ) {
		// Skip separators.
		if ( ! empty( $item[4] ) && false !== strpos( $item[4], 'wp-menu-separator' ) ) {
			continue;
		}

		// Skip items without a slug.
		if ( empty( $item[2] ) ) {
			continue;
		}

		// Check capability.
		if ( ! empty( $item[1] ) && ! current_user_can( $item[1] ) ) {
			continue;
		}

		// Extract the clean title: strip badge spans first, then strip remaining tags.
		$raw_title = preg_replace( '/<span[^>]*>.*?<\/span>/s', '', $item[0] );
		$title     = trim( wp_strip_all_tags( $raw_title ) );

		// Extract badge count from the title HTML.
		$badge = 0;
		if ( preg_match( '/class="(?:update-plugins|awaiting-mod)[^"]*count-(\d+)"/', $item[0], $matches ) ) {
			$badge = (int) $matches[1];
		}

		// Determine the icon. Menu entries can set `$item[6]` to anything
		// — a dashicon class, a remote URL, a data:URI, 'none', or 'div'
		// — so normalize before we serialize it for the shell JS.
		$icon = wpdm_sanitize_dock_icon( $item[6] ?? '' );

		// Build the full URL for the menu item.
		$url = wpdm_menu_item_url( $item[2] );

		// Build submenu items.
		$sub_items = array();
		if ( ! empty( $submenu[ $item[2] ] ) ) {
			foreach ( $submenu[ $item[2] ] as $sub_item ) {
				if ( ! empty( $sub_item[1] ) && ! current_user_can( $sub_item[1] ) ) {
					continue;
				}
				// Skip items with hide-if classes.
				if ( ! empty( $sub_item[4] ) && false !== strpos( $sub_item[4], 'hide-if-no-customize' ) ) {
					continue;
				}
				$sub_raw_title = preg_replace( '/<span[^>]*>.*?<\/span>/s', '', $sub_item[0] );
				$sub_items[]   = array(
					'title' => trim( wp_strip_all_tags( $sub_raw_title ) ),
					'url'   => wpdm_menu_item_url( $sub_item[2] ),
				);
			}
		}

		$dock_item = array(
			'id'        => sanitize_key( $item[5] ?? $item[2] ),
			'title'     => $title,
			'icon'      => $icon,
			'url'       => $url,
			'badge'     => $badge,
			'submenu'   => $sub_items,
			'multi'     => wpdm_dock_item_is_multi( $item[2] ),
			'placement' => wpdm_dock_placement( $item[2] ),
		);

		/**
		 * Filters a single dock item's data.
		 *
		 * @since 0.1.0
		 *
		 * @param array  $dock_item The dock item data.
		 * @param string $menu_slug The menu slug.
		 */
		$dock_item = apply_filters( 'wp_desktop_dock_item', $dock_item, $item[2] );

		$items[] = $dock_item;
	}

	/**
	 * Filters the dock items before they are passed to JavaScript.
	 *
	 * @since 0.1.0
	 *
	 * @param array[] $items Array of dock item arrays.
	 */
	return apply_filters( 'wp_desktop_dock_items', $items );
}

/**
 * Sanitizes a dock icon value for safe injection into the shell JS.
 *
 * Menu items can set their icon to one of:
 *
 *   - A Dashicons class (e.g. `dashicons-admin-post`)
 *   - An http/https URL pointing at an image asset
 *   - `'none'` or `'div'` (CSS hooks, no icon asset)
 *
 * Anything else — `javascript:` URIs, `data:` URIs (even benign-looking
 * `image/svg+xml` ones, which can carry inline scripts that execute
 * when rendered as a CSS background), inline event handlers, or raw
 * HTML — is rejected and replaced with the generic fallback. The
 * return value is always a string that is safe to drop into an
 * `img.src` or a CSS class without further escaping.
 *
 * @since 0.4.0
 * @since 0.11.0 Rejects `data:` URIs outright; previously accepted
 *               `data:image/svg+xml` values.
 *
 * @param mixed $icon Raw icon value from the menu registration.
 * @return string Sanitized icon string.
 */
function wpdm_sanitize_dock_icon( $icon ) {
	$fallback = 'dashicons-admin-generic';
	if ( ! is_string( $icon ) || '' === $icon ) {
		return $fallback;
	}

	$icon = trim( $icon );

	// 'none' and 'div' tell WordPress to render an empty div for the
	// admin-menu icon (the plugin styles it from CSS). We pass the
	// fallback through; the JS dock has a getComputedStyle-based
	// extractor that pulls the real icon from the hidden #adminmenu
	// for these cases.
	if ( 'none' === $icon || 'div' === $icon ) {
		return $fallback;
	}

	if ( 0 === strpos( $icon, 'dashicons-' ) ) {
		// Allow only the safe subset of characters a Dashicons class can
		// contain — prevents class-attribute break-out via spaces or
		// quotes if a plugin registers a malicious "dashicons-…" value.
		return preg_replace( '/[^a-z0-9_-]/', '', $icon );
	}

	// SVG data URI — the JS dock renders these as CSS background-image,
	// which does NOT execute script in any currently shipping browser
	// (Chrome/Firefox/Safari all treat SVG-in-CSS-background as an
	// image-only context since ~2017). Strict validation on the base64
	// payload prevents anything other than proper base64 from reaching
	// the DOM; any other data:* scheme (javascript:, text/html, etc.)
	// is rejected outright by the prefix check.
	$svg_prefix = 'data:image/svg+xml;base64,';
	if ( 0 === stripos( $icon, $svg_prefix ) ) {
		$payload = substr( $icon, strlen( $svg_prefix ) );
		if ( preg_match( '/^[A-Za-z0-9+\/=]+$/', $payload ) ) {
			return $icon;
		}
		return $fallback;
	}

	// http/https URL — the icon is a hosted image.
	if ( 0 === stripos( $icon, 'http://' ) || 0 === stripos( $icon, 'https://' ) ) {
		$clean = esc_url_raw( $icon, array( 'http', 'https' ) );
		return $clean ? $clean : $fallback;
	}

	return $fallback;
}

/**
 * Decides whether a given admin page should support multiple open windows.
 *
 * List-style screens (Posts, Pages, custom post types, Media, Users,
 * Comments, taxonomy terms) often benefit from being open more than once:
 * a writer may want to read one post while drafting another, compare two
 * users side-by-side, pick media from one window and drop it into a draft
 * in another. Singleton-ish screens (Dashboard, Settings, Tools, Profile)
 * have a single logical state — opening two makes no sense.
 *
 * The default rule matches the base filename of the menu slug against a
 * known list. Plugin authors can override via the
 * `wp_desktop_dock_item_multi` filter to mark any custom page as multi
 * (or force a stock list page into singleton mode).
 *
 * @since 0.5.0
 *
 * @param string $menu_slug The raw menu slug (e.g. `edit.php`, `upload.php`,
 *                          or `my-plugin-page`). Query strings are preserved
 *                          so `edit.php?post_type=page` resolves correctly.
 * @return bool True if this page supports multiple simultaneous windows.
 */
function wpdm_dock_item_is_multi( $menu_slug ) {
	// Multi-capable admin files. Match by the base file regardless of
	// any query string (post_type, taxonomy, page, paged, etc.) so every
	// CPT and every taxonomy inherits the same rule as their parent.
	$multi_files = array(
		'edit.php',
		'edit-tags.php',
		'upload.php',
		'users.php',
		'edit-comments.php',
	);

	$base = strtok( (string) $menu_slug, '?' );
	$multi = in_array( $base, $multi_files, true );

	/**
	 * Filters whether a dock item supports multiple open windows.
	 *
	 * Return true to let the user open more than one window of this page.
	 * A "+" affordance appears on the dock icon and a "Open another" action
	 * becomes available in the window's title-bar menu. Singletons (false)
	 * always focus the existing window when re-opened.
	 *
	 * @since 0.5.0
	 *
	 * @param bool   $multi     Whether this page is multi-capable.
	 * @param string $menu_slug The menu slug (e.g. `edit.php?post_type=page`).
	 */
	return (bool) apply_filters( 'wp_desktop_dock_item_multi', $multi, $menu_slug );
}

/**
 * Returns true when `$menu_slug` maps to a first-party WordPress
 * Core admin menu item (Dashboard, Posts, Pages, Media, Settings,
 * etc.), false otherwise — the caller uses the answer to route the
 * item to the left dock (core) vs the bottom taskbar (plugin).
 *
 * The rule:
 *
 *   1. Any known core admin filename (index.php, edit.php, upload.php,
 *      themes.php, plugins.php, users.php, tools.php, options-*.php,
 *      edit-comments.php, etc.) is Core.
 *   2. Any Custom Post Type route (`edit.php?post_type=…`) is Core —
 *      CPTs are content-oriented even when a plugin registers them,
 *      so they belong next to Posts / Pages in the dock.
 *   3. Every `admin.php?page=*` route is Plugin — that's WP's
 *      universal "a plugin registered its own top-level admin route"
 *      signal.
 *   4. Anything else is treated as Plugin (safer default — plugins
 *      with custom top-level files can still opt in via the filter
 *      below).
 *
 * Plugins + site admins can override any answer via
 * `wp_desktop_dock_placement`:
 *
 * ```php
 * // Keep Jetpack on the left dock:
 * add_filter( 'wp_desktop_dock_placement', function ( $placement, $slug ) {
 *     return 'jetpack' === $slug ? 'dock' : $placement;
 * }, 10, 2 );
 * ```
 *
 * @since 0.9.0
 *
 * @param string $menu_slug Menu item slug (e.g. `edit.php`, `edit.php?post_type=foo`, `woocommerce`).
 * @return bool True when the slug is a core admin page.
 */
function wpdm_is_core_menu_slug( $menu_slug ) {
	$slug = (string) $menu_slug;
	$base = strtok( $slug, '?' );

	// Known top-level core admin files. Stable across WP versions —
	// additions happen maybe once a release, removals almost never.
	$core_files = array(
		'index.php',              // Dashboard
		'edit.php',               // Posts (+ CPTs via ?post_type=)
		'edit-comments.php',      // Comments
		'upload.php',             // Media
		'edit-tags.php',          // Taxonomies
		'term.php',               // Single-term edit
		'post-new.php',           // New post form
		'post.php',               // Edit-post form
		'themes.php',             // Appearance
		'nav-menus.php',          // Menus (Appearance > Menus)
		'widgets.php',            // Widgets (Appearance > Widgets)
		'customize.php',          // Customizer
		'plugins.php',            // Plugins
		'plugin-install.php',     // Plugins > Add New
		'plugin-editor.php',      // Plugins > Editor
		'users.php',              // Users
		'user-new.php',           // Users > Add New
		'profile.php',            // Profile
		'user-edit.php',          // Edit another user
		'tools.php',              // Tools
		'import.php',             // Tools > Import
		'export.php',             // Tools > Export
		'site-health.php',        // Tools > Site Health
		'export-personal-data.php',
		'erase-personal-data.php',
		'options-general.php',    // Settings
		'options-writing.php',    // Settings > Writing
		'options-reading.php',    // Settings > Reading
		'options-discussion.php', // Settings > Discussion
		'options-media.php',      // Settings > Media
		'options-permalink.php',  // Settings > Permalinks
		'options-privacy.php',    // Settings > Privacy
		'link-manager.php',       // Link manager (legacy)
		'update-core.php',        // Dashboard > Updates
	);

	return in_array( $base, $core_files, true );
}

/**
 * Resolve the dock placement for a given menu slug. Returns one of
 * three values:
 *
 *   - `'dock'`    — render on the left-edge rail (default for core
 *                   WordPress pages: Dashboard, Posts, Plugins,
 *                   Users, Settings, CPTs, taxonomies, …).
 *   - `'taskbar'` — render on the bottom-edge taskbar (default for
 *                   everything else — installed plugins routed
 *                   through `admin.php?page=*`).
 *   - `'hidden'`  — don't render this item anywhere in the desktop
 *                   shell. The underlying admin menu entry still
 *                   exists server-side; this only affects dock /
 *                   taskbar rendering.
 *
 * Plugins + site admins can override any answer via the
 * `wp_desktop_dock_placement` filter. A plugin that wants to
 * completely opt out of the shell chrome (e.g. a utility plugin that
 * only registers sub-screens and shouldn't take up a tile) returns
 * `'hidden'` for its slug; one that wants first-class billing
 * returns `'dock'`; the default returns `'taskbar'`.
 *
 * @since 0.9.0
 *
 * @param string $menu_slug The menu slug (e.g. `edit.php`, `woocommerce`).
 * @return string `'dock'`, `'taskbar'`, or `'hidden'`.
 */
function wpdm_dock_placement( $menu_slug ) {
	$placement = wpdm_is_core_menu_slug( $menu_slug ) ? 'dock' : 'taskbar';

	/**
	 * Filter the dock placement for a specific menu item.
	 *
	 * Return `'dock'` to show the item in the left-edge core dock,
	 * `'taskbar'` to show it in the bottom plugin taskbar, or
	 * `'hidden'` to suppress it from both rails entirely. Any other
	 * value coerces to the default heuristic answer — a defensive
	 * guard so a misbehaving filter can't corrupt the split with
	 * `null` / `false` / arbitrary strings.
	 *
	 * @since 0.9.0
	 *
	 * @param string $placement Default placement — `'dock'` for core
	 *                          items, `'taskbar'` for everything else.
	 * @param string $menu_slug The menu slug triggering the lookup.
	 */
	$filtered = apply_filters( 'wp_desktop_dock_placement', $placement, $menu_slug );
	if ( 'dock' === $filtered || 'taskbar' === $filtered || 'hidden' === $filtered ) {
		return $filtered;
	}
	return $placement;
}

/**
 * Assemble the split menu payload consumed by the shell.
 *
 * Runs the full dock-builder, then partitions the items into the two
 * rails by each item's `placement` key. Items with `placement` of
 * `'hidden'` are dropped entirely — plugins that want to stay out of
 * the desktop chrome (either because they're background-only tools
 * or because they own their own surface) filter themselves to
 * `'hidden'` and disappear from both rails without their server-side
 * menu entry going away.
 *
 * Returns the same shape the boot-time shell config exposes as
 * `dockItems` + `taskbarItems`, so the client can swap the `config`
 * values in place after a live refresh (e.g. after plugin activation
 * / deactivation).
 *
 * Extracted out of `includes/render.php` so both the initial PHP
 * localize AND the `/wp-desktop/v1/menu` REST endpoint read from a
 * single source of truth — any drift would desync the live refresh.
 *
 * @since 0.9.0
 *
 * @return array{dockItems: array[], taskbarItems: array[]} Split payload.
 */
function wpdm_build_menu_payload() {
	$all = wpdm_build_dock_items();

	// Hidden items disappear from both rails. The partition below
	// only ever sees visible items.
	$visible = array_values(
		array_filter(
			$all,
			static function ( $item ) {
				return 'hidden' !== ( $item['placement'] ?? 'dock' );
			}
		)
	);

	$dock = array_values(
		array_filter(
			$visible,
			static function ( $item ) {
				return 'taskbar' !== ( $item['placement'] ?? 'dock' );
			}
		)
	);

	$taskbar = array_values(
		array_filter(
			$visible,
			static function ( $item ) {
				return 'taskbar' === ( $item['placement'] ?? 'dock' );
			}
		)
	);

	return array(
		'dockItems'        => $dock,
		'taskbarItems'     => $taskbar,
		'nativeWindows'    => wpdm_build_native_windows_payload(),
		'serverWidgets'    => function_exists( 'wpdm_build_desktop_widgets_payload' )
			? wpdm_build_desktop_widgets_payload()
			: array(),
		'serverWallpapers' => function_exists( 'wpdm_build_desktop_wallpapers_payload' )
			? wpdm_build_desktop_wallpapers_payload()
			: array(),
		'serverCommandScripts' => function_exists( 'wpdm_build_desktop_command_scripts_payload' )
			? wpdm_build_desktop_command_scripts_payload()
			: array(),
		'serverCommands'   => function_exists( 'wpdm_build_desktop_commands_payload' )
			? wpdm_build_desktop_commands_payload()
			: array(),
		'desktopIcons'     => function_exists( 'wpdm_build_desktop_icons_payload' )
			? wpdm_build_desktop_icons_payload()
			: array(),
	);
}

/**
 * Resolve a registered WP script handle to an absolute URL
 * (with version cache-buster appended). Returns an empty string
 * when the handle isn't registered or has no source — callers
 * treat an empty string as "no script to load."
 *
 * Shared between `wp_register_desktop_window()` and
 * `wp_register_desktop_widget()` because both need the same
 * handle→URL plumbing to power mid-session dynamic script
 * loading in the shell.
 *
 * @since 0.10.0
 *
 * @param string $handle WP script handle.
 * @return string Absolute URL, or empty string on miss.
 */
function wpdm_resolve_script_url( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return '';
	}
	$wp_scripts = wp_scripts();
	if ( ! $wp_scripts || ! isset( $wp_scripts->registered[ $handle ] ) ) {
		return '';
	}
	$registered = $wp_scripts->registered[ $handle ];
	$src        = is_string( $registered->src ) ? $registered->src : '';
	if ( '' === $src ) {
		return '';
	}
	// Normalize relative paths + attach cache-bust ver.
	$resolved = $src;
	if ( 0 === strpos( $resolved, '/' ) && 0 !== strpos( $resolved, '//' ) ) {
		$resolved = site_url( $resolved );
	}
	if ( ! empty( $registered->ver ) ) {
		$resolved = add_query_arg( 'ver', $registered->ver, $resolved );
	}
	return $resolved;
}

/**
 * Serialize the server-declared native-window registry into the
 * payload shape the shell consumes. For each entry registered via
 * `wp_register_desktop_window()`, we capture: the window's
 * metadata (id/title/icon/placement/dimensions/autofocus), the
 * rendered template HTML (by running the template callback into an
 * output buffer), and the URL of the enqueued script handle (so
 * mid-session activations can load the plugin's JS dynamically
 * without a full shell reload).
 *
 * @since 0.10.0
 *
 * @return array[]
 */
function wpdm_build_native_windows_payload() {
	if ( ! function_exists( 'wpdm_native_window_registry' ) ) {
		return array();
	}
	$registry = wpdm_native_window_registry();
	if ( ! is_array( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		if ( ! is_callable( $entry['template'] ) ) {
			continue;
		}

		// Capture the template HTML (tab-wrapped when any
		// additional tabs are registered via
		// `wp_register_desktop_window_tab()`; flat otherwise).
		// Captured as a string so the shell can inject it as a
		// `<template>` at mid-session plugin activation without a
		// reload.
		$template_html = wpdm_build_native_window_template_html( $entry );

		// Resolve script handle → URL so the shell can inject a
		// `<script>` tag dynamically on mid-session activation.
		$script_handle = isset( $entry['script'] ) ? (string) $entry['script'] : '';
		$script_url    = wpdm_resolve_script_url( $script_handle );

		// Tab metadata (label + extra script URLs) ships alongside
		// the template so the shell can render a picker UI or load
		// additional tab scripts when a tab's activation is late.
		$tab_descriptors = array();
		if ( function_exists( 'wpdm_get_native_window_tabs' ) ) {
			foreach ( wpdm_get_native_window_tabs( $entry['id'] ) as $tab ) {
				$tab_descriptors[] = array(
					'value'        => $tab['value'],
					'label'        => $tab['label'],
					'isMain'       => $tab['is_main'],
					'scriptUrl'    => '' !== $tab['script']
						? wpdm_resolve_script_url( $tab['script'] )
						: '',
					'scriptHandle' => $tab['script'],
				);
			}
		}

		$out[] = array(
			'id'           => $entry['id'],
			'title'        => $entry['title'],
			'icon'         => $entry['icon'],
			'placement'    => $entry['placement'],
			'width'        => $entry['width'],
			'height'       => $entry['height'],
			'minWidth'     => $entry['min_width'],
			'minHeight'    => $entry['min_height'],
			'autofocus'    => $entry['autofocus'],
			'templateId'   => 'wpdm-native-window-' . $entry['id'],
			'templateHtml' => $template_html,
			'scriptUrl'    => $script_url,
			'scriptHandle' => $script_handle,
			'tabs'         => $tab_descriptors,
		);
	}

	return $out;
}

/**
 * Converts a menu item slug to a full admin URL.
 *
 * Handles both direct file references (e.g., 'edit.php') and
 * plugin page slugs (e.g., 'admin.php?page=my-plugin').
 *
 * @since 0.1.0
 *
 * @param string $slug The menu item slug or URL.
 * @return string The full admin URL.
 */
function wpdm_menu_item_url( $slug ) {
	// Already a full URL.
	if ( str_starts_with( $slug, 'http://' ) || str_starts_with( $slug, 'https://' ) ) {
		return esc_url( $slug );
	}

	// Strip path traversal sequences.
	$slug = str_replace( '..', '', $slug );

	// Direct file reference (e.g., 'edit.php', 'upload.php').
	if ( false !== strpos( $slug, '.php' ) ) {
		return esc_url( admin_url( $slug ) );
	}

	// Plugin page slug — route through admin.php.
	return esc_url( admin_url( 'admin.php?page=' . rawurlencode( $slug ) ) );
}
