<?php
/**
 * Plugin Name:       Desktop Mode
 * Plugin URI:        https://github.com/WordPress/desktop-mode
 * Description:       Renders the WordPress admin as a desktop OS. Admin screens become draggable, resizable, minimizable windows floating on a desktop with a dock. Purely opt-in per user.
 * Version:           0.5.1
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Daniel López Sánchez
 * Author URI:        https://github.com/WordPress/desktop-mode
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wp-desktop-mode
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

define( 'WPDM_VERSION', '0.5.1' );
define( 'WPDM_FILE', __FILE__ );
define( 'WPDM_DIR', plugin_dir_path( __FILE__ ) );
define( 'WPDM_URL', plugin_dir_url( __FILE__ ) );

require_once WPDM_DIR . 'includes/helpers.php';
require_once WPDM_DIR . 'includes/ajax.php';
require_once WPDM_DIR . 'includes/assets.php';
require_once WPDM_DIR . 'includes/admin-bar.php';
require_once WPDM_DIR . 'includes/session.php';
require_once WPDM_DIR . 'includes/os-settings.php';
require_once WPDM_DIR . 'includes/portal.php';
require_once WPDM_DIR . 'includes/default-window.php';
require_once WPDM_DIR . 'includes/media-query.php';
require_once WPDM_DIR . 'includes/menu.php';
require_once WPDM_DIR . 'includes/accents.php';
require_once WPDM_DIR . 'includes/toast-types.php';
require_once WPDM_DIR . 'includes/components.php';
require_once WPDM_DIR . 'includes/commands.php';
require_once WPDM_DIR . 'includes/settings-tabs.php';
require_once WPDM_DIR . 'includes/title-bar-buttons.php';
require_once WPDM_DIR . 'includes/wallpapers.php';
require_once WPDM_DIR . 'includes/render.php';
require_once WPDM_DIR . 'includes/extended-options.php';
require_once WPDM_DIR . 'includes/ai-copilot/bootstrap.php';
require_once WPDM_DIR . 'includes/code-editor/bootstrap.php';

/**
 * Load the plugin's translations early so strings emitted on
 * `plugins_loaded`-adjacent hooks (admin bar, enqueues, etc.) are
 * already translatable. Shipped bundles live under `languages/` as
 * `wp-desktop-mode-{locale}.{mo,l10n.php}` for PHP strings and
 * `wp-desktop-mode-{locale}-wp-desktop.json` for the JS bundle.
 *
 * `init` (not `plugins_loaded`) is the modern canonical load point
 * since WP 6.7 — loading earlier triggers a `_doing_it_wrong`
 * warning under strict setups.
 *
 * @since 0.8.0
 */
function wpdm_load_textdomain() {
	load_plugin_textdomain(
		'wp-desktop-mode',
		false,
		dirname( plugin_basename( WPDM_FILE ) ) . '/languages'
	);
}
add_action( 'init', 'wpdm_load_textdomain' );
