<?php

defined( 'ABSPATH' ) || exit;

function openstation_user_footprint_row_action( $actions, $user_object ) {
	if ( ! openstation_is_chromeless_request() ) {
		return $actions;
	}

	if ( ! ( $user_object instanceof WP_User ) || $user_object->ID <= 0 ) {
		return $actions;
	}

	$user_id = (int) $user_object->ID;

	if ( ! apply_filters( 'openstation_user_footprint_row_action', true, $user_object ) ) {
		return $actions;
	}

	$fallback_url = get_current_user_id() === $user_id
		? admin_url( 'profile.php' )
		: add_query_arg( 'user_id', $user_id, admin_url( 'user-edit.php' ) );

	$actions['os-footprint'] = sprintf(
		'<a href="%1$s" data-os-footprint="%2$d" data-os-footprint-name="%3$s">%4$s</a>',
		esc_url( $fallback_url ),
		$user_id,
		esc_attr( $user_object->display_name ),
		esc_html__( 'View activity footprint', 'desktop-mode' )
	);

	return $actions;
}
add_filter( 'user_row_actions', 'openstation_user_footprint_row_action', 10, 2 );
