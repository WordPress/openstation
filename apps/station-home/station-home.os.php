<?php
/**
 * Station Home — the native Dashboard, as an OpenStation app.
 *
 * THE Station Home: the App Framework rebuild replaced the legacy
 * native window whole and claims its id — `desktop-mode-dashboard` is
 * the id the shell's Dashboard URL remap opens (`src/desktop.ts`), so
 * every `index.php` menu entry, portal fallback, bookmark and saved
 * session keeps working unchanged. The window is this file; the body
 * is a SERVER view (`parts/view.php`) painted from the snapshot model
 * (`parts/snapshot.php`) — the first app with no client half at all.
 * The plugin-card registry (`includes/station-home/cards.php`) is
 * untouched: same registration API, same preference meta, same hooks.
 *
 * What the framework replaced: the window registration and template,
 * the two REST routes and the bundle's fetch/paint choreography
 * (`refresh` is the built-in; Customize is one state key; a switch is
 * an action), the imperative click delegates (a quick action is a
 * link, or a button dispatching `launch`), and the restore-time
 * reload (`show`).
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\StationHome;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/parts/snapshot.php';
require_once __DIR__ . '/parts/view.php';

/** The window id the Dashboard URL remap opens. */
const APP_ID = 'desktop-mode-dashboard';

return App::define( APP_ID )
	->title( __( 'Station Home', 'desktop-mode' ) )
	->icon( 'dashicons-dashboard' )
	->size( 1240, 760 )
	->min_size( 640, 480 )
	// No dock tile of its own: the Dashboard entry the shell already
	// has opens it through the URL remap, per-user opt-in and all.
	->placement( 'none' )
	->capabilities( 'read' )
	// The only state: whether the Customize picker is open. Everything
	// else is derived from the snapshot on every render.
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
	// A picker switch: store the choice, and the re-render adds or
	// removes the card in the same paint that settles the switch. An
	// id that is not registered for this user is refused.
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
	// A quick action that is not a link: the WP Explorer app, or the
	// classic Dashboard in an iframe window. Resolved against the
	// capability-gated list, so a button the user was never shown
	// launches nothing.
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
	// Lifecycle: a restored window repaints itself — the legacy
	// bundle's `onShow` reload. Declaring the handler is the whole
	// point; there is nothing to run before the re-render.
	->action(
		'show',
		static function () {
			// The re-render that follows every action is the refresh.
		}
	)
	// Anything published, trashed or moderated anywhere on the desktop
	// repaints Continue working, the instruments and the queue.
	->watch( '*' )
	->view( __NAMESPACE__ . '\\render' );
