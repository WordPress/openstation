<?php
/**
 * Plugin Name:       Desktop Mode Beta
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
 * Text Domain:       desktop-mode-beta
 *
 * This companion plugin is distributed from the plugin's GitHub
 * releases only — it is deliberately NOT part of the desktop-mode
 * plugin nor of its WordPress.org distribution. Keeping the installer
 * out of the main plugin means (a) no self-update machinery ever ships
 * to WordPress.org, and (b) a broken branch build of Desktop Mode
 * can't take down the tool you need to switch back to stable.
 *
 * @package DesktopModeBeta
 */

defined( 'ABSPATH' ) || exit;

define( 'DESKTOP_MODE_BETA_VERSION', '0.1.0' );
define( 'DESKTOP_MODE_BETA_FILE', __FILE__ );
define( 'DESKTOP_MODE_BETA_DIR', plugin_dir_path( __FILE__ ) );
define( 'DESKTOP_MODE_BETA_URL', plugin_dir_url( __FILE__ ) );

/** Plugin file of the plugin this companion manages. */
define( 'DESKTOP_MODE_BETA_TARGET_PLUGIN', 'desktop-mode/desktop-mode.php' );

require_once DESKTOP_MODE_BETA_DIR . 'includes/github.php';
require_once DESKTOP_MODE_BETA_DIR . 'includes/installer.php';
require_once DESKTOP_MODE_BETA_DIR . 'includes/ajax.php';
require_once DESKTOP_MODE_BETA_DIR . 'includes/admin-page.php';
require_once DESKTOP_MODE_BETA_DIR . 'includes/settings-tab.php';
