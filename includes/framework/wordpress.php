<?php
/**
 * OpenStation App Framework — the WordPress host.
 *
 * Everything that couples the host-agnostic framework to WordPress
 * lives in this one file plus the adapters in `app/wordpress/`:
 *
 *   - `init` @5   registers the shared client runtime script.
 *   - `init` @10  loads every `.os.php` under the app directories
 *                 (`apps/` in this plugin, more via the
 *                 `openstation_apps_directories` filter) and fires
 *                 `openstation_apps_loaded` so plugins can add
 *                 `App` objects built in code.
 *   - `init` @20  turns each allowed app into a native window (and
 *                 a desktop icon when it asked for one) through the
 *                 same `openstation_register_window()` /
 *                 `openstation_register_icon()` any plugin uses.
 *   - REST        `POST desktop-mode/v1/apps/<id>/dispatch` moves a
 *                 dispatch in and a response out of `App\Runtime`.
 *
 * Every app shares ONE script: `assets/js/app-runtime[.min].js`. It
 * mounts the window, sends actions, morphs the returned markup into
 * place and performs effects. An app ships no JavaScript of its own.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/autoload.php';

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\Registry;
use OpenStation\App\Runtime;

/** Script handle of the shared client runtime. */
const OPENSTATION_APP_RUNTIME_HANDLE = 'openstation-app-runtime';

/**
 * The app registry — one per request.
 *
 * @return Registry
 */
function openstation_apps_registry() {
	static $registry = null;
	if ( null === $registry ) {
		$registry = new Registry();
	}
	return $registry;
}

/**
 * The dispatch runtime bound to {@see openstation_apps_registry()}.
 *
 * @return Runtime
 */
function openstation_apps_runtime() {
	static $runtime = null;
	if ( null === $runtime ) {
		$runtime = new Runtime( openstation_apps_registry() );
	}
	return $runtime;
}

/**
 * The `$os` handle for the current request: WordPress adapters all
 * the way down.
 *
 * @return Os
 */
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

/**
 * Look a registered app up by id.
 *
 * @param string $id App id.
 * @return App|null
 */
function openstation_app( $id ) {
	return openstation_apps_registry()->get( $id );
}

/**
 * The whole window as a value: manifest, state after `mount`, body
 * HTML and effects — what a host calls to render an app somewhere
 * other than the desktop (a REST consumer, a CLI, a test).
 *
 * @param string              $id    App id.
 * @param array<string,mixed> $state Partial state; declared defaults fill the rest.
 * @return array<string,mixed> See {@see Runtime::describe()}.
 */
function openstation_app_render( $id, array $state = array() ) {
	return openstation_apps_runtime()->describe( $id, $state, openstation_apps_os() );
}

/**
 * Directories scanned for `.os.php` files.
 *
 * @return string[] Absolute paths.
 */
function openstation_apps_directories() {
	$dirs = array( rtrim( OPENSTATION_DIR, '/\\' ) . '/apps' );

	/**
	 * Filter the directories the App Framework loads `.os.php`
	 * files from. Append your plugin's folder to ship apps as files.
	 *
	 * @param string[] $dirs Absolute directory paths.
	 */
	return array_values( array_unique( array_filter( array_map( 'strval', (array) apply_filters( 'openstation_apps_directories', $dirs ) ) ) ) );
}

/**
 * Load every app file, then let plugins add apps built in code.
 */
function openstation_apps_load() {
	$registry = openstation_apps_registry();
	foreach ( openstation_apps_directories() as $dir ) {
		$registry->load_dir( $dir );
	}

	/**
	 * Fires once every `.os.php` has been loaded. Add an `App`
	 * defined in code with `$registry->add( App::define( … ) )`.
	 *
	 * @param Registry $registry The app registry.
	 */
	do_action( 'openstation_apps_loaded', $registry );
}
add_action( 'init', 'openstation_apps_load', 10 );

/**
 * Register the shared runtime script. Never enqueued eagerly — the
 * native-window sync loads it the first time any app window opens.
 */
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

	// The root every app mounts into, and its first-paint spinner.
	$css_path = OPENSTATION_DIR . 'assets/css/app-runtime.css';
	wp_register_style(
		OPENSTATION_APP_RUNTIME_HANDLE,
		OPENSTATION_URL . 'assets/css/app-runtime.css',
		array( 'os-variables' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : OPENSTATION_VERSION
	);
}
add_action( 'init', 'openstation_apps_register_assets', 5 );

/**
 * Map an absolute path inside the install to its URL, or '' when the
 * file lives outside anything WordPress serves.
 *
 * @param string $path Absolute file path.
 * @return string URL or ''.
 */
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

/**
 * The style handle an app's stylesheet registers under.
 *
 * @param string $id App id.
 * @return string
 */
function openstation_apps_style_handle( $id ) {
	return 'openstation-app-' . (string) $id;
}

