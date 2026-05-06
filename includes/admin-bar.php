<?php
/**
 * Desktop Mode admin-bar toggle.
 *
 * Adds the "Switch to Desktop Mode" button to the admin bar's top-right
 * area and wires its click handler to the save-desktop-mode AJAX endpoint.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Adds the desktop mode toggle to the admin bar.
 *
 * Allows users to switch between classic admin and desktop mode,
 * which renders admin screens in draggable, resizable windows.
 *
 * @since 0.1.0
 *
 * @param WP_Admin_Bar $wp_admin_bar The WP_Admin_Bar instance.
 */
function desktop_mode_admin_bar_toggle( $wp_admin_bar ) {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return;
	}

	// Discovery affordance: render the toggle for any user who could
	// actually use desktop mode, regardless of whether their
	// `desktop_mode_mode` user meta is set yet. Without this, a freshly-
	// activated plugin offers no on-screen path into the shell — the
	// only entry point would be the `/desktop-mode/` portal URL, which
	// the user has to already know.
	//
	// Cap + filter mirror the AJAX `save-desktop-mode` endpoint and the
	// `/desktop-mode/` portal: `read` is the minimum cap every admin-
	// visible role carries, and `desktop_mode_mode_enabled` is the
	// documented surface plugins use to gate the feature by role
	// (see docs/examples/gate-by-role.md). A user who fails either gate
	// can't flip the toggle anyway — surfacing it to them would render
	// a button that does nothing.
	//
	// Users who already have desktop mode enabled still see the toggle
	// even if a later filter would gate them out — so they can always
	// switch back to classic admin. Without this carve-out a plugin
	// that flips `desktop_mode_mode_enabled` to false mid-session would
	// trap users in the shell with no UI affordance to leave.
	$user_id  = get_current_user_id();
	$can_use  = desktop_mode_is_enabled()
		|| ( current_user_can( 'read' )
			&& (bool) apply_filters( 'desktop_mode_mode_enabled', true, $user_id ) );
	if ( ! $can_use ) {
		return;
	}

	// "Active" means "the user is *currently viewing* desktop mode",
	// not "the preference is enabled in user meta." These diverge on
	// requests carrying the per-request classic override
	// (`?desktop_mode_classic=1`) — the user's meta may be '1' but the
	// page they're looking at right now is classic admin. If we went
	// by meta alone, the toggle here would read "Switch to Classic
	// Admin" on a page that's already classic, and the user's first
	// click would disable desktop mode entirely (redirecting to
	// classic admin) instead of taking them back into the shell.
	// The second click would then re-enable it — a two-click trap.
	$is_active = desktop_mode_is_enabled() && ! desktop_mode_is_classic_request();
	$label     = $is_active
		? __( 'Switch to Classic Admin', 'desktop-mode' )
		: __( 'Switch to Desktop Mode', 'desktop-mode' );

	$wp_admin_bar->add_node(
		array(
			'parent' => 'top-secondary',
			'id'     => 'desktop-mode-toggle',
			'title'  => '<span class="ab-icon dashicons dashicons-desktop" aria-hidden="true"></span>'
				. '<span class="ab-label">' . $label . '</span>',
			'href'   => '#',
			'meta'   => array(
				'class'    => $is_active ? 'desktop-mode-active' : '',
				'tabindex' => 0,
				'title'    => $label,
			),
		)
	);

	// Fullscreen toggle — sits next to "Switch to Classic Admin" so the
	// shell can occupy the whole screen without browser chrome. Only
	// makes sense in desktop mode; kept out of classic where it would
	// just be a redundant browser-fullscreen shortcut.
	if ( $is_active ) {
		$wp_admin_bar->add_node(
			array(
				'parent' => 'top-secondary',
				'id'     => 'desktop-fullscreen',
				'title'  => '<span class="ab-icon dashicons dashicons-fullscreen-alt" aria-hidden="true"></span>'
					. '<span class="ab-label">' . esc_html__( 'Fullscreen', 'desktop-mode' ) . '</span>',
				'href'   => '#',
				'meta'   => array(
					'class'    => 'desktop-fullscreen-btn',
					'title'    => __( 'Enter fullscreen', 'desktop-mode' ),
					'tabindex' => 0,
				),
			)
		);
	}

	// "Report a bug" trigger — shown only when desktop mode is active.
	// Clicking dispatches a `desktop-mode-open-bug-report` document
	// CustomEvent that the shell listens for and answers by opening the
	// Bug Report native window. PHP doesn't know the JS side exists; the
	// event lets us add the button without coupling to any specific
	// shell module.
	if ( $is_active ) {
		$wp_admin_bar->add_node(
			array(
				'parent' => 'top-secondary',
				'id'     => 'desktop-bug-report',
				'title'  => '<span class="ab-icon dashicons dashicons-buddicons-replies" aria-hidden="true"></span>'
					. '<span class="ab-label">' . esc_html__( 'Report a bug', 'desktop-mode' ) . '</span>',
				'href'   => '#',
				'meta'   => array(
					'class'    => 'desktop-bug-report-btn',
					'title'    => __( 'Open the Bug Report window', 'desktop-mode' ),
					'tabindex' => 0,
				),
			)
		);
	}

	// AI Assistant trigger — shown when desktop mode is active AND the
	// current user has AI features configured. Clicking (or pressing
	// Cmd+K anywhere) opens the spotlight-style AI overlay.
	if ( $is_active && function_exists( 'desktop_mode_ai_is_enabled' ) && desktop_mode_ai_is_enabled( get_current_user_id() ) ) {
		// Use dashicons-admin-comments (speech bubble) — same rendering
		// path as the toggle + arrange buttons, no SVG / HTML parsing
		// issues in the admin-bar context. The ⌘K badge is added via
		// a CSS ::after on the label so it never touches the DOM.
		$wp_admin_bar->add_node(
			array(
				'parent' => 'top-secondary',
				'id'     => 'desktop-ai-assistant',
				'title'  => '<span class="ab-icon dashicons dashicons-admin-comments" aria-hidden="true"></span>'
					. '<span class="ab-label">' . esc_html__( 'Ask AI', 'desktop-mode' ) . '</span>',
				'href'   => '#',
				'meta'   => array(
					'class'    => 'desktop-ai-btn',
					'title'    => __( 'Open AI Assistant (Cmd+K)', 'desktop-mode' ),
					'tabindex' => 0,
				),
			)
		);
	}

	// Layout menu — only surfaced when the user is actually viewing
	// the desktop shell (the actions don't make sense in classic
	// admin, which has no windows to arrange). Parent renders as a
	// dashicon with a hover-opened submenu; each child is routed to
	// `wp.desktop.windowManager.*` by the inline JS.
	if ( $is_active ) {
		$wp_admin_bar->add_node(
			array(
				'parent' => 'top-secondary',
				'id'     => 'desktop-layout-menu',
				'title'  => '<span class="ab-icon dashicons dashicons-grid-view" aria-hidden="true"></span>'
					. '<span class="ab-label">' . esc_html__( 'Arrange', 'desktop-mode' ) . '</span>',
				'href'   => '#',
				'meta'   => array(
					'title'    => __( 'Arrange windows', 'desktop-mode' ),
					'tabindex' => 0,
				),
			)
		);
		$wp_admin_bar->add_node(
			array(
				'parent' => 'desktop-layout-menu',
				'id'     => 'desktop-layout-cascade',
				'title'  => esc_html__( 'Cascade', 'desktop-mode' ),
				'href'   => '#',
				'meta'   => array(
					'class' => 'desktop-mode-layout-action',
					'title' => __( 'Lay all windows out from top-left, offset so every title bar stays visible.', 'desktop-mode' ),
				),
			)
		);
		$wp_admin_bar->add_node(
			array(
				'parent' => 'desktop-layout-menu',
				'id'     => 'desktop-layout-overview',
				'title'  => esc_html__( 'Overview', 'desktop-mode' ),
				'href'   => '#',
				'meta'   => array(
					'class' => 'desktop-mode-layout-action',
					'title' => __( 'Zoom out to see every window at once. Click one to focus it.', 'desktop-mode' ),
				),
			)
		);
		// Snap-to-grid toggle. Renders as a checkbox-style entry that
		// must NOT dismiss the parent menu on click — see the inline
		// JS below for the stop-propagation handling. Initial check
		// state is painted from the persisted preference once the
		// shell has booted.
		$wp_admin_bar->add_node(
			array(
				'parent' => 'desktop-layout-menu',
				'id'     => 'desktop-layout-snap',
				'title'  => '<span class="desktop-mode-layout-checkbox" aria-hidden="true">☐</span> '
					. esc_html__( 'Snap to grid', 'desktop-mode' ),
				'href'   => '#',
				'meta'   => array(
					'class' => 'desktop-mode-layout-snap',
					'title' => __( 'Snap windows to a grid while dragging or resizing.', 'desktop-mode' ),
				),
			)
		);
		$wp_admin_bar->add_node(
			array(
				'parent' => 'desktop-layout-menu',
				'id'     => 'desktop-layout-tile',
				'title'  => esc_html__( 'Tile all windows', 'desktop-mode' ),
				'href'   => '#',
				'meta'   => array(
					'class' => 'desktop-mode-layout-action',
					'title' => __( 'Pack every window into an evenly tiled grid that fills the desktop.', 'desktop-mode' ),
				),
			)
		);

		/**
		 * Filter the list of custom arrange-menu items contributed by
		 * plugins. Each entry becomes an additional node under the
		 * "Arrange" submenu, rendered with the same styling as the
		 * built-in Cascade / Overview / Tile items. Clicking a custom
		 * item dispatches the JS action `desktop-mode.arrange.custom-action`
		 * with payload `{ id }` — plugins subscribe via
		 * `wp.hooks.addAction()` and run their own arrangement logic.
		 *
		 * Each item is an associative array:
		 *
		 *   'id'          string  Unique slug (letters, digits, dashes).
		 *   'title'       string  Menu label (already translated).
		 *   'description' string  Optional tooltip / aria description.
		 *   'position'    int     Optional sort key; lower sorts earlier.
		 *                         Built-ins are effectively at 0-3; use
		 *                         10+ to append.
		 *
		 * Entries with missing/invalid `id` or `title` are dropped.
		 *
		 * @since 0.6.2
		 *
		 * @param array $items Existing custom items (default empty).
		 */
		$custom = apply_filters( 'desktop_mode_arrange_menu_items', array() );
		if ( is_array( $custom ) ) {
			// Stable sort by `position` (default 10 — after built-ins),
			// preserving registration order within a tie.
			$sortable = array();
			foreach ( $custom as $index => $item ) {
				if ( ! is_array( $item ) ) {
					continue;
				}
				$id    = isset( $item['id'] ) ? sanitize_key( (string) $item['id'] ) : '';
				$title = isset( $item['title'] ) ? (string) $item['title'] : '';
				if ( '' === $id || '' === $title ) {
					continue;
				}
				$sortable[] = array(
					'id'          => $id,
					'title'       => $title,
					'description' => isset( $item['description'] ) ? (string) $item['description'] : '',
					'position'    => isset( $item['position'] ) && is_numeric( $item['position'] )
						? (int) $item['position']
						: 10,
					'index'       => $index,
				);
			}
			usort(
				$sortable,
				static function ( $a, $b ) {
					if ( $a['position'] === $b['position'] ) {
						return $a['index'] - $b['index'];
					}
					return $a['position'] - $b['position'];
				}
			);
			foreach ( $sortable as $item ) {
				// The custom id is round-tripped through the DOM id
				// (stripping the `desktop-layout-custom-` prefix in the
				// click handler). Keeps us inside the documented
				// WP_Admin_Bar::add_node meta surface — no non-standard
				// attributes, no custom render callbacks.
				$wp_admin_bar->add_node(
					array(
						'parent' => 'desktop-layout-menu',
						'id'     => 'desktop-layout-custom-' . $item['id'],
						'title'  => esc_html( $item['title'] ),
						'href'   => '#',
						'meta'   => array(
							'class' => 'desktop-mode-layout-action desktop-mode-layout-custom',
							'title' => $item['description'],
						),
					)
				);
			}
		}
	}
}
add_action( 'admin_bar_menu', 'desktop_mode_admin_bar_toggle', 190 );

