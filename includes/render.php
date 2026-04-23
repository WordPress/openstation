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
	var __wpdCommandsUnsub        = null;
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
		console.log( '[wpd-cmd:iframe] finalize: kept %d, skipped %o', out.length, skipped );
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

	function __wpdMountReactHarvester() {
		if ( __wpdReactMounted ) return;
		if ( ! window.wp || ! window.wp.element || ! window.wp.data ) {
			console.log( '[wpd-cmd:iframe] react-harvester: wp.element/wp.data missing' );
			return;
		}
		var el        = window.wp.element;
		var createEl  = el.createElement;
		var useEffect = el.useEffect;
		var useRef    = el.useRef;
		var useMemo   = el.useMemo;
		var useSelect = ( window.wp.data && window.wp.data.useSelect ) || null;
		if ( ! createEl || ! useSelect || ! el.createRoot || ! useRef ) {
			console.log( '[wpd-cmd:iframe] react-harvester: wp.element API incomplete' );
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
			console.log( '[wpd-cmd:iframe] react-harvester: merged %d (tier3-buckets=%d, tier2-static=%d)',
				merged.length,
				loadersList.length,
				Array.isArray( resultsBucket.statics ) ? resultsBucket.statics.length : 0
			);
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
			} catch ( err ) {
				if ( ! loader.__wpdLoggedThrow ) {
					loader.__wpdLoggedThrow = true;
					console.log( '[wpd-cmd:iframe] react-harvester: loader "%s" threw', loader.name, err );
				}
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
			root.render( createEl( Harvester ) );
			console.log( '[wpd-cmd:iframe] react-harvester: mounted' );
		} catch ( err ) {
			__wpdReactMounted = false;
			console.log( '[wpd-cmd:iframe] react-harvester: mount threw', err );
		}
	}

	function __wpdPostCommandsList() {
		var list = __wpdHarvestCommands();
		// Cheap de-dupe — the store fires on every unrelated preference
		// change too, and shipping an identical payload is pure noise.
		var key = '';
		try { key = JSON.stringify( list ); } catch ( _err ) { key = String( list.length ); }
		if ( key === __wpdCommandsLastPayload ) {
			console.log( '[wpd-cmd:iframe] post: skipping duplicate payload (%d cmds)', list.length );
			return;
		}
		__wpdCommandsLastPayload = key;
		console.log( '[wpd-cmd:iframe] post: sending %d commands to parent', list.length, list );
		try {
			window.parent.postMessage(
				{ type: 'wp-desktop-commands-list', commands: list },
				__wpdCommandsOrigin
			);
		} catch ( err ) {
			console.log( '[wpd-cmd:iframe] post: postMessage threw', err );
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
		console.log( '[wpd-cmd:iframe] subscribe requested (already=%s, mounted=%s, url=%s)', __wpdCommandsSubscribed, __wpdReactMounted, window.location.href );
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
			console.log( '[wpd-cmd:iframe] subscribe: harvester already mounted, re-shipping bucket (%d cmds)', __wpdLastRawCommands.length );
			__wpdSchedulePost();
			return;
		}

		var attempts = 0;
		function tryBind() {
			if ( ! __wpdCommandsSubscribed ) return;
			if ( ! window.wp || ! window.wp.data || typeof window.wp.data.subscribe !== 'function' ) {
				if ( attempts++ < 40 ) {
					if ( attempts === 1 || attempts % 5 === 0 ) {
						console.log( '[wpd-cmd:iframe] subscribe: wp.data not ready yet (attempt %d)', attempts );
					}
					window.setTimeout( tryBind, 150 );
				} else {
					console.log( '[wpd-cmd:iframe] subscribe: gave up waiting for wp.data after %d attempts', attempts );
				}
				return;
			}
			console.log( '[wpd-cmd:iframe] subscribe: wp.data ready, binding (attempts=%d)', attempts );
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
		__wpdCommandsSubscribed = false;
		if ( __wpdCommandsUnsub ) {
			try { __wpdCommandsUnsub(); } catch ( _err ) { /* swallow */ }
			__wpdCommandsUnsub = null;
		}
		__wpdCommandsLastPayload = '';
	}

	function __wpdInvokeCommand( name ) {
		console.log( '[wpd-cmd:iframe] invoke: looking up "%s"', name );
		// Primary lookup — the React harvester's latest snapshot. This
		// covers loader-returned commands (Duplicate block, Transform
		// to, pattern commands) that never appear in the static
		// `getCommands()` list.
		var cb = __wpdCommandCallbacks[ name ];
		if ( typeof cb === 'function' ) {
			console.log( '[wpd-cmd:iframe] invoke: hit harvester cache for "%s"', name );
			try {
				cb( { close: function () {} } );
			} catch ( err ) {
				console.log( '[wpd-cmd:iframe] invoke: "%s" callback threw', name, err );
			}
			return;
		}
		// Fallback — statically registered commands that never passed
		// through the harvester (registered after the last render).
		if ( ! window.wp || ! window.wp.data ) {
			console.log( '[wpd-cmd:iframe] invoke: "%s" not found and wp.data missing', name );
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
				console.log( '[wpd-cmd:iframe] invoke: hit getCommands fallback for "%s"', name );
				try {
					raw[ i ].callback( { close: function () {} } );
				} catch ( err ) {
					console.log( '[wpd-cmd:iframe] invoke: "%s" fallback callback threw', name, err );
				}
				return;
			}
		}
		console.log( '[wpd-cmd:iframe] invoke: "%s" NOT FOUND in harvester cache or getCommands()', name );
	}

	// Attach the listener BEFORE the bridge-ready ping so a subscribe
	// posted synchronously in response is guaranteed to land.
	window.addEventListener( 'message', function ( e ) {
		if ( e.origin !== __wpdCommandsOrigin ) return;
		if ( ! e.data || typeof e.data.type !== 'string' ) return;
		if ( e.data.type === 'wp-desktop-commands-subscribe' ) {
			__wpdSubscribeCommands();
		} else if ( e.data.type === 'wp-desktop-commands-unsubscribe' ) {
			console.log( '[wpd-cmd:iframe] unsubscribe received' );
			__wpdUnsubscribeCommands();
		} else if ( e.data.type === 'wp-desktop-commands-invoke' && typeof e.data.name === 'string' ) {
			console.log( '[wpd-cmd:iframe] invoke received: %s', e.data.name );
			__wpdInvokeCommand( e.data.name );
		}
	} );

	console.log( '[wpd-cmd:iframe] bridge ready, listening for subscribe (url=%s)', window.location.href );
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
		console.log( '[wpd-cmd:iframe] bridge-ready signal sent to parent' );
	} catch ( err ) {
		console.log( '[wpd-cmd:iframe] bridge-ready postMessage threw', err );
	}

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
