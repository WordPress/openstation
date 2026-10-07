<?php

defined( 'ABSPATH' ) || exit;

function openstation_inkfall_icon_svg() {
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
		. '<rect x="8" y="6" width="48" height="52" rx="6" fill="#f7f3e8"/>'
		. '<line x1="8" y1="20" x2="56" y2="20" stroke="#bcd4e6" stroke-width="2"/>'
		. '<line x1="8" y1="32" x2="56" y2="32" stroke="#bcd4e6" stroke-width="2"/>'
		. '<line x1="8" y1="44" x2="56" y2="44" stroke="#bcd4e6" stroke-width="2"/>'
		. '<line x1="18" y1="6" x2="18" y2="58" stroke="#e8a1a1" stroke-width="2"/>'
		. '<path fill="#2b3a55" d="M40 14v18.6a7 7 0 1 0 3 5.7V22l8 2v-6l-11-4z"/>'
		. '</svg>';
}

function openstation_inkfall_register() {
	if ( ! function_exists( 'openstation_games_user_can_use' ) || ! openstation_games_user_can_use() ) {
		return;
	}

	openstation_register_game(
		'inkfall',
		array(
			'title'         => __( 'Inkfall', 'desktop-mode' ),
			'description'   => __( 'Words fall down a notebook page — type them before they reach the bottom. Finishing a word sends up a musical note that tears it into scattering letters.', 'desktop-mode' ),
			'icon_svg'      => openstation_inkfall_icon_svg(),
			'script'        => 'os-game-inkfall',

			'window'        => array(
				'width'     => 820,
				'height'    => 620,
				'minWidth'  => 520,
				'minHeight' => 420,
			),
			'score_columns' => array(
				array(
					'key'   => 'score',
					'label' => __( 'Score', 'desktop-mode' ),
					'type'  => 'number',
				),
				array(
					'key'   => 'mode',
					'label' => __( 'Difficulty', 'desktop-mode' ),
					'type'  => 'text',
				),
				array(
					'key'   => 'words',
					'label' => __( 'Words', 'desktop-mode' ),
					'type'  => 'number',
				),
				array(
					'key'   => 'wpm',
					'label' => __( 'WPM', 'desktop-mode' ),
					'type'  => 'number',
				),
				array(
					'key'   => 'accuracy',
					'label' => __( 'Accuracy', 'desktop-mode' ),
					'type'  => 'number',
				),
				array(
					'key'   => 'time',
					'label' => __( 'Time', 'desktop-mode' ),
					'type'  => 'time',
				),
				array(
					'key'   => 'level',
					'label' => __( 'Level', 'desktop-mode' ),
					'type'  => 'number',
				),
			),

		)
	);
}
add_action( 'init', 'openstation_inkfall_register', 20 );

function openstation_inkfall_window_styles( $window_args ) {
	if ( ! is_array( $window_args ) ) {
		return $window_args;
	}
	$window_args['styles']   = isset( $window_args['styles'] ) ? (array) $window_args['styles'] : array();
	$window_args['styles'][] = 'os-game-inkfall';
	return $window_args;
}
add_filter( 'openstation_games_window_args', 'openstation_inkfall_window_styles' );
