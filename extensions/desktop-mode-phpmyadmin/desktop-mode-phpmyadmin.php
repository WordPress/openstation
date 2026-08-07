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
 *
 * Embeds a bundled phpMyAdmin install (~5.2.x) as a built-in app:
 * registered as a native desktop window (`wpdc-phpmyadmin`), pinned to
 * the bottom taskbar, with a matching wallpaper icon.
 *
 * Hard constraints — fail-closed if any of these aren't met:
 *
 *   1. `wp_get_environment_type() === 'local'`. phpMyAdmin runs with
 *      `auth_type=config`, reusing the WordPress DB credentials, so any
 *      visitor that finds the URL gets full DB access. We refuse to
 *      register the shortcut on production / staging environments.
 *   2. `current_user_can( 'manage_options' )`. Hides the shortcut from
 *      lower-privilege users — does NOT gate the underlying URL, which
 *      is why constraint #1 above also matters.
 *   3. `assets/vendor/phpmyadmin/index.php` exists. The vendor
 *      distribution ships with the plugin; the gate is defensive in
 *      case it's been removed.
 *
 * @package OpenStationPhpMyAdmin
 */

defined( 'ABSPATH' ) || exit;

define( 'OPENSTATION_PHPMYADMIN_FILE', __FILE__ );
define( 'OPENSTATION_PHPMYADMIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'OPENSTATION_PHPMYADMIN_URL', plugin_dir_url( __FILE__ ) );
define( 'OPENSTATION_PHPMYADMIN_VERSION', '0.19.0' );

require_once OPENSTATION_PHPMYADMIN_DIR . 'includes/window.php';
