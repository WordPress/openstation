<?php
/**
 * Desktop Mode — Inkfall registration.
 *
 * Inkfall is the built-in typing game: words fall like ink down a
 * notebook page; typing a word launches a musical note that tears
 * the word apart into scattering letters. The game code lives in
 * its own lazily-loaded bundle (`assets/js/game-inkfall[.min].js`,
 * source `src/games/inkfall/`); this file only declares the
 * discovery metadata + score columns. The shared dictionary asset
 * arrives via the framework-injected `wordsUrl` config key.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * The Inkfall icon: a musical note falling onto a notebook page.
 *
 * @return string Raw `<svg>` markup.
 */
function desktop_mode_inkfall_icon_svg() {
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
function desktop_mode_inkfall_register() {
	if ( ! function_exists( 'desktop_mode_games_user_can_use' ) || ! desktop_mode_games_user_can_use() ) {
		return;
	}

	desktop_mode_register_game( 'inkfall', array(
		'title'         => __( 'Inkfall', 'desktop-mode' ),
		'description'   => __( 'Words fall down a notebook page — type them before they reach the bottom. Finishing a word sends up a musical note that tears it into scattering letters.', 'desktop-mode' ),
		'icon_svg'      => desktop_mode_inkfall_icon_svg(),
		'script'        => 'desktop-mode-game-inkfall',
		'score_columns' => array(
			array( 'key' => 'score',    'label' => __( 'Score', 'desktop-mode' ),      'type' => 'number' ),
			array( 'key' => 'mode',     'label' => __( 'Difficulty', 'desktop-mode' ), 'type' => 'text' ),
			array( 'key' => 'words',    'label' => __( 'Words', 'desktop-mode' ),      'type' => 'number' ),
			array( 'key' => 'wpm',      'label' => __( 'WPM', 'desktop-mode' ),        'type' => 'number' ),
			array( 'key' => 'accuracy', 'label' => __( 'Accuracy', 'desktop-mode' ),   'type' => 'number' ),
			array( 'key' => 'time',     'label' => __( 'Time', 'desktop-mode' ),       'type' => 'time' ),
			array( 'key' => 'level',    'label' => __( 'Level', 'desktop-mode' ),      'type' => 'number' ),
		),
		// The dictionary URL arrives via the framework-injected
		// `wordsUrl` config key (see includes/games/config.php).
	) );
}
add_action( 'init', 'desktop_mode_inkfall_register', 20 );

/**
 * Enqueue the Inkfall window styles. The game's script is lazily
 * loaded by the framework on first launch, but its CSS is tiny and
 * must already be present when the window opens.
 */
function desktop_mode_inkfall_enqueue_styles() {
	if ( ! function_exists( 'desktop_mode_games_user_can_use' ) || ! desktop_mode_games_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-game-inkfall' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_inkfall_enqueue_styles', 30 );
