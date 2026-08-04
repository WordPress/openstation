<?php
/**
 * OpenStation — Games REST routes.
 *
 * Namespace `desktop-mode/v1`:
 *
 *   GET    /games/(?P<game>[a-z0-9_\-]+)/scores   Leaderboard (paged).
 *   POST   /games/(?P<game>[a-z0-9_\-]+)/scores   Submit own score.
 *   GET    /games/challenges                      Challenges involving me.
 *   POST   /games/challenges                      Send a challenge.
 *   POST   /games/challenges/(?P<id>\d+)/accept   Accept (recipient).
 *   POST   /games/challenges/(?P<id>\d+)/decline  Decline (recipient).
 *   POST   /games/challenges/(?P<id>\d+)/complete Report the run (recipient).
 *   GET    /games/users/search                    Opponent-picker autocomplete.
 *   GET    /games/playtime                        My per-game play-time totals.
 *   POST   /games/(?P<game>[a-z0-9_\-]+)/playtime Record own play time.
 *
 * Permission: every route requires a logged-in user with desktop
 * mode enabled and the `read` capability (subscribers play games
 * too). Unknown game ids 404. Challenge routes additionally verify
 * party membership; sending gates through the
 * `openstation_games_can_challenge` filter.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Base permission gate shared by every games route.
 */
