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
 * New `require_once` lines belong here so the rest of the codebase
 * keeps loading the feature through one entry point.
 *
 * @package WPDesktopMode
 * @since   0.9.6
 */

defined( 'ABSPATH' ) || exit;

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
