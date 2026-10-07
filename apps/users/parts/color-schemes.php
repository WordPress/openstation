<?php

defined( 'ABSPATH' ) || exit;

function openstation_user_edit_window_color_schemes() {
	$out = array();

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

		$out['fresh'] = array(
			'name'        => __( 'Default', 'desktop-mode' ),
			'url'         => '',
			'colors'      => array( '#1d2327', '#2c3338', '#2271b1', '#72aee6' ),
			'icon_colors' => array(),
		);
	}
	return $out;
}
