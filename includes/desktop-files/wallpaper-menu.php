<?php
/**
 * OpenStation — Wallpaper context-menu server side.
 *
 * Builds the array shipped to the shell as
 * `serverWallpaperMenuItems`. Plugins extend the menu by
 * filtering the array — empty by default, so no menu items
 * arrive from the server unless plugins add them.
 *
 * The built-in items (Create folder, New URL, Sort by, Show
 * desktop, OS Settings) are JS-defined inside the shell — they
 * need access to closures we'd lose across the wire. Server
 * items take a `callbackId` string the JS bundle resolves in
 * its `serverCallbacks` map; plugins that don't ship a JS
 * callback subscribe via the
 * `os.wallpaper-context-menu.activated` action
 * instead.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Builds the server-borne wallpaper-menu items.
 *
 * @return array[]
 */
function openstation_build_wallpaper_menu_items() {
	$items = array();

	/**
	 * Filter the server-borne wallpaper context-menu items.
	 *
	 * Each item must have at least `id` and `label`. Optional:
	 * `icon`, `sort`, `disabled`, `callbackId`.
	 *
	 * @param array[] $items Items list.
	 */
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
