<?php
/**
 * OpenStation admin-bar toggle.
 *
 * Adds the "Switch to OpenStation" button to the admin bar's top-right
 * area and wires its click handler to the save-openstation AJAX endpoint.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Adds the OpenStation toggle to the admin bar.
 *
 * Allows users to switch between classic admin and OpenStation,
 * which renders admin screens in draggable, resizable windows.
 *
 * @param WP_Admin_Bar $wp_admin_bar The WP_Admin_Bar instance.
 */
function openstation_admin_bar_toggle( $wp_admin_bar ) {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return;
	}

	// "Active" means "the user is *currently viewing* OpenStation",
	// not "the preference is enabled in user meta." These diverge on
	// requests carrying the per-request classic override
	// (`?desktop_mode_classic=1`) — the user's meta may be '1' but the
	// page they're looking at right now is classic admin. If we went
	// by meta alone, the toggle here would read "Switch to Classic
	// Admin" on a page that's already classic, and the user's first
	// click would disable OpenStation entirely (redirecting to
	// classic admin) instead of taking them back into the shell.
	// The second click would then re-enable it — a two-click trap.
	$is_active = openstation_is_enabled() && ! openstation_is_classic_request();
	$label     = $is_active
		? __( 'Switch to Classic Admin', 'desktop-mode' )
		: __( 'Switch to OpenStation', 'desktop-mode' );

	$wp_admin_bar->add_node(
		array(
			'parent' => 'top-secondary',
			'id'     => 'os-toggle',
			'title'  => '<span class="ab-icon dashicons dashicons-desktop" aria-hidden="true"></span>'
				. '<span class="ab-label">' . $label . '</span>',
			'href'   => '#',
			'meta'   => array(
				'class'    => $is_active ? 'os-active' : '',
				'tabindex' => 0,
				'title'    => $label,
			),
		)
	);

	// Fullscreen toggle — sits next to "Switch to Classic Admin" so the
	// shell can occupy the whole screen without browser chrome. Only
	// makes sense in OpenStation; kept out of classic where it would
	// just be a redundant browser-fullscreen shortcut.
	if ( $is_active ) {
		$wp_admin_bar->add_node(
			array(
				'parent' => 'top-secondary',
				'id'     => 'desktop-fullscreen',
				'title'  => '<span class="ab-icon dashicons dashicons-fullscreen-alt" aria-hidden="true"></span>',
				'href'   => '#',
				'meta'   => array(
					'class'    => 'desktop-fullscreen-btn',
					'title'    => __( 'Enter fullscreen', 'desktop-mode' ),
					'tabindex' => 0,
				),
			)
		);
	}

	// Layout menu — only surfaced when the user is actually viewing
	// the desktop shell (the actions don't make sense in classic
	// admin, which has no windows to arrange). Parent renders as a
	// dashicon with a hover-opened submenu; each child is routed to
	// `wp.os.windowManager.*` by the inline JS.
	//
	// Sits next to Fullscreen so the two shell-state actions group
	// visually. Ask AI, then the help/meta cluster (Keyboard shortcuts
	// + Report a bug) follow, with the help/meta pair anchored to the
	// far right of the secondary bar next to the user identity menu.
	if ( $is_active ) {
		$wp_admin_bar->add_node(
			array(
				'parent' => 'top-secondary',
				'id'     => 'desktop-layout-menu',
				'title'  => '<span class="ab-icon dashicons dashicons-grid-view" aria-hidden="true"></span>',
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
					'class' => 'os-layout-action',
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
					'class' => 'os-layout-action',
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
				'title'  => '<span class="os-layout-checkbox" aria-hidden="true">☐</span> '
					. esc_html__( 'Snap to grid', 'desktop-mode' ),
				'href'   => '#',
				'meta'   => array(
					'class' => 'os-layout-snap',
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
					'class' => 'os-layout-action',
					'title' => __( 'Pack every window into an evenly tiled grid that fills the desktop.', 'desktop-mode' ),
				),
			)
		);

		/**
		 * Filter the list of custom arrange-menu items contributed by
		 * plugins. Each entry becomes an additional node under the
		 * "Arrange" submenu, rendered with the same styling as the
		 * built-in Cascade / Overview / Tile items. Clicking a custom
		 * item dispatches the JS action `os.arrange.custom-action`
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
		 * @param array $items Existing custom items (default empty).
		 */
		$custom = apply_filters( 'openstation_arrange_menu_items', array() );
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
							'class' => 'os-layout-action os-layout-custom',
							'title' => $item['description'],
						),
					)
				);
			}
		}
	}

	// "Keyboard shortcuts" trigger — shown only when OpenStation is
	// active. Clicking toggles the keyboard-shortcuts popover wired by
	// assets/js/admin-bar.js (wireShortcutsPopover); the popover content
	// is translated server-side and shipped via the `shortcuts` key of
	// the openStationAdminBar config blob below.
	if ( $is_active ) {
		$wp_admin_bar->add_node(
			array(
				'parent' => 'top-secondary',
				'id'     => 'desktop-help',
				'title'  => '<span class="ab-icon os-keyboard-icon" aria-hidden="true"></span>',
				'href'   => '#',
				'meta'   => array(
					'class'    => 'desktop-help-btn',
					'title'    => __( 'Keyboard shortcuts', 'desktop-mode' ),
					'tabindex' => 0,
				),
			)
		);
	}

	// "Report a bug" trigger — shown only when OpenStation is active.
	// Clicking dispatches a `os-open-bug-report` document
	// CustomEvent that the shell listens for and answers by opening the
	// Bug Report native window. PHP doesn't know the JS side exists; the
	// event lets us add the button without coupling to any specific
	// shell module. Anchored to the far right of the secondary bar so
	// the meta/help cluster (Keyboard shortcuts + Report a bug) sits
	// next to the user identity menu — matches the convention used by
	// most SaaS products (Help / "?" at the user-menu corner).
	if ( $is_active ) {
		$wp_admin_bar->add_node(
			array(
				'parent' => 'top-secondary',
				'id'     => 'desktop-bug-report',
				'title'  => '<span class="ab-icon dashicons dashicons-buddicons-replies" aria-hidden="true"></span>',
				'href'   => '#',
				'meta'   => array(
					'class'    => 'desktop-bug-report-btn',
					'title'    => __( 'Open the Bug Report window', 'desktop-mode' ),
					'tabindex' => 0,
				),
			)
		);
	}
}
add_action( 'admin_bar_menu', 'openstation_admin_bar_toggle', 190 );

