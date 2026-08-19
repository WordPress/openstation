<?php
/**
 * Tests for deferred native-window bundles: the `preload_script`
 * opt-out and the `scripts` companion-handle list on
 * `openstation_register_window()`.
 *
 * A native window's bundle is dead weight on every admin page until
 * the window opens, so the shell loads it on first open and the
 * payload carries the two knobs that shape that: `preloadScript`
 * (load at boot anyway) and `companionScripts` (bundles that must be
 * in the tab immediately before the window's own).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-native-window-lazy-script
 */
class Tests_OpenStation_NativeWindowLazyScript extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );

		// `wp_scripts()` is process-global; prior tests leak handles.
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

	// --------------------------------------------------------------
	// preload_script
	// --------------------------------------------------------------

	/**
	 * The default is deferred. A window that says nothing about when
	 * its bundle should load gets it on first open, which is the
	 * whole point — this assertion is the one that fails if someone
	 * flips the default back.
	 *
	 * @covers ::openstation_build_native_windows_payload
	 */
	public function test_preload_script_defaults_to_false() {
		$this->register_demo_window( 'demo-lazy-default' );

		$entry = $this->payload_entry( 'demo-lazy-default' );
		$this->assertNotNull( $entry );
		$this->assertFalse( $entry['preloadScript'] );
	}

	/**
	 * @covers ::openstation_register_window
	 * @covers ::openstation_build_native_windows_payload
	 */
	public function test_preload_script_opt_in_reaches_the_payload() {
		$this->register_demo_window(
			'demo-lazy-optin',
			array( 'preload_script' => true )
		);

		$entry = $this->payload_entry( 'demo-lazy-optin' );
		$this->assertNotNull( $entry );
		$this->assertTrue( $entry['preloadScript'] );
	}

	// --------------------------------------------------------------
	// scripts (companions)
	// --------------------------------------------------------------

	/**
	 * @covers ::openstation_build_native_windows_payload
	 */
	public function test_companion_scripts_default_to_empty() {
		$this->register_demo_window( 'demo-companion-none' );

		$entry = $this->payload_entry( 'demo-companion-none' );
		$this->assertNotNull( $entry );
		$this->assertSame( array(), $entry['companionScripts'] );
	}

	/**
	 * Companions resolve to the same shape the main script travels
	 * in — URL plus the harvested `wp_add_inline_script` data — so
	 * the shell's loader can replay them around the script tag.
	 *
	 * @covers ::openstation_build_native_windows_payload
	 */
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
		$this->assertCount( 1, $entry['companionScripts'] );
		$companion = $entry['companionScripts'][0];
		$this->assertSame( 'demo-extra', $companion['scriptHandle'] );
		$this->assertStringContainsString( 'extra.js', $companion['scriptUrl'] );
		$this->assertSame(
			array( 'window.demoExtraConfig={a:1};' ),
			$companion['scriptBefore']
		);
	}

	/**
	 * Declaration order is the contract: a companion subscribes to
	 * actions the window's own bundle fires while rendering, so it
	 * has to be listening before that bundle is parsed — and two
	 * companions may depend on each other in turn.
	 *
	 * @covers ::openstation_build_native_windows_payload
	 */
	public function test_companion_scripts_keep_declaration_order() {
		$this->register_demo_script( 'demo-a', 'https://example.test/a.js' );
		$this->register_demo_script( 'demo-b', 'https://example.test/b.js' );

		$this->register_demo_window(
			'demo-companion-order',
			array( 'scripts' => array( 'demo-b', 'demo-a' ) )
		);

		$entry = $this->payload_entry( 'demo-companion-order' );
		$this->assertNotNull( $entry );
		$this->assertSame(
			array( 'demo-b', 'demo-a' ),
			wp_list_pluck( $entry['companionScripts'], 'scriptHandle' )
		);
	}

	/**
	 * A handle nobody registered resolves to no URL, and an entry the
	 * loader would skip anyway is not worth shipping. Same silent
	 * drop the `style` arg does.
	 *
	 * @covers ::openstation_build_native_windows_payload
	 */
	public function test_unregistered_companion_handle_drops_silently() {
		$this->register_demo_script( 'demo-real', 'https://example.test/real.js' );

		$this->register_demo_window(
			'demo-companion-missing',
			array( 'scripts' => array( 'never-registered', 'demo-real' ) )
		);

		$entry = $this->payload_entry( 'demo-companion-missing' );
		$this->assertNotNull( $entry );
		$this->assertSame(
			array( 'demo-real' ),
			wp_list_pluck( $entry['companionScripts'], 'scriptHandle' )
		);
	}

	// --------------------------------------------------------------
	// The enqueue hook
	// --------------------------------------------------------------

	/**
	 * The bundle is not printed at boot. This is the assertion the
	 * whole change exists for: before it, every registered window's
	 * script went out on every admin page, opened or not.
	 *
	 * @covers ::openstation_enqueue_native_window_scripts
	 */
	public function test_enqueue_hook_does_not_print_a_deferred_bundle() {
		$this->register_demo_script( 'demo-main', 'https://example.test/main.js' );
		$this->register_demo_window( 'demo-enqueue-lazy', array( 'script' => 'demo-main' ) );

		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		openstation_enqueue_native_window_scripts();

		$this->assertFalse( wp_script_is( 'demo-main', 'enqueued' ) );
	}

	/**
	 * …but the localize blob still hangs off the registered handle,
	 * because that is what the payload builder harvests for the
	 * lazy loader to replay. A deferred bundle with no config is the
	 * failure mode this guards.
	 *
	 * @covers ::openstation_enqueue_native_window_scripts
	 */
	public function test_enqueue_hook_attaches_data_to_the_deferred_handle() {
		$this->register_demo_script( 'demo-main', 'https://example.test/main.js' );
		$this->register_demo_window( 'demo-enqueue-data', array( 'script' => 'demo-main' ) );

		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		openstation_enqueue_native_window_scripts();

		$data = wp_scripts()->get_data( 'demo-main', 'data' );
		$this->assertIsString( $data );
		$this->assertStringContainsString( 'openStationNativeWindow_', $data );
	}

	/**
	 * The emit-time `openstation_native_window_config` filter reaches
	 * the lazy path — the synthesized `scriptL10n` assignment carries
	 * the filtered blob, not just the registration-time snapshot.
	 *
	 * @covers ::openstation_filter_native_window_config
	 * @covers ::openstation_build_native_windows_payload
	 */
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
		$l10n = implode( "\n", $entry['scriptL10n'] );
		$this->assertStringContainsString( 'emit-time', $l10n );
		$this->assertStringContainsString( 'snapshot', $l10n );
	}

	/**
	 * …and the eager path — the inline `before` attach on a preloaded
	 * bundle serializes the same filtered blob.
	 *
	 * @covers ::openstation_filter_native_window_config
	 * @covers ::openstation_enqueue_native_window_scripts
	 */
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

	/**
	 * A filter callback returning a non-array must not fatal the
	 * payload build — the blob normalizes to "nothing to ship."
	 *
	 * @covers ::openstation_filter_native_window_config
	 */
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
		$this->assertStringNotContainsString(
			'openStationWindowConfig',
			implode( "\n", $entry['scriptL10n'] )
		);
	}

	/**
	 * The attach has to beat `openstation_enqueue_assets()` at
	 * priority 10, which is where the boot payload is built.
	 *
	 * @covers ::openstation_enqueue_native_window_scripts
	 */
	public function test_enqueue_hook_runs_before_the_payload_is_built() {
		$this->assertSame(
			5,
			has_action(
				'admin_enqueue_scripts',
				'openstation_enqueue_native_window_scripts'
			)
		);
	}

	/**
	 * `preload_script` prints the bundle and its companions the old
	 * way — for a plugin whose JS has a job to do with no window
	 * open.
	 *
	 * @covers ::openstation_enqueue_native_window_scripts
	 */
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

	/**
	 * Duplicates collapse at registration. The shell dedupes by URL
	 * too, but a list that says the same handle twice is a mistake
	 * worth not propagating into the payload.
	 *
	 * @covers ::openstation_register_window
	 */
	public function test_duplicate_and_empty_companion_handles_are_dropped() {
		$this->register_demo_script( 'demo-dup', 'https://example.test/dup.js' );

		$this->register_demo_window(
			'demo-companion-dup',
			array( 'scripts' => array( 'demo-dup', '', 'demo-dup' ) )
		);

		$entry = $this->payload_entry( 'demo-companion-dup' );
		$this->assertNotNull( $entry );
		$this->assertSame(
			array( 'demo-dup' ),
			wp_list_pluck( $entry['companionScripts'], 'scriptHandle' )
		);
	}
}
