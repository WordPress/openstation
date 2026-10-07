<?php

defined( 'ABSPATH' ) || exit;

function openstation_games_words_url() {
	$words_file = OPENSTATION_DIR . 'assets/games/words.txt';
	$words_url  = OPENSTATION_URL . 'assets/games/words.txt';
	if ( file_exists( $words_file ) ) {
		$words_url = add_query_arg( 'ver', (string) filemtime( $words_file ), $words_url );
	}

	return (string) apply_filters( 'openstation_games_words_url', $words_url );
}

function openstation_games_framework_config() {
	return array(
		'wordsUrl' => esc_url_raw( openstation_games_words_url() ),
	);
}