/**
 * Enqueues the CSS and JS for the OpenStation toggle.
 *
 * The CSS is inline, attached to the `admin-bar` style handle so it always
 * ships with the admin bar itself — no matter which admin screen is showing.
 * The JS is the external assets/js/admin-bar.js bundle, registered as
 * `os-admin-bar` with `admin-bar` as a dependency; its config is
 * emitted as an inline JSON literal `before` the script.
 */
function openstation_enqueue_toggle_assets() {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return;
	}

	// Inside a chromeless window the admin bar is suppressed outright
	// (`show_admin_bar` + the `wp_admin_bar_render` removal in
	// helpers.php), so `#wpadminbar` never reaches the DOM. Every byte
	// below — the toggle bundle, its inline config, the node styling —
	// would load and run against markup that does not exist. Measured
	// on a live install: the toggle bundle alone was 17.7 KB, the
	// largest single asset in the admin-bar family a window loaded for
	// nothing. See `includes/render/chromeless-trim.php`, which drops
	// the rest of that family (core's `admin-bar`, host masterbar
	// extras) for the same reason.
	if ( openstation_is_chromeless_request() ) {
		return;
	}

	$css = '
		#wpadminbar #wp-admin-bar-os-toggle > .ab-item,
		#wpadminbar #wp-admin-bar-desktop-layout-menu > .ab-item,
		#wpadminbar #wp-admin-bar-desktop-fullscreen > .ab-item,
		#wpadminbar #wp-admin-bar-desktop-bug-report > .ab-item,
		#wpadminbar #wp-admin-bar-desktop-help > .ab-item {
			display: inline-flex;
			align-items: center;
			gap: 6px;
		}
		#wpadminbar #wp-admin-bar-os-toggle .ab-icon,
		#wpadminbar #wp-admin-bar-desktop-layout-menu .ab-icon,
		#wpadminbar #wp-admin-bar-desktop-fullscreen .ab-icon,
		#wpadminbar #wp-admin-bar-desktop-bug-report .ab-icon,
		#wpadminbar #wp-admin-bar-desktop-help .ab-icon {
			float: none;
			margin: 0;
			padding: 0;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 20px;
			height: 20px;
		}

		#wp-admin-bar-os-toggle .ab-icon.dashicons,
		#wp-admin-bar-desktop-layout-menu .ab-icon.dashicons {
			font: normal 20px/1 dashicons;
			-webkit-font-smoothing: antialiased;
			-moz-osx-font-smoothing: grayscale;
		}
		#wp-admin-bar-os-toggle .ab-icon.dashicons::before {
			content: "\f472";
			top: 0;
			position: static;
		}
		#wp-admin-bar-desktop-layout-menu .ab-icon.dashicons::before {
			/* dashicons-grid-view */
			content: "\f509";
			top: 0;
			position: static;
		}
		#wp-admin-bar-os-toggle.os-active .ab-icon.dashicons::before {
			/* Inherit the admin-bar text color so the active state
			   matches the +New, Home, Comments dashicons. Previously
			   hardcoded #72aee6, which forced blue regardless of the
			   profile color scheme. */
			color: inherit;
		}
		@media screen and (max-width: 782px) {
			#wp-admin-bar-os-toggle .ab-label {
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
			top: 0;
			position: static;
		}
		#wp-admin-bar-desktop-fullscreen.is-fullscreen .ab-icon.dashicons::before {
			/* dashicons-fullscreen-exit-alt */
			content: "\f212";
		}
		/* Defuse the implicit-drag-on-anchor click eater. WP renders
		   admin-bar items as <a href="#">, which is implicitly
		   draggable; tiny pointer jitter on click commits to a native
		   link-drag (the floating "Exit fullscreen / http://…#" ghost
		   the user sees) and the click handler never runs. admin-bar.js
		   also sets draggable="false" on the <a>; user-drag: none here
		   covers the WebKit path where the attribute alone is not
		   honoured reliably. */
		#wp-admin-bar-desktop-fullscreen .ab-item,
		#wp-admin-bar-desktop-fullscreen .ab-item * {
			-webkit-user-drag: none;
			user-drag: none;
			-webkit-user-select: none;
			user-select: none;
		}
		/* Hide admin-bar items that sit closest to the right corner
		   while in browser fullscreen. The corner is a reveal hot zone
		   the OS / browser reserve for menu-bar / window-controls,
		   where pointer events get intercepted before reaching the
		   page. Hiding these two shifts the Fullscreen toggle further
		   from the corner so its own click lands. Toggled by a body
		   class admin-bar.js sets on `fullscreenchange`. */
		body.os-browser-fs #wp-admin-bar-os-toggle,
		body.os-browser-fs #wp-admin-bar-desktop-bug-report {
			display: none;
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
			/* dashicons-buddicons-replies — same glyph as the dock tile so
			   the two surfaces (admin-bar + dock) match. */
			content: "\f451";
			top: 0;
			position: static;
		}

		/* Keyboard shortcuts admin-bar button. Dashicons has no keyboard
		   glyph, so we paint a small inline SVG via CSS `mask` with
		   `background-color: currentColor` — that way the icon inherits
		   the admin-bar text color across every WP profile scheme
		   without us hardcoding a fill. */
		#wp-admin-bar-desktop-help .ab-icon.os-keyboard-icon {
			background-color: currentColor;
			-webkit-mask: url( "data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'black\' stroke-width=\'1.6\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><rect x=\'2.5\' y=\'6\' width=\'19\' height=\'12\' rx=\'2.2\'/><path d=\'M6 10h0M10 10h0M14 10h0M18 10h0M6 14h0M10 14h4M18 14h0\'/></svg>" ) no-repeat center / 20px 20px;
			        mask: url( "data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'black\' stroke-width=\'1.6\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><rect x=\'2.5\' y=\'6\' width=\'19\' height=\'12\' rx=\'2.2\'/><path d=\'M6 10h0M10 10h0M14 10h0M18 10h0M6 14h0M10 14h4M18 14h0\'/></svg>" ) no-repeat center / 20px 20px;
		}

		/* Keyboard-shortcuts floating popover — anchored under the
		   keyboard button. Styled to match the Arrange submenu (light
		   bg on the otherwise-dark admin bar, soft shadow, rounded
		   corners). Built dynamically in admin-bar.js from translated
		   content shipped via `openStationAdminBar.shortcuts`. */
		#wpadminbar #wp-admin-bar-desktop-help {
			position: relative;
		}
		#wpadminbar .os-shortcuts-popover {
			display: none;
			position: absolute;
			top: 100%;
			right: 0;
			margin-top: 0;
			padding: 12px 14px;
			min-width: 460px;
			max-width: min( 90vw, 720px );
			background: var( --os-ui-surface, var( --os-window-bg, #fff ) );
			color: var( --os-ui-fg, #1d2327 );
			border: 1px solid var( --os-ui-border, var( --os-window-border, #c3c4c7 ) );
			border-radius: 8px;
			box-shadow: 0 8px 24px rgba( 0, 0, 0, 0.18 ),
				0 2px 6px rgba( 0, 0, 0, 0.08 );
			z-index: 99999;
			font-size: 12px;
			line-height: 1.4;
			text-align: left;
		}
		#wpadminbar .os-shortcuts-popover.is-open {
			display: block;
		}
		#wpadminbar .os-shortcuts-popover__section + .os-shortcuts-popover__section {
			margin-top: 12px;
		}
		#wpadminbar .os-shortcuts-popover__heading {
			margin: 0 0 6px;
			padding: 0;
			font-size: 11px;
			font-weight: 600;
			letter-spacing: 0.04em;
			text-transform: uppercase;
			color: var( --os-ui-fg-muted, #50575e );
			line-height: 1.2;
		}
		#wpadminbar .os-shortcuts-popover__table {
			width: 100%;
			border-collapse: collapse;
			color: inherit;
		}
		#wpadminbar .os-shortcuts-popover__table th,
		#wpadminbar .os-shortcuts-popover__table td {
			padding: 6px 8px;
			vertical-align: middle;
			text-align: left;
			border-bottom: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.06 ) );
			color: inherit;
			font-weight: 400;
			font-size: 12px;
			line-height: 1.4;
		}
		#wpadminbar .os-shortcuts-popover__table th {
			font-weight: 600;
			font-size: 11px;
			color: var( --os-ui-fg-muted, #50575e );
			letter-spacing: 0.02em;
		}
		#wpadminbar .os-shortcuts-popover__table tbody tr:last-child td {
			border-bottom: none;
		}
		#wpadminbar .os-shortcuts-popover__key-cell {
			white-space: nowrap;
		}
		#wpadminbar .os-shortcuts-popover__note {
			color: var( --os-ui-fg-muted, #50575e );
			font-size: 11px;
		}
		#wpadminbar .os-shortcuts-popover__list {
			margin: 0;
			padding: 0;
			list-style: none;
			display: flex;
			flex-direction: column;
			gap: 4px;
		}
		#wpadminbar .os-shortcuts-popover__item {
			display: grid;
			grid-template-columns: 120px 1fr;
			align-items: center;
			gap: 12px;
			padding: 4px 8px;
			border-radius: 4px;
			background: var( --os-ui-surface-sunken, rgba( 0, 0, 0, 0.03 ) );
		}
		#wpadminbar .os-shortcuts-popover__keys {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			flex-wrap: wrap;
		}
		#wpadminbar .os-shortcuts-popover__kbd {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: 22px;
			height: 20px;
			padding: 0 5px;
			border: 1px solid var( --os-ui-border-strong, rgba( 0, 0, 0, 0.18 ) );
			border-bottom-width: 2px;
			border-radius: 4px;
			background: var( --os-ui-surface-elevated, #fff );
			color: var( --os-ui-fg, #1d2327 );
			font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
			font-size: 11px;
			font-weight: 600;
			line-height: 1;
			white-space: nowrap;
		}
		#wpadminbar .os-shortcuts-popover__plus {
			font-size: 10px;
			color: var( --os-ui-fg-muted, #50575e );
		}
		#wpadminbar .os-shortcuts-popover__description {
			color: inherit;
		}

		/* Dock-style custom tooltip for icon-only admin-bar buttons.
		   admin-bar.js moves the native `title` to `data-desktop-tooltip`
		   so the OS delayed tooltip never competes with this one. Floats
		   below the button, dark pill with white text — visually
		   identical to the dock tooltip pattern. */
		#wpadminbar .ab-item[ data-desktop-tooltip ] {
			position: relative;
		}
		#wpadminbar .ab-item[ data-desktop-tooltip ]::after {
			content: attr( data-desktop-tooltip );
			position: absolute;
			top: 100%;
			left: 50%;
			margin-top: 4px;
			transform: translateX( -50% ) translateY( 4px );
			padding: 6px 12px;
			background: rgba( 0, 0, 0, 0.85 );
			color: #fff;
			font-size: 12px;
			font-weight: 400;
			line-height: 1.4;
			white-space: nowrap;
			border-radius: 6px;
			pointer-events: none;
			opacity: 0;
			transition: opacity 0.15s ease, transform 0.15s ease;
			z-index: 100000;
		}
		#wpadminbar .ab-item[ data-desktop-tooltip ]:hover::after,
		#wpadminbar .ab-item[ data-desktop-tooltip ]:focus-visible::after {
			opacity: 1;
			transform: translateX( -50% ) translateY( 0 );
		}
		/* When the keyboard-shortcuts popover is open, suppress the
		   tooltip on its own anchor so the two never stack on top of
		   each other. */
		#wpadminbar #wp-admin-bar-desktop-help.is-open .ab-item[ data-desktop-tooltip ]::after {
			opacity: 0;
		}

		/* Arrange submenu — aligned visually with the <os-menu> component
		   (src/ui/components/os-menu/os-menu.styles.ts). The submenu
		   breaks out of the native dark-on-dark admin bar and paints
		   itself from the `--os-ui-*` panel palette instead, so it matches
		   the rest of our UI and stays legible under any desktop theme.

		   Surface and text MUST come from the same palette. They used to
		   not: the background read `--os-window-bg` (which a
		   theme sets) while the text read `--os-text` (which
		   nothing has ever defined, so it always fell back to near-black).
		   Any dark theme therefore rendered near-black text on its own
		   near-black panel. Keep both sides on `--os-ui-surface` /
		   `--os-ui-fg` and that class of bug cannot come back.

		   Selectors prefixed with #wpadminbar to win the admin-bar
		   specificity without !important. */
		#wpadminbar #wp-admin-bar-desktop-layout-menu .ab-sub-wrapper {
			background: var( --os-ui-surface, var( --os-window-bg, #fff ) );
			padding: 4px;
			min-width: 220px;
			border: 1px solid var( --os-ui-border, var( --os-window-border, #c3c4c7 ) );
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
			color: var( --os-ui-fg, #1d2327 );
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
			background: var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) );
			color: var( --os-ui-fg, #000 );
		}
		#wp-admin-bar-desktop-layout-snap .os-layout-checkbox {
			flex-shrink: 0;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 16px;
			height: 16px;
			font-size: 14px;
			line-height: 1;
		}
		#wp-admin-bar-desktop-layout-snap[aria-checked="true"] .os-layout-checkbox {
			color: var( --wp-admin-theme-color, #2271b1 );
		}
	';
	wp_add_inline_style( 'admin-bar', $css );

	// All PHP→JS values are emitted as JSON literals (never interpolated
	// raw into the script body) so special characters, quotes, and
	// unexpected shapes can't break the parser or be exploited.
	// `active` must match the visual state shown on the toggle above —
	// i.e. "currently viewing OpenStation." Using `openstation_is_enabled()`
	// alone would misclassify a classic-override request (meta = '1',
	// URL carrying `desktop_mode_classic=1`) as active, causing the
	// click handler to send `enabled=0` when the user actually wants
	// to return to the shell.
	wp_register_script(
		'os-admin-bar',
		OPENSTATION_URL . 'assets/js/admin-bar.js',
		array( 'admin-bar' ),
		OPENSTATION_VERSION,
		true
	);
	// Emit the config as a JSON literal via wp_add_inline_script (not
	// wp_localize_script — the latter casts booleans to '' / '1', which
	// breaks the click handler's `!! cfg.active` check). 'before' runs
	// before admin-bar.js so the global is ready when the IIFE fires.
	wp_add_inline_script(
		'os-admin-bar',
		'var openStationAdminBar = ' . wp_json_encode(
			array(
				'nonce'      => wp_create_nonce( 'save-openstation' ),
				'active'     => openstation_is_enabled() && ! openstation_is_classic_request(),
				'classicUrl' => esc_url_raw( admin_url() ),
				'portalUrl'  => esc_url_raw( openstation_portal_url() ),
				'ajaxUrl'    => esc_url_raw( admin_url( 'admin-ajax.php' ) ),
				'i18n'       => array(
					'enterFullscreen' => __( 'Fullscreen', 'desktop-mode' ),
					'exitFullscreen'  => __( 'Exit fullscreen', 'desktop-mode' ),
					'enterTitle'      => __( 'Enter fullscreen', 'desktop-mode' ),
					'exitTitle'       => __( 'Exit fullscreen', 'desktop-mode' ),
				),

				/*
				 * Keyboard-shortcuts popover content. Translated once on
				 * the server and shipped to admin-bar.js, which renders
				 * the popover anchored under the keyboard button.
				 *
				 * `contextual` is a small table that distinguishes the
				 * three modes the shortcuts operate in (Outside Overview,
				 * Inside Overview, Show Desktop). `general` is a flat
				 * list for shortcuts whose behaviour doesn't shift by
				 * mode.
				 */
				'shortcuts'  => array(
					'title'      => __( 'Keyboard shortcuts', 'desktop-mode' ),
					'contextual' => array(
						'heading' => __( 'Desktops & Overview', 'desktop-mode' ),
						'headers' => array(
							'key'         => __( 'Key', 'desktop-mode' ),
							'outside'     => __( 'Outside overview', 'desktop-mode' ),
							'inside'      => __( 'Inside overview', 'desktop-mode' ),
							'showDesktop' => __( 'In Show Desktop', 'desktop-mode' ),
						),
						'rows'    => array(
							array(
								'keys'        => array( '←' ),
								'outside'     => __( 'Previous desktop (wraps)', 'desktop-mode' ),
								'inside'      => __( 'Previous desktop (grid + top-bar update)', 'desktop-mode' ),
								'showDesktop' => __( 'Previous desktop', 'desktop-mode' ),
							),
							array(
								'keys'        => array( '→' ),
								'outside'     => __( 'Next desktop (wraps)', 'desktop-mode' ),
								'inside'      => __( 'Next desktop (grid + top-bar update)', 'desktop-mode' ),
								'showDesktop' => __( 'Next desktop', 'desktop-mode' ),
							),
							array(
								'keys'        => array( '↑' ),
								'outside'     => __( 'Enter Overview', 'desktop-mode' ),
								'inside'      => __( 'Exit Overview onto active desktop', 'desktop-mode' ),
								'showDesktop' => __( 'Restore windows (exit Show Desktop)', 'desktop-mode' ),
							),
							array(
								'keys'        => array( '↓' ),
								'outside'     => __( 'Toggle Show Desktop', 'desktop-mode' ),
								'inside'      => __( 'Exit Overview (no minimize)', 'desktop-mode' ),
								'showDesktop' => __( 'Toggle Show Desktop', 'desktop-mode' ),
							),
							array(
								'keys'        => array( 'Enter' ),
								'note'        => __( '(in overview)', 'desktop-mode' ),
								'outside'     => '—',
								'inside'      => __( 'Commit current desktop, exit overview', 'desktop-mode' ),
								'showDesktop' => '—',
							),
						),
					),
					'general'    => array(
						'heading' => __( 'Windows & palette', 'desktop-mode' ),
						'items'   => array(
							array(
								'keys'        => array( '`' ),
								'description' => __( 'Cycle to the next window on the active desktop.', 'desktop-mode' ),
							),
							array(
								'keys'        => array( 'Shift', '`' ),
								'description' => __( 'Cycle to the previous window on the active desktop.', 'desktop-mode' ),
							),
							array(
								'keys'        => array( '⌘/Ctrl', 'K' ),
								'description' => __( 'Open the command palette / Ask AI overlay.', 'desktop-mode' ),
							),
							array(
								'keys'        => array( '⌥/Alt', '⌘/Ctrl', 'W' ),
								'description' => __( 'Close every open window on the current desktop (asks first).', 'desktop-mode' ),
							),
							array(
								'keys'        => array( 'Esc' ),
								'description' => __( 'Exit Overview (or Snap Overview) without changing window state.', 'desktop-mode' ),
							),
						),
					),
				),
			)
		) . ';',
		'before'
	);
	wp_enqueue_script( 'os-admin-bar' );
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_toggle_assets' );
