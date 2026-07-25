<?php
/**
 * Desktop Mode — Drafts Widget.
 *
 * A quick list of the current user's most recently edited draft posts,
 * each a click away from reopening in the editor (the shell's admin-link
 * interceptor turns the row into a native window).
 *
 * Data source: WordPress REST API  /wp/v2/posts?status=draft  (edit
 * context — the drafts the logged-in user can edit).
 * Refresh: every 2 minutes.
 * Requires: Desktop Mode 0.18.0+ (desktop_mode_register_widget).
 *
 * @package WPDesktopMode
 * @since   0.26.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the JS + CSS assets.
 *
 * @since 0.26.0
 */
function desktop_mode_register_drafts_widget_assets() {
	$suffix  = desktop_mode_asset_suffix();
	$version = defined( 'DESKTOP_MODE_VERSION' ) ? DESKTOP_MODE_VERSION : '0';

	$js_path  = DESKTOP_MODE_DIR . 'assets/js/widget-drafts' . $suffix . '.js';
	$css_path = DESKTOP_MODE_DIR . 'assets/js/widget-drafts' . $suffix . '.css';

	wp_register_style(
		'desktop-mode-drafts-widget',
		DESKTOP_MODE_URL . 'assets/js/widget-drafts' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'desktop-mode-drafts-widget',
		DESKTOP_MODE_URL . 'assets/js/widget-drafts' . $suffix . '.js',
		array( 'wp-api-fetch' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'desktop_mode_register_drafts_widget_assets', 5 );

/**
 * Eagerly enqueue the CSS on shell pages so there is no flash of
 * unstyled content while the lazy JS bundle loads.
 *
 * @since 0.26.0
 */
function desktop_mode_enqueue_drafts_widget_styles() {
	if ( function_exists( 'desktop_mode_is_enabled' ) && ! desktop_mode_is_enabled() ) {
		return;
	}
	if ( function_exists( 'desktop_mode_is_chromeless_request' ) && desktop_mode_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-drafts-widget' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_drafts_widget_styles', 20 );

/**
 * Register the widget definition.
 *
 * @since 0.26.0
 */
function desktop_mode_register_drafts_widget() {
	if ( ! function_exists( 'desktop_mode_register_widget' ) ) {
		return;
	}
	desktop_mode_register_widget(
		'desktop-mode/drafts',
		array(
			'label'          => __( 'Drafts', 'desktop-mode' ),
			'description'    => __( 'Your unfinished posts — click to reopen in the editor.', 'desktop-mode' ),
			'icon'           => 'dashicons-edit',
			'script'         => 'desktop-mode-drafts-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 240,
			'min_height'     => 180,
			'default_width'  => 300,
			'default_height' => 320,
		)
	);
}
add_action( 'init', 'desktop_mode_register_drafts_widget', 6 );
