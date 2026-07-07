<?php
/**
 * Plugin Name:       Desktop Mode
 * Plugin URI:        https://github.com/WordPress/desktop-mode
 * Description:       Renders the WordPress admin as a desktop OS. Admin screens become draggable, resizable, minimizable windows floating on a desktop with a dock. Purely opt-in per user.
 * Version:           0.9.3
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

define( 'DESKTOP_MODE_VERSION', '0.9.3' );
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
require_once DESKTOP_MODE_DIR . 'includes/nonce-refresh.php';
require_once DESKTOP_MODE_DIR . 'includes/sticky-notes/heartbeat.php';
require_once DESKTOP_MODE_DIR . 'includes/os-settings.php';
// One-time data migrations. After os-settings.php so the meta-key
// constant and save/sanitize helpers the migrations call already exist.
require_once DESKTOP_MODE_DIR . 'includes/migrations.php';
require_once DESKTOP_MODE_DIR . 'includes/seen-intros.php';
require_once DESKTOP_MODE_DIR . 'includes/welcome-dialog.php';
require_once DESKTOP_MODE_DIR . 'includes/portal.php';
require_once DESKTOP_MODE_DIR . 'includes/default-window.php';
require_once DESKTOP_MODE_DIR . 'includes/themes-tabs.php';
require_once DESKTOP_MODE_DIR . 'includes/media-query.php';
require_once DESKTOP_MODE_DIR . 'includes/accents.php';
require_once DESKTOP_MODE_DIR . 'includes/toast-types.php';
require_once DESKTOP_MODE_DIR . 'includes/registries/native-windows.php';
require_once DESKTOP_MODE_DIR . 'includes/registries/window-tabs.php';
require_once DESKTOP_MODE_DIR . 'includes/registries/icons.php';
require_once DESKTOP_MODE_DIR . 'includes/registries/wallpapers.php';
require_once DESKTOP_MODE_DIR . 'includes/registries/widgets.php';
require_once DESKTOP_MODE_DIR . 'includes/components.php';
require_once DESKTOP_MODE_DIR . 'includes/commands.php';
require_once DESKTOP_MODE_DIR . 'includes/settings-tabs.php';
require_once DESKTOP_MODE_DIR . 'includes/dock-rail-renderer.php';
require_once DESKTOP_MODE_DIR . 'includes/title-bar-buttons.php';
require_once DESKTOP_MODE_DIR . 'includes/unfocus-effects.php';
require_once DESKTOP_MODE_DIR . 'includes/window-chrome.php';
require_once DESKTOP_MODE_DIR . 'includes/window-notices.php';
require_once DESKTOP_MODE_DIR . 'includes/wallpapers.php';
require_once DESKTOP_MODE_DIR . 'includes/widgets/heartbeat.php';
require_once DESKTOP_MODE_DIR . 'includes/widgets/widget-comments.php';
require_once DESKTOP_MODE_DIR . 'includes/widgets/widget-post-stats.php';
require_once DESKTOP_MODE_DIR . 'includes/widgets/widget-site-views.php';
require_once DESKTOP_MODE_DIR . 'includes/widgets/widget-jazz-quote.php';
require_once DESKTOP_MODE_DIR . 'includes/widgets/widget-starter.php';
require_once DESKTOP_MODE_DIR . 'includes/render.php';
require_once DESKTOP_MODE_DIR . 'includes/extended-options.php';
require_once DESKTOP_MODE_DIR . 'includes/oauth-relay.php';
require_once DESKTOP_MODE_DIR . 'includes/devtools.php';
require_once DESKTOP_MODE_DIR . 'includes/ai-copilot/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/recycle-bin/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/desktop-files/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/posts-window/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/pages-window/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/users-window/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/user-edit-window/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/plugins-window/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/comments-window/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/my-wordpress/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/content-graph/bootstrap.php';
require_once DESKTOP_MODE_DIR . 'includes/pwa.php';
require_once DESKTOP_MODE_DIR . 'includes/compat/divi.php';

/**
 * Cascade-deactivate plugins that declare `Requires Plugins: desktop-mode`
 * when Desktop Mode itself is being deactivated.
 *
 * Without this, a third-party plugin like `wp-desktop-messages` keeps
 * its `init` hook armed after Desktop Mode is turned off — the next
 * admin page load fires `init`, the hook calls
 * `desktop_mode_register_window()`, and the request fatals because the
 * function lives in the plugin we just deactivated. The user lands on
 * a white screen instead of the classic admin we redirected them to.
 *
 * WordPress's plugin dependency feature (6.5+) blocks ACTIVATION of a
 * plugin whose declared `Requires Plugins` aren't all active, but it
 * does NOT auto-deactivate dependents when their requirement is
 * deactivated through any path — the user is expected to do that
 * themselves. The classic plugins.php list shows a warning; the REST
 * controller (`PUT /wp/v2/plugins/desktop-mode/desktop-mode`) we route
 * through has no such gate. So we cascade ourselves.
 *
 * Timing: `deactivate_plugins()` writes `active_plugins` to the DB
 * AFTER its hook loop finishes. If we call `deactivate_plugins()`
 * from inside our `register_deactivation_hook` callback, our nested
 * write-back is overwritten the moment the outer call runs its own
 * `update_option`. So we register the cascade to fire on
 * `shutdown` — by then the outer `deactivate_plugins` has finished
 * and our write-back sticks.
 *
 * Matching uses `WP_Plugin_Dependencies::get_dependents()` keyed on
 * our own directory slug (`dirname( plugin_basename( __FILE__ ) )`),
 * which is the same string the dependent's `Requires Plugins` header
 * resolves against. The filter below lets sites widen or narrow the
 * cascade — e.g. add a plugin that wraps `desktop_mode_*` calls in
 * `function_exists` guards and shouldn't be torn down with us.
 *
 * Silent deactivation (`$silent = true`) skips the dependent
 * plugins' own deactivation hooks. Those callbacks routinely call
 * `desktop_mode_*` helpers expecting Desktop Mode to be wired up;
 * firing them mid-cascade can trigger the same fatal we're trying
 * to prevent. Skipping them is the safer default.
 *
 * @since 0.8.2
 */
