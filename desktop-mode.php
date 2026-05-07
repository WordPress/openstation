<?php
/**
 * Plugin Name:       Desktop Mode
 * Plugin URI:        https://github.com/WordPress/desktop-mode
 * Description:       Renders the WordPress admin as a desktop OS. Admin screens become draggable, resizable, minimizable windows floating on a desktop with a dock. Purely opt-in per user.
 * Version:           0.8.0
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

define( 'DESKTOP_MODE_VERSION', '0.8.0' );
define( 'DESKTOP_MODE_FILE', __FILE__ );
define( 'DESKTOP_MODE_DIR', plugin_dir_path( __FILE__ ) );
define( 'DESKTOP_MODE_URL', plugin_dir_url( __FILE__ ) );

// Foundation primitives — must load before anything that consumes them.
require_once DESKTOP_MODE_DIR . 'includes/core/registry-factory.php';

// Routing helpers register filters at file-load time but call
// chromeless / classic detection helpers (still in helpers.php)
// at hook-fire time — both files load before any hook fires, so
// the order is strict-but-flexible. Routing first because it is
// the smaller, more isolated piece.
require_once DESKTOP_MODE_DIR . 'includes/core/routing.php';

require_once DESKTOP_MODE_DIR . 'includes/helpers.php';

// Dock + payload assembly. Loaded right after helpers.php so the
// foundational `desktop_mode_is_enabled()` etc. exist by the time
// any payload function is invoked at hook-fire time.
require_once DESKTOP_MODE_DIR . 'includes/core/payload.php';
require_once DESKTOP_MODE_DIR . 'includes/ajax.php';
require_once DESKTOP_MODE_DIR . 'includes/assets.php';
require_once DESKTOP_MODE_DIR . 'includes/admin-bar.php';
require_once DESKTOP_MODE_DIR . 'includes/session.php';
require_once DESKTOP_MODE_DIR . 'includes/presence.php';
require_once DESKTOP_MODE_DIR . 'includes/os-settings.php';
require_once DESKTOP_MODE_DIR . 'includes/seen-intros.php';
require_once DESKTOP_MODE_DIR . 'includes/portal.php';
require_once DESKTOP_MODE_DIR . 'includes/default-window.php';
require_once DESKTOP_MODE_DIR . 'includes/media-query.php';
require_once DESKTOP_MODE_DIR . 'includes/accents.php';
require_once DESKTOP_MODE_DIR . 'includes/toast-types.php';
require_once DESKTOP_MODE_DIR . 'includes/components.php';
require_once DESKTOP_MODE_DIR . 'includes/commands.php';
require_once DESKTOP_MODE_DIR . 'includes/settings-tabs.php';
require_once DESKTOP_MODE_DIR . 'includes/dock-rail-renderer.php';
require_once DESKTOP_MODE_DIR . 'includes/title-bar-buttons.php';
require_once DESKTOP_MODE_DIR . 'includes/window-chrome.php';
require_once DESKTOP_MODE_DIR . 'includes/wallpapers.php';
require_once DESKTOP_MODE_DIR . 'includes/render.php';
require_once DESKTOP_MODE_DIR . 'includes/extended-options.php';
require_once DESKTOP_MODE_DIR . 'includes/devtools.php';
require_once DESKTOP_MODE_DIR . 'includes/ai-copilot/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/recycle-bin/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/desktop-files/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/posts-window/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/my-wordpress/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/pwa.php';
