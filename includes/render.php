<?php
/**
 * Desktop Mode rendering.
 *
 * Handles body-class tagging, shell markup injection, asset enqueueing,
 * and the chromeless bridge script that lives inside iframed admin pages.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Adds body classes for desktop mode and chromeless iframes.
 *
 * The classes anchor all CSS in the shell and chromeless overrides
 * stylesheets — `.wp-desktop-active` hides classic chrome and reveals
 * the shell, `.wp-desktop-chromeless` reshapes the page inside iframes.
 *
 * @since 0.1.0
 *
 * @param string $classes Space-separated CSS class string.
 * @return string
 */
function desktop_mode_admin_body_classes( $classes ) {
	if ( desktop_mode_is_chromeless_request() ) {
		return ltrim( $classes . ' wp-desktop-chromeless' );
	}

	// Per-request classic override: don't tag the body as desktop-active so
	// the classic chrome isn't hidden by CSS for this one tab.
	if ( desktop_mode_is_classic_request() ) {
		return $classes;
	}

	if ( desktop_mode_is_enabled() ) {
		return ltrim( $classes . ' wp-desktop-active' );
	}

	return $classes;
}
add_filter( 'admin_body_class', 'desktop_mode_admin_body_classes' );

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
	// `?wp_desktop=1` flag, the chromeless inline bridge doesn't
	// run, and `wp.desktop.iframe` silently disappears. With this
	// auto-enqueue, the API is universally present for any same-
	// origin admin page a desktop-mode user opens — chromeless or
	// accidentally classic.
	if ( desktop_mode_is_enabled() ) {
		wp_enqueue_script( 'wp-desktop-iframe-bridge' );
	}

	// Chromeless requests (iframes) need chromeless styles and overrides.
	if ( desktop_mode_is_chromeless_request() ) {
		wp_enqueue_style( 'wp-desktop' );
		wp_enqueue_style( 'wp-desktop-chromeless' );

		/**
		 * Fires when chromeless styles are enqueued inside a desktop mode iframe.
		 *
		 * Plugin and theme authors can hook here to enqueue their own CSS
		 * overrides for legacy pages rendered in chromeless mode. Use the
		 * `.wp-desktop-chromeless` body class to scope your rules.
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
	wp_enqueue_style( 'wp-desktop' );
	wp_enqueue_style( 'wp-desktop-windows' );
	wp_enqueue_style( 'wp-desktop-dock' );
	wp_enqueue_style( 'wp-desktop-dock-peek' );
	wp_enqueue_style( 'wp-desktop-ai-assistant' );
	wp_enqueue_style( 'wp-desktop-bug-report' );

	// JS.
	wp_enqueue_script( 'wp-desktop' );

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
	$desktop_icons     = isset( $menu_payload['desktopIcons'] )
		? $menu_payload['desktopIcons']
		: array();

	// Build the current page URL from $pagenow + $_GET. Strip the portal
	// marker so the derived window ID matches what the dock would produce
	// for the same page — otherwise auto-opening the entry window and
	// clicking the same dock icon would create a duplicate.
	$current_query = $_GET; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	unset( $current_query[ DESKTOP_MODE_PORTAL_FLAG ] );
	$current_page = admin_url( $pagenow ) . ( ! empty( $current_query ) ? '?' . http_build_query( $current_query ) : '' );

	$from_portal = ! empty( $_GET[ DESKTOP_MODE_PORTAL_FLAG ] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended

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
	 *     @type array  $serverWallpapers Server-declared wallpapers (via `desktop_mode_register_wallpaper`). Same lifecycle — shell loads the plugin's JS, reads the full `WallpaperDef` from `window.wpDesktopWallpapers[id]`, and registers / unregisters as plugins activate / deactivate.
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
	 *     @type string $defaultWindowUrl REST endpoint for saving the default-window preference.
	 *     @type array  $defaultWindow    { enabled: bool, url: string } — current default-window preference.
	 *     @type bool   $canUpload        Whether the user holds the `upload_files` capability.
	 *     @type string $pluginUrl        Plugin base URL (no trailing slash). Used by the shell to locate vendor assets and by plugins to build asset URLs.
	 *     @type string $restNonce        Nonce for the session REST endpoint.
	 *     @type string $portalUrl    Canonical `/wp-desktop/` URL.
	 *     @type bool   $fromPortal   Whether the shell was reached via the portal.
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
			'desktopIcons'     => $desktop_icons,
			'accentColors'     => desktop_mode_get_accent_colors(),
			'toastTypes'       => desktop_mode_get_toast_types(),
			'defaultWallpaper' => desktop_mode_get_default_wallpaper(),
			'session'          => desktop_mode_get_session( get_current_user_id() ),
			'sessionUrl'       => esc_url_raw( rest_url( 'wp-desktop/v1/session' ) ),
			'mediaUrl'         => esc_url_raw( rest_url( 'wp/v2/media' ) ),
			'defaultWindowUrl' => esc_url_raw( rest_url( 'wp-desktop/v1/default-window' ) ),
			'defaultWindow'    => desktop_mode_get_default_window( get_current_user_id() ),
			'canUpload'        => current_user_can( 'upload_files' ),
			'pluginUrl'        => esc_url_raw( untrailingslashit( DESKTOP_MODE_URL ) ),
			'iframeBridgeUrl'  => esc_url_raw(
				DESKTOP_MODE_URL . 'assets/js/iframe-bridge'
				. ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ? '' : '.min' )
				. '.js?ver=' . DESKTOP_MODE_VERSION
			),
			'restNonce'        => wp_create_nonce( 'wp_rest' ),
			'osSettings'            => desktop_mode_get_os_settings( get_current_user_id() ),
			'osSettingsUrl'         => esc_url_raw( rest_url( 'wp-desktop/v1/os-settings' ) ),
			'aiSearchUrl'           => esc_url_raw( rest_url( 'wp-desktop/v1/ai/search' ) ),
			'aiSearchStreamUrl'     => esc_url_raw( add_query_arg( 'action', 'desktop_mode_ai_search_stream', admin_url( 'admin-ajax.php' ) ) ),
			'aiPlatformSettings'    => current_user_can( 'manage_options' ) ? desktop_mode_ai_get_platform_settings() : null,
			'aiPlatformSettingsUrl' => esc_url_raw( rest_url( 'wp-desktop/v1/ai/platform-settings' ) ),
			'aiProviders'           => desktop_mode_ai_get_providers_for_config(),
			'extendedOptions'       => current_user_can( 'manage_options' ) ? desktop_mode_get_extended_options() : null,
			'extendedOptionsUrl'    => esc_url_raw( rest_url( 'wp-desktop/v1/extended-options' ) ),
			'currentUserIsAdmin'    => current_user_can( 'manage_options' ),
			'portalUrl'        => esc_url( desktop_mode_portal_url() ),
			'fromPortal'       => $from_portal,
		)
	);

	wp_localize_script( 'wp-desktop', 'wpDesktopConfig', $config );

	/**
	 * Fires when desktop mode assets are enqueued.
	 *
	 * @since 0.1.0
	 */
	do_action( 'desktop_mode_mode_init' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_assets' );

/**
 * Injects the desktop shell markup into the admin page.
 *
 * Runs on `in_admin_header` at priority 5 so the shell renders right
 * after the classic admin bar but before the page content. The shell
 * floats above the classic layout via `position: fixed` in CSS; the
 * classic sidebar, body, and footer are hidden with `body.wp-desktop-active`
 * selectors.
 *
 * @since 0.1.0
 */
function desktop_mode_render_shell() {
	if ( desktop_mode_is_chromeless_request() || ! desktop_mode_is_enabled() || desktop_mode_is_classic_request() ) {
		return;
	}

	/**
	 * Fires right before the desktop shell markup is rendered.
	 *
	 * @since 0.1.0
	 */
	do_action( 'desktop_mode_shell_before' );

	// Stamp the user's admin color scheme onto the shell root so the
	// variables.css per-scheme selectors kick in before first paint —
	// doing this from JS on init() would show the default palette for a
	// frame before swapping.
	$scheme = sanitize_html_class( get_user_option( 'admin_color' ), 'fresh' );
	?>
	<div id="wp-desktop-shell" class="wp-desktop-shell" data-wp-desktop-scheme="<?php echo esc_attr( $scheme ); ?>" role="application" aria-label="<?php esc_attr_e( 'Desktop shell', 'desktop-mode' ); ?>">
		<?php
		/*
		 * Wallpaper layer — sits behind both the dock and the desktop
		 * area so a translucent dock bleeds through to the wallpaper
		 * (macOS pattern). Canvas-driven wallpapers mount their own
		 * DOM into this element; static CSS wallpapers just inherit
		 * the `--wp-desktop-bg` custom property the shell sets at
		 * boot. Presentational only.
		 */
		?>
		<div id="wp-desktop-wallpaper" class="wp-desktop-wallpaper" aria-hidden="true"></div>
		<div class="wp-desktop-shell__body">
			<nav id="wp-desktop-dock" class="wp-desktop-dock" role="toolbar" aria-label="<?php esc_attr_e( 'Admin navigation', 'desktop-mode' ); ?>"></nav>
			<div id="wp-desktop-area" class="wp-desktop-area wp-desktop-area--with-dock">
				<?php
				/*
				 * Widget column — paints above the wallpaper but
				 * beneath windows (z-index 1 vs. windows at 100+).
				 * Hosted INSIDE `.wp-desktop-area` so scrolling the
				 * area (not that we do today) would scroll widgets
				 * with it, and so the dock naturally frames
				 * it. Empty on first render — JS (`WidgetLayer`)
				 * populates it on boot.
				 */
				?>
				<aside id="wp-desktop-widgets" class="wp-desktop-widgets" aria-label="<?php esc_attr_e( 'Widgets', 'desktop-mode' ); ?>"></aside>
			</div>
		</div>
	</div>
	<?php
	/**
	 * Fires right after the desktop shell markup has rendered.
	 *
	 * @since 0.1.0
	 */
	do_action( 'desktop_mode_shell_after' );
}
add_action( 'in_admin_header', 'desktop_mode_render_shell', 5 );

/**
 * Forces Gutenberg out of fullscreen mode and dismisses welcome guides
 * inside chromeless iframes.
 *
 * The block editor's fullscreen mode renders a "back to dashboard" button
 * (the "W" logo in the top-left). Clicking it navigates the iframe to
 * `/wp-admin/edit.php` without the `wp_desktop=1` flag, which re-renders
 * the entire classic admin inside the chromeless window.
 *
 * Timing: Core's `initializeEditor()` runs inside a `window.load` handler
 * emitted by `edit-form-blocks.php` and synchronously calls
 * `setPersistenceLayer()` on the `core/preferences` store. That swap
 * produces the first state update the store ever emits — earlier defaults
 * come from the registered reducer at module-load time and don't reach
 * subscribers. So we scope a `wp.data.subscribe` to `core/preferences`,
 * wait for the first notification, and apply our overrides then. No
 * timers, no polling — the store tells us exactly when it's safe to write.
 *
 * A previous iteration swapped the persistence layer for a no-op at
 * module-load time. That silenced user dismissals during the window
 * before `initializeEditor()` ran, breaking "Got it" persistence for the
 * welcome guide. Don't do that.
 *
 * Belt-and-suspenders: `chromeless.css` hides the fullscreen close button
 * and welcome modal so there's no visible flash between window open and
 * our overrides firing.
 *
 * @since 0.1.0
 */
function desktop_mode_chromeless_editor_preferences() {
	if ( ! desktop_mode_is_chromeless_request() ) {
		return;
	}

	$script = <<<'JS'
( function () {
	if ( ! window.wp || ! wp.data || typeof wp.data.subscribe !== 'function' ) {
		return;
	}

	// Minimize writes: each set() triggers a debounced REST persist, so we
	// only flip values that are currently truthy. Skipping no-ops avoids
	// re-saving the user's meta on every chromeless load.
	//
	// Note: we intentionally do NOT touch `fullscreenMode`. Gutenberg's
	// non-fullscreen layout hardcodes top: 32px / left: 160px on
	// .interface-interface-skeleton to reserve space for the admin bar and
	// sidebar — both of which we've hidden — producing visible gaps inside
	// chromeless windows. Leaving fullscreenMode at its default (true)
	// makes the skeleton fill the viewport naturally. The W logo that
	// fullscreen surfaces is hidden via chromeless.css.
	var OVERRIDES = [
		[ 'core/edit-post', 'welcomeGuide' ],
		[ 'core/edit-post', 'welcomeGuideTemplate' ],
		[ 'core/edit-site', 'welcomeGuide' ],
		[ 'core/edit-site', 'welcomeGuideStyles' ],
		[ 'core/edit-site', 'welcomeGuidePage' ],
		[ 'core/edit-site', 'welcomeGuideTemplate' ],
		[ 'core/edit-widgets', 'welcomeGuide' ]
	];

	function applyOverrides() {
		var select = wp.data.select( 'core/preferences' );
		var prefs  = wp.data.dispatch( 'core/preferences' );
		if ( ! select || ! prefs || typeof prefs.set !== 'function' ) {
			return;
		}
		for ( var i = 0; i < OVERRIDES.length; i++ ) {
			var scope = OVERRIDES[ i ][ 0 ];
			var key   = OVERRIDES[ i ][ 1 ];
			try {
				if ( select.get( scope, key ) ) {
					prefs.set( scope, key, false );
				}
			} catch ( e ) {}
		}
	}

	// initializeEditor() runs inside a window.load handler and calls
	// setPersistenceLayer() on the preferences store. That call emits the
	// first state update the store ever sends to subscribers — which is
	// exactly the moment it's safe for us to write. Subscribe scoped to
	// this store, fire once, unsubscribe.
	var fired  = false;
	var unsub  = wp.data.subscribe( function () {
		if ( fired ) {
			return;
		}
		fired = true;
		unsub();
		applyOverrides();
	}, 'core/preferences' );
} )();
JS;

	// Attach after whichever editor package is loaded on this screen.
	// wp_add_inline_script silently no-ops for handles that aren't registered.
	wp_add_inline_script( 'wp-edit-post', $script, 'after' );
	wp_add_inline_script( 'wp-edit-site', $script, 'after' );
	wp_add_inline_script( 'wp-edit-widgets', $script, 'after' );
}
add_action( 'enqueue_block_editor_assets', 'desktop_mode_chromeless_editor_preferences' );

/**
 * Neutralizes hardcoded admin-bar offsets on positioned elements
 * inside chromeless iframes.
 *
 * Many plugins compile their CSS with the admin-bar height baked in
 * as a literal pixel value rather than referencing
 * `var(--wp-admin--admin-bar--height)`. WooCommerce's
 * `.woocommerce-layout__header` is the canonical case — it ships as
 * `top: 32px` (or `46px` on small screens) because the SCSS source
 * uses build-time interpolation (`#{$header-height + $adminbar-height-mobile}`).
 * A CSS-variable rebind cannot reach these rules because the rules
 * never read the variable.
 *
 * The only generic mitigation is a runtime DOM pass:
 *
 *   1. Walk every positioned element (`fixed | sticky | absolute`).
 *   2. Compare its computed `top` against the set of values that
 *      reserve admin-bar height (defaults: `32px`, `46px`).
 *   3. If it matches, override `top` to `0` inline with `!important`.
 *
 * The match is exact-pixel — we deliberately don't catch e.g.
 * `top: 33px` (which is almost certainly intentional and unrelated
 * to admin-bar geometry). False positives are possible but
 * unlikely; a plugin would have to use `top: 32px` for a reason
 * unrelated to the admin bar AND need that exact value to remain
 * inside chromeless. We've never seen one in the wild, and if a
 * site hits it, the filter below lets them narrow the scan.
 *
 * Scoped via the `wp-desktop-chromeless` body class, runs at
 * DOMContentLoaded and again at `load` to catch React-mounted
 * components. No MutationObserver yet — we'll add one if a plugin
 * surfaces that mounts new offending elements after `load`.
 *
 * @since 0.6.1
 */
function desktop_mode_chromeless_offset_neutralizer_script() {
	if ( ! desktop_mode_is_chromeless_request() ) {
		return;
	}

	/**
	 * Filters the set of `top` pixel values that mark a positioned
	 * element as an admin-bar offset clone.
	 *
	 * Defaults match the two admin-bar heights Core ships: `32px`
	 * for desktop, `46px` for the mobile breakpoint. Sites that
	 * customize the admin bar height (some accessibility themes
	 * raise it to 50px) can extend the list.
	 *
	 * @since 0.6.1
	 *
	 * @param string[] $values Default `[ '32px', '46px' ]`.
	 */
	$top_values = apply_filters(
		'desktop_mode_chromeless_admin_bar_top_values',
		array( '32px', '46px' )
	);

	$config = wp_json_encode(
		array(
			'tops' => array_values( array_filter( array_map( 'strval', (array) $top_values ) ) ),
		)
	);
	if ( false === $config ) {
		return;
	}

	$js = "(function(C){function fix(){if(!document.body||!document.body.classList.contains('wp-desktop-chromeless'))return;var TOPS={};for(var t=0;t<C.tops.length;t++){TOPS[C.tops[t]]=1;}var els=document.querySelectorAll('*');for(var i=0;i<els.length;i++){var el=els[i];var cs=getComputedStyle(el);if(cs.position==='static')continue;if(TOPS[cs.top]){el.style.setProperty('top','0px','important');}}}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',fix,{once:true});}else{fix();}window.addEventListener('load',fix,{once:true});})({$config});";

	wp_print_inline_script_tag( $js );
}
add_action( 'admin_head', 'desktop_mode_chromeless_offset_neutralizer_script', 1 );

/**
 * Outputs the chromeless screen-meta bridge script.
 *
 * Detects Screen Options / Help panels in the iframed page and relays
 * their availability + open/closed state to the parent desktop shell
 * via postMessage. The parent shell uses this to render matching
 * buttons in the window title bar.
 *
 * @since 0.1.0
 */
function desktop_mode_chromeless_bridge_script() {
	if ( ! desktop_mode_is_chromeless_request() ) {
		return;
	}

	/**
	 * Fires after chromeless content in desktop mode.
	 *
	 * @since 0.1.0
	 *
	 * @param string $hook_suffix The current admin page hook suffix.
	 */
	do_action( 'desktop_mode_chromeless_after', isset( $GLOBALS['hook_suffix'] ) ? $GLOBALS['hook_suffix'] : '' );

	// Menu payload — built from the LIVE $menu / $submenu globals
	// populated by real admin-context bootstrapping. We capture it here
	// rather than making the parent refetch via REST because many
	// plugins evaluate `is_admin()` at plugin-file-load time and only
	// register their `admin_menu` hook when it returns true; in a REST
	// context `WP_ADMIN` isn't defined at load, so those plugins never
	// hook in and their menu entries are missing from any endpoint we
	// could expose. Here we're INSIDE an admin request (plugins.php,
	// plugin-install.php, update.php, themes.php) where every plugin's
	// menu registered normally, so `$menu` carries the authoritative
	// post-activation state.
	//
	// Narrowed to the set of pages whose completion commonly mutates
	// the admin menu (activation / deactivation / install / theme
	// switch), plus the explicit `desktop_mode_menu_refresh=1` signal
	// the shell sets when `wp.desktop.refreshMenu()` spawns a hidden
	// iframe to harvest a fresh payload from real admin context.
	// Navigating to edit.php or similar doesn't change the menu so we
	// don't bother sending a payload otherwise — the debounce +
	// idempotent replaceItems on the parent side would still make it
	// safe, just wasteful.
	$menu_payload_json = 'null';
	$pagenow           = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';
	$is_refresh_probe  = ! empty( $_GET['desktop_mode_menu_refresh'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only payload harvest, capability-gated by the host admin page.
	if (
		$is_refresh_probe
		|| in_array(
			$pagenow,
			array( 'plugins.php', 'plugin-install.php', 'update.php', 'themes.php' ),
			true
		)
	) {
		$encoded = wp_json_encode( desktop_mode_build_menu_payload() );
		if ( false !== $encoded ) {
			$menu_payload_json = $encoded;
		}
	}

	// Emit via wp_print_inline_script_tag so CSP nonces and `<script>`
	// attribute hygiene go through Core rather than being hand-rolled.
	$js = <<<'JS'
( function() {
	// Escape hatch: a chromeless page is only meant to live inside a
	// desktop-mode window iframe. If the top window IS this page, the
	// user ended up here directly — either bookmarked it, followed a
	// stale link, or got stranded by a bad portal redirect. Without
	// an admin bar there's no toggle to turn desktop mode off, so
	// strip the chromeless flag and reload as classic admin. That
	// puts the admin bar back and lets the user decide what to do.
	if ( ! window.parent || window.parent === window ) {
		try {
			var here = new URL( window.location.href );
			if ( here.searchParams.has( 'wp_desktop' ) ) {
				here.searchParams.delete( 'wp_desktop' );
				here.searchParams.delete( 'desktop_mode_portal' );
				window.location.replace( here.toString() );
			}
		} catch ( err ) {
			/* URL parse failure — let the broken state stand rather than
			 * navigate somewhere worse. */
		}
		return;
	}

	/*
	 * Observability — iframe error + network capture.
	 *
	 * Everything admin-interesting (REST failures from Gutenberg,
	 * admin-ajax 500s, plugin console warnings) fires INSIDE the
	 * iframe whose parent is the desktop shell. Without relaying
	 * those events to the shell, monitor / debug widgets would only
	 * ever see the shell's own errors — the smallest, least-
	 * interesting surface in the whole admin.
	 *
	 * Two listeners and two wrappers land here:
	 *
	 *   - `error` + `unhandledrejection` on window → postMessage
	 *     `wp-desktop-iframe-error`. Parent dispatches `HOOKS.
	 *     IFRAME_ERROR`.
	 *   - `fetch` + `XMLHttpRequest` are wrapped so every completed
	 *     request (including failures) posts
	 *     `wp-desktop-iframe-network` with `{ method, url, status,
	 *     duration, failed }`. Parent dispatches `HOOKS.
	 *     IFRAME_NETWORK_COMPLETED`.
	 *
	 * Privacy: request / response bodies are NEVER captured — only
	 * method, URL, status, duration. Monitor widgets that want the
	 * full payload must ship their own deeper wrapper (at which
	 * point they own the consent conversation).
	 */
	try {
		window.addEventListener( 'error', function ( e ) {
			try {
				window.parent.postMessage( {
					type: 'wp-desktop-iframe-error',
					kind: 'error',
					message: e && e.message ? String( e.message ) : '',
					filename: e && e.filename ? String( e.filename ) : null,
					lineno: e && typeof e.lineno === 'number' ? e.lineno : null,
					colno: e && typeof e.colno === 'number' ? e.colno : null,
					stack: e && e.error && e.error.stack ? String( e.error.stack ) : null
				}, window.location.origin );
			} catch ( _err ) { /* swallow: don't let the relay compound the error */ }
		} );

		window.addEventListener( 'unhandledrejection', function ( e ) {
			try {
				var reason = e && 'reason' in e ? e.reason : null;
				var message = '';
				var stack = null;
				if ( reason instanceof Error ) {
					message = reason.message;
					stack = reason.stack || null;
				} else if ( reason !== null && reason !== undefined ) {
					try { message = String( reason ); } catch ( _s ) { message = '[unstringifiable]'; }
				}
				window.parent.postMessage( {
					type: 'wp-desktop-iframe-error',
					kind: 'unhandledrejection',
					message: message,
					filename: null,
					lineno: null,
					colno: null,
					stack: stack
				}, window.location.origin );
			} catch ( _err ) { /* swallow */ }
		} );

		// Devtools instrumentation slot — populated by
		// `wp-desktop-instrument-set` messages from the parent shell.
		// Mutable: parent overwrites the whole object on every change
		// (header add/remove, observe toggle).
		//
		// Headers: { name: 'value' } — already pre-merged by the parent
		// (RFC 7230 §3.2.2 join applied there).
		// Observe: when true, network reports include request +
		// response headers; otherwise only the privacy-conscious
		// summary travels parent-bound.
		window.__wpdInstrument = window.__wpdInstrument || { headers: {}, observe: false };
		try {
			window.addEventListener( 'message', function ( ev ) {
				if ( ev.origin !== window.location.origin || ev.source !== window.parent ) {
					return;
				}
				var d = ev && ev.data;
				if ( ! d || typeof d !== 'object' || d.type !== 'wp-desktop-instrument-set' ) {
					return;
				}
				window.__wpdInstrument = {
					headers: d.headers && typeof d.headers === 'object' ? d.headers : {},
					observe: !! d.observe
				};
			} );
		} catch ( _err ) { /* swallow — instrumentation is best-effort */ }

		var wpdReportNetwork = function ( method, url, status, duration, failed, extra ) {
			try {
				var msg = {
					type: 'wp-desktop-iframe-network',
					method: String( method || 'GET' ).toUpperCase(),
					url: String( url || '' ),
					status: typeof status === 'number' ? status : 0,
					duration: typeof duration === 'number' ? duration : 0,
					failed: !! failed
				};
				if ( extra && window.__wpdInstrument && window.__wpdInstrument.observe ) {
					if ( extra.requestHeaders ) {
						msg.requestHeaders = extra.requestHeaders;
					}
					if ( extra.responseHeaders ) {
						msg.responseHeaders = extra.responseHeaders;
					}
				}
				window.parent.postMessage( msg, window.location.origin );
			} catch ( _err ) { /* swallow */ }
		};

		// Helper — convert an arbitrary `init.headers` shape into a
		// plain `{ name: value }` map so the instrument layer can
		// merge contributed headers without caring whether the caller
		// passed a Headers, an array of pairs, or a plain object.
		var wpdHeadersToObject = function ( h ) {
			var out = {};
			if ( ! h ) {
				return out;
			}
			if ( typeof Headers !== 'undefined' && h instanceof Headers ) {
				try {
					h.forEach( function ( v, k ) { out[ k ] = v; } );
				} catch ( _e ) { /* swallow */ }
				return out;
			}
			if ( Array.isArray( h ) ) {
				for ( var i = 0; i < h.length; i++ ) {
					if ( h[ i ] && h[ i ].length >= 2 ) {
						out[ h[ i ][ 0 ] ] = h[ i ][ 1 ];
					}
				}
				return out;
			}
			if ( typeof h === 'object' ) {
				for ( var k in h ) {
					if ( Object.prototype.hasOwnProperty.call( h, k ) ) {
						out[ k ] = h[ k ];
					}
				}
			}
			return out;
		};

		// Helper — snapshot the contributed-header set at request time.
		// Header values can theoretically come and go between requests
		// (parent ref-counts contributions) so we read fresh on every
		// call rather than caching at wrap time.
		var wpdContributedHeaders = function () {
			var inst = window.__wpdInstrument || {};
			var headers = inst.headers || {};
			var out = {};
			for ( var k in headers ) {
				if ( Object.prototype.hasOwnProperty.call( headers, k ) && typeof headers[ k ] === 'string' ) {
					out[ k ] = headers[ k ];
				}
			}
			return out;
		};

		// Wrap fetch. Called AFTER `admin_footer` runs — plugin code
		// using fetch during synchronous page boot (rare in wp-admin)
		// bypasses this, but lazy calls (the common case) are captured.
		//
		// Two layers of behavior:
		//
		//   - Always: timing + status reporting (the original
		//     observability contract).
		//   - When `__wpdInstrument.headers` is non-empty: merge those
		//     headers into the request before dispatch so devtools can
		//     tag every outgoing call without each plugin reinventing
		//     a fetch wrapper.
		//   - When `__wpdInstrument.observe`: also relay request +
		//     response headers in the parent-bound network message.
		if ( typeof window.fetch === 'function' ) {
			var wpdOrigFetch = window.fetch;
			window.fetch = function ( input, init ) {
				var start = ( typeof performance !== 'undefined' && performance.now )
					? performance.now()
					: Date.now();
				var method = 'GET';
				var url = '';
				if ( typeof input === 'string' ) {
					url = input;
					if ( init && typeof init.method === 'string' ) {
						method = init.method;
					}
				} else if ( input && typeof input === 'object' ) {
					url = input.url || '';
					method = ( input.method || ( init && init.method ) || 'GET' );
				}

				// Header contribution + capture. Build a single
				// `Headers` instance so contributed values overwrite /
				// stack predictably regardless of the caller's input
				// shape, then re-attach to a cloned init.
				var contributed = wpdContributedHeaders();
				var observe = window.__wpdInstrument && window.__wpdInstrument.observe;
				var requestHeaders = null;
				var hasContributed = false;
				for ( var ck in contributed ) {
					if ( Object.prototype.hasOwnProperty.call( contributed, ck ) ) {
						hasContributed = true;
						break;
					}
				}
				if ( hasContributed || observe ) {
					var existing = wpdHeadersToObject( init && init.headers );
					if ( input && typeof input === 'object' && input.headers ) {
						var fromReq = wpdHeadersToObject( input.headers );
						for ( var rk in fromReq ) {
							if ( Object.prototype.hasOwnProperty.call( fromReq, rk ) && ! ( rk in existing ) ) {
								existing[ rk ] = fromReq[ rk ];
							}
						}
					}
					for ( var ck2 in contributed ) {
						if ( Object.prototype.hasOwnProperty.call( contributed, ck2 ) ) {
							existing[ ck2 ] = contributed[ ck2 ];
						}
					}
					if ( hasContributed ) {
						init = init ? Object.assign( {}, init ) : {};
						init.headers = existing;
						arguments[ 1 ] = init;
					}
					if ( observe ) {
						requestHeaders = existing;
					}
				}

				var promise;
				try {
					promise = wpdOrigFetch.apply( this, arguments );
				} catch ( sync ) {
					wpdReportNetwork( method, url, 0, 0, true, requestHeaders ? { requestHeaders: requestHeaders } : null );
					throw sync;
				}
				return promise.then(
					function ( res ) {
						var dur = ( ( typeof performance !== 'undefined' && performance.now )
							? performance.now()
							: Date.now() ) - start;
						var extra = null;
						if ( requestHeaders ) {
							extra = { requestHeaders: requestHeaders };
							try {
								var rh = {};
								if ( res && res.headers && typeof res.headers.forEach === 'function' ) {
									res.headers.forEach( function ( v, k ) { rh[ k ] = v; } );
								}
								extra.responseHeaders = rh;
							} catch ( _hErr ) { /* swallow */ }
						}
						wpdReportNetwork( method, url, res.status, Math.round( dur ), ! res.ok, extra );
						return res;
					},
					function ( err ) {
						var dur = ( ( typeof performance !== 'undefined' && performance.now )
							? performance.now()
							: Date.now() ) - start;
						wpdReportNetwork( method, url, 0, Math.round( dur ), true, requestHeaders ? { requestHeaders: requestHeaders } : null );
						throw err;
					}
				);
			};
		}

		// Wrap XHR — admin-ajax runs through jQuery which runs through
		// XHR, so fetch-only instrumentation would miss most of the
		// legacy admin surface. Record method + URL on open; fire on
		// loadend regardless of success / failure.
		//
		// Header contribution layer: `setRequestHeader` after open() but
		// before send() — that's the only window the spec allows. The
		// caller's own headers are tracked so observation can include
		// them alongside the contributed ones.
		if ( typeof XMLHttpRequest !== 'undefined' ) {
			var wpdOrigOpen = XMLHttpRequest.prototype.open;
			var wpdOrigSend = XMLHttpRequest.prototype.send;
			var wpdOrigSetHeader = XMLHttpRequest.prototype.setRequestHeader;
			XMLHttpRequest.prototype.open = function ( method, url ) {
				try {
					this.__wpdMethod = method;
					this.__wpdUrl = url;
					this.__wpdReqHeaders = {};
				} catch ( _err ) { /* frozen instance — skip */ }
				return wpdOrigOpen.apply( this, arguments );
			};
			XMLHttpRequest.prototype.setRequestHeader = function ( name, value ) {
				try {
					if ( ! this.__wpdReqHeaders ) {
						this.__wpdReqHeaders = {};
					}
					this.__wpdReqHeaders[ name ] = value;
				} catch ( _err ) { /* swallow */ }
				return wpdOrigSetHeader.apply( this, arguments );
			};
			XMLHttpRequest.prototype.send = function () {
				var xhr = this;
				var start = ( typeof performance !== 'undefined' && performance.now )
					? performance.now()
					: Date.now();

				// Apply contributed headers right before send. Doing it
				// here rather than in open() means contributions added
				// after open() (e.g. in async-built request flows) still
				// land on the wire.
				var contributed = wpdContributedHeaders();
				var observe = window.__wpdInstrument && window.__wpdInstrument.observe;
				for ( var hk in contributed ) {
					if ( Object.prototype.hasOwnProperty.call( contributed, hk ) ) {
						try {
							wpdOrigSetHeader.call( xhr, hk, contributed[ hk ] );
							if ( ! xhr.__wpdReqHeaders ) {
								xhr.__wpdReqHeaders = {};
							}
							xhr.__wpdReqHeaders[ hk ] = contributed[ hk ];
						} catch ( _hErr ) { /* `setRequestHeader` rejects forbidden names — skip */ }
					}
				}

				var fire = function () {
					var dur = ( ( typeof performance !== 'undefined' && performance.now )
						? performance.now()
						: Date.now() ) - start;
					var extra = null;
					if ( observe ) {
						extra = {
							requestHeaders: xhr.__wpdReqHeaders || {}
						};
						try {
							var raw = xhr.getAllResponseHeaders ? xhr.getAllResponseHeaders() : '';
							var resHeaders = {};
							if ( raw && typeof raw === 'string' ) {
								var lines = raw.trim().split( /[\r\n]+/ );
								for ( var li = 0; li < lines.length; li++ ) {
									var idx = lines[ li ].indexOf( ':' );
									if ( idx > 0 ) {
										resHeaders[ lines[ li ].slice( 0, idx ).trim() ] = lines[ li ].slice( idx + 1 ).trim();
									}
								}
							}
							extra.responseHeaders = resHeaders;
						} catch ( _rErr ) { /* swallow */ }
					}
					wpdReportNetwork(
						xhr.__wpdMethod,
						xhr.__wpdUrl,
						xhr.status,
						Math.round( dur ),
						xhr.status === 0 || xhr.status >= 400,
						extra
					);
				};
				try {
					xhr.addEventListener( 'loadend', fire );
				} catch ( _err ) { /* swallow */ }
				return wpdOrigSend.apply( this, arguments );
			};
		}

		// Wrap sendBeacon — used by analytics + telemetry. The Beacon
		// API doesn't accept headers (the entire point of beacons is
		// minimal payload + best-effort delivery). When devtools have
		// contributed headers we silently fall back to fetch with
		// `keepalive: true`, which is the closest semantic match —
		// guaranteed POST + same fire-and-forget intent + custom headers
		// allowed. Without contributions we just relay the call.
		if ( typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' ) {
			var wpdOrigBeacon = navigator.sendBeacon.bind( navigator );
			navigator.sendBeacon = function ( url, data ) {
				var contributed = wpdContributedHeaders();
				var hasContributed = false;
				for ( var ck in contributed ) {
					if ( Object.prototype.hasOwnProperty.call( contributed, ck ) ) {
						hasContributed = true;
						break;
					}
				}
				var start = ( typeof performance !== 'undefined' && performance.now )
					? performance.now()
					: Date.now();
				if ( ! hasContributed ) {
					var ok = false;
					try { ok = !! wpdOrigBeacon( url, data ); } catch ( _e ) { ok = false; }
					wpdReportNetwork( 'POST', url, ok ? 200 : 0, 0, ! ok );
					return ok;
				}
				try {
					var observe = window.__wpdInstrument && window.__wpdInstrument.observe;
					var headers = {};
					for ( var hk2 in contributed ) {
						if ( Object.prototype.hasOwnProperty.call( contributed, hk2 ) ) {
							headers[ hk2 ] = contributed[ hk2 ];
						}
					}
					window.fetch( url, {
						method: 'POST',
						body: data,
						keepalive: true,
						credentials: 'same-origin',
						headers: headers
					} ).then(
						function ( res ) {
							var dur = ( ( typeof performance !== 'undefined' && performance.now )
								? performance.now()
								: Date.now() ) - start;
							wpdReportNetwork( 'POST', url, res.status, Math.round( dur ), ! res.ok, observe ? { requestHeaders: headers } : null );
						},
						function () {
							var dur = ( ( typeof performance !== 'undefined' && performance.now )
								? performance.now()
								: Date.now() ) - start;
							wpdReportNetwork( 'POST', url, 0, Math.round( dur ), true, observe ? { requestHeaders: headers } : null );
						}
					);
					return true;
				} catch ( _bErr ) {
					return false;
				}
			};
		}
	} catch ( _err ) {
		/* Whole observability block is best-effort. If something in
		 * the environment disagrees (frozen prototypes, CSP blocking
		 * postMessage, etc.) we don't want to tank the rest of the
		 * chromeless bridge. */
	}

	/*
	 * Menu-changed signal.
	 *
	 * The shell's dock is built from `$menu` at page-load time and
	 * then frozen — the iframe reload that follows plugin
	 * activation / deactivation / installation doesn't tell the
	 * parent the admin menu just mutated. This handler fires inside
	 * the iframe that JUST LOADED plugins.php (or a sibling menu-
	 * affecting page) and hands the parent a fresh payload the PHP
	 * side built server-side from the live $menu globals.
	 *
	 * Why not a REST roundtrip: plugins commonly gate their
	 * `admin_menu` registration on `is_admin()` evaluated AT PLUGIN
	 * LOAD. REST requests don't define `WP_ADMIN` at plugin-load
	 * time, so those plugins never register and a REST-context
	 * bootstrap can't retroactively make them. By capturing the
	 * payload here, inside a real admin context, we get the
	 * authoritative post-activation state that any REST endpoint
	 * would miss.
	 *
	 * Covered pages:
	 *   - plugins.php         — activate, deactivate, bulk, delete.
	 *   - plugin-install.php  — install new, install-and-activate.
	 *   - update.php          — update / install handler (install-
	 *                           plugin + upload-plugin actions).
	 *   - themes.php          — theme switch (rare but can add menus).
	 */
	var __WP_DESKTOP_MENU_PAYLOAD__ = /*__WPDM_MENU_PAYLOAD__*/;
	try {
		if ( __WP_DESKTOP_MENU_PAYLOAD__ ) {
			window.parent.postMessage(
				{
					type: 'wp-desktop-plugins-changed',
					payload: __WP_DESKTOP_MENU_PAYLOAD__
				},
				window.location.origin
			);
		}
	} catch ( err ) {
		/* postMessage throws only on structured-clone failures, which
		 * this static payload won't hit. Swallow defensively so a
		 * wayward extension wrapping window.parent can't break the
		 * rest of the bridge. */
	}

	/*
	 * Link & form interceptor.
	 *
	 * Every same-origin wp-admin <a> href and <form> action gets the
	 * `wp_desktop=1` flag appended so navigation inside the iframe stays
	 * chromeless. Without this, a stray link to /wp-admin/edit.php (see
	 * Gutenberg's fullscreen close button, help-tab links, "Return to
	 * posts" affordances, etc.) re-renders the full classic admin inside
	 * our window.
	 *
	 * Excluded from rewriting:
	 *   - modifier clicks (cmd/ctrl/shift/alt) — user wants to open a
	 *     new tab/window, respect that
	 *   - target="_blank" / target="_top" / target="_parent"
	 *   - download attribute
	 *   - in-page anchors (#)
	 *   - mailto:, tel:, javascript: schemes
	 *   - cross-origin URLs
	 *   - URLs that already carry wp_desktop=
	 */
	function rewriteAdminUrl( href, base ) {
		if ( ! href || href.charAt( 0 ) === '#' ) {
			return null;
		}
		if ( /^(mailto:|tel:|javascript:|data:)/i.test( href ) ) {
			return null;
		}
		var url;
		try {
			url = new URL( href, base );
		} catch ( err ) {
			return null;
		}
		if ( url.origin !== window.location.origin ) {
			return null;
		}
		if ( url.pathname.indexOf( '/wp-admin/' ) === -1 ) {
			return null;
		}
		if ( url.searchParams.has( 'wp_desktop' ) ) {
			return null;
		}
		url.searchParams.set( 'wp_desktop', '1' );
		return url.toString();
	}

	/*
	 * Classify a link so we know whether to rewrite it (admin),
	 * escalate it to the parent shell (external / non-admin), or let
	 * the browser navigate naturally (mailto, anchor, download, etc.).
	 *
	 *   'admin'       — same-origin /wp-admin/ URL we rewrite in place.
	 *   'external'    — http(s) URL we want the parent shell to open
	 *                   as a sub-tab instead of navigating the iframe
	 *                   out of wp-admin. Covers both cross-origin
	 *                   links (plugin author sites, external docs) AND
	 *                   same-origin non-admin links (the site's own
	 *                   front-end pages).
	 *   'passthrough' — anything else (mailto, tel, javascript, data,
	 *                   anchors, unparseable). The browser handles it.
	 */
	function classifyLink( href, base ) {
		if ( ! href || href.charAt( 0 ) === '#' ) {
			return 'passthrough';
		}
		if ( /^(mailto:|tel:|javascript:|data:)/i.test( href ) ) {
			return 'passthrough';
		}
		var url;
		try {
			url = new URL( href, base );
		} catch ( err ) {
			return 'passthrough';
		}
		if ( url.protocol !== 'http:' && url.protocol !== 'https:' ) {
			return 'passthrough';
		}
		if (
			url.origin === window.location.origin &&
			url.pathname.indexOf( '/wp-admin/' ) !== -1
		) {
			return 'admin';
		}
		return 'external';
	}

	document.addEventListener( 'click', function ( e ) {
		if ( e.defaultPrevented ) {
			return;
		}
		if ( e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) {
			return;
		}
		var link = e.target && e.target.closest ? e.target.closest( 'a[href]' ) : null;
		if ( ! link ) {
			return;
		}
		if ( link.target && link.target !== '' && link.target !== '_self' ) {
			return;
		}
		if ( link.hasAttribute( 'download' ) ) {
			return;
		}
		var href = link.getAttribute( 'href' );
		var kind = classifyLink( href, window.location.href );
		if ( kind === 'admin' ) {
			var rewritten = rewriteAdminUrl( href, window.location.href );
			if ( rewritten ) {
				link.setAttribute( 'href', rewritten );
			}
			return;
		}
		if ( kind === 'external' ) {
			/*
			 * External navigation inside an admin iframe would leave
			 * the user stranded in a chrome-free version of whatever
			 * site the link points at. Escalate to the parent shell
			 * so it opens the URL as a closeable sub-tab (with a
			 * detach button) alongside the admin tab — the user
			 * stays inside the desktop shell.
			 *
			 * Resolving the href against the document base gives the
			 * parent an absolute URL it doesn't have to re-resolve.
			 */
			e.preventDefault();
			var absolute;
			try {
				absolute = new URL( href, window.location.href ).toString();
			} catch ( err ) {
				return;
			}
			var label = ( link.textContent || '' ).trim() ||
				link.getAttribute( 'title' ) ||
				absolute;
			window.parent.postMessage(
				{
					type: 'wp-desktop-external-link',
					url: absolute,
					label: label.slice( 0, 80 )
				},
				window.location.origin
			);
		}
	}, true );

	document.addEventListener( 'submit', function ( e ) {
		var form = e.target;
		if ( ! form || form.tagName !== 'FORM' ) {
			return;
		}
		var action = form.getAttribute( 'action' );
		var rewritten = rewriteAdminUrl( action || window.location.href, window.location.href );
		if ( rewritten ) {
			form.setAttribute( 'action', rewritten );
		}
	}, true );

	/*
	 * Focus-request bridge.
	 *
	 * Clicks inside an iframe don't cross the browsing-context
	 * boundary — the parent shell's pointerdown / focusin listeners
	 * never see them, so without this hook the only way to focus an
	 * iframe window would be clicking its title bar chrome. Post a
	 * `wp-desktop-focus-request` message on every pointerdown; the
	 * parent Window class treats it as an onFocusRequest. Capture
	 * phase so the signal fires before any stopPropagation inside
	 * a page's own handlers.
	 */
	document.addEventListener( 'pointerdown', function () {
		try {
			window.parent.postMessage(
				{ type: 'wp-desktop-focus-request' },
				window.location.origin
			);
		} catch ( err ) {
			/* cross-origin parent (shouldn't happen for chromeless
			 * pages, but don't let a throw break the bridge) */
		}
	}, true );

	/*
	 * Cmd+K / Ctrl+K forwarder — single-press, unconditional.
	 *
	 * Native keydown events don't cross iframe boundaries. Inside a
	 * chromeless admin page we want exactly ONE command palette: the
	 * desktop shell's. WordPress's own `core/commands` palette is
	 * harvested by `__wpdHarvestCommands` below and re-surfaced in the
	 * shell palette, so there's no reason to ever let the in-page palette
	 * take the keystroke.
	 *
	 * Capture phase + `stopImmediatePropagation` so we win the race
	 * against Gutenberg / TinyMCE / plugin handlers bound to the same
	 * shortcut. Shift/Alt modifiers pass through so user shortcuts using
	 * those combos keep working.
	 */
	document.addEventListener( 'keydown', function ( e ) {
		if ( ! ( e.metaKey || e.ctrlKey ) ) return;
		if ( e.key !== 'k' && e.key !== 'K' ) return;
		if ( e.shiftKey || e.altKey ) return;

		e.preventDefault();
		e.stopImmediatePropagation();

		try {
			window.parent.postMessage(
				{ type: 'wp-desktop-palette-cycle' },
				window.location.origin
			);
		} catch ( err ) { /* cross-origin parent; swallow */ }
	}, true );

	/*
	 * Command harvester — bridges `wp.data.select('core/commands')` to
	 * the parent shell.
	 *
	 * On `wp-desktop-commands-subscribe` from the parent, subscribe to
	 * the `core/commands` store and post `wp-desktop-commands-list` on
	 * every change (de-duplicated). On `wp-desktop-commands-invoke`, run
	 * the original callback inside this iframe — the parent fires this
	 * when the user selects a proxied command from the shell palette.
	 *
	 * Commands are classified by dry-invoking their callback inside a
	 * `window.location`-intercept sandbox: pure-navigation callbacks
	 * are flagged `navigate` (with the captured URL) so the parent can
	 * open a new desktop window instead of navigating this iframe out
	 * of chromeless mode. Everything else is `action` and proxies back
	 * into this iframe on user selection.
	 */
	var __wpdCommandsSubscribed   = false;
	var __wpdCommandsLastPayload  = '';
	var __wpdCommandsDebounceId   = null;
	var __wpdCommandsOrigin       = window.location.origin;
	// Cache per command name so the `window.location`-intercept
	// sandbox only runs once per command. Re-classifying on every
	// store tick would repeatedly fire side-effectful action
	// callbacks (preference toggles, modal opens) — unacceptable.
	// Keyed by name; value is the frozen classification minus the
	// live `label` / `icon` (which we always re-read in case the
	// command updated its own metadata).
	var __wpdCommandsKindCache    = Object.create( null );

	function __wpdRenderIconElement( icon ) {
		if ( ! icon ) return '';
		if ( typeof icon === 'string' ) return '';
		if ( ! window.wp || ! window.wp.element || typeof window.wp.element.renderToString !== 'function' ) {
			return '';
		}
		try {
			var rendered = window.wp.element.renderToString( icon );
			// `@wordpress/icons` entries render as a complete `<svg>`
			// tag. Anything else (wrapped components, empty fragments,
			// strings) falls back to dashicons in the palette — we only
			// accept markup we can inject straight into the icon slot.
			if ( typeof rendered === 'string' && rendered.toLowerCase().indexOf( '<svg' ) === 0 ) {
				return rendered;
			}
		} catch ( _err ) { /* swallow */ }
		return '';
	}

	function __wpdClassifyCommand( cmd ) {
		// Defensive defaults — a broken registry should not tank the bridge.
		var out = {
			name:    String( cmd && cmd.name ? cmd.name : '' ),
			label:   String( cmd && cmd.label ? cmd.label : '' ),
			icon:    cmd && cmd.icon && typeof cmd.icon === 'string' ? cmd.icon : undefined,
			iconSvg: undefined,
			context: cmd && cmd.context ? String( cmd.context ) : undefined,
			kind:    'action',
			url:     undefined
		};
		if ( ! cmd || typeof cmd.callback !== 'function' ) {
			return out;
		}

		// Short-circuit on cached classifications — `renderToString` on
		// the React icon is expensive, and the static URL regex scan
		// on `callback.toString()` is pure CPU we've already paid once.
		var cached = __wpdCommandsKindCache[ out.name ];
		if ( cached ) {
			out.kind    = cached.kind;
			out.url     = cached.url;
			out.iconSvg = cached.iconSvg;
			return out;
		}

		// Render the React icon once per command name — Gutenberg
		// commands ship `icon` as a `@wordpress/icons` React element
		// the postMessage bridge can't serialize, so we flatten it to
		// a static SVG string here.
		if ( cmd.icon && typeof cmd.icon !== 'string' ) {
			out.iconSvg = __wpdRenderIconElement( cmd.icon );
		}

		// STATIC classification — read the callback's source text and
		// look for a string-literal navigation target. We deliberately
		// do NOT execute the callback. An earlier iteration tried a
		// dry-run with a `window.location` intercept sandbox, but
		// `Location.prototype.href` is non-configurable: the shim
		// silently failed, every nav callback actually navigated the
		// iframe, the new page re-harvested, and the cascade opened
		// windows forever.
		//
		// Cases caught (WP's @wordpress/core-commands callbacks are
		// all of this shape):
		//   document.location.href = 'url'
		//   window.location.href   = "url"
		//   location.href          = `url`
		//   location.assign( 'url' )
		//   location.replace( 'url' )
		//
		// Computed URLs (template-literal interpolation, addQueryArgs
		// calls, variables) fall back to `action` — the user picking
		// them will still run the real callback inside the iframe,
		// which is the safe default.
		var src = '';
		try { src = Function.prototype.toString.call( cmd.callback ); } catch ( _err ) { src = ''; }
		var navRe = /(?:document\.location\.href|window\.location\.href|location\.href)\s*=\s*['"]([^'"$]+?)['"]/;
		var asgRe = /location\.(?:assign|replace)\s*\(\s*['"]([^'"$]+?)['"]\s*\)/;
		var mm = src.match( navRe ) || src.match( asgRe );
		if ( mm && mm[ 1 ] ) {
			try {
				out.url  = new URL( mm[ 1 ], window.location.href ).toString();
				out.kind = 'navigate';
			} catch ( _err ) {
				out.kind = 'action';
			}
		}
		__wpdCommandsKindCache[ out.name ] = { kind: out.kind, url: out.url, iconSvg: out.iconSvg };
		return out;
	}

	// Harvested commands accumulate here. The React harvester writes
	// the full list each render; `__wpdPostCommandsList` reads + posts.
	var __wpdLastRawCommands = [];
	// Name → live `callback` reference. Loader-returned commands are
	// NOT in `wp.data.select('core/commands').getCommands()` — the
	// store only exposes statically-registered entries. Without a
	// private cache keyed off the React harvester's most recent render,
	// invoking a loader command from the parent palette ("Duplicate
	// block", "Transform to...", pattern commands) would silently fall
	// through to the `getCommands()` lookup and no-op.
	var __wpdCommandCallbacks = Object.create( null );

	function __wpdFinalizeCommands( raw ) {
		var seen = Object.create( null );
		var out = [];
		var skipped = { missing: 0, disabled: 0, dup: 0 };
		for ( var i = 0; i < raw.length; i++ ) {
			var cmd = raw[ i ];
			if ( ! cmd || ! cmd.name || ! cmd.label ) { skipped.missing++; continue; }
			if ( cmd.disabled ) { skipped.disabled++; continue; }
			if ( seen[ cmd.name ] ) { skipped.dup++; continue; }
			seen[ cmd.name ] = true;
			out.push( __wpdClassifyCommand( cmd ) );
		}
		return out;
	}

	function __wpdHarvestCommands() {
		return __wpdFinalizeCommands( __wpdLastRawCommands );
	}

	// React-mounted harvester. Block-level / editor-contextual commands
	// (tier 3 loaders like `core/block-editor/selected-block-commands`,
	// `core/edit-post/pattern-commands`) are React *hooks* — they call
	// `useSelect` internally, which only works inside a function-
	// component render. So we mount an invisible React tree whose
	// children invoke each loader's hook at render time. On every
	// re-render (block selection changes, entity edits, welcome guide
	// toggled) the effect re-posts the fresh command list to the
	// parent. One component per loader keeps the rules-of-hooks
	// contract — the hook count inside each `LoaderSlot` is fixed at
	// one call (plus the constant `useEffect`), so React's reconciler
	// is happy.
	var __wpdReactMounted = false;
	// Stashed so `__wpdUnsubscribeCommands` can tear the harvester
	// down when focus leaves the window — otherwise the component
	// keeps re-rendering on every store tick, calling `mergeAndPost`,
	// and posting command lists the parent drops on the floor.
	var __wpdReactRoot    = null;
	var __wpdReactHost    = null;

	function __wpdMountReactHarvester() {
		if ( __wpdReactMounted ) return;
		if ( ! window.wp || ! window.wp.element || ! window.wp.data ) {
			return;
		}
		var el        = window.wp.element;
		var createEl  = el.createElement;
		var useEffect = el.useEffect;
		var useRef    = el.useRef;
		var useMemo   = el.useMemo;
		var useSelect = ( window.wp.data && window.wp.data.useSelect ) || null;
		if ( ! createEl || ! useSelect || ! el.createRoot || ! useRef ) {
			return;
		}
		__wpdReactMounted = true;

		// Hidden mount point. Positioned off-screen + `aria-hidden` so
		// nothing the harvester renders (it renders null anyway) can
		// leak into the accessibility tree or the visible document.
		var host = document.createElement( 'div' );
		host.setAttribute( 'aria-hidden', 'true' );
		host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;left:-9999px;top:-9999px;';
		( document.body || document.documentElement ).appendChild( host );
		__wpdReactHost = host;

		// Shared mutable bucket — ref-based aggregation to avoid the
		// classic setState-inside-useEffect loop. A `setState` here
		// would fire a parent re-render, which would fire the loader
		// hook again, which returns a fresh commands array with a new
		// reference even when the contents are identical, which would
		// re-fire the effect and setState again → Maximum update
		// depth exceeded. Refs don't trigger renders, so the loop is
		// broken even when hooks churn references.
		var resultsBucket = { perLoader: {}, statics: [], loadersList: [] };

		function commandsFingerprint( cmds ) {
			if ( ! Array.isArray( cmds ) || cmds.length === 0 ) return '';
			// Cheap identity — name count is enough to decide whether
			// to re-post. Accepts some false negatives (two different
			// commands sharing a name) we'll never hit in practice.
			var keys = new Array( cmds.length );
			for ( var i = 0; i < cmds.length; i++ ) {
				var c = cmds[ i ];
				keys[ i ] = c && c.name ? c.name : '';
			}
			return keys.join( '|' );
		}

		function mergeAndPost() {
			var merged = [];
			var loadersList = resultsBucket.loadersList;
			if ( Array.isArray( loadersList ) ) {
				for ( var i = 0; i < loadersList.length; i++ ) {
					var bucket = resultsBucket.perLoader[ loadersList[ i ] ];
					if ( Array.isArray( bucket ) ) merged = merged.concat( bucket );
				}
			}
			if ( Array.isArray( resultsBucket.statics ) ) {
				merged = merged.concat( resultsBucket.statics );
			}
			// Refresh the callback cache off the SAME snapshot we're
			// about to post. Loader-returned commands close over React
			// state (selected block, edited entity, etc.) that's only
			// valid for this render pass, so rebuilding from scratch
			// every merge keeps invoke-from-parent honest instead of
			// calling a stale closure.
			__wpdCommandCallbacks = Object.create( null );
			for ( var j = 0; j < merged.length; j++ ) {
				var cc = merged[ j ];
				if ( cc && cc.name && typeof cc.callback === 'function' ) {
					__wpdCommandCallbacks[ cc.name ] = cc.callback;
				}
			}
			__wpdLastRawCommands = merged;
			__wpdSchedulePost();
		}

		// One slot per loader. Calls the loader's hook at render time;
		// an effect keyed on the commands' name-fingerprint writes the
		// fresh list into the shared bucket and posts. Ref-based, no
		// setState → no re-render cascade.
		function LoaderSlot( props ) {
			var loader = props.loader;
			var result = null;
			try {
				result = loader.hook( { search: '' } );
			} catch ( _err ) {
				/* swallow — a buggy loader hook shouldn't take the harvester down */
			}
			var cmds = ( result && Array.isArray( result.commands ) ) ? result.commands : [];
			var key  = useMemo( function () { return commandsFingerprint( cmds ); }, [ cmds ] );

			useEffect( function () {
				resultsBucket.perLoader[ loader.name ] = cmds;
				mergeAndPost();
			}, [ key ] );

			useEffect( function () {
				return function () {
					delete resultsBucket.perLoader[ loader.name ];
					mergeAndPost();
				};
			}, [] );

			return null;
		}

		function Harvester() {
			var loaders = useSelect( function ( s ) {
				var ss = s( 'core/commands' );
				return ( ss && typeof ss.getCommandLoaders === 'function' )
					? ss.getCommandLoaders( true )
					: [];
			}, [] );
			var staticCmds = useSelect( function ( s ) {
				var ss = s( 'core/commands' );
				return ( ss && typeof ss.getCommands === 'function' )
					? ss.getCommands( true )
					: [];
			}, [] );

			// Track the loader-name ordering so `mergeAndPost` can emit
			// tier-3 in a deterministic order (React reconciliation
			// order = registration order = the order the user sees).
			var loadersNames = useMemo( function () {
				if ( ! Array.isArray( loaders ) ) return [];
				return loaders.map( function ( l ) { return l ? l.name : ''; } );
			}, [ loaders ] );
			var loadersKey = loadersNames.join( '|' );
			useEffect( function () {
				resultsBucket.loadersList = loadersNames;
				mergeAndPost();
			}, [ loadersKey ] );

			var staticKey = useMemo( function () { return commandsFingerprint( staticCmds ); }, [ staticCmds ] );
			useEffect( function () {
				resultsBucket.statics = Array.isArray( staticCmds ) ? staticCmds : [];
				mergeAndPost();
			}, [ staticKey ] );

			if ( ! Array.isArray( loaders ) || loaders.length === 0 ) {
				return null;
			}
			var children = [];
			for ( var i = 0; i < loaders.length; i++ ) {
				var loader = loaders[ i ];
				if ( ! loader || typeof loader.hook !== 'function' ) continue;
				children.push( createEl( LoaderSlot, {
					key: loader.name,
					loader: loader
				} ) );
			}
			return createEl( el.Fragment || 'div', null, children );
		}

		try {
			var root = el.createRoot( host );
			__wpdReactRoot = root;
			root.render( createEl( Harvester ) );
		} catch ( err ) {
			__wpdReactMounted = false;
			__wpdReactRoot    = null;
			if ( __wpdReactHost && __wpdReactHost.parentNode ) {
				__wpdReactHost.parentNode.removeChild( __wpdReactHost );
			}
			__wpdReactHost = null;
		}
	}

	function __wpdUnmountReactHarvester() {
		if ( __wpdReactRoot ) {
			try { __wpdReactRoot.unmount(); } catch ( _err ) { /* swallow */ }
		}
		__wpdReactRoot = null;
		if ( __wpdReactHost && __wpdReactHost.parentNode ) {
			__wpdReactHost.parentNode.removeChild( __wpdReactHost );
		}
		__wpdReactHost       = null;
		__wpdReactMounted    = false;
		__wpdLastRawCommands = [];
		__wpdCommandCallbacks = Object.create( null );
	}

	function __wpdPostCommandsList() {
		var list = __wpdHarvestCommands();
		// Cheap de-dupe — the store fires on every unrelated preference
		// change too, and shipping an identical payload is pure noise.
		// Fingerprint on `name|kind|url` keeps us sensitive to the
		// visible surface (name changes, navigate-vs-action flips,
		// destination URL changes) while skipping `JSON.stringify` of
		// the entire payload — label/icon churn inside a single command
		// is rare and re-shipping on it is harmless noise vs. a hot
		// path allocation cost.
		var key = '';
		for ( var k = 0; k < list.length; k++ ) {
			var lc = list[ k ];
			key += ( lc && lc.name ? lc.name : '' ) + '|'
				+ ( lc && lc.kind ? lc.kind : '' ) + '|'
				+ ( lc && lc.url  ? lc.url  : '' ) + '\n';
		}
		if ( key === __wpdCommandsLastPayload ) {
			return;
		}
		__wpdCommandsLastPayload = key;
		try {
			window.parent.postMessage(
				{ type: 'wp-desktop-commands-list', commands: list },
				__wpdCommandsOrigin
			);
		} catch ( _err ) {
			/* cross-origin parent (shouldn't happen for chromeless pages, but
			 * don't let a throw break the bridge) */
		}
	}

	function __wpdSchedulePost() {
		if ( __wpdCommandsDebounceId !== null ) return;
		__wpdCommandsDebounceId = window.setTimeout( function () {
			__wpdCommandsDebounceId = null;
			__wpdPostCommandsList();
		}, 60 );
	}

	function __wpdSubscribeCommands() {
		__wpdCommandsSubscribed = true;

		// If the React harvester is already running (focus left and
		// came back), the bucket still holds the latest merged list.
		// Reset the dedupe key so the next post actually ships, then
		// schedule it. The harvester itself won't re-fire its effects
		// just because the parent re-subscribed — React only reacts to
		// store changes, and the store hasn't changed. We have to
		// push from here.
		if ( __wpdReactMounted ) {
			__wpdCommandsLastPayload = '';
			__wpdSchedulePost();
			return;
		}

		var attempts = 0;
		function tryBind() {
			if ( ! __wpdCommandsSubscribed ) return;
			if ( ! window.wp || ! window.wp.data || typeof window.wp.data.subscribe !== 'function' ) {
				if ( attempts++ < 40 ) {
					window.setTimeout( tryBind, 150 );
				}
				return;
			}
			// Mount the React harvester — tier 3 loaders are hooks and
			// need a legal render context to execute. On every re-render
			// the component's effect calls `__wpdSchedulePost` with the
			// fresh merged list, so we don't need a separate
			// `wp.data.subscribe` callback.
			__wpdMountReactHarvester();
		}
		tryBind();
	}

	function __wpdUnsubscribeCommands() {
		__wpdCommandsSubscribed  = false;
		__wpdCommandsLastPayload = '';
		if ( __wpdCommandsDebounceId !== null ) {
			try { window.clearTimeout( __wpdCommandsDebounceId ); } catch ( _err ) { /* swallow */ }
			__wpdCommandsDebounceId = null;
		}
		// Fully tear down the React harvester. Keeping it mounted in
		// the background wastes CPU: every store tick re-renders the
		// loader hooks, which rebuild the callback cache and post to
		// the parent (who drops the message because this window isn't
		// the subscribed one). On re-subscribe we remount from scratch.
		__wpdUnmountReactHarvester();
	}

	function __wpdInvokeCommand( name ) {
		// Primary lookup — the React harvester's latest snapshot. This
		// covers loader-returned commands (Duplicate block, Transform
		// to, pattern commands) that never appear in the static
		// `getCommands()` list.
		var cb = __wpdCommandCallbacks[ name ];
		if ( typeof cb === 'function' ) {
			try {
				cb( { close: function () {} } );
			} catch ( _err ) {
				/* swallow — a plugin command callback that throws shouldn't break the bridge */
			}
			return;
		}
		// Fallback — statically registered commands that never passed
		// through the harvester (registered after the last render).
		if ( ! window.wp || ! window.wp.data ) {
			return;
		}
		var sel = null;
		try { sel = window.wp.data.select( 'core/commands' ); } catch ( _err ) { return; }
		if ( ! sel || typeof sel.getCommands !== 'function' ) return;
		var raw;
		try { raw = sel.getCommands(); } catch ( _err ) { return; }
		if ( ! raw ) return;
		for ( var i = 0; i < raw.length; i++ ) {
			if ( raw[ i ] && raw[ i ].name === name && typeof raw[ i ].callback === 'function' ) {
				try {
					raw[ i ].callback( { close: function () {} } );
				} catch ( _err ) {
					/* swallow — see note in primary path above */
				}
				return;
			}
		}
	}

	// Attach the listener BEFORE the bridge-ready ping so a subscribe
	// posted synchronously in response is guaranteed to land.
	window.addEventListener( 'message', function ( e ) {
		if ( e.origin !== __wpdCommandsOrigin ) return;
		if ( ! e.data || typeof e.data.type !== 'string' ) return;
		if ( e.data.type === 'wp-desktop-commands-subscribe' ) {
			__wpdSubscribeCommands();
		} else if ( e.data.type === 'wp-desktop-commands-unsubscribe' ) {
			__wpdUnsubscribeCommands();
		} else if ( e.data.type === 'wp-desktop-commands-invoke' && typeof e.data.name === 'string' ) {
			__wpdInvokeCommand( e.data.name );
		}
	} );

	// Handshake: tell the parent we're ready so it can (re)send any
	// subscribe that was dispatched before this listener attached.
	// Without this ping, a subscribe posted during iframe navigation
	// arrives at a context whose message listener isn't installed yet
	// and is silently dropped — the symptom is an empty palette even
	// though `wp.data.select('core/commands')` is perfectly happy.
	try {
		window.parent.postMessage(
			{ type: 'wp-desktop-bridge-ready' },
			__wpdCommandsOrigin
		);
	} catch ( _err ) {
		/* parent gone or cross-origin — bridge handshake will retry on next load */
	}

	/*
	 * ` / Shift+` forwarder — window switcher.
	 *
	 * Bare backtick with no modifier. Must skip when focus is in a
	 * text-entry element, otherwise typing ` into a block, a text
	 * field, or TinyMCE would steal the keystroke. Non-text inputs
	 * (checkbox, button, select) don't accept character input, so
	 * cycling on those is fine.
	 *
	 * Same iframe-crossing rationale as the Cmd+K forwarder above:
	 * native keydown doesn't reach the parent, so we postMessage.
	 */
	document.addEventListener( 'keydown', function ( e ) {
		if ( e.ctrlKey || e.metaKey || e.altKey ) return;
		if ( e.code !== 'Backquote' ) return;

		// IFRAME case catches Gutenberg: the block canvas is a nested
		// iframe, and Gutenberg re-dispatches cloned keydowns up to
		// this document for its shortcut system. Without this branch
		// typing ` in a block would cycle windows. Any other nested
		// iframe owning keyboard handling gets the same treatment.
		var el = document.activeElement;
		if ( el ) {
			var tag = el.tagName;
			if ( tag === 'IFRAME' ) return;
			if ( tag === 'TEXTAREA' ) return;
			if ( tag === 'INPUT' ) {
				var type = ( el.type || '' ).toLowerCase();
				var textTypes = [
					'text', 'search', 'url', 'email', 'password',
					'tel', 'number', 'date', 'datetime-local',
					'month', 'week', 'time'
				];
				if ( textTypes.indexOf( type ) !== -1 ) return;
			}
			if ( el.isContentEditable ) return;
		}

		e.preventDefault();
		e.stopImmediatePropagation();

		try {
			window.parent.postMessage(
				{
					type:      'wp-desktop-window-switch',
					direction: e.shiftKey ? 'prev' : 'next'
				},
				window.location.origin
			);
		} catch ( err ) { /* cross-origin parent; swallow */ }
	}, true );

	// Skip if the standalone iframe-bridge bundle already wired
	// screen-meta hoisting on this page. Two bridges racing to read
	// `aria-expanded` and reflect state would double-fire the
	// `wp-desktop-screen-meta-state` message and flicker the
	// title-bar buttons.
	if ( window.__wpDesktopScreenMetaInstalled ) {
		return;
	}
	window.__wpDesktopScreenMetaInstalled = true;

	var links = document.getElementById( 'screen-meta-links' );
	if ( ! links ) {
		return;
	}
	var screenOptionsBtn = document.getElementById( 'show-settings-link' );
	var helpBtn = document.getElementById( 'contextual-help-link' );
	var panels = [];
	if ( screenOptionsBtn ) {
		panels.push( 'screen-options' );
	}
	if ( helpBtn ) {
		panels.push( 'help' );
	}
	if ( panels.length === 0 ) {
		return;
	}

	var origin = window.location.origin;

	window.parent.postMessage( {
		type: 'wp-desktop-screen-meta',
		panels: panels
	}, origin );

	function getOpenPanel() {
		if ( screenOptionsBtn && screenOptionsBtn.getAttribute( 'aria-expanded' ) === 'true' ) {
			return 'screen-options';
		}
		if ( helpBtn && helpBtn.getAttribute( 'aria-expanded' ) === 'true' ) {
			return 'help';
		}
		return null;
	}

	function reportState() {
		window.parent.postMessage( {
			type: 'wp-desktop-screen-meta-state',
			open: getOpenPanel()
		}, origin );
	}

	reportState();

	var observer = new MutationObserver( reportState );
	if ( screenOptionsBtn ) {
		observer.observe( screenOptionsBtn, { attributes: true, attributeFilter: [ 'aria-expanded' ] } );
	}
	if ( helpBtn ) {
		observer.observe( helpBtn, { attributes: true, attributeFilter: [ 'aria-expanded' ] } );
	}

	// WP's close() animates and shares #screen-meta between both panels,
	// so racing two animated clicks hides the panel that just opened.
	// Jump the other panel to its closed end state synchronously instead.
	function forceClose( button ) {
		if ( ! button || button.getAttribute( 'aria-expanded' ) !== 'true' ) {
			return;
		}
		var panelId = button.getAttribute( 'aria-controls' );
		var panel = panelId ? document.getElementById( panelId ) : null;
		if ( ! panel ) {
			return;
		}
		if ( window.jQuery ) {
			window.jQuery( panel ).stop( true, false );
		}
		panel.style.display = 'none';
		panel.classList.add( 'hidden' );
		if ( panel.parentNode instanceof HTMLElement ) {
			panel.parentNode.style.display = 'none';
		}
		button.classList.remove( 'screen-meta-active' );
		button.setAttribute( 'aria-expanded', 'false' );
		var toggles = document.querySelectorAll( '.screen-meta-toggle' );
		for ( var i = 0; i < toggles.length; i++ ) {
			toggles[ i ].style.visibility = '';
		}
	}

	/* -----------------------------------------------------------------
	 * Broadcast receiver — iframe side.
	 *
	 * The parent shell publishes broadcasts via
	 * `wp.desktop.broadcast(topic, payload)` (see `src/broadcast.ts`).
	 * It posts `{ type: 'wp-desktop-broadcast', topic, payload }` to
	 * every open iframe. Here we re-dispatch that as a CustomEvent
	 * on the iframe's own document so admin pages can subscribe with
	 * plain `document.addEventListener( 'wp-desktop-broadcast', cb )`
	 * — no extra script handle required.
	 *
	 * Iframe-side admin code can also publish UPSTREAM by posting
	 * the same shape to `window.parent`; the parent's
	 * `installBroadcastReceiver()` re-broadcasts to every other
	 * iframe + native window.
	 * ----------------------------------------------------------------- */
	window.addEventListener( 'message', function ( e ) {
		if ( e.origin !== origin ) {
			return;
		}
		if ( ! e.data || e.data.type !== 'wp-desktop-broadcast' ) {
			return;
		}
		try {
			document.dispatchEvent( new CustomEvent( 'wp-desktop-broadcast', {
				detail: { topic: e.data.topic, payload: e.data.payload }
			} ) );
		} catch ( _err ) { /* old browser without CustomEvent ctor — ignore */ }
	} );

	/* -----------------------------------------------------------------
	 * Soft-reload — iframe-side default handler.
	 *
	 * When a `wp-desktop.<post_type>.changed` broadcast fires AND the
	 * current iframe is on a known list page for that post type, we
	 * fetch the current URL and replace the iframe's `#wpbody-content`
	 * in place. The user sees the new state of the list — restored
	 * post appears, deleted media disappears — without the WP loading
	 * spinner that `location.reload()` would show.
	 *
	 * Single-edit pages (`post.php`, `post-new.php`) are deliberately
	 * NOT in the rule set: replacing their body would destroy any
	 * unsaved Gutenberg/classic-editor state. Plugins that want
	 * specific behaviour for those pages can subscribe to the same
	 * topic on `document` and handle it themselves.
	 *
	 * The fetch carries a custom header so a later phase can serve a
	 * minimal partial response if we want to optimise; for now WP
	 * returns the full admin page and we just pluck the body.
	 *
	 * WP list-table JS uses event delegation on `document`/`body`,
	 * which survives `replaceWith`. If a specific page breaks after
	 * a swap (e.g. inline-edit double-binding), that page's plugin
	 * should listen for `wp-desktop-soft-reloaded` and rebind.
	 * ----------------------------------------------------------------- */
	var WPDM_SOFT_RELOAD_RULES = [
		{
			topic: 'wp-desktop.post.changed',
			match: function () {
				if ( ! _wpdmEndsWith( location.pathname, '/wp-admin/edit.php' ) ) return false;
				var t = new URLSearchParams( location.search ).get( 'post_type' );
				return t === null || t === 'post';
			}
		},
		{
			topic: 'wp-desktop.page.changed',
			match: function () {
				if ( ! _wpdmEndsWith( location.pathname, '/wp-admin/edit.php' ) ) return false;
				return new URLSearchParams( location.search ).get( 'post_type' ) === 'page';
			}
		},
		{
			topic: 'wp-desktop.attachment.changed',
			match: function () {
				return _wpdmEndsWith( location.pathname, '/wp-admin/upload.php' );
			}
		},
		{
			topic: 'wp-desktop.comment.changed',
			match: function () {
				return _wpdmEndsWith( location.pathname, '/wp-admin/edit-comments.php' );
			}
		}
	];

	function _wpdmEndsWith( s, suffix ) { return s.lastIndexOf( suffix ) === s.length - suffix.length; }

	var _wpdmSoftReloadInFlight = false;
	var _wpdmSoftReloadQueued = false;

	function _wpdmSoftReload() {
		if ( _wpdmSoftReloadInFlight ) {
			_wpdmSoftReloadQueued = true;
			return;
		}
		_wpdmSoftReloadInFlight = true;
		fetch( location.href, {
			credentials: 'same-origin',
			cache: 'no-cache',
			headers: { 'X-WP-Desktop-Soft-Reload': '1' }
		} ).then( function ( r ) {
			if ( ! r.ok ) throw new Error( 'soft-reload fetch failed: ' + r.status );
			return r.text();
		} ).then( function ( html ) {
			var doc = new DOMParser().parseFromString( html, 'text/html' );
			var fresh = doc.querySelector( '#wpbody-content' );
			var live = document.querySelector( '#wpbody-content' );
			if ( ! fresh || ! live ) {
				/* Markup we expected isn't there — admin pages we
				 * don't recognise (or core changes the structure).
				 * Don't reload; let the iframe stay as it is rather
				 * than show a spinner the user told us not to. */
				return;
			}
			live.replaceWith( fresh );
			try {
				document.dispatchEvent( new CustomEvent( 'wp-desktop-soft-reloaded' ) );
			} catch ( _err ) {}
			/* Some WP scripts re-init on DOMContentLoaded only — let
			 * pages opt-in to a re-init by listening to the event
			 * above. We intentionally do NOT re-fire DOMContentLoaded;
			 * that's almost always wrong (double-init of jQuery/WP). */
		} ).catch( function ( err ) {
			/* Network error — leave the iframe untouched. The user's
			 * next manual interaction will refresh state, and the
			 * next broadcast will retry. */
			if ( window.console && window.console.warn ) {
				window.console.warn( '[wp-desktop] soft-reload skipped:', err );
			}
		} ).then( function () {
			_wpdmSoftReloadInFlight = false;
			if ( _wpdmSoftReloadQueued ) {
				_wpdmSoftReloadQueued = false;
				_wpdmSoftReload();
			}
		} );
	}

	document.addEventListener( 'wp-desktop-broadcast', function ( e ) {
		var detail = e.detail || {};
		var topic = detail.topic;
		if ( ! topic ) return;
		for ( var i = 0; i < WPDM_SOFT_RELOAD_RULES.length; i++ ) {
			var r = WPDM_SOFT_RELOAD_RULES[ i ];
			if ( r.topic === topic && r.match() ) {
				_wpdmSoftReload();
				return;
			}
		}
	} );

	window.addEventListener( 'message', function( e ) {
		if ( e.origin !== origin ) {
			return;
		}
		if ( ! e.data || e.data.type !== 'wp-desktop-toggle-panel' ) {
			return;
		}
		var target = null;
		if ( e.data.panel === 'screen-options' && screenOptionsBtn ) {
			target = screenOptionsBtn;
		} else if ( e.data.panel === 'help' && helpBtn ) {
			target = helpBtn;
		}
		if ( ! target ) {
			return;
		}
		if ( target.getAttribute( 'aria-expanded' ) !== 'true' ) {
			var other = target === screenOptionsBtn ? helpBtn : screenOptionsBtn;
			forceClose( other );
		}
		target.click();
	} );

	/* -----------------------------------------------------------------
	 * Connection bridge — iframe side.
	 *
	 * Plugins call `wp.desktop.iframe.publish(topic, payload)` /
	 * `subscribe(topic, cb)` / `onConnection(cb)` to talk to a parent-
	 * side `wp.desktop.connect()` caller. The shell only routes;
	 * topic semantics are plugin-defined.
	 *
	 * Connections are tracked locally so `onConnection` can fire when
	 * the parent opens a new channel (typical use: start emitting
	 * heavy events only after at least one consumer subscribed). Each
	 * connection carries a topic-allowlist negotiated at handshake
	 * time — wildcard ('*') subscribers see everything.
	 * ----------------------------------------------------------------- */
	var _wpdConnections = {};
	var _wpdConnectionListeners = [];
	var _wpdSubs = {};   // topic → [cb, ...]
	var _wpdChannelSubs = {};   // channel → [cb, ...] (window-channel API)
	var _wpdParentOrigin = window.location.origin;

	function _wpdEmitToParent( connectionId, topic, payload ) {
		try {
			window.parent.postMessage( {
				type: 'wp-desktop-bridge-publish',
				connectionId: connectionId,
				topic: topic,
				payload: payload
			}, _wpdParentOrigin );
		} catch ( _err ) { /* parent gone */ }
	}

	window.addEventListener( 'message', function ( ev ) {
		if ( ev.origin !== _wpdParentOrigin ) {
			return;
		}
		var data = ev && ev.data;
		if ( ! data || typeof data !== 'object' || typeof data.type !== 'string' ) {
			return;
		}

		if ( data.type === 'wp-desktop-bridge-handshake' && typeof data.connectionId === 'string' ) {
			if ( _wpdConnections[ data.connectionId ] ) {
				/* Re-handshake on iframe-ready re-arm — no-op besides
				 * acking again so the parent can resume. */
				try {
					window.parent.postMessage( {
						type: 'wp-desktop-bridge-handshake-ack',
						connectionId: data.connectionId
					}, _wpdParentOrigin );
				} catch ( _err ) { /* swallow */ }
				return;
			}
			var conn = {
				id: data.connectionId,
				topics: Array.isArray( data.topics ) ? data.topics.slice() : []
			};
			_wpdConnections[ conn.id ] = conn;
			try {
				window.parent.postMessage( {
					type: 'wp-desktop-bridge-handshake-ack',
					connectionId: conn.id
				}, _wpdParentOrigin );
			} catch ( _err ) { /* swallow */ }
			for ( var i = 0; i < _wpdConnectionListeners.length; i++ ) {
				try {
					_wpdConnectionListeners[ i ]( {
						id: conn.id,
						topics: conn.topics.slice()
					} );
				} catch ( _err ) { /* swallow listener */ }
			}
			return;
		}

		if ( data.type === 'wp-desktop-bridge-publish' && typeof data.topic === 'string' ) {
			var bucket = _wpdSubs[ data.topic ];
			if ( bucket ) {
				for ( var j = 0; j < bucket.length; j++ ) {
					try {
						bucket[ j ]( data.payload, { topic: data.topic, connectionId: data.connectionId } );
					} catch ( _err ) { /* swallow subscriber */ }
				}
			}
			var wildcard = _wpdSubs[ '*' ];
			if ( wildcard ) {
				for ( var k = 0; k < wildcard.length; k++ ) {
					try {
						wildcard[ k ]( data.payload, { topic: data.topic, connectionId: data.connectionId } );
					} catch ( _err ) { /* swallow */ }
				}
			}
			return;
		}

		if ( data.type === 'wp-desktop-bridge-disconnect' && typeof data.connectionId === 'string' ) {
			delete _wpdConnections[ data.connectionId ];
			return;
		}

		/* Unified window-channel delivery from the parent. Fires
		 * every `wp.desktop.on( channel, cb )` subscriber for the
		 * matching channel — same protocol as
		 * `assets/js/iframe-bridge.js`. */
		if ( data.type === 'wp-desktop-window-send' && typeof data.channel === 'string' && data.channel !== '' ) {
			var meta = { channel: data.channel };
			var cBucket = _wpdChannelSubs[ data.channel ];
			if ( cBucket ) {
				var cBucketSnap = cBucket.slice();
				for ( var ci = 0; ci < cBucketSnap.length; ci++ ) {
					try {
						cBucketSnap[ ci ]( data.payload, meta );
					} catch ( _err ) { /* swallow */ }
				}
			}
			var cWildcard = _wpdChannelSubs[ '*' ];
			if ( cWildcard ) {
				var cWildcardSnap = cWildcard.slice();
				for ( var cw = 0; cw < cWildcardSnap.length; cw++ ) {
					try {
						cWildcardSnap[ cw ]( data.payload, meta );
					} catch ( _err ) { /* swallow */ }
				}
			}
			return;
		}
	} );

	var iframeApi = {
		/**
		 * Publish a payload under a topic. Sent to every connection
		 * — typical case is one connection per parent caller, but
		 * a debug console may have several at once.
		 */
		publish: function ( topic, payload ) {
			if ( typeof topic !== 'string' || topic === '' ) {
				return;
			}
			var ids = Object.keys( _wpdConnections );
			for ( var i = 0; i < ids.length; i++ ) {
				_wpdEmitToParent( ids[ i ], topic, payload );
			}
		},
		/**
		 * Subscribe to a topic. Returns an unsubscribe function.
		 * Use `'*'` to receive every published payload (debugging).
		 */
		subscribe: function ( topic, cb ) {
			if ( typeof topic !== 'string' || topic === '' || typeof cb !== 'function' ) {
				return function () {};
			}
			var bucket = _wpdSubs[ topic ];
			if ( ! bucket ) {
				bucket = [];
				_wpdSubs[ topic ] = bucket;
			}
			bucket.push( cb );
			return function () {
				var i = bucket.indexOf( cb );
				if ( i >= 0 ) {
					bucket.splice( i, 1 );
				}
			};
		},
		/**
		 * Notified whenever a parent caller opens a connection. Use
		 * to start emitting heavy publish events only when somebody
		 * is listening.
		 */
		onConnection: function ( cb ) {
			if ( typeof cb !== 'function' ) {
				return function () {};
			}
			_wpdConnectionListeners.push( cb );
			/* Replay current connections — late subscribers still
			 * see who's already there. */
			var ids = Object.keys( _wpdConnections );
			for ( var i = 0; i < ids.length; i++ ) {
				try {
					cb( {
						id: _wpdConnections[ ids[ i ] ].id,
						topics: _wpdConnections[ ids[ i ] ].topics.slice()
					} );
				} catch ( _err ) { /* swallow */ }
			}
			return function () {
				var i = _wpdConnectionListeners.indexOf( cb );
				if ( i >= 0 ) {
					_wpdConnectionListeners.splice( i, 1 );
				}
			};
		},
		/**
		 * Iframe-initiated connection request. See
		 * `assets/js/iframe-bridge.js` — same shape, same protocol.
		 */
		requestConnection: function ( opts ) {
			opts = opts || {};
			var topics = Array.isArray( opts.topics ) ? opts.topics.slice() : [];
			var requestId = 'wpdir-' + Math.random().toString( 36 ).slice( 2, 10 );

			return new Promise( function ( resolve, reject ) {
				var settled = false;
				var timeoutMs = typeof opts.timeoutMs === 'number'
					? opts.timeoutMs
					: 5000;

				function settle( ok, value ) {
					if ( settled ) {
						return;
					}
					settled = true;
					window.removeEventListener( 'message', onAck );
					clearTimeout( timer );
					if ( ok ) {
						resolve( value );
					} else {
						reject( value );
					}
				}

				function onAck( ev ) {
					if ( ev.origin !== _wpdParentOrigin ) {
						return;
					}
					var d = ev && ev.data;
					if (
						! d ||
						typeof d !== 'object' ||
						d.type !== 'wp-desktop-bridge-connection-ack' ||
						d.requestId !== requestId
					) {
						return;
					}
					if ( d.accepted ) {
						var summary = {
							id: typeof d.connectionId === 'string' ? d.connectionId : '',
							topics: topics.slice()
						};
						if ( typeof opts.onOpen === 'function' ) {
							try { opts.onOpen( summary ); } catch ( _err ) { /* swallow */ }
						}
						settle( true, summary );
					} else {
						settle( false, new Error( d.reason || 'rejected' ) );
					}
				}
				window.addEventListener( 'message', onAck );

				var timer = setTimeout( function () {
					settle( false, new Error( 'timeout' ) );
				}, timeoutMs );

				try {
					window.parent.postMessage( {
						type: 'wp-desktop-bridge-connection-request',
						requestId: requestId,
						topics: topics
					}, _wpdParentOrigin );
				} catch ( err ) {
					settle( false, err );
				}
			} );
		}
	};

	if ( ! window.wp ) { window.wp = {}; }
	if ( ! window.wp.desktop ) { window.wp.desktop = {}; }
	window.wp.desktop.iframe = iframeApi;

	/* Unified window-channel API. Mirror of the equivalent block
	 * in `assets/js/iframe-bridge.js` — keep both in sync. The
	 * parent shell posts `wp-desktop-window-send` on
	 * `Window.send( channel, payload )`; iframe-side handlers
	 * register via `wp.desktop.on( channel, cb )`. Sending the
	 * other way (`wp.desktop.send`) posts up to the parent where
	 * `Window.on( channel, cb )` subscribers fire. */
	if ( typeof window.wp.desktop.send !== 'function' ) {
		window.wp.desktop.send = function ( channel, payload ) {
			if ( typeof channel !== 'string' || channel === '' ) {
				return;
			}
			try {
				window.parent.postMessage( {
					type: 'wp-desktop-window-publish',
					channel: channel,
					payload: payload
				}, _wpdParentOrigin );
			} catch ( _err ) { /* parent gone */ }
		};
	}
	if ( typeof window.wp.desktop.on !== 'function' ) {
		window.wp.desktop.on = function ( channel, cb ) {
			if ( typeof channel !== 'string' || channel === '' || typeof cb !== 'function' ) {
				return function () {};
			}
			var bucket = _wpdChannelSubs[ channel ];
			if ( ! bucket ) {
				bucket = [];
				_wpdChannelSubs[ channel ] = bucket;
			}
			bucket.push( cb );
			return function () {
				var i = bucket.indexOf( cb );
				if ( i >= 0 ) {
					bucket.splice( i, 1 );
				}
			};
		};
	}
} )();
JS;

	// Substitute the server-built menu payload into the bridge
	// script. `wp_json_encode` guarantees safe JSON output — no need
	// for an additional escape pass. When the page isn't on our
	// menu-altering allowlist the placeholder resolves to `null` and
	// the bridge skips the postMessage.
	$js = str_replace( '/*__WPDM_MENU_PAYLOAD__*/', $menu_payload_json, $js );

	wp_print_inline_script_tag( $js );
}
add_action( 'admin_footer', 'desktop_mode_chromeless_bridge_script' );

/**
 * Outputs a same-origin admin link/form rewriter for detached ("classic
 * override") tabs.
 *
 * Without this, the first navigation after a detach drops the
 * `desktop_mode_classic=1` flag and the next page falls back to the
 * desktop shell — because the user meta is still `'1'` and the
 * `admin_init` portal redirect kicks in. The JS here re-stamps the flag
 * on every same-origin `/wp-admin/` `<a href>` and `<form action>` so
 * navigations within the tab stay classic. Server-side redirects are
 * covered by {@see desktop_mode_classic_preserve_redirect}.
 *
 * Narrowly scoped: only runs when the current request itself carries
 * the classic flag. Skips modifier-clicks (cmd/ctrl/shift/alt), targets
 * other than `_self`, downloads, anchors, and non-http schemes so we
 * don't break "open in new tab" or mailto links.
 *
 * @since 0.4.0
 */
function desktop_mode_classic_link_interceptor() {
	if ( ! desktop_mode_is_classic_request() ) {
		return;
	}

	$flag_literal = wp_json_encode( DESKTOP_MODE_CLASSIC_FLAG );

	$js = "
( function () {
	var FLAG = {$flag_literal};

	function rewriteAdminUrl( href, base ) {
		if ( ! href || href.charAt( 0 ) === '#' ) {
			return null;
		}
		if ( /^(mailto:|tel:|javascript:|data:)/i.test( href ) ) {
			return null;
		}
		var url;
		try {
			url = new URL( href, base );
		} catch ( err ) {
			return null;
		}
		if ( url.origin !== window.location.origin ) {
			return null;
		}
		if ( url.pathname.indexOf( '/wp-admin/' ) === -1 ) {
			return null;
		}
		if ( url.searchParams.has( FLAG ) ) {
			return null;
		}
		url.searchParams.set( FLAG, '1' );
		return url.toString();
	}

	document.addEventListener( 'click', function ( e ) {
		if ( e.defaultPrevented ) {
			return;
		}
		if ( e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) {
			return;
		}
		var link = e.target && e.target.closest ? e.target.closest( 'a[href]' ) : null;
		if ( ! link ) {
			return;
		}
		if ( link.target && link.target !== '' && link.target !== '_self' ) {
			return;
		}
		if ( link.hasAttribute( 'download' ) ) {
			return;
		}
		var rewritten = rewriteAdminUrl( link.getAttribute( 'href' ), window.location.href );
		if ( rewritten ) {
			link.setAttribute( 'href', rewritten );
		}
	}, true );

	document.addEventListener( 'submit', function ( e ) {
		var form = e.target;
		if ( ! form || form.tagName !== 'FORM' ) {
			return;
		}
		var action = form.getAttribute( 'action' );
		var rewritten = rewriteAdminUrl( action || window.location.href, window.location.href );
		if ( rewritten ) {
			form.setAttribute( 'action', rewritten );
		}
	}, true );
} )();
";

	wp_print_inline_script_tag( $js );
}
add_action( 'admin_footer', 'desktop_mode_classic_link_interceptor' );
