<?php
/**
 * Code Blue — an error-log reader, as an OpenStation app.
 *
 * This file is the window: title, size, icon, the title-bar Refresh
 * button, the ⋯-menu Clear row, the state schema, the server actions,
 * and the DATA the browser paints from. The body itself is rendered
 * in the browser by `code-blue.os.ts` — a function of that state and
 * data — so range, search, sort, legend and expand never wait for a
 * request; only reading a different source, refreshing and clearing
 * round-trip. The log model (discovery, tailing, parsing, clearing)
 * lives in `log-reader.php`.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\CodeBlue;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/log-reader.php';

/** A vitals monitor: flatline, a beat, flatline, the live cursor dot. */
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M6 34 H20 L26 16 L36 50 L42 28 L46 34 H52" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="57" cy="34" r="4.5" fill="currentColor"/></svg>';

/**
 * The source the window is showing: the state's pick when it is
 * still offered, else the first usable one (recorded in the state).
 *
 * @param State   $state   State.
 * @param array[] $sources Normalised sources.
 * @return array<string,mixed>|null
 */
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
	// Re-reading the log is the whole action; `data()` below does it.
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
