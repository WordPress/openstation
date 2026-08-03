<?php
/**
 * Plugin Name:       OpenStation — Popup Siege
 * Description:       Adds the Popup Siege arcade game to OpenStation, including leaderboards and score-to-beat challenges.
 * Version:           0.1.0
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            OpenStation Contributors
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       desktop-mode-popup-siege
 *
 * @package OpenStationPopupSiege
 */

defined( 'ABSPATH' ) || exit;

define( 'POPUP_SIEGE_VERSION', '0.1.0' );
define( 'POPUP_SIEGE_ASSET_VERSION', '0.7.0' );
define( 'POPUP_SIEGE_FILE', __FILE__ );
define( 'POPUP_SIEGE_DIR', plugin_dir_path( __FILE__ ) );
define( 'POPUP_SIEGE_URL', plugin_dir_url( __FILE__ ) );

require_once POPUP_SIEGE_DIR . 'includes/registration.php';
require_once POPUP_SIEGE_DIR . 'includes/score-validation.php';

add_action( 'init', 'popup_siege_register_game', 20 );
add_filter( 'open_station_game_score_pre_save', 'popup_siege_validate_score', 10, 5 );
