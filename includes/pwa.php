<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_PWA_MANIFEST_FRAGMENT = 'manifest.webmanifest';

const OPENSTATION_PWA_SW_FRAGMENT = 'sw.js';

const OPENSTATION_PWA_SW_QUERY = 'openstation_sw';

const OPENSTATION_PWA_USER_META = 'desktop_mode_pwa_state';

function openstation_pwa_manifest_url() {
	return openstation_portal_url() . OPENSTATION_PWA_MANIFEST_FRAGMENT;
}

function openstation_pwa_sw_url() {
	return openstation_portal_url() . OPENSTATION_PWA_SW_FRAGMENT;
}

function openstation_pwa_sw_fallback_url() {
	return add_query_arg( OPENSTATION_PWA_SW_QUERY, '1', home_url( '/' ) );
}

function openstation_pwa_sw_scope() {
	$path = wp_parse_url( home_url( '/' ), PHP_URL_PATH );
	return is_string( $path ) && '' !== $path ? $path : '/';
}

function openstation_pwa_force_replace_sw() {

	return (bool) apply_filters( 'openstation_pwa_force_replace_sw', false );
}

function openstation_pwa_admin_asset_cache_enabled() {
	$settings = openstation_get_os_settings( get_current_user_id() );
	$enabled  = ! empty( $settings['adminAssetCacheEnabled'] );

	return (bool) apply_filters( 'openstation_pwa_admin_asset_cache', $enabled );
}

function openstation_pwa_sw_config_preamble() {

	$config = array(
		'pluginUrl'  => OPENSTATION_URL,
		'version'    => OPENSTATION_VERSION,
		'shellBuild' => openstation_shell_build_stamp(),
	);
	return sprintf( "self.__OS_SW_CONFIG = %s;\n", wp_json_encode( $config ) );
}

function openstation_shell_build_stamp( $dir = null ) {
	static $memo = array();

	$dir = null === $dir ? OPENSTATION_DIR : trailingslashit( $dir );

	$files = array();
	foreach ( array( 'assets/css/*.css', 'assets/js/*.js' ) as $pattern ) {
		$matches = glob( $dir . $pattern );
		if ( is_array( $matches ) ) {
			$files = array_merge( $files, $matches );
		}
	}
	sort( $files );
	if ( empty( $files ) ) {
		return '';
	}

	$signature = array( $dir );
	foreach ( $files as $file ) {
		$signature[] = substr( $file, strlen( $dir ) ) . ':' . filesize( $file ) . ':' . filemtime( $file );
	}
	$signature = md5( implode( "\n", $signature ) );

	if ( isset( $memo[ $signature ] ) ) {
		return $memo[ $signature ];
	}

	$cached = get_transient( 'openstation_shell_build' );
	if ( is_array( $cached ) && isset( $cached['signature'], $cached['stamp'] ) && $cached['signature'] === $signature && is_string( $cached['stamp'] ) ) {
		$memo[ $signature ] = $cached['stamp'];
		return $cached['stamp'];
	}

	$hashes = array();
	foreach ( $files as $file ) {
		$hashes[] = substr( $file, strlen( $dir ) ) . ':' . md5_file( $file );
	}
	$stamp = substr( md5( implode( "\n", $hashes ) ), 0, 16 );

	$memo[ $signature ] = $stamp;
	set_transient(
		'openstation_shell_build',
		array(
			'signature' => $signature,
			'stamp'     => $stamp,
		),
		DAY_IN_SECONDS
	);
	return $stamp;
}

function openstation_pwa_endpoint_kind() {

	$uri = isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	if ( ! is_string( $uri ) || '' === $uri ) {
		return '';
	}
	$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
	if ( '' === $path ) {
		return '';
	}
	$home_path = wp_parse_url( home_url( '/' ), PHP_URL_PATH );
	$home_path = is_string( $home_path ) ? rtrim( $home_path, '/' ) : '';
	$portal    = $home_path . '/' . trim( OPENSTATION_PORTAL_PATH, '/' ) . '/';
	if ( $path === $portal . OPENSTATION_PWA_MANIFEST_FRAGMENT ) {
		return 'manifest';
	}
	if ( $path === $portal . OPENSTATION_PWA_SW_FRAGMENT ) {
		return 'sw';
	}

	if ( isset( $_GET[ OPENSTATION_PWA_SW_QUERY ] ) && '1' === $_GET[ OPENSTATION_PWA_SW_QUERY ] ) {
		$home_root = '' === $home_path ? '/' : $home_path . '/';
		if ( $path === $home_root || $path === $home_path ) {
			return 'sw';
		}
	}
	return '';
}

