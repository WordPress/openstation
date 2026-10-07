<?php

defined( 'ABSPATH' ) || exit;

function openstation_games_heartbeat_received( $response, $data ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( empty( $data['openstation_games_subscribe'] ) || ! is_array( $data['openstation_games_subscribe'] ) ) {
		return $response;
	}
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return $response;
	}

	$user_id = (int) get_current_user_id();
	if ( $user_id <= 0 ) {
		return $response;
	}

	$sub     = $data['openstation_games_subscribe'];
	$version = isset( $sub['challengesVersion'] ) ? (int) $sub['challengesVersion'] : 0;

	$cap = max( 1, (int) apply_filters( 'openstation_games_heartbeat_max_rows', 50 ) );

	$rows      = openstation_games_get_challenges_for_user( $user_id, $version, $cap + 1 );
	$truncated = count( $rows ) > $cap;
	if ( $truncated ) {
		$rows = array_slice( $rows, 0, $cap );
	}

	$response['openstation_games'] = array(
		'challenges'   => array_map( 'openstation_games_shape_challenge', $rows ),
		'serverTimeMs' => openstation_games_now_ms(),
		'truncated'    => $truncated,
	);
	return $response;
}
add_filter( 'heartbeat_received', 'openstation_games_heartbeat_received', 5, 2 );
