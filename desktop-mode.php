<?php
/**
 * Plugin Name:       OpenStation
 * Plugin URI:        https://github.com/WordPress/openstation
 * Description:       Renders the WordPress admin as a desktop OS. Admin screens become draggable, resizable, minimizable windows floating on a desktop with a dock. Purely opt-in per user.
 * Version:           1.1.5
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Daniel López Sánchez
 * Author URI:        https://github.com/allterraindeveloper
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       desktop-mode
 * Domain Path:       /languages
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

define( 'OPENSTATION_VERSION', '1.1.5' );
define( 'OPENSTATION_FILE', __FILE__ );
define( 'OPENSTATION_DIR', plugin_dir_path( __FILE__ ) );
define( 'OPENSTATION_URL', plugin_dir_url( __FILE__ ) );

/**
 * Whether the current request needs the admin-rendering modules.
 *
 * Most of the plugin must load on every request — feature modules
 * register REST routes, record content mutations that can originate
 * on the frontend (comment submission, WooCommerce orders, plugin-
 * driven post saves), and expose `openstation_register_*()` APIs
 * that third-party plugins call from their own `init` hooks in any
 * context. But the admin *rendering* layer (shell markup, asset
 * enqueues, the chromeless bridge, admin notices, migrations, the
 * `wp_ajax_*` save handler) only ever fires on hooks that don't
 * exist outside wp-admin — so a pure frontend page view can skip
 * parsing and wiring ~6,500 lines of it.
 *
 * Anything ambiguous loads everything: admin (including admin-ajax,
 * where Heartbeat lands), REST (sniffed early — `REST_REQUEST` isn't
 * defined until `parse_request`), cron, WP-CLI, and the PHPUnit
 * environment (the test bootstrap loads the plugin outside admin
 * context but exercises the render layer directly).
 *
 * @return bool True to load the admin-rendering modules.
 */
function openstation_request_needs_admin_modules() {
	$needs = is_admin()
		|| wp_doing_cron()
		|| ( defined( 'WP_CLI' ) && WP_CLI )
		|| ( defined( 'WP_TESTS_DOMAIN' ) )
		|| ( defined( 'REST_REQUEST' ) && REST_REQUEST );

	if ( ! $needs ) {
		// Early REST sniff. False positives just load a little more
		// code (safe direction); plain-permalink REST is covered by
		// the `rest_route` query var.
		$rest_prefix = function_exists( 'rest_get_url_prefix' ) ? rest_get_url_prefix() : 'wp-json';
		$request_uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- request-shape sniff only, no data is read.
		if ( ( '' !== $rest_prefix && false !== strpos( $request_uri, '/' . $rest_prefix ) ) || isset( $_GET['rest_route'] ) ) {
			$needs = true;
		}
	}

	/**
	 * Filter whether the admin-rendering modules load on this request.
	 *
	 * Escape hatch for unusual setups — e.g. a frontend integration
	 * that internally dispatches `desktop-mode/v1` REST routes via
	 * `rest_do_request()` outside a sniffable REST request can force
	 * the full load by returning true.
	 *
	 * @param bool $needs Whether the current request loads the
	 *                    admin-rendering module set.
	 */
	return (bool) apply_filters( 'openstation_load_admin_modules', $needs );
}

// Foundation primitives — must load before anything that consumes them.
require_once OPENSTATION_DIR . 'includes/core/registry-factory.php';

// Routing helpers register filters at file-load time but call
// chromeless / classic detection helpers (still in helpers.php)
// at hook-fire time — both files load before any hook fires, so
// the order is strict-but-flexible. Routing first because it is
// the smaller, more isolated piece.
require_once OPENSTATION_DIR . 'includes/core/routing.php';

require_once OPENSTATION_DIR . 'includes/helpers.php';

