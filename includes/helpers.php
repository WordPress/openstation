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
function desktop_mode_is_enabled() {
	if ( ! is_user_logged_in() ) {
		return false;
	}

	return '1' === get_user_meta( get_current_user_id(), 'desktop_mode_mode', true );
}

/**
 * Disables the admin bar on chromeless (iframe) requests.
 *
 * Hooked on the `show_admin_bar` filter so the front-end bar path also
 * sees a false return. In admin, `is_admin_bar_showing()` short-circuits
 * to true for any is_admin() request regardless of this filter, so the
 * actual render is stopped by `desktop_mode_chromeless_suppress_admin_bar`
 * below; this filter is kept for completeness + tests.
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
 * `is_admin_bar_showing()` unconditionally returns true in admin context,
 * so the `show_admin_bar` filter alone can't stop `wp_admin_bar_render()`
 * from firing on `in_admin_header`. We detach the render action instead
 * and let chromeless.css hide the `wp-toolbar` padding on `<html>`.
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
function desktop_mode_chromeless_preserve_redirect( $location ) {
	if ( empty( $location ) || ! desktop_mode_is_chromeless_request() ) {
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
add_filter( 'wp_redirect', 'desktop_mode_chromeless_preserve_redirect', 999 );

/**
 * Preserves the `desktop_mode_classic` flag through admin redirects.
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
 * @return string The redirect URL, with `desktop_mode_classic=1` appended when applicable.
 */
function desktop_mode_classic_preserve_redirect( $location ) {
	if ( empty( $location ) || ! desktop_mode_is_classic_request() ) {
		return $location;
	}

	if ( false === strpos( $location, '/wp-admin/' ) ) {
		return $location;
	}

	if ( false !== strpos( $location, DESKTOP_MODE_CLASSIC_FLAG . '=' ) ) {
		return $location;
	}

	return add_query_arg( DESKTOP_MODE_CLASSIC_FLAG, '1', $location );
}
add_filter( 'wp_redirect', 'desktop_mode_classic_preserve_redirect', 999 );

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
function desktop_mode_is_chromeless_request() {
	if ( ! desktop_mode_is_enabled() ) {
		// Only allow chromeless mode if the user actually has
		// desktop mode enabled. Prevents stripping admin chrome via
		// a bare `?wp_desktop=1` parameter from a logged-out URL.
		return false;
	}

	// Primary signal — the explicit query flag the parent shell
	// adds when opening windows.
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only request flag, no state change.
	if ( ! empty( $_GET['wp_desktop'] ) && '1' === sanitize_text_field( wp_unslash( $_GET['wp_desktop'] ) ) ) {
		return true;
	}

	// Fallback signal — the request is a same-origin iframe load.
	// Modern browsers (Chrome 80+, Firefox 90+, Safari 16.4+) send
	// the `Sec-Fetch-*` headers reliably, and they are immune to
	// JavaScript spoofing (the browser sets them itself).
	//
	// This catches the failure mode where an internal admin
	// navigation drops the `?wp_desktop=1` query flag — Gutenberg's
	// `window.location` assignments, meta-refresh redirects, or any
	// link the inline rewriter missed. The user is in an iframe on
	// the same origin, has desktop mode enabled, so render as
	// chromeless.
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
		 * explicit `?wp_desktop=1` flag (matches pre-0.18 behaviour);
		 * useful for environments where a reverse proxy strips the
		 * `Sec-Fetch-*` headers and they can't be trusted.
		 *
		 * @since 0.18.0
		 *
		 * @param bool $allow Default true.
		 */
		return (bool) apply_filters( 'desktop_mode_chromeless_sec_fetch_fallback', true );
	}

	return false;
}

/**
 * Checks whether the current request carries the "classic override" flag.
 *
 * The window-chrome "Detach" action opens an admin page in a new browser tab
 * with `?desktop_mode_classic=1` so the user can view that one page outside the
 * desktop shell without disabling desktop mode account-wide. The flag is a
 * per-request override: `desktop_mode_is_enabled()` still returns true (the user's
 * preference hasn't changed), but the shell, shell assets, and body class are
 * skipped for this request so the classic admin renders normally.
 *
 * Keep this separate from `desktop_mode_is_enabled()` so the admin-bar toggle in
 * the detached tab correctly reflects the account state — letting the user
 * disable desktop mode entirely from the tab if they want to.
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
 * @since 0.11.0
 *
 * @return string Wallpaper id. Empty string if the filter returns
 *                an invalid value.
 */
