<?php

defined( 'ABSPATH' ) || exit;

function openstation_user_edit_window_user_can_register( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;
	$can     = $user_id > 0;

	return (bool) apply_filters( 'openstation_user_edit_window_user_can_register', $can, $user_id );
}

function openstation_user_edit_window_can_edit( $viewer_id, $target_id ) {
	$viewer_id = (int) $viewer_id;
	$target_id = (int) $target_id;
	if ( $viewer_id <= 0 || $target_id <= 0 ) {
		return false;
	}
	return (bool) user_can( $viewer_id, 'edit_user', $target_id );
}
