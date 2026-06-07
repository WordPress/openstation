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

		// The Plugins menu badge in `wp-admin/menu.php` is built from
		// `count( $update_plugins->response )` — a raw transient count
		// that can include orphan rows (deleted plugin files, entries
		// injected by third-party update servers for plugins that
		// aren't installed locally). Our Plugins window's "Update
		// available" filter only counts updates whose key intersects
		// `get_plugins()`, because every row in the window comes from
		// REST `/wp/v2/plugins` which iterates `get_plugins()`.
		// Recompute the dock badge from the same intersection so the
		// dock count always agrees with what the window shows (GH#258).
		if (
			'plugins.php' === $item[2] &&
			! is_multisite() &&
			function_exists( 'desktop_mode_plugins_window_count_visible_updates' )
		) {
			$badge = desktop_mode_plugins_window_count_visible_updates();
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
				// No `hide-if-no-customize` filter here. WordPress tags
				// Appearance → Customize / Header / Background with that
				// class; the semantics are "shown by default; hide only
				// when `<body class=\"no-customize-support\">`". The
				// Customizer is supported inside chromeless iframes, so
				// these entries belong in the dock.
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
			'multi'      => desktop_mode_dock_item_is_multi( $item[2] ),
			'placement'  => desktop_mode_dock_placement( $item[2] ),
			'isCore'     => desktop_mode_is_core_menu_slug( $item[2] ),
			'pluginFile' => desktop_mode_resolve_menu_plugin_file( $item[2] ),
			'pluginName' => null,
		);
		if ( $dock_item['pluginFile'] ) {
			$dock_item['pluginName'] = desktop_mode_plugin_display_name( $dock_item['pluginFile'] );
		}

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
 * Resolve the plugin file (e.g. `woocommerce/woocommerce.php`) that owns
 * a given top-level admin menu slug, by reflecting on the callbacks
 * registered for the menu's page hook.
 *
 * Returns the plugin's main file path (relative to `WP_PLUGIN_DIR`) when
 * the menu was registered by a regular plugin, `null` otherwise. Core
 * menus, mu-plugins, drop-ins, theme-registered menus, and Desktop Mode
 * itself all return `null` — none of these are deactivatable through the
 * `wp/v2/plugins` REST route, so the dock right-click menu should not
 * offer a deactivate action for them.
 *
 * Resolution algorithm:
 *
 *   1. Skip core menu slugs outright — `plugins.php`, `edit.php?post_type=…`,
 *      etc. are never owned by a deactivatable plugin.
 *   2. Compute the page hookname via `get_plugin_page_hookname()` and read
 *      `$wp_filter[ $hookname ]->callbacks`. This is the action list WP
 *      walks to render the menu's body — the plugin's own render callback
 *      lives here.
 *   3. Reflect each callback to find its declaring file. Match the file
 *      path against `WP_PLUGIN_DIR/<folder>/…` and use `<folder>` to look
 *      up an entry in `get_plugins()`. Return the matching `<folder>/<file>.php`.
 *   4. Exclude Desktop Mode itself — deactivating from inside the shell
 *      is handled by the plugins-window's self-deactivate path.
 *
 * @since 0.27.0
 *
 * @param string $menu_slug The menu slug from `$menu[$i][2]` (e.g. `woocommerce`,
 *                          `admin.php?page=jetpack`, `edit.php?post_type=foo`).
 * @return string|null Plugin file path relative to `WP_PLUGIN_DIR`, or null
 *                     when the slug isn't owned by a deactivatable plugin.
 */