function desktop_mode_get_default_wallpaper() {
	/**
	 * Filters the wallpaper id loaded on first boot / new user.
	 *
	 * @since 0.11.0
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
 * @since 0.11.0
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
function desktop_mode_url_is_same_admin( $url ) {
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
function desktop_mode_resolve_admin_target( $file ) {
	$file = is_string( $file ) ? trim( $file ) : '';
	if ( '' === $file ) {
		return new WP_Error( 'desktop_mode_empty_target', __( 'Admin target cannot be empty.', 'desktop-mode' ) );
	}

	if ( false !== strpos( $file, '..' ) || false !== strpos( $file, '/' ) || false !== strpos( $file, '\\' ) ) {
		return new WP_Error( 'desktop_mode_invalid_target', __( 'Admin target contains invalid path characters.', 'desktop-mode' ) );
	}

	// Lowercase match mirrors WP's filesystem assumptions on case-
	// insensitive volumes (macOS, Windows). The actual file_exists
	// check below is the final arbiter; this regex just pre-filters
	// clearly bad inputs.
	if ( ! preg_match( '/^[a-z0-9_-]+\.php$/i', $file ) ) {
		return new WP_Error( 'desktop_mode_invalid_target', __( 'Admin target must be a plain .php filename.', 'desktop-mode' ) );
	}

	$candidate = ABSPATH . 'wp-admin/' . $file;
	if ( ! file_exists( $candidate ) ) {
		return new WP_Error( 'desktop_mode_unknown_target', __( 'Admin target does not exist.', 'desktop-mode' ) );
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
function desktop_mode_build_dock_items() {
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
		$icon = desktop_mode_sanitize_dock_icon( $item[6] ?? '' );

		// Build the full URL for the menu item.
		//
		// `$parent_url` is the slug-derived URL (`admin.php?page=<slug>`
		// for plugin pages, the file path for Core ones). It's the
		// reference value the self-link strip below compares against.
		// The effective `$url` we ship to the shell can be rewritten
		// further down to the first visible submenu's URL — see the
		// note after the loop.
		$parent_url = desktop_mode_menu_item_url( $item[2] );
		$url        = $parent_url;

		// Build submenu items.
		//
		// WordPress auto-prepends a self-link entry to every parent
		// menu's `$submenu[$slug]` (the first child shares the parent's
		// slug + URL — that's what `add_menu_page()` generates so the
		// admin UI can render a clickable parent in the sidebar). For
		// the shell's JS surface we strip this entry so:
		//
		//   - `submenu.length === 0` reliably means "no real children"
		//     (the right-click submenu popover stays suppressed; the
		//     in-window tab strip stays hidden).
		//   - `submenu.length > 0` reliably means "has real child links"
		//     — every entry points at a distinct URL.
		//
		// Detection by URL (post-`desktop_mode_menu_item_url()` normalize)
		// rather than slug equality covers plugins that register a child
		// at a different slug pointing at the parent's URL.
		$sub_items             = array();
		$first_visible_sub_url = null;
		if ( ! empty( $submenu[ $item[2] ] ) ) {
			foreach ( $submenu[ $item[2] ] as $sub_item ) {
				if ( ! empty( $sub_item[1] ) && ! current_user_can( $sub_item[1] ) ) {
					continue;
				}
				// Skip items with hide-if classes.
				if ( ! empty( $sub_item[4] ) && false !== strpos( $sub_item[4], 'hide-if-no-customize' ) ) {
					continue;
				}
				$sub_url = desktop_mode_menu_item_url( $sub_item[2] );
				// Capture the first capability-passing submenu URL so
				// we can use it as the parent's effective URL below
				// (mirrors `wp-admin/menu-header.php`). Captured BEFORE
				// the self-link strip so plugins whose first submenu IS
				// the auto-prepended self-link land on the parent URL
				// (a no-op rewrite — preserves existing behavior).
				if ( null === $first_visible_sub_url ) {
					$first_visible_sub_url = $sub_url;
				}
				// Self-link strip — `$sub_url === $parent_url` covers
				// WP's auto-prepended entry AND any plugin-registered
				// alias that happens to land on the parent URL.
				if ( $sub_url === $parent_url ) {
					continue;
				}
				$sub_raw_title = preg_replace( '/<span[^>]*>.*?<\/span>/s', '', $sub_item[0] );
				$sub_items[]   = array(
					'title' => trim( wp_strip_all_tags( $sub_raw_title ) ),
					'url'   => $sub_url,
				);
			}
		}

		// Mirror `wp-admin/menu-header.php`: when a parent menu has any
		// visible submenu, classic admin rewrites the parent's
		// clickable URL to the first submenu's URL. Plugins like
		// WooCommerce rely on this — their top-level slug
		// (`woocommerce`) has no working callback and 500s when hit
		// directly. The real landing page is the first submenu
		// (`?page=wc-admin` for WC). Without this rewrite the dock
		// icon points users at a broken URL that classic admin would
		// never have linked to.
		if ( null !== $first_visible_sub_url ) {
			$url = $first_visible_sub_url;
		}

		$dock_item = array(
			'id'        => sanitize_key( $item[5] ?? $item[2] ),
			'title'     => $title,
			'icon'      => $icon,
			'url'       => $url,
			'badge'     => $badge,
			'submenu'   => $sub_items,
			'multi'     => desktop_mode_dock_item_is_multi( $item[2] ),
			'placement' => desktop_mode_dock_placement( $item[2] ),
			'isCore'    => desktop_mode_is_core_menu_slug( $item[2] ),
		);

		/**
		 * Filters a single dock item's data.
		 *
		 * @since 0.1.0
		 *
		 * @param array  $dock_item The dock item data.
		 * @param string $menu_slug The menu slug.
		 */
		$dock_item = apply_filters( 'desktop_mode_dock_item', $dock_item, $item[2] );

		$items[] = $dock_item;
	}

	/**
	 * Filters the dock items before they are passed to JavaScript.
	 *
	 * @since 0.1.0
	 *
	 * @param array[] $items Array of dock item arrays.
	 */
	return apply_filters( 'desktop_mode_dock_items', $items );
}