// Dock + payload assembly. Loaded right after helpers.php so the
// foundational `openstation_is_enabled()` etc. exist by the time
// any payload function is invoked at hook-fire time.
require_once OPENSTATION_DIR . 'includes/core/payload.php';
require_once OPENSTATION_DIR . 'includes/assets.php';
require_once OPENSTATION_DIR . 'includes/admin-bar.php';
// Loaded before the session: `openstation_sanitize_session()` calls
// `openstation_sanitize_workspace_profile()` on every desktop it reads.
require_once OPENSTATION_DIR . 'includes/workspaces.php';
require_once OPENSTATION_DIR . 'includes/session.php';
require_once OPENSTATION_DIR . 'includes/multisite.php';
require_once OPENSTATION_DIR . 'includes/network/keys.php';
require_once OPENSTATION_DIR . 'includes/network/identity.php';
require_once OPENSTATION_DIR . 'includes/network/registry.php';
require_once OPENSTATION_DIR . 'includes/network/hub.php';
require_once OPENSTATION_DIR . 'includes/network/member.php';
require_once OPENSTATION_DIR . 'includes/presence.php';
require_once OPENSTATION_DIR . 'includes/nonce-refresh.php';
require_once OPENSTATION_DIR . 'includes/os-settings.php';
require_once OPENSTATION_DIR . 'includes/mobile.php';
// The About journal is still lazy — this file only registers its authenticated
// AJAX action. Load the registration unconditionally so alternate admin-ajax
// bootstraps cannot skip it while classifying the request shape.
require_once OPENSTATION_DIR . 'includes/about-feed.php';
require_once OPENSTATION_DIR . 'includes/seen-intros.php';
// One-time data migrations. After os-settings.php and seen-intros.php,
// whose meta-key constants and helpers the migrations call.
//
// Unconditional, unlike the rest of the admin-only set below, because
// its activation hook has to be registered on ANY request that can
// dispatch activation. `activate_plugin()` includes the plugin file and
// fires `activate_<basename>` in whatever context it was called from,
// and a programmatic activation (a Playground Blueprint, a provisioning
// script) need not look like an admin request at all. Registering the
// runner's `admin_init` hook on a frontend request costs nothing: it
// never fires there.
require_once OPENSTATION_DIR . 'includes/migrations.php';
require_once OPENSTATION_DIR . 'includes/portal.php';
require_once OPENSTATION_DIR . 'includes/default-window.php';
// Solo window rendering mode (`?openstation_solo=<id>`). Unconditional
// because `includes/render/` reads its flag, and because extensions
// (the Electron adapter) call its helpers from their own hooks.
require_once OPENSTATION_DIR . 'includes/solo-window.php';
// The shell screen (`admin.php?page=openstation`) and the one "this
// request paints the shell" predicate. Unconditional because modules
// loaded outside the admin block (PWA, native windows, desktop themes)
// gate on it.
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
// Content-changes must load before the recycle bin — the bin's
// changelog delegates into the generic recorder.
require_once OPENSTATION_DIR . 'includes/content-changes.php';
require_once OPENSTATION_DIR . 'includes/recycle-bin/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/desktop-files/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/desktop-themes/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/notes/bootstrap.php';
// Posts, Pages, Users, User Edit, Plugins and Comments are App
// Framework apps (`apps/posts/`, `apps/pages/`, `apps/users/`,
// `apps/user-edit/`, `apps/plugins/`, `apps/comments/`): each `.os.php`
// pulls in its own PHP parts (permissions, REST fields and routes,
// AJAX handlers) when the framework loads it on `init`.
// Station Home is an App Framework app (`apps/station-home/`); only
// its plugin-card registry — a public API plugins call on `init` —
// lives here, so it exists before any app loads.
require_once OPENSTATION_DIR . 'includes/station-home/cards.php';
require_once OPENSTATION_DIR . 'includes/my-wordpress/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/content-graph/bootstrap.php';
// The App Framework: `.os.php` windows under `apps/` (Code Blue lives
// there) and any directory a plugin adds. Loads after the registries
// it registers into and after the feature modules, so an app can
// hook them.
require_once OPENSTATION_DIR . 'includes/framework/wordpress.php';
require_once OPENSTATION_DIR . 'includes/living-tree/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/games/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/agents/bootstrap.php';
require_once OPENSTATION_DIR . 'includes/pwa.php';
require_once OPENSTATION_DIR . 'includes/compat/divi.php';

