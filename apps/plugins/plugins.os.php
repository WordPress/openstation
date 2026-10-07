<?php

namespace OpenStation\Apps\Plugins;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/parts/view-preference.php';
require_once __DIR__ . '/parts/permissions.php';
require_once __DIR__ . '/parts/rest-fields.php';
require_once __DIR__ . '/parts/updates.php';
require_once __DIR__ . '/parts/icons.php';
require_once __DIR__ . '/parts/ajax.php';
require_once __DIR__ . '/parts/reviews.php';
require_once __DIR__ . '/parts/upload.php';
require_once __DIR__ . '/parts/featured.php';

const TABS = array( 'installed', 'browse', 'featured' );

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

function is_self( $plugin ) {
	$self = substr( plugin_basename( OPENSTATION_FILE ), 0, -4 );
	return '' !== $self && $self === $plugin;
}

function mutate( $plugin, $status ) {

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

function run_single( Os $os, array $args, $status ) {
	$plugin = plugin_path( $args['plugin'] ?? '' );
	if ( '' === $plugin ) {
		$os->toast( __( 'Missing plugin.', 'desktop-mode' ) );
		return;
	}
	$result = mutate( $plugin, $status );
	if ( ! $result['ok'] ) {
		$failed = array(

			'active'   => __( 'Activation failed: %s', 'desktop-mode' ),

			'inactive' => __( 'Deactivation failed: %s', 'desktop-mode' ),

			'delete'   => __( 'Delete failed: %s', 'desktop-mode' ),
		);
		$os->toast( sprintf( $failed[ $status ], $result['error'] ) );
		return;
	}
	$done = array(

		'active'   => __( '%s activated.', 'desktop-mode' ),

		'inactive' => __( '%s deactivated.', 'desktop-mode' ),

		'delete'   => __( '%s deleted.', 'desktop-mode' ),
	);
	if ( is_self( $plugin ) && 'active' !== $status ) {

		return;
	}
	$os->toast( sprintf( $done[ $status ], $result['name'] ) );
	$os->refresh_menu();
}

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

		$os->toast( sprintf( __( '%1$d plugin(s) %2$s.', 'desktop-mode' ), $succeeded, $nouns[ $verb ] ) );
	} else {

		$os->toast( sprintf( __( '%1$d %3$s, %2$d failed.', 'desktop-mode' ), $succeeded, $failed, $nouns[ $verb ] ) );
	}
	$os->refresh_menu();
}

return App::define( 'desktop-mode-plugins' )
	->title( __( 'Plugins', 'desktop-mode' ) )
	->icon( 'dashicons-admin-plugins' )
	->size( 1180, 760 )
	->min_size( 760, 480 )

	->placement( 'none' )

	->can(
		static function () {
			return openstation_plugins_window_user_can_register();
		}
	)

	->config(
		array(
			'ajaxUrl'        => esc_url_raw( admin_url( 'admin-ajax.php' ) ),

			'selfPluginFile' => substr( plugin_basename( OPENSTATION_FILE ), 0, -4 ),

			'adminUrl'       => esc_url_raw( admin_url() ),
		)
	)

	->config(
		static function () {
			return array(
				'ajaxNonce'          => wp_create_nonce( 'desktop-mode-plugins' ),

				'updatesNonce'       => wp_create_nonce( 'updates' ),
				'caps'               => openstation_plugins_window_caps(),

				'autoUpdatesEnabled' => openstation_plugins_window_auto_updates_enabled(),

				'deactivationFeedback' => openstation_deactivation_feedback_app_config(),

				'editorUrl'          => openstation_plugins_window_editor_url(),
			);
		}
	)

	->menu(
		'plugins.php',
		static function () {
			$caps = openstation_plugins_window_caps();
			$tabs = array(
				'installed' => array(
					'label' => __( 'Installed', 'desktop-mode' ),
					'page'  => 'plugins.php',
				),
			);
			if ( ! empty( $caps['install'] ) ) {
				$tabs['browse']   = array(
					'label' => __( 'Add Plugin', 'desktop-mode' ),
					'page'  => 'plugin-install.php',
				);
				$tabs['featured'] = __( 'OpenStation plugins', 'desktop-mode' );
			}
			return $tabs;
		},
		'openstation_plugins_window_user_can_use'
	)
	->state(
		array(
			'tab'           => 'installed',
			'installedView' => 'cards',

			'status'        => '',
			'search'        => '',

			'browse'        => 'featured',
			'query'         => '',
		)
	)
	->mount( __NAMESPACE__ . '\mount_plugins' )
	->action( 'save_view', __NAMESPACE__ . '\save_installed_view' )
	->action( 'reopen', __NAMESPACE__ . '\apply_tab' )

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

			$result = openstation_app_rest( 'GET', 'wp/v2/plugins', array( 'context' => 'view' ) );
			return array(
				'installed' => $result['ok'] && is_array( $result['data'] ) ? array_values( $result['data'] ) : array(),
				'error'     => $result['ok'] ? '' : (string) $result['error'],
			);
		}
	);