function desktop_mode_resolve_menu_plugin_file( $menu_slug ) {
	$slug = (string) $menu_slug;

	// `get_plugin_page_hookname` + `get_plugins` come from
	// `wp-admin/includes/plugin.php`, which Core loads itself on
	// every admin request. The resolver only runs in admin context
	// (called during `admin_enqueue_scripts` and the `_admin_menu`
	// tracker), so the symbols are always available. Bail rather
	// than `require_once` something that's Core's job to load.
	if ( ! function_exists( 'get_plugin_page_hookname' ) || ! function_exists( 'get_plugins' ) ) {
		return null;
	}

	$self_basename = defined( 'DESKTOP_MODE_FILE' ) ? plugin_basename( DESKTOP_MODE_FILE ) : '';

	// Strategy 1 — registration-time attribution. The admin_menu hook
	// wrapper (see `desktop_mode_install_menu_attribution_tracker`) snapshots
	// `$menu`/`$submenu` around every admin_menu callback and records
	// "this plugin file added this slug". This is the authoritative
	// source — it captures menus whose page hook isn't predictable from
	// the slug (e.g. WC's `wc-admin&path=/marketing`) and handles
	// callbacks that simply forward to a shared renderer (which
	// reflection would mis-attribute).
	$map = desktop_mode_menu_attribution_map();
	if ( isset( $map[ $slug ] ) ) {
		$plugin_file = $map[ $slug ];
		if ( $self_basename && $plugin_file === $self_basename ) {
			return null;
		}
		return $plugin_file;
	}

	// Strategy 2 — CPT / taxonomy registration tracker. Core's `edit.php`
	// / `edit-tags.php` handle the render, so the page hook would never
	// point at the registering plugin. We caught the plugin at
	// `register_post_type()` / `register_taxonomy()` time via
	// `debug_backtrace()`.
	$tracked = desktop_mode_lookup_taxonomy_or_post_type_plugin_file( $slug );
	if ( null !== $tracked ) {
		if ( $self_basename && $tracked === $self_basename ) {
			return null;
		}
		return $tracked;
	}

	$base = strtok( $slug, '?' );

	// Cheap reject: literal core PHP files with no `?page=` parameter
	// (the universal "a plugin registered an admin route" signal). We
	// can't reuse `desktop_mode_is_core_menu_slug()` here — that
	// classifier strtok's the query string and treats `admin.php?page=foo`
	// as core, which would hide every plugin-registered top-level tile.
	if ( desktop_mode_is_pure_core_file( $base ) && false === strpos( $slug, '?page=' ) ) {
		return null;
	}

	// Strategy 3 — page-hook reflection fallback. The earlier strategies
	// can miss when a plugin is loaded after admin_menu has fired (rare),
	// or when the menu was injected by a non-admin_menu pathway. Reflect
	// on `$wp_filter[$hookname]` to find the callback's declaring file
	// and map it back to an active plugin.
	global $wp_filter;
	$hookname = get_plugin_page_hookname( $slug, '' );
	if ( empty( $hookname ) || empty( $wp_filter[ $hookname ] ) ) {
		return null;
	}

	$hook = $wp_filter[ $hookname ];
	foreach ( $hook->callbacks as $cbs ) {
		foreach ( $cbs as $cb ) {
			$plugin_file = desktop_mode_plugin_file_for_callback( $cb['function'] ?? null );
			if ( ! $plugin_file ) {
				continue;
			}
			if ( $self_basename && $plugin_file === $self_basename ) {
				return null;
			}
			return $plugin_file;
		}
	}

	return null;
}

/**
 * Look up the human-readable display name for a plugin file. Returns
 * the plugin folder name as a last-resort fallback if `get_plugins()`
 * has no entry (extremely rare — would mean the plugin file isn't
 * installed but somehow registered a menu).
 *
 * @since 0.27.0
 *
 * @param string $plugin_file Plugin file relative to `WP_PLUGIN_DIR`.
 * @return string Display name.
 */
function desktop_mode_plugin_display_name( $plugin_file ) {
	if ( ! function_exists( 'get_plugins' ) ) {
		return strtok( $plugin_file, '/' ) ?: $plugin_file;
	}
	$installed = get_plugins();
	if ( isset( $installed[ $plugin_file ]['Name'] ) && '' !== $installed[ $plugin_file ]['Name'] ) {
		return (string) $installed[ $plugin_file ]['Name'];
	}
	$folder = strtok( $plugin_file, '/' );
	return $folder ? $folder : $plugin_file;
}

/**
 * Map an arbitrary filesystem path inside `WP_PLUGIN_DIR` to the
 * corresponding plugin file in `get_plugins()`. Returns null when the
 * path isn't under the plugins directory, or doesn't match any active
 * plugin folder.
 *
 * @since 0.27.0
 *
 * @param string $file Absolute filesystem path.
 * @return string|null Plugin file (`<folder>/<file>.php`) or null.
 */
