<?php

namespace OpenStation\Apps\Trash;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

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

				__( '%d item(s) could not be processed.', 'desktop-mode' ),
				count( $errors )
			)
		);
	}
}

return App::define( 'desktop-mode-recycle-bin' )
	->title( __( 'Trash', 'desktop-mode' ) )

	->icon( function_exists( 'openstation_recycle_bin_icon_svg' ) ? openstation_recycle_bin_icon_svg() : 'dashicons-trash' )
	->config( function_exists( 'openstation_recycle_bin_icon_uris' ) ? openstation_recycle_bin_icon_uris() : array() )
	->size( 880, 560 )
	->min_size( 520, 360 )

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

	->state(
		array(
			'filter' => '',
			'search' => '',
		)
	)

	->action(
		'show',
		static function () {

		}
	)
	->action(
		'reopen',
		static function () {

		}
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

				'total'      => (int) $payload['total'],

				'mediaTrash' => defined( 'MEDIA_TRASH' ) && MEDIA_TRASH,
			);
		}
	);
