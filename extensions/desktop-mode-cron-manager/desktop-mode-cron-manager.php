<?php
/**
 * Plugin Name:       OpenStation — Cron Manager
 * Description:       Adds a Cron Jobs native window to OpenStation for browsing, editing, deleting, and running WP-Cron events.
 * Version:           0.22.11
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            OpenStation Contributors
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       desktop-mode-cron-manager
 * Domain Path:       /languages
 *
 * @package OpenStationCronManager
 */

defined( 'ABSPATH' ) || exit;

define( 'OPEN_STATION_CRON_MANAGER_FILE', __FILE__ );
define( 'OPEN_STATION_CRON_MANAGER_DIR', plugin_dir_path( __FILE__ ) );
define( 'OPEN_STATION_CRON_MANAGER_URL', plugin_dir_url( __FILE__ ) );
define( 'OPEN_STATION_CRON_MANAGER_VERSION', '0.22.11' );

require_once OPEN_STATION_CRON_MANAGER_DIR . 'includes/store.php';
require_once OPEN_STATION_CRON_MANAGER_DIR . 'includes/rest.php';
require_once OPEN_STATION_CRON_MANAGER_DIR . 'includes/window.php';