/**
 * Enqueues the inline CSS and JS for the desktop mode toggle.
 *
 * Uses `admin-bar` as the carrier handle so the inline assets always ship
 * with the admin bar itself — no matter which admin screen is showing.
 *
 * @since 0.1.0
 */
function desktop_mode_enqueue_toggle_assets() {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return;
	}

	// Mirror the gate inside `desktop_mode_admin_bar_toggle()` — no point
	// shipping the CSS + click handler to a user who'd never see the
	// toggle node anyway.
	$user_id = get_current_user_id();
	$can_use = desktop_mode_is_enabled()
		|| ( current_user_can( 'read' )
			&& (bool) apply_filters( 'desktop_mode_mode_enabled', true, $user_id ) );
	if ( ! $can_use ) {
		return;
	}

	$css = '
		#wp-admin-bar-desktop-mode-toggle .ab-icon.dashicons,
		#wp-admin-bar-desktop-layout-menu .ab-icon.dashicons {
			font: normal 20px/1 dashicons;
			-webkit-font-smoothing: antialiased;
			-moz-osx-font-smoothing: grayscale;
		}
		#wp-admin-bar-desktop-mode-toggle .ab-icon.dashicons::before {
			content: "\f472";
			top: 2px;
			position: relative;
		}
		#wp-admin-bar-desktop-layout-menu .ab-icon.dashicons::before {
			/* dashicons-grid-view */
			content: "\f509";
			top: 2px;
			position: relative;
		}
		#wp-admin-bar-desktop-mode-toggle.desktop-mode-active .ab-icon.dashicons::before {
			/* Inherit the admin-bar text color so the active state
			   matches the +New, Home, Comments dashicons. Previously
			   hardcoded #72aee6, which forced blue regardless of the
			   profile color scheme. */
			color: inherit;
		}
		@media screen and (max-width: 782px) {
			#wp-admin-bar-desktop-mode-toggle .ab-label,
			#wp-admin-bar-desktop-layout-menu .ab-label {
				display: none;
			}
		}

		/* AI Assistant admin-bar button — same icon/label pattern as the
		   desktop-mode-toggle; ⌘K badge added via CSS ::after so we keep
		   the title HTML clean and avoid admin-bar sanitisation edge-cases. */
		#wp-admin-bar-desktop-ai-assistant .ab-icon.dashicons,
		#wp-admin-bar-desktop-ai-assistant .ab-icon.dashicons {
			font: normal 20px/1 dashicons;
			-webkit-font-smoothing: antialiased;
			-moz-osx-font-smoothing: grayscale;
		}
		#wp-admin-bar-desktop-ai-assistant .ab-icon.dashicons::before {
			content: "\f101";
			top: 2px;
			position: relative;
			/* See note on desktop-mode-toggle above — inherit so the
			   icon matches the rest of the admin-bar dashicons
			   across all WP profile color schemes. */
			color: inherit;
		}
		/* ⌘K badge rendered purely in CSS to the right of the label.
		   inline-flex + align-items:center centers the glyph inside
		   its own padding box; a 1px upward translate compensates
		   for the optical sag from the admin-bar label baseline. */
		#wpadminbar #wp-admin-bar-desktop-ai-assistant .ab-label::after {
			content: "\2318K";
			display: inline-flex;
			align-items: center;
			justify-content: center;
			margin-inline-start: 5px;
			font-size: 10px;
			line-height: 1;
			padding: 2px 5px;
			background: rgba( 255, 255, 255, 0.1 );
			border: 1px solid rgba( 255, 255, 255, 0.18 );
			border-radius: 3px;
			color: rgba( 255, 255, 255, 0.55 );
			vertical-align: middle;
			font-weight: 400;
			letter-spacing: 0;
			position: relative;
			top: -1px;
		}
		@media screen and (max-width: 782px) {
			#wp-admin-bar-desktop-ai-assistant .ab-label {
				display: none;
			}
		}

		/* Fullscreen admin-bar button — same dashicons rendering pattern
		   as the toggle. Icon swaps between fullscreen-alt (enter) and
		   fullscreen-exit-alt (exit) via the .is-fullscreen class set by
		   admin-bar.js on `fullscreenchange`. */
		#wp-admin-bar-desktop-fullscreen .ab-icon.dashicons {
			font: normal 20px/1 dashicons;
			-webkit-font-smoothing: antialiased;
			-moz-osx-font-smoothing: grayscale;
		}
		#wp-admin-bar-desktop-fullscreen .ab-icon.dashicons::before {
			/* dashicons-fullscreen-alt */
			content: "\f211";
			top: 2px;
			position: relative;
		}
		#wp-admin-bar-desktop-fullscreen.is-fullscreen .ab-icon.dashicons::before {
			/* dashicons-fullscreen-exit-alt */
			content: "\f212";
		}
		@media screen and (max-width: 782px) {
			#wp-admin-bar-desktop-fullscreen .ab-label {
				display: none;
			}
		}

		/* Bug Report admin-bar button — same dashicons rendering pattern
		   as the toggle. dashicons-buddicons-replies is a speech bubble
		   with stylized lines that reads as a comment / report glyph at
		   admin-bar size, while dashicons-bug is too literal and small. */
		#wp-admin-bar-desktop-bug-report .ab-icon.dashicons {
			font: normal 20px/1 dashicons;
			-webkit-font-smoothing: antialiased;
			-moz-osx-font-smoothing: grayscale;
		}
		#wp-admin-bar-desktop-bug-report .ab-icon.dashicons::before {
			/* dashicons-buddicons-replies */
			content: "\f465";
			top: 2px;
			position: relative;
		}
		@media screen and (max-width: 782px) {
			#wp-admin-bar-desktop-bug-report .ab-label {
				display: none;
			}
		}

		/* Arrange submenu — aligned visually with the <wpd-menu> component
		   (src/ui/components/wpd-menu/wpd-menu.styles.ts). The submenu
		   flips from the native dark-on-dark admin bar to a light theme
		   (white bg, dark text) so it matches the rest of our UI AND so
		   the hover state stays legible (a light tint on a dark bg
		   would render as invisible overlap with native admin-bar hover
		   colors). Selectors prefixed with #wpadminbar to win the
		   admin-bar specificity without !important. */
		#wpadminbar #wp-admin-bar-desktop-layout-menu .ab-sub-wrapper {
			background: var( --desktop-mode-window-bg, #fff );
			padding: 4px;
			min-width: 220px;
			border: 1px solid var( --desktop-mode-window-border, #c3c4c7 );
			border-radius: 8px;
			box-shadow: 0 8px 24px rgba( 0, 0, 0, 0.18 ),
				0 2px 6px rgba( 0, 0, 0, 0.08 );
		}
		#wpadminbar #wp-admin-bar-desktop-layout-menu .ab-sub-wrapper .ab-submenu {
			padding: 0;
			background: transparent;
		}
		#wpadminbar #wp-admin-bar-desktop-layout-menu .ab-sub-wrapper .ab-submenu > li {
			background: transparent;
		}
		#wpadminbar #wp-admin-bar-desktop-layout-menu .ab-sub-wrapper .ab-submenu > li > .ab-item {
			display: flex;
			align-items: center;
			gap: 10px;
			height: auto;
			min-height: 32px;
			padding: 6px 10px;
			font-size: 13px;
			line-height: 1.3;
			color: var( --desktop-mode-text, #1d2327 );
			background: transparent;
			border-radius: 6px;
			transition: background-color 0.12s ease, color 0.12s ease;
		}
		/* Hover + keyboard focus share the same tinted background. Text
		   stays dark so it stays legible on the light bg. `focus` wins
		   here instead of the native `.ab-item:focus { color: #72aee6 }`
		   thanks to the extra id in our selector chain. */
		#wpadminbar #wp-admin-bar-desktop-layout-menu .ab-sub-wrapper .ab-submenu > li > .ab-item:hover,
		#wpadminbar #wp-admin-bar-desktop-layout-menu .ab-sub-wrapper .ab-submenu > li > .ab-item:focus,
		#wpadminbar.nojq #wp-admin-bar-desktop-layout-menu .ab-sub-wrapper .ab-submenu > li:hover > .ab-item {
			background: rgba( 0, 0, 0, 0.06 );
			color: #000;
		}
		#wp-admin-bar-desktop-layout-snap .desktop-mode-layout-checkbox {
			flex-shrink: 0;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 16px;
			height: 16px;
			font-size: 14px;
			line-height: 1;
		}
		#wp-admin-bar-desktop-layout-snap[aria-checked="true"] .desktop-mode-layout-checkbox {
			color: var( --wp-admin-theme-color, #2271b1 );
		}
	';
	wp_add_inline_style( 'admin-bar', $css );

	// All PHP→JS values are emitted as JSON literals (never interpolated
	// raw into the script body) so special characters, quotes, and
	// unexpected shapes can't break the parser or be exploited.
	// `active` must match the visual state shown on the toggle above —
	// i.e. "currently viewing desktop mode." Using `desktop_mode_is_enabled()`
	// alone would misclassify a classic-override request (meta = '1',
	// URL carrying `desktop_mode_classic=1`) as active, causing the
	// click handler to send `enabled=0` when the user actually wants
	// to return to the shell.
	wp_register_script(
		'desktop-mode-admin-bar',
		DESKTOP_MODE_URL . 'assets/js/admin-bar.js',
		array( 'admin-bar' ),
		DESKTOP_MODE_VERSION,
		true
	);
	// Emit the config as a JSON literal via wp_add_inline_script (not
	// wp_localize_script — the latter casts booleans to '' / '1', which
	// breaks the click handler's `!! cfg.active` check). 'before' runs
	// before admin-bar.js so the global is ready when the IIFE fires.
	wp_add_inline_script(
		'desktop-mode-admin-bar',
		'var desktopModeAdminBar = ' . wp_json_encode(
			array(
				'nonce'      => wp_create_nonce( 'save-desktop-mode' ),
				'active'     => desktop_mode_is_enabled() && ! desktop_mode_is_classic_request(),
				'classicUrl' => esc_url_raw( admin_url() ),
				'portalUrl'  => esc_url_raw( desktop_mode_portal_url() ),
				'ajaxUrl'    => esc_url_raw( admin_url( 'admin-ajax.php' ) ),
				'i18n'       => array(
					'enterFullscreen' => __( 'Fullscreen', 'desktop-mode' ),
					'exitFullscreen'  => __( 'Exit fullscreen', 'desktop-mode' ),
					'enterTitle'      => __( 'Enter fullscreen', 'desktop-mode' ),
					'exitTitle'       => __( 'Exit fullscreen', 'desktop-mode' ),
				),
			)
		) . ';',
		'before'
	);
	wp_enqueue_script( 'desktop-mode-admin-bar' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_toggle_assets' );

