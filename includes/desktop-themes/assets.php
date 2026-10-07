<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_DESKTOP_THEME_STYLE_HANDLE = 'os-desktop-theme';

function openstation_active_desktop_theme_slug( $user_id = 0 ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		$user_id = get_current_user_id();
	}
	if ( $user_id <= 0 ) {
		return '';
	}

	$settings = openstation_get_os_settings( $user_id );
	$slug     = isset( $settings['desktopTheme'] ) ? sanitize_key( (string) $settings['desktopTheme'] ) : '';
	if ( '' === $slug ) {
		return '';
	}

	if ( null !== openstation_desktop_theme_get( $slug ) ) {
		return $slug;
	}
	if ( null !== openstation_desktop_theme_registry( $slug ) ) {
		return $slug;
	}
	return '';
}

function openstation_desktop_theme_request_is_themable() {
	return openstation_is_shell_request();
}

function openstation_enqueue_desktop_theme_style() {
	if ( ! openstation_desktop_theme_request_is_themable() ) {
		return;
	}
	$slug = openstation_active_desktop_theme_slug();
	if ( '' === $slug ) {

		return;
	}

	$uploaded = openstation_desktop_theme_get( $slug );
	if ( is_array( $uploaded ) ) {
		$version = isset( $uploaded['installedAt'] ) ? (string) (int) $uploaded['installedAt'] : OPENSTATION_VERSION;
		wp_enqueue_style(
			OPENSTATION_DESKTOP_THEME_STYLE_HANDLE,
			openstation_desktop_themes_url( $slug ) . '/theme.css',
			array( 'os-variables' ),
			$version
		);
		return;
	}

	$code = openstation_desktop_theme_registry( $slug );
	if ( is_array( $code ) && ! empty( $code['cssText'] ) ) {

		wp_register_style(
			OPENSTATION_DESKTOP_THEME_STYLE_HANDLE,
			false,
			array( 'os-variables' ),
			OPENSTATION_VERSION
		);
		wp_enqueue_style( OPENSTATION_DESKTOP_THEME_STYLE_HANDLE );
		wp_add_inline_style( OPENSTATION_DESKTOP_THEME_STYLE_HANDLE, (string) $code['cssText'] );
	}
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_desktop_theme_style', 20 );

function openstation_desktop_theme_body_class( $classes ) {
	if ( ! openstation_desktop_theme_request_is_themable() ) {
		return $classes;
	}
	$slug = openstation_active_desktop_theme_slug();
	if ( '' === $slug ) {
		return $classes;
	}
	return trim( $classes . ' os-desktop-theme-' . $slug );
}
add_filter( 'admin_body_class', 'openstation_desktop_theme_body_class', 20 );

function openstation_desktop_theme_inject_shell_config( $config ) {
	$config['canManageDesktopThemes'] = current_user_can( openstation_desktop_theme_upload_capability() );
	$config['desktopThemesUrl']       = esc_url_raw( rest_url( 'desktop-mode/v1/desktop-themes' ) );
	return $config;
}
add_filter( 'openstation_shell_config', 'openstation_desktop_theme_inject_shell_config', 20 );
