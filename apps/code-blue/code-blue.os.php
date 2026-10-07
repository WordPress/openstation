<?php

namespace OpenStation\Apps\CodeBlue;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/log-reader.php';

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M6 34 H20 L26 16 L36 50 L42 28 L46 34 H52" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="57" cy="34" r="4.5" fill="currentColor"/></svg>';

function current_source( State $state, array $sources ) {
	foreach ( $sources as $source ) {
		if ( $source['id'] === $state->get( 'source' ) && usable( $source ) ) {
			return $source;
		}
	}
	foreach ( $sources as $source ) {
		if ( usable( $source ) ) {
			$state->set( 'source', $source['id'] );
			return $source;
		}
	}
	return null;
}

return App::define( 'openstation-code-blue' )
	->title( __( 'Code Blue', 'desktop-mode' ) )
	->icon( ICON )
	->size( 1060, 700 )
	->min_size( 720, 480 )
	->placement( 'none' )
	->desktop_icon( array( 'position' => 24 ) )
	->can( __NAMESPACE__ . '\\can_use' )
	->state(
		array(
			'source'   => '',
			'range'    => '24h',
			'query'    => '',
			'sort'     => 'recent',
			'hidden'   => array(),
			'expanded' => array(),
			'auto'     => false,
			'error'    => '',
		)
	)
	->title_bar_button(
		'refresh',
		array(
			'label'  => __( 'Refresh', 'desktop-mode' ),
			'icon'   => 'reload',
			'action' => 'refresh',
		)
	)
	->window_action(
		'clear',
		array(
			'label'   => __( 'Clear log', 'desktop-mode' ),
			'icon'    => 'dashicons-trash',
			'action'  => 'clear',
			'confirm' => array(
				'title'   => __( 'Clear this log?', 'desktop-mode' ),
				'message' => __( 'Every entry will be deleted from disk. This cannot be undone.', 'desktop-mode' ),
				'label'   => __( 'Clear log', 'desktop-mode' ),
				'danger'  => true,
			),
		)
	)

	->action(
		'refresh',
		static function ( State $state ) {
			$state->set( 'error', '' );
		}
	)
	->action(
		'source',
		static function ( State $state ) {
			$state->reset( 'expanded' )->set( 'error', '' );
		}
	)
	->action(
		'clear',
		static function ( State $state, Os $os ) {
			$source = current_source( $state, sources( $os ) );
			if ( ! $source ) {
				return;
			}
			$result = clear( $os, $source );
			$state->reset( 'expanded' )->set( 'error', true === $result ? '' : $result );
			if ( true === $result ) {
				$os->toast( __( 'Log cleared.', 'desktop-mode' ) );
			}
		}
	)
	->data(
		static function ( State $state, Os $os ) {
			$sources = sources( $os );
			$source  = current_source( $state, $sources );
			$read    = $source ? read( $os, $source ) : null;
			return array(
				'sources'     => $sources,
				'source'      => $source,
				'environment' => environment( $os ),
				'entries'     => $read ? $read['entries'] : array(),
				'scanned'     => $read ? $read['scanned_bytes'] : 0,
				'truncated'   => $read ? $read['truncated'] : false,
				'readError'   => $read ? $read['error'] : '',
				'now'         => time(),
				'searchUrl'   => search_url( $os ),
			);
		}
	);
