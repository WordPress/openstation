<?php
/**
 * Plugin Name:       OpenStation — phpMyAdmin
 * Description:       Adds a phpMyAdmin native window to OpenStation, embedding a bundled phpMyAdmin install. Local environments only; gated by manage_options.
 * Version:           0.19.0
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            OpenStation Contributors
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       desktop-mode-phpmyadmin
 * Domain Path:       /languages
 */

defined( 'ABSPATH' ) || exit;

define( 'OPENSTATION_PHPMYADMIN_FILE', __FILE__ );
define( 'OPENSTATION_PHPMYADMIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'OPENSTATION_PHPMYADMIN_URL', plugin_dir_url( __FILE__ ) );
define( 'OPENSTATION_PHPMYADMIN_VERSION', '0.19.0' );

require_once OPENSTATION_PHPMYADMIN_DIR . 'includes/window.php';
