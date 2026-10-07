<?php

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/autoload.php';

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\Registry;
use OpenStation\App\Runtime;

const OPENSTATION_APP_RUNTIME_HANDLE = 'openstation-app-runtime';

function openstation_apps_registry() {
	static $registry = null;
	if ( null === $registry ) {
		$registry = new Registry();
	}
	return $registry;
}

function openstation_apps_runtime() {
	static $runtime = null;
	if ( null === $runtime ) {
		$runtime = new Runtime( openstation_apps_registry() );
	}
	return $runtime;
}

function openstation_apps_os() {
	static $os = null;
	if ( null === $os ) {
		$os = new Os(
			new App\WordPress\Auth(),
			new App\WordPress\Settings(),
			new App\WordPress\Hooks(),
			new App\WordPress\Cache(),
			new App\WordPress\Env(),
			new App\WordPress\Store()
		);
	}
	return $os;
}

function openstation_app( $id ) {
	return openstation_apps_registry()->get( $id );
}

function openstation_app_menu_tabs( $menu_slug ) {
	$menu_slug = (string) $menu_slug;
	if ( '' === $menu_slug ) {
		return array();
	}
	foreach ( openstation_apps_registry()->all() as $app ) {
		if ( $app->menu_slug() !== $menu_slug ) {
			continue;
		}
		if ( ! $app->menu_owns_dock() || ! $app->allows( openstation_apps_os() ) ) {
			return array();
		}
		return $app->menu_tabs();
	}
	return array();
}

function openstation_app_render( $id, array $state = array() ) {
	return openstation_apps_runtime()->describe( $id, $state, openstation_apps_os() );
}

function openstation_apps_directories() {
	$dirs = array( rtrim( OPENSTATION_DIR, '/\\' ) . '/apps' );

	return array_values( array_unique( array_filter( array_map( 'strval', (array) apply_filters( 'openstation_apps_directories', $dirs ) ) ) ) );
}

function openstation_apps_is_dispatch_request() {
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	return false !== strpos( $uri, 'desktop-mode/v1/apps/' );
}

function openstation_apps_track_registrants( $track ) {
	return $track || openstation_apps_is_dispatch_request();
}
add_filter( 'openstation_track_type_registrants', 'openstation_apps_track_registrants' );

function openstation_apps_load() {
	$registry = openstation_apps_registry();
	foreach ( openstation_apps_directories() as $dir ) {
		$registry->load_dir( $dir );
	}

	do_action( 'openstation_apps_loaded', $registry );
}
add_action( 'init', 'openstation_apps_load', 10 );

