<?php
/**
 * Desktop Mode — Games framework config.
 *
 * Framework-level values every game receives on its launch-context
 * `config` (merged in by the `serverGames` payload builder; a game's
 * own `config` keys win on collision):
 *
 * - `wordsUrl` — URL of the shared dictionary asset
 *                (`assets/games/words.txt`). The word list is a
 *                framework asset, not a per-game one: it is
 *                identical for every player, which is what lets
 *                seeded games generate the same puzzle worldwide.
 *
 * @package WPDesktopMode
 * @since   0.9.8
 */

defined( 'ABSPATH' ) || exit;

/**
 * URL of the shared games dictionary asset, cache-busted on content
 * change (the browser caches the ~150 KB list across sessions
 * otherwise).
 *
 * @since 0.9.8
 *
 * @return string The dictionary URL.
 */
function desktop_mode_games_words_url() {
	$words_file = DESKTOP_MODE_DIR . 'assets/games/words.txt';
	$words_url  = DESKTOP_MODE_URL . 'assets/games/words.txt';
	if ( file_exists( $words_file ) ) {
		$words_url = add_query_arg( 'ver', (string) filemtime( $words_file ), $words_url );
	}

	/**
	 * Filters the URL of the shared games dictionary asset.
	 *
	 * Seeded games generate identical puzzles worldwide only while
	 * every player resolves the same word list — swap the URL for
	 * all users (a translated list, a themed list), not per user.
	 *
	 * @since 0.9.8
	 *
	 * @param string $words_url The dictionary URL (with `ver` cache-bust).
	 */
	return (string) apply_filters( 'desktop_mode_games_words_url', $words_url );
}

/**
 * The framework-level `config` keys merged into every game's launch
 * context. A game's own `config` wins on collision.
 *
 * @since 0.9.8
 * @internal
 *
 * @return array Framework config keys.
 */
function desktop_mode_games_framework_config() {
	return array(
		'wordsUrl' => esc_url_raw( desktop_mode_games_words_url() ),
	);
}
