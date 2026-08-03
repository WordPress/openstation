<?php
/**
 * OpenStation — Alphabet Soup registration.
 *
 * Alphabet Soup is the built-in daily word search: a seeded letter
 * grid with hidden words to drag out of the soup. The seed is the
 * current date (`dd-mm-yyyy`), so every player worldwide gets the
 * SAME puzzle each day — Daily mode plays three relaxed waves,
 * Time Attack races a countdown on a differently-seeded pot. The
 * game code lives in its own lazily-loaded bundle
 * (`assets/js/game-alphabet-soup[.min].js`, source
 * `src/games/alphabet-soup/`); this file only declares the
 * discovery metadata + score columns. The shared dictionary asset
 * arrives via the framework-injected `wordsUrl` config key.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The Alphabet Soup icon: a steaming bowl with letter tiles afloat.
 *
 * @return string Raw `<svg>` markup.
 */
function open_station_alphabet_soup_icon_svg() {
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
		. '<path fill="#2b1d4d" d="M8 30h48a2 2 0 0 1 2 2c0 10-6 18-14 21l-1 3H21l-1-3C12 50 6 42 6 32a2 2 0 0 1 2-2z"/>'
		. '<ellipse cx="32" cy="30" rx="24" ry="5" fill="#4c3585"/>'
		. '<rect x="16" y="22" width="11" height="11" rx="2.5" fill="#ffd166" transform="rotate(-8 21.5 27.5)"/>'
		. '<rect x="30" y="24" width="10" height="10" rx="2.5" fill="#06d6a0" transform="rotate(6 35 29)"/>'
		. '<rect x="42" y="22" width="9" height="9" rx="2.5" fill="#ff6b6b" transform="rotate(-12 46.5 26.5)"/>'
		. '<path fill="#2b1d4d" d="M20 25.5l2.2-5h1.6l2.2 5h-1.7l-.3-.8h-2l-.3.8zm2.4-2h1.2l-.6-1.5z"/>'
		. '<path fill="#0b3d33" d="M33 26h2.4a1.8 1.8 0 0 1 0 3.6H33zm1.4 1.2v1.2h.9a.6.6 0 0 0 0-1.2z"/>'
		. '<path fill="#5c1a1a" d="M44.5 24.2h2.6v1.1h-1.9v.7h1.6v1h-1.6v1.2h-1.3z"/>'
		. '<path fill="none" stroke="#c77dff" stroke-width="2" stroke-linecap="round" d="M24 16c0-3 3-3 3-6M35 15c0-3 3-3 3-6"/>'
		. '</svg>';
}

/**
 * Register Alphabet Soup with the games registry on `init`.
 *
 * Priority 20 — alongside the Games window registration.
 */
function open_station_alphabet_soup_register() {
	if ( ! function_exists( 'open_station_games_user_can_use' ) || ! open_station_games_user_can_use() ) {
		return;
	}

	open_station_register_game( 'alphabet-soup', array(
		'title'         => __( 'Alphabet Soup', 'desktop-mode' ),
		'description'   => __( 'The daily word search: a seeded letter soup that is the same for every player worldwide — the seed is today’s date. Pick a pot (8×8, 12×12, or 16×16 with more words), drag across the letters to fish them out, chain streaks, and clear waves; Time Attack stirs a different pot against the clock. Your first run of each puzzle earns the shareable score card.', 'desktop-mode' ),
		'icon_svg'      => open_station_alphabet_soup_icon_svg(),
		'script'        => 'os-game-alphabet-soup',
		'score_columns' => array(
			array( 'key' => 'score',    'label' => __( 'Score', 'desktop-mode' ),    'type' => 'number' ),
			array( 'key' => 'mode',     'label' => __( 'Mode', 'desktop-mode' ),     'type' => 'text' ),
			array( 'key' => 'size',     'label' => __( 'Size', 'desktop-mode' ),     'type' => 'text' ),
			array( 'key' => 'words',    'label' => __( 'Words', 'desktop-mode' ),    'type' => 'number' ),
			array( 'key' => 'wpm',      'label' => __( 'WPM', 'desktop-mode' ),      'type' => 'number' ),
			array( 'key' => 'accuracy', 'label' => __( 'Accuracy', 'desktop-mode' ), 'type' => 'number' ),
			array( 'key' => 'streak',   'label' => __( 'Streak', 'desktop-mode' ),   'type' => 'number' ),
			array( 'key' => 'wave',     'label' => __( 'Wave', 'desktop-mode' ),     'type' => 'number' ),
			array( 'key' => 'time',     'label' => __( 'Time', 'desktop-mode' ),     'type' => 'time' ),
		),
		// The dictionary URL arrives via the framework-injected
		// `wordsUrl` config key (see includes/games/config.php).
	) );
}
add_action( 'init', 'open_station_alphabet_soup_register', 20 );

/**
 * Enqueue the Alphabet Soup window styles. The game's script is
 * lazily loaded by the framework on first launch, but its CSS is
 * tiny and must already be present when the window opens.
 */
function open_station_alphabet_soup_enqueue_styles() {
	if ( ! function_exists( 'open_station_games_user_can_use' ) || ! open_station_games_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'os-game-alphabet-soup' );
}
add_action( 'admin_enqueue_scripts', 'open_station_alphabet_soup_enqueue_styles', 30 );
