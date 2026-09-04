<?php
/**
 * Plugins — the native Plugins window, as an OpenStation app.
 *
 * Claims the FROZEN id `desktop-mode-plugins` (see AGENTS.md), so the
 * URL remap for `plugins.php` / `plugin-install.php`, the nonce
 * refresh and the dock badge keep working unchanged. The window is
 * this file; the body is `plugins.os.ts`, a client view painting the
 * Installed table, the Browse gallery, the OpenStation-plugins
 * gallery and the detail flyout. The installed list is `data()` — an
 * in-process read of `/wp/v2/plugins` with every REST field the parts
 * register — and the mutations Core serves over REST (activate /
 * deactivate / delete) are server actions running that same
 * controller. Install / update / upload / browse / info / reviews
 * stay on admin-ajax (Core's handlers and `parts/ajax.php`), driven
 * from the client with the nonces shipped in `App::config()`.
 *
 * (Header kept short on purpose: Plugin Check's direct-access scan
 * reads only the first 50 raw lines, and the guard below must land
 * inside that window.)
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\Plugins;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/parts/permissions.php';
require_once __DIR__ . '/parts/rest-fields.php';
require_once __DIR__ . '/parts/updates.php';
require_once __DIR__ . '/parts/icons.php';
require_once __DIR__ . '/parts/ajax.php';
require_once __DIR__ . '/parts/reviews.php';
require_once __DIR__ . '/parts/upload.php';
require_once __DIR__ . '/parts/featured.php';

/** The window's tabs. Browse and Featured share the `install` gate. */
const TABS = array( 'installed', 'browse', 'featured' );

/**
 * Land on the tab the opener asked for (`{ tab }` in the window's
 * params — `plugin-install.php` asks for `browse`), never on one the
 * viewer cannot see. Runs on `mount` and again on `reopen`, when the
 * open window is asked to open from another URL.
 *
 * @param State $state State.
 * @param Os    $os    Host handle.
 * @return void
 */
function apply_tab( State $state, Os $os ) {
	$tab = sanitize_key( (string) $os->param( 'tab', '' ) );
	if ( '' === $tab || ! in_array( $tab, TABS, true ) ) {
		return;
	}
	$caps = openstation_plugins_window_caps();
	if ( 'installed' !== $tab && empty( $caps['install'] ) ) {
		$tab = 'installed';
	}
	$state->set( 'tab', $tab );
}

/**
 * The plugin a dispatch names, as Core's REST route wants it: the file
 * path relative to the plugins directory without the `.php` extension
 * (`akismet/akismet`), which is how `/wp/v2/plugins` itself keys rows.
 *
 * @param mixed $raw The dispatched `plugin` argument.
 * @return string '' when unusable.
 */
function plugin_path( $raw ) {
	$plugin = is_string( $raw ) ? trim( $raw ) : '';
	if ( '.php' === substr( $plugin, -4 ) ) {
		$plugin = substr( $plugin, 0, -4 );
	}
	if ( ! preg_match( '#^[A-Za-z0-9_\-]+(?:/[A-Za-z0-9_\-]+)?$#', $plugin ) ) {
		return '';
	}
	return $plugin;
}

/**
 * Whether a plugin path is OpenStation itself — deactivating or
 * deleting it leaves the shell running on a dead plugin, so the menu
 * refresh (a hidden admin-page load that would time out) is skipped;
 * the client navigates to the classic admin instead.
 *
 * @param string $plugin Plugin path without `.php`.
 * @return bool
 */
function is_self( $plugin ) {
	$self = substr( plugin_basename( OPENSTATION_FILE ), 0, -4 );
	return '' !== $self && $self === $plugin;
}

/**
 * Run one plugin mutation through Core's REST controller — the same
 * permission checks and the same row shape the browser would get.
 *
 * @param string $plugin Plugin path without `.php`.
 * @param string $status `active` | `inactive` | `delete`.
 * @return array{ok:bool,name:string,error:string}
 */
