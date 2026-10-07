<?php

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

function openstation_plugins_window_ajax_upload() {
	$guard = openstation_plugins_window_ajax_guard( 'upload_plugins' );
	if ( is_wp_error( $guard ) ) {
		openstation_plugins_window_ajax_error( $guard );
		return;
	}

	$file      = isset( $_FILES['pluginzip'] ) && is_array( $_FILES['pluginzip'] ) ? $_FILES['pluginzip'] : null;
	$overwrite = ! empty( $_POST['overwrite'] );

	$rejected = openstation_plugins_window_validate_upload( $file );
	if ( is_wp_error( $rejected ) ) {
		openstation_plugins_window_ajax_error( $rejected );
		return;
	}

	if ( ! function_exists( 'wp_handle_upload' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}
	if ( ! class_exists( 'WP_Upgrader' ) ) {
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
	}
	if ( ! class_exists( 'WP_Ajax_Upgrader_Skin' ) ) {
		require_once ABSPATH . 'wp-admin/includes/class-wp-ajax-upgrader-skin.php';
	}
	if ( ! class_exists( 'Plugin_Upgrader' ) || ! class_exists( 'WP_Ajax_Upgrader_Skin' ) ) {
		openstation_plugins_window_ajax_error(
			new WP_Error(
				'openstation_plugins_upgrader_missing',
				__( 'Plugin upgrader is unavailable in this context. Reload the page and try again.', 'desktop-mode' ),
				array( 'status' => 503 )
			)
		);
		return;
	}

	$skin     = new WP_Ajax_Upgrader_Skin();
	$upgrader = new Plugin_Upgrader( $skin );
	$result   = $upgrader->install( (string) $file['tmp_name'], array( 'overwrite_package' => $overwrite ) );

	if ( ! $overwrite ) {
		$folder_exists =
			( is_wp_error( $skin->result ) && 'folder_exists' === $skin->result->get_error_code() ) ||
			( is_wp_error( $result ) && 'folder_exists' === $result->get_error_code() ) ||
			false === $result || null === $result;
		if ( $folder_exists ) {
			openstation_plugins_window_ajax_error(
				new WP_Error(
					'folder_exists',
					__( 'A plugin with the same folder name is already installed. Replace it to continue.', 'desktop-mode' ),
					array( 'status' => 409 )
				)
			);
			return;
		}
	}

	if ( is_wp_error( $skin->result ) ) {
		openstation_plugins_window_ajax_error( $skin->result );
		return;
	}
	if ( $skin->get_errors()->has_errors() ) {
		openstation_plugins_window_ajax_error( $skin->get_errors() );
		return;
	}
	if ( is_wp_error( $result ) ) {
		openstation_plugins_window_ajax_error( $result );
		return;
	}
	if ( false === $result || null === $result ) {
		openstation_plugins_window_ajax_error(
			new WP_Error(
				'openstation_plugins_install_failed',
				__( 'Plugin install failed.', 'desktop-mode' ),
				array( 'status' => 500 )
			)
		);
		return;
	}

	$plugin_file = $upgrader->plugin_info();

	do_action( 'openstation_plugins_window_installed', $plugin_file );

	$plugin_name    = '';
	$plugin_version = '';
	if ( '' !== $plugin_file ) {
		if ( ! function_exists( 'get_plugin_data' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		$abs_plugin_file = WP_PLUGIN_DIR . '/' . $plugin_file;
		if ( file_exists( $abs_plugin_file ) ) {
			$data           = get_plugin_data( $abs_plugin_file, false, false );
			$plugin_name    = isset( $data['Name'] ) ? (string) $data['Name'] : '';
			$plugin_version = isset( $data['Version'] ) ? (string) $data['Version'] : '';
		}
	}

	wp_send_json_success(
		array(
			'plugin_file'    => (string) $plugin_file,
			'plugin_name'    => $plugin_name,
			'plugin_version' => $plugin_version,
			'status'         => 'inactive',
			'messages'       => $skin->get_upgrade_messages(),
		)
	);
}
add_action( 'wp_ajax_openstation_plugins_upload', 'openstation_plugins_window_ajax_upload' );

function openstation_plugins_window_validate_upload( $file ) {
	if ( null === $file ) {
		return new WP_Error(
			'openstation_plugins_missing_file',
			__( 'No file received. Pick a .zip and try again.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( ! isset( $file['name'], $file['tmp_name'], $file['error'] ) ) {
		return new WP_Error(
			'openstation_plugins_invalid_file',
			__( 'Upload payload is malformed.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( UPLOAD_ERR_OK !== (int) $file['error'] ) {
		return new WP_Error(
			'openstation_plugins_upload_error',
			sprintf(

				__( 'Upload failed (error %d). Try again.', 'desktop-mode' ),
				(int) $file['error']
			),
			array( 'status' => 400 )
		);
	}
	$name = sanitize_file_name( (string) $file['name'] );
	if ( '' === $name || '.zip' !== strtolower( substr( $name, -4 ) ) ) {
		return new WP_Error(
			'openstation_plugins_not_zip',
			__( 'Plugin uploads must be a .zip file.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( ! is_uploaded_file( (string) $file['tmp_name'] ) ) {

		return new WP_Error(
			'openstation_plugins_bad_tmp',
			__( 'Refused: temporary upload path is not trusted.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	return true;
}