/**
 * Sanitizes a dock icon value for safe injection into the shell JS.
 *
 * Menu items can set their icon to one of:
 *
 *   - A Dashicons class (e.g. `dashicons-admin-post`)
 *   - An http/https URL pointing at an image asset
 *   - A `data:image/svg+xml;base64,…` URI (common for plugins that
 *     ship inline vector art — Jetpack, WooCommerce, etc.). Rendered
 *     as a CSS background-image, where per-spec SVG script content
 *     does not execute, so the surface is safe.
 *   - `'none'` or `'div'` (CSS hooks, no icon asset). The dock's JS
 *     layer extracts the real icon from the hidden `#adminmenu` DOM
 *     for these cases.
 *
 * Inline SVG data URIs (`data:image/svg+xml;base64,…` and
 * `data:image/svg+xml,…`) are also accepted because that's how the
 * vast majority of WP plugins ship their menu icon — Yoast,
 * WooCommerce, Jetpack, Elementor, et al. all register `$menu[$i][6]`
 * as an SVG data URI. Other `data:` schemes (`data:text/html`,
 * `data:application/javascript`, …) and raw `javascript:` / `vbscript:`
 * / `file:` schemes remain rejected. The shell renders the SVG via a
 * CSS `background-image`, which (per the modern browser security model
 * shared with `<img>`) sandboxes scripts inside the SVG so they do not
 * execute.
 *
 * The return value is always a string safe to drop into an `img.src`,
 * a CSS class, or a CSS `url()` background without further escaping.
 *
 * @since 0.4.0
 * @since 0.11.0 Rejected `data:` URIs outright (regression — see 0.18.x).
 * @since 0.18.x Re-allowed `data:image/svg+xml{;base64,|,}` so plugin
 *               icons (Yoast, WooCommerce, Jetpack, etc.) appear on the
 *               dock instead of collapsing to the gear fallback.
 *               Other `data:` schemes still rejected.
 *
 * @param mixed $icon Raw icon value from the menu registration.
 * @return string Sanitized icon string.
 */
