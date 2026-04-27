<?php
/**
 * Plugin Name:       Desktop Mode
 * Plugin URI:        https://github.com/WordPress/desktop-mode
 * Description:       Renders the WordPress admin as a desktop OS. Admin screens become draggable, resizable, minimizable windows floating on a desktop with a dock. Purely opt-in per user.
 * Version:           0.5.3
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Daniel López Sánchez
 * Author URI:        https://github.com/allterraindeveloper
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       desktop-mode
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

define( 'DESKTOP_MODE_VERSION', '0.5.3' );
define( 'DESKTOP_MODE_FILE', __FILE__ );
define( 'DESKTOP_MODE_DIR', plugin_dir_path( __FILE__ ) );
define( 'DESKTOP_MODE_URL', plugin_dir_url( __FILE__ ) );

require_once DESKTOP_MODE_DIR . 'includes/helpers.php';
require_once DESKTOP_MODE_DIR . 'includes/ajax.php';
require_once DESKTOP_MODE_DIR . 'includes/assets.php';
require_once DESKTOP_MODE_DIR . 'includes/admin-bar.php';
require_once DESKTOP_MODE_DIR . 'includes/session.php';
require_once DESKTOP_MODE_DIR . 'includes/os-settings.php';
require_once DESKTOP_MODE_DIR . 'includes/portal.php';
require_once DESKTOP_MODE_DIR . 'includes/default-window.php';
require_once DESKTOP_MODE_DIR . 'includes/media-query.php';
require_once DESKTOP_MODE_DIR . 'includes/menu.php';
require_once DESKTOP_MODE_DIR . 'includes/accents.php';
require_once DESKTOP_MODE_DIR . 'includes/toast-types.php';
require_once DESKTOP_MODE_DIR . 'includes/components.php';
require_once DESKTOP_MODE_DIR . 'includes/commands.php';
require_once DESKTOP_MODE_DIR . 'includes/settings-tabs.php';
require_once DESKTOP_MODE_DIR . 'includes/title-bar-buttons.php';
require_once DESKTOP_MODE_DIR . 'includes/wallpapers.php';
require_once DESKTOP_MODE_DIR . 'includes/render.php';
require_once DESKTOP_MODE_DIR . 'includes/extended-options.php';
require_once DESKTOP_MODE_DIR . 'includes/devtools.php';
require_once DESKTOP_MODE_DIR . 'includes/ai-copilot/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/code-editor/bootstrap.php';
