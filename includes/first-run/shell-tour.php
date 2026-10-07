<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_SHELL_TOUR_INTRO_SLUG = 'shell-tour';

const OPENSTATION_SHELL_TOUR_SKIPPED_SLUG = 'shell-tour-skipped';

const OPENSTATION_SHELL_TOUR_DONE_SLUG = 'shell-tour-done';

const OPENSTATION_SHELL_TOUR_ICON_ID = 'openstation-shell-tour';

function openstation_should_offer_shell_tour( $user_id = 0 ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		$user_id = get_current_user_id();
	}

	return (bool) apply_filters( 'openstation_show_shell_tour', true, $user_id );
}

function openstation_shell_tour_is_unfinished( $user_id = 0 ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		$user_id = get_current_user_id();
	}
	if ( $user_id <= 0 ) {
		return false;
	}
	return openstation_has_seen_intro( $user_id, OPENSTATION_SHELL_TOUR_SKIPPED_SLUG )
		&& ! openstation_has_seen_intro( $user_id, OPENSTATION_SHELL_TOUR_DONE_SLUG );
}

function openstation_shell_tour_relaunch_icon( $registry ) {
	if ( ! is_array( $registry ) ) {
		return $registry;
	}
	if ( ! openstation_should_offer_shell_tour() || ! openstation_shell_tour_is_unfinished() ) {
		return $registry;
	}
	$registry[ OPENSTATION_SHELL_TOUR_ICON_ID ] = array(
		'id'       => OPENSTATION_SHELL_TOUR_ICON_ID,
		'title'    => __( 'Take the tour', 'desktop-mode' ),
		'icon'     => 'dashicons-welcome-learn-more',
		'window'   => '',
		'url'      => '',
		'position' => 100,
		'pinned'   => false,
	);
	return $registry;
}
add_filter( 'openstation_icons', 'openstation_shell_tour_relaunch_icon' );