function openstation_pwa_handle_request( $wp ) {
	unset( $wp );

	$kind = openstation_pwa_endpoint_kind();
	if ( '' === $kind ) {
		return;
	}

	if ( 'manifest' === $kind ) {
		openstation_pwa_serve_manifest();
		exit;
	}

	if ( 'sw' === $kind ) {
		openstation_pwa_serve_service_worker();
		exit;
	}
}
add_action( 'parse_request', 'openstation_pwa_handle_request' );

function openstation_pwa_serve_manifest() {
	$manifest = openstation_pwa_build_manifest();

	$manifest = apply_filters( 'openstation_pwa_manifest', $manifest );

	if ( ! is_array( $manifest ) ) {
		status_header( 500 );
		return;
	}

	header( 'Content-Type: application/manifest+json; charset=utf-8' );

	header( 'Cache-Control: public, max-age=300' );
	echo wp_json_encode( $manifest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
}

function openstation_pwa_build_manifest() {
	$site_name = get_bloginfo( 'name' );
	if ( '' === $site_name ) {
		$site_name = 'WordPress';
	}
	$short_name = wp_html_excerpt( $site_name, 12, '' );
	if ( '' === $short_name ) {
		$short_name = $site_name;
	}

	$start_url = openstation_shell_url();
	$scope     = admin_url( '/', 'relative' );
	if ( '' === $scope ) {
		$scope = '/wp-admin/';
	}

	$manifest_url = openstation_pwa_manifest_url();

	return array(
		'name'                        => $site_name,
		'short_name'                  => $short_name,
		'description'                 => sprintf(

			__( '%s — installed as a desktop app.', 'desktop-mode' ),
			$site_name
		),
		'start_url'                   => $start_url,
		'scope'                       => $scope,
		'id'                          => openstation_portal_url(),
		'display'                     => 'standalone',
		'display_override'            => array( 'standalone', 'minimal-ui' ),
		'orientation'                 => 'any',

		'theme_color'                 => OPENSTATION_PWA_THEME_COLOR,
		'background_color'            => OPENSTATION_PWA_THEME_COLOR,
		'lang'                        => get_bloginfo( 'language' ),
		'dir'                         => is_rtl() ? 'rtl' : 'ltr',
		'icons'                       => openstation_pwa_default_icons(),

		'related_applications'        => array(
			array(
				'platform' => 'webapp',
				'url'      => $manifest_url,
				'id'       => openstation_portal_url(),
			),
		),
		'prefer_related_applications' => false,
	);
}

function openstation_pwa_default_icons() {
	$icons = array();

	$site_icon_id = (int) get_option( 'site_icon' );
	if ( $site_icon_id > 0 ) {

		foreach ( array( 192, 512 ) as $size ) {
			$url = get_site_icon_url( $size );
			if ( is_string( $url ) && '' !== $url ) {
				$icons[] = array(
					'src'     => $url,
					'sizes'   => $size . 'x' . $size,
					'type'    => 'image/png',
					'purpose' => 'any',
				);
			}
		}
	}

	if ( ! empty( $icons ) ) {
		return $icons;
	}

	$bundled = array(
		'any'        => array( 128, 180, 192, 256, 512 ),
		'maskable'   => array( 192, 512 ),
		'monochrome' => array( 192, 512 ),
	);

	foreach ( $bundled as $purpose => $sizes ) {
		foreach ( $sizes as $size ) {
			$icons[] = array(
				'src'     => openstation_pwa_bundled_icon_url( $size, $purpose ),
				'sizes'   => "{$size}x{$size}",
				'type'    => 'image/png',
				'purpose' => $purpose,
			);
		}
	}

	return $icons;
}

function openstation_pwa_bundled_icon_url( $size, $purpose = 'any' ) {
	$infix = '';
	if ( 'maskable' === $purpose ) {
		$infix = 'maskable-';
	} elseif ( 'monochrome' === $purpose ) {
		$infix = 'mono-';
	}

	return OPENSTATION_URL . "assets/pwa/icon-{$infix}{$size}.png";
}

function openstation_pwa_serve_service_worker() {
	$suffix = openstation_asset_suffix();
	$path   = OPENSTATION_DIR . 'assets/js/sw' . $suffix . '.js';

	if ( ! file_exists( $path ) ) {

		if ( function_exists( 'error_log' ) ) {
			error_log( '[openstation] service worker bundle missing at ' . $path . ' — run `npm run build` to generate it.' );
		}
		status_header( 503 );
		header( 'Cache-Control: no-cache, must-revalidate' );
		return;
	}

	$body = file_get_contents( $path );
	if ( false === $body ) {
		status_header( 503 );
		return;
	}

	header( 'Content-Type: application/javascript; charset=utf-8' );

	header( 'Service-Worker-Allowed: ' . openstation_pwa_sw_scope() );
	header( 'Cache-Control: no-cache, must-revalidate' );
	header( 'X-Content-Type-Options: nosniff' );



	echo openstation_pwa_sw_config_preamble();

	echo $body;
}

const OPENSTATION_PWA_THEME_COLOR = '#0c0b0f';

const OPENSTATION_PWA_STATUS_BAR_STYLES = array( 'black', 'black-translucent', 'default' );

function openstation_pwa_status_bar_style() {

	$style = apply_filters( 'openstation_pwa_status_bar_style', 'black' );
	return in_array( $style, OPENSTATION_PWA_STATUS_BAR_STYLES, true ) ? $style : 'black';
}

function openstation_pwa_render_head_tags() {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return;
	}
	if ( ! openstation_is_shell_request() ) {
		return;
	}

	printf(
		'<link rel="manifest" href="%s">' . "\n",
		esc_url( openstation_pwa_manifest_url() )
	);
	printf(
		'<meta name="theme-color" content="%s">' . "\n",
		esc_attr( OPENSTATION_PWA_THEME_COLOR )
	);

	echo '<meta name="mobile-web-app-capable" content="yes">' . "\n";
	echo '<meta name="apple-mobile-web-app-capable" content="yes">' . "\n";
	printf(
		'<meta name="apple-mobile-web-app-status-bar-style" content="%s">' . "\n",
		esc_attr( openstation_pwa_status_bar_style() )
	);
	printf(
		'<meta name="apple-mobile-web-app-title" content="%s">' . "\n",
		esc_attr( get_bloginfo( 'name' ) )
	);
	printf(
		'<link rel="apple-touch-icon" sizes="180x180" href="%s">' . "\n",
		esc_url( openstation_pwa_apple_touch_icon_url() )
	);
}
add_action( 'admin_head', 'openstation_pwa_render_head_tags', 1 );