function desktop_mode_plugin_file_for_path( $file ) {
	if ( ! is_string( $file ) || '' === $file ) {
		return null;
	}
	$plugins_dir = wp_normalize_path( WP_PLUGIN_DIR );
	$norm        = wp_normalize_path( $file );
	if ( 0 !== strpos( $norm, $plugins_dir . '/' ) ) {
		return null;
	}
	if ( ! function_exists( 'get_plugins' ) ) {
		return null;
	}
	$installed = get_plugins();

	$rel    = ltrim( substr( $norm, strlen( $plugins_dir ) ), '/' );
	$folder = ( false !== strpos( $rel, '/' ) ) ? strtok( $rel, '/' ) : '';

	foreach ( $installed as $plugin_file => $_data ) {
		if ( '' !== $folder && 0 === strpos( $plugin_file, $folder . '/' ) ) {
			return $plugin_file;
		}
		if ( '' === $folder && $plugin_file === $rel ) {
			return $plugin_file;
		}
	}
	return null;
}

/**
 * Convenience wrapper: reflect on a callback to find its declaring
 * file, then map that file to an active plugin via
 * {@see desktop_mode_plugin_file_for_path()}.
 *
 * @since 0.27.0
 *
 * @param mixed $callback A WP-style callback.
 * @return string|null Plugin file or null.
 */
function desktop_mode_plugin_file_for_callback( $callback ) {
	$file = desktop_mode_callback_source_file( $callback );
	return $file ? desktop_mode_plugin_file_for_path( $file ) : null;
}

/**
 * Lazy accessor + lazy initializer for the registration-time menu
 * attribution map: `slug → plugin_file`. The map is populated by the
 * wrapped admin_menu callbacks installed by
 * {@see desktop_mode_install_menu_attribution_tracker()}.
 *
 * @since 0.27.0
 *
 * @return array<string,string>
 */
function &desktop_mode_menu_attribution_map() {
	static $map = null;
	if ( null === $map ) {
		$map = array();
	}
	return $map;
}

/**
 * Install admin_menu callback wrappers that record which plugin file
 * registered each `$menu` / `$submenu` slug.
 *
 * Approach:
 *
 *   1. Hooked on `_admin_menu` priority `-PHP_INT_MAX`, just before
 *      `admin_menu` fires.
 *   2. Walk `$wp_filter['admin_menu']->callbacks`. For each callback,
 *      reflect on the function to find its declaring file → plugin
 *      file. If the callback doesn't live in `WP_PLUGIN_DIR`, leave it
 *      alone (Core's own callbacks).
 *   3. Replace the callback in-place with a closure that snapshots
 *      `$menu` and `$submenu` keys, invokes the original, then diffs
 *      the globals. Every new top-level slug and every new submenu
 *      entry gets attributed to that plugin file.
 *
 * This is the source of truth for plugin → menu ownership because it
 * captures menus regardless of slug shape, hook name predictability,
 * or whether the plugin shares a render callback. Reflection on the
 * page hook (in `desktop_mode_resolve_menu_plugin_file`) is now a
 * fallback for the rare cases where the tracker wasn't able to install
 * in time.
 *
 * Idempotent — runs at most once per request via a static `$installed`
 * flag.
 *
 * @since 0.27.0
 *
 * @return void
 */