function mutate( $plugin, $status ) {
	// The screen gate, server-side. `openstation_plugins_window_caps()`
	// is what hides Delete on a network — Core's site plugins screen has
	// none, the files are the network admin's — but a super admin HOLDS
	// `delete_plugins`, so Core's controller would let a dispatch from a
	// stale client through. The admin-ajax half of the app enforces the
	// same gate in its guard; this is the REST half.
	$caps    = openstation_plugins_window_caps();
	$allowed = 'delete' === $status ? ! empty( $caps['delete'] ) : ! empty( $caps['activate'] );
	if ( ! $allowed ) {
		return array(
			'ok'    => false,
			'name'  => $plugin,
			'error' => is_multisite() && 'delete' === $status
				? __( 'Plugins are managed from the network admin on this site.', 'desktop-mode' )
				: __( 'You are not allowed to do that.', 'desktop-mode' ),
		);
	}
	if ( 'delete' === $status ) {
		$result = openstation_app_rest( 'DELETE', 'wp/v2/plugins/' . $plugin, array( 'force' => 'true' ) );
	} else {
		$result = openstation_app_rest( 'PUT', 'wp/v2/plugins/' . $plugin, array(), array( 'status' => $status ) );
	}
	$name = is_array( $result['data'] ) && ! empty( $result['data']['name'] ) ? (string) $result['data']['name'] : $plugin;
	return array(
		'ok'    => (bool) $result['ok'],
		'name'  => $name,
		'error' => (string) $result['error'],
	);
}

/**
 * A single-row mutation: the toast and the dock refresh the legacy
 * window did after the same REST call.
 *
 * @param Os                  $os     Host handle.
 * @param array<string,mixed> $args   Dispatch args (`plugin`).
 * @param string              $status `active` | `inactive` | `delete`.
 * @return void
 */
function run_single( Os $os, array $args, $status ) {
	$plugin = plugin_path( $args['plugin'] ?? '' );
	if ( '' === $plugin ) {
		$os->toast( __( 'Missing plugin.', 'desktop-mode' ) );
		return;
	}
	$result = mutate( $plugin, $status );
	if ( ! $result['ok'] ) {
		$failed = array(
			/* translators: %s: error message */
			'active'   => __( 'Activation failed: %s', 'desktop-mode' ),
			/* translators: %s: error message */
			'inactive' => __( 'Deactivation failed: %s', 'desktop-mode' ),
			/* translators: %s: error message */
			'delete'   => __( 'Delete failed: %s', 'desktop-mode' ),
		);
		$os->toast( sprintf( $failed[ $status ], $result['error'] ) );
		return;
	}
	$done = array(
		/* translators: %s: plugin name */
		'active'   => __( '%s activated.', 'desktop-mode' ),
		/* translators: %s: plugin name */
		'inactive' => __( '%s deactivated.', 'desktop-mode' ),
		/* translators: %s: plugin name */
		'delete'   => __( '%s deleted.', 'desktop-mode' ),
	);
	if ( is_self( $plugin ) && 'active' !== $status ) {
		// The client leaves for the classic admin; a menu refresh
		// would probe a plugin that is no longer there.
		return;
	}
	$os->toast( sprintf( $done[ $status ], $result['name'] ) );
	$os->refresh_menu();
}

/**
 * A bulk mutation over the selection: one request for every row, one
 * summary toast, one dock refresh — the legacy window's serial loop.
 *
 * @param Os                  $os   Host handle.
 * @param array<string,mixed> $args Dispatch args (`plugins` list, `do`).
 * @return void
 */
function run_bulk( Os $os, array $args ) {
	$verb   = isset( $args['do'] ) ? sanitize_key( (string) $args['do'] ) : '';
	$status = array(
		'activate'   => 'active',
		'deactivate' => 'inactive',
		'delete'     => 'delete',
	);
	if ( ! isset( $status[ $verb ] ) ) {
		$os->toast( __( 'Unknown bulk action.', 'desktop-mode' ) );
		return;
	}
	$plugins = array();
	foreach ( (array) ( $args['plugins'] ?? array() ) as $raw ) {
		$plugin = plugin_path( $raw );
		if ( '' !== $plugin ) {
			$plugins[] = $plugin;
		}
	}
	if ( array() === $plugins ) {
		return;
	}
	$succeeded    = 0;
	$failed       = 0;
	$self_mutated = false;
	foreach ( $plugins as $plugin ) {
		$result = mutate( $plugin, $status[ $verb ] );
		if ( $result['ok'] ) {
			++$succeeded;
			if ( 'activate' !== $verb && is_self( $plugin ) ) {
				$self_mutated = true;
			}
		} else {
			++$failed;
		}
	}
	if ( $self_mutated ) {
		return;
	}
	$nouns = array(
		'activate'   => __( 'activated', 'desktop-mode' ),
		'deactivate' => __( 'deactivated', 'desktop-mode' ),
		'delete'     => __( 'deleted', 'desktop-mode' ),
	);
	if ( 0 === $failed ) {
		/* translators: 1: count, 2: action verb (activated, deactivated, deleted) */
		$os->toast( sprintf( __( '%1$d plugin(s) %2$s.', 'desktop-mode' ), $succeeded, $nouns[ $verb ] ) );
	} else {
		/* translators: 1: success count, 2: failure count, 3: action verb */
		$os->toast( sprintf( __( '%1$d %3$s, %2$d failed.', 'desktop-mode' ), $succeeded, $failed, $nouns[ $verb ] ) );
	}
	$os->refresh_menu();
}