function openstation_pwa_apple_touch_icon_url() {
	$site_icon_id = (int) get_option( 'site_icon' );
	if ( $site_icon_id > 0 ) {
		$url = get_site_icon_url( 180 );
		if ( is_string( $url ) && '' !== $url ) {
			return $url;
		}
	}

	return openstation_pwa_bundled_icon_url( 180 );
}

function openstation_pwa_get_user_state( $user_id = 0 ) {
	if ( 0 === $user_id ) {
		$user_id = get_current_user_id();
	}
	$raw = get_user_meta( $user_id, OPENSTATION_PWA_USER_META, true );
	if ( ! is_array( $raw ) ) {
		$raw = array();
	}
	return array(
		'installHintDismissed' => ! empty( $raw['installHintDismissed'] ),
		'notificationsEnabled' => ! empty( $raw['notificationsEnabled'] ),
	);
}

function openstation_pwa_update_user_state( array $patch, $user_id = 0 ) {
	if ( 0 === $user_id ) {
		$user_id = get_current_user_id();
	}
	$current = openstation_pwa_get_user_state( $user_id );
	$next    = array_merge( $current, $patch );
	update_user_meta( $user_id, OPENSTATION_PWA_USER_META, $next );
}

function openstation_pwa_register_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/pwa-state',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'openstation_pwa_rest_get_state',
				'permission_callback' => 'openstation_pwa_rest_permission',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'openstation_pwa_rest_post_state',
				'permission_callback' => 'openstation_pwa_rest_permission',
				'args'                => array(
					'installHintDismissed' => array(
						'type'     => 'boolean',
						'required' => false,
					),
					'notificationsEnabled' => array(
						'type'     => 'boolean',
						'required' => false,
					),
				),
			),
		)
	);

}
add_action( 'rest_api_init', 'openstation_pwa_register_rest_routes' );

function openstation_pwa_rest_permission() {
	return openstation_rest_require_enabled();
}

function openstation_pwa_rest_get_state() {
	return rest_ensure_response( openstation_pwa_get_user_state() );
}

function openstation_pwa_rest_post_state( $request ) {
	$patch = array();
	if ( null !== $request->get_param( 'installHintDismissed' ) ) {
		$patch['installHintDismissed'] = (bool) $request->get_param( 'installHintDismissed' );
	}
	if ( null !== $request->get_param( 'notificationsEnabled' ) ) {
		$patch['notificationsEnabled'] = (bool) $request->get_param( 'notificationsEnabled' );
	}
	if ( ! empty( $patch ) ) {
		openstation_pwa_update_user_state( $patch );
	}
	return rest_ensure_response( openstation_pwa_get_user_state() );
}
