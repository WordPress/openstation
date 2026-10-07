<?php

defined( 'ABSPATH' ) || exit;

function openstation_desktop_themes_rest_permission() {
	$base = openstation_rest_require_enabled();
	if ( is_wp_error( $base ) ) {
		return $base;
	}
	if ( ! current_user_can( openstation_desktop_theme_upload_capability() ) ) {
		return new WP_Error(
			'openstation_desktop_theme_cannot_manage',
			__( 'You are not allowed to manage desktop themes.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

function openstation_register_desktop_themes_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/desktop-themes',
		array(
			array(

				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'openstation_rest_require_enabled',
				'callback'            => 'openstation_rest_list_desktop_themes',
			),
			array(

				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'openstation_desktop_themes_rest_permission',
				'callback'            => 'openstation_rest_upload_desktop_theme',
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/desktop-themes/(?P<slug>[a-z0-9_-]+)',
		array(
			'methods'             => WP_REST_Server::DELETABLE,
			'permission_callback' => 'openstation_desktop_themes_rest_permission',
			'callback'            => 'openstation_rest_delete_desktop_theme',
			'args'                => array(
				'slug' => array(
					'type'     => 'string',
					'required' => true,
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_desktop_themes_rest_routes' );

function openstation_rest_list_desktop_themes() {
	return rest_ensure_response(
		array(
			'themes' => openstation_build_desktop_themes_payload(),
		)
	);
}

function openstation_rest_upload_desktop_theme( WP_REST_Request $request ) {
	$files = $request->get_file_params();

	if ( empty( $files ) ) {
		$content_length = isset( $_SERVER['CONTENT_LENGTH'] ) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
		if ( $content_length > 0 ) {
			return new WP_Error(
				'openstation_desktop_theme_too_large',
				__( 'That theme archive is larger than this server accepts.', 'desktop-mode' ),
				array( 'status' => 413 )
			);
		}
		return new WP_Error(
			'openstation_desktop_theme_no_file',
			__( 'No theme archive was uploaded.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( empty( $files['file'] ) || ! is_array( $files['file'] ) ) {
		return new WP_Error(
			'openstation_desktop_theme_no_file',
			__( 'No theme archive was uploaded.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$file = $files['file'];
	$name = isset( $file['name'] ) ? (string) $file['name'] : '';

	$segments = explode( '.', strtolower( $name ) );
	$last     = array_pop( $segments );
	if ( 'zip' !== $last ) {
		return new WP_Error(
			'openstation_desktop_theme_not_zip',
			__( 'A desktop theme must be uploaded as a .zip archive.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	$denied = array( 'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'phar', 'pht', 'phps', 'cgi', 'pl', 'asp', 'aspx', 'jsp', 'shtml', 'html', 'htm', 'js' );
	array_shift( $segments );
	foreach ( $segments as $segment ) {
		if ( in_array( $segment, $denied, true ) ) {
			return new WP_Error(
				'openstation_desktop_theme_not_zip',
				__( 'That file name is not allowed.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
	}

	$max = (int) wp_max_upload_size();
	if ( $max > 0 && isset( $file['size'] ) && (int) $file['size'] > $max ) {
		return new WP_Error(
			'openstation_desktop_theme_too_large',
			sprintf(

				__( 'That theme archive is larger than the allowed maximum of %s.', 'desktop-mode' ),
				size_format( $max )
			),
			array( 'status' => 413 )
		);
	}

	$tmp = isset( $file['tmp_name'] ) ? (string) $file['tmp_name'] : '';
	if ( '' === $tmp || ! file_exists( $tmp ) ) {
		return new WP_Error(
			'openstation_desktop_theme_no_file',
			__( 'The uploaded archive could not be read.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$entry = openstation_desktop_theme_install_from_zip( $tmp );
	if ( is_wp_error( $entry ) ) {
		return $entry;
	}

	$shaped = openstation_shape_desktop_theme_payload_entry( $entry, 'upload' );
	if ( ! $shaped ) {
		return new WP_Error(
			'openstation_desktop_theme_install_failed',
			__( 'The theme installed but could not be described back to the shell.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	openstation_register_desktop_theme_wallpapers();
	$shaped['serverWallpapers'] = openstation_build_desktop_wallpapers_payload();

	return rest_ensure_response( $shaped );
}

function openstation_rest_delete_desktop_theme( WP_REST_Request $request ) {
	$slug    = sanitize_key( (string) $request['slug'] );
	$deleted = openstation_desktop_theme_delete( $slug );
	if ( is_wp_error( $deleted ) ) {
		return $deleted;
	}

	$prefix     = OPENSTATION_DESKTOP_THEME_WALLPAPER_PREFIX . $slug . '/';
	$wallpapers = array();
	foreach ( openstation_build_desktop_wallpapers_payload() as $wallpaper ) {
		$id = isset( $wallpaper['id'] ) ? (string) $wallpaper['id'] : '';
		if ( '' !== $id && 0 === strpos( $id, $prefix ) ) {
			continue;
		}
		$wallpapers[] = $wallpaper;
	}

	return rest_ensure_response(
		array(
			'deleted'          => true,
			'slug'             => $slug,
			'serverWallpapers' => $wallpapers,
		)
	);
}
