<?php
/**
 * Desktop Mode — Games play-time store.
 *
 * Accumulates how long each user has spent playing each game. The
 * framework's launcher measures active window time client-side (the
 * clock pauses while the game window is minimized) and flushes
 * increments to `POST /games/{game}/playtime`; totals live in one
 * user-meta map — `desktop_mode_game_playtime` — keyed by game id,
 * values in whole seconds. A second map —
 * `desktop_mode_game_playtime_days` — buckets the same increments by
 * site-timezone day (rolling window) so the hub can show a
 * Steam-style "last two weeks" figure next to the lifetime total.
 *
 * Trust model matches scores (arcade honesty): increments are
 * client-asserted, the server clamps each flush to a filterable cap
 * so a hostile client can't mint years of play in one request, and
 * the `desktop_mode_game_playtime_pre_record` filter is the hook for
 * stricter policies.
 *
 * @package WPDesktopMode
 * @since   0.9.7
 */

defined( 'ABSPATH' ) || exit;

/**
 * The user-meta key holding the per-game play-time map.
 *
 * @since 0.9.7
 */
define( 'DESKTOP_MODE_GAMES_PLAYTIME_META', 'desktop_mode_game_playtime' );

/**
 * The user-meta key holding the per-game DAILY play-time map:
 * `game id => array( 'YYYY-MM-DD' => seconds )`. Backs the
 * Steam-style "last two weeks" figure; days are bucketed in the
 * site's timezone and pruned past a rolling window (see
 * `desktop_mode_games_playtime_history_days`). The lifetime totals
 * in {@see DESKTOP_MODE_GAMES_PLAYTIME_META} are authoritative and
 * never pruned.
 *
 * @since 0.9.7
 */
define( 'DESKTOP_MODE_GAMES_PLAYTIME_DAYS_META', 'desktop_mode_game_playtime_days' );

/**
 * Today's daily-bucket key (`YYYY-MM-DD`, site timezone).
 *
 * @since 0.9.7
 *
 * @return string
 */
function desktop_mode_games_playtime_today_key() {
	return current_datetime()->format( 'Y-m-d' );
}

/**
 * Read a user's accumulated play time.
 *
 * @since 0.9.7
 *
 * @param int    $user_id Player.
 * @param string $game    Optional game id. Empty returns the full map.
 * @return int|array<string,int> Seconds for one game, or the whole
 *                               `game id => seconds` map.
 */
function desktop_mode_games_get_playtime( $user_id, $game = '' ) {
	$map = get_user_meta( (int) $user_id, DESKTOP_MODE_GAMES_PLAYTIME_META, true );
	if ( ! is_array( $map ) ) {
		$map = array();
	}
	$clean = array();
	foreach ( $map as $key => $seconds ) {
		$key = sanitize_key( (string) $key );
		if ( '' === $key ) {
			continue;
		}
		$clean[ $key ] = max( 0, (int) $seconds );
	}
	if ( '' !== (string) $game ) {
		$game = sanitize_key( (string) $game );
		return isset( $clean[ $game ] ) ? $clean[ $game ] : 0;
	}
	return $clean;
}

/**
 * Read a user's daily play-time buckets.
 *
 * @since 0.9.7
 *
 * @param int    $user_id Player.
 * @param string $game    Optional game id. Empty returns the full map.
 * @return array Day buckets (`'YYYY-MM-DD' => seconds`) for one game,
 *               or the whole `game id => buckets` map.
 */
function desktop_mode_games_get_playtime_daily( $user_id, $game = '' ) {
	$map = get_user_meta( (int) $user_id, DESKTOP_MODE_GAMES_PLAYTIME_DAYS_META, true );
	if ( ! is_array( $map ) ) {
		$map = array();
	}
	$clean = array();
	foreach ( $map as $key => $days ) {
		$key = sanitize_key( (string) $key );
		if ( '' === $key || ! is_array( $days ) ) {
			continue;
		}
		$clean_days = array();
		foreach ( $days as $day => $seconds ) {
			if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) $day ) ) {
				continue;
			}
			$clean_days[ (string) $day ] = max( 0, (int) $seconds );
		}
		$clean[ $key ] = $clean_days;
	}
	if ( '' !== (string) $game ) {
		$game = sanitize_key( (string) $game );
		return isset( $clean[ $game ] ) ? $clean[ $game ] : array();
	}
	return $clean;
}

