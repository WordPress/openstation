<?php
/**
 * OpenStation — Games store.
 *
 * CRUD for the two games tables. Scores are client-asserted (arcade
 * trust model): the server clamps and sanitizes what it can — the
 * game must be server-registered, the score is a non-negative int,
 * the meta blob is a bounded flat scalar map — and exposes the
 * `openstation_game_score_pre_save` filter for plugins that want
 * stricter validation.
 *
 * The challenge state machine is enforced HERE, not in REST:
 * `pending → accepted | declined`, `accepted → completed`. Every
 * mutation bumps `updated_at_ms`, the Heartbeat high-water mark.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Bound and sanitize a score meta blob: flat map, slug keys, scalar
 * values only. Strings are text-sanitized and truncated; the map is
 * capped at 20 keys so a hostile client can't fatten the table.
 *
 * @param mixed $meta Raw caller input.
 * @return array Sanitized flat map.
 */
function openstation_games_sanitize_score_meta( $meta ) {
	if ( ! is_array( $meta ) ) {
		return array();
	}
	$out = array();
	foreach ( $meta as $key => $value ) {
		if ( count( $out ) >= 20 ) {
			break;
		}
		$key = sanitize_key( (string) $key );
		if ( '' === $key ) {
			continue;
		}
		if ( is_int( $value ) || is_float( $value ) ) {
			$out[ $key ] = $value + 0;
		} elseif ( is_bool( $value ) ) {
			$out[ $key ] = $value;
		} elseif ( is_string( $value ) ) {
			$out[ $key ] = mb_substr( sanitize_text_field( $value ), 0, 200 );
		}
		// Nested arrays/objects are dropped — flat scalars only.
	}
	return $out;
}

/**
 * Persist a finished game run.
 *
 * @param string $game    Registered game id.
 * @param int    $user_id Player.
 * @param int    $score   Primary sort value. Clamped to >= 0.
 * @param array  $meta    Flexible per-game fields (see the game's
 *                        `score_columns`).
 * @return int|WP_Error Row id on success.
 */
