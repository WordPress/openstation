<?php
/**
 * OpenStation — Desktop-theme REST routes.
 *
 *   POST   /desktop-mode/v1/desktop-themes         multipart `file`
 *   DELETE /desktop-mode/v1/desktop-themes/<slug>
 *
 * There is deliberately no GET: the library rides the shell payload
 * (`serverDesktopThemes`), so a separate read route would be a
 * second source of truth to keep in sync for no gain.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Permission gate: the standard openstation REST gate plus the
 * theme-management capability.
 *
 * @return true|WP_Error
 */
function open_station_desktop_themes_rest_permission() {
	$base = open_station_rest_require_enabled();
	if ( is_wp_error( $base ) ) {
		return $base;
	}
	if ( ! current_user_can( open_station_desktop_theme_upload_capability() ) ) {
		return new WP_Error(
			'open_station_desktop_theme_cannot_manage',
			__( 'You are not allowed to manage desktop themes.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * Register the routes.
 */
function open_station_register_desktop_themes_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/desktop-themes',
		array(
			// POST only — PHP populates `$_FILES` for real POSTs only.
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'open_station_desktop_themes_rest_permission',
			'callback'            => 'open_station_rest_upload_desktop_theme',
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/desktop-themes/(?P<slug>[a-z0-9_-]+)',
		array(
			'methods'             => WP_REST_Server::DELETABLE,
			'permission_callback' => 'open_station_desktop_themes_rest_permission',
			'callback'            => 'open_station_rest_delete_desktop_theme',
			'args'                => array(
				'slug' => array(
					'type'     => 'string',
					'required' => true,
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'open_station_register_desktop_themes_rest_routes' );

/**
 * POST /desktop-mode/v1/desktop-themes
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error The payload-shaped entry.
 */
function open_station_rest_upload_desktop_theme( WP_REST_Request $request ) {
	$files = $request->get_file_params();

	// A body over `post_max_size` reaches PHP with $_POST and $_FILES
	// both empty while CONTENT_LENGTH says bytes were sent. Answer a
	// clear 413 rather than the baffling "missing parameter" default
	// (same treatment as the stored-files upload route).
	if ( empty( $files ) ) {
		$content_length = isset( $_SERVER['CONTENT_LENGTH'] ) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
		if ( $content_length > 0 ) {
			return new WP_Error(
				'open_station_desktop_theme_too_large',
				__( 'That theme archive is larger than this server accepts.', 'desktop-mode' ),
				array( 'status' => 413 )
			);
		}
		return new WP_Error(
			'open_station_desktop_theme_no_file',
			__( 'No theme archive was uploaded.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( empty( $files['file'] ) || ! is_array( $files['file'] ) ) {
		return new WP_Error(
			'open_station_desktop_theme_no_file',
			__( 'No theme archive was uploaded.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$file = $files['file'];
	$name = isset( $file['name'] ) ? (string) $file['name'] : '';

	// Name check: must END in `.zip`, and no dot-segment anywhere in
	// the name may look executable (`theme.php.zip` is refused even
	// though its final extension is fine — OWASP double-extension).
	$segments = explode( '.', strtolower( $name ) );
	$last     = array_pop( $segments );
	if ( 'zip' !== $last ) {
		return new WP_Error(
			'open_station_desktop_theme_not_zip',
			__( 'A desktop theme must be uploaded as a .zip archive.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	$denied = array( 'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'phar', 'pht', 'phps', 'cgi', 'pl', 'asp', 'aspx', 'jsp', 'shtml', 'html', 'htm', 'js' );
	array_shift( $segments ); // First segment is the base name.
	foreach ( $segments as $segment ) {
		if ( in_array( $segment, $denied, true ) ) {
			return new WP_Error(
				'open_station_desktop_theme_not_zip',
				__( 'That file name is not allowed.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
	}

	$max = (int) wp_max_upload_size();
	if ( $max > 0 && isset( $file['size'] ) && (int) $file['size'] > $max ) {
		return new WP_Error(
			'open_station_desktop_theme_too_large',
			sprintf(
				/* translators: %s: formatted maximum file size. */
				__( 'That theme archive is larger than the allowed maximum of %s.', 'desktop-mode' ),
				size_format( $max )
			),
			array( 'status' => 413 )
		);
	}

	$tmp = isset( $file['tmp_name'] ) ? (string) $file['tmp_name'] : '';
	if ( '' === $tmp || ! file_exists( $tmp ) ) {
		return new WP_Error(
			'open_station_desktop_theme_no_file',
			__( 'The uploaded archive could not be read.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$entry = open_station_desktop_theme_install_from_zip( $tmp );
	if ( is_wp_error( $entry ) ) {
		return $entry;
	}

	$shaped = open_station_shape_desktop_theme_payload_entry( $entry, 'upload' );
	if ( ! $shaped ) {
		return new WP_Error(
			'open_station_desktop_theme_install_failed',
			__( 'The theme installed but could not be described back to the shell.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	// Wallpapers the theme brought with it.
	//
	// `open_station_register_desktop_theme_wallpapers()` already ran on
	// `init` for THIS request — before the upload existed — so the new
	// theme's wallpapers are not in the registry yet. Re-running it now
	// picks them up (registration is idempotent: same ids, same store),
	// and the shell applies the rebuilt list without a reload. Without
	// this the wallpapers only appeared on the next page load, which is
	// exactly the kind of "it works after F5" seam this payload channel
	// exists to remove.
	open_station_register_desktop_theme_wallpapers();
	$shaped['serverWallpapers'] = open_station_build_desktop_wallpapers_payload();

	return rest_ensure_response( $shaped );
}

/**
 * DELETE /desktop-mode/v1/desktop-themes/<slug>
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function open_station_rest_delete_desktop_theme( WP_REST_Request $request ) {
	$slug    = sanitize_key( (string) $request['slug'] );
	$deleted = open_station_desktop_theme_delete( $slug );
	if ( is_wp_error( $deleted ) ) {
		return $deleted;
	}
	// The deleted theme's wallpapers were registered on `init`, into a
	// per-request static store we have no unregister API for. Filtering
	// them out of the response is enough and avoids inventing one: the
	// store dies with the request, and the next one never registers
	// them because the theme is gone.
	$prefix     = OPEN_STATION_DESKTOP_THEME_WALLPAPER_PREFIX . $slug . '/';
	$wallpapers = array();
	foreach ( open_station_build_desktop_wallpapers_payload() as $wallpaper ) {
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
