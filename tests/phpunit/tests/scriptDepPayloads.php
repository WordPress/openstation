<?php
/**
 * A shared script dependency is serialized once, not once per entry.
 *
 * `openstation_resolve_script_dependencies()` returns each
 * dependency's full payload, and every entry builder calls it, so a
 * plugin's localized object on a script its commands depend on was
 * copied into every command (GH#892). The shell payloads now carry
 * handles in `scriptDeps` and each payload once in
 * `scriptDepPayloads`.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-script-dep-payloads
 */
class Tests_OpenStation_ScriptDepPayloads extends WP_UnitTestCase {

	const ENTRIES = 20;

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		// `wp_scripts()` is process-global, and suites that run earlier
		// empty its registry (resolveScriptDependencies,
		// nativeWindowLazyScript). Localizing onto an unregistered
		// `openstation` handle is dropped silently, so register it here.
		openstation_register_assets();
		wp_scripts()->add_data( 'openstation', 'data', '' );
	}

	public function tear_down() {
		// The command-script registry is process-global too: without this,
		// the next test counts this one's commands (and their config
		// handle) alongside its own.
		openstation_flush_desktop_command_script_registry();
		parent::tear_down();
	}

	/**
	 * Registers a src-less config handle carrying a localized object,
	 * and ENTRIES command scripts that depend on it.
	 *
	 * @return array{0:string,1:string[]} The config handle and the command handles.
	 */
	private function register_shared_dependency() {
		$config = 'sdp-config-' . uniqid();
		wp_register_script( $config, false, array(), '1.0.0', true );
		wp_localize_script( $config, 'sdpConfig', array( 'marker' => 'sdpsharedmarker' ) );
		$handles = array();
		for ( $i = 0; $i < self::ENTRIES; $i++ ) {
			$handle = 'sdp-cmd-' . $i . '-' . uniqid();
			wp_register_script( $handle, 'https://example.test/' . $handle . '.js', array( $config ), '1.0.0', true );
			openstation_register_command_script( $handle );
			$handles[] = $handle;
		}
		return array( $config, $handles );
	}

	/**
	 * @covers ::openstation_build_menu_payload
	 * @covers ::openstation_compact_script_deps
	 */
	public function test_menu_payload_serializes_a_shared_dependency_once() {
		list( $config, $handles ) = $this->register_shared_dependency();

		$payload = openstation_build_menu_payload();
		$json    = wp_json_encode( $payload );

		$this->assertSame( 1, substr_count( $json, 'sdpsharedmarker' ) );
		$map = (array) $payload['scriptDepPayloads'];
		$this->assertArrayHasKey( $config, $map );
		$this->assertStringContainsString( 'sdpsharedmarker', $map[ $config ]['l10n'][0] );

		$seen = 0;
		foreach ( $payload['serverCommandScripts'] as $entry ) {
			if ( in_array( $entry['handle'], $handles, true ) ) {
				$this->assertSame( array( $config ), $entry['scriptDeps'] );
				++$seen;
			}
		}
		$this->assertSame( self::ENTRIES, $seen );
	}

	/**
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_boot_config_serializes_a_shared_dependency_once() {
		$this->register_shared_dependency();

		$this->assertTrue( wp_script_is( 'openstation', 'registered' ), 'The shell handle must be registered, or the config is dropped.' );
		openstation_enqueue_assets();
		$blob = (string) wp_scripts()->get_data( 'openstation', 'data' );

		$this->assertStringContainsString( '"scriptDepPayloads"', $blob );
		$this->assertSame( 1, substr_count( $blob, 'sdpsharedmarker' ) );
	}

	/**
	 * Builders still return the full shape; only the finished payload
	 * is compacted, so filters on a builder's output are unaffected.
	 *
	 * @covers ::openstation_compact_script_deps
	 */
	public function test_compaction_keeps_order_and_keys_by_handle() {
		$a   = array( 'handle' => 'a', 'url' => 'https://example.test/a.js' );
		$b   = array( 'handle' => 'b', 'url' => '', 'l10n' => array( 'var b=1;' ) );
		$map = array();
		$out = openstation_compact_script_deps(
			array(
				'serverCommandScripts' => array(
					array( 'handle' => 'x', 'scriptDeps' => array( $a, $b ) ),
					array( 'handle' => 'y', 'scriptDeps' => array( $b ) ),
				),
				// A list keyed by id is covered the same as a plain one.
				'serverSettingsTabs'   => array( 'general' => array( 'scriptDeps' => array( $a ) ) ),
			),
			$map
		);
		$this->assertSame( array( 'a', 'b' ), $out['serverCommandScripts'][0]['scriptDeps'] );
		$this->assertSame( array( 'b' ), $out['serverCommandScripts'][1]['scriptDeps'] );
		$this->assertSame( array( 'a' ), $out['serverSettingsTabs']['general']['scriptDeps'] );
		$this->assertSame( array( 'a' => $a, 'b' => $b ), $map );
	}

	/**
	 * Only a `scriptDeps` directly on an entry is the shell's. Deeper, it
	 * is a plugin's metadata: hoisting it would put foreign data in the
	 * map first-wins, and every real dependency on that handle would
	 * then hydrate to it with no URL.
	 *
	 * @covers ::openstation_compact_script_deps
	 */
	public function test_nested_scriptDeps_is_plugin_data_and_is_left_alone() {
		$foreign = array( array( 'handle' => 'wp-hooks', 'foo' => 1 ) );
		$real    = array( 'handle' => 'wp-hooks', 'url' => 'https://example.test/hooks.js' );
		$map     = array();
		$out     = openstation_compact_script_deps(
			array(
				'serverWidgets' => array(
					array(
						'id'         => 'w',
						'settings'   => array( 'scriptDeps' => $foreign ),
						'scriptDeps' => array( $real ),
					),
				),
			),
			$map
		);
		$this->assertSame( $foreign, $out['serverWidgets'][0]['settings']['scriptDeps'] );
		$this->assertSame( array( 'wp-hooks' => $real ), $map, 'The map holds the real payload, not the plugin\'s.' );
	}

	/**
	 * A bare handle a builder (or a filter on one) emits is resolved into
	 * the map, so every string the client receives has an entry there.
	 * The client drops (and logs) a handle with none; the two sides agree.
	 *
	 * @covers ::openstation_compact_script_dep_list
	 */
	public function test_bare_handle_is_resolved_into_the_map() {
		wp_register_script( 'sdp-bare', 'https://example.test/bare.js', array(), '1', true );
		wp_register_script( 'sdp-empty-alias', false, array(), '1', true );
		$map = array();
		$out = openstation_compact_script_deps(
			array(
				'serverCommandScripts' => array(
					array( 'scriptDeps' => array( 'sdp-bare', 'sdp-empty-alias', 'sdp-unregistered' ) ),
				),
			),
			$map
		);
		// Nothing to fetch and nothing to run is dropped, as it is in
		// openstation_resolve_script_dependencies().
		$this->assertSame( array( 'sdp-bare' ), $out['serverCommandScripts'][0]['scriptDeps'] );
		$this->assertArrayHasKey( 'sdp-bare', $map );
		$this->assertStringContainsString( 'bare.js', $map['sdp-bare']['url'] );
		$this->assertSame( 'sdp-bare', $map['sdp-bare']['handle'] );
		wp_deregister_script( 'sdp-bare' );
		wp_deregister_script( 'sdp-empty-alias' );
	}

	/**
	 * Scoping by depth is only safe while every builder puts
	 * `scriptDeps` on the entry itself. Derived from the real payload
	 * rather than asserted per builder, so a new one that nests the
	 * key deeper fails here instead of silently shipping full payloads.
	 *
	 * @covers ::openstation_build_menu_payload
	 */
	public function test_no_scriptDeps_list_is_left_uncompacted_in_a_real_payload() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$payload = openstation_build_menu_payload();
		unset( $payload['scriptDepPayloads'] );
		$left = array();
		$walk = static function ( $node, $path ) use ( &$walk, &$left ) {
			if ( ! is_array( $node ) ) {
				return;
			}
			foreach ( $node as $key => $value ) {
				if ( 'scriptDeps' === $key && is_array( $value ) ) {
					foreach ( $value as $dep ) {
						if ( is_array( $dep ) ) {
							$left[] = $path . '.' . $key;
							break;
						}
					}
					continue;
				}
				$walk( $value, $path . '.' . $key );
			}
		};
		$walk( $payload, 'payload' );
		$this->assertSame( array(), $left, 'A builder nests scriptDeps below entry depth.' );
	}
}
