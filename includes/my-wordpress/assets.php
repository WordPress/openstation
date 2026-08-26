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

	$js_path = OPENSTATION_DIR . 'assets/js/my-wordpress' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-my-wordpress',
		OPENSTATION_URL . 'assets/js/my-wordpress' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-my-wordpress',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);
}
add_action( 'init', 'openstation_my_wordpress_register_assets', 5 );
