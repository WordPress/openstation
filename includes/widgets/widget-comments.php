<?php
/**
 * Desktop Mode — Recent Comments Widget.
 *
 * Shows a live feed of recent comments with status badges
 * (Approved / Pending / Spam), the commenter name, the post title
 * it belongs to, and a time-ago stamp. Pending count badge
 * on the card header keeps moderators on top of the queue at a glance.
 *
 * Data source: WordPress REST API  /wp/v2/comments  (logged-in).
 * Refresh: every 60 seconds via setInterval.
 * Requires: Desktop Mode 0.18.0+ (desktop_mode_register_widget).
 *
 * This file ships as a reference/example implementation.
 * Copy it into your own plugin and replace the yourplugin_ prefix
 * and text domain before use.
 *
 * @package WPDesktopMode
 * @since   0.26.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the JS asset.
 *
 * @since 0.26.0
 */
function desktop_mode_register_comments_widget_assets() {
	$suffix  = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$version = defined( 'DESKTOP_MODE_VERSION' ) ? DESKTOP_MODE_VERSION : '0';

	$js_path = DESKTOP_MODE_DIR . 'assets/js/widget-comments' . $suffix . '.js';

	wp_register_script(
		'desktop-mode-comments-widget',
		DESKTOP_MODE_URL . 'assets/js/widget-comments' . $suffix . '.js',
		array( 'wp-api-fetch' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'desktop_mode_register_comments_widget_assets', 5 );

/**
 * Register the widget definition.
 *
 * @since 0.26.0
 */
function desktop_mode_register_comments_widget() {
	if ( ! function_exists( 'desktop_mode_register_widget' ) ) {
		return;
	}
	desktop_mode_register_widget(
		'desktop-mode/recent-comments',
		array(
			'label'          => __( 'Recent Comments', 'desktop-mode' ),
			'description'    => __( 'Live feed of the latest comments with pending count.', 'desktop-mode' ),
			'icon'           => 'dashicons-admin-comments',
			'script'         => 'desktop-mode-comments-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 280,
			'min_height'     => 220,
			'default_width'  => 320,
			'default_height' => 380,
		)
	);
}
add_action( 'init', 'desktop_mode_register_comments_widget', 6 );
