<?php

defined( 'ABSPATH' ) || exit;

function openstation_admin_bar_toggle( $wp_admin_bar ) {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return;
	}

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

function openstation_enqueue_toggle_assets() {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return;
	}

	if ( openstation_is_chromeless_request() ) {
		return;
	}

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

	wp_register_script(
		'os-admin-bar',
		OPENSTATION_URL . 'assets/js/admin-bar.js',
		array( 'admin-bar' ),
		OPENSTATION_VERSION,
		true
	);

	wp_add_inline_script(
		'os-admin-bar',
		'var openStationAdminBar = ' . wp_json_encode(
			array(
				'nonce'      => wp_create_nonce( 'save-openstation' ),

				'classicUrl' => esc_url_raw( self_admin_url() ),
				'portalUrl'  => esc_url_raw( openstation_portal_url() ),

				'network'    => is_network_admin(),
				'ajaxUrl'    => esc_url_raw( admin_url( 'admin-ajax.php' ) ),

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