/**
 * Add seconds to a user's play-time total for a game.
 *
 * @since 0.9.7
 *
 * @param string $game    Registered game id.
 * @param int    $user_id Player.
 * @param int    $seconds Seconds to add. Clamped to
 *                        `[1, desktop_mode_games_playtime_max_increment]`.
 * @return int|WP_Error The new total for the game on success.
 */
function desktop_mode_games_add_playtime( $game, $user_id, $seconds ) {
	$game    = sanitize_key( (string) $game );
	$user_id = (int) $user_id;
	$seconds = (int) $seconds;

	if ( ! desktop_mode_games_is_registered( $game ) ) {
		return new WP_Error(
			'desktop_mode_unknown_game',
			__( 'Unknown game.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( $user_id <= 0 ) {
		return new WP_Error(
			'desktop_mode_invalid_user',
			__( 'A valid user is required to record play time.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( $seconds < 1 ) {
		return new WP_Error(
			'desktop_mode_invalid_playtime',
			__( 'Play time must be a positive number of seconds.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	/**
	 * Filter the largest play-time increment accepted in one request.
	 * The framework flushes roughly once a minute, so anything far
	 * past that is either a background-throttled tab catching up or a
	 * hostile client; the clamp bounds the damage either way.
	 *
	 * @since 0.9.7
	 *
	 * @param int    $max_seconds Default 900 (15 minutes).
	 * @param string $game        Game id.
	 * @param int    $user_id     Player.
	 */
	$max     = max( 1, (int) apply_filters( 'desktop_mode_games_playtime_max_increment', 900, $game, $user_id ) );
	$seconds = min( $seconds, $max );

	/**
	 * Short-circuit / veto filter for play-time recording. Return a
	 * `WP_Error` to reject the increment (surfaced to the client), or
	 * `null` to proceed.
	 *
	 * @since 0.9.7
	 *
	 * @param null|WP_Error $pre     Null to proceed.
	 * @param string        $game    Game id.
	 * @param int           $user_id Player.
	 * @param int           $seconds Clamped increment.
	 */
	$pre = apply_filters( 'desktop_mode_game_playtime_pre_record', null, $game, $user_id, $seconds );
	if ( is_wp_error( $pre ) ) {
		return $pre;
	}

	$map          = desktop_mode_games_get_playtime( $user_id );
	$map[ $game ] = ( isset( $map[ $game ] ) ? $map[ $game ] : 0 ) + $seconds;
	update_user_meta( $user_id, DESKTOP_MODE_GAMES_PLAYTIME_META, $map );

	// Daily bucket (site timezone) for the recent-activity figure,
	// pruned to a rolling window so the meta row stays bounded. The
	// lifetime total above is the source of truth and never shrinks.
	$today = desktop_mode_games_playtime_today_key();

	/**
	 * Filter how many days of daily play-time buckets are retained.
	 * The Games hub needs 14 for its "last two weeks" figure.
	 *
	 * @since 0.9.7
	 *
	 * @param int $days Default 30.
	 */
	$window = max( 1, (int) apply_filters( 'desktop_mode_games_playtime_history_days', 30 ) );
	$cutoff = current_datetime()->modify( '-' . ( $window - 1 ) . ' days' )->format( 'Y-m-d' );

	$daily = desktop_mode_games_get_playtime_daily( $user_id );
	$days  = isset( $daily[ $game ] ) ? $daily[ $game ] : array();

	$days[ $today ] = ( isset( $days[ $today ] ) ? $days[ $today ] : 0 ) + $seconds;
	foreach ( array_keys( $days ) as $day ) {
		// `Y-m-d` sorts lexicographically, so string compare suffices.
		if ( $day < $cutoff ) {
			unset( $days[ $day ] );
		}
	}
	$daily[ $game ] = $days;
	update_user_meta( $user_id, DESKTOP_MODE_GAMES_PLAYTIME_DAYS_META, $daily );

	/**
	 * Fires after a play-time increment is recorded.
	 *
	 * @since 0.9.7
	 *
	 * @param string $game    Game id.
	 * @param int    $user_id Player.
	 * @param int    $seconds The recorded increment.
	 * @param int    $total   The user's new total for the game.
	 */
	do_action( 'desktop_mode_game_playtime_recorded', $game, $user_id, $seconds, $map[ $game ] );

	return $map[ $game ];
}
