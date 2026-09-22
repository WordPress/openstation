<?php
/**
 * OpenStation admin-bar toggle.
 *
 * Adds the "Switch to OpenStation" button to the admin bar's top-right
 * area and wires its click handler to the save-openstation AJAX endpoint.
 *
 * The button is the way INTO the shell and only shows in classic admin.
 * Inside the shell the admin bar carries no OpenStation nodes at all:
 * everything the desktop offers is reachable from the dock, and the way
 * back out is the locked "Exit OpenStation" tile.
 *
 * This file also publishes the `openStationAdminBar` config global,
 * which the shell reads for the exit tile's AJAX call
 * (`src/exit-openstation.ts`) and the keyboard-shortcuts window
 * (`src/shortcuts.ts`). It is emitted on every admin screen, with or
 * without the toggle node.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Adds the OpenStation toggle to the admin bar.
 *
 * Only in classic admin. Once the user is viewing the shell the node
 * would be a second way to do what the "Exit OpenStation" dock tile
 * already does, and an admin bar carrying shell controls reads as the
 * shell's own toolbar when it is not one.
 *
 * @param WP_Admin_Bar $wp_admin_bar The WP_Admin_Bar instance.
 */
function openstation_admin_bar_toggle( $wp_admin_bar ) {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return;
	}

	// "Active" means "the user is *currently viewing* OpenStation", not
	// "the preference is enabled in user meta." These diverge on requests
	// carrying the per-request classic override (`?desktop_mode_classic=1`):
	// the user's meta may be '1' but the page they're looking at right now
	// is classic admin, and it needs the way back in.
	if ( openstation_is_enabled() && ! openstation_is_classic_request() ) {
		return;
	}

	$label = __( 'Switch to OpenStation', 'desktop-mode' );

	$wp_admin_bar->add_node(
		array(
			'parent' => 'top-secondary',
			'id'     => 'os-toggle',
			'title'  => '<span class="ab-icon dashicons dashicons-desktop" aria-hidden="true"></span>'
				. '<span class="ab-label">' . $label . '</span>',
			'href'   => '#',
			'meta'   => array(
				'tabindex' => 0,
				'title'    => $label,
			),
		)
	);
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
	// would load and run against markup that does not exist. See
	// `includes/render/chromeless-trim.php`, which drops the rest of
	// that family (core's `admin-bar`, host masterbar extras) for the
	// same reason.
	if ( openstation_is_chromeless_request() ) {
		return;
	}

	// The item is `display: flex`, never `inline-flex`. An
	// inline-level box sits on a line box the <li> lays out at its
	// 32px line-height and aligns on the baseline, so the line grows
	// by the descender: the item became 37px inside a 32px bar. Under
	// Core's float layout that overflow was invisible. On a host that
	// lays the secondary group out as a flex row (WordPress.com's Debug
	// Bar does, to order its own item first) every sibling stretched
	// to the tallest one and the group's background painted 5px into
	// the shell, under the windows' title bars. Block-level, the item
	// is exactly the bar. `Tests_OpenStation_AdminBarDesktopToggle`
	// pins it; `desktop.css` caps the group as well, for items we do
	// not own.
	$css = '
		#wpadminbar #wp-admin-bar-os-toggle > .ab-item {
			display: flex;
			align-items: center;
			gap: 6px;
		}
		#wpadminbar #wp-admin-bar-os-toggle .ab-icon {
			float: none;
			margin: 0;
			padding: 0;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 20px;
			height: 20px;
		}
		#wp-admin-bar-os-toggle .ab-icon.dashicons {
			font: normal 20px/1 dashicons;
			-webkit-font-smoothing: antialiased;
			-moz-osx-font-smoothing: grayscale;
		}
		#wp-admin-bar-os-toggle .ab-icon.dashicons::before {
			content: "\f472";
			top: 0;
			position: static;
		}
		@media screen and (max-width: 782px) {
			/* WP core hides most admin-bar items on mobile. Force the toggle to
			   stay visible so users can switch back to OpenStation/Classic. */
			#wpadminbar #wp-admin-bar-os-toggle {
				display: block;
			}
			#wpadminbar #wp-admin-bar-os-toggle > .ab-item {
				padding: 0 14px;
			}
			#wpadminbar #wp-admin-bar-os-toggle .ab-label {
				display: none;
			}
		}
	';
	wp_add_inline_style( 'admin-bar', $css );

	// All PHP→JS values are emitted as JSON literals (never interpolated
	// raw into the script body) so special characters, quotes, and
	// unexpected shapes can't break the parser or be exploited.
	//
	// The config is emitted on every admin screen, including the ones
	// where the toggle node is absent: the shell reads the same global
	// for the "Exit OpenStation" tile's AJAX call and for the
	// keyboard-shortcuts window.
	wp_register_script(
		'os-admin-bar',
		OPENSTATION_URL . 'assets/js/admin-bar.js',
		array( 'admin-bar' ),
		OPENSTATION_VERSION,
		true
	);
	// Emit the config as a JSON literal via wp_add_inline_script, not
	// wp_localize_script — the latter casts every value to a string,
	// so `network` would arrive as '' / '1'. 'before' runs ahead of
	// admin-bar.js so the global is ready when the IIFE fires.
	wp_add_inline_script(
		'os-admin-bar',
		'var openStationAdminBar = ' . wp_json_encode(
			array(
				'nonce'      => wp_create_nonce( 'save-openstation' ),
				// `self_admin_url()`: switching off from the network
				// admin returns there, not to the main site.
				'classicUrl' => esc_url_raw( self_admin_url() ),
				'portalUrl'  => esc_url_raw( openstation_portal_url() ),
				// Passed back on the enable / disable AJAX call: the
				// handler runs on `admin-ajax.php`, where
				// `is_network_admin()` is always false.
				'network'    => is_network_admin(),
				'ajaxUrl'    => esc_url_raw( admin_url( 'admin-ajax.php' ) ),

				/*
				 * Keyboard-shortcuts reference content. Translated once
				 * on the server and read by `src/shortcuts.ts`, which
				 * renders the Keyboard shortcuts window.
				 *
				 * `contextual` is a small table that distinguishes the
				 * three modes the shortcuts operate in (Outside
				 * Workspaces, Inside Workspaces, Show Desktop).
				 * `general` is a flat list for shortcuts whose
				 * behaviour doesn't shift by mode.
				 */
				'shortcuts'  => array(
					'title'      => __( 'Keyboard shortcuts', 'desktop-mode' ),
					'contextual' => array(
						'heading' => __( 'Workspaces', 'desktop-mode' ),
						'headers' => array(
							'key'         => __( 'Key', 'desktop-mode' ),
							'outside'     => __( 'Outside Workspaces', 'desktop-mode' ),
							'inside'      => __( 'Inside Workspaces', 'desktop-mode' ),
							'showDesktop' => __( 'In Show Desktop', 'desktop-mode' ),
						),
						'rows'    => array(
							array(
								'keys'        => array( '←' ),
								'outside'     => __( 'Previous workspace (wraps)', 'desktop-mode' ),
								'inside'      => __( 'Previous workspace (grid + top-bar update)', 'desktop-mode' ),
								'showDesktop' => __( 'Previous workspace', 'desktop-mode' ),
							),
							array(
								'keys'        => array( '→' ),
								'outside'     => __( 'Next workspace (wraps)', 'desktop-mode' ),
								'inside'      => __( 'Next workspace (grid + top-bar update)', 'desktop-mode' ),
								'showDesktop' => __( 'Next workspace', 'desktop-mode' ),
							),
							array(
								'keys'        => array( '↑' ),
								'outside'     => __( 'Enter Workspaces', 'desktop-mode' ),
								'inside'      => __( 'Exit onto the active workspace', 'desktop-mode' ),
								'showDesktop' => __( 'Restore windows (exit Show Desktop)', 'desktop-mode' ),
							),
							array(
								'keys'        => array( '↓' ),
								'outside'     => __( 'Toggle Show Desktop', 'desktop-mode' ),
								'inside'      => __( 'Exit Workspaces (no minimize)', 'desktop-mode' ),
								'showDesktop' => __( 'Toggle Show Desktop', 'desktop-mode' ),
							),
							array(
								'keys'        => array( 'Enter' ),
								'note'        => __( '(in Workspaces)', 'desktop-mode' ),
								'outside'     => '—',
								'inside'      => __( 'Commit current workspace, exit Workspaces', 'desktop-mode' ),
								'showDesktop' => '—',
							),
						),
					),
					'general'    => array(
						'heading' => __( 'Windows & palette', 'desktop-mode' ),
						'items'   => array(
							array(
								'keys'        => array( '`' ),
								'description' => __( 'Cycle to the next window on the active workspace.', 'desktop-mode' ),
							),
							array(
								'keys'        => array( 'Shift', '`' ),
								'description' => __( 'Cycle to the previous window on the active workspace.', 'desktop-mode' ),
							),
							array(
								'keys'        => array( '⌘/Ctrl', 'K' ),
								'description' => __( 'Open the command palette / Ask AI overlay.', 'desktop-mode' ),
							),
							array(
								'keys'        => array( '⌥/Alt', '⌘/Ctrl', 'W' ),
								'description' => __( 'Close every open window on the current workspace (asks first).', 'desktop-mode' ),
							),
							array(
								'keys'        => array( 'Esc' ),
								'description' => __( 'Exit Workspaces (or Snap Overview) without changing window state.', 'desktop-mode' ),
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
