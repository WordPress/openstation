<?php
/**
 * Desktop Mode — Asset enqueue.
 *
 * Loads the desktop shell CSS + JS bundles when desktop mode is
 * active and the request isn't chromeless / classic-overridden.
 * Owns the entire `desktop_mode_enqueue_assets()` body — the
 * largest hook in the original render.php and the natural seam
 * for "what does the shell ship to the browser today?".
 *
 * Extracted from `render.php` during the architecture-0.8.1 PHP
 * slicing (phase 6).
 *
 * @package Desktop_Mode
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;

/**
 * Enqueues the desktop mode shell assets (CSS + JS) when desktop mode is active.
 *
 * Only loads the full desktop shell scripts and styles when the user has
 * desktop mode enabled and the request is not a chromeless iframe load.
 *
 * @since 0.1.0
 */
function desktop_mode_enqueue_assets() {
	if ( ! is_admin() ) {
		return;
	}

	// Auto-enqueue the iframe bridge anywhere a desktop-mode user
	// might land. The bundle self-bails when not inside an iframe
	// (`window.parent === window`), so it's a no-op on the parent
	// shell — but cheap insurance against the failure mode the
	// developer hit: an internal admin navigation drops the
	// `?desktop_mode_chromeless=1` flag, the chromeless inline bridge doesn't
	// run, and `wp.desktop.iframe` silently disappears. With this
	// auto-enqueue, the API is universally present for any same-
	// origin admin page a desktop-mode user opens — chromeless or
	// accidentally classic.
	if ( desktop_mode_is_enabled() ) {
		wp_enqueue_script( 'desktop-mode-iframe-bridge' );

		// Block Editor cross-window drop receiver. Listens for
		// `desktop-mode-drop` postMessages from the parent shell and
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
			wp_enqueue_script( 'desktop-mode-gutenberg-drop-receiver' );
		}
	}

	// Chromeless requests (iframes) need chromeless styles and overrides.
	if ( desktop_mode_is_chromeless_request() ) {
		wp_enqueue_style( 'desktop-mode' );
		wp_enqueue_style( 'desktop-mode-chromeless' );

		/**
		 * Fires when chromeless styles are enqueued inside a desktop mode iframe.
		 *
		 * Plugin and theme authors can hook here to enqueue their own CSS
		 * overrides for legacy pages rendered in chromeless mode. Use the
		 * `.desktop-mode-chromeless` body class to scope your rules.
		 *
		 * @since 0.1.0
		 */
		do_action( 'desktop_mode_chromeless_styles' );
		return;
	}

	if ( ! desktop_mode_is_enabled() || desktop_mode_is_classic_request() ) {
		return;
	}

	// CSS.
	wp_enqueue_style( 'desktop-mode' );
	wp_enqueue_style( 'desktop-mode-windows' );
	wp_enqueue_style( 'desktop-mode-dock' );
	wp_enqueue_style( 'desktop-mode-dock-peek' );
	wp_enqueue_style( 'desktop-mode-ai-assistant' );
	wp_enqueue_style( 'desktop-mode-bug-report' );
	wp_enqueue_style( 'desktop-mode-files' );

	// JS.
	wp_enqueue_script( 'desktop-mode' );

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
	if ( function_exists( 'wp_enqueue_command_palette_assets' ) ) {
		// `wp_enqueue_command_palette_assets()` calls
		// `array_key_exists( $menu_slug, $submenu )` without guarding
		// the global, so an unset `$submenu` (test contexts, edge-case
		// admin requests where the menu wasn't built yet) blows up
		// with a TypeError. Initialize defensively before calling.
		global $menu, $submenu;
		if ( ! isset( $submenu ) || ! is_array( $submenu ) ) {
			$submenu = array();
		}
		if ( ! isset( $menu ) || ! is_array( $menu ) ) {
			$menu = array();
		}
		wp_enqueue_command_palette_assets();

		// Expose the same menu-commands array WP serializes into
		// `wp.coreCommands.initializeCommandPalette(...)` on a window
		// slot the shell harvester can read. Built in PHP from `$menu`
		// / `$submenu` here (we already guarded that they're arrays
		// above), then injected as a `before` inline on our own bundle
		// — that runs synchronously before `desktop.min.js` boots the
		// shell harvester, so the lookup is guaranteed populated by
		// the time `src/commands/shell-harvester.ts` classifies any
		// command. Decoupled from WP's command-palette mount timing
		// (which fires from a core-registered hook we can't reorder).
		$menu_map = desktop_mode_build_command_menu_map();
		wp_add_inline_script(
			'desktop-mode',
			'window.__desktopModeMenuCommands = ' . wp_json_encode( $menu_map ) . ';',
			'before'
		);
	}

	// Pass configuration to JavaScript.
	global $title, $pagenow, $parent_file, $menu;

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
	// plugin-contributed top-level routes. `desktop_mode_dock_placement`
	// is the per-item filter escape hatch for hiding. Shared with the
	// REST menu endpoint so live refreshes (post plugin-activation)
	// produce the same ordering as the boot payload.
	$menu_payload    = desktop_mode_build_menu_payload();
	$dock_items      = $menu_payload['dockItems'];
	$native_windows  = isset( $menu_payload['nativeWindows'] )
		? $menu_payload['nativeWindows']
		: array();
	$server_widgets  = isset( $menu_payload['serverWidgets'] )
		? $menu_payload['serverWidgets']
		: array();
	$server_wallpapers = isset( $menu_payload['serverWallpapers'] )
		? $menu_payload['serverWallpapers']
		: array();
	$server_command_scripts = isset( $menu_payload['serverCommandScripts'] )
		? $menu_payload['serverCommandScripts']
		: array();
	$server_commands   = isset( $menu_payload['serverCommands'] )
		? $menu_payload['serverCommands']
		: array();
	$server_settings_tab_scripts = isset( $menu_payload['serverSettingsTabScripts'] )
		? $menu_payload['serverSettingsTabScripts']
		: array();
	$server_settings_tabs = isset( $menu_payload['serverSettingsTabs'] )
		? $menu_payload['serverSettingsTabs']
		: array();
	$server_dock_rail_renderer_scripts = isset( $menu_payload['serverDockRailRendererScripts'] )
		? $menu_payload['serverDockRailRendererScripts']
		: array();
	$server_titlebar_button_scripts = isset( $menu_payload['serverTitleBarButtonScripts'] )
		? $menu_payload['serverTitleBarButtonScripts']
		: array();
	$server_window_theme_scripts   = isset( $menu_payload['serverWindowThemeScripts'] )
		? $menu_payload['serverWindowThemeScripts']
		: array();
	$server_window_themes          = isset( $menu_payload['serverWindowThemes'] )
		? $menu_payload['serverWindowThemes']
		: array();
	$server_window_control_scripts = isset( $menu_payload['serverWindowControlScripts'] )
		? $menu_payload['serverWindowControlScripts']
		: array();
	$server_window_controls        = isset( $menu_payload['serverWindowControls'] )
		? $menu_payload['serverWindowControls']
		: array();
	$server_window_slot_scripts    = isset( $menu_payload['serverWindowSlotScripts'] )
		? $menu_payload['serverWindowSlotScripts']
		: array();
	$server_window_slots           = isset( $menu_payload['serverWindowSlots'] )
		? $menu_payload['serverWindowSlots']
		: array();
	$server_window_chrome_scripts  = isset( $menu_payload['serverWindowChromeScripts'] )
		? $menu_payload['serverWindowChromeScripts']
		: array();
	$server_window_chromes         = isset( $menu_payload['serverWindowChromes'] )
		? $menu_payload['serverWindowChromes']
		: array();
	$server_window_notices         = isset( $menu_payload['serverWindowNotices'] )
		? $menu_payload['serverWindowNotices']
		: array();
	$desktop_icons     = isset( $menu_payload['desktopIcons'] )
		? $menu_payload['desktopIcons']
		: array();

	// Files-on-the-Desktop payload (Phase 0+1). Plugin-registered
	// file types and openers ship as metadata only; the JS side
	// holds the executable handlers and resolves on double-click.
	$server_file_types        = function_exists( 'desktop_mode_build_file_types_payload' )
		? desktop_mode_build_file_types_payload()
		: array();
	$server_file_openers      = function_exists( 'desktop_mode_build_file_openers_payload' )
		? desktop_mode_build_file_openers_payload()
		: array();
	$user_file_associations   = function_exists( 'desktop_mode_get_user_file_associations' )
		? desktop_mode_get_user_file_associations( get_current_user_id() )
		: array();
	$server_wallpaper_menu_items = function_exists( 'desktop_mode_build_wallpaper_menu_items' )
		? desktop_mode_build_wallpaper_menu_items()
		: array();

	/*
	 * OS-file drop config — what the browser drop manager will
	 * accept when the user drags a file from their native desktop
	 * onto any surface inside Desktop Mode (wallpaper, a folder,
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
	 * @since 0.30.0
	 *
	 * @param array<string,string> $mimes_map  `ext => mime-type` map (same shape `get_allowed_mime_types()` returns).
	 * @param int                  $user_id    The current user id.
	 */
	$drop_allowed_mimes_map = apply_filters( 'desktop_mode_drop_allowed_mimes', $drop_allowed_mimes_map, get_current_user_id() );
	$drop_allowed_mimes_map = is_array( $drop_allowed_mimes_map ) ? $drop_allowed_mimes_map : array();
	$drop_allowed_mimes     = array_values( array_unique( array_values( $drop_allowed_mimes_map ) ) );

	$drop_max_size = (int) wp_max_upload_size();
	/**
	 * Filter the per-file size cap (in bytes) used by the OS-file
	 * drop manager. Returning `0` disables the client-side cap —
	 * the server still enforces its own.
	 *
	 * @since 0.30.0
	 *
	 * @param int $max_size  Default `wp_max_upload_size()`.
	 * @param int $user_id   The current user id.
	 */
	$drop_max_size = (int) apply_filters( 'desktop_mode_drop_max_size', $drop_max_size, get_current_user_id() );

	/**
	 * Filter the master OS-file drop enable gate. Lets plugins
	 * disable the drop manager by role / capability beyond the
	 * default `upload_files` check (e.g. only for admins, or
	 * only on specific multisite blogs).
	 *
	 * @since 0.30.0
	 *
	 * @param bool $enabled  Default — `current_user_can( 'upload_files' )`.
	 * @param int  $user_id  The current user id.
	 */
	$drop_enabled = (bool) apply_filters(
		'desktop_mode_drop_enabled',
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
	// About-scene, OS Settings panel, shell-overlays, window-system)
	// is `<script>`-injected by the main bundle on demand — they don't
	// go through `wp_register_script`, so they don't pick up WordPress's
	// usual `?ver=<filemtime>` cache-buster. Without one, the browser
	// happily serves a stale cached copy across plugin updates that
	// don't bump `DESKTOP_MODE_VERSION`, and the main bundle's loader
	// fires a `<script>`-loaded event for a file that's missing the
	// fresh `window.desktopMode*` factory the new code expects.
	//
	// Mirror the `$built_version( … )` helper in `includes/assets.php`:
	// prefer the on-disk mtime of the actual file, fall back to the
	// plugin version when the file is missing (dev environments where
	// the bundle hasn't been built yet).
	$suffix = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$lazy_bundle_url = static function ( $base ) use ( $suffix ) {
		$path = DESKTOP_MODE_DIR . 'assets/js/' . $base . $suffix . '.js';
		$ver  = file_exists( $path )
			? (string) filemtime( $path )
			: DESKTOP_MODE_VERSION;
		return esc_url_raw(
			DESKTOP_MODE_URL . 'assets/js/' . $base . $suffix . '.js?ver=' . $ver
		);
	};

	// Build the current page URL from $pagenow + $_GET. Strip the portal
	// markers so the derived window ID matches what the dock would produce
	// for the same page — otherwise auto-opening the entry window and
	// clicking the same dock icon would create a duplicate.
	$current_query = $_GET; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	unset( $current_query[ DESKTOP_MODE_PORTAL_FLAG ], $current_query[ DESKTOP_MODE_PORTAL_INTENT_FLAG ] );
	$current_page = admin_url( $pagenow ) . ( ! empty( $current_query ) ? '?' . http_build_query( $current_query ) : '' );

	$from_portal        = ! empty( $_GET[ DESKTOP_MODE_PORTAL_FLAG ] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$from_portal_intent = ! empty( $_GET[ DESKTOP_MODE_PORTAL_INTENT_FLAG ] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended

	/**
	 * Filters the desktop shell configuration passed to JavaScript.
	 *
	 * @since 0.1.0
	 *
	 * @param array $config {
	 *     Desktop shell configuration.
	 *
	 *     @type string $currentPage  The current admin page URL.
	 *     @type string $currentTitle The current page title.
	 *     @type string $currentIcon  Dashicon class for the current page.
	 *     @type string $adminUrl     The base admin URL.
	 *     @type string $colorScheme  The active admin color scheme.
	 *     @type array  $dockItems    Dock items derived from the admin menu. Core WordPress pages (Dashboard, Posts, Plugins, Users, Settings, CPTs…) are ordered first; plugin-contributed top-level routes (admin.php?page=*) follow. Items hidden via `desktop_mode_dock_placement` are omitted.
	 *     @type array  $nativeWindows Server-declared native windows (via `desktop_mode_register_window`). Shell registers + syncs tiles based on this list — activation/deactivation is a diff without shell reload.
	 *     @type array  $serverWidgets Server-declared right-column widgets (via `desktop_mode_register_widget`). Shell syncs the widget registry + dynamically loads plugin scripts so widgets appear in the picker without a shell reload.
	 *     @type array  $serverWallpapers Server-declared wallpapers (via `desktop_mode_register_wallpaper`). Same lifecycle — shell loads the plugin's JS, reads the full `WallpaperDef` from `window.desktopModeWallpapers[id]`, and registers / unregisters as plugins activate / deactivate.
	 *     @type array  $serverCommandScripts Script handles opted-in via `desktop_mode_register_command_script`. Shell injects each URL on activation so commands registered by `wp.desktop.registerCommand` appear in the palette live. Deactivation unregisters any commands whose `owner` matches the departing handle.
	 *     @type array  $serverCommands   Server-declared command metadata (via `desktop_mode_register_command`). Advisory today — reserved for future pre-registration shims.
	 *     @type array  $serverSettingsTabScripts Script handles opted-in via `desktop_mode_register_settings_tab_script`. Shell injects each URL on activation so tabs registered by `wp.desktop.registerSettingsTab` appear in the OS Settings window live. Deactivation unregisters tabs attributable to the departing handle.
	 *     @type array  $serverSettingsTabs Server-declared settings-tab metadata (via `desktop_mode_register_settings_tab`). Enables live unregistration on plugin deactivation without requiring JS to set `owner`.
	 *     @type array  $desktopIcons     Server-declared desktop icons (via `desktop_mode_register_icon`). Rendered on the wallpaper as clickable shortcut tiles.
	 *     @type array  $accentColors     Swatch list for the OS Settings accent picker. Filterable via `desktop_mode_accent_colors`.
	 *     @type array  $toastTypes       Toast-notification type map. Filterable via `desktop_mode_toast_types`.
	 *     @type string $defaultWallpaper Wallpaper slug applied on first boot. Filterable via `desktop_mode_default_wallpaper`.
	 *     @type array  $session      Saved session (windows, focused, updated).
	 *     @type string $sessionUrl       REST endpoint for saving the session.
	 *     @type string $mediaUrl         REST endpoint for media uploads (wp/v2/media).
	 *     @type string $restUrl          REST API root from rest_url(), safe for pretty and plain permalink installs.
	 *     @type string $defaultWindowUrl REST endpoint for saving the default-window preference.
	 *     @type array  $defaultWindow    { enabled: bool, url: string } — current default-window preference.
	 *     @type bool   $canUpload        Whether the user holds the `upload_files` capability.
	 *     @type string $pluginUrl        Plugin base URL (no trailing slash). Used by the shell to locate vendor assets and by plugins to build asset URLs.
	 *     @type string $pluginVersion    Plugin semver string. Surfaced in the OS Settings → About tab; plugins can read it to gate features by version.
	 *     @type string $restNonce        Nonce for the session REST endpoint.
	 *     @type string $portalUrl    Canonical `/desktop-mode/` URL.
	 *     @type bool   $fromPortal   Whether the shell was reached via the portal.
	 *     @type bool   $fromPortalIntent Whether the portal redirect resolved from an explicit `?target=…` (user navigation intent) rather than the session's focused window or the default-window fallback. Distinguishes a bare `/desktop-mode/` visit from a portal-redirected admin-bar click so the shell can honour the URL the user actually asked for.
	 *     @type array  $seenIntros   Slugs of one-time intro dialogs the user has dismissed (e.g. `['posts']`). Native windows gate their first-open intro on this list.
	 *     @type string $seenIntrosUrl REST endpoint for the seen-intros surface — POST `/seen` to mark, DELETE the base to reset.
	 *     @type array  $stickyNotes  { available: bool } — whether the Gutenberg Guidelines experiment (the `wp_guideline` CPT + `wp_guideline_type` taxonomy) is registered. The shell skips booting the sticky-notes layer when false, avoiding the REST probes that 404 without the experiment. See `desktop_mode_sticky_notes_is_available()`.
	 * }
	 */
	$config = apply_filters(
		'desktop_mode_shell_config',
		array(
			'currentPage'      => esc_url( $current_page ),
			'currentTitle'     => wp_strip_all_tags( $title ),
			'currentIcon'      => sanitize_html_class( $menu_icon ),
			'adminUrl'         => esc_url( admin_url() ),
			'colorScheme'      => sanitize_html_class( get_user_option( 'admin_color' ), 'fresh' ),
			'dockItems'        => $dock_items,
			'nativeWindows'    => $native_windows,
			'serverWidgets'    => $server_widgets,
			'serverWallpapers' => $server_wallpapers,
			'serverCommandScripts' => $server_command_scripts,
			'serverCommands'   => $server_commands,
			'serverSettingsTabScripts' => $server_settings_tab_scripts,
			'serverSettingsTabs' => $server_settings_tabs,
			'serverDockRailRendererScripts' => $server_dock_rail_renderer_scripts,
			'serverTitleBarButtonScripts' => $server_titlebar_button_scripts,
			'serverWindowThemeScripts'  => $server_window_theme_scripts,
			'serverWindowThemes'        => $server_window_themes,
			'serverWindowControlScripts' => $server_window_control_scripts,
			'serverWindowControls'      => $server_window_controls,
			'serverWindowSlotScripts'   => $server_window_slot_scripts,
			'serverWindowSlots'         => $server_window_slots,
			'serverWindowChromeScripts' => $server_window_chrome_scripts,
			'serverWindowChromes'       => $server_window_chromes,
			'serverWindowNotices'       => $server_window_notices,
			'desktopIcons'     => $desktop_icons,
			'serverFileTypes'        => $server_file_types,
			'serverFileOpeners'      => $server_file_openers,
			'userFileAssociations'   => $user_file_associations,
			'filesUrl'               => esc_url_raw( rest_url( 'desktop-mode/v1/files' ) ),
			'serverWallpaperMenuItems' => $server_wallpaper_menu_items,
			'accentColors'     => desktop_mode_get_accent_colors(),
			'toastTypes'       => desktop_mode_get_toast_types(),
			'defaultWallpaper' => desktop_mode_get_default_wallpaper(),
			'session'          => desktop_mode_get_session( get_current_user_id() ),
			'sessionUrl'       => esc_url_raw( rest_url( 'desktop-mode/v1/session' ) ),
			'restUrl'          => esc_url_raw( rest_url() ),
			'mediaUrl'         => esc_url_raw( rest_url( 'wp/v2/media' ) ),
			'dropConfig'       => $drop_config,
			'defaultWindowUrl' => esc_url_raw( rest_url( 'desktop-mode/v1/default-window' ) ),
			'defaultWindow'    => desktop_mode_get_default_window( get_current_user_id() ),
			'canUpload'        => current_user_can( 'upload_files' ),
			'pluginUrl'        => esc_url_raw( untrailingslashit( DESKTOP_MODE_URL ) ),
			'pluginVersion'    => DESKTOP_MODE_VERSION,
			'iframeBridgeUrl'  => $lazy_bundle_url( 'iframe-bridge' ),
			// URL of the AI Assistant lazy bundle. The main bundle
			// ships a stub matching the public `wp.desktop.ai` API; the
			// stub `<script>`-injects this URL the first time the user
			// opens the assistant. Picking `.js` vs `.min.js` here keeps
			// the SCRIPT_DEBUG gate server-side, matching iframeBridgeUrl.
			'aiAssistantBundleUrl' => $lazy_bundle_url( 'ai-assistant' ),
			// URL of the About-scene lazy bundle. The OS Settings →
			// About tab loads this on first mount; ~25 kB PixiJS
			// particle scene that would otherwise ship in the main
			// bundle for every shell load.
			'aboutSceneBundleUrl' => $lazy_bundle_url( 'about-scene' ),
			// URL of the OS Settings panel lazy bundle. Injected by
			// the main bundle's `OsSettings.renderPanel()` stub on
			// the user's first Settings open. Holds every section
			// renderer + the `<wpd-*>` components only the panel
			// uses, so nothing about Settings ships in
			// `desktop.min.js` for users who never open it.
			'osSettingsPanelBundleUrl' => $lazy_bundle_url( 'os-settings-panel' ),
			// URL of the shell-overlays lazy bundle. Pre-loaded by
			// the main bundle after first paint so action-triggered
			// overlays (toast, confirm dialog, context menus) feel
			// instant the first time they fire.
			'shellOverlaysBundleUrl' => $lazy_bundle_url( 'shell-overlays' ),
			// URL of the lazy window-system bundle (Stage 11).
			// Holds the `Window` class and its DOM / pointer / tab /
			// chrome helpers — the single largest module in the pre-
			// 0.8.4 main bundle. Loaded on first `windowManager.open()`
			// / `openNew()` call (both async since 0.8.4); pre-loaded
			// by the shell after first paint when no session is being
			// restored and no `openCurrentPage` will fire.
			'windowSystemBundleUrl' => $lazy_bundle_url( 'window-system' ),
			'restNonce'        => wp_create_nonce( 'wp_rest' ),
			'osSettings'            => desktop_mode_get_os_settings( get_current_user_id() ),
			'osSettingsUrl'         => esc_url_raw( rest_url( 'desktop-mode/v1/os-settings' ) ),
			'seenIntros'            => desktop_mode_get_seen_intros( get_current_user_id() ),
			'seenIntrosUrl'         => esc_url_raw( rest_url( 'desktop-mode/v1/intros' ) ),
			// Sticky notes ride on Gutenberg's Guidelines experiment
			// (the `wp_guideline` CPT + `wp_guideline_type` taxonomy).
			// When that experiment isn't active the `wp/v2/guidelines`
			// + `wp/v2/wp_guideline_type` probes 404 — harmless but
			// noisy — so the shell skips booting the layer entirely.
			'stickyNotes'           => array(
				'available' => desktop_mode_sticky_notes_is_available(),
			),
			'aiSearchUrl'           => esc_url_raw( rest_url( 'desktop-mode/v1/ai/search' ) ),
			'aiSearchStreamUrl'     => esc_url_raw( add_query_arg( 'action', 'desktop_mode_ai_search_stream', admin_url( 'admin-ajax.php' ) ) ),
			'aiPlatformSettings'    => current_user_can( 'manage_options' ) ? desktop_mode_ai_get_platform_settings() : null,
			'aiPlatformSettingsUrl' => esc_url_raw( rest_url( 'desktop-mode/v1/ai/platform-settings' ) ),
			'aiProviders'           => desktop_mode_ai_get_providers_for_config(),
			'extendedOptions'       => current_user_can( 'manage_options' ) ? desktop_mode_get_extended_options() : null,
			'extendedOptionsUrl'    => esc_url_raw( rest_url( 'desktop-mode/v1/extended-options' ) ),
			// Comments-window AI moderation toggle — surfaced at the
			// shell level so the OS Settings → Features tab can render
			// the toggle without depending on the Comments window
			// being registered for this user. URL is the same
			// endpoint the comments-window config exposes; state is
			// `null` for non-admins (the UI hides the row entirely).
			'commentsAiUrl'         => esc_url_raw( rest_url( 'desktop-mode/v1/comments/ai-settings' ) ),
			'commentsAi'            => current_user_can( 'manage_options' )
				? array(
					'enabled'            => function_exists( 'desktop_mode_comments_ai_is_enabled' )
						? desktop_mode_comments_ai_is_enabled()
						: false,
					'providerConfigured' => function_exists( 'desktop_mode_comments_ai_provider_configured' )
						? desktop_mode_comments_ai_provider_configured()
						: false,
				)
				: null,
			'currentUserIsAdmin'    => current_user_can( 'manage_options' ),
			'portalUrl'        => esc_url( desktop_mode_portal_url() ),
			'fromPortal'       => $from_portal,
			'fromPortalIntent' => $from_portal_intent,
			'pwa'              => array(
				'manifestUrl'    => esc_url_raw( desktop_mode_pwa_manifest_url() ),
				'swUrl'          => esc_url_raw( desktop_mode_pwa_sw_url() ),
				'stateUrl'       => esc_url_raw( rest_url( 'desktop-mode/v1/pwa-state' ) ),
				'state'          => desktop_mode_pwa_get_user_state( get_current_user_id() ),
				// Mirrors the manifest's `name` field — used by the
				// install pill so the button reads "Install <site>"
				// rather than "Install <current page>" (which would
				// be misleading: we install the whole site as an
				// app, not the dashboard window the user happens to
				// be viewing).
				'appName'        => get_bloginfo( 'name' ),
				// Operators set the `desktop_mode_pwa_force_replace_sw`
				// filter to `true` when another root-scope service
				// worker on the origin is blocking desktop-mode
				// installability (foreign-SW guard in
				// `src/pwa/sw-register.ts`). Default `false` preserves
				// the polite behaviour where we yield to existing PWAs.
				'forceReplaceSw' => desktop_mode_pwa_force_replace_sw(),
			),
		)
	);

	wp_localize_script( 'desktop-mode', 'desktopModeConfig', $config );

	/**
	 * Fires when desktop mode assets are enqueued.
	 *
	 * @since 0.1.0
	 */
	do_action( 'desktop_mode_mode_init' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_assets' );

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
 * Plugins can extend the hint list via the `desktop_mode_preload_hints`
 * filter — e.g. a settings tab whose bundle the user opens on every
 * visit can opt its own URL into the preload phase.
 *
 * Same-origin resources only — no `crossorigin` attribute. CDN hosts
 * that serve `wp-content/plugins/` from a different origin should
 * supply absolute URLs through the filter; in that case the consumer
 * is responsible for the `crossorigin` semantics.
 *
 * @since 0.8.9
 */
function desktop_mode_print_preload_hints() {
	if (
		! is_admin()
		|| ! desktop_mode_is_enabled()
		|| desktop_mode_is_chromeless_request()
		|| desktop_mode_is_classic_request()
	) {
		return;
	}

	$suffix = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';

	$build_url = static function ( $relative ) {
		$path = DESKTOP_MODE_DIR . $relative;
		$ver  = file_exists( $path ) ? (string) filemtime( $path ) : DESKTOP_MODE_VERSION;
		return DESKTOP_MODE_URL . $relative . '?ver=' . $ver;
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
	 * @since 0.8.9
	 * @since 0.9.1 Entries may carry a `rel` key (`preload` | `prefetch`).
	 *
	 * @param array $hints Default hints (main bundle + base CSS as
	 *                     `preload`; window-system + shell-overlays as
	 *                     `prefetch`).
	 */
	$hints = apply_filters( 'desktop_mode_preload_hints', $hints );

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
add_action( 'admin_print_styles', 'desktop_mode_print_preload_hints', 1 );

/**
 * Defers loading of non-critical desktop-mode stylesheets so they
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
 * Filterable via `desktop_mode_deferred_styles` so plugins can opt
 * their own non-critical stylesheets in (or pull a built-in out).
 * Chromeless iframes are skipped — their CSS pipeline is separate.
 *
 * @since 0.8.9
 *
 * @param string $html   The original <link> tag HTML.
 * @param string $handle The stylesheet handle WP is printing.
 * @param string $href   The full URL of the stylesheet.
 * @param string $media  The media attribute value WP resolved.
 * @return string Possibly-rewritten tag.
 */
function desktop_mode_defer_non_critical_styles( $html, $handle, $href, $media ) {
	// Cheap gates first — `style_loader_tag` fires once per enqueued
	// stylesheet on EVERY admin page (frontend doesn't go through
	// this filter, but admin does, including pages where desktop mode
	// is disabled). The deferred handles only ship when desktop mode
	// is active, so the in_array check below would always miss on
	// classic-only admin pages — but the `apply_filters` call still
	// builds an array and walks subscribers per stylesheet. Short-
	// circuit on the cheap helper checks (`is_admin` / enabled /
	// chromeless) so non-desktop-mode users pay nothing.
	if ( ! desktop_mode_is_enabled() ) {
		return $html;
	}
	if ( desktop_mode_is_chromeless_request() ) {
		return $html;
	}

	/**
	 * Filters the list of stylesheet handles that should be loaded
	 * deferred via the media-print-onload pattern. Plugins can add
	 * their own non-critical stylesheets here, or pull a built-in
	 * out (e.g. a plugin that surfaces the AI assistant on every
	 * page might want to keep its CSS critical-path).
	 *
	 * @since 0.8.9
	 *
	 * @param string[] $handles Default deferred handles.
	 */
	$deferred = apply_filters(
		'desktop_mode_deferred_styles',
		array(
			'desktop-mode-dock-peek',
			'desktop-mode-ai-assistant',
			'desktop-mode-bug-report',
		)
	);

	if ( ! in_array( $handle, (array) $deferred, true ) ) {
		return $html;
	}

	$resolved_media = $media ? $media : 'all';
	$id             = $handle . '-css';

	// Two contexts, two escapers for the same `$resolved_media` value:
	//
	//   - `%3$s` lands inside a JS string literal inside the HTML
	//     `onload="…"` attribute (`this.media='%3$s'`). `esc_attr`
	//     escapes `"` and `&` but NOT single quotes, so a media
	//     value containing `'` would break out of the JS string.
	//     `esc_js` is the correct escaper for "string literal inside
	//     an event-handler attribute" — escapes single quotes, double
	//     quotes, backslashes, newlines. Today `$resolved_media`
	//     comes from `wp_enqueue_style()`'s `$media` parameter (always
	//     a CSS media type / query produced by WordPress core), so
	//     this is pure defense-in-depth, but the cost is one extra
	//     function call.
	//
	//   - `%4$s` lands inside an HTML attribute in the `<noscript>`
	//     fallback (`media='%4$s'`). That's standard `esc_attr`.
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
add_filter( 'style_loader_tag', 'desktop_mode_defer_non_critical_styles', 10, 4 );

/**
 * Build the admin-menu command map (name → URL) and expose it on
 * `window.__desktopModeMenuCommands`. The shell command harvester
 * (`src/commands/shell-harvester.ts`) reads this slot to resolve URLs
 * for "Go to: …" commands whose JS callbacks
 * (`document.location = menuCommand.url`) close over a variable URL
 * we can't extract from source. Without this map those commands
 * either get skipped (no URL recoverable) or — if the location
 * shadow misses — navigate the SHELL out of desktop mode.
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
 * @since 0.8.4
 *
 * @global array $menu
 * @global array $submenu
 * @return array<int, array{label:string, url:string, name:string}>
 */
function desktop_mode_build_command_menu_map() {
	global $menu, $submenu;
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
		if ( preg_match( '/\.php($|\?)/', $menu_slug ) || wp_http_validate_url( $menu_slug ) ) {
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
				if ( preg_match( '/\.php($|\?)/', $submenu_slug ) || wp_http_validate_url( $submenu_slug ) ) {
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
