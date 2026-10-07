<?php

<<<'OPENSTATION_PLUGIN_METADATA'
Plugin Name:       OpenStation
Plugin URI:        https://github.com/WordPress/openstation
Description:       Renders the WordPress admin as a desktop OS. Admin screens become draggable, resizable, minimizable windows floating on a desktop with a dock. Purely opt-in per user.
Version:           1.1.12
Requires at least: 6.0
Requires PHP:      7.4
Author:            Daniel López Sánchez
Author URI:        https://github.com/allterraindeveloper
License:           GPLv2 or later
License URI:       https://www.gnu.org/licenses/gpl-2.0.html
Text Domain:       desktop-mode
Domain Path:       /languages

@package OpenStation
OPENSTATION_PLUGIN_METADATA;

defined( 'ABSPATH' ) || exit;

define( 'OPENSTATION_VERSION', '1.1.12' );
define( 'OPENSTATION_FILE', __FILE__ );
define( 'OPENSTATION_DIR', plugin_dir_path( __FILE__ ) );
define( 'OPENSTATION_URL', plugin_dir_url( __FILE__ ) );

function openstation_request_needs_admin_modules() {
	$needs = is_admin()
		|| wp_doing_cron()
		|| ( defined( 'WP_CLI' ) && WP_CLI )
		|| ( defined( 'WP_TESTS_DOMAIN' ) )
		|| ( defined( 'REST_REQUEST' ) && REST_REQUEST );

	if ( ! $needs ) {

		$rest_prefix = function_exists( 'rest_get_url_prefix' ) ? rest_get_url_prefix() : 'wp-json';
		$request_uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';

		if ( ( '' !== $rest_prefix && false !== strpos( $request_uri, '/' . $rest_prefix ) ) || isset( $_GET['rest_route'] ) ) {
			$needs = true;
		}
	}

	return (bool) apply_filters( 'openstation_load_admin_modules', $needs );
}

require_once OPENSTATION_DIR . 'includes/core/registry-factory.php';

require_once OPENSTATION_DIR . 'includes/core/routing.php';

require_once OPENSTATION_DIR . 'includes/helpers.php';

require_once OPENSTATION_DIR . 'includes/core/payload.php';
require_once OPENSTATION_DIR . 'includes/assets.php';
require_once OPENSTATION_DIR . 'includes/admin-bar.php';

require_once OPENSTATION_DIR . 'includes/workspaces.php';
require_once OPENSTATION_DIR . 'includes/session.php';
require_once OPENSTATION_DIR . 'includes/multisite.php';
require_once OPENSTATION_DIR . 'includes/presence.php';
require_once OPENSTATION_DIR . 'includes/nonce-refresh.php';
require_once OPENSTATION_DIR . 'includes/os-settings.php';
require_once OPENSTATION_DIR . 'includes/mobile.php';

require_once OPENSTATION_DIR . 'includes/about-feed.php';
require_once OPENSTATION_DIR . 'includes/seen-intros.php';

require_once OPENSTATION_DIR . 'includes/migrations.php';
require_once OPENSTATION_DIR . 'includes/portal.php';
require_once OPENSTATION_DIR . 'includes/default-window.php';

require_once OPENSTATION_DIR . 'includes/solo-window.php';