/**
 * The built client-view bundle for an app, or '' when it has none.
 *
 * An explicit `App::client( $path )` wins. Otherwise an app that
 * ships `<file>.os.ts` beside its `.os.php` inside this plugin is
 * built by `npm run build:apps` into `assets/js/apps/<file>[.min].js`.
 *
 * @param array<string,mixed> $manifest Filtered manifest.
 * @return string Absolute path of the built script, or ''.
 */
function openstation_apps_client_bundle( array $manifest ) {
	if ( ! empty( $manifest['client'] ) ) {
		return is_file( $manifest['client'] ) ? (string) $manifest['client'] : '';
	}
	if ( empty( $manifest['client_source'] ) ) {
		return '';
	}
	$name  = preg_replace( '/\.os\.ts$/', '', basename( (string) $manifest['client_source'] ) );
	$built = OPENSTATION_DIR . 'assets/js/apps/' . $name . openstation_asset_suffix() . '.js';
	return is_file( $built ) ? $built : '';
}

/**
 * The config blob the client runtime reads through
 * `wp.os.getWindowConfig( id )`.
 *
 * @param array<string,mixed> $manifest Filtered manifest.
 * @param string              $bundle   Resolved client bundle path, from
 *                                      {@see openstation_apps_client_bundle()}.
 * @return array<string,mixed>
 */
function openstation_apps_client_config( array $manifest, $bundle = '' ) {
	return array(
		'client'          => '' !== $bundle,
		'osApp'           => true,
		'id'              => $manifest['id'],
		'title'           => $manifest['title'],
		'endpoint'        => esc_url_raw( rest_url( 'desktop-mode/v1/apps/' . $manifest['id'] . '/dispatch' ) ),
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

/**
 * The static template the shell clones on open: a root the runtime
 * mounts into, showing a spinner until the first render lands. One
 * per view — the main body and each tab panel get their own.
 *
 * @param string $id   App id.
 * @param string $view `main` or a tab slug.
 */
function openstation_apps_render_template( $id, $view = 'main' ) {
	printf(
		'<div class="os-app" data-os-app="%s" data-os-view="%s"><div class="os-app__loading"><os-spinner></os-spinner></div></div>',
		esc_attr( $id ),
		esc_attr( $view )
	);
}

/**
 * Turn every allowed app into a native window (+ desktop icon).
 */
function openstation_apps_register_windows() {
	$os = openstation_apps_os();

	foreach ( openstation_apps_registry()->all() as $app ) {
		if ( ! $app->allows( $os ) ) {
			continue;
		}

		/**
		 * Filter an app's manifest before it is registered with the
		 * shell — size, icon, title-bar buttons, chrome, anything.
		 *
		 * @param array<string,mixed> $manifest See `App::manifest()`.
		 * @param string              $id       App id.
		 * @param App                 $app      The app.
		 */
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

		// The `.os.ts` half rides as a companion script: loaded with the
		// window, before the runtime mounts it, never at boot.
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

		$registered = openstation_register_window(
			$id,
			array(
				'title'      => $manifest['title'],
				'icon'       => $manifest['icon'],
				'template'   => static function () use ( $id ) {
					openstation_apps_render_template( $id );
				},
				'script'     => OPENSTATION_APP_RUNTIME_HANDLE,
				'scripts'    => $scripts,
				// Both sheets travel as first-open companions — nothing
				// an app window paints is needed on a page that never
				// opens it (see tests/phpunit/tests/deferredWindowStyles.php).
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
				'config'     => openstation_apps_client_config( $manifest, $bundle ),
			)
		);
		if ( is_wp_error( $registered ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
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

		/**
		 * Fires after an app has been registered as a native window.
		 *
		 * @param string              $id       App id.
		 * @param array<string,mixed> $manifest The manifest as registered.
		 */
		do_action( 'openstation_app_registered', $id, $manifest );
	}
}
add_action( 'init', 'openstation_apps_register_windows', 20 );

/**
 * Admit the runtime's attributes on every tag kses sees in a
 * native-window template, so a plugin that renders an app-style
 * body straight into a `template` callback keeps its triggers.
 * (`wp_kses` only wildcards `data-*`, so `os-arg-<name>` attributes
 * survive kses solely on the dispatch path, which is not kses'd —
 * where every app body normally comes from.)
 *
 * @param array $allowed kses allowlist.
 * @return array
 */
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

// ------------------------------------------------------------------ REST

/**
 * Register the dispatch route.
 */
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

/**
 * Permission: the app must exist and admit the acting user.
 *
 * @param WP_REST_Request $request Request.
 * @return true|WP_Error
 */
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

/**
 * Translate a runtime failure into a `WP_Error`.
 *
 * @param array<string,mixed> $failure `error`, `message`, `status`.
 * @return WP_Error
 */
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

/**
 * `POST /apps/<id>/dispatch`.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
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
