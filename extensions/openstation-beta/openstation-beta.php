<?php
/**
 * Plugin Name:       OpenStation Beta
 * Plugin URI:        https://github.com/WordPress/openstation
 * Description:       Test unreleased builds of OpenStation. Switch the installed OpenStation plugin to a pull-request branch build, the trunk build, or back to the latest stable release.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            Daniel López Sánchez
 * Author URI:        https://github.com/allterraindeveloper
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       openstation-beta
 */

defined( 'ABSPATH' ) || exit;

define( 'OPENSTATION_BETA_VERSION', '0.1.0' );
define( 'OPENSTATION_BETA_FILE', __FILE__ );
define( 'OPENSTATION_BETA_DIR', plugin_dir_path( __FILE__ ) );
define( 'OPENSTATION_BETA_URL', plugin_dir_url( __FILE__ ) );

define( 'OPENSTATION_BETA_TARGET_PLUGIN', 'desktop-mode/desktop-mode.php' );

require_once OPENSTATION_BETA_DIR . 'includes/github.php';
require_once OPENSTATION_BETA_DIR . 'includes/installer.php';
require_once OPENSTATION_BETA_DIR . 'includes/ajax.php';
require_once OPENSTATION_BETA_DIR . 'includes/admin-page.php';
require_once OPENSTATION_BETA_DIR . 'includes/settings-tab.php';