// Admin-rendering modules — every hook these register (`admin_init`,
// `admin_enqueue_scripts`, `in_admin_header`, `admin_head`,
// `admin_footer`, `admin_body_class`, `wp_ajax_*`) only fires inside
// wp-admin, so pure frontend page views skip them entirely. REST,
// cron, WP-CLI, admin-ajax, and the PHPUnit environment all load
// them (see openstation_request_needs_admin_modules()). Relative
// order preserved from the historical unconditional list.
if ( openstation_request_needs_admin_modules() ) {
	require_once OPENSTATION_DIR . 'includes/ajax.php';
	require_once OPENSTATION_DIR . 'includes/welcome-dialog.php';
	require_once OPENSTATION_DIR . 'includes/update-notice.php';
	require_once OPENSTATION_DIR . 'includes/core-notices.php';
	require_once OPENSTATION_DIR . 'includes/plugin-notices.php';
	require_once OPENSTATION_DIR . 'includes/render.php';
	require_once OPENSTATION_DIR . 'includes/devtools.php';
}

/**
 * Cascade-deactivate plugins that declare `Requires Plugins: desktop-mode`
 * when OpenStation itself is being deactivated.
 *
 * Without this, a third-party plugin like `os-messages` keeps
 * its `init` hook armed after OpenStation is turned off — the next
 * admin page load fires `init`, the hook calls
 * `openstation_register_window()`, and the request fatals because the
 * function lives in the plugin we just deactivated. The user lands on
 * a white screen instead of the classic admin we redirected them to.
 *
 * WordPress's plugin dependency feature (6.5+) blocks ACTIVATION of a
 * plugin whose declared `Requires Plugins` aren't all active, but it
 * does NOT auto-deactivate dependents when their requirement is
 * deactivated through any path — the user is expected to do that
 * themselves. The classic plugins.php list shows a warning; the REST
 * controller (`PUT /wp/v2/plugins/desktop-mode/openstation`) we route
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
 * cascade — e.g. add a plugin that wraps `openstation_*` calls in
 * `function_exists` guards and shouldn't be torn down with us.
 *
 * Silent deactivation (`$silent = true`) skips the dependent
 * plugins' own deactivation hooks. Those callbacks routinely call
 * `openstation_*` helpers expecting OpenStation to be wired up;
 * firing them mid-cascade can trigger the same fatal we're trying
 * to prevent. Skipping them is the safer default.
 */
function openstation_cascade_deactivate_dependents() {
	// Defer to `shutdown` so we run AFTER the outer
	// `deactivate_plugins()` has flushed its own option update.
	// Inline cascade gets clobbered by the outer's write-back.
	add_action( 'shutdown', 'openstation_do_cascade_deactivate', 0 );
}
register_deactivation_hook( OPENSTATION_FILE, 'openstation_cascade_deactivate_dependents' );

/**
 * The deferred cascade body — runs on `shutdown` after the
 * outer `deactivate_plugins()` has persisted its update.
 *
 * Split out from the `register_deactivation_hook` callback because
 * that callback must register, not execute, the cascade. See
 * {@see openstation_cascade_deactivate_dependents} for the timing
 * rationale.
 */
function openstation_do_cascade_deactivate() {
	if ( ! class_exists( 'WP_Plugin_Dependencies' ) ) {
		// Pre-6.5 — no native dependency tracking. Sites running an
		// old Core won't have dependents declared via the header
		// either; nothing to cascade.
		return;
	}

	WP_Plugin_Dependencies::initialize();

	$slug = dirname( plugin_basename( OPENSTATION_FILE ) );
	if ( '' === $slug || '.' === $slug ) {
		return;
	}

	$dependents = (array) WP_Plugin_Dependencies::get_dependents( $slug );

	/**
	 * Filter the list of plugin files to cascade-deactivate when
	 * OpenStation is deactivated. Defaults to every plugin whose
	 * `Requires Plugins` header lists our directory slug.
	 *
	 * @param string[] $dependents Plugin files (e.g. "foo/foo.php").
	 * @param string   $slug       OpenStation's directory slug.
	 */
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