function desktop_mode_cascade_deactivate_dependents() {
	// Defer to `shutdown` so we run AFTER the outer
	// `deactivate_plugins()` has flushed its own option update.
	// Inline cascade gets clobbered by the outer's write-back.
	add_action( 'shutdown', 'desktop_mode_do_cascade_deactivate', 0 );
}
register_deactivation_hook( DESKTOP_MODE_FILE, 'desktop_mode_cascade_deactivate_dependents' );

/**
 * The deferred cascade body — runs on `shutdown` after the
 * outer `deactivate_plugins()` has persisted its update.
 *
 * Split out from the `register_deactivation_hook` callback because
 * that callback must register, not execute, the cascade. See
 * {@see desktop_mode_cascade_deactivate_dependents} for the timing
 * rationale.
 *
 * @since 0.8.2
 */
function desktop_mode_do_cascade_deactivate() {
	if ( ! class_exists( 'WP_Plugin_Dependencies' ) ) {
		// Pre-6.5 — no native dependency tracking. Sites running an
		// old Core won't have dependents declared via the header
		// either; nothing to cascade.
		return;
	}

	WP_Plugin_Dependencies::initialize();

	$slug = dirname( plugin_basename( DESKTOP_MODE_FILE ) );
	if ( '' === $slug || '.' === $slug ) {
		return;
	}

	$dependents = (array) WP_Plugin_Dependencies::get_dependents( $slug );

	/**
	 * Filter the list of plugin files to cascade-deactivate when
	 * Desktop Mode is deactivated. Defaults to every plugin whose
	 * `Requires Plugins` header lists our directory slug.
	 *
	 * @since 0.8.2
	 *
	 * @param string[] $dependents Plugin files (e.g. "foo/foo.php").
	 * @param string   $slug       Desktop Mode's directory slug.
	 */
	$dependents = (array) apply_filters(
		'desktop_mode_cascade_deactivate_dependents',
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
