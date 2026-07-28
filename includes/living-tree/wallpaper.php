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
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the Living Tree canvas wallpaper.
 */
function desktop_mode_living_tree_register_wallpaper() {
	desktop_mode_register_wallpaper( 'wp-living-tree', array(
		'label'       => __( 'Living Tree', 'desktop-mode' ),
		'preview'     => 'linear-gradient(180deg, #24304a 0%, #6b4a63 70%, #b5744f 100%)',
		'type'        => 'canvas',
		'script'      => 'desktop-mode-living-tree-wallpaper',
		'description' => __(
			'Your site as a living tree: every post a leaf, every page ivy on the trunk, comments in blossom, categories as wildflowers in the meadow, tags as butterflies among them, visitors as wind, and readers as fireflies after dark. It grows a little every day and never repeats itself. A tribute to open source and to Matt Mullenweg — “working on open source is like planting a tree whose shade you will never sit in: you plant it for the generations that come after you.” Keep publishing; the shade is for everyone.',
			'desktop-mode'
		),
	) );
}
add_action( 'init', 'desktop_mode_living_tree_register_wallpaper', 6 );