function openstation_games_save_score( $game, $user_id, $score, $meta = array() ) {
	global $wpdb;

	$game    = sanitize_key( (string) $game );
	$user_id = (int) $user_id;
	$score   = max( 0, (int) $score );
	$meta    = openstation_games_sanitize_score_meta( $meta );

	if ( ! openstation_games_is_registered( $game ) ) {
		return new WP_Error(
			'openstation_unknown_game',
			__( 'Unknown game.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( $user_id <= 0 ) {
		return new WP_Error(
			'openstation_invalid_user',
			__( 'A valid user is required to save a score.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	/**
	 * Short-circuit / veto filter for score saves. Return a
	 * `WP_Error` to reject the save (surfaced to the client), or
	 * `null` to proceed. The extension point for anti-cheat
	 * plugins (rate limits, plausibility checks).
	 *
	 * @param null|WP_Error $pre     Null to proceed.
	 * @param string        $game    Game id.
	 * @param int           $user_id Player.
	 * @param int           $score   Clamped score.
	 * @param array         $meta    Sanitized meta map.
	 */
	$pre = apply_filters( 'openstation_game_score_pre_save', null, $game, $user_id, $score, $meta );
	if ( is_wp_error( $pre ) ) {
		return $pre;
	}

	$tables = openstation_games_table_names();
	$ok     = $wpdb->insert(
		$tables['scores'],
		array(
			'game'          => $game,
			'user_id'       => $user_id,
			'score'         => $score,
			'meta'          => wp_json_encode( $meta ),
			'created_at_ms' => openstation_games_now_ms(),
		),
		array( '%s', '%d', '%d', '%s', '%d' )
	);
	if ( false === $ok ) {
		return new WP_Error(
			'openstation_score_save_failed',
			__( 'Could not save the score.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}
	$id = (int) $wpdb->insert_id;

	/**
	 * Fires after a game score is saved.
	 *
	 * @param int    $id      Score row id.
	 * @param string $game    Game id.
	 * @param int    $user_id Player.
	 * @param int    $score   Saved score.
	 * @param array  $meta    Saved meta map.
	 */
	do_action( 'openstation_game_score_saved', $id, $game, $user_id, $score, $meta );

	return $id;
}

/**
 * Leaderboard query.
 *
 * @param string $game Registered game id.
 * @param array  $args {
 *     @type int    $page     1-based page. Default 1.
 *     @type int    $per_page Rows per page, 1–100. Default 25.
 *     @type string $orderby  'score' | 'created'. Default 'score'.
 *     @type string $order    'asc' | 'desc'. Default 'desc'.
 *     @type int    $user_id  Restrict to one player. Default 0 (all).
 * }
 * @return array{ rows: array[], total: int }
 */
function openstation_games_get_scores( $game, $args = array() ) {
	global $wpdb;

	$game     = sanitize_key( (string) $game );
	$page     = max( 1, (int) ( $args['page'] ?? 1 ) );
	$per_page = min( 100, max( 1, (int) ( $args['per_page'] ?? 25 ) ) );
	$orderby  = ( 'created' === ( $args['orderby'] ?? '' ) ) ? 'created_at_ms' : 'score';
	$order    = ( 'asc' === strtolower( (string) ( $args['order'] ?? 'desc' ) ) ) ? 'ASC' : 'DESC';
	$user_id  = (int) ( $args['user_id'] ?? 0 );

	$tables = openstation_games_table_names();
	$where  = 'game = %s';
	$params = array( $game );
	if ( $user_id > 0 ) {
		$where   .= ' AND user_id = %d';
		$params[] = $user_id;
	}

	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$total = (int) $wpdb->get_var(
		$wpdb->prepare( "SELECT COUNT(*) FROM {$tables['scores']} WHERE {$where}", $params )
	);

	$params[] = $per_page;
	$params[] = ( $page - 1 ) * $per_page;
	// `$orderby` / `$order` are clamped to fixed identifiers above —
	// safe to interpolate.
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['scores']}
			WHERE {$where}
			ORDER BY {$orderby} {$order}, id ASC
			LIMIT %d OFFSET %d",
			$params
		),
		ARRAY_A
	);

	return array(
		'rows'  => array_map( 'openstation_games_shape_score', (array) $rows ),
		'total' => $total,
	);
}

/**
 * Shape a scores row for the wire: camelCase keys + player display
 * name and avatar.
 *
 * @param array $row Raw table row.
 * @return array
 */
function openstation_games_shape_score( $row ) {
	$user_id = (int) $row['user_id'];
	$user    = get_userdata( $user_id );
	$meta    = json_decode( (string) ( $row['meta'] ?? '' ), true );
	return array(
		'id'          => (int) $row['id'],
		'game'        => (string) $row['game'],
		'userId'      => $user_id,
		'userName'    => $user ? $user->display_name : __( 'Former user', 'desktop-mode' ),
		'userAvatar'  => $user ? get_avatar_url( $user_id, array( 'size' => 48 ) ) : '',
		'score'       => (int) $row['score'],
		'meta'        => is_array( $meta ) ? $meta : array(),
		'createdAtMs' => (int) $row['created_at_ms'],
	);
}

/**
 * Create a score-to-beat challenge.
 *
 * @param string $game          Registered game id.
 * @param int    $challenger_id Sender.
 * @param int    $recipient_id  Receiver.
 * @param int    $score_to_beat The challenger's score.
 * @param array  $score_meta    The challenger's score meta map.
 * @return int|WP_Error Challenge id on success.
 */
function openstation_games_create_challenge( $game, $challenger_id, $recipient_id, $score_to_beat, $score_meta = array() ) {
	global $wpdb;

	$game          = sanitize_key( (string) $game );
	$challenger_id = (int) $challenger_id;
	$recipient_id  = (int) $recipient_id;

	if ( ! openstation_games_is_registered( $game ) ) {
		return new WP_Error(
			'openstation_unknown_game',
			__( 'Unknown game.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( $recipient_id <= 0 || ! get_userdata( $recipient_id ) ) {
		return new WP_Error(
			'openstation_invalid_recipient',
			__( 'The challenged user does not exist.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( $recipient_id === $challenger_id ) {
		return new WP_Error(
			'openstation_self_challenge',
			__( 'You cannot challenge yourself.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$now    = openstation_games_now_ms();
	$tables = openstation_games_table_names();
	$ok     = $wpdb->insert(
		$tables['challenges'],
		array(
			'game'          => $game,
			'challenger_id' => $challenger_id,
			'recipient_id'  => $recipient_id,
			'score_to_beat' => max( 0, (int) $score_to_beat ),
			'score_meta'    => wp_json_encode( openstation_games_sanitize_score_meta( $score_meta ) ),
			'state'         => 'pending',
			'created_at_ms' => $now,
			'updated_at_ms' => $now,
		),
		array( '%s', '%d', '%d', '%d', '%s', '%s', '%d', '%d' )
	);
	if ( false === $ok ) {
		return new WP_Error(
			'openstation_challenge_create_failed',
			__( 'Could not create the challenge.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}
	$id = (int) $wpdb->insert_id;

	/**
	 * Fires after a game challenge is created.
	 *
	 * @param int   $id  Challenge id.
	 * @param array $row The challenge row.
	 */
	do_action( 'openstation_game_challenge_created', $id, openstation_games_get_challenge( $id ) );

	return $id;
}

/**
 * Fetch one challenge row.
 *
 * @param int $id Challenge id.
 * @return array|null Raw table row.
 */
function openstation_games_get_challenge( $id ) {
	global $wpdb;
	$tables = openstation_games_table_names();
	$row    = $wpdb->get_row(
		$wpdb->prepare( "SELECT * FROM {$tables['challenges']} WHERE id = %d", (int) $id ),
		ARRAY_A
	);
	return is_array( $row ) ? $row : null;
}

/**
 * Transition a challenge to `accepted` or `declined`. Only valid
 * from `pending`.
 *
 * @param int    $id    Challenge id.
 * @param string $state 'accepted' | 'declined'.
 * @return true|WP_Error
 */
function openstation_games_set_challenge_state( $id, $state ) {
	global $wpdb;

	if ( ! in_array( $state, array( 'accepted', 'declined' ), true ) ) {
		return new WP_Error(
			'openstation_invalid_challenge_state',
			__( 'Invalid challenge state.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	$row = openstation_games_get_challenge( $id );
	if ( ! $row ) {
		return new WP_Error(
			'openstation_challenge_not_found',
			__( 'Challenge not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( 'pending' !== $row['state'] ) {
		return new WP_Error(
			'openstation_challenge_state_conflict',
			__( 'This challenge has already been decided.', 'desktop-mode' ),
			array( 'status' => 409 )
		);
	}

	// Monotonic bump: a transition landing in the same millisecond as
	// the previous write must still move `updated_at_ms` forward, or
	// version-gated Heartbeat clients would never see the change.
	$now    = max( openstation_games_now_ms(), (int) $row['updated_at_ms'] + 1 );
	$tables = openstation_games_table_names();
	$wpdb->update(
		$tables['challenges'],
		array(
			'state'         => $state,
			'decided_at_ms' => $now,
			'updated_at_ms' => $now,
		),
		array( 'id' => (int) $id ),
		array( '%s', '%d', '%d' ),
		array( '%d' )
	);

	if ( 'accepted' === $state ) {
		/**
		 * Fires after a challenge is accepted by its recipient.
		 *
		 * @param int   $id  Challenge id.
		 * @param array $row The (pre-transition) challenge row.
		 */
		do_action( 'openstation_game_challenge_accepted', (int) $id, $row );
	} else {
		/**
		 * Fires after a challenge is declined by its recipient.
		 *
		 * @param int   $id  Challenge id.
		 * @param array $row The (pre-transition) challenge row.
		 */
		do_action( 'openstation_game_challenge_declined', (int) $id, $row );
	}

	return true;
}

/**
 * Record the recipient's run against an accepted challenge. Also
 * persists the run as a normal leaderboard score row.
 *
 * @param int   $id    Challenge id.
 * @param int   $score The recipient's score.
 * @param array $meta  The recipient's score meta map.
 * @return array|WP_Error The updated challenge row.
 */
function openstation_games_complete_challenge( $id, $score, $meta = array() ) {
	global $wpdb;

	$row = openstation_games_get_challenge( $id );
	if ( ! $row ) {
		return new WP_Error(
			'openstation_challenge_not_found',
			__( 'Challenge not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( 'accepted' !== $row['state'] ) {
		return new WP_Error(
			'openstation_challenge_state_conflict',
			__( 'Only an accepted challenge can be completed.', 'desktop-mode' ),
			array( 'status' => 409 )
		);
	}

	$score  = max( 0, (int) $score );
	$meta   = openstation_games_sanitize_score_meta( $meta );
	$result = $score > (int) $row['score_to_beat'] ? 'beaten' : 'not_beaten';

	// The run also lands on the leaderboard — a challenge game is a
	// real game. A veto from the pre-save filter aborts the whole
	// completion so the two writes can't diverge.
	$score_id = openstation_games_save_score( $row['game'], (int) $row['recipient_id'], $score, $meta );
	if ( is_wp_error( $score_id ) ) {
		return $score_id;
	}

	// Same monotonic-bump rule as `set_challenge_state()` — see there.
	$now    = max( openstation_games_now_ms(), (int) $row['updated_at_ms'] + 1 );
	$tables = openstation_games_table_names();
	$wpdb->update(
		$tables['challenges'],
		array(
			'state'           => 'completed',
			'result'          => $result,
			'result_score'    => $score,
			'result_meta'     => wp_json_encode( $meta ),
			'completed_at_ms' => $now,
			'updated_at_ms'   => $now,
		),
		array( 'id' => (int) $id ),
		array( '%s', '%s', '%d', '%s', '%d', '%d' ),
		array( '%d' )
	);

	$updated = openstation_games_get_challenge( $id );

	/**
	 * Fires after a challenge run is completed.
	 *
	 * @param int    $id     Challenge id.
	 * @param string $result 'beaten' | 'not_beaten'.
	 * @param array  $row    The updated challenge row.
	 */
	do_action( 'openstation_game_challenge_completed', (int) $id, $result, $updated );

	return $updated;
}

/**
 * Challenges involving a user (as challenger or recipient) whose
 * `updated_at_ms` exceeds the given high-water mark. The Heartbeat
 * delta query.
 *
 * @param int $user_id  Viewer.
 * @param int $since_ms Last-seen `updated_at_ms`. 0 = everything.
 * @param int $cap      Row cap.
 * @return array[] Raw rows, oldest change first.
 */
function openstation_games_get_challenges_for_user( $user_id, $since_ms = 0, $cap = 50 ) {
	global $wpdb;
	$tables = openstation_games_table_names();
	$rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['challenges']}
			WHERE ( challenger_id = %d OR recipient_id = %d )
				AND updated_at_ms > %d
			ORDER BY updated_at_ms ASC
			LIMIT %d",
			(int) $user_id,
			(int) $user_id,
			(int) $since_ms,
			max( 1, (int) $cap )
		),
		ARRAY_A
	);
	return (array) $rows;
}

/**
 * Shape a challenge row for the wire: camelCase keys plus display
 * name + avatar for both parties.
 *
 * @param array $row Raw table row.
 * @return array
 */
function openstation_games_shape_challenge( $row ) {
	$challenger = get_userdata( (int) $row['challenger_id'] );
	$recipient  = get_userdata( (int) $row['recipient_id'] );
	$score_meta = json_decode( (string) ( $row['score_meta'] ?? '' ), true );
	$result_meta = json_decode( (string) ( $row['result_meta'] ?? '' ), true );
	return array(
		'id'               => (int) $row['id'],
		'game'             => (string) $row['game'],
		'challengerId'     => (int) $row['challenger_id'],
		'challengerName'   => $challenger ? $challenger->display_name : __( 'Former user', 'desktop-mode' ),
		'challengerAvatar' => $challenger ? get_avatar_url( $challenger->ID, array( 'size' => 48 ) ) : '',
		'recipientId'      => (int) $row['recipient_id'],
		'recipientName'    => $recipient ? $recipient->display_name : __( 'Former user', 'desktop-mode' ),
		'recipientAvatar'  => $recipient ? get_avatar_url( $recipient->ID, array( 'size' => 48 ) ) : '',
		'scoreToBeat'      => (int) $row['score_to_beat'],
		'scoreMeta'        => is_array( $score_meta ) ? $score_meta : array(),
		'state'            => (string) $row['state'],
		'result'           => null !== $row['result'] ? (string) $row['result'] : null,
		'resultScore'      => null !== $row['result_score'] ? (int) $row['result_score'] : null,
		'resultMeta'       => is_array( $result_meta ) ? $result_meta : array(),
		'createdAtMs'      => (int) $row['created_at_ms'],
		'updatedAtMs'      => (int) $row['updated_at_ms'],
	);
}
