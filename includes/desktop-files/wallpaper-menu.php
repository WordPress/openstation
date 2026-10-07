<?php

defined( 'ABSPATH' ) || exit;

function openstation_build_wallpaper_menu_items() {
	$items = array();

	$items = (array) apply_filters( 'openstation_wallpaper_context_menu_items', $items );

	$out = array();
	foreach ( $items as $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['id'] ) || empty( $entry['label'] ) ) {
			continue;
		}
		$out[] = array(
			'id'         => (string) $entry['id'],
			'label'      => (string) $entry['label'],
			'icon'       => isset( $entry['icon'] ) ? (string) $entry['icon'] : '',
			'sort'       => isset( $entry['sort'] ) ? (int) $entry['sort'] : 100,
			'disabled'   => ! empty( $entry['disabled'] ),
			'callbackId' => isset( $entry['callbackId'] ) ? (string) $entry['callbackId'] : '',
		);
	}
	return $out;
}
