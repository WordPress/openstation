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
function wpdm_admin_body_classes( $classes ) {
	if ( wpdm_is_chromeless_request() ) {
		return ltrim( $classes . ' wp-desktop-chromeless' );
	}

	// Per-request classic override: don't tag the body as desktop-active so
	// the classic chrome isn't hidden by CSS for this one tab.
	if ( wpdm_is_classic_request() ) {
		return $classes;
	}

	if ( wpdm_is_enabled() ) {
		return ltrim( $classes . ' wp-desktop-active' );
	}

	return $classes;
}
add_filter( 'admin_body_class', 'wpdm_admin_body_classes' );

/**
 * Enqueues the desktop mode shell assets (CSS + JS) when desktop mode is active.
 *
 * Only loads the full desktop shell scripts and styles when the user has
 * desktop mode enabled and the request is not a chromeless iframe load.
 *
 * @since 0.1.0
 */
function wpdm_enqueue_assets() {
	if ( ! is_admin() ) {
		return;
	}

	// Chromeless requests (iframes) need chromeless styles and overrides.
	if ( wpdm_is_chromeless_request() ) {
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
		do_action( 'wp_desktop_chromeless_styles' );
		return;
	}

	if ( ! wpdm_is_enabled() || wpdm_is_classic_request() ) {
		return;
	}

	// CSS.
	wp_enqueue_style( 'wp-desktop' );
	wp_enqueue_style( 'wp-desktop-windows' );
	wp_enqueue_style( 'wp-desktop-dock' );
	wp_enqueue_style( 'wp-desktop-ai-assistant' );

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

	// Build dock items from the admin menu, then split by placement.
	// Core pages (Dashboard, Posts, Plugins, Users, Settings, …) go
	// to the left-edge dock; installed-plugin top-level routes go to
	// the bottom taskbar. `wpdm_is_core_menu_slug` is the heuristic;
	// `wp_desktop_dock_placement` is the per-item filter escape hatch.
	// `wpdm_build_menu_payload` is shared with the REST menu endpoint
	// so a live refresh (post plugin-activation) produces the same
	// split the boot payload did.
	$menu_payload    = wpdm_build_menu_payload();
	$dock_items      = $menu_payload['dockItems'];
	$taskbar_items   = $menu_payload['taskbarItems'];
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
	$desktop_icons     = isset( $menu_payload['desktopIcons'] )
		? $menu_payload['desktopIcons']
		: array();

	// Build the current page URL from $pagenow + $_GET. Strip the portal
	// marker so the derived window ID matches what the dock would produce
	// for the same page — otherwise auto-opening the entry window and
	// clicking the same dock icon would create a duplicate.
	$current_query = $_GET; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	unset( $current_query[ WPDM_PORTAL_FLAG ] );
	$current_page = admin_url( $pagenow ) . ( ! empty( $current_query ) ? '?' . http_build_query( $current_query ) : '' );

	$from_portal = ! empty( $_GET[ WPDM_PORTAL_FLAG ] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended

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
	 *     @type array  $dockItems    Dock items derived from the admin menu, filtered to CORE WordPress pages (Dashboard, Posts, Plugins, Users, Settings, CPTs…).
	 *     @type array  $taskbarItems Plugin-contributed top-level menu items (admin.php?page=*). Rendered in the bottom taskbar — see `wpdm_dock_placement` + `wp_desktop_dock_placement` for the routing heuristic.
	 *     @type array  $nativeWindows Server-declared native windows (via `wp_register_desktop_window`). Shell registers + syncs tiles based on this list — activation/deactivation is a diff without shell reload.
	 *     @type array  $serverWidgets Server-declared right-column widgets (via `wp_register_desktop_widget`). Shell syncs the widget registry + dynamically loads plugin scripts so widgets appear in the picker without a shell reload.
	 *     @type array  $serverWallpapers Server-declared wallpapers (via `wp_register_desktop_wallpaper`). Same lifecycle — shell loads the plugin's JS, reads the full `WallpaperDef` from `window.wpDesktopWallpapers[id]`, and registers / unregisters as plugins activate / deactivate.
	 *     @type array  $serverCommandScripts Script handles opted-in via `wp_desktop_register_command_script`. Shell injects each URL on activation so commands registered by `wp.desktop.registerCommand` appear in the palette live. Deactivation unregisters any commands whose `owner` matches the departing handle.
	 *     @type array  $serverCommands   Server-declared command metadata (via `wp_register_desktop_command`). Advisory today — reserved for future pre-registration shims.
	 *     @type array  $desktopIcons     Server-declared desktop icons (via `wp_register_desktop_icon`). Rendered on the wallpaper as clickable shortcut tiles.
	 *     @type array  $accentColors     Swatch list for the OS Settings accent picker. Filterable via `wp_desktop_accent_colors`.
	 *     @type array  $toastTypes       Toast-notification type map. Filterable via `wp_desktop_toast_types`.
	 *     @type string $defaultWallpaper Wallpaper slug applied on first boot. Filterable via `wp_desktop_default_wallpaper`.
	 *     @type array  $session      Saved session (windows, focused, updated).
	 *     @type string $sessionUrl       REST endpoint for saving the session.
	 *     @type string $mediaUrl         REST endpoint for media uploads (wp/v2/media).
	 *     @type string $menuUrl          REST endpoint for fetching the current admin-menu split (live refresh after plugin activation/deactivation).
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
		'wp_desktop_shell_config',
		array(
			'currentPage'      => esc_url( $current_page ),
			'currentTitle'     => wp_strip_all_tags( $title ),
			'currentIcon'      => sanitize_html_class( $menu_icon ),
			'adminUrl'         => esc_url( admin_url() ),
			'colorScheme'      => sanitize_html_class( get_user_option( 'admin_color' ), 'fresh' ),
			'dockItems'        => $dock_items,
			'taskbarItems'     => $taskbar_items,
			'nativeWindows'    => $native_windows,
			'serverWidgets'    => $server_widgets,
			'serverWallpapers' => $server_wallpapers,
			'serverCommandScripts' => $server_command_scripts,
			'serverCommands'   => $server_commands,
			'desktopIcons'     => $desktop_icons,
			'accentColors'     => wpdm_get_accent_colors(),
			'toastTypes'       => wpdm_get_toast_types(),
			'defaultWallpaper' => wpdm_get_default_wallpaper(),
			'session'          => wpdm_get_session( get_current_user_id() ),
			'sessionUrl'       => esc_url_raw( rest_url( 'wp-desktop/v1/session' ) ),
			'mediaUrl'         => esc_url_raw( rest_url( 'wp/v2/media' ) ),
			'menuUrl'          => esc_url_raw( rest_url( 'wp-desktop/v1/menu' ) ),
			'defaultWindowUrl' => esc_url_raw( rest_url( 'wp-desktop/v1/default-window' ) ),
			'defaultWindow'    => wpdm_get_default_window( get_current_user_id() ),
			'canUpload'        => current_user_can( 'upload_files' ),
			'pluginUrl'        => esc_url_raw( untrailingslashit( WPDM_URL ) ),
			'restNonce'        => wp_create_nonce( 'wp_rest' ),
			'osSettings'            => wpdm_get_os_settings( get_current_user_id() ),
			'osSettingsUrl'         => esc_url_raw( rest_url( 'wp-desktop/v1/os-settings' ) ),
			'aiSearchUrl'           => esc_url_raw( rest_url( 'wp-desktop/v1/ai/search' ) ),
			'aiSearchStreamUrl'     => esc_url_raw( add_query_arg( 'action', 'wpdm_ai_search_stream', admin_url( 'admin-ajax.php' ) ) ),
			'aiPlatformSettings'    => current_user_can( 'manage_options' ) ? wpdm_ai_get_platform_settings() : null,
			'aiPlatformSettingsUrl' => esc_url_raw( rest_url( 'wp-desktop/v1/ai/platform-settings' ) ),
			'extendedOptions'       => current_user_can( 'manage_options' ) ? wpdm_get_extended_options() : null,
			'extendedOptionsUrl'    => esc_url_raw( rest_url( 'wp-desktop/v1/extended-options' ) ),
			'currentUserIsAdmin'    => current_user_can( 'manage_options' ),
			'portalUrl'        => esc_url( wpdm_portal_url() ),
			'fromPortal'       => $from_portal,
		)
	);

	wp_localize_script( 'wp-desktop', 'wpDesktopConfig', $config );

	/**
	 * Fires when desktop mode assets are enqueued.
	 *
	 * @since 0.1.0
	 */
	do_action( 'wp_desktop_mode_init' );
}
add_action( 'admin_enqueue_scripts', 'wpdm_enqueue_assets' );

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
function wpdm_render_shell() {
	if ( wpdm_is_chromeless_request() || ! wpdm_is_enabled() || wpdm_is_classic_request() ) {
		return;
	}

	/**
	 * Fires right before the desktop shell markup is rendered.
	 *
	 * @since 0.1.0
	 */
	do_action( 'wp_desktop_shell_before' );

	// Stamp the user's admin color scheme onto the shell root so the
	// variables.css per-scheme selectors kick in before first paint —
	// doing this from JS on init() would show the default palette for a
	// frame before swapping.
	$scheme = sanitize_html_class( get_user_option( 'admin_color' ), 'fresh' );
	?>
	<div id="wp-desktop-shell" class="wp-desktop-shell" data-wp-desktop-scheme="<?php echo esc_attr( $scheme ); ?>" role="application" aria-label="<?php esc_attr_e( 'Desktop shell', 'wp-desktop-mode' ); ?>">
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
			<nav id="wp-desktop-dock" class="wp-desktop-dock" role="toolbar" aria-label="<?php esc_attr_e( 'Admin navigation', 'wp-desktop-mode' ); ?>"></nav>
			<div id="wp-desktop-area" class="wp-desktop-area wp-desktop-area--with-dock">
				<?php
				/*
				 * Widget column — paints above the wallpaper but
				 * beneath windows (z-index 1 vs. windows at 100+).
				 * Hosted INSIDE `.wp-desktop-area` so scrolling the
				 * area (not that we do today) would scroll widgets
				 * with it, and so the dock/taskbar naturally frame
				 * it. Empty on first render — JS (`WidgetLayer`)
				 * populates it on boot.
				 */
				?>
				<aside id="wp-desktop-widgets" class="wp-desktop-widgets" aria-label="<?php esc_attr_e( 'Widgets', 'wp-desktop-mode' ); ?>"></aside>
			</div>
		</div>
		<?php
		/*
		 * Taskbar — bottom-edge horizontal rail for plugin-contributed
		 * top-level menus (`admin.php?page=*` routes). Sibling of the
		 * shell body rather than a child, so the column flex layout
		 * gives body `flex: 1` and the taskbar auto-sized height at
		 * the bottom. JS hides it (`hidden=true`) when no plugins
		 * contributed taskbar items — see `src/desktop.ts`.
		 *
		 * Shares `Dock` class + CSS with the left-edge dock, switched
		 * to horizontal via the `--horizontal` modifier + orientation
		 * argument to the TS constructor. Tooltip anchors flip to
		 * above-tile and the active-window indicator dot flips to the
		 * top of each tile — see dock.css.
		 */
		?>
		<nav id="wp-desktop-taskbar" class="wp-desktop-dock wp-desktop-dock--horizontal" role="toolbar" aria-label="<?php esc_attr_e( 'Plugin navigation', 'wp-desktop-mode' ); ?>"></nav>
	</div>
	<?php
	/**
	 * Fires right after the desktop shell markup has rendered.
	 *
	 * @since 0.1.0
	 */
	do_action( 'wp_desktop_shell_after' );
}
add_action( 'in_admin_header', 'wpdm_render_shell', 5 );

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
function wpdm_chromeless_editor_preferences() {
	if ( ! wpdm_is_chromeless_request() ) {
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
add_action( 'enqueue_block_editor_assets', 'wpdm_chromeless_editor_preferences' );

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
function wpdm_chromeless_bridge_script() {
	if ( ! wpdm_is_chromeless_request() ) {
		return;
	}

	/**
	 * Fires after chromeless content in desktop mode.
	 *
	 * @since 0.1.0
	 *
	 * @param string $hook_suffix The current admin page hook suffix.
	 */
	do_action( 'wp_desktop_chromeless_after', isset( $GLOBALS['hook_suffix'] ) ? $GLOBALS['hook_suffix'] : '' );

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
	// switch). Navigating to edit.php or similar doesn't change the
	// menu so we don't bother sending a payload — the debounce +
	// idempotent replaceItems on the parent side would still make it
	// safe, just wasteful.
	$menu_payload_json = 'null';
	$pagenow           = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';
	if (
		in_array(
			$pagenow,
			array( 'plugins.php', 'plugin-install.php', 'update.php', 'themes.php' ),
			true
		)
	) {
		$encoded = wp_json_encode( wpdm_build_menu_payload() );
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
				here.searchParams.delete( 'wp_desktop_portal' );
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

		var wpdReportNetwork = function ( method, url, status, duration, failed ) {
			try {
				window.parent.postMessage( {
					type: 'wp-desktop-iframe-network',
					method: String( method || 'GET' ).toUpperCase(),
					url: String( url || '' ),
					status: typeof status === 'number' ? status : 0,
					duration: typeof duration === 'number' ? duration : 0,
					failed: !! failed
				}, window.location.origin );
			} catch ( _err ) { /* swallow */ }
		};

		// Wrap fetch. Called AFTER `admin_footer` runs — plugin code
		// using fetch during synchronous page boot (rare in wp-admin)
		// bypasses this, but lazy calls (the common case) are captured.
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
				var promise;
				try {
					promise = wpdOrigFetch.apply( this, arguments );
				} catch ( sync ) {
					wpdReportNetwork( method, url, 0, 0, true );
					throw sync;
				}
				return promise.then(
					function ( res ) {
						var dur = ( ( typeof performance !== 'undefined' && performance.now )
							? performance.now()
							: Date.now() ) - start;
						wpdReportNetwork( method, url, res.status, Math.round( dur ), ! res.ok );
						return res;
					},
					function ( err ) {
						var dur = ( ( typeof performance !== 'undefined' && performance.now )
							? performance.now()
							: Date.now() ) - start;
						wpdReportNetwork( method, url, 0, Math.round( dur ), true );
						throw err;
					}
				);
			};
		}

		// Wrap XHR — admin-ajax runs through jQuery which runs through
		// XHR, so fetch-only instrumentation would miss most of the
		// legacy admin surface. Record method + URL on open; fire on
		// loadend regardless of success / failure.
		if ( typeof XMLHttpRequest !== 'undefined' ) {
			var wpdOrigOpen = XMLHttpRequest.prototype.open;
			var wpdOrigSend = XMLHttpRequest.prototype.send;
			XMLHttpRequest.prototype.open = function ( method, url ) {
				try {
					this.__wpdMethod = method;
					this.__wpdUrl = url;
				} catch ( _err ) { /* frozen instance — skip */ }
				return wpdOrigOpen.apply( this, arguments );
			};
			XMLHttpRequest.prototype.send = function () {
				var xhr = this;
				var start = ( typeof performance !== 'undefined' && performance.now )
					? performance.now()
					: Date.now();
				var fire = function () {
					var dur = ( ( typeof performance !== 'undefined' && performance.now )
						? performance.now()
						: Date.now() ) - start;
					wpdReportNetwork(
						xhr.__wpdMethod,
						xhr.__wpdUrl,
						xhr.status,
						Math.round( dur ),
						xhr.status === 0 || xhr.status >= 400
					);
				};
				try {
					xhr.addEventListener( 'loadend', fire );
				} catch ( _err ) { /* swallow */ }
				return wpdOrigSend.apply( this, arguments );
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
	 * The shell's dock + taskbar are built from `$menu` at page-load
	 * time and then frozen — the iframe reload that follows plugin
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
	 * Cmd+K / Ctrl+K forwarder — double-press to escalate.
	 *
	 * Native keydown events don't cross iframe boundaries, so without
	 * this shim the parent shell's Cmd+K handler never fires while
	 * focus lives inside a chromeless iframe. We don't want to
	 * override in-page command palettes (Gutenberg's block insert,
	 * TinyMCE's quick menus, plugin launchers) — users installed those
	 * for a reason. Behaviour we want instead:
	 *
	 *   1st press → let the in-page handler run. Nothing interrupts.
	 *   2nd press (within DOUBLE_WINDOW ms) → escalate: preventDefault,
	 *   stopImmediatePropagation, and postMessage the parent to advance
	 *   the shell palette cycle. The in-page palette that opened on
	 *   the first press is already visible; our cycle treats that as
	 *   the "current" slot and rotates to the next.
	 *
	 * Plain admin pages without their own Cmd+K handler still need two
	 * presses to reach our palette — minor trade-off, offset by the
	 * "Ask AI ⌘K" admin-bar button which is always a one-click path.
	 *
	 * Shift/Alt modifiers are NEVER intercepted so user shortcuts using
	 * those combos keep working.
	 */
	( function () {
		var DOUBLE_WINDOW = 600; // ms
		var lastPress = 0;

		document.addEventListener( 'keydown', function ( e ) {
			if ( ! ( e.metaKey || e.ctrlKey ) ) return;
			if ( e.key !== 'k' && e.key !== 'K' ) return;
			if ( e.shiftKey || e.altKey ) return;

			var now = Date.now();
			var isDouble = ( now - lastPress ) < DOUBLE_WINDOW;
			lastPress = now;

			if ( ! isDouble ) {
				// First press — leave the event alone so the iframe's
				// own Cmd+K handler (Gutenberg, TinyMCE, plugin) can
				// react natively.
				return;
			}

			// Second press within the window — escalate.
			e.preventDefault();
			e.stopImmediatePropagation();
			// Reset so a third press restarts the "first" cycle rather
			// than triggering another instant escalation.
			lastPress = 0;

			// Dismiss whatever in-page palette the FIRST press opened.
			// Gutenberg's command palette, TinyMCE menus, and most WP
			// `@wordpress/components` modals all close on Escape — so
			// we synthesise one. We fire it twice:
			//
			//   (a) Immediately — handles the common case where the
			//       first press's palette already rendered.
			//
			//   (b) On the next animation frame — handles the fast
			//       double-press race where the first palette hadn't
			//       painted yet when the second press arrived. By the
			//       next frame it has, and Escape dismisses it.
			//
			// If the in-page UI doesn't listen for Escape there's no
			// harm — the synthetic event dispatches into a document
			// that ignores it. Worst case the two palettes briefly
			// overlap; they won't both capture the keyboard because
			// focus has already followed the escalation to the parent.
			function closeInPagePalette() {
				try {
					var ev = new KeyboardEvent( 'keydown', {
						key:        'Escape',
						code:       'Escape',
						keyCode:    27,
						which:      27,
						bubbles:    true,
						cancelable: true
					} );
					document.dispatchEvent( ev );
					// Matching keyup — some handlers bind to keyup, not
					// keydown, so fire both for safety.
					var up = new KeyboardEvent( 'keyup', {
						key:        'Escape',
						code:       'Escape',
						keyCode:    27,
						which:      27,
						bubbles:    true,
						cancelable: true
					} );
					document.dispatchEvent( up );
				} catch ( err ) { /* swallow */ }
			}
			closeInPagePalette();
			if ( typeof requestAnimationFrame === 'function' ) {
				requestAnimationFrame( closeInPagePalette );
			}

			try {
				window.parent.postMessage(
					{ type: 'wp-desktop-palette-cycle' },
					window.location.origin
				);
			} catch ( err ) { /* cross-origin parent; swallow */ }
		}, true );
	} )();

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

		var el = document.activeElement;
		if ( el ) {
			var tag = el.tagName;
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
add_action( 'admin_footer', 'wpdm_chromeless_bridge_script' );

/**
 * Outputs a same-origin admin link/form rewriter for detached ("classic
 * override") tabs.
 *
 * Without this, the first navigation after a detach drops the
 * `wp_desktop_classic=1` flag and the next page falls back to the
 * desktop shell — because the user meta is still `'1'` and the
 * `admin_init` portal redirect kicks in. The JS here re-stamps the flag
 * on every same-origin `/wp-admin/` `<a href>` and `<form action>` so
 * navigations within the tab stay classic. Server-side redirects are
 * covered by {@see wpdm_classic_preserve_redirect}.
 *
 * Narrowly scoped: only runs when the current request itself carries
 * the classic flag. Skips modifier-clicks (cmd/ctrl/shift/alt), targets
 * other than `_self`, downloads, anchors, and non-http schemes so we
 * don't break "open in new tab" or mailto links.
 *
 * @since 0.4.0
 */
function wpdm_classic_link_interceptor() {
	if ( ! wpdm_is_classic_request() ) {
		return;
	}

	$flag_literal = wp_json_encode( WPDM_CLASSIC_FLAG );

	$js = <<<JS
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
JS;

	wp_print_inline_script_tag( $js );
}
add_action( 'admin_footer', 'wpdm_classic_link_interceptor' );