function desktop_mode_install_menu_attribution_tracker() {
	static $installed = false;
	if ( $installed ) {
		return;
	}
	$installed = true;

	global $wp_filter;
	if ( empty( $wp_filter['admin_menu'] ) ) {
		return;
	}
	$hook = $wp_filter['admin_menu'];

	foreach ( $hook->callbacks as $priority => $cbs ) {
		foreach ( $cbs as $id => $cb ) {
			$orig        = $cb['function'] ?? null;
			$plugin_file = desktop_mode_plugin_file_for_callback( $orig );
			if ( ! $plugin_file || ! is_callable( $orig ) ) {
				continue;
			}
			$accepted_args = (int) ( $cb['accepted_args'] ?? 1 );

			$wrapper = static function () use ( $orig, $plugin_file ) {
				global $menu, $submenu;

				$before_top_slugs = array();
				if ( is_array( $menu ) ) {
					foreach ( $menu as $entry ) {
						if ( isset( $entry[2] ) ) {
							$before_top_slugs[ (string) $entry[2] ] = true;
						}
					}
				}
				$before_submenu_keys = is_array( $submenu ) ? array_keys( $submenu ) : array();
				$before_submenu_sigs = array();
				if ( is_array( $submenu ) ) {
					foreach ( $submenu as $parent => $children ) {
						$sigs = array();
						foreach ( (array) $children as $child ) {
							if ( isset( $child[2] ) ) {
								$sigs[ (string) $child[2] ] = true;
							}
						}
						$before_submenu_sigs[ $parent ] = $sigs;
					}
				}

				$args   = func_get_args();
				$return = call_user_func_array( $orig, $args );

				$map = &desktop_mode_menu_attribution_map();

				if ( is_array( $menu ) ) {
					foreach ( $menu as $entry ) {
						if ( ! isset( $entry[2] ) ) {
							continue;
						}
						$slug = (string) $entry[2];
						if ( ! isset( $before_top_slugs[ $slug ] ) && ! isset( $map[ $slug ] ) ) {
							$map[ $slug ] = $plugin_file;
						}
					}
				}

				if ( is_array( $submenu ) ) {
					foreach ( $submenu as $parent => $children ) {
						$prev_sigs = $before_submenu_sigs[ $parent ] ?? array();
						foreach ( (array) $children as $child ) {
							if ( ! isset( $child[2] ) ) {
								continue;
							}
							$slug = (string) $child[2];
							if ( isset( $prev_sigs[ $slug ] ) ) {
								continue;
							}
							if ( ! isset( $map[ $slug ] ) ) {
								$map[ $slug ] = $plugin_file;
							}
							// Also attribute the parent if it isn't
							// already attributed and Core doesn't own it.
							// Lets a submenu-only plugin (registered
							// under a Core parent like `tools.php`) be
							// resolvable too.
						}
						if (
							! in_array( $parent, $before_submenu_keys, true )
							&& ! isset( $map[ $parent ] )
						) {
							$map[ $parent ] = $plugin_file;
						}
					}
				}

				return $return;
			};

			// Preserve the `accepted_args` metadata so callbacks
			// expecting parameters from `do_action_ref_array()` still
			// receive them. The wrapper uses `func_get_args()` so it
			// forwards everything.
			$wp_filter['admin_menu']->callbacks[ $priority ][ $id ] = array(
				'function'      => $wrapper,
				'accepted_args' => $accepted_args,
			);
		}
	}
}

add_action( '_admin_menu', 'desktop_mode_install_menu_attribution_tracker', -PHP_INT_MAX );
add_action( '_network_admin_menu', 'desktop_mode_install_menu_attribution_tracker', -PHP_INT_MAX );
add_action( '_user_admin_menu', 'desktop_mode_install_menu_attribution_tracker', -PHP_INT_MAX );

/**
 * The subset of `desktop_mode_is_core_menu_slug`'s "core files" that's
 * actually owned by Core regardless of any query string — this is what
 * we use inside the plugin-file resolver to reject Posts / Pages / etc.
 * without rejecting `admin.php?page=…` (a universal plugin signal that
 * the public is_core classifier also incorrectly treats as core for
 * legacy reasons we don't want to disturb).
 *
 * The list intentionally drops `admin.php` so plugin-registered
 * top-level pages can still be resolved.
 *
 * @since 0.27.0
 *
 * @param string $base Slug with query string already stripped.
 * @return bool True when the base filename is a Core admin handler.
 */
function desktop_mode_is_pure_core_file( $base ) {
	$core_files = array(
		'index.php',
		'edit-comments.php',
		'upload.php',
		'term.php',
		'post-new.php',
		'post.php',
		'themes.php',
		'nav-menus.php',
		'widgets.php',
		'customize.php',
		'plugins.php',
		'plugin-install.php',
		'plugin-editor.php',
		'users.php',
		'user-new.php',
		'profile.php',
		'user-edit.php',
		'tools.php',
		'import.php',
		'export.php',
		'site-health.php',
		'export-personal-data.php',
		'erase-personal-data.php',
		'options-general.php',
		'options-writing.php',
		'options-reading.php',
		'options-discussion.php',
		'options-media.php',
		'options-permalink.php',
		'options-privacy.php',
		'link-manager.php',
		'update-core.php',
	);
	return in_array( $base, $core_files, true );
}

