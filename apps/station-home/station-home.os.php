<?php

namespace OpenStation\Apps\StationHome;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/parts/snapshot.php';
require_once __DIR__ . '/parts/view.php';

const APP_ID = 'desktop-mode-dashboard';

return App::define( APP_ID )
	->title( __( 'Station Home', 'desktop-mode' ) )
	->icon( 'dashicons-dashboard' )
	->size( 1240, 760 )
	->min_size( 640, 480 )

	->placement( 'none' )
	->capabilities( 'read' )

	->state( array( 'customizing' => false ) )
	->action(
		'customize',
		static function ( State $state ) {
			$state->set( 'customizing', true );
		}
	)
	->action(
		'customize_close',
		static function ( State $state ) {
			$state->set( 'customizing', false );
		}
	)

	->action(
		'toggle_card',
		static function ( State $state, Os $os, array $args ) {
			$stored = openstation_station_home_set_card_preference(
				$os->auth->user_id(),
				isset( $args['id'] ) ? (string) $args['id'] : '',
				! empty( $args['checked'] )
			);
			if ( ! $stored ) {
				$os->toast( __( 'That Station Home card is not available.', 'desktop-mode' ) );
			}
		}
	)

	->action(
		'launch',
		static function ( State $state, Os $os, array $args ) {
			$id = isset( $args['id'] ) ? sanitize_key( (string) $args['id'] ) : '';
			foreach ( quick_actions( $os ) as $action ) {
				if ( $action['id'] !== $id ) {
					continue;
				}
				if ( 'native' === $action['kind'] && ! empty( $action['windowId'] ) ) {
					$os->open( $action['windowId'] );
				} elseif ( 'classic' === $action['kind'] ) {
					$os->open_url( $action['url'], $action['label'], $action['icon'] );
				}
				return;
			}
		}
	)

	->action(
		'show',
		static function () {

		}
	)

	->watch( '*' )
	->view( __NAMESPACE__ . '\\render' );
