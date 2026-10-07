<?php

defined( 'ABSPATH' ) || exit;

function openstation_wp_icon_collection() {
	return array(
		'window'  => __( 'Window', 'desktop-mode' ),
		'windows' => __( 'All windows', 'desktop-mode' ),
		'dock'    => __( 'Dock', 'desktop-mode' ),
		'spaces'  => __( 'Spaces', 'desktop-mode' ),
		'copilot' => __( 'Copilot', 'desktop-mode' ),
		'snap'    => __( 'Snap layout', 'desktop-mode' ),
		'command' => __( 'Command palette', 'desktop-mode' ),
		'apps'    => __( 'Apps', 'desktop-mode' ),
		'widgets' => __( 'Widgets', 'desktop-mode' ),
		'user'    => __( 'User', 'desktop-mode' ),
		'lock'    => __( 'Lock', 'desktop-mode' ),
	);
}

function openstation_register_wp_icons() {
	if ( ! function_exists( 'wp_register_icon_collection' ) || ! function_exists( 'wp_register_icon' ) ) {
		return;
	}

	if ( class_exists( 'WP_Icon_Collections_Registry' ) ) {
		$collections = WP_Icon_Collections_Registry::get_instance();
		if ( $collections->is_registered( 'openstation' ) ) {
			return;
		}
	}

	if ( ! wp_register_icon_collection(
		'openstation',
		array(
			'label'       => __( 'OpenStation', 'desktop-mode' ),
			'description' => __( 'Icons for the desktop shell: windows, spaces, the dock, and the command palette.', 'desktop-mode' ),
		)
	) ) {
		return;
	}

	foreach ( openstation_wp_icon_collection() as $slug => $label ) {
		wp_register_icon(
			'openstation/' . $slug,
			array(
				'label'     => $label,
				'file_path' => OPENSTATION_DIR . 'assets/icons/' . $slug . '.svg',
			)
		);
	}
}
add_action( 'init', 'openstation_register_wp_icons' );
