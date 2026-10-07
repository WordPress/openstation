<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_AGENT_USER_MARKER_META = '_desktop_mode_agent';

function openstation_agent_is_agent( $user ) {
	$user_id = $user instanceof WP_User ? $user->ID : (int) $user;
	if ( $user_id <= 0 ) {
		return false;
	}
	return '1' === (string) get_user_meta( $user_id, OPENSTATION_AGENT_USER_MARKER_META, true );
}

function openstation_agent_block_authentication( $user ) {
	if ( $user instanceof WP_User && openstation_agent_is_agent( $user ) ) {
		return new WP_Error(
			'openstation_agent_login_blocked',
			__( 'This account is a OpenStation agent. Login is disabled.', 'desktop-mode' )
		);
	}
	return $user;
}
add_filter( 'authenticate', 'openstation_agent_block_authentication', 30 );

function openstation_agent_block_session( $user_id ) {
	if ( $user_id && openstation_agent_is_agent( (int) $user_id ) ) {
		return false;
	}
	return $user_id;
}
add_filter( 'determine_current_user', 'openstation_agent_block_session', PHP_INT_MAX );

function openstation_agent_block_password_reset( $allow, $user_id ) {
	if ( openstation_agent_is_agent( $user_id ) ) {
		return false;
	}
	return $allow;
}
add_filter( 'allow_password_reset', 'openstation_agent_block_password_reset', 10, 2 );

function openstation_agent_block_application_passwords( $available, $user ) {
	if ( $user instanceof WP_User && openstation_agent_is_agent( $user ) ) {
		return false;
	}
	return $available;
}
add_filter( 'wp_is_application_passwords_available_for_user', 'openstation_agent_block_application_passwords', 10, 2 );

function openstation_agent_suppress_change_emails( $send, $user ) {
	$user_id = is_array( $user ) && isset( $user['ID'] ) ? (int) $user['ID'] : 0;
	if ( $user_id > 0 && openstation_agent_is_agent( $user_id ) ) {
		return false;
	}
	return $send;
}
add_filter( 'send_password_change_email', 'openstation_agent_suppress_change_emails', 10, 2 );
add_filter( 'send_email_change_email', 'openstation_agent_suppress_change_emails', 10, 2 );

function openstation_agent_block_author_archive( $query ) {
	if ( is_admin() || ! $query->is_main_query() || ! $query->is_author() ) {
		return;
	}

	$author_id = (int) $query->get( 'author' );
	if ( $author_id <= 0 ) {
		$name = $query->get( 'author_name' );
		if ( is_string( $name ) && '' !== $name ) {
			$user      = get_user_by( 'slug', $name );
			$author_id = $user ? (int) $user->ID : 0;
		}
	}

	if ( $author_id > 0 && openstation_agent_is_agent( $author_id ) ) {
		$query->set_404();
		status_header( 404 );
		nocache_headers();
	}
}
add_action( 'pre_get_posts', 'openstation_agent_block_author_archive' );
