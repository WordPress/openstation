<?php

defined( 'ABSPATH' ) || exit;

function openstation_pages_window_user_can_register( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$can = $user_id > 0 && user_can( $user_id, 'edit_pages' );

	return (bool) apply_filters(
		'openstation_pages_window_user_can_register',
		$can,
		$user_id
	);
}

function openstation_pages_window_user_can_use( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$cap_ok = openstation_pages_window_user_can_register( $user_id );

	$opt_in = false;
	if ( $cap_ok && function_exists( 'openstation_get_os_settings' ) ) {
		$settings = openstation_get_os_settings( $user_id );
		$opt_in   = ! empty( $settings['nativePagesEnabled'] );
	}

	$can = $cap_ok && $opt_in;

	return (bool) apply_filters( 'openstation_pages_window_user_can_use', $can, $user_id );
}
