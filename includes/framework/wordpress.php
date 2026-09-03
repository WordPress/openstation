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
 * Whether this request is an app dispatch (`POST …/apps/<id>/dispatch`).
 *
 * Sniffed from the request URI because callers need the answer DURING
 * `init` — before the REST server has parsed the route. Both REST URL
 * shapes are covered (`/wp-json/…` and `?rest_route=…`).
 *
 * @return bool
 */
function openstation_apps_is_dispatch_request() {
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Substring probe only; never stored or echoed.
	return false !== strpos( $uri, 'desktop-mode/v1/apps/' );
}

/**
 * An app dispatch renders admin UI, so request-scoped facts that are
 * normally collected on admin requests only must be collected here
 * too. First case: the CPT/taxonomy → registering-plugin map
 * (`openstation_track_type_registrants` defaults to `is_admin()`),
 * which My WordPress reads to fold plugin CPTs into plugin folders —
 * without this, every CPT rendered loose in a dispatch while the same
 * site grouped them on an admin page load.
 *
 * @param bool $track Whether to track.
 * @return bool
 */
function openstation_apps_track_registrants( $track ) {
	return $track || openstation_apps_is_dispatch_request();
}
add_filter( 'openstation_track_type_registrants', 'openstation_apps_track_registrants' );

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
 * An explicit `App::client( $path )` wins. Otherwise an app inside
 * this plugin's own `apps/` is looked up by convention: `npm run
 * build:apps` compiles `apps/<dir>/<file>.os.ts` into
 * `assets/js/apps/<file>[.min].js`, and that bundle is what ships.
 *
 * @param array<string,mixed> $manifest Filtered manifest.
 * @return string Absolute path of the built script, or ''.
 */
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

/**
 * The name an app's by-convention client bundle is built under, or ''
 * for an app that has no such bundle.
 *
 * The bundle is named after the definition file: `<file>.os.php` and
 * `<file>.os.ts` share a base, and the build writes
 * `assets/js/apps/<file>[.min].js`. So the name is read off the
 * `.os.php`, the one file a release install is guaranteed to have.
 * The `.os.ts` is source: `.gitattributes` export-ignores every `.ts`
 * under `apps/`, and `bin/package.sh` splices the built bundle into
 * the zip in its place. Keying the lookup on the source's presence is
 * how every client-view window (Preferences, WP Explorer, Code Blue,
 * the Recycle Bin) came to open empty on a packaged site: the host
 * shipped `client: false`, and the runtime asked the server for a
 * view those apps do not have.
 *
 * Only apps under this plugin's `apps/` qualify. That is the directory
 * the build walks, and an app another plugin ships through
 * `openstation_apps_directories` declares its bundle with
 * `App::client()`: a shared file name must never hand it ours.
 *
 * @param array<string,mixed> $manifest Filtered manifest.
 * @return string Bundle base name (`code-blue`), or ''.
 */
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

/**
 * The config blob the client runtime reads through
 * `wp.os.getWindowConfig( id )`.
 *
 * @param array<string,mixed> $manifest Filtered manifest.
 * @param string              $bundle   Resolved client bundle path, from
 *                                      {@see openstation_apps_client_bundle()}.
 * @param App|null            $app      The app, for a prefetched `data()`
 *                                      (`App::prefetch()`); null ships none.
 * @return array<string,mixed>
 */
function openstation_apps_client_config( array $manifest, $bundle = '', $app = null ) {
	$prefetched = array();
	if ( $app instanceof App && ! empty( $manifest['prefetch'] ) && '' !== $bundle ) {
		// The declared state and the request's host handle — the same
		// inputs `mount` gets, minus the open-time params a deep link
		// carries (the runtime waits for `mount` in that case).
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

		$window_args = array(
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
			'admin'      => isset( $manifest['admin'] ) ? $manifest['admin'] : 'site',
			'config'     => openstation_apps_client_config( $manifest, $bundle, $app ),
		);

		/**
		 * Filter the window-registration args an app's manifest
		 * produced, just before `openstation_register_window()` runs.
		 *
		 * The seam a companion plugin uses to ride an app window it
		 * doesn't own — appending registered `scripts` / `styles`
		 * handles (an integration bundle that decorates the app
		 * through its JS hook seams, loaded on first open and never
		 * sooner) — or to tune any other registration arg.
		 *
		 * **Status: Experimental**
		 *
		 * @param array<string,mixed> $window_args `openstation_register_window()` args.
		 * @param string              $id          App id.
		 * @param App                 $app         The app.
		 */
		$window_args = (array) apply_filters( 'openstation_app_window_args', $window_args, $id, $app );

		$registered = openstation_register_window( $id, $window_args );
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
 * Run a REST request in-process and hand back what the browser would
 * have received: the same controller, the same permission checks,
 * every `register_rest_field()` a plugin added, `_fields` applied and
 * `_embed` expanded — minus the HTTP round trip.
 *
 * This is how a list app's `data()` reads the collections WordPress
 * already knows how to serve (`wp/v2/posts`, `wp/v2/users`,
 * `wp/v2/comments`, `wp/v2/plugins`) instead of re-implementing a
 * query per window: the filters plugin authors already hook
 * (`rest_post_query`, the REST fields, the `_fields` projections the
 * `openstation_*_window_query_args` filters shape) keep working
 * because the request IS a REST request. `rest_do_request()` alone
 * skips `rest_post_dispatch`, which is where `_fields` is applied,
 * and never embeds; this helper does both, the way Core's own
 * `embed_links()` replays them for a sub-request.
 *
 * Two things to know: it needs the REST server (`rest_get_server()`
 * boots it on demand, so call it from a `data()` or an action — a
 * `prefetch()`ed `data()` would boot it on every admin page load);
 * and because `_fields` runs before the embed, a projected collection
 * keeps its `_embedded` only when `_fields` names `_links,_embedded`.
 *
 * @param string              $method `GET` | `POST` | `DELETE` | ….
 * @param string              $route  Route below the REST root (`wp/v2/posts`).
 * @param array<string,mixed> $query  Query params (`per_page`, `_fields`, `_embed`, …).
 * @param array<string,mixed> $body   Body params for a write.
 * @return array{ok:bool,status:int,data:mixed,total:int,pages:int,error:string,code:string}
 */
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
	/** This filter is documented in wp-includes/rest-api/class-wp-rest-server.php */
	$response = apply_filters( 'rest_post_dispatch', rest_ensure_response( $response ), $server, $request ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Core's own post-dispatch pass (`_fields`), replayed for an in-process request.

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
		// A collection reports its total in the header; a single
		// resource is one thing, however many fields it has.
		'total'  => isset( $headers['X-WP-Total'] ) ? (int) $headers['X-WP-Total'] : ( wp_is_numeric_array( $data ) ? count( $data ) : 1 ),
		'pages'  => isset( $headers['X-WP-TotalPages'] ) ? (int) $headers['X-WP-TotalPages'] : 1,
		'error'  => '',
		'code'   => '',
	);
}

/**
 * A REST collection as the paged-list envelope a client view renders
 * from — {@see \OpenStation\App\Os::page()} — plus `error` and `code`
 * keys ('' on success) so a list can paint "could not load" instead of
 * an empty table when the collection refused the request, and tell a
 * page past the end (`rest_post_invalid_page_number` and its siblings —
 * {@see openstation_app_rest_page_is_out_of_range()}) from a refusal.
 *
 * `page` and `per_page` are read from `$query` and default to 1 / 20;
 * the defaults are sent with the request too, so the page the envelope
 * describes is the page the controller served.
 *
 * @param string              $route Route below the REST root.
 * @param array<string,mixed> $query Query params.
 * @return array{items:array<int,mixed>,total:int,pages:int,page:int,perPage:int,error:string,code:string}
 */
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

/**
 * Whether a page envelope came back empty because the page is past
 * the end — Core refuses one outright (`rest_post_invalid_page_number`,
 * `rest_user_invalid_page_number`, `rest_comment_invalid_page_number`)
 * — as opposed to a refusal a list must surface. The typical cause is
 * the user on page 7 raising the page size; the typical answer is to
 * land on page 1 silently.
 *
 * @param array<string,mixed> $envelope From {@see openstation_app_rest_page()}.
 * @return bool
 */
function openstation_app_rest_page_is_out_of_range( array $envelope ) {
	if ( array() !== $envelope['items'] ) {
		return false;
	}
	$code = isset( $envelope['code'] ) ? (string) $envelope['code'] : '';
	return '' === $code || false !== strpos( $code, 'invalid_page_number' );
}

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
