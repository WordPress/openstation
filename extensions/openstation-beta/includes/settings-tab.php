<?php

defined( 'ABSPATH' ) || exit;

function openstation_beta_register_settings_tab() {
	if ( ! function_exists( 'openstation_register_settings_tab' ) ) {
		return;
	}

	if ( ! current_user_can( 'update_plugins' ) ) {
		return;
	}
	openstation_register_settings_tab(
		array(
			'id'         => 'beta',
			'label'      => __( 'Beta', 'openstation-beta' ),
			'capability' => 'manage_options',
			'order'      => 35,
			'script'     => 'openstation-beta-settings',
		)
	);
}
add_action( 'init', 'openstation_beta_register_settings_tab' );

function openstation_beta_shell_assets() {
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return;
	}
	if ( ! current_user_can( 'update_plugins' ) ) {
		return;
	}

	wp_register_script(
		'openstation-beta-settings',
		OPENSTATION_BETA_URL . 'assets/beta.js',
		array( 'openstation' ),
		OPENSTATION_BETA_VERSION,
		true
	);
	wp_localize_script( 'openstation-beta-settings', 'openStationBetaConfig', openstation_beta_script_config( 'shell' ) );

	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}

	wp_enqueue_script( 'openstation-beta-settings' );
}

add_action( 'admin_enqueue_scripts', 'openstation_beta_shell_assets', 5 );