function openstation_games_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error( 'openstation_games_unauthenticated', __( 'You must be logged in.', 'desktop-mode' ), array( 'status' => 401 ) );
	}
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled( get_current_user_id() ) ) {
		return new WP_Error( 'openstation_games_disabled', __( 'OpenStation is not enabled for this user.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	if ( ! current_user_can( 'read' ) ) {
		return new WP_Error( 'openstation_games_forbidden', __( 'You cannot use desktop games.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	/**
	 * Filters the base games REST permission verdict. Return a
	 * `WP_Error` (or `false`) to lock the whole surface down below
	 * the default logged-in + `read` gate.
	 *
	 * @param true|false|WP_Error $allowed Default `true`.
	 * @param int                 $user_id Current user.
	 */
	$allowed = apply_filters( 'openstation_games_rest_permission', true, get_current_user_id() );
	if ( is_wp_error( $allowed ) ) {
		return $allowed;
	}
	if ( true !== $allowed ) {
		return new WP_Error( 'openstation_games_forbidden', __( 'You cannot use desktop games.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	return true;
}

/**
 * Register the routes.
 */
function openstation_games_register_rest_routes() {
	$ns = 'desktop-mode/v1';

	register_rest_route(
		$ns,
		'/games/(?P<game>[a-z0-9_\-]+)/scores',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'openstation_games_rest_permission',
				'callback'            => 'openstation_games_rest_list_scores',
				'args'                => array(
					'page'     => array(
						'type'    => 'integer',
						'default' => 1,
						'minimum' => 1,
					),
					'per_page' => array(
						'type'    => 'integer',
						'default' => 25,
						'minimum' => 1,
						'maximum' => 100,
					),
					'orderby'  => array(
						'type'    => 'string',
						'default' => 'score',
						'enum'    => array( 'score', 'created' ),
					),
					'order'    => array(
						'type'    => 'string',
						'default' => 'desc',
						'enum'    => array( 'asc', 'desc' ),
					),
					'user_id'  => array(
						'type'    => 'integer',
						'default' => 0,
					),
				),
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'openstation_games_rest_permission',
				'callback'            => 'openstation_games_rest_submit_score',
				'args'                => array(
					'score' => array(
						'type'     => 'integer',
						'required' => true,
						'minimum'  => 0,
					),
					'meta'  => array(
						'type'    => 'object',
						'default' => array(),
					),
				),
			),
		)
	);

	register_rest_route(
		$ns,
		'/games/challenges',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'openstation_games_rest_permission',
				'callback'            => 'openstation_games_rest_list_challenges',
				'args'                => array(
					'box'   => array(
						'type'    => 'string',
						'default' => 'all',
						'enum'    => array( 'incoming', 'outgoing', 'all' ),
					),
					'state' => array(
						'type'    => 'string',
						'default' => '',
						'enum'    => array( '', 'pending', 'accepted', 'declined', 'completed' ),
					),
				),
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'openstation_games_rest_permission',
				'callback'            => 'openstation_games_rest_create_challenge',
				'args'                => array(
					'game'         => array(
						'type'     => 'string',
						'required' => true,
					),
					'recipient_id' => array(
						'type'     => 'integer',
						'required' => true,
					),
					'score'        => array(
						'type'     => 'integer',
						'required' => true,
						'minimum'  => 0,
					),
					'meta'         => array(
						'type'    => 'object',
						'default' => array(),
					),
				),
			),
		)
	);

	register_rest_route(
		$ns,
		'/games/challenges/(?P<id>\d+)/accept',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_games_rest_permission',
			'callback'            => 'openstation_games_rest_accept_challenge',
		)
	);

	register_rest_route(
		$ns,
		'/games/challenges/(?P<id>\d+)/decline',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_games_rest_permission',
			'callback'            => 'openstation_games_rest_decline_challenge',
		)
	);

	register_rest_route(
		$ns,
		'/games/challenges/(?P<id>\d+)/complete',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_games_rest_permission',
			'callback'            => 'openstation_games_rest_complete_challenge',
			'args'                => array(
				'score' => array(
					'type'     => 'integer',
					'required' => true,
					'minimum'  => 0,
				),
				'meta'  => array(
					'type'    => 'object',
					'default' => array(),
				),
			),
		)
	);

	register_rest_route(
		$ns,
		'/games/playtime',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'openstation_games_rest_permission',
			'callback'            => 'openstation_games_rest_get_playtime',
		)
	);

	register_rest_route(
		$ns,
		'/games/(?P<game>[a-z0-9_\-]+)/playtime',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_games_rest_permission',
			'callback'            => 'openstation_games_rest_record_playtime',
			'args'                => array(
				'seconds' => array(
					'type'     => 'integer',
					'required' => true,
					'minimum'  => 1,
				),
			),
		)
	);

	register_rest_route(
		$ns,
		'/games/users/search',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'openstation_games_rest_permission',
			'callback'            => 'openstation_games_rest_search_users',
			'args'                => array(
				'q'       => array(
					'type'    => 'string',
					'default' => '',
				),
				'exclude' => array(
					'type'    => 'string',
					'default' => '',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_games_register_rest_routes' );

/**
 * Resolve + validate the `game` path param. 404s unknown ids so the
 * scores surface doesn't leak which games exist server-side.
 *
 * @internal
 *
 * @param WP_REST_Request $req Request.
 * @return string|WP_Error The sanitized game id.
 */
function openstation_games_rest_resolve_game( WP_REST_Request $req ) {
	$game = sanitize_key( (string) $req->get_param( 'game' ) );
	if ( '' === $game || ! openstation_games_is_registered( $game ) ) {
		return new WP_Error(
			'openstation_unknown_game',
			__( 'Unknown game.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	return $game;
}

/**
 * GET /games/{game}/scores
 */
function openstation_games_rest_list_scores( WP_REST_Request $req ) {
	$game = openstation_games_rest_resolve_game( $req );
	if ( is_wp_error( $game ) ) {
		return $game;
	}
	$result = openstation_games_get_scores(
		$game,
		array(
			'page'     => (int) $req->get_param( 'page' ),
			'per_page' => (int) $req->get_param( 'per_page' ),
			'orderby'  => (string) $req->get_param( 'orderby' ),
			'order'    => (string) $req->get_param( 'order' ),
			'user_id'  => (int) $req->get_param( 'user_id' ),
		)
	);
	return rest_ensure_response(
		array(
			'scores' => $result['rows'],
			'total'  => $result['total'],
		)
	);
}

/**
 * POST /games/{game}/scores — always records for the current user;
 * there is no way to submit a score on someone else's behalf.
 */
function openstation_games_rest_submit_score( WP_REST_Request $req ) {
	$game = openstation_games_rest_resolve_game( $req );
	if ( is_wp_error( $game ) ) {
		return $game;
	}
	$id = openstation_games_save_score(
		$game,
		get_current_user_id(),
		(int) $req->get_param( 'score' ),
		(array) $req->get_param( 'meta' )
	);
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	return rest_ensure_response( array( 'id' => $id ) );
}

/**
 * GET /games/playtime — the current user's `game id => seconds` map.
 */
function openstation_games_rest_get_playtime() {
	$user_id = get_current_user_id();
	// Day maps are cast per-game so empty buckets JSON-encode as `{}`.
	$daily = array();
	foreach ( openstation_games_get_playtime_daily( $user_id ) as $game => $days ) {
		$daily[ $game ] = (object) $days;
	}
	return rest_ensure_response(
		array(
			'playtime' => (object) openstation_games_get_playtime( $user_id ),
			'daily'    => (object) $daily,
			'today'    => openstation_games_playtime_today_key(),
		)
	);
}

/**
 * POST /games/{game}/playtime — always records for the current user;
 * there is no way to record play time on someone else's behalf.
 */
function openstation_games_rest_record_playtime( WP_REST_Request $req ) {
	$game = openstation_games_rest_resolve_game( $req );
	if ( is_wp_error( $game ) ) {
		return $game;
	}
	$total = openstation_games_add_playtime(
		$game,
		get_current_user_id(),
		(int) $req->get_param( 'seconds' )
	);
	if ( is_wp_error( $total ) ) {
		return $total;
	}
	return rest_ensure_response( array( 'total' => $total ) );
}

/**
 * GET /games/challenges — challenges involving the current user.
 */
function openstation_games_rest_list_challenges( WP_REST_Request $req ) {
	$user_id = get_current_user_id();
	$box     = (string) $req->get_param( 'box' );
	$state   = (string) $req->get_param( 'state' );

	$rows = openstation_games_get_challenges_for_user( $user_id, 0, 100 );
	$out  = array();
	foreach ( $rows as $row ) {
		if ( 'incoming' === $box && (int) $row['recipient_id'] !== $user_id ) {
			continue;
		}
		if ( 'outgoing' === $box && (int) $row['challenger_id'] !== $user_id ) {
			continue;
		}
		if ( '' !== $state && $row['state'] !== $state ) {
			continue;
		}
		$out[] = openstation_games_shape_challenge( $row );
	}
	// Newest change first for the inbox view.
	$out = array_reverse( $out );
	return rest_ensure_response( array( 'challenges' => $out ) );
}

/**
 * POST /games/challenges
 */
function openstation_games_rest_create_challenge( WP_REST_Request $req ) {
	$challenger_id = get_current_user_id();
	$recipient_id  = (int) $req->get_param( 'recipient_id' );
	$game          = sanitize_key( (string) $req->get_param( 'game' ) );

	if ( ! openstation_games_is_registered( $game ) ) {
		return new WP_Error(
			'openstation_unknown_game',
			__( 'Unknown game.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	/**
	 * Filters whether a user may challenge another user. Return
	 * `false` (or a `WP_Error`) to block — e.g. respecting a
	 * do-not-disturb setting or a per-role policy.
	 *
	 * @param bool|WP_Error $allowed       Default `true`.
	 * @param int           $challenger_id Sender.
	 * @param int           $recipient_id  Receiver.
	 * @param string        $game          Game id.
	 */
	$allowed = apply_filters( 'openstation_games_can_challenge', true, $challenger_id, $recipient_id, $game );
	if ( is_wp_error( $allowed ) ) {
		return $allowed;
	}
	if ( true !== $allowed ) {
		return new WP_Error(
			'openstation_challenge_blocked',
			__( 'You cannot challenge this user.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	$id = openstation_games_create_challenge(
		$game,
		$challenger_id,
		$recipient_id,
		(int) $req->get_param( 'score' ),
		(array) $req->get_param( 'meta' )
	);
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	$row = openstation_games_get_challenge( $id );
	return rest_ensure_response( array( 'challenge' => openstation_games_shape_challenge( $row ) ) );
}

/**
 * Load a challenge and verify the current user is its recipient.
 *
 * @internal
 *
 * @param WP_REST_Request $req Request.
 * @return array|WP_Error The raw challenge row.
 */
function openstation_games_rest_resolve_recipient_challenge( WP_REST_Request $req ) {
	$row = openstation_games_get_challenge( (int) $req->get_param( 'id' ) );
	if ( ! $row ) {
		return new WP_Error(
			'openstation_challenge_not_found',
			__( 'Challenge not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( get_current_user_id() !== (int) $row['recipient_id'] ) {
		return new WP_Error(
			'openstation_challenge_forbidden',
			__( 'Only the challenged user can act on this challenge.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return $row;
}

/**
 * POST /games/challenges/{id}/accept
 */
function openstation_games_rest_accept_challenge( WP_REST_Request $req ) {
	$row = openstation_games_rest_resolve_recipient_challenge( $req );
	if ( is_wp_error( $row ) ) {
		return $row;
	}
	$result = openstation_games_set_challenge_state( (int) $row['id'], 'accepted' );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	$updated = openstation_games_get_challenge( (int) $row['id'] );
	return rest_ensure_response( array( 'challenge' => openstation_games_shape_challenge( $updated ) ) );
}

/**
 * POST /games/challenges/{id}/decline
 */
function openstation_games_rest_decline_challenge( WP_REST_Request $req ) {
	$row = openstation_games_rest_resolve_recipient_challenge( $req );
	if ( is_wp_error( $row ) ) {
		return $row;
	}
	$result = openstation_games_set_challenge_state( (int) $row['id'], 'declined' );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	$updated = openstation_games_get_challenge( (int) $row['id'] );
	return rest_ensure_response( array( 'challenge' => openstation_games_shape_challenge( $updated ) ) );
}

/**
 * POST /games/challenges/{id}/complete
 */
function openstation_games_rest_complete_challenge( WP_REST_Request $req ) {
	$row = openstation_games_rest_resolve_recipient_challenge( $req );
	if ( is_wp_error( $row ) ) {
		return $row;
	}
	$updated = openstation_games_complete_challenge(
		(int) $row['id'],
		(int) $req->get_param( 'score' ),
		(array) $req->get_param( 'meta' )
	);
	if ( is_wp_error( $updated ) ) {
		return $updated;
	}
	return rest_ensure_response( array( 'challenge' => openstation_games_shape_challenge( $updated ) ) );
}

/**
 * GET /games/users/search?q=<>&exclude=<csv> — autocomplete for the
 * opponent picker. Thin sibling of the folder-share picker, gated on
 * `read` instead of `edit_posts` so subscribers can be challenged.
 */
function openstation_games_rest_search_users( WP_REST_Request $req ) {
	$q       = trim( (string) $req->get_param( 'q' ) );
	$exclude = array_filter( array_map( 'intval', explode( ',', (string) $req->get_param( 'exclude' ) ) ) );

	// Always exclude the current viewer — self-challenges are
	// rejected at create time anyway.
	$exclude[] = (int) get_current_user_id();
	$exclude   = array_values( array_unique( array_filter( $exclude ) ) );

	$args = array(
		'number'  => 20,
		'orderby' => 'display_name',
		'order'   => 'ASC',
		'exclude' => $exclude,
		'fields'  => 'all',
	);
	if ( '' !== $q ) {
		$args['search']         = '*' . $q . '*';
		$args['search_columns'] = array( 'user_login', 'user_email', 'display_name', 'user_nicename' );
	}

	/**
	 * Filter the WP_User_Query args used by the opponent picker.
	 *
	 * @param array $args Default args.
	 * @param array $req  Request params (`q`, `exclude`).
	 */
	$args = (array) apply_filters( 'openstation_games_user_query_args', $args, $req->get_params() );

	$query = new WP_User_Query( $args );
	$users = $query->get_results();
	$out   = array();
	foreach ( (array) $users as $user ) {
		if ( ! user_can( $user, 'read' ) ) {
			continue;
		}
		$out[] = array(
			'id'        => (int) $user->ID,
			'name'      => (string) $user->display_name,
			'slug'      => (string) $user->user_nicename,
			'avatarUrl' => get_avatar_url( $user->ID, array( 'size' => 48 ) ),
		);
	}
	return rest_ensure_response( array( 'users' => $out ) );
}
