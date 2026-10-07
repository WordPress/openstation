<?php

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

function openstation_plugins_window_user_can_register( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;
	$can     = $user_id > 0 && user_can( $user_id, 'activate_plugins' );

	return (bool) apply_filters(
		'openstation_plugins_window_user_can_register',
		$can,
		$user_id
	);
}

function openstation_plugins_window_user_can_use( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$cap_ok = openstation_plugins_window_user_can_register( $user_id );

	$opt_in = false;
	if ( $cap_ok && function_exists( 'openstation_get_os_settings' ) ) {
		$settings = openstation_get_os_settings( $user_id );
		$opt_in   = ! empty( $settings['nativePluginsEnabled'] );
	}

	$can = $cap_ok && $opt_in;

	return (bool) apply_filters( 'openstation_plugins_window_user_can_use', $can, $user_id );
}

function openstation_plugins_window_caps( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$site_managed = ! is_multisite();

	return array(
		'activate' => $user_id > 0 && user_can( $user_id, 'activate_plugins' ),
		'install'  => $site_managed && $user_id > 0 && user_can( $user_id, 'install_plugins' ),
		'delete'   => $site_managed && $user_id > 0 && user_can( $user_id, 'delete_plugins' ),
		'upload'   => $site_managed && $user_id > 0 && user_can( $user_id, 'upload_plugins' ),

		'update'   => $user_id > 0 && user_can( $user_id, 'update_plugins' ),
	);
}

function openstation_plugins_window_editor_url( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;
	if ( is_multisite() || wp_is_block_theme() || $user_id <= 0 || ! user_can( $user_id, 'edit_plugins' ) ) {
		return '';
	}
	return esc_url_raw( admin_url( 'plugin-editor.php' ) );
}

function openstation_plugins_window_auto_updates_enabled( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$enabled = false;
	if ( $user_id > 0 && user_can( $user_id, 'update_plugins' ) ) {
		if ( ! function_exists( 'wp_is_auto_update_enabled_for_type' ) ) {
			require_once ABSPATH . 'wp-admin/includes/update.php';
		}
		if ( wp_is_auto_update_enabled_for_type( 'plugin' ) ) {
			if ( is_multisite() ) {

				$enabled = user_can( $user_id, 'manage_network_plugins' );
			} else {
				$enabled = true;
			}
		}
	}

	return (bool) apply_filters( 'openstation_plugins_window_auto_updates_enabled', $enabled, $user_id );
}
