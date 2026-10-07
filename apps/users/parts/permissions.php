<?php

defined( 'ABSPATH' ) || exit;

function openstation_users_window_user_can_register( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;
	$can     = $user_id > 0 && user_can( $user_id, 'list_users' );

	return (bool) apply_filters(
		'openstation_users_window_user_can_register',
		$can,
		$user_id
	);
}

function openstation_users_window_user_can_use( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$cap_ok = openstation_users_window_user_can_register( $user_id );

	$opt_in = false;
	if ( $cap_ok && function_exists( 'openstation_get_os_settings' ) ) {
		$settings = openstation_get_os_settings( $user_id );
		$opt_in   = ! empty( $settings['nativeUsersEnabled'] );
	}

	$can = $cap_ok && $opt_in;

	return (bool) apply_filters( 'openstation_users_window_user_can_use', $can, $user_id );
}

function openstation_users_window_assignable_roles( $viewer_id, $target_id = 0 ) {
	$viewer_id = (int) $viewer_id;
	if ( $viewer_id <= 0 || ! user_can( $viewer_id, 'promote_users' ) ) {
		return array();
	}

	$prev_user = get_current_user_id();
	$switched  = false;
	if ( $prev_user !== $viewer_id ) {
		wp_set_current_user( $viewer_id );
		$switched = true;
	}

	if ( ! function_exists( 'get_editable_roles' ) ) {
		require_once ABSPATH . 'wp-admin/includes/user.php';
	}
	$editable = function_exists( 'get_editable_roles' )
		? (array) get_editable_roles()
		: array();

	if ( $switched ) {
		wp_set_current_user( $prev_user );
	}

	$slugs = array_keys( $editable );

	return (array) apply_filters(
		'openstation_users_window_assignable_roles',
		$slugs,
		$viewer_id,
		$target_id
	);
}
