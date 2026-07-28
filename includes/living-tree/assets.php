<?php
/**
 * Desktop Mode — Living Tree: asset registration.
 *
 * Registers the `desktop-mode-living-tree-wallpaper` script handle (built
 * bundle `assets/js/living-tree-wallpaper[.min].js`). The wallpaper
 * `server-sync` lazy-loads it when the user selects the `wp-living-tree`
 * wallpaper (or opens OS Settings → Wallpaper and the picker pulls the
 * def in). The bundle's only side effect is publishing the `WallpaperDef`
 * on `window.desktopModeWallpapers['wp-living-tree']`. Mirrors the
 * animated-logo block in `includes/assets.php`.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the Living Tree wallpaper script handle.
 */
function desktop_mode_living_tree_register_assets() {
	$version = DESKTOP_MODE_VERSION;
	$suffix  = desktop_mode_asset_suffix();

	$js_path = DESKTOP_MODE_DIR . 'assets/js/living-tree-wallpaper' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-living-tree-wallpaper',
		DESKTOP_MODE_URL . 'assets/js/living-tree-wallpaper' . $suffix . '.js',
		array( 'wp-hooks', 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-living-tree-wallpaper',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);
}
add_action( 'init', 'desktop_mode_living_tree_register_assets', 5 );
