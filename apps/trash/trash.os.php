<?php
/**
 * Trash — the Recycle Bin, as an OpenStation app.
 *
 * The 1:1 App Framework port of the legacy `desktop-mode-recycle-bin`
 * native window, which stays installed beside it for comparison. The
 * window is this file; the body is `trash.os.ts`, a client view that
 * paints the same toolbar, `<os-table>` and empty state through the
 * SAME cell renderers the legacy bin uses
 * (`src/recycle-bin/table-visuals.ts`), so the two are
 * pixel-identical by construction. All data and mutations run
 * through the legacy store (`includes/recycle-bin/store.php`) — one
 * trash, two windows.
 *
 * What the framework replaces: the REST routes (actions + `data()`),
 * the localized config blob (`ctx.fetch` + the dispatch wire), the
 * broadcast subscriptions (`watch( '*' )`), and the imperative
 * toolbar wiring (the view is a function of state).
 *
 * (Header kept short on purpose: Plugin Check's direct-access scan
 * reads only the first 50 raw lines, and the guard below must land
 * inside that window.)
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\Trash;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * Normalise the dispatched `items` argument into `{id, type}` refs.
 *
 * @param array<string,mixed> $args Action args.
 * @return array<int,array{id:int,type:string}>
 */
function refs( array $args ) {
	$out = array();
	foreach ( (array) ( $args['items'] ?? array() ) as $entry ) {
		if ( ! is_array( $entry ) ) {
			continue;
		}
		$id = isset( $entry['id'] ) ? (int) $entry['id'] : 0;
		if ( $id <= 0 ) {
			continue;
		}
		$out[] = array(
			'id'   => $id,
			'type' => isset( $entry['type'] ) ? sanitize_key( (string) $entry['type'] ) : '',
		);
	}
	return $out;
}

/**
 * Run one of the store's bulk callbacks over the dispatched refs,
 * announce the content change per affected type (the same
 * `os.<type>.changed` broadcasts the legacy bin emits, which is also
 * what repaints iframes and the legacy window), and surface errors
 * as a toast — the legacy bin only logged them to the console.
 *
 * @param Os                                   $os       Host handle.
 * @param array<int,array{id:int,type:string}> $items    Refs.
 * @param callable                             $callback Store bulk callback.
 * @param string                               $action   `untrashed` | `deleted`.
 * @return void
 */
function run_bulk( Os $os, array $items, $callback, $action ) {
	if ( array() === $items ) {
		return;
	}
	$result = openstation_recycle_bin_apply_bulk( $items, $callback );
	$ok     = array_map( 'intval', (array) $result['ok'] );
	if ( array() !== $ok ) {
		$by_type = array();
		foreach ( $items as $item ) {
			if ( in_array( $item['id'], $ok, true ) ) {
				$by_type[ '' !== $item['type'] ? $item['type'] : 'post' ][] = $item['id'];
			}
		}
		foreach ( $by_type as $type => $ids ) {
			$os->announce( (string) $type, $action, $ids );
		}
	}
	$errors = (array) $result['errors'];
	if ( array() !== $errors ) {
		$os->toast(
			sprintf(
				/* translators: %d: number of items that could not be processed. */
				__( '%d item(s) could not be processed.', 'desktop-mode' ),
				count( $errors )
			)
		);
	}
}

return App::define( 'trash' )
	->title( __( 'Trash', 'desktop-mode' ) )
	// The same outlined-vessel mark the legacy dock tile draws — its
	// empty state; the client view swaps in the full-bin art through
	// `ctx.host.setIcon()` when the count crosses zero, and both
	// drawings travel in the config extra below so the swap is a
	// local operation, never a round trip. Deliberately NO badge: a
	// count on the tile reads as update notifications, and a bin that
	// changes shape carries the same signal without shouting.
	->icon( function_exists( 'openstation_recycle_bin_icon_svg' ) ? openstation_recycle_bin_icon_svg() : 'dashicons-trash' )
	->config( function_exists( 'openstation_recycle_bin_icon_uris' ) ? openstation_recycle_bin_icon_uris() : array() )
	->size( 880, 560 )
	->min_size( 520, 360 )
	// Same rail furniture as the legacy bin: a control (not an app),
	// at the end of the dock, one slot after the original so the two
	// sit side by side while both are installed.
	->nav_kind( 'control' )
	->dock_order( 41 )
	->placeable()
	->can(
		static function () {
			return function_exists( 'openstation_recycle_bin_user_can_use' )
				? openstation_recycle_bin_user_can_use()
				: current_user_can( 'edit_posts' );
		}
	)
	// The whole interaction surface is two mutations; the filter and
	// the search dispatch the built-in `refresh` (the bound value
	// rides up with the state, `data()` re-queries).
	->state(
		array(
			'filter' => '',
			'search' => '',
		)
	)
	->action(
		'restore',
		static function ( State $state, Os $os, array $args ) {
			run_bulk( $os, refs( $args ), 'openstation_recycle_bin_restore', 'untrashed' );
		}
	)
	->action(
		'purge',
		static function ( State $state, Os $os, array $args ) {
			run_bulk( $os, refs( $args ), 'openstation_recycle_bin_purge', 'deleted' );
		}
	)
	// Anything trashed or restored ANYWHERE on the desktop repaints
	// the bin — the framework's replacement for the legacy window's
	// hand-wired per-type broadcast subscriptions.
	->watch( '*' )
	->data(
		static function ( State $state ) {
			$payload = openstation_recycle_bin_get_items(
				array(
					'type'     => (string) $state->get( 'filter' ),
					'search'   => (string) $state->get( 'search' ),
					'per_page' => 200,
				)
			);
			return array(
				'items'      => $payload['items'],
				// The GLOBAL bin count (every type, unfiltered) — what
				// decides toolbar-vs-empty-state and the dock badge.
				'total'      => (int) $payload['total'],
				// Whether WordPress routes attachment deletions through
				// Trash at all — gates the Media filter segment, same
				// as the legacy template.
				'mediaTrash' => defined( 'MEDIA_TRASH' ) && MEDIA_TRASH,
			);
		}
	);
