<?php

defined( 'ABSPATH' ) || exit;

define( 'OPENSTATION_GAMES_PLAYTIME_META', 'desktop_mode_game_playtime' );

define( 'OPENSTATION_GAMES_PLAYTIME_DAYS_META', 'desktop_mode_game_playtime_days' );

function openstation_games_playtime_today_key() {
	return current_datetime()->format( 'Y-m-d' );
}

function openstation_games_get_playtime( $user_id, $game = '' ) {
	$map = get_user_meta( (int) $user_id, OPENSTATION_GAMES_PLAYTIME_META, true );
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

function openstation_games_get_playtime_daily( $user_id, $game = '' ) {
	$map = get_user_meta( (int) $user_id, OPENSTATION_GAMES_PLAYTIME_DAYS_META, true );
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

function openstation_games_add_playtime( $game, $user_id, $seconds ) {
	$game    = sanitize_key( (string) $game );
	$user_id = (int) $user_id;
	$seconds = (int) $seconds;

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
			__( 'A valid user is required to record play time.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( $seconds < 1 ) {
		return new WP_Error(
			'openstation_invalid_playtime',
			__( 'Play time must be a positive number of seconds.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$max     = max( 1, (int) apply_filters( 'openstation_games_playtime_max_increment', 900, $game, $user_id ) );
	$seconds = min( $seconds, $max );

	$pre = apply_filters( 'openstation_game_playtime_pre_record', null, $game, $user_id, $seconds );
	if ( is_wp_error( $pre ) ) {
		return $pre;
	}

	$map          = openstation_games_get_playtime( $user_id );
	$map[ $game ] = ( isset( $map[ $game ] ) ? $map[ $game ] : 0 ) + $seconds;
	update_user_meta( $user_id, OPENSTATION_GAMES_PLAYTIME_META, $map );

	$today = openstation_games_playtime_today_key();

	$window = max( 1, (int) apply_filters( 'openstation_games_playtime_history_days', 30 ) );
	$cutoff = current_datetime()->modify( '-' . ( $window - 1 ) . ' days' )->format( 'Y-m-d' );

	$daily = openstation_games_get_playtime_daily( $user_id );
	$days  = isset( $daily[ $game ] ) ? $daily[ $game ] : array();

	$days[ $today ] = ( isset( $days[ $today ] ) ? $days[ $today ] : 0 ) + $seconds;
	foreach ( array_keys( $days ) as $day ) {

		if ( $day < $cutoff ) {
			unset( $days[ $day ] );
		}
	}
	$daily[ $game ] = $days;
	update_user_meta( $user_id, OPENSTATION_GAMES_PLAYTIME_DAYS_META, $daily );

	do_action( 'openstation_game_playtime_recorded', $game, $user_id, $seconds, $map[ $game ] );

	return $map[ $game ];
}
