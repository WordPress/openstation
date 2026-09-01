<?php
/**
 * OpenStation — Asset enqueue.
 *
 * Loads the desktop shell CSS + JS bundles when OpenStation is
 * active and the request isn't chromeless / classic-overridden.
 * Owns the entire `openstation_enqueue_assets()` body — the
 * largest hook in the original render.php and the natural seam
 * for "what does the shell ship to the browser today?".
 *
 * Extracted from `render.php` during the architecture-0.8.1 PHP
 * slicing (phase 6).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Enqueues the OpenStation shell assets (CSS + JS) when OpenStation is active.
 *
 * Only loads the full desktop shell scripts and styles when the user has
 * OpenStation enabled and the request is not a chromeless iframe load.
 */
function openstation_enqueue_assets() {
	if ( ! is_admin() ) {
		return;
	}

	// Auto-enqueue the iframe bridge anywhere a openstation user
	// might land. The bundle self-bails when not inside an iframe
	// (`window.parent === window`), so it's a no-op on the parent
	// shell — but cheap insurance against the failure mode the
	// developer hit: an internal admin navigation drops the
	// `?openstation_chromeless=1` flag, the chromeless inline bridge doesn't
	// run, and `wp.os.iframe` silently disappears. With this
	// auto-enqueue, the API is universally present for any same-
	// origin admin page a openstation user opens — chromeless or
	// accidentally classic.
	if ( openstation_is_enabled() ) {
		wp_enqueue_script( 'os-iframe-bridge' );

		// Block Editor cross-window drop receiver. Listens for
		// `os-drop` postMessages from the parent shell and
		// inserts the matching block. Only enqueue inside the
		// post-edit Block Editor screens — every other admin page
		// would be paying for a bundle it never uses.
		//
		// `site-editor.php` (full-site editor) deliberately omitted:
		// the FSE doesn't expose `wp.data.dispatch('core/block-editor')`
		// until the user opens a template in the canvas iframe, so
		// drops arriving before that point would silently time out
		// after the receiver's 5 s `waitForEditor()` poll. Re-enable
		// once we have a reliable readiness signal in that context.
		global $hook_suffix;
		if ( 'post.php' === $hook_suffix || 'post-new.php' === $hook_suffix ) {
			wp_enqueue_script( 'os-gutenberg-drop-receiver' );
		}
	}

	// Chromeless requests (iframes) need chromeless styles and overrides.
	if ( openstation_is_chromeless_request() ) {
		wp_enqueue_style( 'openstation' );
		wp_enqueue_style( 'os-chromeless' );

		/**
		 * Fires when chromeless styles are enqueued inside a OpenStation iframe.
		 *
		 * Plugin and theme authors can hook here to enqueue their own CSS
		 * overrides for legacy pages rendered in chromeless mode. Use the
		 * `.os-chromeless` body class to scope your rules.
		 */
		do_action( 'openstation_chromeless_styles' );
		return;
	}

	if ( ! openstation_is_shell_request() ) {
		return;
	}

	// CSS. Only the sheets that paint surfaces present at boot — the
	// shell chrome, the dock, desktop tiles and pinned notes. Sheets
	// for on-demand surfaces (Preferences panel, AI assistant, bug
	// report) ship as `deferredStyles` in the config blob below and
	// inject on first open; a native window's sheet rides its
	// registration's `styles` companion list the same way.
	wp_enqueue_style( 'openstation' );
	wp_enqueue_style( 'os-windows' );
	wp_enqueue_style( 'os-window-overview' );
	wp_enqueue_style( 'os-dock' );
	wp_enqueue_style( 'os-dock-peek' );
	wp_enqueue_style( 'os-tray' );
	wp_enqueue_style( 'os-shortcuts' );
	wp_enqueue_style( 'os-openstation-layout' );
	wp_enqueue_style( 'os-files' );
	wp_enqueue_style( 'os-notes' );

	// Solo mode — a single window freed into a native OS window by the
	// desktop host. Same shell, everything but that one window hidden.
	$solo_window = openstation_solo_window_id();
	if ( '' !== $solo_window ) {
		wp_enqueue_style( 'os-solo' );

		/*
		 * Hide every window that is not the one this surface was booted
		 * to paint — from the first frame, before any of them exist.
		 *
		 * Solo mode promises one window. Anything that opens a second
		 * (a game launched from a freed Games hub, a plugin calling
		 * `openWindow`) would otherwise land on top of the first, and
		 * solo's CSS stretches every window to fill the viewport, so it
		 * covers what the user was using.
		 *
		 * This has to be CSS rather than JavaScript, and it has to be
		 * inline. A JS rule can only run once the window exists, which
		 * is a frame too late — the user sees the newcomer flash before
		 * it is dealt with. A static stylesheet cannot express it
		 * either, because the selector depends on which window this is.
		 * So the rule is emitted with the id baked in, and no window but
		 * that one is ever painted.
		 *
		 * `visibility` rather than `display`: a hidden-but-laid-out
		 * window still has a size, which canvas-based windows need in
		 * order to initialise without dividing by zero on the way to
		 * being closed.
		 *
		 * The id is `sanitize_key()`-clean (see `openstation_solo_window_id()`),
		 * so it is safe in a selector; it is escaped again here because
		 * the distance between those two facts is exactly where this
		 * kind of bug lives.
		 */
		wp_add_inline_style(
			'os-solo',
			sprintf(
				'body.os-solo .os-window:not(#wp-window-%1$s){visibility:hidden !important;pointer-events:none !important;}',
				esc_attr( $solo_window )
			)
		);
	}

	// The rebrand announcement paints on one visit per user and never
	// again, so its stylesheet is only worth sending to the users who
	// are actually going to see it. Computed once here and reused for
	// the `rebrandNotice` config key below, which reads the same answer.
	$show_rebrand_notice = openstation_should_show_rebrand_notice();
	if ( $show_rebrand_notice ) {
		wp_enqueue_style( 'os-announce' );
	}

	// JS.
	wp_enqueue_script( 'openstation' );

	// `wp_enqueue_command_palette_assets()` (WP 6.9+) enqueues the
	// `wp-commands` store package, the `wp-core-commands` script that
	// registers the WordPress-wide baseline (Add new post, Manage
	// plugins, Switch theme, Browse patterns, …) AND — critically —
	// the inline `wp.coreCommands.initializeCommandPalette( … )` call
	// that actually populates the `core/commands` data store with the
	// admin-menu commands. Without that inline init, the script loads
	// but the store stays empty and `src/commands/shell-harvester.ts`
	// finds nothing to publish.
	//
	// WP normally only calls this on screens that opt in to the native
	// palette; the shell needs it on every admin URL it might wrap.
	// `function_exists` guard for pre-6.9 sites — the harvester gracefully
	// no-ops when the store is missing.
	// See `openstation_defer_core_command_palette()` below for why
	// Core's own boot-time enqueue is unhooked on shell pages.
	//
	// The Core command-palette runtime is NOT enqueued here any more.
	// Its dependency chain is the whole Gutenberg runtime (~800 KB
	// gzipped across forty-odd bundles), paid on every boot for a ⌘K
	// palette most sessions never open. It now ships as an ordered
	// manifest in the config blob (`commandPalette`, built by
	// `openstation_build_command_palette_assets_payload()`), and
	// `src/commands/palette-assets.ts` replays it the first time the
	// palette is invoked. The shell harvester keeps its idle-time
	// `install()` — a graceful no-op until the store exists — and
	// re-installs on `os-command-palette-ready`.
	$command_palette = openstation_build_command_palette_assets_payload();

	if ( function_exists( 'wp_enqueue_command_palette_assets' ) ) {
		// Expose the same menu-commands array WP serializes into
		// `wp.coreCommands.initializeCommandPalette(...)` on a window
		// slot the shell harvester can read. Built in PHP from `$menu`
		// / `$submenu`, then injected as a `before` inline on our own
		// bundle — that runs synchronously before `desktop.min.js`
		// boots the shell harvester, so the lookup is guaranteed
		// populated by the time `src/commands/shell-harvester.ts`
		// classifies any command. Decoupled from WP's command-palette
		// mount timing (which fires from a core-registered hook we
		// can't reorder) — and, since the palette bundles went lazy,
		// from whether they have loaded at all.
		$menu_map = openstation_build_command_menu_map();
		wp_add_inline_script(
			'openstation',
			'window.__openStationMenuCommands = ' . wp_json_encode( $menu_map ) . ';',
			'before'
		);
	}

	// Pass configuration to JavaScript.
	global $title, $parent_file, $menu;

	$menu_icon = 'dashicons-admin-generic';
	if ( ! empty( $parent_file ) && ! empty( $menu ) ) {
		foreach ( $menu as $item ) {
			if ( ! empty( $item[2] ) && $item[2] === $parent_file && ! empty( $item[6] ) ) {
				$menu_icon = $item[6];
				break;
			}
		}
	}

	// Build dock items from the admin menu. Core pages are ordered
	// first (Dashboard, Posts, Plugins, Users, Settings, …), then
	// plugin-contributed top-level routes. `openstation_dock_placement`
	// is the per-item filter escape hatch for hiding. Shared with the
	// REST menu endpoint so live refreshes (post plugin-activation)
	// produce the same ordering as the boot payload.
	$menu_payload                      = openstation_build_menu_payload();
	$dock_items                        = $menu_payload['dockItems'];
	$native_windows                    = isset( $menu_payload['nativeWindows'] )
		? $menu_payload['nativeWindows']
		: array();

	// The BOOT page prints every registry window's template as a real
	// `<template>` tag (`openstation_render_native_window_templates()`,
	// admin_footer @ 20 — before footer scripts, so the tags are in
	// the DOM before the shell boots and `ensureTemplate()` adopts
	// them by id). The payload's `templateHtml` copy exists for the
	// MID-SESSION path — a bridge or probe payload delivering a
	// window whose plugin activated after the page rendered — so on
	// the boot config it is ~27 KB of the same markup twice. Strip it
	// here, and only here: the bridge and probe payloads keep theirs.
	foreach ( $native_windows as &$native_window_row ) {
		if ( is_array( $native_window_row ) ) {
			$native_window_row['templateHtml'] = '';
		}
	}
	unset( $native_window_row );
	$native_window_script_data         = isset( $menu_payload['nativeWindowScriptData'] )
		? $menu_payload['nativeWindowScriptData']
		: array();
	$server_widgets                    = isset( $menu_payload['serverWidgets'] )
		? $menu_payload['serverWidgets']
		: array();
	$server_wallpapers                 = isset( $menu_payload['serverWallpapers'] )
		? $menu_payload['serverWallpapers']
		: array();
	$server_command_scripts            = isset( $menu_payload['serverCommandScripts'] )
		? $menu_payload['serverCommandScripts']
		: array();
	$server_commands                   = isset( $menu_payload['serverCommands'] )
		? $menu_payload['serverCommands']
		: array();
	$server_settings_tab_scripts       = isset( $menu_payload['serverSettingsTabScripts'] )
		? $menu_payload['serverSettingsTabScripts']
		: array();
	$server_settings_tabs              = isset( $menu_payload['serverSettingsTabs'] )
		? $menu_payload['serverSettingsTabs']
		: array();
	$server_dock_rail_renderer_scripts = isset( $menu_payload['serverDockRailRendererScripts'] )
		? $menu_payload['serverDockRailRendererScripts']
		: array();
	$server_titlebar_button_scripts    = isset( $menu_payload['serverTitleBarButtonScripts'] )
		? $menu_payload['serverTitleBarButtonScripts']
		: array();
	$server_window_action_scripts      = isset( $menu_payload['serverWindowActionScripts'] )
		? $menu_payload['serverWindowActionScripts']
		: array();
	$server_window_theme_scripts       = isset( $menu_payload['serverWindowThemeScripts'] )
		? $menu_payload['serverWindowThemeScripts']
		: array();
	$server_window_themes              = isset( $menu_payload['serverWindowThemes'] )
		? $menu_payload['serverWindowThemes']
		: array();
	$server_window_control_scripts     = isset( $menu_payload['serverWindowControlScripts'] )
		? $menu_payload['serverWindowControlScripts']
		: array();
	$server_window_controls            = isset( $menu_payload['serverWindowControls'] )
		? $menu_payload['serverWindowControls']
		: array();
	$server_window_slot_scripts        = isset( $menu_payload['serverWindowSlotScripts'] )
		? $menu_payload['serverWindowSlotScripts']
		: array();
	$server_window_slots               = isset( $menu_payload['serverWindowSlots'] )
		? $menu_payload['serverWindowSlots']
		: array();
	$server_window_chrome_scripts      = isset( $menu_payload['serverWindowChromeScripts'] )
		? $menu_payload['serverWindowChromeScripts']
		: array();
	$server_window_chromes             = isset( $menu_payload['serverWindowChromes'] )
		? $menu_payload['serverWindowChromes']
		: array();
	$server_window_notices             = isset( $menu_payload['serverWindowNotices'] )
		? $menu_payload['serverWindowNotices']
		: array();
	$server_games                      = isset( $menu_payload['serverGames'] )
		? $menu_payload['serverGames']
		: array();
	// Boot-time copy of the desktop-theme library. Without it the
	// shell's registry seeds EMPTY, and the consequences are subtle
	// rather than obvious: PHP has already applied the user's theme
	// server-side (stylesheet + shell attribute), but the client
	// can't resolve the slug to an entry, so it believes nothing is
	// active. Themed ICONS never paint, and switching back to the
	// system default no-ops the first time — `applyDesktopTheme()`
	// dedupes on an `activeId` that was never set.
	$server_desktop_themes = isset( $menu_payload['serverDesktopThemes'] )
		? $menu_payload['serverDesktopThemes']
		: array();

	// Slim the theme library for BOOT: `cssText` and `tokens` are
	// each ~20 KB per theme, and neither is read at boot — the ACTIVE
	// theme's stylesheet is server-delivered (see
	// `openstation_enqueue_desktop_theme_style()`, whose stamp
	// `bootAlreadyApplied()` detects), and an inactive theme's CSS
	// only matters at the moment the user picks it in the Preferences
	// picker — which fetches the full entries from
	// `GET desktop-mode/v1/desktop-themes` (`ensureFullDesktopThemes()`
	// client-side). `cssDeferred` marks the gap so the shell can tell
	// a slimmed entry from a theme that genuinely ships no CSS.
	// Bridge and probe payloads keep full entries.
	foreach ( $server_desktop_themes as &$desktop_theme_row ) {
		if ( is_array( $desktop_theme_row ) ) {
			$desktop_theme_row['cssText']     = '';
			$desktop_theme_row['tokens']      = new stdClass();
			$desktop_theme_row['cssDeferred'] = true;
		}
	}
	unset( $desktop_theme_row );
	$desktop_icons         = isset( $menu_payload['desktopIcons'] )
		? $menu_payload['desktopIcons']
		: array();

	// Files-on-the-Desktop payload (Phase 0+1). Plugin-registered
	// file types and openers ship as metadata only; the JS side
	// holds the executable handlers and resolves on double-click.
	$server_file_types           = function_exists( 'openstation_build_file_types_payload' )
		? openstation_build_file_types_payload()
		: array();
	$server_file_openers         = function_exists( 'openstation_build_file_openers_payload' )
		? openstation_build_file_openers_payload()
		: array();
	$user_file_associations      = function_exists( 'openstation_get_user_file_associations' )
		? openstation_get_user_file_associations( get_current_user_id() )
		: array();
	$server_wallpaper_menu_items = function_exists( 'openstation_build_wallpaper_menu_items' )
		? openstation_build_wallpaper_menu_items()
		: array();

	/*
	 * OS-file drop config — what the browser drop manager will
	 * accept when the user drags a file from their native desktop
	 * onto any surface inside OpenStation (wallpaper, a folder,
	 * a window, or a chromeless iframe). The allowed-mimes list is
	 * the user-scoped `get_allowed_mime_types()` (already capability
	 * gated by WordPress); the size cap is `wp_max_upload_size()`.
	 *
	 * Both are filterable so plugins can narrow or widen the set —
	 * e.g. a media-only plugin can restrict drops to images, or a
	 * docs plugin can opt PDFs in for a specific role.
	 */
	$drop_allowed_mimes_map = current_user_can( 'upload_files' )
		? get_allowed_mime_types( get_current_user_id() )
		: array();
	/**
	 * Filter the allowed-mime map used by the OS-file drop manager.
	 *
	 * @param array<string,string> $mimes_map  `ext => mime-type` map (same shape `get_allowed_mime_types()` returns).
	 * @param int                  $user_id    The current user id.
	 */
	$drop_allowed_mimes_map = apply_filters( 'openstation_drop_allowed_mimes', $drop_allowed_mimes_map, get_current_user_id() );
	$drop_allowed_mimes_map = is_array( $drop_allowed_mimes_map ) ? $drop_allowed_mimes_map : array();
	$drop_allowed_mimes     = array_values( array_unique( array_values( $drop_allowed_mimes_map ) ) );

	$drop_max_size = (int) wp_max_upload_size();
	/**
	 * Filter the per-file size cap (in bytes) used by the OS-file
	 * drop manager. Returning `0` disables the client-side cap —
	 * the server still enforces its own.
	 *
	 * @param int $max_size  Default `wp_max_upload_size()`.
	 * @param int $user_id   The current user id.
	 */
	$drop_max_size = (int) apply_filters( 'openstation_drop_max_size', $drop_max_size, get_current_user_id() );

	/**
	 * Filter the master OS-file drop enable gate. Lets plugins
	 * disable the drop manager by role / capability beyond the
	 * default `upload_files` check (e.g. only for admins, or
	 * only on specific multisite blogs).
	 *
	 * @param bool $enabled  Default — `current_user_can( 'upload_files' )`.
	 * @param int  $user_id  The current user id.
	 */
	$drop_enabled = (bool) apply_filters(
		'openstation_drop_enabled',
		current_user_can( 'upload_files' ),
		get_current_user_id()
	);

	$drop_config = array(
		'enabled'      => $drop_enabled,
		'allowedMimes' => $drop_allowed_mimes,
		'extToMime'    => $drop_allowed_mimes_map,
		'maxSize'      => $drop_max_size,
	);

	// Lazy-bundle URL builder. Each lazy-loaded bundle (AI Assistant,
	// OS Settings panel, shell-overlays, window-system)
	// is `<script>`-injected by the main bundle on demand — they don't
	// go through `wp_register_script`, so they don't pick up WordPress's
	// usual `?ver=<filemtime>` cache-buster. Without one, the browser
	// happily serves a stale cached copy across plugin updates that
	// don't bump `OPENSTATION_VERSION`, and the main bundle's loader
	// fires a `<script>`-loaded event for a file that's missing the
	// fresh `window.openStation*` factory the new code expects.
	//
	// Mirror the `$built_version( … )` helper in `includes/assets.php`:
	// prefer the on-disk mtime of the actual file, fall back to the
	// plugin version when the file is missing (dev environments where
	// the bundle hasn't been built yet).
	$suffix          = openstation_asset_suffix();
	$lazy_bundle_url = static function ( $base ) use ( $suffix ) {
		$path = OPENSTATION_DIR . 'assets/js/' . $base . $suffix . '.js';
		$ver  = file_exists( $path )
			? (string) filemtime( $path )
			: OPENSTATION_VERSION;
		return esc_url_raw(
			OPENSTATION_URL . 'assets/js/' . $base . $suffix . '.js?ver=' . $ver
		);
	};

	// The page the shell opens first. On the shell screen it is the
	// validated `target` query arg (else the session's focused window,
	// the default window, the Dashboard); on a solo boot it is the
	// request's own URL. Either way the frozen portal flags are gone
	// from it, so the derived window id matches what the dock would
	// produce for the same page — otherwise auto-opening the entry
	// window and clicking the same dock icon would create a duplicate.
	$boot_target        = openstation_shell_boot_target();
	$current_page       = $boot_target['url'];
	$from_portal        = $boot_target['fromPortal'];
	$from_portal_intent = $boot_target['fromPortalIntent'];

	// On the shell screen `$title` and `$parent_file` describe the
	// screen ("OpenStation", no menu), not the page about to open. The
	// dock entry for that page is the identity the entry window folds
	// into, so its title and icon are the right first paint; the iframe
	// reports its own title once it lands either way.
	$current_title = wp_strip_all_tags( (string) $title );
	if ( openstation_is_shell_screen_request() ) {
		$boot_meta     = openstation_shell_boot_target_meta( $current_page, $dock_items );
		$current_title = wp_strip_all_tags( $boot_meta['title'] );
		if ( '' !== $boot_meta['icon'] ) {
			$menu_icon = $boot_meta['icon'];
		}
	}

	/**
	 * Filters the desktop shell configuration passed to JavaScript.
	 *
	 * @param array $config {
	 *     Desktop shell configuration.
	 *
	 *     @type string $currentPage  The current admin page URL.
	 *     @type string $currentTitle The current page title.
	 *     @type string $currentIcon  Dashicon class for the current page.
	 *     @type string $adminUrl     The base admin URL.
	 *     @type string $colorScheme  The active admin color scheme.
	 *     @type array  $dockItems    Dock items derived from the admin menu. Core WordPress pages (Dashboard, Posts, Plugins, Users, Settings, CPTs…) are ordered first; plugin-contributed top-level routes (admin.php?page=*) follow. Items hidden via `openstation_dock_placement` are omitted.
	 *     @type array  $nativeWindows Server-declared native windows (via `openstation_register_window`). Shell registers + syncs tiles based on this list — activation/deactivation is a diff without shell reload.
	 *     @type array  $serverWidgets Server-declared right-column widgets (via `openstation_register_widget`). Shell syncs the widget registry + dynamically loads plugin scripts so widgets appear in the picker without a shell reload.
	 *     @type array  $serverWallpapers Server-declared wallpapers (via `openstation_register_wallpaper`). Same lifecycle — shell loads the plugin's JS, reads the full `WallpaperDef` from `window.openStationWallpapers[id]`, and registers / unregisters as plugins activate / deactivate.
	 *     @type array  $serverCommandScripts Script handles opted-in via `openstation_register_command_script`. Shell injects each URL on activation so commands registered by `wp.os.registerCommand` appear in the palette live. Deactivation unregisters any commands whose `owner` matches the departing handle.
	 *     @type array  $serverCommands   Server-declared command metadata (via `openstation_register_command`). Advisory today — reserved for future pre-registration shims.
	 *     @type array  $serverSettingsTabScripts Script handles opted-in via `openstation_register_settings_tab_script`. Shell injects each URL on activation so tabs registered by `wp.os.registerSettingsTab` appear in the OS Settings window live. Deactivation unregisters tabs attributable to the departing handle.
	 *     @type array  $serverSettingsTabs Server-declared settings-tab metadata (via `openstation_register_settings_tab`). Enables live unregistration on plugin deactivation without requiring JS to set `owner`.
	 *     @type array  $desktopIcons     Server-declared desktop icons (via `openstation_register_icon`). Rendered on the wallpaper as clickable shortcut tiles.
	 *     @type array  $accentColors     Swatch list for the OS Settings accent picker. Filterable via `openstation_accent_colors`.
	 *     @type array  $toastTypes       Toast-notification type map. Filterable via `openstation_toast_types`.
	 *     @type string $defaultWallpaper Wallpaper slug applied on first boot. Filterable via `openstation_default_wallpaper`.
	 *     @type array  $session      Saved session (windows, focused, updated).
	 *     @type string $sessionUrl       REST endpoint for saving the session.
	 *     @type string $mediaUrl         REST endpoint for media uploads (wp/v2/media).
	 *     @type string $restUrl          REST API root from rest_url(), safe for pretty and plain permalink installs.
	 *     @type string $defaultWindowUrl REST endpoint for saving the default-window preference.
	 *     @type array  $defaultWindow    { enabled: bool, url: string } — current default-window preference.
	 *     @type bool   $canUpload        Whether the user holds the `upload_files` capability.
	 *     @type string $pluginUrl        Plugin base URL (no trailing slash). Used by the shell to locate vendor assets and by plugins to build asset URLs.
	 *     @type string $pluginVersion    Plugin semver string. Surfaced in the OS Settings → About tab; plugins can read it to gate features by version.
	 *     @type string $aboutFeedUrl     Authenticated admin-AJAX URL that returns the cached OpenStation journal feed for the About tab.
	 *     @type string $restNonce        Nonce for the session REST endpoint.
	 *     @type string $soloWindow   Window id when the shell was asked to paint exactly one window (`?openstation_solo=<id>`); '' otherwise. No dock, taskbar, wallpaper or desk, and no session restore.
	 *     @type string $portalUrl    Canonical `/openstation/` URL.
	 *     @type bool   $fromPortal   Whether the shell was reached via the portal.
	 *     @type bool   $fromPortalIntent Whether the portal redirect resolved from an explicit `?target=…` (user navigation intent) rather than the session's focused window or the default-window fallback. Distinguishes a bare `/openstation/` visit from a portal-redirected admin-bar click so the shell can honour the URL the user actually asked for.
	 *     @type array  $seenIntros   Slugs of one-time announcements the user has dismissed (e.g. `['openstation-rebrand']`).
	 *     @type string $seenIntrosUrl REST endpoint for the seen-intros surface — POST `/seen` to mark, DELETE the base to reset.
	 *     @type bool   $rebrandNotice Whether to offer this user the one-off announcement explaining the rename from Desktop Mode to OpenStation. True only when migration 5 flagged this user as a Desktop Mode user from before the rename AND they haven't dismissed the `openstation-rebrand` intro. Only ever present in the shell config, so the announcement never reaches the classic admin.
	 * }
	 */
	$config = apply_filters(
		'openstation_shell_config',
		array(
			'currentPage'                   => esc_url( $current_page ),
			'currentTitle'                  => $current_title,
			'currentIcon'                   => sanitize_html_class( $menu_icon ),
			'adminUrl'                      => esc_url( admin_url() ),
			'homeUrl'                       => esc_url( home_url( '/' ) ),
			// Decoded: the shell assigns this to `window.location`,
			// where `&amp;` would make `_wpnonce` arrive as
			// `amp;_wpnonce` and fail the nonce check.
			'logoutUrl'                     => esc_url_raw(
				html_entity_decode( wp_logout_url(), ENT_QUOTES, 'UTF-8' )
			),
			'colorScheme'                   => sanitize_html_class( get_user_option( 'admin_color' ), 'fresh' ),
			'dockItems'                     => $dock_items,
			// Baseline menu fingerprint. The shell seeds its last-known
			// signature from this so the first off-allowlist menu change
			// (vs. this boot state) is caught without a wasted probe. GH#325.
			'menuSig'                       => isset( $menu_payload['menuSig'] ) ? (string) $menu_payload['menuSig'] : '',
			'nativeWindows'                 => $native_windows,
			// Handle-keyed script data the entries above reference —
			// one copy per bundle, not one per window. See
			// `openstation_collect_native_windows_payload()`.
			'nativeWindowScriptData'        => $native_window_script_data,
			'serverWidgets'                 => $server_widgets,
			'serverWallpapers'              => $server_wallpapers,
			'serverCommandScripts'          => $server_command_scripts,
			'serverCommands'                => $server_commands,
			'serverSettingsTabScripts'      => $server_settings_tab_scripts,
			'serverSettingsTabs'            => $server_settings_tabs,
			'serverDockRailRendererScripts' => $server_dock_rail_renderer_scripts,
			'serverTitleBarButtonScripts'   => $server_titlebar_button_scripts,
			'serverWindowActionScripts'     => $server_window_action_scripts,
			'serverWindowThemeScripts'      => $server_window_theme_scripts,
			'serverWindowThemes'            => $server_window_themes,
			'serverWindowControlScripts'    => $server_window_control_scripts,
			'serverWindowControls'          => $server_window_controls,
			'serverWindowSlotScripts'       => $server_window_slot_scripts,
			'serverWindowSlots'             => $server_window_slots,
			'serverWindowChromeScripts'     => $server_window_chrome_scripts,
			'serverWindowChromes'           => $server_window_chromes,
			'serverWindowNotices'           => $server_window_notices,
			// Boot-time copy of the payload's `serverGames` — the same
			// list the live-refresh path applies. Without it the games
			// registry only fills after the first chromeless
			// full-payload refresh and the Games hub boots empty.
			'serverGames'                   => $server_games,
			'serverDesktopThemes'           => $server_desktop_themes,
			'desktopIcons'                  => $desktop_icons,
			'serverFileTypes'               => $server_file_types,
			'serverFileOpeners'             => $server_file_openers,
			'userFileAssociations'          => $user_file_associations,
			'filesUrl'                      => esc_url_raw( rest_url( 'desktop-mode/v1/files' ) ),
			// Pinned-notes REST base (`includes/notes/rest.php`). The
			// notes layer boots only when this is present.
			'notesUrl'                      => esc_url_raw( rest_url( 'desktop-mode/v1/notes' ) ),
			// Gates the "Convert to post" note affordance — the convert
			// route (and its dock drop target) only make sense for users
			// who can author posts.
			'canCreatePosts'                => current_user_can( 'edit_posts' ),
			'serverWallpaperMenuItems'      => $server_wallpaper_menu_items,
			'accentColors'                  => openstation_get_accent_colors(),
			'toastTypes'                    => openstation_get_toast_types(),
			'coreUpdate'                    => openstation_get_core_update(),
			'coreNotices'                   => openstation_get_core_notices(),
			'pluginNotices'                 => openstation_get_plugin_notices(),
			'defaultWallpaper'              => openstation_get_default_wallpaper(),
			'session'                       => openstation_get_session( get_current_user_id() ),
			'sessionUrl'                    => esc_url_raw( rest_url( 'desktop-mode/v1/session' ) ),
			'restUrl'                       => esc_url_raw( rest_url() ),
			'mediaUrl'                      => esc_url_raw( rest_url( 'wp/v2/media' ) ),
			'dropConfig'                    => $drop_config,
			'defaultWindowUrl'              => esc_url_raw( rest_url( 'desktop-mode/v1/default-window' ) ),
			'defaultWindow'                 => openstation_get_default_window( get_current_user_id() ),
			'canUpload'                     => current_user_can( 'upload_files' ),
			'pluginUrl'                     => esc_url_raw( untrailingslashit( OPENSTATION_URL ) ),
			'pluginVersion'                 => OPENSTATION_VERSION,
			'aboutFeedUrl'                  => esc_url_raw(
				add_query_arg(
					array(
						'action' => 'openstation_about_feed',
						'nonce'  => wp_create_nonce( 'openstation_about_feed' ),
					),
					admin_url( 'admin-ajax.php' )
				)
			),
			'iframeBridgeUrl'               => $lazy_bundle_url( 'iframe-bridge' ),
			// URL of the AI Assistant lazy bundle. The main bundle
			// ships a stub matching the public `wp.os.ai` API; the
			// stub `<script>`-injects this URL the first time the user
			// opens the assistant. Picking `.js` vs `.min.js` here keeps
			// the SCRIPT_DEBUG gate server-side, matching iframeBridgeUrl.
			'aiAssistantBundleUrl'          => $lazy_bundle_url( 'ai-assistant' ),
			// URL of the OS Settings panel lazy bundle. Injected by
			// the main bundle's `OsSettings.renderPanel()` stub on
			// the user's first Settings open. Holds every section
			// renderer + the `<os-*>` components only the panel
			// uses, so nothing about Settings ships in
			// `desktop.min.js` for users who never open it.
			'osSettingsPanelBundleUrl'      => $lazy_bundle_url( 'os-settings-panel' ),
			// URL of the shell-overlays lazy bundle. Pre-loaded by
			// the main bundle after first paint so action-triggered
			// overlays (toast, confirm dialog, context menus) feel
			// instant the first time they fire.
			'shellOverlaysBundleUrl'        => $lazy_bundle_url( 'shell-overlays' ),
			// The shell-bundle diet: features whose right moment is a
			// user gesture (or a presence signal) ride their own
			// bundles instead of the boot-critical `desktop[.min].js`.
			// Each sentinel in the shell loads its bundle at that
			// moment — see the entry file each bundle names.
			'fileDropBundleUrl'             => $lazy_bundle_url( 'file-drop' ),
			'filesOverlaysBundleUrl'        => $lazy_bundle_url( 'files-overlays' ),
			'notesBundleUrl'                => $lazy_bundle_url( 'notes' ),
			'dockConstellationBundleUrl'    => $lazy_bundle_url( 'dock-constellation' ),
			'windowLinkVisualsBundleUrl'    => $lazy_bundle_url( 'window-link-visuals' ),
			// Presence hint for the notes sentinel: a desktop with no
			// notes skips the notes bundle AND the boot-time list
			// request. Two id-only existence probes at most.
			'hasNotes'                      => function_exists( 'openstation_notes_user_has_any' )
				? openstation_notes_user_has_any()
				: false,
			// URL of the full `<os-*>` component kit. The shell
			// never loads this — its own bundles import the
			// components they render. It exists for
			// `wp.os.loadComponents()`, i.e. for plugin code that
			// CANNOT import: a plugin shipped as a zip has no path
			// to this repo at build time, so before this URL its
			// only routes to a `<os-switch>` were to bundle a second
			// copy or hand-roll one. Shipping the URL costs one
			// string and keeps the SCRIPT_DEBUG choice server-side.
			'componentsBundleUrl'           => $lazy_bundle_url( 'os-components' ),
			// Mio — the desk companion. `mio` carries the
			// appearance + physics (see `openstation_mio_config()`);
			// `mioBundleUrl` is the lazy PixiJS bundle the shell
			// controller injects the first time a user switches the
			// Mio on from its dock tile. Shipping the URL
			// unconditionally costs one short string and keeps the
			// SCRIPT_DEBUG choice server-side, matching every other
			// lazy bundle here.
			//
			// Both keys ship whether or not the user has Mio on,
			// and that is the whole of its cost to a shell that doesn't:
			// ~470 bytes gzipped of config, plus a URL. No script, no
			// style, no PixiJS. The config has to be here rather than
			// fetched on first toggle, or the `openstation_mio_config`
			// filter would silently not apply until the next reload.
			'mio'                           => openstation_mio_config(),
			'mioBundleUrl'                  => $lazy_bundle_url( 'mio' ),
			// URL of the lazy window-system bundle (Stage 11).
			// Holds the `Window` class and its DOM / pointer / tab /
			// chrome helpers — the single largest module split out of
			// the main bundle. Loaded on first `windowManager.open()`
			// / `openNew()` call (both async); pre-loaded
			// by the shell after first paint when no session is being
			// restored and no `openCurrentPage` will fire.
			'windowSystemBundleUrl'         => $lazy_bundle_url( 'window-system' ),
			// URL of the item-visibility-menu lazy bundle — the
			// right-click "hide from dock / desktop" menu. Injected by
			// the main bundle's loader shim on the first right-click.
			'itemVisibilityMenuBundleUrl'   => $lazy_bundle_url( 'item-visibility-menu' ),
			// URL of the release-card lazy bundle — the vinyl core-
			// update announcement. Injected by `maybeShowUpdate()` only
			// when a core update is actually pending.
			'releaseCardBundleUrl'          => $lazy_bundle_url( 'release-card' ),
			'restNonce'                     => wp_create_nonce( 'wp_rest' ),
			// Non-empty when the shell was asked to paint exactly one
			// window and nothing else. See `OPENSTATION_SOLO_FLAG`.
			'soloWindow'                    => openstation_solo_window_id(),
			'osSettings'                    => openstation_get_os_settings( get_current_user_id() ),
			'osSettingsUrl'                 => esc_url_raw( rest_url( 'desktop-mode/v1/os-settings' ) ),
			'seenIntros'                    => openstation_get_seen_intros( get_current_user_id() ),
			'seenIntrosUrl'                 => esc_url_raw( rest_url( 'desktop-mode/v1/intros' ) ),
			// True only for a user migration 5 flagged as a Desktop Mode
			// user from before the rename, who hasn't dismissed the
			// announcement yet. Same value that gated `os-announce`
			// above; the dialog cannot paint without that stylesheet, so
			// the two must not diverge.
			'rebrandNotice'                 => $show_rebrand_notice,
			'aiSearchUrl'                   => esc_url_raw( rest_url( 'desktop-mode/v1/ai/search' ) ),
			// AI assistant availability + per-user toggle. Drives whether the
			// Cmd+K palette and admin-bar icon appear, and the setup placeholder.
			'aiAssistant'                   => function_exists( 'openstation_ai_assistant_config' )
				? openstation_ai_assistant_config()
				: null,
			// Lets the Features tab re-check provider availability without a
			// reload after a connector is configured in Settings → Connectors.
			'aiStatusUrl'                   => esc_url_raw( rest_url( 'desktop-mode/v1/ai/status' ) ),
			'extendedOptions'               => current_user_can( 'manage_options' ) ? openstation_get_extended_options() : null,
			'extendedOptionsUrl'            => esc_url_raw( rest_url( 'desktop-mode/v1/extended-options' ) ),
			// Site-wide games kill switch (Extended options). Exposed to
			// every user — the shell skips the challenges Heartbeat
			// channel when the framework is off.
			'gamesEnabled'                  => openstation_games_enabled(),
			// Comments-window AI moderation toggle — surfaced at the
			// shell level so the OS Settings → Features tab can render
			// the toggle without depending on the Comments window
			// being registered for this user. URL is the same
			// endpoint the comments-window config exposes; state is
			// `null` for non-admins (the UI hides the row entirely).
			'commentsAiUrl'                 => esc_url_raw( rest_url( 'desktop-mode/v1/comments/ai-settings' ) ),
			// Non-null only for admins on a site where the Core AI stack is
			// present. Comment scoring routes through the AI Client (WP 7.0+),
			// so on older WordPress the whole row is hidden — same as the
			// assistant toggle — rather than shown disabled pointing at a
			// Settings → Connectors screen that doesn't exist there.
			'commentsAi'                    => (
				current_user_can( 'manage_options' )
				&& function_exists( 'openstation_ai_is_available' )
				&& openstation_ai_is_available()
			)
				? array(
					'enabled'            => function_exists( 'openstation_comments_ai_is_enabled' )
						? openstation_comments_ai_is_enabled()
						: false,
					'providerConfigured' => function_exists( 'openstation_comments_ai_provider_configured' )
						? openstation_comments_ai_provider_configured()
						: false,
				)
				: null,
			'currentUserIsAdmin'            => current_user_can( 'manage_options' ),
			'portalUrl'                     => esc_url( openstation_portal_url() ),
			'fromPortal'                    => $from_portal,
			'fromPortalIntent'              => $from_portal_intent,
			'pwa'                           => array(
				'manifestUrl'    => esc_url_raw( openstation_pwa_manifest_url() ),
				'swUrl'          => esc_url_raw( openstation_pwa_sw_url() ),
				// Extensionless retry target for hosts whose nginx 404s
				// virtual .js paths before WordPress runs (WordPress.com).
				'swFallbackUrl'  => esc_url_raw( openstation_pwa_sw_fallback_url() ),
				// The worker's per-user flags, computed HERE rather than
				// baked into the served `sw.js`.
				//
				// A service worker is origin-wide but these are per-user
				// preferences, so putting them in the script bytes made
				// the body differ between an anonymous and a logged-in
				// request — and any in-scope logged-out navigation then
				// installed a "new" worker and tripped the shell's
				// `controllerchange` reload. The bytes are identical for
				// everyone now; the shell posts these to the worker at
				// boot.
				//
				// Computed server-side, not read from the settings
				// snapshot client-side, because
				// `openstation_pwa_admin_asset_cache_enabled()` applies
				// the `openstation_pwa_admin_asset_cache` filter — an
				// operator's site-wide veto has to keep working.
				'swConfig'       => array(
					'adminAssetCache' => (bool) openstation_pwa_admin_asset_cache_enabled(),
					'windowPrewarm'   => ! empty( openstation_get_os_settings( get_current_user_id() )['windowPrewarmEnabled'] ),
				),
				'stateUrl'       => esc_url_raw( rest_url( 'desktop-mode/v1/pwa-state' ) ),
				'state'          => openstation_pwa_get_user_state( get_current_user_id() ),
				// Mirrors the manifest's `name` field — used by the
				// install pill so the button reads "Install <site>"
				// rather than "Install <current page>" (which would
				// be misleading: we install the whole site as an
				// app, not the dashboard window the user happens to
				// be viewing).
				'appName'        => get_bloginfo( 'name' ),
				// Operators set the `openstation_pwa_force_replace_sw`
				// filter to `true` when another root-scope service
				// worker on the origin is blocking openstation
				// installability (foreign-SW guard in
				// `src/pwa/sw-register.ts`). Default `false` preserves
				// the polite behaviour where we yield to existing PWAs.
				'forceReplaceSw' => openstation_pwa_force_replace_sw(),
			),
			// Ordered Core command-palette asset manifest, replayed on
			// first palette invocation. `null` on pre-6.9 sites.
			'commandPalette'                => $command_palette,
			// Stylesheets for shell surfaces that render on demand —
			// the Preferences panel, the AI assistant, the bug-report
			// window. None of them is a server-registered native
			// window (they are built client-side by the shell
			// bundle), so the `styles` companion mechanism can't
			// carry their CSS; instead the shell injects each sheet
			// the first time its surface opens, via
			// `ensureDeferredStyle()` in `src/deferred-styles.ts`.
			// Same resolved shape a native window's `styleUrl` /
			// `styleInline` travels in.
			// Which of the `deferredStyles` entries a game needs.
			// `launchGame()` injects these before the window paints.
			'gameStyleHandles'              => function_exists( 'openstation_games_style_handles' )
				? openstation_games_style_handles()
				: array(),
			'deferredStyles'                => openstation_build_deferred_styles(
				array_merge(
					array(
						'os-settings',
						'desktop-mode-ai-assistant',
						'desktop-mode-bug-report',
						// WP Explorer's sheet. It rides that window as a
						// companion style, but the desktop FOLDER window
						// paints its preview pane with the same
						// `os-my-wordpress__*` classes and — being a
						// native window opened straight from JS — carries
						// no companion styles of its own. Without this,
						// the pane rendered unstyled until WP Explorer
						// had been opened once in the session.
						'desktop-mode-my-wordpress',
					),
					// The Games sheets. They also ride the hub window as
					// companion styles, but a game is reachable without
					// the hub — the challenge toast, solo mode, and
					// `wp.os.games.launch()` all land in `launchGame()`
					// with no hub window in the tab. Listing them here
					// costs a URL each in the boot config and no CSS
					// until `launchGame()` asks.
					function_exists( 'openstation_games_style_handles' )
						? openstation_games_style_handles()
						: array()
				)
			),
		)
	);

	wp_localize_script( 'openstation', 'openStationConfig', $config );

	/**
	 * Fires when OpenStation assets are enqueued.
	 */
	do_action( 'openstation_mode_init' );
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_assets' );

/**
 * Keep Core's boot-time command-palette enqueue off shell pages.
 *
 * WordPress 7.0 hooks `wp_enqueue_command_palette_assets()` on
 * `admin_enqueue_scripts` by default, which puts the palette's whole
 * dependency chain — the Gutenberg runtime, ~800 KB gzipped — on
 * every admin page. On a SHELL page that is pure dead weight: the
 * shell suppresses Core's palette unconditionally (the ⌘K keystroke
 * and the admin-bar icon both route to the shell's own palette), so
 * the runtime it powers can never be shown. Unhooking here lets the
 * deferred manifest (`openstation_build_command_palette_assets_payload()`)
 * capture the chain instead, and the shell loads it on the first
 * palette invocation.
 *
 * Deliberately scoped: classic-mode requests keep Core's default,
 * because a classic page is Core's own UI where Core's palette is the
 * right one.
 *
 * Windows are handled separately by
 * {@see openstation_chromeless_should_trim_command_palette()} in
 * `includes/render/chromeless-trim.php` — same idea, but it has to
 * drop the whole palette *family* rather than just unhook Core's
 * callback, and it exempts block-editor screens. Unhooking alone is
 * not enough there: a third-party palette extension that declares
 * `wp-commands` keeps the entire chain queued as its dependency.
 *
 * Priority 0, ahead of Core's default 10, so the removal lands
 * before the callback fires. On WP 6.9 (function exists, no default
 * hook) the `remove_action()` is a harmless no-op.
 */
function openstation_defer_core_command_palette() {
	if ( ! openstation_is_shell_request() ) {
		return;
	}
	remove_action( 'admin_enqueue_scripts', 'wp_enqueue_command_palette_assets' );
}
add_action( 'admin_enqueue_scripts', 'openstation_defer_core_command_palette', 0 );

/**
 * Emits `<link rel="preload">` hints for the shell's critical-path
 * assets so the browser starts fetching them as soon as it parses
 * the document `<head>`.
 *
 * Without this, the browser doesn't discover the main `desktop.min.js`
 * bundle URL until it parses the footer `<script>` tag — typically
 * ~1 RTT after the rest of the page has started loading. For a 464 KB
 * bundle on a midrange phone that's a measurable FCP delay; on a
 * slow connection it dominates first paint entirely.
 *
 * Hooked at `admin_print_styles @ 1` so the preload tags land in
 * `<head>` BEFORE the regular `<link rel="stylesheet">` tags (which
 * default to priority 10) and well before the footer `<script>`
 * tag. The `wp_resource_hints` filter is frontend-only (`wp_head`-
 * driven) and isn't invoked in admin context, so we emit our own
 * tags.
 *
 * Four targets by default, split across two relationship types:
 *   - `desktop[.min].js`  (preload)  — the shell bundle (biggest win),
 *     consumed by the footer `<script>` on this very load.
 *   - `desktop.css`       (preload)  — shell base CSS, needed for first
 *     paint. Its registered handle is `filemtime`-stamped so the
 *     stylesheet URL matches this hint exactly (a `?ver=` mismatch makes
 *     the browser treat the preload as unused).
 *   - `window-system[.min].js`  (prefetch) — lazy bundle `<script>`-
 *     injected by the main bundle on the first `open()`.
 *   - `shell-overlays[.min].js` (prefetch) — lazy bundle injected on the
 *     first toast / dialog / context-menu.
 *
 * The lazy bundles use `prefetch` rather than `preload`: they're loaded
 * later (often beyond the ~3s window Chrome allows a `preload` before it
 * warns "preloaded but not used in time"), so `prefetch` keeps the early
 * low-priority cache fill without the must-use-now contract.
 *
 * Plugins can extend the hint list via the `openstation_preload_hints`
 * filter — e.g. a settings tab whose bundle the user opens on every
 * visit can opt its own URL into the preload phase.
 *
 * Same-origin resources only — no `crossorigin` attribute. CDN hosts
 * that serve `wp-content/plugins/` from a different origin should
 * supply absolute URLs through the filter; in that case the consumer
 * is responsible for the `crossorigin` semantics.
 */
function openstation_print_preload_hints() {
	if ( ! openstation_is_shell_request() ) {
		return;
	}

	$suffix = openstation_asset_suffix();

	$build_url = static function ( $relative ) {
		$path = OPENSTATION_DIR . $relative;
		$ver  = file_exists( $path ) ? (string) filemtime( $path ) : OPENSTATION_VERSION;
		return OPENSTATION_URL . $relative . '?ver=' . $ver;
	};

	$hints = array(
		// Critical path — consumed on this very page load (the footer
		// `<script>` and the shell stylesheet), so `preload` is correct.
		array(
			'href' => $build_url( 'assets/js/desktop' . $suffix . '.js' ),
			'as'   => 'script',
			'rel'  => 'preload',
		),
		array(
			'href' => $build_url( 'assets/css/desktop.css' ),
			'as'   => 'style',
			'rel'  => 'preload',
		),
		// Lazy bundles — `<script>`-injected by the main bundle after
		// first paint (window-system on the first `open()`, shell-overlays
		// on the first toast / dialog / context-menu). They are frequently
		// NOT requested within the ~3s window Chrome allows a `preload`,
		// which produced "resource was preloaded but not used in time"
		// warnings. `prefetch` is the right hint: same early, low-priority
		// fetch into the cache, but no must-use-now contract — so the
		// injected `<script src>` is served from cache with no warning.
		array(
			'href' => $build_url( 'assets/js/window-system' . $suffix . '.js' ),
			'as'   => 'script',
			'rel'  => 'prefetch',
		),
		array(
			'href' => $build_url( 'assets/js/shell-overlays' . $suffix . '.js' ),
			'as'   => 'script',
			'rel'  => 'prefetch',
		),
	);

	/**
	 * Filters the list of resource preload hints emitted in `<head>`.
	 *
	 * Each entry is a `{ 'href' => string, 'as' => string,
	 * 'rel' => 'preload'|'prefetch' }` array rendered as
	 * `<link rel="<rel>" as="<as>" href="<href>">`. `rel` is optional and
	 * defaults to `preload`; any value other than `prefetch` is coerced
	 * back to `preload`. Unrecognized entries are silently skipped — keep
	 * the contract permissive so a misconfigured plugin can't tank first
	 * paint.
	 *
	 * @param array $hints Default hints (main bundle + base CSS as
	 *                     `preload`; window-system + shell-overlays as
	 *                     `prefetch`).
	 */
	$hints = apply_filters( 'openstation_preload_hints', $hints );

	if ( ! is_array( $hints ) ) {
		return;
	}

	foreach ( $hints as $hint ) {
		if ( ! is_array( $hint ) ) {
			continue;
		}
		$href = isset( $hint['href'] ) ? (string) $hint['href'] : '';
		$as   = isset( $hint['as'] ) ? (string) $hint['as'] : '';
		if ( '' === $href || '' === $as ) {
			continue;
		}
		// `preload` (critical, used on this load) vs `prefetch` (lazy,
		// used on a later interaction). Anything else falls back to
		// `preload` so a typo can't emit an invalid relationship.
		$rel = isset( $hint['rel'] ) ? (string) $hint['rel'] : 'preload';
		if ( 'prefetch' !== $rel ) {
			$rel = 'preload';
		}
		printf(
			'<link rel="%s" as="%s" href="%s" />' . "\n",
			esc_attr( $rel ),
			esc_attr( $as ),
			esc_url( $href )
		);
	}
}
add_action( 'admin_print_styles', 'openstation_print_preload_hints', 1 );

/**
 * Defers loading of non-critical openstation stylesheets so they
 * don't block first paint.
 *
 * Three stylesheets in the default enqueue list are only needed
 * after a user interaction — `dock-peek` (mouseover a dock tile),
 * `ai-assistant` (Cmd+K palette), `bug-report` (Report-a-bug
 * window). With the normal `<link rel="stylesheet">` tag they sit
 * on the critical path and the browser blocks first paint waiting
 * for them, even though nothing on screen needs them yet.
 *
 * The well-known mitigation is the `media="print" onload="…"`
 * pattern:
 *
 *   <link rel="stylesheet" media="print"
 *         onload="this.media='all'; this.onload=null" href="…">
 *   <noscript><link rel="stylesheet" href="…"></noscript>
 *
 * `media="print"` makes the browser treat the sheet as
 * non-applicable to the current display, so it downloads with
 * low priority and doesn't block render. The `onload` handler
 * swaps `media` to the original value once the bytes arrive
 * (within ms of page load), making the styles take effect long
 * before the user clicks anything that needs them. The
 * `<noscript>` fallback restores critical-path behavior for JS-off
 * browsers, so accessibility isn't degraded.
 *
 * Filterable via `openstation_deferred_styles` so plugins can opt
 * their own non-critical stylesheets in (or pull a built-in out).
 * Chromeless iframes are skipped — their CSS pipeline is separate.
 *
 * @param string $html   The original <link> tag HTML.
 * @param string $handle The stylesheet handle WP is printing.
 * @param string $href   The full URL of the stylesheet.
 * @param string $media  The media attribute value WP resolved.
 * @return string Possibly-rewritten tag.
 */
function openstation_defer_non_critical_styles( $html, $handle, $href, $media ) {
	// Cheap gates first — `style_loader_tag` fires once per enqueued
	// stylesheet on EVERY admin page (frontend doesn't go through
	// this filter, but admin does, including pages where OpenStation
	// is disabled). The deferred handles only ship when OpenStation
	// is active, so the in_array check below would always miss on
	// classic-only admin pages — but the `apply_filters` call still
	// builds an array and walks subscribers per stylesheet. Short-
	// circuit on the cheap helper checks (`is_admin` / enabled /
	// chromeless) so non-openstation users pay nothing.
	if ( ! openstation_is_enabled() ) {
		return $html;
	}
	if ( openstation_is_chromeless_request() ) {
		return $html;
	}

	/**
	 * Filters the list of stylesheet handles that should be loaded
	 * deferred via the media-print-onload pattern. Plugins can add
	 * their own non-critical stylesheets here, or pull a built-in
	 * out (e.g. a plugin that surfaces the AI assistant on every
	 * page might want to keep its CSS critical-path).
	 *
	 * @param string[] $handles Default deferred handles.
	 */
	$deferred = apply_filters(
		'openstation_deferred_styles',
		array(
			'os-dock-peek',
			'os-openstation-layout',
			'desktop-mode-ai-assistant',
			'desktop-mode-bug-report',
			'os-window-overview',
			'os-settings',
		)
	);

	if ( ! in_array( $handle, (array) $deferred, true ) ) {
		return $html;
	}

	$resolved_media = $media ? $media : 'all';
	$id             = $handle . '-css';

	// Two contexts, two escapers for the same `$resolved_media` value:
	//
	// - `%3$s` lands inside a JS string literal inside the HTML
	// `onload="…"` attribute (`this.media='%3$s'`). `esc_attr`
	// escapes `"` and `&` but NOT single quotes, so a media
	// value containing `'` would break out of the JS string.
	// `esc_js` is the correct escaper for "string literal inside
	// an event-handler attribute" — escapes single quotes, double
	// quotes, backslashes, newlines. Today `$resolved_media`
	// comes from `wp_enqueue_style()`'s `$media` parameter (always
	// a CSS media type / query produced by WordPress core), so
	// this is pure defense-in-depth, but the cost is one extra
	// function call.
	//
	// - `%4$s` lands inside an HTML attribute in the `<noscript>`
	// fallback (`media='%4$s'`). That's standard `esc_attr`.
	//
	// phpcs:disable WordPress.WP.EnqueuedResources.NonEnqueuedStylesheet -- This filter rewrites a tag WordPress is in the process of emitting for an already-registered+enqueued stylesheet handle; the linter doesn't trace the `style_loader_tag` filter context, so the raw <link rel="stylesheet"> output is a false-positive.
	$markup = sprintf(
		'<link rel=\'stylesheet\' id=\'%1$s\' href=\'%2$s\' media=\'print\' onload="this.media=\'%3$s\'; this.onload=null;" />' . "\n" .
			'<noscript><link rel=\'stylesheet\' id=\'%1$s-noscript\' href=\'%2$s\' media=\'%4$s\' /></noscript>' . "\n",
		esc_attr( $id ),
		esc_url( $href ),
		esc_js( $resolved_media ),
		esc_attr( $resolved_media )
	);
	// phpcs:enable WordPress.WP.EnqueuedResources.NonEnqueuedStylesheet

	return $markup;
}
add_filter( 'style_loader_tag', 'openstation_defer_non_critical_styles', 10, 4 );

/**
 * Build the admin-menu command map (name → URL) and expose it on
 * `window.__openStationMenuCommands`. The shell command harvester
 * (`src/commands/shell-harvester.ts`) reads this slot to resolve URLs
 * for "Go to: …" commands whose JS callbacks
 * (`document.location = menuCommand.url`) close over a variable URL
 * we can't extract from source. Without this map those commands
 * either get skipped (no URL recoverable) or — if the location
 * shadow misses — navigate the SHELL out of OpenStation.
 *
 * Mirrors what WordPress core's `wp_enqueue_command_palette_assets()`
 * builds for `wp.coreCommands.initializeCommandPalette(...)`. We
 * duplicate the logic here (instead of monkey-patching the JS init
 * which is timing-sensitive — WP registers its hook during core load,
 * so it always emits its inline before any plugin-added inline on the
 * same handle) and ship the result through `wp_add_inline_script` on
 * our own bundle handle. That decouples us entirely from WP's command-
 * palette mount timing.
 *
 * @global array $menu
 * @global array $submenu
 * @return array<int, array{label:string, url:string, name:string}>
 */
function openstation_build_command_menu_map() {
	global $menu, $submenu, $_parent_pages;
	if ( ! is_array( $menu ) ) {
		return array();
	}
	$out = array();

	$extract_root_text = static function ( $label ) {
		if ( '' === $label || ! is_string( $label ) ) {
			return '';
		}
		if ( class_exists( 'WP_HTML_Tag_Processor' ) ) {
			$processor = new WP_HTML_Tag_Processor( $label );
			$text      = '';
			$depth     = 0;
			while ( $processor->next_token() ) {
				$token_type = $processor->get_token_type();
				if ( '#text' === $token_type && 0 === $depth ) {
					$text .= $processor->get_modifiable_text();
				}
				if ( '#tag' === $token_type ) {
					if ( $processor->is_tag_closer() ) {
						if ( $depth > 0 ) {
							--$depth;
						}
						continue;
					}
					$name = $processor->get_tag();
					if ( $name && ! ( class_exists( 'WP_HTML_Processor' ) && WP_HTML_Processor::is_void( $name ) ) ) {
						++$depth;
					}
				}
			}
			return trim( $text );
		}
		return trim( wp_strip_all_tags( $label ) );
	};

	foreach ( $menu as $menu_item ) {
		if ( empty( $menu_item[0] ) || ! is_string( $menu_item[0] ) ) {
			continue;
		}
		if ( ! empty( $menu_item[1] ) && ! current_user_can( $menu_item[1] ) ) {
			continue;
		}
		$menu_label = $extract_root_text( $menu_item[0] );
		$menu_slug  = $menu_item[2];
		$menu_url   = '';
		// Registered plugin pages win over the direct-file test: a
		// legacy file-path slug ('wp-sweep/admin.php') matches the
		// `.php` regex yet must route through menu_page_url(). The
		// exception is URL-style slugs referencing a real admin file
		// (ACF's 'edit.php?post_type=acf-field-group' — also a
		// registered page) — those stay direct links, matching
		// classic admin's menu-header.php.
		if ( ( ! isset( $_parent_pages[ $menu_slug ] ) || openstation_is_admin_file_slug( $menu_slug ) ) && ( preg_match( '/\.php($|\?)/', $menu_slug ) || wp_http_validate_url( $menu_slug ) ) ) {
			$menu_url = $menu_slug;
		} elseif ( ! empty( menu_page_url( $menu_slug, false ) ) ) {
			$menu_url = menu_page_url( $menu_slug, false );
		}
		if ( '' !== $menu_url ) {
			$out[] = array(
				'label' => $menu_label,
				'url'   => $menu_url,
				'name'  => $menu_slug,
			);
		}
		if ( ! empty( $submenu ) && is_array( $submenu ) && array_key_exists( $menu_slug, $submenu ) ) {
			foreach ( $submenu[ $menu_slug ] as $submenu_item ) {
				if ( empty( $submenu_item[0] ) ) {
					continue;
				}
				if ( ! empty( $submenu_item[1] ) && ! current_user_can( $submenu_item[1] ) ) {
					continue;
				}
				$submenu_label = $extract_root_text( $submenu_item[0] );
				$submenu_slug  = $submenu_item[2];
				$submenu_url   = '';
				// Same registered-page vs admin-file rule as the
				// top-level loop.
				if ( ( ! isset( $_parent_pages[ $submenu_slug ] ) || openstation_is_admin_file_slug( $submenu_slug ) ) && ( preg_match( '/\.php($|\?)/', $submenu_slug ) || wp_http_validate_url( $submenu_slug ) ) ) {
					$submenu_url = $submenu_slug;
				} elseif ( ! empty( menu_page_url( $submenu_slug, false ) ) ) {
					$submenu_url = menu_page_url( $submenu_slug, false );
				}
				if ( '' === $submenu_url ) {
					continue;
				}
				$out[] = array(
					'label' => sprintf(
						/* translators: 1: parent menu label, 2: submenu label */
						__( '%1$s > %2$s', 'desktop-mode' ),
						$menu_label,
						$submenu_label
					),
					'url'   => $submenu_url,
					'name'  => $menu_slug . '-' . $submenu_item[2],
				);
			}
		}
	}
	return $out;
}
