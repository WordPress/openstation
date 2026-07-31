<?php
/**
 * Plugin Name:       Desktop Mode — SOL Inbound Monologue
 * Description:       Syndicated Open Links presented as an inbound-only RSS and Atom buddy list.
 * Version:           0.1.0
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            Desktop Mode Contributors
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       desktop-mode-feed-buddy
 * Domain Path:       /languages
 *
 * @package DesktopModeFeedBuddy
 */

defined( 'ABSPATH' ) || exit;

define( 'FEED_BUDDY_VERSION', '0.1.0' );
define( 'FEED_BUDDY_FILE', __FILE__ );
define( 'FEED_BUDDY_DIR', plugin_dir_path( __FILE__ ) );
define( 'FEED_BUDDY_URL', plugin_dir_url( __FILE__ ) );

require_once FEED_BUDDY_DIR . 'includes/class-feed-buddy-service.php';
require_once FEED_BUDDY_DIR . 'includes/class-feed-buddy-rest-controller.php';
require_once FEED_BUDDY_DIR . 'includes/registration.php';

$feed_buddy_service = new Feed_Buddy_Service();
( new Feed_Buddy_REST_Controller( $feed_buddy_service ) )->boot();

add_action( 'plugins_loaded', 'feed_buddy_maybe_boot_ui', 20 );
