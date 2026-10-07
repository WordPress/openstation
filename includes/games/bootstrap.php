<?php

defined( 'ABSPATH' ) || exit;

function openstation_games_enabled() {
	$options = openstation_get_extended_options();
	$enabled = ! empty( $options['games'] );

	return (bool) apply_filters( 'openstation_games_enabled', $enabled );
}

function openstation_games_load() {
	if ( ! openstation_games_enabled() ) {
		return;
	}

	require_once OPENSTATION_DIR . 'includes/games/schema.php';
	require_once OPENSTATION_DIR . 'includes/games/config.php';
	require_once OPENSTATION_DIR . 'includes/games/registry.php';
	require_once OPENSTATION_DIR . 'includes/games/store.php';
	require_once OPENSTATION_DIR . 'includes/games/playtime.php';
	require_once OPENSTATION_DIR . 'includes/games/rest.php';
	require_once OPENSTATION_DIR . 'includes/games/heartbeat.php';
	require_once OPENSTATION_DIR . 'includes/games/window.php';
	require_once OPENSTATION_DIR . 'includes/games/inkfall.php';
	require_once OPENSTATION_DIR . 'includes/games/alphabet-soup.php';
}
add_action( 'plugins_loaded', 'openstation_games_load', 5 );
