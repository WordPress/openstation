<?php
/**
 * OpenStation — Games Heartbeat sync (PHP).
 *
 * Piggybacks on the WordPress Heartbeat tick — the same channel
 * presence and folder sharing use — to deliver challenge activity
 * to connected users live: a new pending challenge for the
 * recipient, a completed run for the challenger.
 *
 * Wire format. Client sends:
 *
 *   {
 *       openstation_games_subscribe: {
 *           challengesVersion: lastSeenUpdatedAtMs
 *       }
 *   }
 *
 * Server responds:
 *
 *   openstation_games: {
 *       challenges:   [ <ChallengeShape> ],   // rows involving me,
 *                                             // updated_at_ms > version
 *       serverTimeMs: int,
 *       truncated:    bool
 *   }
 *
 * Version-gated: a quiet tick carries no rows. Truncation kicks in
 * past `openstation_games_heartbeat_max_rows` (default 50) — the
 * client falls back to `GET /games/challenges` for a full resync.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * @param array $response Pre-filtered response.
 * @param array $data     Client-sent payload.
 * @return array
 */
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

	/**
	 * Filter the per-tick challenge row cap. Past the cap the
	 * payload is flagged `truncated` and the client resyncs over
	 * REST.
	 *
	 * @param int $cap Default 50.
	 */
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
