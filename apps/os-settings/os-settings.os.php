<?php

namespace OpenStation\Apps\OsSettings;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

const ID = 'desktop-mode-os-settings';

function gear_svg() {
	$teeth = '';
	for ( $i = 0; $i < 8; $i++ ) {
		$teeth .= sprintf(
			'<rect x="28" y="5" width="8" height="12" rx="2" fill="currentColor" transform="rotate(%d 32 32)"/>',
			45 * $i
		);
	}
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' . $teeth
		. '<circle cx="32" cy="32" r="15.5" fill="none" stroke="currentColor" stroke-width="9"/></svg>';
}

function require_admin( Os $os ) {
	if ( ! $os->can( 'manage_options' ) ) {
		throw new \RuntimeException( esc_html__( 'You are not allowed to change site-wide options.', 'desktop-mode' ) );
	}
}

function data( State $state, Os $os ) {
	$admin = $os->can( 'manage_options' );
	return array(
		'isAdmin'                => $admin,
		'canUpload'              => $os->can( 'upload_files' ),
		'canManageDesktopThemes' => function_exists( 'openstation_desktop_theme_upload_capability' )
			&& $os->can( openstation_desktop_theme_upload_capability() ),
		'extendedOptions'        => $admin && function_exists( 'openstation_get_extended_options' )
			? openstation_get_extended_options()
			: null,
		'aiAssistant'            => function_exists( 'openstation_ai_assistant_config' )
			? openstation_ai_assistant_config( $os->auth->user_id() )
			: null,
	);
}

function extended_action( State $state, Os $os, array $args ) {
	require_admin( $os );
	if ( function_exists( 'openstation_save_extended_options' ) ) {
		openstation_save_extended_options( isset( $args['options'] ) && is_array( $args['options'] ) ? $args['options'] : array() );
	}
	$os->refresh_menu();
}

function purge_shares_action( State $state, Os $os ) {
	require_admin( $os );
	if ( ! function_exists( 'openstation_files_rest_purge_sharing_tables' ) ) {
		$os->toast( __( 'Files REST endpoint is not available.', 'desktop-mode' ) );
		return;
	}
	$response = openstation_files_rest_purge_sharing_tables();
	$dropped  = $response instanceof \WP_REST_Response ? (array) $response->get_data()['dropped'] : array();
	$os->toast(
		sprintf(

			__( 'Folder sharing data deleted. (%d tables)', 'desktop-mode' ),
			count( $dropped )
		)
	);
}

return App::define( ID )

	->title( 'OpenStation Preferences' )
	->icon( gear_svg() )
	->size( 820, 720 )
	->min_size( 560, 480 )

	->placement( 'none' )

	->admin( 'any' )
	->capabilities( 'read' )

	->prefetch()

	->state( array( 'tab' => 'appearance' ) )

	->mount(
		static function ( State $state, Os $os ) {
			$tab = sanitize_key( (string) $os->param( 'tab', '' ) );
			if ( '' !== $tab ) {
				$state->set( 'tab', $tab );
			}
		}
	)
	->action( 'extended', __NAMESPACE__ . '\extended_action' )
	->action(
		'reset-intros',
		static function ( State $state, Os $os ) {
			if ( function_exists( 'openstation_clear_seen_intros' ) ) {
				openstation_clear_seen_intros( $os->auth->user_id() );
			}
		}
	)
	->action( 'purge-shares', __NAMESPACE__ . '\purge_shares_action' )

	->action( 'focus', static function () {} )
	->data( __NAMESPACE__ . '\data' )

	->config(
		array(
			'mediaUrl'         => esc_url_raw( rest_url( 'wp/v2/media' ) ),
			'desktopThemesUrl' => esc_url_raw( rest_url( 'desktop-mode/v1/desktop-themes' ) ),
			'aboutFeedUrl'     => esc_url_raw(
				add_query_arg(
					array(
						'action' => 'openstation_about_feed',
						'nonce'  => wp_create_nonce( 'openstation_about_feed' ),
					),
					admin_url( 'admin-ajax.php' )
				)
			),
			'pluginUrl'        => esc_url_raw( untrailingslashit( OPENSTATION_URL ) ),
			'pluginVersion'    => OPENSTATION_VERSION,
		)
	);