/**
 * Resolve a CPT / taxonomy URL slug (`edit.php?post_type=X` or
 * `edit-tags.php?taxonomy=Y`) to the plugin file that registered the
 * type. The mapping is built lazily on `init` by capturing the
 * filename of whichever code called `register_post_type()` /
 * `register_taxonomy()` for non-builtin types.
 *
 * Returns null when the slug isn't a CPT / taxonomy URL, when the
 * registered type is builtin, or when the registrant lives outside
 * `WP_PLUGIN_DIR` (theme-registered or mu-plugin).
 *
 * @since 0.27.0
 *
 * @param string $slug Menu slug.
 * @return string|null Plugin file or null.
 */
function desktop_mode_lookup_taxonomy_or_post_type_plugin_file( $slug ) {
	if ( false !== strpos( $slug, 'edit.php?' ) && false !== strpos( $slug, 'post_type=' ) ) {
		$qs = wp_parse_url( 'http://x/' . ltrim( $slug, '/' ), PHP_URL_QUERY );
		parse_str( (string) $qs, $args );
		$pt = isset( $args['post_type'] ) ? (string) $args['post_type'] : '';
		if ( '' === $pt ) {
			return null;
		}
		$map = desktop_mode_get_typed_plugin_map();
		return $map['post_type'][ $pt ] ?? null;
	}
	if ( false !== strpos( $slug, 'edit-tags.php?' ) && false !== strpos( $slug, 'taxonomy=' ) ) {
		$qs = wp_parse_url( 'http://x/' . ltrim( $slug, '/' ), PHP_URL_QUERY );
		parse_str( (string) $qs, $args );
		$tx = isset( $args['taxonomy'] ) ? (string) $args['taxonomy'] : '';
		if ( '' === $tx ) {
			return null;
		}
		$map = desktop_mode_get_typed_plugin_map();
		return $map['taxonomy'][ $tx ] ?? null;
	}
	return null;
}

/**
 * Lazy accessor for the CPT/taxonomy → plugin file map. The map is
 * populated by `desktop_mode_record_type_registrant()` (hooked early on
 * `init`), so by the time the dock payload is built — on
 * `admin_enqueue_scripts`, well after `init` — every plugin-registered
 * non-builtin type has an entry. Stored in a static so repeated
 * lookups during a single request don't trigger the populator twice.
 *
 * @since 0.27.0
 *
 * @return array{post_type: array<string,string>, taxonomy: array<string,string>}
 */
function &desktop_mode_get_typed_plugin_map() {
	static $map = null;
	if ( null === $map ) {
		$map = array(
			'post_type' => array(),
			'taxonomy'  => array(),
		);
	}
	return $map;
}

/**
 * Record the registering plugin file for a CPT or taxonomy. Hooked at
 * `registered_post_type` / `registered_taxonomy` priority 9999 so we
 * fire after every other listener has run (lets a plugin re-register
 * its own type on top of someone else's — last writer wins, which
 * matches WP's runtime semantics).
 *
 * Resolution is via `debug_backtrace()`: walk frames until we hit one
 * whose `file` lives under `WP_PLUGIN_DIR`, then map the folder back
 * to a `get_plugins()` entry. Cheap — the backtrace is bounded to 12
 * frames and runs once per type registration, all during `init`.
 *
 * @since 0.27.0
 *
 * @param string $type_or_post_type Type name (CPT or taxonomy).
 * @param string $kind              Either `'post_type'` or `'taxonomy'`.
 * @return void
 */
