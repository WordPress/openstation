<?php
/**
 * Plugin Name:       Desktop Mode — Remove Background
 * Description:       Registers a media-tools/remove-background ability so Desktop Mode agents (or any Abilities API consumer) can remove the background from a media library image. Pluggable backends: remove.bg, a self-hosted rembg server, or the WordPress AI Client.
 * Version:           0.1.0
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            Desktop Mode Contributors
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       desktop-mode-remove-background
 *
 * @package DesktopModeRemoveBackground
 */

defined( 'ABSPATH' ) || exit;

define( 'DESKTOP_MODE_REMOVE_BG_FILE', __FILE__ );
define( 'DESKTOP_MODE_REMOVE_BG_DIR', plugin_dir_path( __FILE__ ) );
define( 'DESKTOP_MODE_REMOVE_BG_VERSION', '0.1.0' );

require_once DESKTOP_MODE_REMOVE_BG_DIR . 'includes/settings.php';
require_once DESKTOP_MODE_REMOVE_BG_DIR . 'includes/backends.php';
require_once DESKTOP_MODE_REMOVE_BG_DIR . 'includes/ability.php';
