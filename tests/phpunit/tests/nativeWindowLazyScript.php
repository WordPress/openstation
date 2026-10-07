<?php

class Tests_OpenStation_NativeWindowLazyScript extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );

		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );

		wp_scripts()->registered = array();
	}

	private function register_demo_script( $handle, $src ) {
		wp_register_script( $handle, $src, array(), '1.0.0', true );
	}

	private function register_demo_window( $id, $args = array() ) {
		$defaults = array(
			'title'    => 'Demo',
			'template' => static function () {
				echo '<p>demo</p>';
			},
		);
		$this->assertTrue(
			openstation_register_window( $id, array_merge( $defaults, $args ) )
		);
	}

	private function payload_entry( $id ) {
		foreach ( openstation_build_native_windows_payload() as $row ) {
			if ( $id === $row['id'] ) {
				return $row;
			}
		}
		return null;
	}

	private function script_data() {
		$bundle = openstation_collect_native_windows_payload();
		return $bundle['scriptData'];
	}

	public function test_preload_script_defaults_to_false() {
		$this->register_demo_window( 'demo-lazy-default' );

		$entry = $this->payload_entry( 'demo-lazy-default' );
		$this->assertNotNull( $entry );
		$this->assertFalse( $entry['preloadScript'] );
	}

	public function test_preload_script_opt_in_reaches_the_payload() {
		$this->register_demo_window(
			'demo-lazy-optin',
			array( 'preload_script' => true )
		);

		$entry = $this->payload_entry( 'demo-lazy-optin' );
		$this->assertNotNull( $entry );
		$this->assertTrue( $entry['preloadScript'] );
	}

	public function test_companion_scripts_default_to_empty() {
		$this->register_demo_window( 'demo-companion-none' );

		$entry = $this->payload_entry( 'demo-companion-none' );
		$this->assertNotNull( $entry );
		$this->assertSame( array(), $entry['companionScripts'] );
	}

	public function test_companion_scripts_resolve_with_inline_data() {
		$this->register_demo_script( 'demo-main', 'https://example.test/main.js' );
		$this->register_demo_script( 'demo-extra', 'https://example.test/extra.js' );
		wp_add_inline_script( 'demo-extra', 'window.demoExtraConfig={a:1};', 'before' );

		$this->register_demo_window(
			'demo-companion-one',
			array(
				'script'  => 'demo-main',
				'scripts' => array( 'demo-extra' ),
			)
		);

		$entry = $this->payload_entry( 'demo-companion-one' );
		$this->assertNotNull( $entry );
		$this->assertSame( array( 'demo-extra' ), $entry['companionScripts'] );

		$data = $this->script_data();
		$this->assertArrayHasKey( 'demo-extra', $data );
		$this->assertStringContainsString( 'extra.js', $data['demo-extra']['url'] );
		$this->assertSame(
			array( 'window.demoExtraConfig={a:1};' ),
			$data['demo-extra']['before']
		);
	}

	public function test_companion_scripts_keep_declaration_order() {
		$this->register_demo_script( 'demo-a', 'https://example.test/a.js' );
		$this->register_demo_script( 'demo-b', 'https://example.test/b.js' );

		$this->register_demo_window(
			'demo-companion-order',
			array( 'scripts' => array( 'demo-b', 'demo-a' ) )
		);

		$entry = $this->payload_entry( 'demo-companion-order' );
		$this->assertNotNull( $entry );
		$this->assertSame( array( 'demo-b', 'demo-a' ), $entry['companionScripts'] );
	}

	public function test_unregistered_companion_handle_drops_silently() {
		$this->register_demo_script( 'demo-real', 'https://example.test/real.js' );

		$this->register_demo_window(
			'demo-companion-missing',
			array( 'scripts' => array( 'never-registered', 'demo-real' ) )
		);

		$entry = $this->payload_entry( 'demo-companion-missing' );
		$this->assertNotNull( $entry );
		$this->assertSame( array( 'demo-real' ), $entry['companionScripts'] );
		$this->assertArrayNotHasKey( 'never-registered', $this->script_data() );
	}

	public function test_enqueue_hook_does_not_print_a_deferred_bundle() {
		$this->register_demo_script( 'demo-main', 'https://example.test/main.js' );
		$this->register_demo_window( 'demo-enqueue-lazy', array( 'script' => 'demo-main' ) );

		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		openstation_enqueue_native_window_scripts();

		$this->assertFalse( wp_script_is( 'demo-main', 'enqueued' ) );
	}

	public function test_enqueue_hook_attaches_data_to_the_deferred_handle() {
		$this->register_demo_script( 'demo-main', 'https://example.test/main.js' );
		$this->register_demo_window( 'demo-enqueue-data', array( 'script' => 'demo-main' ) );

		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		openstation_enqueue_native_window_scripts();

		$data = wp_scripts()->get_data( 'demo-main', 'data' );
		$this->assertIsString( $data );
		$this->assertStringContainsString( 'openStationNativeWindow_', $data );
	}

	public function test_config_filter_reaches_the_lazy_l10n() {
		$this->register_demo_script( 'demo-main', 'https://example.test/main.js' );
		$this->register_demo_window(
			'demo-config-filter',
			array(
				'script' => 'demo-main',
				'config' => array( 'stale' => 'snapshot' ),
			)
		);
		add_filter(
			'openstation_native_window_config',
			static function ( $config, $window_id ) {
				if ( 'demo-config-filter' === $window_id ) {
					$config['fresh'] = 'emit-time';
				}
				return $config;
			},
			10,
			2
		);

		$entry = $this->payload_entry( 'demo-config-filter' );
		$this->assertNotNull( $entry );
		$data = $this->script_data();
		$l10n = implode( "\n", $data['demo-main']['l10n'] );
		$this->assertStringContainsString( 'emit-time', $l10n );
		$this->assertStringContainsString( 'snapshot', $l10n );
	}

	public function test_config_filter_reaches_the_eager_inline() {
		$this->register_demo_script( 'demo-main', 'https://example.test/main.js' );
		$this->register_demo_window(
			'demo-config-eager',
			array(
				'script'         => 'demo-main',
				'preload_script' => true,
				'config'         => array( 'stale' => 'snapshot' ),
			)
		);
		add_filter(
			'openstation_native_window_config',
			static function ( $config, $window_id ) {
				if ( 'demo-config-eager' === $window_id ) {
					$config['fresh'] = 'emit-time';
				}
				return $config;
			},
			10,
			2
		);

		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		openstation_enqueue_native_window_scripts();

		$before = wp_scripts()->get_data( 'demo-main', 'before' );
		$blob   = implode(
			"\n",
			array_filter( (array) $before, 'is_string' )
		);
		$this->assertStringContainsString( 'emit-time', $blob );
	}

	public function test_config_filter_non_array_return_ships_nothing() {
		$this->register_demo_script( 'demo-main', 'https://example.test/main.js' );
		$this->register_demo_window(
			'demo-config-bogus',
			array(
				'script' => 'demo-main',
				'config' => array( 'stale' => 'snapshot' ),
			)
		);
		add_filter( 'openstation_native_window_config', '__return_false' );

		$entry = $this->payload_entry( 'demo-config-bogus' );
		$this->assertNotNull( $entry );
		$data = $this->script_data();
		$this->assertStringNotContainsString(
			'openStationWindowConfig',
			implode( "\n", isset( $data['demo-main']['l10n'] ) ? $data['demo-main']['l10n'] : array() )
		);
	}

	public function test_enqueue_hook_runs_before_the_payload_is_built() {
		$this->assertSame(
			5,
			has_action(
				'admin_enqueue_scripts',
				'openstation_enqueue_native_window_scripts'
			)
		);
	}

	public function test_enqueue_hook_prints_preloaded_bundles_and_companions() {
		$this->register_demo_script( 'demo-main', 'https://example.test/main.js' );
		$this->register_demo_script( 'demo-extra', 'https://example.test/extra.js' );
		$this->register_demo_window(
			'demo-enqueue-eager',
			array(
				'script'         => 'demo-main',
				'scripts'        => array( 'demo-extra' ),
				'preload_script' => true,
			)
		);

		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		openstation_enqueue_native_window_scripts();

		$this->assertTrue( wp_script_is( 'demo-main', 'enqueued' ) );
		$this->assertTrue( wp_script_is( 'demo-extra', 'enqueued' ) );
	}

	public function test_duplicate_and_empty_companion_handles_are_dropped() {
		$this->register_demo_script( 'demo-dup', 'https://example.test/dup.js' );

		$this->register_demo_window(
			'demo-companion-dup',
			array( 'scripts' => array( 'demo-dup', '', 'demo-dup' ) )
		);

		$entry = $this->payload_entry( 'demo-companion-dup' );
		$this->assertNotNull( $entry );
		$this->assertSame( array( 'demo-dup' ), $entry['companionScripts'] );
	}

	public function test_windows_sharing_a_bundle_share_one_config_set() {
		$this->register_demo_script( 'demo-shared', 'https://example.test/shared.js' );
		$this->register_demo_window(
			'demo-shared-posts',
			array(
				'script' => 'demo-shared',
				'config' => array( 'who' => 'posts' ),
			)
		);
		$this->register_demo_window(
			'demo-shared-pages',
			array(
				'script' => 'demo-shared',
				'config' => array( 'who' => 'pages' ),
			)
		);

		$posts = $this->payload_entry( 'demo-shared-posts' );
		$pages = $this->payload_entry( 'demo-shared-pages' );
		$this->assertNotNull( $posts );
		$this->assertNotNull( $pages );

		$this->assertArrayNotHasKey( 'scriptL10n', $posts );
		$this->assertSame( 'demo-shared', $posts['scriptHandle'] );
		$this->assertSame( 'demo-shared', $pages['scriptHandle'] );

		$data = $this->script_data();
		$this->assertArrayHasKey( 'demo-shared', $data );
		$l10n = implode( "\n", $data['demo-shared']['l10n'] );
		$this->assertStringContainsString( '"demo-shared-posts"', $l10n );
		$this->assertStringContainsString( '"demo-shared-pages"', $l10n );

		$this->assertSame( 1, substr_count( $l10n, '"demo-shared-posts"' ) );
		$this->assertSame( 1, substr_count( $l10n, '"demo-shared-pages"' ) );
	}

	public function test_companion_styles_default_to_empty() {
		$this->register_demo_window( 'demo-style-none' );

		$entry = $this->payload_entry( 'demo-style-none' );
		$this->assertNotNull( $entry );
		$this->assertSame( array(), $entry['companionStyles'] );
	}

	public function test_companion_styles_resolve_with_inline_data() {
		wp_register_style( 'demo-style-extra', 'https://example.test/extra.css', array(), '1.0.0' );
		wp_add_inline_style( 'demo-style-extra', '.demo{color:red}' );

		$this->register_demo_window(
			'demo-style-one',
			array( 'styles' => array( 'demo-style-extra', 'never-registered', '' ) )
		);

		$entry = $this->payload_entry( 'demo-style-one' );
		$this->assertNotNull( $entry );
		$this->assertCount( 1, $entry['companionStyles'] );
		$companion = $entry['companionStyles'][0];
		$this->assertSame( 'demo-style-extra', $companion['styleHandle'] );
		$this->assertStringContainsString( 'extra.css', $companion['styleUrl'] );
		$this->assertSame( array( '.demo{color:red}' ), $companion['styleInline'] );

		wp_deregister_style( 'demo-style-extra' );
	}

	public function test_preload_enqueues_companion_styles() {
		wp_register_style( 'demo-style-preload', 'https://example.test/preload.css', array(), '1.0.0' );
		$this->register_demo_script( 'demo-main', 'https://example.test/main.js' );
		$this->register_demo_window(
			'demo-style-eager',
			array(
				'script'         => 'demo-main',
				'styles'         => array( 'demo-style-preload' ),
				'preload_script' => true,
			)
		);

		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		openstation_enqueue_native_window_scripts();

		$this->assertTrue( wp_style_is( 'demo-style-preload', 'enqueued' ) );

		wp_dequeue_style( 'demo-style-preload' );
		wp_deregister_style( 'demo-style-preload' );
	}

	public function test_probe_payload_carries_data_attached_on_admin_enqueue_scripts() {
		$this->register_demo_script( 'demo-main', 'https://example.test/main.js' );
		$this->register_demo_script( 'demo-extra', 'https://example.test/extra.js' );
		$this->register_demo_window(
			'demo-probe-window',
			array(
				'script'  => 'demo-main',
				'scripts' => array( 'demo-extra' ),
			)
		);

		add_action(
			'admin_enqueue_scripts',
			static function () {
				wp_add_inline_script( 'demo-extra', 'window.demoProbeConfig={b:2};', 'before' );
			},
			5
		);

		$this->assertSame( 0, did_action( 'admin_enqueue_scripts' ) );

		$payload = openstation_menu_refresh_probe_payload();

		$entry = null;
		foreach ( $payload['nativeWindows'] as $row ) {
			if ( 'demo-probe-window' === $row['id'] ) {
				$entry = $row;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertSame( array( 'demo-extra' ), $entry['companionScripts'] );
		$this->assertSame(
			array( 'window.demoProbeConfig={b:2};' ),
			$payload['nativeWindowScriptData']['demo-extra']['before']
		);
	}

	public function test_script_ships_its_dependency_closure() {
		$this->register_demo_script( 'demo-base', 'https://example.test/base.js' );
		wp_register_script( 'demo-config', false, array( 'demo-base' ), '1.0.0', true );
		wp_add_inline_script( 'demo-config', 'window.demoConfig={c:3};', 'before' );
		$this->register_demo_script( 'demo-main', 'https://example.test/main.js' );
		wp_scripts()->registered['demo-main']->deps = array( 'demo-config' );

		$this->register_demo_window( 'demo-deps-window', array( 'script' => 'demo-main' ) );

		$data = $this->script_data();
		$this->assertSame( array( 'demo-base', 'demo-config' ), $data['demo-main']['deps'] );

		$this->assertArrayHasKey( 'demo-base', $data );
		$this->assertStringContainsString( 'base.js', $data['demo-base']['url'] );

		$this->assertArrayHasKey( 'demo-config', $data );
		$this->assertSame( '', $data['demo-config']['url'] );
		$this->assertSame( array( 'window.demoConfig={c:3};' ), $data['demo-config']['before'] );
	}

	public function test_a_dependency_named_as_a_script_resolves_its_own_closure() {
		$this->register_demo_script( 'demo-base', 'https://example.test/base.js' );
		$this->register_demo_script( 'demo-shared', 'https://example.test/shared.js' );
		wp_scripts()->registered['demo-shared']->deps = array( 'demo-base' );
		$this->register_demo_script( 'demo-main', 'https://example.test/main.js' );
		wp_scripts()->registered['demo-main']->deps = array( 'demo-shared' );

		$this->register_demo_window( 'demo-first', array( 'script' => 'demo-main' ) );
		$this->register_demo_window( 'demo-second', array( 'script' => 'demo-shared' ) );

		$data = $this->script_data();
		$this->assertSame( array( 'demo-base', 'demo-shared' ), $data['demo-main']['deps'] );
		$this->assertSame( array( 'demo-base' ), $data['demo-shared']['deps'] );
	}

	public function test_alias_as_a_window_script_is_still_nothing_to_load() {
		wp_register_script( 'demo-alias-only', false, array(), '1.0.0', true );
		wp_add_inline_script( 'demo-alias-only', 'window.demoAlias=1;', 'before' );

		$this->register_demo_window( 'demo-alias-window', array( 'script' => 'demo-alias-only' ) );

		$entry = $this->payload_entry( 'demo-alias-window' );
		$this->assertSame( '', $entry['scriptHandle'] );
		$this->assertSame( 'demo-alias-only', $entry['ownerHandle'] );
	}
}
