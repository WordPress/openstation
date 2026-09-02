<?php
/**
 * OpenStation — My WordPress: asset registration.
 *
 * Registers the bundle script + CSS handles. The bundle is lazy-loaded
 * by the native-window sync the first time the My WordPress window
 * opens, the same as the recycle-bin and posts-window modules.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register My WordPress CSS and JS handles.
 */
function openstation_my_wordpress_register_assets() {
	$version = OPENSTATION_VERSION;
	$suffix  = openstation_asset_suffix();

	/*
	 * `os-files` is a real dependency, not decoration. Every tile in
	 * this window is an `<os-tile>` wearing the canonical
	 * `.os-file-tile` chrome that `desktop-files.css` declares, and
	 * this stylesheet overrides a handful of those declarations at
	 * EQUAL specificity — most visibly `.os-my-wordpress__media-tile`,
	 * which has to undo `position: absolute` + the fixed 88×104 box so
	 * media thumbnails flow inside their CSS Grid.
	 *
	 * Equal specificity means source order decides, and source order is
	 * not ours to assume: any handle depending on this one that is
	 * enqueued before `openstation_enqueue_assets()` runs (the
	 * WooCommerce integration enqueues its companion stylesheet at
	 * `admin_enqueue_scripts` priority 5) pulls this file into
	 * `WP_Dependencies::$to_do` ahead of `os-files`. The overrides then
	 * lose, every media tile is absolutely positioned with no offsets,
	 * and the whole grid stacks in one corner.
	 *
	 * Declaring the dependency makes the order a fact rather than a
	 * coincidence. `Tests_OpenStation_TileStylesheetOrder` holds it.
	 */
	$css_path = OPENSTATION_DIR . 'assets/css/my-wordpress.css';
	wp_register_style(
		'desktop-mode-my-wordpress',
		OPENSTATION_URL . 'assets/css/my-wordpress.css',
		array( 'os-variables', 'dashicons', 'os-files' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	// No script handle any more: the legacy window bundle is gone. The
	// explorer's JS is the `my-wordpress` app's client view, registered
	// by the App Framework host.
	unset( $suffix );
}
add_action( 'init', 'openstation_my_wordpress_register_assets', 5 );

/**
 * Ride the explorer's shared stylesheet on the WP Explorer app.
 *
 * `my-wordpress.css` is shell infrastructure, not one window's skin:
 * the hover card, the article slots, the footprint surface and the
 * folder windows' preview pane all paint with its `os-my-wordpress__*`
 * classes (desktop themes target them at palette level). The app
 * renders those same surfaces, so the sheet travels with its window as
 * a first-open companion — one stylesheet, every consumer.
 *
 * @param array  $window_args Args passed to `openstation_register_window()`.
 * @param string $app_id      App id.
 * @return array
 */
function openstation_my_wordpress_app_style( $window_args, $app_id ) {
	if ( 'my-wordpress' !== (string) $app_id || ! is_array( $window_args ) ) {
		return $window_args;
	}
	$styles                 = isset( $window_args['styles'] ) ? (array) $window_args['styles'] : array();
	$styles[]               = 'desktop-mode-my-wordpress';
	$window_args['styles']  = $styles;
	return $window_args;
}
add_filter( 'openstation_app_window_args', 'openstation_my_wordpress_app_style', 10, 2 );
