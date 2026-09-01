<?php
/**
 * Trash — the Recycle Bin, as an OpenStation app.
 *
 * THE Recycle Bin: the App Framework rebuild replaced the legacy
 * native window whole and claims its id — `desktop-mode-recycle-bin`
 * is a frozen identifier (see AGENTS.md), so every desktop shortcut,
 * dock placement, drag-to-trash drop target, theme icon slot and
 * Apps & Plugins row keeps working unchanged. The window is this
 * file; the body is `trash.os.ts`, a client view painting the same
 * toolbar, `<os-table>` and empty state through its own cell
 * renderers (`parts/table-visuals.ts`). All data and mutations run
 * through the store (`includes/recycle-bin/`), which also keeps
 * capture, realtime and REST exactly as they were; the closed-window
 * tile art stays shell-side (`src/desktop-files/recycle-bin-icon-state.ts`).
 *
 * What the framework replaced: the window registration and template
 * (`window.php` keeps only the tile art, the gate and the shell
 * config), the per-window REST client and config blob (actions +
 * `data()` + `ctx.fetch`), the broadcast subscriptions
 * (`watch( '*' )`), and the imperative toolbar wiring.
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

return App::define( 'desktop-mode-recycle-bin' )
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
	// The legacy bin's rail furniture, inherited whole: a control
	// (not an app), last on the dock after the shell's own cluster
	// (Mio 10, Overview 20, System 30) — Trash is where things END
	// UP, and a dock reads left to right.
	->nav_kind( 'control' )
	->dock_order( 40 )
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
