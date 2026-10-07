<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_USER_PROFILE_HANDLE = 'openstation-user-profile';

function openstation_users_profile_register_script() {
	$suffix = openstation_asset_suffix();
	$path   = OPENSTATION_DIR . 'assets/js/apps/user-profile' . $suffix . '.js';
	wp_register_script(
		OPENSTATION_USER_PROFILE_HANDLE,
		OPENSTATION_URL . 'assets/js/apps/user-profile' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $path ) ? (string) filemtime( $path ) : OPENSTATION_VERSION,
		true
	);
	wp_set_script_translations( OPENSTATION_USER_PROFILE_HANDLE, 'desktop-mode', OPENSTATION_DIR . 'languages' );
}
add_action( 'init', 'openstation_users_profile_register_script', 11 );

function openstation_users_profile_window_args( $window_args, $app_id ) {
	if ( ! is_array( $window_args ) || ! in_array( (string) $app_id, array( 'desktop-mode-users', 'desktop-mode-user-edit' ), true ) ) {
		return $window_args;
	}

	if ( ! wp_script_is( OPENSTATION_USER_PROFILE_HANDLE, 'registered' ) ) {
		openstation_users_profile_register_script();
	}
	$scripts = isset( $window_args['scripts'] ) ? (array) $window_args['scripts'] : array();
	if ( ! in_array( OPENSTATION_USER_PROFILE_HANDLE, $scripts, true ) ) {
		$scripts[] = OPENSTATION_USER_PROFILE_HANDLE;
	}
	$window_args['scripts'] = $scripts;
	return $window_args;
}
add_filter( 'openstation_app_window_args', 'openstation_users_profile_window_args', 10, 2 );