function desktop_mode_sanitize_dock_icon( $icon ) {
	$fallback = 'dashicons-admin-generic';
	if ( ! is_string( $icon ) || '' === $icon ) {
		return $fallback;
	}

	$icon = trim( $icon );

	if ( 'none' === $icon || 'div' === $icon ) {
		return $fallback;
	}

	if ( 0 === strpos( $icon, 'dashicons-' ) ) {
		// Allow only the safe subset of characters a Dashicons class can
		// contain — prevents class-attribute break-out via spaces or
		// quotes if a plugin registers a malicious "dashicons-…" value.
		return preg_replace( '/[^a-z0-9_-]/', '', $icon );
	}

	// http/https URL — the icon is a hosted image.
	if ( 0 === stripos( $icon, 'http://' ) || 0 === stripos( $icon, 'https://' ) ) {
		$clean = esc_url_raw( $icon, array( 'http', 'https' ) );
		return $clean ? $clean : $fallback;
	}

	// `data:image/svg+xml` — the canonical inline-icon shape WordPress
	// plugins use for their admin-menu icon (`$menu[$i][6]`). Two valid
	// payload encodings: base64 (`;base64,<base64>`) and URL-encoded
	// (`,<percent-encoded>`). Reject everything outside the SVG MIME so
	// `data:text/html` and `data:application/javascript` still bounce.
	//
	// Strict whole-string regex — no embedded whitespace, no smuggled
	// quotes, no second `data:` prefix. Case-insensitive on the scheme
	// alone since `Data:` and `DATA:` are syntactically valid but the
	// payload portion stays case-sensitive (base64 alphabet is).
	if ( 0 === stripos( $icon, 'data:image/svg+xml' ) ) {
		if (
			preg_match( '#^data:image/svg\+xml;base64,[A-Za-z0-9+/=]+$#i', $icon )
			|| preg_match( '#^data:image/svg\+xml,[A-Za-z0-9._~!$&\'()*+,;=:@/?%-]+$#i', $icon )
		) {
			return $icon;
		}
		// Malformed SVG data URI — fall through to fallback rather than
		// pass a half-validated string through to the renderer.
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
 * `desktop_mode_dock_item_multi` filter to mark any custom page as multi
 * (or force a stock list page into singleton mode).
 *
 * @since 0.5.0
 *
 * @param string $menu_slug The raw menu slug (e.g. `edit.php`, `upload.php`,
 *                          or `my-plugin-page`). Query strings are preserved
 *                          so `edit.php?post_type=page` resolves correctly.
 * @return bool True if this page supports multiple simultaneous windows.
 */
function desktop_mode_dock_item_is_multi( $menu_slug ) {
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
	return (bool) apply_filters( 'desktop_mode_dock_item_multi', $multi, $menu_slug );
}

/**
 * Returns true when `$menu_slug` maps to a first-party WordPress
 * Core admin menu item (Dashboard, Posts, Pages, Media, Settings,
 * etc.), false otherwise. The caller uses the answer as an ordering
 * hint — core items are placed ahead of plugin items in the
 * unified dock rail.
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
 * `desktop_mode_dock_placement`:
 *
 * ```php
 * // Keep Jetpack on the left dock:
 * add_filter( 'desktop_mode_dock_placement', function ( $placement, $slug ) {
 *     return 'jetpack' === $slug ? 'dock' : $placement;
 * }, 10, 2 );
 * ```
 *
 * @since 0.9.0
 *
 * @param string $menu_slug Menu item slug (e.g. `edit.php`, `edit.php?post_type=foo`, `woocommerce`).
 * @return bool True when the slug is a core admin page.
 */
function desktop_mode_is_core_menu_slug( $menu_slug ) {
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
 * Resolve whether a given menu slug is rendered in the dock.
 * Returns one of two values:
 *
 *   - `'dock'`   — render this item on the unified dock rail.
 *   - `'hidden'` — don't render this item anywhere in the desktop
 *                  shell. The underlying admin menu entry still
 *                  exists server-side; this only suppresses the
 *                  desktop-shell tile.
 *
 * Default is `'dock'` for every menu item. Plugins + site admins can
 * hide individual items via the `desktop_mode_dock_placement` filter.
 *
 * @since 0.9.0
 *
 * @param string $menu_slug The menu slug (e.g. `edit.php`, `woocommerce`).
 * @return string `'dock'` or `'hidden'`.
 */
function desktop_mode_dock_placement( $menu_slug ) {
	/**
	 * Filter whether a specific menu item is shown in the dock.
	 *
	 * Return `'dock'` to render the item on the dock (default) or
	 * `'hidden'` to suppress it entirely. Any other value coerces to
	 * `'dock'` — a defensive guard so a misbehaving filter can't
	 * corrupt the dock with `null` / `false` / arbitrary strings.
	 *
	 * @since 0.9.0
	 *
	 * @param string $placement Default — always `'dock'`.
	 * @param string $menu_slug The menu slug triggering the lookup.
	 */
	$filtered = apply_filters( 'desktop_mode_dock_placement', 'dock', $menu_slug );
	return 'hidden' === $filtered ? 'hidden' : 'dock';
}

/**
 * Assemble the menu payload consumed by the shell.
 *
 * Runs the full dock-builder and returns a single `dockItems` array —
 * core WordPress menus first (Dashboard, Posts, Media, …), then
 * plugin-contributed top-level menus. Items whose `placement` is
 * `'hidden'` are dropped entirely.
 *
 * Extracted out of `includes/render.php` so both the initial PHP
 * localize AND the `/wp-desktop/v1/menu` REST endpoint read from a
 * single source of truth — any drift would desync the live refresh.
 *
 * @since 0.9.0
 *
 * @return array{dockItems: array[]} Menu payload.
 */
function desktop_mode_build_menu_payload() {
	$all = desktop_mode_build_dock_items();

	// Drop hidden items; preserve the default "core first, plugins
	// after" ordering by partitioning on the core classifier.
	$visible = array_values(
		array_filter(
			$all,
			static function ( $item ) {
				return 'hidden' !== ( $item['placement'] ?? 'dock' );
			}
		)
	);

	// Partition on the per-item `isCore` flag set in
	// desktop_mode_build_dock_items — that classifier ran against the
	// raw menu slug ($item[2]), which is what
	// desktop_mode_is_core_menu_slug actually compares. The outer 'id'
	// field is a sanitized CSS id (e.g. `toplevel_page_jetpack`) and
	// would never match.
	$core = array();
	$plugin = array();
	foreach ( $visible as $item ) {
		if ( ! empty( $item['isCore'] ) ) {
			$core[] = $item;
		} else {
			$plugin[] = $item;
		}
	}

	$dock = array_merge( $core, $plugin );

	return array(
		'dockItems'        => $dock,
		'nativeWindows'    => desktop_mode_build_native_windows_payload(),
		'serverWidgets'    => function_exists( 'desktop_mode_build_desktop_widgets_payload' )
			? desktop_mode_build_desktop_widgets_payload()
			: array(),
		'serverWallpapers' => function_exists( 'desktop_mode_build_desktop_wallpapers_payload' )
			? desktop_mode_build_desktop_wallpapers_payload()
			: array(),
		'serverCommandScripts' => function_exists( 'desktop_mode_build_desktop_command_scripts_payload' )
			? desktop_mode_build_desktop_command_scripts_payload()
			: array(),
		'serverCommands'   => function_exists( 'desktop_mode_build_desktop_commands_payload' )
			? desktop_mode_build_desktop_commands_payload()
			: array(),
		'serverSettingsTabScripts' => function_exists( 'desktop_mode_build_desktop_settings_tab_scripts_payload' )
			? desktop_mode_build_desktop_settings_tab_scripts_payload()
			: array(),
		'serverSettingsTabs' => function_exists( 'desktop_mode_build_desktop_settings_tabs_payload' )
			? desktop_mode_build_desktop_settings_tabs_payload()
			: array(),
		'serverDockRailRendererScripts' => function_exists( 'desktop_mode_build_dock_rail_renderer_scripts_payload' )
			? desktop_mode_build_dock_rail_renderer_scripts_payload()
			: array(),
		'serverTitleBarButtonScripts' => function_exists( 'desktop_mode_build_desktop_titlebar_button_scripts_payload' )
			? desktop_mode_build_desktop_titlebar_button_scripts_payload()
			: array(),
		'serverWindowThemeScripts'  => function_exists( 'desktop_mode_build_window_theme_scripts_payload' )
			? desktop_mode_build_window_theme_scripts_payload()
			: array(),
		'serverWindowThemes'        => function_exists( 'desktop_mode_build_window_themes_payload' )
			? desktop_mode_build_window_themes_payload()
			: array(),
		'serverWindowControlScripts' => function_exists( 'desktop_mode_build_window_control_scripts_payload' )
			? desktop_mode_build_window_control_scripts_payload()
			: array(),
		'serverWindowControls'      => function_exists( 'desktop_mode_build_window_controls_payload' )
			? desktop_mode_build_window_controls_payload()
			: array(),
		'serverWindowSlotScripts'   => function_exists( 'desktop_mode_build_window_slot_scripts_payload' )
			? desktop_mode_build_window_slot_scripts_payload()
			: array(),
		'serverWindowSlots'         => function_exists( 'desktop_mode_build_window_slots_payload' )
			? desktop_mode_build_window_slots_payload()
			: array(),
		'serverWindowChromeScripts' => function_exists( 'desktop_mode_build_window_chrome_scripts_payload' )
			? desktop_mode_build_window_chrome_scripts_payload()
			: array(),
		'serverWindowChromes'       => function_exists( 'desktop_mode_build_window_chromes_payload' )
			? desktop_mode_build_window_chromes_payload()
			: array(),
		'desktopIcons'     => function_exists( 'desktop_mode_build_desktop_icons_payload' )
			? desktop_mode_build_desktop_icons_payload()
			: array(),
	);
}

/**
 * Resolve a registered WP script handle into the full payload the
 * shell needs to lazy-load it without going through `wp_print_scripts()`.
 *
 * Returns:
 *
 * ```
 * array(
 *     'url'          => 'https://…/script.js?ver=…',
 *     'before'       => array( /* `wp_add_inline_script( $h, $code, 'before' )` strings *\/ ),
 *     'after'        => array( /* `wp_add_inline_script( $h, $code, 'after' )` strings *\/ ),
 *     'l10n'         => array( /* `wp_localize_script( $h, $name, $data )` precomputed `<script>var $name = …;</script>` strings *\/ ),
 *     'translations' => string, /* `wp_set_script_translations()` JED chunk *\/
 * )
 * ```
 *
 * **The `l10n` / `before` / `after` / `translations` fields exist
 * because the lazy-load path in the shell appends a raw
 * `<script src="…">` and never invokes `wp_print_scripts()` — so any
 * `wp_localize_script` / `wp_add_inline_script` / `wp_set_script_translations`
 * data attached to the handle would be silently dropped without this
 * harvest.** The shell injects each entry as inline `<script>` tags
 * around the lazy `<script src>` in the same order
 * `WP_Scripts::do_item()` would have used.
 *
 * Returns an empty payload (`array( 'url' => '' )`) when the handle
 * is unregistered or has no source — callers treat that as "no
 * script to load."
 *
 * Shared between `desktop_mode_register_window()` and
 * `desktop_mode_register_widget()` (and every other registration that
 * relies on lazy script loading in the shell) because all of them
 * need identical handle→payload plumbing to power mid-session dynamic
 * script loading without the `wp_print_scripts` lifecycle.
 *
 * @since 0.10.0
 * @since 0.6.0 Returns full payload (was `string` URL only). Renamed
 *              from `desktop_mode_resolve_script_url`.
 *
 * @param string $handle WP script handle.
 * @return array{ url:string, before:string[], after:string[], l10n:string[], translations:string } Payload (empty `url` on miss).
 */
function desktop_mode_resolve_script_payload( $handle ) {
	$empty = array(
		'url'          => '',
		'before'       => array(),
		'after'        => array(),
		'l10n'         => array(),
		'translations' => '',
	);

	$handle = (string) $handle;
	if ( '' === $handle ) {
		return $empty;
	}
	$wp_scripts = wp_scripts();
	if ( ! $wp_scripts || ! isset( $wp_scripts->registered[ $handle ] ) ) {
		return $empty;
	}
	$registered = $wp_scripts->registered[ $handle ];
	$src        = is_string( $registered->src ) ? $registered->src : '';
	if ( '' === $src ) {
		return $empty;
	}

	// Normalize relative paths + attach cache-bust ver.
	$resolved = $src;
	if ( 0 === strpos( $resolved, '/' ) && 0 !== strpos( $resolved, '//' ) ) {
		$resolved = site_url( $resolved );
	}
	if ( ! empty( $registered->ver ) ) {
		$resolved = add_query_arg( 'ver', $registered->ver, $resolved );
	}

	// Harvest `extra` data the lazy-load path would otherwise drop.
	$before = array();
	$after  = array();
	$l10n   = array();

	if ( isset( $registered->extra['before'] ) && is_array( $registered->extra['before'] ) ) {
		foreach ( $registered->extra['before'] as $code ) {
			$code = (string) $code;
			if ( '' !== $code ) {
				$before[] = $code;
			}
		}
	}
	if ( isset( $registered->extra['after'] ) && is_array( $registered->extra['after'] ) ) {
		foreach ( $registered->extra['after'] as $code ) {
			$code = (string) $code;
			if ( '' !== $code ) {
				$after[] = $code;
			}
		}
	}
	// `wp_localize_script` stores its JS at `extra['data']` as a single
	// concatenated string of `var x = …;` assignments. We capture it
	// verbatim — the shell will eval it as the body of an inline
	// `<script>` tag, mirroring what `WP_Scripts::print_extra_script()`
	// does at print time.
	if ( ! empty( $registered->extra['data'] ) && is_string( $registered->extra['data'] ) ) {
		$l10n[] = $registered->extra['data'];
	}

	// Translations chunk — `wp_set_script_translations()` builds a
	// `wp.i18n.setLocaleData( JSON, 'domain' )` snippet that the print
	// pipeline emits before the script body. `print_translations(
	// $handle, false )` returns the snippet without echoing.
	$translations = '';
	if ( method_exists( $wp_scripts, 'print_translations' ) ) {
		$captured = $wp_scripts->print_translations( $handle, false );
		if ( is_string( $captured ) ) {
			$translations = $captured;
		}
	}

	return array(
		'url'          => $resolved,
		'before'       => $before,
		'after'        => $after,
		'l10n'         => $l10n,
		'translations' => $translations,
	);
}

/**
 * Fire a `_doing_it_wrong()` notice exactly once per handle per
 * request. Shared by every `desktop_mode_build_desktop_*_scripts_payload()`
 * caller — payload builders run on every shell-config rebuild
 * (multiple times per page load via REST + admin-bar refresh +
 * tests), so undeduped notices spam the error log AND trip
 * `expectedIncorrectUsage` assertions in unrelated tests.
 *
 * @since 0.18.0
 *
 * @param string $function_name `desktop_mode_register_*_script` — passed verbatim to `_doing_it_wrong`.
 * @param string $kind          Human label: `Command`, `Settings-tab`, `Title-bar button`.
 * @param string $handle        Offending script handle.
 */
function desktop_mode_warn_unresolvable_script_handle( $function_name, $kind, $handle ) {
	static $warned = array();
	$cache_key = $function_name . '|' . $handle;
	if ( isset( $warned[ $cache_key ] ) ) {
		return;
	}
	$warned[ $cache_key ] = true;

	if ( '__flush__' === $handle ) {
		// Test escape hatch: clear the dedupe cache so a flush
		// helper can reset between tests.
		$warned = array();
		return;
	}

	_doing_it_wrong(
		esc_html( $function_name ),
		sprintf(
			/* translators: 1: kind ("Command"/"Settings-tab"/"Title-bar button"), 2: handle. */
			esc_html__( '%1$s script handle "%2$s" is not registered with WordPress (no `wp_register_script` call found). The script will not load.', 'desktop-mode' ),
			esc_html( $kind ),
			esc_html( $handle )
		),
		'0.18.0'
	);
}

/**
 * Test-only: clear every script-handle registry + the dedupe
 * cache for the unresolvable-handle notice. Tests call this in
 * `set_up` so prior tests' synthetic handles can't leak into
 * later assertions about payload shape.
 *
 * @since 0.18.0
 */
function desktop_mode_flush_script_handle_registries() {
	if ( function_exists( 'desktop_mode_flush_desktop_command_script_registry' ) ) {
		desktop_mode_flush_desktop_command_script_registry();
	}
	if ( function_exists( 'desktop_mode_flush_desktop_settings_tab_script_registry' ) ) {
		desktop_mode_flush_desktop_settings_tab_script_registry();
	}
	if ( function_exists( 'desktop_mode_flush_desktop_titlebar_button_script_registry' ) ) {
		desktop_mode_flush_desktop_titlebar_button_script_registry();
	}
	if ( function_exists( 'desktop_mode_flush_window_theme_script_registry' ) ) {
		desktop_mode_flush_window_theme_script_registry();
	}
	if ( function_exists( 'desktop_mode_flush_window_theme_registry' ) ) {
		desktop_mode_flush_window_theme_registry();
	}
	if ( function_exists( 'desktop_mode_flush_window_control_script_registry' ) ) {
		desktop_mode_flush_window_control_script_registry();
	}
	if ( function_exists( 'desktop_mode_flush_window_control_registry' ) ) {
		desktop_mode_flush_window_control_registry();
	}
	if ( function_exists( 'desktop_mode_flush_window_slot_script_registry' ) ) {
		desktop_mode_flush_window_slot_script_registry();
	}
	if ( function_exists( 'desktop_mode_flush_window_slot_registry' ) ) {
		desktop_mode_flush_window_slot_registry();
	}
	if ( function_exists( 'desktop_mode_flush_window_chrome_script_registry' ) ) {
		desktop_mode_flush_window_chrome_script_registry();
	}
	if ( function_exists( 'desktop_mode_flush_window_chrome_registry' ) ) {
		desktop_mode_flush_window_chrome_registry();
	}
	desktop_mode_warn_unresolvable_script_handle( '', '', '__flush__' );
}

/**
 * Serialize the server-declared native-window registry into the
 * payload shape the shell consumes. For each entry registered via
 * `desktop_mode_register_window()`, we capture: the window's
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
function desktop_mode_build_native_windows_payload() {
	if ( ! function_exists( 'desktop_mode_native_window_registry' ) ) {
		return array();
	}
	$registry = desktop_mode_native_window_registry();
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
		// `desktop_mode_register_window_tab()`; flat otherwise).
		// Captured as a string so the shell can inject it as a
		// `<template>` at mid-session plugin activation without a
		// reload.
		$template_html = desktop_mode_build_native_window_template_html( $entry );

		// Resolve script handle → full payload (URL + harvested
		// `extra` data) so the shell can inject a `<script>` tag
		// dynamically on mid-session activation WITHOUT dropping
		// `wp_localize_script` / `wp_add_inline_script` data the way
		// the bare `<script src>` lazy-load path would. See
		// `desktop_mode_resolve_script_payload()` for shape.
		$script_handle  = isset( $entry['script'] ) ? (string) $entry['script'] : '';
		$script_payload = desktop_mode_resolve_script_payload( $script_handle );

		// `config` arg on `desktop_mode_register_window()` — discoverable
		// alternative to `wp_localize_script`. We synthesize a localize
		// snippet so it lands through the same delivery path as native
		// `wp_localize_script`. The bundle reads
		// `window.wpDesktopWindowConfig[id]` (or via
		// `wp.desktop.getWindowConfig(id)`).
		if ( ! empty( $entry['config'] ) && is_array( $entry['config'] ) ) {
			$script_payload['l10n'][] = sprintf(
				'window.wpDesktopWindowConfig=window.wpDesktopWindowConfig||{};window.wpDesktopWindowConfig[%s]=%s;',
				wp_json_encode( $entry['id'] ),
				wp_json_encode( $entry['config'] )
			);
		}

		// Tab metadata (label + extra script payloads) ships alongside
		// the template so the shell can render a picker UI or load
		// additional tab scripts when a tab's activation is late.
		$tab_descriptors = array();
		if ( function_exists( 'desktop_mode_get_native_window_tabs' ) ) {
			foreach ( desktop_mode_get_native_window_tabs( $entry['id'] ) as $tab ) {
				$tab_payload                 = '' !== $tab['script']
					? desktop_mode_resolve_script_payload( $tab['script'] )
					: array(
						'url'          => '',
						'before'       => array(),
						'after'        => array(),
						'l10n'         => array(),
						'translations' => '',
					);
				$tab_descriptors[]           = array(
					'value'             => $tab['value'],
					'label'             => $tab['label'],
					'isMain'            => $tab['is_main'],
					'scriptUrl'         => $tab_payload['url'],
					'scriptHandle'      => $tab['script'],
					'scriptBefore'      => $tab_payload['before'],
					'scriptAfter'       => $tab_payload['after'],
					'scriptL10n'        => $tab_payload['l10n'],
					'scriptTranslations' => $tab_payload['translations'],
				);
			}
		}

		$out[] = array(
			'id'                => $entry['id'],
			'title'             => $entry['title'],
			'icon'              => $entry['icon'],
			'placement'         => $entry['placement'],
			'width'             => $entry['width'],
			'height'            => $entry['height'],
			'minWidth'          => $entry['min_width'],
			'minHeight'         => $entry['min_height'],
			'autofocus'         => $entry['autofocus'],
			'templateId'        => 'wpdm-native-window-' . $entry['id'],
			'templateHtml'      => $template_html,
			'scriptUrl'         => $script_payload['url'],
			'scriptHandle'      => $script_handle,
			'ownerHandle'       => $script_handle,
			'scriptBefore'      => $script_payload['before'],
			'scriptAfter'       => $script_payload['after'],
			'scriptL10n'        => $script_payload['l10n'],
			'scriptTranslations' => $script_payload['translations'],
			'tabs'              => $tab_descriptors,
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
function desktop_mode_menu_item_url( $slug ) {
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
