<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_LAST_LOGIN_META_KEY = '_desktop_mode_last_login_at';

function openstation_users_window_record_login( $user_login, $user = null ) {
	$user_id = 0;
	if ( $user instanceof WP_User ) {
		$user_id = (int) $user->ID;
	} elseif ( is_string( $user_login ) && '' !== $user_login ) {
		$by = get_user_by( 'login', $user_login );
		if ( $by instanceof WP_User ) {
			$user_id = (int) $by->ID;
		}
	}

	if ( $user_id <= 0 ) {
		return;
	}

	update_user_meta( $user_id, OPENSTATION_LAST_LOGIN_META_KEY, time() );

	do_action( 'openstation_users_window_login_recorded', $user_id, time() );
}
add_action( 'wp_login', 'openstation_users_window_record_login', 10, 2 );