function desktop_mode_record_type_registrant( $type_or_post_type, $kind ) {
	if ( '' === (string) $type_or_post_type ) {
		return;
	}
	// Skip Core builtin types — they're registered from Core itself
	// (Posts, Pages, Categories, …) and the backtrace would never land
	// inside WP_PLUGIN_DIR anyway. Cheap pre-filter.
	if ( 'post_type' === $kind ) {
		$obj = get_post_type_object( $type_or_post_type );
		if ( $obj && ! empty( $obj->_builtin ) ) {
			return;
		}
	} elseif ( 'taxonomy' === $kind ) {
		$obj = get_taxonomy( $type_or_post_type );
		if ( $obj && ! empty( $obj->_builtin ) ) {
			return;
		}
	}

	$plugin_file = desktop_mode_plugin_file_for_callback_backtrace();
	if ( null === $plugin_file ) {
		return;
	}
	$map = &desktop_mode_get_typed_plugin_map();
	$map[ $kind ][ $type_or_post_type ] = $plugin_file;
}

/**
 * Walk the current PHP backtrace and return the plugin file owning
 * the closest frame inside `WP_PLUGIN_DIR`. Returns null when no
 * frame qualifies or when `get_plugins()` isn't available (Core
 * hasn't loaded `wp-admin/includes/plugin.php` yet — true on
 * non-admin requests and very early admin bootstrap).
 *
 * Used by the CPT / taxonomy registration tracker to attribute
 * `register_post_type()` / `register_taxonomy()` calls without
 * forcing Core to load its admin include earlier than it would.
 *
 * @since 0.27.0
 *
 * @return string|null Plugin file or null.
 */
function desktop_mode_plugin_file_for_callback_backtrace() {
	if ( ! function_exists( 'get_plugins' ) ) {
		return null;
	}
	$bt = debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 12 );
	foreach ( $bt as $frame ) {
		if ( empty( $frame['file'] ) ) {
			continue;
		}
		$plugin_file = desktop_mode_plugin_file_for_path( (string) $frame['file'] );
		if ( null !== $plugin_file ) {
			return $plugin_file;
		}
	}
	return null;
}

add_action(
	'registered_post_type',
	static function ( $post_type ) {
		desktop_mode_record_type_registrant( $post_type, 'post_type' );
	},
	9999,
	1
);

add_action(
	'registered_taxonomy',
	static function ( $taxonomy ) {
		desktop_mode_record_type_registrant( $taxonomy, 'taxonomy' );
	},
	9999,
	1
);

/**
 * Resolve the declaring file of a hook callback. Handles closures,
 * `[ $object, 'method' ]`, `[ 'Class', 'method' ]`, plain function names,
 * and `'Class::method'` strings. Returns null when reflection fails or
 * the callback shape isn't reflectable (rare — e.g. an invocable object
 * whose `__invoke` lives in PHP core).
 *
 * @since 0.27.0
 *
 * @param mixed $callback A callback as stored in `WP_Hook::$callbacks[$prio][$id]['function']`.
 * @return string|null Absolute filesystem path of the declaring file, or null.
 */
function desktop_mode_callback_source_file( $callback ) {
	if ( empty( $callback ) ) {
		return null;
	}
	try {
		if ( is_string( $callback ) && false !== strpos( $callback, '::' ) ) {
			list( $class, $method ) = explode( '::', $callback, 2 );
			$ref = new ReflectionMethod( $class, $method );
		} elseif ( is_array( $callback ) && isset( $callback[0], $callback[1] ) ) {
			$ref = new ReflectionMethod( $callback[0], (string) $callback[1] );
		} elseif ( is_object( $callback ) && ! ( $callback instanceof Closure ) && method_exists( $callback, '__invoke' ) ) {
			$ref = new ReflectionMethod( $callback, '__invoke' );
		} elseif ( is_callable( $callback ) ) {
			$ref = new ReflectionFunction( $callback );
		} else {
			return null;
		}
		$file = $ref->getFileName();
		return $file ? $file : null;
	} catch ( ReflectionException $e ) {
		return null;
	}
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
		'serverUnfocusEffectScripts' => function_exists( 'desktop_mode_build_desktop_unfocus_effect_scripts_payload' )
			? desktop_mode_build_desktop_unfocus_effect_scripts_payload()
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
	if ( function_exists( 'desktop_mode_flush_desktop_unfocus_effect_script_registry' ) ) {
		desktop_mode_flush_desktop_unfocus_effect_script_registry();
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
