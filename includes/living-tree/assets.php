<?php
/**
 * OpenStation — Living Tree: asset registration.
 *
 * Registers the `os-living-tree-wallpaper` script handle (built
 * bundle `assets/js/living-tree-wallpaper[.min].js`). The wallpaper
 * `server-sync` lazy-loads it when the user selects the `wp-living-tree`
 * wallpaper (or opens OS Settings → Wallpaper and the picker pulls the
 * def in). The bundle's only side effect is publishing the `WallpaperDef`
 * on `window.openStationWallpapers['wp-living-tree']`. Mirrors the
 * animated-logo block in `includes/assets.php`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the Living Tree wallpaper script handle.
 */
function open_station_living_tree_register_assets() {
	$version = OPEN_STATION_VERSION;
	$suffix  = open_station_asset_suffix();

	$js_path = OPEN_STATION_DIR . 'assets/js/living-tree-wallpaper' . $suffix . '.js';
	wp_register_script(
		'os-living-tree-wallpaper',
		OPEN_STATION_URL . 'assets/js/living-tree-wallpaper' . $suffix . '.js',
		array( 'wp-hooks', 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'os-living-tree-wallpaper',
		'desktop-mode',
		OPEN_STATION_DIR . 'languages'
	);
}
add_action( 'init', 'open_station_living_tree_register_assets', 5 );