require_once OPENSTATION_DIR . 'includes/shell-screen.php';
require_once OPENSTATION_DIR . 'includes/themes-tabs.php';
require_once OPENSTATION_DIR . 'includes/media-query.php';
require_once OPENSTATION_DIR . 'includes/accents.php';
require_once OPENSTATION_DIR . 'includes/toast-types.php';
require_once OPENSTATION_DIR . 'includes/wp-icon-registry.php';
require_once OPENSTATION_DIR . 'includes/registries/native-windows.php';
require_once OPENSTATION_DIR . 'includes/registries/window-tabs.php';
require_once OPENSTATION_DIR . 'includes/registries/icons.php';
require_once OPENSTATION_DIR . 'includes/registries/wallpapers.php';
require_once OPENSTATION_DIR . 'includes/registries/widgets.php';
require_once OPENSTATION_DIR . 'includes/components.php';
require_once OPENSTATION_DIR . 'includes/commands.php';
require_once OPENSTATION_DIR . 'includes/settings-tabs.php';
require_once OPENSTATION_DIR . 'includes/dock-rail-renderer.php';
require_once OPENSTATION_DIR . 'includes/title-bar-buttons.php';
require_once OPENSTATION_DIR . 'includes/window-actions.php';
require_once OPENSTATION_DIR . 'includes/unfocus-effects.php';
require_once OPENSTATION_DIR . 'includes/window-links.php';
require_once OPENSTATION_DIR . 'includes/window-chrome.php';
require_once OPENSTATION_DIR . 'includes/window-notices.php';
require_once OPENSTATION_DIR . 'includes/wallpapers.php';
require_once OPENSTATION_DIR . 'includes/mio.php';
require_once OPENSTATION_DIR . 'includes/mio-portrait.php';
require_once OPENSTATION_DIR . 'includes/widgets/heartbeat.php';
require_once OPENSTATION_DIR . 'includes/widgets/widget-comments.php';
require_once OPENSTATION_DIR . 'includes/widgets/widget-post-stats.php';
require_once OPENSTATION_DIR . 'includes/widgets/widget-site-views.php';
require_once OPENSTATION_DIR . 'includes/widgets/widget-jazz-quote.php';
require_once OPENSTATION_DIR . 'includes/widgets/widget-starter.php';
require_once OPENSTATION_DIR . 'includes/widgets/widget-notes.php';
require_once OPENSTATION_DIR . 'includes/widgets/widget-drafts.php';
require_once OPENSTATION_DIR . 'includes/widgets/widget-focus-timer.php';
require_once OPENSTATION_DIR . 'includes/extended-options.php';
require_once OPENSTATION_DIR . 'includes/oauth-relay.php';
require_once OPENSTATION_DIR . 'includes/ai-copilot/bootstrap.php';

require_once OPENSTATION_DIR . 'includes/content-changes.php';
require_once OPENSTATION_DIR . 'includes/recycle-bin/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/desktop-files/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/desktop-themes/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/notes/bootstrap.php';

require_once OPENSTATION_DIR . 'includes/station-home/cards.php';
require_once OPENSTATION_DIR . 'includes/my-wordpress/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/content-graph/bootstrap.php';

require_once OPENSTATION_DIR . 'includes/framework/wordpress.php';
require_once OPENSTATION_DIR . 'includes/living-tree/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/games/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/agents/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/network/bootstrap.php';

require_once OPENSTATION_DIR . 'includes/first-run/bootstrap.php';

require_once OPENSTATION_DIR . 'includes/feedback/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/pwa.php';
require_once OPENSTATION_DIR . 'includes/compat/divi.php';
require_once OPENSTATION_DIR . 'includes/compat/elementor.php';

if ( openstation_request_needs_admin_modules() ) {
	require_once OPENSTATION_DIR . 'includes/ajax.php';
	require_once OPENSTATION_DIR . 'includes/welcome-dialog.php';
	require_once OPENSTATION_DIR . 'includes/update-notice.php';
	require_once OPENSTATION_DIR . 'includes/core-notices.php';
	require_once OPENSTATION_DIR . 'includes/plugin-notices.php';
	require_once OPENSTATION_DIR . 'includes/render.php';
	require_once OPENSTATION_DIR . 'includes/devtools.php';
}

function openstation_cascade_deactivate_dependents() {

	add_action( 'shutdown', 'openstation_do_cascade_deactivate', 0 );
}
register_deactivation_hook( OPENSTATION_FILE, 'openstation_cascade_deactivate_dependents' );

function openstation_do_cascade_deactivate() {
	if ( ! class_exists( 'WP_Plugin_Dependencies' ) ) {

		return;
	}

	WP_Plugin_Dependencies::initialize();

	$slug = dirname( plugin_basename( OPENSTATION_FILE ) );
	if ( '' === $slug || '.' === $slug ) {
		return;
	}

	$dependents = (array) WP_Plugin_Dependencies::get_dependents( $slug );

	$dependents = (array) apply_filters(
		'openstation_cascade_deactivate_dependents',
		$dependents,
		$slug
	);

	if ( empty( $dependents ) ) {
		return;
	}

	$active  = (array) get_option( 'active_plugins', array() );
	$targets = array_values( array_intersect( $active, $dependents ) );
	if ( empty( $targets ) ) {
		return;
	}

	if ( ! function_exists( 'deactivate_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	deactivate_plugins( $targets, true );
}