function openstation_apps_register_assets() {
	$suffix  = openstation_asset_suffix();
	$js_path = OPENSTATION_DIR . 'assets/js/app-runtime' . $suffix . '.js';
	wp_register_script(
		OPENSTATION_APP_RUNTIME_HANDLE,
		OPENSTATION_URL . 'assets/js/app-runtime' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : OPENSTATION_VERSION,
		true
	);
	wp_set_script_translations( OPENSTATION_APP_RUNTIME_HANDLE, 'desktop-mode', OPENSTATION_DIR . 'languages' );

	$css_path = OPENSTATION_DIR . 'assets/css/app-runtime.css';
	wp_register_style(
		OPENSTATION_APP_RUNTIME_HANDLE,
		OPENSTATION_URL . 'assets/css/app-runtime.css',
		array( 'os-variables' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : OPENSTATION_VERSION
	);
}
add_action( 'init', 'openstation_apps_register_assets', 5 );

function openstation_apps_path_to_url( $path ) {
	$path    = wp_normalize_path( (string) $path );
	$content = rtrim( wp_normalize_path( WP_CONTENT_DIR ), '/' );
	$root    = rtrim( wp_normalize_path( ABSPATH ), '/' );
	if ( '' !== $content && 0 === strpos( $path, $content . '/' ) ) {
		return content_url( substr( $path, strlen( $content ) ) );
	}
	if ( '' !== $root && 0 === strpos( $path, $root . '/' ) ) {
		return site_url( substr( $path, strlen( $root ) ) );
	}
	return '';
}

function openstation_apps_style_handle( $id ) {
	return 'openstation-app-' . (string) $id;
}

function openstation_apps_client_bundle( array $manifest ) {
	if ( ! empty( $manifest['client'] ) ) {
		return is_file( $manifest['client'] ) ? (string) $manifest['client'] : '';
	}
	$base = openstation_apps_client_base( $manifest );
	if ( '' === $base ) {
		return '';
	}
	$built = OPENSTATION_DIR . 'assets/js/apps/' . $base . openstation_asset_suffix() . '.js';
	return is_file( $built ) ? $built : '';
}

function openstation_apps_client_base( array $manifest ) {
	$file = '';
	foreach ( array( 'client_source', 'file' ) as $key ) {
		if ( ! empty( $manifest[ $key ] ) && is_string( $manifest[ $key ] ) ) {
			$file = $manifest[ $key ];
			break;
		}
	}
	if ( '' === $file ) {
		return '';
	}

	$apps = realpath( OPENSTATION_DIR . 'apps' );
	$dir  = realpath( dirname( $file ) );
	if ( false === $apps || false === $dir ) {
		return '';
	}
	$apps = trailingslashit( wp_normalize_path( $apps ) );
	$dir  = trailingslashit( wp_normalize_path( $dir ) );
	if ( 0 !== strpos( $dir, $apps ) ) {
		return '';
	}

	return (string) preg_replace( '/\.os\.(php|ts)$/', '', basename( $file ) );
}

function openstation_apps_client_config( array $manifest, $bundle = '', $app = null ) {
	$prefetched = array();
	if ( $app instanceof App && ! empty( $manifest['prefetch'] ) && '' !== $bundle ) {

		$prefetched['data'] = $app->compute_data( new App\State( $app->defaults() ), openstation_apps_os() );
	}
	return $prefetched + array(
		'client'          => '' !== $bundle,
		'osApp'           => true,
		'id'              => $manifest['id'],
		'title'           => $manifest['title'],
		'endpoint'        => esc_url_raw( rest_url( 'desktop-mode/v1/apps/' . $manifest['id'] . '/dispatch' ) ),
		'restRoot'        => esc_url_raw( rest_url() ),
		'restNonce'       => wp_create_nonce( 'wp_rest' ),
		'state'           => $manifest['state'],
		'titleBarButtons' => $manifest['title_bar_buttons'],
		'windowActions'   => $manifest['window_actions'],
		'appearance'      => (object) $manifest['appearance'],
		'extra'           => (object) $manifest['config'],
		'actions'         => array_values( (array) $manifest['actions'] ),
		'lifecycle'       => array_values( (array) $manifest['lifecycle'] ),
		'channels'        => (object) $manifest['channels'],
		'watch'           => array_values( (array) $manifest['watch'] ),
		'tabs'            => array_values( (array) $manifest['tabs'] ),
	);
}

function openstation_apps_menu_pages( App $app ) {
	if ( ! $app->menu_owns_dock() ) {
		return array();
	}
	$pages = array();
	foreach ( $app->menu_tabs() as $tab ) {
		if ( '' !== $tab['page'] ) {
			$pages[] = array(
				'id'   => $tab['id'],
				'page' => $tab['page'],
			);
		}
	}
	return $pages;
}

function openstation_apps_render_template( $id, $view = 'main' ) {
	printf(
		'<div class="os-app" data-os-app="%s" data-os-view="%s"><div class="os-app__loading"><os-spinner></os-spinner></div></div>',
		esc_attr( $id ),
		esc_attr( $view )
	);
}

function openstation_apps_register_windows() {
	$os = openstation_apps_os();

	foreach ( openstation_apps_registry()->all() as $app ) {
		if ( ! $app->allows( $os ) ) {
			continue;
		}

		$manifest = (array) apply_filters( 'openstation_app_manifest', $app->manifest(), $app->id(), $app );
		$id       = $app->id();

		$styles = array();
		if ( ! empty( $manifest['style'] ) && is_file( $manifest['style'] ) ) {
			$url = openstation_apps_path_to_url( $manifest['style'] );
			if ( '' !== $url ) {
				wp_register_style(
					openstation_apps_style_handle( $id ),
					$url,
					array( 'os-variables' ),
					(string) filemtime( $manifest['style'] )
				);
				$styles[] = openstation_apps_style_handle( $id );
			}
		}

		$scripts = array();
		$bundle  = openstation_apps_client_bundle( $manifest );
		if ( '' !== $bundle ) {
			$url = openstation_apps_path_to_url( $bundle );
			if ( '' !== $url ) {
				$handle = 'openstation-app-' . $id . '-client';
				wp_register_script( $handle, $url, array( 'wp-i18n' ), (string) filemtime( $bundle ), true );
				wp_set_script_translations( $handle, 'desktop-mode', OPENSTATION_DIR . 'languages' );
				$scripts[] = $handle;
			}
		}

		$window_args = array(
			'title'      => $manifest['title'],
			'icon'       => $manifest['icon'],
			'template'   => static function () use ( $id ) {
				openstation_apps_render_template( $id );
			},
			'script'     => OPENSTATION_APP_RUNTIME_HANDLE,
			'scripts'    => $scripts,

			'styles'     => array_merge( array( OPENSTATION_APP_RUNTIME_HANDLE ), $styles ),
			'width'      => $manifest['width'],
			'height'     => $manifest['height'],
			'min_width'  => $manifest['min_width'],
			'min_height' => $manifest['min_height'],
			'placement'  => $manifest['placement'],
			'nav_kind'   => $manifest['nav_kind'],
			'dock_order' => $manifest['dock_order'],
			'placeable'  => $manifest['placeable'],
			'autofocus'  => $manifest['autofocus'],
			'admin'      => isset( $manifest['admin'] ) ? $manifest['admin'] : 'site',
			'menu_pages' => openstation_apps_menu_pages( $app ),
			'config'     => openstation_apps_client_config( $manifest, $bundle, $app ),
		);

		$window_args = (array) apply_filters( 'openstation_app_window_args', $window_args, $id, $app );

		$registered = openstation_register_window( $id, $window_args );
		if ( is_wp_error( $registered ) ) {

			error_log( sprintf( '[openstation] App "%s" failed to register: %s', $id, $registered->get_error_message() ) );
			continue;
		}

		foreach ( (array) $manifest['tabs'] as $tab ) {
			$tab_value = (string) $tab['value'];
			openstation_register_window_tab(
				$id,
				array(
					'value'    => $tab_value,
					'label'    => (string) $tab['label'],
					'position' => (int) $tab['position'],
					'template' => static function () use ( $id, $tab_value ) {
						openstation_apps_render_template( $id, $tab_value );
					},
				)
			);
		}

		if ( is_array( $manifest['desktop_icon'] ) ) {
			$icon = $manifest['desktop_icon'];
			openstation_register_icon(
				$id,
				array(
					'title'    => isset( $icon['title'] ) ? (string) $icon['title'] : $manifest['title'],
					'icon'     => isset( $icon['icon'] ) ? (string) $icon['icon'] : $manifest['icon'],
					'icon_svg' => isset( $icon['icon'] ) ? '' : (string) $manifest['icon_svg'],
					'window'   => $id,
					'position' => isset( $icon['position'] ) ? (int) $icon['position'] : 100,
					'pinned'   => ! empty( $icon['pinned'] ),
				)
			);
		}

		do_action( 'openstation_app_registered', $id, $manifest );
	}
}
add_action( 'init', 'openstation_apps_register_windows', 20 );

function openstation_apps_allowed_html( $allowed ) {
	$runtime_attrs = array(
		'os-action',
		'os-bind',
		'os-on',
		'os-debounce',
		'os-confirm',
		'os-confirm-title',
		'os-confirm-label',
		'os-confirm-danger',
		'os-poll',
		'os-key',
		'os-preserve',
	);
	foreach ( (array) $allowed as $tag => $attrs ) {
		if ( ! is_array( $attrs ) ) {
			continue;
		}
		foreach ( $runtime_attrs as $attr ) {
			$allowed[ $tag ][ $attr ] = true;
		}
	}
	return $allowed;
}
add_filter( 'openstation_native_window_allowed_html', 'openstation_apps_allowed_html' );

function openstation_app_rest( $method, $route, array $query = array(), array $body = array() ) {
	$request = new WP_REST_Request( strtoupper( (string) $method ), '/' . ltrim( (string) $route, '/' ) );
	if ( array() !== $query ) {
		$request->set_query_params( $query );
	}
	if ( array() !== $body ) {
		$request->set_body_params( $body );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( (string) wp_json_encode( $body ) );
	}

	$server   = rest_get_server();
	$response = rest_do_request( $request );

	$response = apply_filters( 'rest_post_dispatch', rest_ensure_response( $response ), $server, $request );

	if ( $response->is_error() ) {
		$error = $response->as_error();
		return array(
			'ok'     => false,
			'status' => (int) $response->get_status(),
			'data'   => null,
			'total'  => 0,
			'pages'  => 0,
			'error'  => $error ? (string) $error->get_error_message() : '',
			'code'   => $error ? (string) $error->get_error_code() : '',
		);
	}

	$embed   = isset( $query['_embed'] ) ? rest_parse_embed_param( $query['_embed'] ) : false;
	$data    = $server->response_to_data( $response, $embed );
	$headers = $response->get_headers();
	return array(
		'ok'     => true,
		'status' => (int) $response->get_status(),
		'data'   => $data,

		'total'  => isset( $headers['X-WP-Total'] ) ? (int) $headers['X-WP-Total'] : ( wp_is_numeric_array( $data ) ? count( $data ) : 1 ),
		'pages'  => isset( $headers['X-WP-TotalPages'] ) ? (int) $headers['X-WP-TotalPages'] : 1,
		'error'  => '',
		'code'   => '',
	);
}

function openstation_app_rest_page( $route, array $query = array() ) {
	$page              = isset( $query['page'] ) ? max( 1, (int) $query['page'] ) : 1;
	$per_page          = isset( $query['per_page'] ) ? max( 1, (int) $query['per_page'] ) : 20;
	$query['page']     = $page;
	$query['per_page'] = $per_page;
	$result            = openstation_app_rest( 'GET', $route, $query );
	$items    = $result['ok'] && is_array( $result['data'] ) ? array_values( $result['data'] ) : array();
	$envelope = Os::page( $items, $result['ok'] ? $result['total'] : 0, $page, $per_page );
	if ( $result['ok'] ) {
		$envelope['pages'] = max( 1, (int) $result['pages'] );
	}
	$envelope['error'] = $result['ok'] ? '' : (string) $result['error'];
	$envelope['code']  = $result['ok'] ? '' : (string) $result['code'];
	return $envelope;
}

function openstation_app_rest_page_is_out_of_range( array $envelope ) {
	if ( array() !== $envelope['items'] ) {
		return false;
	}
	$code = isset( $envelope['code'] ) ? (string) $envelope['code'] : '';
	return '' === $code || false !== strpos( $code, 'invalid_page_number' );
}

function openstation_apps_register_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/apps/(?P<app>[a-z0-9][a-z0-9_-]*)/dispatch',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_apps_rest_dispatch',
			'permission_callback' => 'openstation_apps_rest_permission',
			'args'                => array(
				'action' => array(
					'description' => 'Action name, or `mount` for the first render.',
					'type'        => 'string',
					'required'    => true,
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_apps_register_routes' );

function openstation_apps_rest_permission( WP_REST_Request $request ) {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'openstation_app_unauthorized',
			__( 'You must be logged in to use this window.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
	$app = openstation_app( (string) $request['app'] );
	if ( ! $app ) {
		return new WP_Error( 'openstation_app_not_found', __( 'Unknown app.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( ! $app->allows( openstation_apps_os() ) ) {
		return new WP_Error( 'openstation_app_forbidden', __( 'You are not allowed to use this window.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	return true;
}

function openstation_apps_rest_error( array $failure ) {
	$messages = array(
		'not_found'      => __( 'Unknown app.', 'desktop-mode' ),
		'forbidden'      => __( 'You are not allowed to use this window.', 'desktop-mode' ),
		'unknown_action' => __( 'This window does not know that action.', 'desktop-mode' ),
		'unknown_view'   => __( 'This window does not have that tab.', 'desktop-mode' ),
	);
	$code     = isset( $failure['error'] ) ? (string) $failure['error'] : 'failed';
	$message  = isset( $messages[ $code ] ) ? $messages[ $code ] : (string) $failure['message'];
	return new WP_Error(
		'openstation_app_' . $code,
		$message,
		array( 'status' => isset( $failure['status'] ) ? (int) $failure['status'] : 500 )
	);
}

function openstation_apps_rest_dispatch( WP_REST_Request $request ) {
	$body = $request->get_json_params();
	$body = is_array( $body ) ? $body : array();

	$result = openstation_apps_runtime()->dispatch(
		(string) $request['app'],
		array(
			'action' => (string) $request->get_param( 'action' ),
			'view'   => isset( $body['view'] ) ? (string) $body['view'] : 'main',
			'state'  => isset( $body['state'] ) && is_array( $body['state'] ) ? $body['state'] : array(),
			'args'   => isset( $body['args'] ) && is_array( $body['args'] ) ? $body['args'] : array(),
			'params' => isset( $body['params'] ) && is_array( $body['params'] ) ? $body['params'] : array(),
			'client' => isset( $body['client'] ) && is_array( $body['client'] ) ? $body['client'] : array(),
		),
		openstation_apps_os()
	);

	if ( empty( $result['ok'] ) ) {
		return openstation_apps_rest_error( $result );
	}
	return rest_ensure_response( $result );
}
