<?php
/**
 * Desktop Mode — payload building helpers.
 *
 * Dock-item construction, native-window payload assembly, menu
 * payload (the data the shell shows in the dock + on bootstrap),
 * and the script/style handle resolvers used by the live-refresh
 * and lazy-load paths.
 *
 * Extracted from the 1,609-LOC `helpers.php` during the
 * architecture-0.8.1 PHP slicing (phase 6). Behaviour is
 * unchanged: every function name is identical and every WP filter
 * still fires with the same shape — PHP looks function references
 * up by name at hook-fire time, so existing callers continue to
 * resolve regardless of which file owns the definition.
 *
 * @package Desktop_Mode
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;


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
				$sub_raw_title = preg_replace( '/<span[^>]*>.*?<\/span>/s', '', (string) $sub_item[0] );
				$sub_title     = trim( wp_strip_all_tags( $sub_raw_title ) );
				// Skip entries with no resolvable title. Plugins (e.g.
				// WooCommerce's `wc-addons` Extensions row) register
				// `menu_title => null` to hide a row from classic admin's
				// left menu while keeping the page reachable. Without
				// this guard the dock renders an empty, label-less tab
				// that visually duplicates a sibling entry.
				if ( '' === $sub_title ) {
					continue;
				}
				$sub_items[] = array(
					'title' => $sub_title,
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
 * localize AND the chromeless bridge's live-refresh emit (including
 * the hidden-iframe probe spawned by `wp.desktop.refreshMenu()`)
 * read from a single source of truth — any drift would desync the
 * live refresh.
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
		'serverWindowNotices'       => function_exists( 'desktop_mode_build_window_notices_payload' )
			? desktop_mode_build_window_notices_payload()
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
 * Resolves a registered style handle to its print-time URL + harvested
 * inline CSS, the styles-side mirror of
 * {@see desktop_mode_resolve_script_payload()}.
 *
 * Why this exists: when a plugin's native window (or window-chrome
 * theme/control/slot/chrome) is activated mid-session — i.e. the user
 * activates the plugin from inside an open desktop shell — the parent
 * shell page already finished `wp_print_styles`. The plugin's
 * `admin_enqueue_scripts` callback never ran for it, so its
 * stylesheet is missing. The shell's lazy-loader fixes that by
 * injecting a `<link rel="stylesheet">` for every entry whose payload
 * carries a `styleUrl`.
 *
 * Captures both the resolved `src` and any `wp_add_inline_style()`
 * blobs attached to the handle so the shell can replay the same data
 * the print pipeline would have written.
 *
 * @since 0.18.1
 *
 * @param string $handle WP style handle.
 * @return array{ url:string, inline:string[] } Payload (empty `url` on miss).
 */
