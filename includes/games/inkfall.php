<?php
/**
 * OpenStation — Inkfall registration.
 *
 * Inkfall is the built-in typing game: words fall like ink down a
 * notebook page; typing a word launches a musical note that tears
 * the word apart into scattering letters. The game code lives in
 * its own lazily-loaded bundle (`assets/js/game-inkfall[.min].js`,
 * source `src/games/inkfall/`); this file only declares the
 * discovery metadata + score columns. The shared dictionary asset
 * arrives via the framework-injected `wordsUrl` config key.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The Inkfall icon: a musical note falling onto a notebook page.
 *
 * @return string Raw `<svg>` markup.
 */
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

/**
 * Register Inkfall with the games registry on `init`.
 *
 * Priority 20 — alongside the Games window registration.
 */
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
			// Mirrors the `window` block in `src/games/inkfall/index.ts`.
			// Declared here as well so the window opens at the right
			// size on the very first play, before the bundle that
			// carries the def has been fetched. Keep the two in step.
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
		// The dictionary URL arrives via the framework-injected
		// `wordsUrl` config key (see includes/games/config.php).
		)
	);
}
add_action( 'init', 'openstation_inkfall_register', 20 );

/**
 * Ride the Inkfall window styles on the Games window as a companion.
 *
 * The game's script is lazily loaded by the framework on first
 * launch, and every launch goes through the games bundle — so a
 * sheet travelling with that bundle is in the tab before the game
 * window paints, without costing every admin page that never plays.
 *
 * @param array $window_args Args passed to `openstation_register_window()`.
 * @return array
 */
function openstation_inkfall_window_styles( $window_args ) {
	if ( ! is_array( $window_args ) ) {
		return $window_args;
	}
	$window_args['styles']   = isset( $window_args['styles'] ) ? (array) $window_args['styles'] : array();
	$window_args['styles'][] = 'os-game-inkfall';
	return $window_args;
}
add_filter( 'openstation_games_window_args', 'openstation_inkfall_window_styles' );
