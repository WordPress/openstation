<?php
/**
 * Tests for the App Framework: the host-agnostic core (State,
 * Registry, Runtime, App manifest) and the WordPress host (window +
 * icon registration, the dispatch REST route, the kses allowlist).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group app-framework
 */

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\Registry;
use OpenStation\App\Runtime;
use OpenStation\App\State;
use OpenStation\App\Standalone\Auth as StandaloneAuth;

class Tests_OpenStation_AppFramework extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;

	/**
	 * Temp files/dirs removed on tear_down.
	 *
	 * @var string[]
	 */
	protected $temp_paths = array();

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function tear_down() {
		foreach ( array_reverse( $this->temp_paths ) as $path ) {
			if ( is_dir( $path ) ) {
				foreach ( (array) glob( $path . '/*' ) as $file ) {
					unlink( $file );
				}
				rmdir( $path );
			} elseif ( file_exists( $path ) ) {
				unlink( $path );
			}
		}
		$this->temp_paths = array();
		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			if ( 0 === strpos( $id, 'demo-host' ) ) {
				openstation_apps_registry()->remove( $id );
				// The desktop-icon registry is process-scoped, so an icon
				// this class registered through
				// `openstation_apps_register_windows()` would otherwise
				// count as an unplaced shortcut in every later test —
				// `Tests_OpenStation_FilesStore`'s auto-place expectations
				// are the ones that notice.
				openstation_unregister_icon( $id );
			}
		}
		parent::tear_down();
	}

	/**
	 * A small app: a counter with a title-bar button, a gated variant,
	 * and an action that throws.
	 *
	 * @param string $id App id.
	 * @return App
	 */
	protected function demo_app( $id = 'demo' ) {
		return App::define( $id )
			->title( 'Demo' )
			->size( 300, 200 )
			->state(
				array(
					'count' => 0,
					'label' => 'hi',
					'flags' => array(),
				)
			)
			->title_bar_button(
				'bump',
				array(
					'label'  => 'Bump',
					'action' => 'bump',
					'icon'   => 'reload',
				)
			)
			->window_action(
				'reset',
				array(
					'label'   => 'Reset',
					'action'  => 'reset',
					'confirm' => 'Really?',
				)
			)
			->action(
				'bump',
				static function ( State $state, Os $os, array $args ) {
					$state->set( 'count', $state->get( 'count' ) + (int) ( $args['by'] ?? 1 ) );
					$os->toast( 'Bumped' );
				}
			)
			->action(
				'reset',
				static function ( State $state ) {
					$state->reset( 'count' );
				}
			)
			->action(
				'explode',
				static function () {
					throw new RuntimeException( 'kaboom' );
				}
			)
			->view(
				static function ( State $state ) {
					return '<os-display value="' . (int) $state->get( 'count' ) . '"></os-display><p>' . htmlspecialchars( $state->get( 'label' ) ) . '</p>';
				}
			);
	}

	// ------------------------------------------------------------- State

	/**
	 * @covers \OpenStation\App\State::__construct
	 */
	public function test_state_admits_only_declared_keys_and_coerces_types() {
		$state = new State(
			array(
				'count' => 0,
				'on'    => false,
				'name'  => '',
				'list'  => array(),
			),
			array(
				'count'  => '7',
				'on'     => 'true',
				'name'   => 12,
				'list'   => 'not-a-list',
				'rogue'  => 'x',
				'onmore' => 1,
			)
		);
		$this->assertSame( 7, $state->get( 'count' ) );
		$this->assertTrue( $state->get( 'on' ) );
		$this->assertSame( '12', $state->get( 'name' ) );
		$this->assertSame( array(), $state->get( 'list' ), 'A non-array falls back to the declared default.' );
		$this->assertNull( $state->get( 'rogue' ) );
		$this->assertArrayNotHasKey( 'rogue', $state->all() );
	}

	/**
	 * @covers \OpenStation\App\State::__construct
	 * @covers \OpenStation\App\State::contains
	 */
	public function test_state_typing_is_top_level_only_for_array_keys() {
		$state = new State(
			array( 'list' => array() ),
			array( 'list' => array( 'nested' => array( 'deep' => array( 'x', 'y' ) ) ) )
		);
		// Documented limit, not an accident: an `array()` default is a
		// shape check and nothing more, so a client can put any JSON
		// object of any depth behind that key. `docs/app-framework.md`
		// tells app authors to validate the shape themselves before
		// indexing into a state array — this pins the behaviour that
		// warning is about.
		$this->assertSame(
			array( 'nested' => array( 'deep' => array( 'x', 'y' ) ) ),
			$state->get( 'list' )
		);
		$this->assertFalse( $state->contains( 'list', 'x' ), 'A nested map is not a flat list.' );
	}

	/**
	 * @covers \OpenStation\App\State::toggle_item
	 */
	public function test_state_toggle_item_adds_then_removes() {
		$state = new State( array( 'open' => array() ) );
		$state->toggle_item( 'open', 'a' )->toggle_item( 'open', 'b' );
		$this->assertTrue( $state->contains( 'open', 'a' ) );
		$state->toggle_item( 'open', 'a' );
		$this->assertSame( array( 'b' ), $state->get( 'open' ) );
		$state->set( 'nope', 1 );
		$this->assertFalse( $state->has( 'nope' ) );
	}

	// ---------------------------------------------------------- Registry

	/**
	 * @covers \OpenStation\App\Registry::load_dir
	 */
	public function test_registry_loads_app_files_and_resolves_the_conventional_stylesheet() {
		$dir = trailingslashit( get_temp_dir() ) . 'os-apps-' . wp_generate_password( 6, false );
		mkdir( $dir );
		mkdir( $dir . '/nested' );
		// tear_down walks this list in reverse: files, then the nested
		// directory, then the parent.
		$this->temp_paths[] = $dir;
		$this->temp_paths[] = $dir . '/nested';

		file_put_contents( $dir . '/flat.os.php', '<?php return OpenStation\App::define( "flat-app" )->title( "Flat" )->view( static function () { echo "flat"; } );' );
		file_put_contents( $dir . '/nested/nested.os.php', '<?php return OpenStation\App::define( "nested-app" )->title( "Nested" )->view( static function () { echo "nested"; } );' );
		file_put_contents( $dir . '/nested/nested-app.css', '.x{}' );
		file_put_contents( $dir . '/flat.css', '.y{}' );
		file_put_contents( $dir . '/ignored.php', '<?php return OpenStation\App::define( "ignored" )->title( "No" );' );
		$this->temp_paths[] = $dir . '/flat.os.php';
		$this->temp_paths[] = $dir . '/nested/nested.os.php';
		$this->temp_paths[] = $dir . '/nested/nested-app.css';
		$this->temp_paths[] = $dir . '/flat.css';
		$this->temp_paths[] = $dir . '/ignored.php';

		$registry = new Registry();
		$loaded   = $registry->load_dir( $dir );

		$this->assertCount( 2, $loaded );
		$this->assertTrue( $registry->has( 'flat-app' ) );
		$this->assertTrue( $registry->has( 'nested-app' ) );
		$this->assertFalse( $registry->has( 'ignored' ) );
		$this->assertSame( realpath( $dir . '/nested/nested-app.css' ), realpath( $registry->get( 'nested-app' )->style_path() ), 'By app id.' );
		$this->assertSame( realpath( $dir . '/flat.css' ), realpath( $registry->get( 'flat-app' )->style_path() ), 'By the definition file name.' );

		// A second load of the same directory is a no-op, not a redeclare.
		$this->assertCount( 2, $registry->load_dir( $dir ) );
	}

	// ----------------------------------------------------------- Runtime

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_runtime_mount_renders_the_view_with_defaults() {
		$registry = new Registry();
		$registry->add( $this->demo_app() );
		$runtime  = new Runtime( $registry );
		$response = $runtime->dispatch( 'demo', array( 'action' => 'mount' ), Os::standalone() );

		$this->assertTrue( $response['ok'] );
		$this->assertSame( 0, $response['state']['count'] );
		$this->assertStringContainsString( '<os-display value="0">', $response['html'] );
		$this->assertSame( array(), $response['effects'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_runtime_runs_an_action_with_client_state_and_args_and_returns_effects() {
		$registry = new Registry();
		$registry->add( $this->demo_app() );
		$runtime  = new Runtime( $registry );
		$response = $runtime->dispatch(
			'demo',
			array(
				'action' => 'bump',
				'state'  => array(
					'count' => 5,
					'label' => '<b>x</b>',
				),
				'args'   => array( 'by' => '3' ),
			),
			Os::standalone()
		);

		$this->assertTrue( $response['ok'] );
		$this->assertSame( 8, $response['state']['count'] );
		$this->assertStringContainsString( '<os-display value="8">', $response['html'] );
		$this->assertStringContainsString( '&lt;b&gt;x&lt;/b&gt;', $response['html'] );
		$this->assertSame(
			array(
				array(
					'type'    => 'toast',
					'message' => 'Bumped',
				),
			),
			$response['effects']
		);
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_runtime_set_rerenders_bound_state_without_a_handler() {
		$registry = new Registry();
		$registry->add( $this->demo_app() );
		$runtime  = new Runtime( $registry );
		$response = $runtime->dispatch(
			'demo',
			array(
				'action' => 'set',
				'state'  => array( 'label' => 'bound' ),
			),
			Os::standalone()
		);
		$this->assertTrue( $response['ok'] );
		$this->assertStringContainsString( '<p>bound</p>', $response['html'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_runtime_failures_carry_codes_and_statuses() {
		$registry = new Registry();
		$registry->add( $this->demo_app() );
		$registry->add( $this->demo_app( 'locked' )->can( '__return_false' ) );
		$runtime = new Runtime( $registry );
		$os      = Os::standalone();

		$missing = $runtime->dispatch( 'nope', array( 'action' => 'mount' ), $os );
		$this->assertFalse( $missing['ok'] );
		$this->assertSame( array( 'not_found', 404 ), array( $missing['error'], $missing['status'] ) );

		$unknown = $runtime->dispatch( 'demo', array( 'action' => 'fly' ), $os );
		$this->assertSame( array( 'unknown_action', 400 ), array( $unknown['error'], $unknown['status'] ) );

		$locked = $runtime->dispatch( 'locked', array( 'action' => 'mount' ), $os );
		$this->assertSame( array( 'forbidden', 403 ), array( $locked['error'], $locked['status'] ) );

		$anonymous = $runtime->dispatch( 'demo', array( 'action' => 'mount' ), Os::standalone( array( 'auth' => new StandaloneAuth( 0 ) ) ) );
		$this->assertSame( 'forbidden', $anonymous['error'] );

		$thrown = $runtime->dispatch( 'demo', array( 'action' => 'explode' ), $os );
		$this->assertSame( array( 'action_failed', 500, 'kaboom' ), array( $thrown['error'], $thrown['status'], $thrown['message'] ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::describe
	 */
	public function test_runtime_describe_returns_the_whole_window() {
		$registry = new Registry();
		$registry->add( $this->demo_app() );
		$runtime = new Runtime( $registry );
		$whole   = $runtime->describe( 'demo', array( 'count' => 2 ), Os::standalone() );

		$this->assertTrue( $whole['ok'] );
		$this->assertSame( 'demo', $whole['manifest']['id'] );
		$this->assertSame( 300, $whole['manifest']['width'] );
		$this->assertSame( 2, $whole['state']['count'] );
		$this->assertStringContainsString( '<os-display value="2">', $whole['html'] );
	}

	// ---------------------------------------------------------- Manifest

	/**
	 * @covers \OpenStation\App::manifest
	 */
	public function test_manifest_normalises_chrome_declarations() {
		$manifest = $this->demo_app()->manifest();

		$this->assertSame( array( 'bump', 'reset', 'explode' ), $manifest['actions'] );
		$this->assertSame( 'right', $manifest['title_bar_buttons'][0]['placement'] );
		$this->assertSame( 'reload', $manifest['title_bar_buttons'][0]['icon'] );
		$this->assertNull( $manifest['title_bar_buttons'][0]['confirm'] );
		$this->assertSame( array( 'message' => 'Really?' ), $manifest['window_actions'][0]['confirm'] );
		$this->assertArrayNotHasKey( 'placement', $manifest['window_actions'][0] );
		$this->assertSame( 'dock', $manifest['placement'] );
	}

	/**
	 * @covers \OpenStation\App::tab
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_tabs_render_their_own_view_and_report_it_on_os() {
		$app = $this->demo_app()
			->tab(
				'log',
				array(
					'label'    => 'Log',
					'position' => 5,
					'view'     => static function ( State $state, Os $os ) {
						echo '<p>tab:' . htmlspecialchars( $os->view ) . ':' . (int) $state->get( 'count' ) . '</p>';
					},
				)
			)
			->action(
				'which',
				static function ( State $state, Os $os ) {
					$state->set( 'label', $os->view );
				}
			);
		$registry = new Registry();
		$registry->add( $app );
		$runtime = new Runtime( $registry );
		$os      = Os::standalone();

		$this->assertSame( array( array( 'value' => 'log', 'label' => 'Log', 'position' => 5 ) ), $app->manifest()['tabs'] );

		$main = $runtime->dispatch( 'demo', array( 'action' => 'mount' ), $os );
		$this->assertStringContainsString( '<os-display', $main['html'] );

		$tab = $runtime->dispatch( 'demo', array( 'action' => 'which', 'view' => 'log', 'state' => array( 'count' => 4 ) ), $os );
		$this->assertTrue( $tab['ok'] );
		$this->assertSame( '<p>tab:log:4</p>', $tab['html'] );
		$this->assertSame( 'log', $tab['state']['label'] );

		$missing = $runtime->dispatch( 'demo', array( 'action' => 'mount', 'view' => 'nope' ), $os );
		$this->assertSame( array( 'unknown_view', 400 ), array( $missing['error'], $missing['status'] ) );

		$whole = $runtime->describe( 'demo', array( 'count' => 1 ), $os );
		$this->assertSame( array( 'log' => '<p>tab:log:1</p>' ), $whole['tabs'] );
	}

	/**
	 * @covers \OpenStation\App\Os::param
	 * @covers \OpenStation\App\Os::store
	 */
	public function test_params_and_storage_reach_the_app_through_os() {
		$app = $this->demo_app()
			->action(
				'remember',
				static function ( State $state, Os $os ) {
					$os->store( 'last', $os->param( 'post', 0 ) );
					$state->set( 'label', 'saw:' . $os->param( 'post', 'none' ) . ':' . $os->stored( 'last' ) . ':' . $os->client['width'] );
				}
			);
		$registry = new Registry();
		$registry->add( $app );
		$runtime = new Runtime( $registry );
		$os      = Os::standalone();

		$response = $runtime->dispatch(
			'demo',
			array(
				'action' => 'remember',
				'params' => array( 'post' => 42, 'nested' => array( 'dropped' ) ),
				'client' => array( 'width' => 800, 'height' => 600 ),
			),
			$os
		);
		$this->assertSame( 'saw:42:42:800', $response['state']['label'] );
		$this->assertSame( 42, $os->storage->get( 'user', 'demo:last' ), 'Storage keys are namespaced by app id.' );
		$this->assertSame( array( 'post' => 42 ), $os->params, 'Only scalar params are kept.' );
	}

	/**
	 * @covers \OpenStation\App\WordPress\Store
	 */
	public function test_wordpress_store_round_trips_user_and_site_scopes() {
		wp_set_current_user( self::$admin_id );
		$store = new OpenStation\App\WordPress\Store();
		$store->set( 'user', 'demo:a', array( 'x' => 1 ) );
		$store->set( 'site', 'demo:b', 'shared' );
		$this->assertSame( array( 'x' => 1 ), $store->get( 'user', 'demo:a' ) );
		$this->assertSame( 'shared', $store->get( 'site', 'demo:b' ) );
		$this->assertNull( $store->get( 'user', 'demo:b' ) );
		wp_set_current_user( self::$editor_id );
		$this->assertNull( $store->get( 'user', 'demo:a' ), 'User scope is per user.' );
		$this->assertSame( 'shared', $store->get( 'site', 'demo:b' ) );
		$store->delete( 'site', 'demo:b' );
		$this->assertNull( $store->get( 'site', 'demo:b' ) );
	}

	/**
	 * @covers \OpenStation\App\Effects
	 */
	public function test_effects_are_normalised_for_the_wire() {
		$os = Os::standalone();
		$os->begin();
		$os->badge( -3 )->announce( 'post', 'updated', '7' )->open_url( 'post.php?post=7&action=edit', 'Edit' )->send( 'ping', array( 1 ) )
			->menu(
				array(
					array( 'label' => 'Edit', 'action' => 'edit', 'args' => array( 'id' => 7 ), 'icon' => 'dashicons-edit' ),
					array( 'label' => 'Broken' ),
					array( 'id' => 'rm', 'label' => 'Delete', 'action' => 'delete', 'danger' => true ),
				)
			);
		$effects = $os->effects->all();

		$this->assertSame( array( 'type' => 'badge', 'count' => 0 ), $effects[0] );
		$this->assertSame( array( 'type' => 'announce', 'contentType' => 'post', 'action' => 'updated', 'ids' => array( 7 ) ), $effects[1] );
		$this->assertSame( 'open_url', $effects[2]['type'] );
		$this->assertSame( array( 'type' => 'send', 'channel' => 'ping', 'payload' => array( 1 ) ), $effects[3] );
		$this->assertSame( 'menu', $effects[4]['type'] );
		$this->assertCount( 2, $effects[4]['items'], 'An item without an action is dropped.' );
		$this->assertSame( 'item-0', $effects[4]['items'][0]['id'] );
		$this->assertSame( array( 'id' => 7 ), $effects[4]['items'][0]['args'] );
		$this->assertTrue( $effects[4]['items'][1]['danger'] );
	}

	/**
	 * @covers \OpenStation\App::on_channel
	 * @covers \OpenStation\App::manifest
	 */
	public function test_manifest_carries_channels_and_declared_lifecycle_handlers() {
		$manifest = $this->demo_app()
			->on_channel( 'refresh-please', 'reset' )
			->action( 'resize', '__return_null' )
			->action( 'focus', '__return_null' )
			->manifest();
		$this->assertSame( array( 'refresh-please' => 'reset' ), $manifest['channels'] );
		$this->assertSame( array( 'resize', 'focus' ), $manifest['lifecycle'] );
	}

	/**
	 * @covers ::openstation_apps_register_windows
	 */
	public function test_host_registers_tabs_as_window_tabs() {
		wp_set_current_user( self::$admin_id );
		openstation_apps_registry()->add(
			$this->demo_app( 'demo-host-tabs' )->tab(
				'extra',
				array(
					'label' => 'Extra',
					'view'  => static function () {
						echo 'extra';
					},
				)
			)
		);
		openstation_apps_register_windows();

		$tabs = openstation_get_native_window_tabs( 'demo-host-tabs' );
		$this->assertCount( 2, $tabs );
		$extra = $tabs[1];
		$this->assertSame( 'extra', $extra['value'] );
		ob_start();
		call_user_func( $extra['template'] );
		$html = ob_get_clean();
		$this->assertStringContainsString( 'data-os-app="demo-host-tabs"', $html );
		$this->assertStringContainsString( 'data-os-view="extra"', $html );

		$entry = openstation_native_window_registry( 'demo-host-tabs' );
		$this->assertSame( array( array( 'value' => 'extra', 'label' => 'Extra', 'position' => 100 ) ), $entry['config']['tabs'] );
		$this->assertSame( '', $entry['style'], 'Nothing an app paints is injected at boot.' );
		$this->assertSame( 'openstation-app-runtime', $entry['styles'][0] );
	}

	/**
	 * @covers \OpenStation\App::define
	 */
	public function test_invalid_ids_and_reserved_actions_are_rejected() {
		$this->expectException( InvalidArgumentException::class );
		App::define( 'Not Valid!' );
	}

	/**
	 * @covers \OpenStation\App::action
	 */
	public function test_mount_is_a_reserved_action_name() {
		$this->expectException( InvalidArgumentException::class );
		App::define( 'ok' )->action( 'mount', '__return_null' );
	}

	/**
	 * @covers \OpenStation\App::icon
	 */
	public function test_inline_svg_icons_become_data_uris() {
		$manifest = App::define( 'svg' )->icon( '<svg xmlns="http://www.w3.org/2000/svg"></svg>' )->manifest();
		$this->assertStringStartsWith( 'data:image/svg+xml;base64,', $manifest['icon'] );
		$this->assertStringStartsWith( '<svg', $manifest['icon_svg'] );
	}

	// --------------------------------------------------- WordPress host

	/**
	 * @covers ::openstation_apps_register_windows
	 */
	public function test_host_registers_an_allowed_app_as_a_native_window_with_an_icon() {
		wp_set_current_user( self::$admin_id );
		openstation_apps_registry()->add(
			$this->demo_app( 'demo-host' )->desktop_icon( array( 'position' => 3 ) )->capabilities( 'manage_options' )
		);
		openstation_apps_register_windows();

		$entry = openstation_native_window_registry( 'demo-host' );
		$this->assertIsArray( $entry );
		$this->assertSame( 'openstation-app-runtime', $entry['script'] );
		$this->assertSame( 300, $entry['width'] );
		$this->assertTrue( $entry['config']['osApp'] );
		$this->assertStringContainsString( '/desktop-mode/v1/apps/demo-host/dispatch', $entry['config']['endpoint'] );
		$this->assertSame( 'bump', $entry['config']['titleBarButtons'][0]['action'] );

		ob_start();
		call_user_func( $entry['template'] );
		$template = ob_get_clean();
		$this->assertStringContainsString( 'data-os-app="demo-host"', $template );

		$icon = openstation_desktop_icon_registry( 'demo-host' );
		$this->assertIsArray( $icon );
		$this->assertSame( 3, $icon['position'] );
	}

	/**
	 * @covers ::openstation_apps_register_windows
	 */
	public function test_host_skips_an_app_the_user_may_not_use() {
		// The native-window registry is request-static, so this test
		// needs an id no other test registers.
		wp_set_current_user( self::$editor_id );
		openstation_apps_registry()->add( $this->demo_app( 'demo-host-gated' )->capabilities( 'manage_options' ) );
		openstation_apps_register_windows();
		$this->assertNull( openstation_native_window_registry( 'demo-host-gated' ) );
	}

	/**
	 * @covers ::openstation_apps_rest_dispatch
	 */
	public function test_rest_dispatch_runs_an_action_for_an_allowed_user() {
		wp_set_current_user( self::$admin_id );
		openstation_apps_registry()->add( $this->demo_app( 'demo-host' ) );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/apps/demo-host/dispatch' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body(
			wp_json_encode(
				array(
					'action' => 'bump',
					'state'  => array( 'count' => 1 ),
					'args'   => array( 'by' => 2 ),
				)
			)
		);
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 3, $data['state']['count'] );
		$this->assertStringContainsString( '<os-display value="3">', $data['html'] );
	}

	/**
	 * @covers ::openstation_apps_rest_permission
	 */
	public function test_rest_dispatch_refuses_outsiders_and_unknown_apps() {
		openstation_apps_registry()->add( $this->demo_app( 'demo-host' )->capabilities( 'manage_options' ) );

		wp_set_current_user( self::$editor_id );
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/apps/demo-host/dispatch' );
		$request->set_param( 'action', 'mount' );
		$this->assertSame( 403, rest_do_request( $request )->get_status() );

		wp_set_current_user( self::$admin_id );
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/apps/no-such-app/dispatch' );
		$request->set_param( 'action', 'mount' );
		$this->assertSame( 404, rest_do_request( $request )->get_status() );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/apps/demo-host/dispatch' );
		$request->set_param( 'action', 'fly' );
		$this->assertSame( 400, rest_do_request( $request )->get_status() );

		wp_set_current_user( 0 );
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/apps/demo-host/dispatch' );
		$request->set_param( 'action', 'mount' );
		$this->assertSame( 401, rest_do_request( $request )->get_status() );
	}

	/**
	 * @covers ::openstation_apps_allowed_html
	 */
	public function test_kses_allowlist_admits_the_runtime_attributes() {
		$allowed = openstation_native_window_allowed_html();
		$this->assertTrue( $allowed['div']['os-action'] );
		$this->assertTrue( $allowed['os-button']['os-poll'] );
		$kept = openstation_kses_native_window_template( '<os-button os-action="go" os-confirm="Sure?" os-confirm-danger os-key="k">Go</os-button>' );
		$this->assertStringContainsString( 'os-action="go"', $kept );
		$this->assertStringContainsString( 'os-confirm="Sure?"', $kept );
		$this->assertStringContainsString( 'os-key="k"', $kept );
	}

	/**
	 * @covers ::openstation_app_render
	 */
	public function test_openstation_app_render_returns_the_whole_window() {
		wp_set_current_user( self::$admin_id );
		openstation_apps_registry()->add( $this->demo_app( 'demo-host' ) );
		$whole = openstation_app_render( 'demo-host', array( 'count' => 9 ) );
		$this->assertTrue( $whole['ok'] );
		$this->assertSame( 'Demo', $whole['manifest']['title'] );
		$this->assertStringContainsString( '<os-display value="9">', $whole['html'] );
	}
}