function desktop_mode_resolve_style_payload( $handle ) {
	$empty = array(
		'url'    => '',
		'inline' => array(),
	);

	$handle = (string) $handle;
	if ( '' === $handle ) {
		return $empty;
	}
	$wp_styles = wp_styles();
	if ( ! $wp_styles || ! isset( $wp_styles->registered[ $handle ] ) ) {
		return $empty;
	}
	$registered = $wp_styles->registered[ $handle ];
	$src        = is_string( $registered->src ) ? $registered->src : '';
	if ( '' === $src ) {
		return $empty;
	}

	// Normalize relative paths + attach cache-bust ver — same shape as
	// the script resolver. Keeps the two helpers symmetric so callers
	// don't have to special-case style vs script payloads.
	$resolved = $src;
	if ( 0 === strpos( $resolved, '/' ) && 0 !== strpos( $resolved, '//' ) ) {
		$resolved = site_url( $resolved );
	}
	if ( ! empty( $registered->ver ) ) {
		$resolved = add_query_arg( 'ver', $registered->ver, $resolved );
	}

	// `wp_add_inline_style()` blobs land in `extra['after']` — capture
	// them so the shell can emit a `<style>` tag after the `<link>` to
	// preserve cascade order with what `WP_Styles::print_inline_style()`
	// would have written.
	$inline = array();
	if ( isset( $registered->extra['after'] ) && is_array( $registered->extra['after'] ) ) {
		foreach ( $registered->extra['after'] as $code ) {
			$code = (string) $code;
			if ( '' !== $code ) {
				$inline[] = $code;
			}
		}
	}

	return array(
		'url'    => $resolved,
		'inline' => $inline,
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
	if ( function_exists( 'desktop_mode_flush_window_notice_registry' ) ) {
		desktop_mode_flush_window_notice_registry();
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

		// Resolve the optional style handle alongside the script so the
		// shell's lazy-loader can inject a `<link rel="stylesheet">`
		// (and any `wp_add_inline_style()` blobs) on mid-session
		// activation. Empty payload when no handle was declared OR the
		// handle isn't registered — both treated as "no styles to load."
		$style_handle  = isset( $entry['style'] ) ? (string) $entry['style'] : '';
		$style_payload = desktop_mode_resolve_style_payload( $style_handle );

		// `config` arg on `desktop_mode_register_window()` — discoverable
		// alternative to `wp_localize_script`. We synthesize a localize
		// snippet so it lands through the same delivery path as native
		// `wp_localize_script`. The bundle reads
		// `window.desktopModeWindowConfig[id]` (or via
		// `wp.desktop.getWindowConfig(id)`).
		if ( ! empty( $entry['config'] ) && is_array( $entry['config'] ) ) {
			$script_payload['l10n'][] = sprintf(
				'window.desktopModeWindowConfig=window.desktopModeWindowConfig||{};window.desktopModeWindowConfig[%s]=%s;',
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
			'templateId'        => 'desktop-mode-native-window-' . $entry['id'],
			'templateHtml'      => $template_html,
			'scriptUrl'         => $script_payload['url'],
			'scriptHandle'      => $script_handle,
			'ownerHandle'       => $script_handle,
			'scriptBefore'      => $script_payload['before'],
			'scriptAfter'       => $script_payload['after'],
			'scriptL10n'        => $script_payload['l10n'],
			'scriptTranslations' => $script_payload['translations'],
			'styleUrl'          => $style_payload['url'],
			'styleHandle'       => $style_handle,
			'styleInline'       => $style_payload['inline'],
			'tabs'              => $tab_descriptors,
		);
	}

	return $out;
}

/**
 * Converts a menu item slug to a full admin URL.
 *
 * Handles three slug shapes:
 *  1. Direct file references (`edit.php`, `upload.php`) — passed
 *     through `admin_url()` as-is.
 *  2. Plain plugin page slugs (`my-plugin`) — routed through
 *     `admin.php?page=<slug>` with the slug `rawurlencode()`d.
 *  3. Plugin page slugs that embed extra query parameters
 *     (`wc-admin&path=/customers`) — split on the first `&`, the
 *     page portion is `rawurlencode()`d, the trailing query is
 *     reparsed and reassembled with `add_query_arg()` so each
 *     value is encoded once and the `&` separators are preserved.
 *
 * The third shape is unusual but legal — WordPress's
 * `add_submenu_page()` accepts a slug containing query
 * parameters and routes them through `admin.php`. WooCommerce
 * uses this pattern for every wc-admin React route
 * (`Customers`, `Analytics`, `Marketing`). Without the split
 * branch the entire string gets `rawurlencode()`d into the
 * `page` parameter, mangling `&` to `%26` and `=` to `%3D` —
 * WC's router never sees `path` and the page renders blank.
 *
 * Returns an `esc_url_raw()`-sanitized URL — these URLs flow
 * into the dock JS payload (JSON-encoded, then assigned to
 * `iframe.src` / `window.location.href`), not into HTML
 * attributes. Using `esc_url()` would emit `&#038;` for the `&`
 * separators, which the browser does NOT decode in JS string
 * contexts — the resulting iframe load would treat `&#038;path`
 * as a literal query key and miss the `path` parameter, sending
 * WC's router back to home instead of the requested route.
 *
 * @since 0.1.0
 *
 * @param string $slug The menu item slug or URL.
 * @return string The full admin URL, sanitized via `esc_url_raw()`.
 */
function desktop_mode_menu_item_url( $slug ) {
	// Already a full URL.
	if ( str_starts_with( $slug, 'http://' ) || str_starts_with( $slug, 'https://' ) ) {
		return esc_url_raw( $slug );
	}

	// Strip path traversal sequences.
	$slug = str_replace( '..', '', $slug );

	// Direct file reference (e.g., 'edit.php', 'upload.php').
	if ( false !== strpos( $slug, '.php' ) ) {
		return esc_url_raw( admin_url( $slug ) );
	}

	// Plugin page slug with embedded query parameters
	// (e.g., 'wc-admin&path=/customers'). Split the page slug from
	// the trailing args; we'll resolve the page slug below and
	// layer the args back on at the end. This avoids the naive
	// `rawurlencode()` packing the `&` separator into `%26`.
	$extra_args = array();
	if ( false !== strpos( $slug, '&' ) ) {
		list( $slug, $tail ) = array_pad( explode( '&', $slug, 2 ), 2, '' );
		if ( '' !== $tail ) {
			parse_str( $tail, $extra_args );
		}
	}

	// Plain page slug — defer to WordPress's canonical resolver.
	//
	// `$_parent_pages` is the same global `menu_page_url()` reads;
	// we mirror its 4-line decision tree directly so we can return
	// a `esc_url_raw`-style raw URL (the `menu_page_url()` helper
	// runs its result through `esc_url()`, which entity-encodes the
	// `&` separators we need to keep raw for the downstream
	// `add_query_arg()` and the JS slug compare).
	//
	// Resolution rules, identical to core:
	//   1. Slug registered under a `.php` parent that itself isn't
	//      a parent (Tools → `tools.php?page=…`, Settings →
	//      `options-general.php?page=…`).
	//   2. Slug registered as a top-level menu, OR under a slug-
	//      based parent (WC: `woocommerce` → `admin.php?page=…`).
	//   3. Slug not registered at all → fall back to `admin.php`
	//      so the URL still targets a real dispatcher (matches the
	//      pre-resolver behavior callers depended on).
	global $_parent_pages;
	$host = 'admin.php?page=' . rawurlencode( $slug );
	if ( isset( $_parent_pages[ $slug ] ) ) {
		$parent_slug = $_parent_pages[ $slug ];
		if ( $parent_slug && ! isset( $_parent_pages[ $parent_slug ] ) ) {
			$host = add_query_arg( 'page', $slug, $parent_slug );
		}
	}

	$url = admin_url( $host );
	if ( ! empty( $extra_args ) ) {
		$url = add_query_arg( $extra_args, $url );
	}
	return esc_url_raw( $url );
}
