<?php
/**
 * Desktop Mode — Games bootstrap.
 *
 * Loads the game system: schema (scores + challenges tables), the
 * framework config (shared dictionary URL), the server-side
 * game registry, the score/challenge store, the play-time store,
 * REST routes, the Heartbeat challenge channel, the Games window +
 * desktop icon, and the built-in game registrations (Inkfall,
 * Alphabet Soup).
 *
 * The whole module is gated on the site-wide `games` extended option
 * (OS Settings → Features → Extended options, admins only). When the
 * option is off, none of the module files load — no tables check on
 * `init`, no REST routes, no Heartbeat channel, no window/icon — so a
 * disabled games framework costs nothing beyond the option read below.
 * For third-party plugins the disabled state is indistinguishable from
 * Desktop Mode not being active: `desktop_mode_register_game()` is
 * undefined, which the documented `function_exists()` guard already
 * handles (see docs/examples/register-game.md).
 *
 * Loading is deferred to `plugins_loaded` (priority 5) so any regular
 * plugin can hook the `desktop_mode_games_enabled` filter in time to
 * influence the decision.
 *
 * New `require_once` lines belong in the loader below so the rest of
 * the codebase keeps loading the feature through one entry point.
 *
 * @package WPDesktopMode
 * @since   0.9.6
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the games framework is enabled site-wide.
 *
 * Backed by the `games` key of the extended options bundle
 * (`desktop_mode_get_extended_options()`), default on.
 *
 * @since 0.9.8
 *
 * @return bool
 */
function desktop_mode_games_enabled() {
	$options = desktop_mode_get_extended_options();
	$enabled = ! empty( $options['games'] );

	/**
	 * Filters whether the games framework is enabled site-wide.
	 *
	 * Runs on `plugins_loaded` (priority 5) to decide whether the
	 * games module loads at all, and again at runtime wherever the
	 * enabled state is consulted (payload build, shell config).
	 *
	 * @since 0.9.8
	 *
	 * @param bool $enabled Whether the games framework is enabled.
	 */
	return (bool) apply_filters( 'desktop_mode_games_enabled', $enabled );
}

/**
 * Loads the games module when the framework is enabled.
 *
 * @since 0.9.8
 *
 * @access private
 */
function desktop_mode_games_load() {
	if ( ! desktop_mode_games_enabled() ) {
		return;
	}

	require_once DESKTOP_MODE_DIR . 'includes/games/schema.php';
	require_once DESKTOP_MODE_DIR . 'includes/games/config.php';
	require_once DESKTOP_MODE_DIR . 'includes/games/registry.php';
	require_once DESKTOP_MODE_DIR . 'includes/games/store.php';
	require_once DESKTOP_MODE_DIR . 'includes/games/playtime.php';
	require_once DESKTOP_MODE_DIR . 'includes/games/rest.php';
	require_once DESKTOP_MODE_DIR . 'includes/games/heartbeat.php';
	require_once DESKTOP_MODE_DIR . 'includes/games/window.php';
	require_once DESKTOP_MODE_DIR . 'includes/games/inkfall.php';
	require_once DESKTOP_MODE_DIR . 'includes/games/alphabet-soup.php';
}
add_action( 'plugins_loaded', 'desktop_mode_games_load', 5 );