return App::define( 'desktop-mode-plugins' )
	->title( __( 'Plugins', 'desktop-mode' ) )
	->icon( 'dashicons-admin-plugins' )
	->size( 1180, 760 )
	->min_size( 760, 480 )
	// `'none'` — no dock or wallpaper tile from this registration. The
	// Plugins dock tile lives in WordPress's `$menu` and the JS-side
	// URL remap routes its click here when the opt-in is on. A
	// separate tile would be a duplicate entry point.
	->placement( 'none' )
	// Cap-only gate so that flipping the opt-in mid-session doesn't
	// require an F5; the opt-in is a runtime check on the JS remap.
	->can(
		static function () {
			return openstation_plugins_window_user_can_register();
		}
	)
	// The static half of the config.
	->config(
		array(
			'ajaxUrl'        => esc_url_raw( admin_url( 'admin-ajax.php' ) ),
			// OpenStation's own plugin path as Core's REST controller
			// spells it (no `.php`), so a self-deactivate is detected
			// by comparing against the row's `plugin` field.
			'selfPluginFile' => substr( plugin_basename( OPENSTATION_FILE ), 0, -4 ),
			// Where the client goes after a self-deactivate: the classic
			// Dashboard, never a reload of a possibly dead `?page=` URL.
			'adminUrl'       => esc_url_raw( admin_url() ),
		)
	)
	// The per-viewer half, resolved when the manifest is built for the
	// acting user. The client reads the nonces at call time, never from
	// a closure: the shell's nonce refresh rewrites `ajaxNonce` /
	// `updatesNonce` in place on this object when a session's roll.
	->config(
		static function () {
			return array(
				'ajaxNonce'          => wp_create_nonce( 'desktop-mode-plugins' ),
				// Core's `wp_ajax_install_plugin` / `update_plugin` /
				// `toggle_auto_updates` verify against the `'updates'`
				// action — the string Core's wp.updates client passes.
				'updatesNonce'       => wp_create_nonce( 'updates' ),
				'caps'               => openstation_plugins_window_caps(),
				// The global "Automatic Updates" column gate — computed
				// on the admin page load (it needs an admin include),
				// which is why it rides the config rather than `data()`.
				'autoUpdatesEnabled' => openstation_plugins_window_auto_updates_enabled(),
			);
		}
	)
	->state(
		array(
			'tab'    => 'installed',
			// Installed tab: status segment (`''` = all) and search.
			'status' => '',
			'search' => '',
			// Browse tab: wp.org browse segment and search query.
			'browse' => 'featured',
			'query'  => '',
		)
	)
	->mount( __NAMESPACE__ . '\apply_tab' )
	->action( 'reopen', __NAMESPACE__ . '\apply_tab' )
	// The Refresh button: a fresh wp.org check (bypassing Core's 12h
	// throttle) before `data()` re-reads the list, and the dock badge
	// repainted from the same snapshot.
	->action(
		'reload',
		static function ( State $state, Os $os ) {
			openstation_plugins_window_prime_updates_once( true );
			$os->refresh_menu();
		}
	)
	->action(
		'activate',
		static function ( State $state, Os $os, array $args ) {
			run_single( $os, $args, 'active' );
		}
	)
	->action(
		'deactivate',
		static function ( State $state, Os $os, array $args ) {
			run_single( $os, $args, 'inactive' );
		}
	)
	->action(
		'delete',
		static function ( State $state, Os $os, array $args ) {
			run_single( $os, $args, 'delete' );
		}
	)
	->action(
		'bulk',
		static function ( State $state, Os $os, array $args ) {
			run_bulk( $os, $args );
		}
	)
	->data(
		static function () {
			// Core's `/wp/v2/plugins` doesn't paginate — the whole install
			// in one read, every `openstation_*` field attached.
			$result = openstation_app_rest( 'GET', 'wp/v2/plugins', array( 'context' => 'view' ) );
			return array(
				'installed' => $result['ok'] && is_array( $result['data'] ) ? array_values( $result['data'] ) : array(),
				'error'     => $result['ok'] ? '' : (string) $result['error'],
			);
		}
	);
