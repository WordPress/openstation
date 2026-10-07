<?php

defined( 'ABSPATH' ) || exit;

function openstation_admin_body_classes( $classes ) {
	if ( openstation_is_chromeless_request() ) {
		return ltrim( $classes . ' os-chromeless' );
	}

	if ( openstation_is_shell_request() ) {
		$classes = ltrim(
			$classes . ' os-active os-admin-bar-'
				. openstation_get_admin_bar_mode()
		);

		if ( openstation_is_solo_request() ) {
			$classes .= ' os-solo';
		}

		return $classes;
	}

	return $classes;
}
add_filter( 'admin_body_class', 'openstation_admin_body_classes' );

function openstation_get_admin_bar_mode() {
	$settings = openstation_get_os_settings( get_current_user_id() );
	$mode     = isset( $settings['adminBarMode'] ) ? (string) $settings['adminBarMode'] : 'static';

	$mode = apply_filters( 'openstation_admin_bar_mode', $mode );

	return is_string( $mode ) && in_array( $mode, OPENSTATION_OS_SETTINGS_ADMIN_BAR_MODES, true )
		? $mode
		: 'static';
}

function openstation_get_dock_behavior() {
	$settings = openstation_get_os_settings( get_current_user_id() );
	$behavior = isset( $settings['dockBehavior'] ) ? (string) $settings['dockBehavior'] : 'static';

	$behavior = apply_filters( 'openstation_dock_behavior', $behavior );

	return is_string( $behavior ) && in_array( $behavior, OPENSTATION_OS_SETTINGS_DOCK_BEHAVIORS, true )
		? $behavior
		: 'static';
}
