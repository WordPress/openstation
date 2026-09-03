<?php
/**
 * User Edit app — the admin colour scheme catalogue.
 *
 * Shared with the Users app (its Profile tab hosts the same
 * `<os-user-profile>` component), which requires this file by path.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Build the admin colour scheme list with full colour tuples for
 * each scheme. Mirrors what WP core feeds the
 * `admin_color_scheme_picker` action: each entry carries the scheme
 * `name`, the stylesheet `url` (the live preview swap on self-edit
 * points `<link id="colors-css">` at it) and a `colors` tuple used
 * to render mini-swatch previews.
 *
 * @return array<string,array{name:string,url:string,colors:array<int,string>,icon_colors:array<string,string>}>
 */
function openstation_user_edit_window_color_schemes() {
	$out = array();
	// The registry lives in `wp-admin/includes/admin.php`, which an
	// app dispatch (a REST request) never loads on its own.
	if ( ! function_exists( 'register_admin_color_schemes' ) ) {
		$admin_inc = ABSPATH . 'wp-admin/includes/admin.php';
		if ( is_readable( $admin_inc ) ) {
			require_once $admin_inc;
		}
	}
	if ( function_exists( 'register_admin_color_schemes' ) ) {
		register_admin_color_schemes();
	}
	global $_wp_admin_css_colors;
	if ( is_array( $_wp_admin_css_colors ) ) {
		foreach ( $_wp_admin_css_colors as $slug => $info ) {
			$out[ (string) $slug ] = array(
				'name'        => isset( $info->name ) ? (string) $info->name : (string) $slug,
				'url'         => isset( $info->url ) ? esc_url_raw( (string) $info->url ) : '',
				'colors'      => isset( $info->colors ) ? array_values( (array) $info->colors ) : array(),
				'icon_colors' => isset( $info->icon_colors ) ? (array) $info->icon_colors : array(),
			);
		}
	}
	if ( empty( $out ) ) {
		// Fallback so the picker still shows ONE option even when
		// the registry hasn't populated.
		$out['fresh'] = array(
			'name'        => __( 'Default', 'desktop-mode' ),
			'url'         => '',
			'colors'      => array( '#1d2327', '#2c3338', '#2271b1', '#72aee6' ),
			'icon_colors' => array(),
		);
	}
	return $out;
}
