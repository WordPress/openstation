<?php
/**
 * Desktop Mode — Living Tree: wallpaper registration.
 *
 * Registers the `wp-living-tree` canvas wallpaper through the same public
 * API third-party canvas wallpapers use (`desktop_mode_register_wallpaper()`).
 * The `script` is the handle registered in `assets.php`; the shell's
 * wallpaper sync injects its URL when the def is needed. Mirrors the
 * animated-logo registration in `includes/wallpapers.php`.
 *
 * Hooked on `init` priority 6 — after the asset handle is registered
 * (priority 5) so the handle exists when the wallpaper references it.
 *
 * @package WPDesktopMode
 * @since   0.9.4
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the Living Tree canvas wallpaper.
 *
 * @since 0.9.4
 */
function desktop_mode_living_tree_register_wallpaper() {
	desktop_mode_register_wallpaper( 'wp-living-tree', array(
		'label'   => __( 'Living Tree', 'desktop-mode' ),
		'preview' => 'linear-gradient(180deg, #24304a 0%, #6b4a63 70%, #b5744f 100%)',
		'type'    => 'canvas',
		'script'  => 'desktop-mode-living-tree-wallpaper',
	) );
}
add_action( 'init', 'desktop_mode_living_tree_register_wallpaper', 6 );
