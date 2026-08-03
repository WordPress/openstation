<?php
/**
 * Tests for `open_station_register_unfocus_effect_script()` — the
 * minimum-ceremony PHP opt-in that puts a plugin's JS handle into the
 * live-refresh payload so newly-installed plugins surface their
 * unfocus effect in OS Settings → Effects immediately — plus the
 * `unfocusEffect` OS-setting sanitizer and its presence in the menu
 * payload.
 *
 * Mirrors `tests/phpunit/tests/titleBarButtons.php` — same pattern,
 * different registry.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-unfocus-effects
 */
class Tests_OpenStation_UnfocusEffects extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		open_station_flush_script_handle_registries();
	}

	/**
	 * @covers ::open_station_register_unfocus_effect_script
	 */
	public function test_stores_handle() {
		$handle = 'fx-a-' . substr( md5( uniqid() ), 0, 8 );
		$ok     = open_station_register_unfocus_effect_script( $handle );
		$this->assertTrue( $ok );
		$this->assertTrue( open_station_desktop_unfocus_effect_script_registry( $handle ) );
	}

	/**
	 * @covers ::open_station_register_unfocus_effect_script
	 */
	public function test_rejects_empty_handle() {
		$r = open_station_register_unfocus_effect_script( '' );
		$this->assertInstanceOf( 'WP_Error', $r );
		$this->assertSame( 'open_station_missing_handle', $r->get_error_code() );
	}

	/**
	 * @covers ::open_station_build_desktop_unfocus_effect_scripts_payload
	 */
	public function test_payload_resolves_registered_handle() {
		$handle = 'fx-b-' . substr( md5( uniqid() ), 0, 8 );
		wp_register_script( $handle, 'https://example.test/fx.js', array(), '1.0', true );
		open_station_register_unfocus_effect_script( $handle );

		$payload = open_station_build_desktop_unfocus_effect_scripts_payload();
		$entry   = null;
		foreach ( $payload as $p ) {
			if ( $p['handle'] === $handle ) {
				$entry = $p;
				break;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertStringContainsString( 'fx.js', $entry['scriptUrl'] );
	}

	/**
	 * @covers ::open_station_build_desktop_unfocus_effect_scripts_payload
	 */
	public function test_payload_omits_unresolvable_handles() {
		$this->setExpectedIncorrectUsage( 'open_station_register_unfocus_effect_script' );

		$handle = 'fx-c-' . substr( md5( uniqid() ), 0, 8 );
		open_station_register_unfocus_effect_script( $handle );
		$payload = open_station_build_desktop_unfocus_effect_scripts_payload();
		foreach ( $payload as $entry ) {
			$this->assertNotSame( $handle, $entry['handle'] );
		}
	}

	/**
	 * @covers ::open_station_register_unfocus_effect_script
	 */
	public function test_registered_action_fires() {
		$captured = array();
		add_action( 'open_station_unfocus_effect_script_registered', function ( $h ) use ( &$captured ) {
			$captured[] = $h;
		} );
		$h = 'fx-d-' . substr( md5( uniqid() ), 0, 8 );
		open_station_register_unfocus_effect_script( $h );
		$this->assertContains( $h, $captured );
	}

	/**
	 * The menu payload advertises the script array so the shell's
	 * live-refresh applier can lazy-load plugin effect scripts.
	 *
	 * @covers ::open_station_build_menu_payload
	 */
	public function test_menu_payload_includes_unfocus_effect_scripts_key() {
		$payload = open_station_build_menu_payload();
		$this->assertArrayHasKey( 'serverUnfocusEffectScripts', $payload );
		$this->assertIsArray( $payload['serverUnfocusEffectScripts'] );
	}

	/**
	 * @covers ::open_station_sanitize_os_settings
	 */
	public function test_unfocus_effect_defaults_to_darken() {
		$clean = open_station_sanitize_os_settings( array() );
		$this->assertSame( 'darken', $clean['unfocusEffect'] );
	}

	/**
	 * @covers ::open_station_sanitize_os_settings
	 */
	public function test_unfocus_effect_accepts_none_and_namespaced_ids() {
		$none = open_station_sanitize_os_settings( array( 'unfocusEffect' => 'none' ) );
		$this->assertSame( 'none', $none['unfocusEffect'] );

		// Slashes survive — namespaced `vendor/sub-id` round-trips.
		$ns = open_station_sanitize_os_settings( array( 'unfocusEffect' => 'acme/Glow' ) );
		$this->assertSame( 'acme/glow', $ns['unfocusEffect'] );
	}

	/**
	 * @covers ::open_station_sanitize_os_settings
	 */
	public function test_unfocus_effect_falls_back_on_garbage() {
		$clean = open_station_sanitize_os_settings( array( 'unfocusEffect' => '!!!' ) );
		$this->assertSame( 'darken', $clean['unfocusEffect'] );

		$nonstr = open_station_sanitize_os_settings( array( 'unfocusEffect' => 123 ) );
		$this->assertSame( 'darken', $nonstr['unfocusEffect'] );
	}
}
