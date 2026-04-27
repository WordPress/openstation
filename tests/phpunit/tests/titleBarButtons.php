<?php
/**
 * Tests for `desktop_mode_register_titlebar_button_script()` — the
 * minimum-ceremony PHP opt-in that puts a plugin's JS handle into
 * the live-refresh payload so newly-installed plugins paint their
 * title-bar buttons immediately.
 *
 * Mirrors `tests/phpunit/tests/settingsTabs.php` — same pattern,
 * different registry.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-titlebar-buttons
 */
class Tests_DesktopMode_TitleBarButtons extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		desktop_mode_flush_script_handle_registries();
	}

	/**
	 * @covers ::desktop_mode_register_titlebar_button_script
	 */
	public function test_stores_handle() {
		$handle = 'tb-a-' . substr( md5( uniqid() ), 0, 8 );
		$ok     = desktop_mode_register_titlebar_button_script( $handle );
		$this->assertTrue( $ok );
		$this->assertTrue( desktop_mode_desktop_titlebar_button_script_registry( $handle ) );
	}

	/**
	 * @covers ::desktop_mode_register_titlebar_button_script
	 */
	public function test_rejects_empty_handle() {
		$r = desktop_mode_register_titlebar_button_script( '' );
		$this->assertInstanceOf( 'WP_Error', $r );
		$this->assertSame( 'desktop_mode_missing_handle', $r->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_build_desktop_titlebar_button_scripts_payload
	 */
	public function test_payload_resolves_registered_handle() {
		$handle = 'tb-b-' . substr( md5( uniqid() ), 0, 8 );
		wp_register_script( $handle, 'https://example.test/tb.js', array(), '1.0', true );
		desktop_mode_register_titlebar_button_script( $handle );

		$payload = desktop_mode_build_desktop_titlebar_button_scripts_payload();
		$entry   = null;
		foreach ( $payload as $p ) {
			if ( $p['handle'] === $handle ) {
				$entry = $p;
				break;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertStringContainsString( 'tb.js', $entry['scriptUrl'] );
	}

	/**
	 * @covers ::desktop_mode_build_desktop_titlebar_button_scripts_payload
	 */
	public function test_payload_omits_unresolvable_handles() {
		$this->setExpectedIncorrectUsage( 'desktop_mode_register_titlebar_button_script' );

		$handle = 'tb-c-' . substr( md5( uniqid() ), 0, 8 );
		desktop_mode_register_titlebar_button_script( $handle );
		$payload = desktop_mode_build_desktop_titlebar_button_scripts_payload();
		foreach ( $payload as $entry ) {
			$this->assertNotSame( $handle, $entry['handle'] );
		}
	}

	/**
	 * @covers ::desktop_mode_register_titlebar_button_script
	 */
	public function test_registered_action_fires() {
		$captured = array();
		add_action( 'desktop_mode_titlebar_button_script_registered', function ( $h ) use ( &$captured ) {
			$captured[] = $h;
		} );
		$h = 'tb-d-' . substr( md5( uniqid() ), 0, 8 );
		desktop_mode_register_titlebar_button_script( $h );
		$this->assertContains( $h, $captured );
	}
}
