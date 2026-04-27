<?php
/**
 * Tests for `desktop_mode_register_settings_tab_script()` and
 * `desktop_mode_register_settings_tab()` — the PHP-side entry points that
 * hand OS Settings tab providers off to the shell's server-sync so
 * newly-installed plugins appear live in the Settings window.
 *
 * Mirrors `tests/phpunit/tests/commands.php` — same pattern, different
 * registry.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-settings-tabs
 */
class Tests_DesktopMode_SettingsTabs extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		desktop_mode_flush_script_handle_registries();
	}

	/**
	 * @covers ::desktop_mode_register_settings_tab_script
	 */
	public function test_register_script_stores_handle() {
		$handle = 'settings-tab-a-' . uniqid();
		$result = desktop_mode_register_settings_tab_script( $handle );
		$this->assertTrue( $result );

		$this->assertTrue( desktop_mode_desktop_settings_tab_script_registry( $handle ) );
	}

	/**
	 * @covers ::desktop_mode_register_settings_tab_script
	 */
	public function test_register_script_rejects_empty_handle() {
		$result = desktop_mode_register_settings_tab_script( '' );
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_missing_handle', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_build_desktop_settings_tab_scripts_payload
	 */
	public function test_payload_resolves_registered_handle_to_absolute_url() {
		$handle = 'settings-tab-b-' . uniqid();
		wp_register_script( $handle, 'https://example.test/settings.js', array(), '1.0.0', true );
		desktop_mode_register_settings_tab_script( $handle );

		$payload = desktop_mode_build_desktop_settings_tab_scripts_payload();

		$entry = null;
		foreach ( $payload as $p ) {
			if ( $p['handle'] === $handle ) {
				$entry = $p;
				break;
			}
		}
		$this->assertNotNull( $entry, 'expected handle to appear in payload' );
		$this->assertStringContainsString( 'settings.js', $entry['scriptUrl'] );
	}

	/**
	 * @covers ::desktop_mode_build_desktop_settings_tab_scripts_payload
	 */
	public function test_payload_omits_unresolvable_handles() {
		$this->setExpectedIncorrectUsage( 'desktop_mode_register_settings_tab_script' );

		$handle = 'settings-tab-c-' . uniqid();
		desktop_mode_register_settings_tab_script( $handle );

		$payload = desktop_mode_build_desktop_settings_tab_scripts_payload();
		foreach ( $payload as $entry ) {
			$this->assertNotSame( $handle, $entry['handle'] );
		}
	}

	/**
	 * @covers ::desktop_mode_register_settings_tab
	 */
	public function test_register_tab_stores_metadata() {
		$id = 'settings-tab-d-' . uniqid();
		$result = desktop_mode_register_settings_tab( array(
			'id'         => $id,
			'label'      => 'My Plugin',
			'capability' => 'manage_options',
			'order'      => 50,
		) );
		$this->assertTrue( $result );

		$entry = desktop_mode_desktop_settings_tab_registry( $id );
		$this->assertIsArray( $entry );
		$this->assertSame( 'My Plugin', $entry['label'] );
		$this->assertSame( 'manage_options', $entry['capability'] );
		$this->assertSame( 50, $entry['order'] );
	}

	/**
	 * @covers ::desktop_mode_register_settings_tab
	 */
	public function test_register_tab_implicitly_registers_its_script() {
		$id     = 'settings-tab-e-' . uniqid();
		$handle = 'settings-script-e-' . uniqid();
		desktop_mode_register_settings_tab( array(
			'id'     => $id,
			'label'  => 'My Plugin',
			'script' => $handle,
		) );

		$this->assertTrue( desktop_mode_desktop_settings_tab_script_registry( $handle ) );
	}

	/**
	 * @covers ::desktop_mode_register_settings_tab
	 */
	public function test_register_tab_requires_id_and_label() {
		$no_id = desktop_mode_register_settings_tab( array( 'label' => 'x' ) );
		$this->assertInstanceOf( 'WP_Error', $no_id );
		$this->assertSame( 'desktop_mode_invalid_id', $no_id->get_error_code() );

		$bad_id = desktop_mode_register_settings_tab( array(
			'id'    => 'Bad Id With Spaces',
			'label' => 'x',
		) );
		$this->assertInstanceOf( 'WP_Error', $bad_id );
		$this->assertSame( 'desktop_mode_invalid_id', $bad_id->get_error_code() );

		$no_label = desktop_mode_register_settings_tab( array(
			'id' => 'settings-tab-f-' . uniqid(),
		) );
		$this->assertInstanceOf( 'WP_Error', $no_label );
		$this->assertSame( 'desktop_mode_missing_label', $no_label->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_build_desktop_settings_tabs_payload
	 */
	public function test_tabs_payload_round_trips_metadata() {
		$id     = 'settings-tab-g-' . uniqid();
		$handle = 'settings-script-g-' . uniqid();
		wp_register_script( $handle, 'https://example.test/g.js', array(), '1.0', true );
		desktop_mode_register_settings_tab( array(
			'id'         => $id,
			'label'      => 'G',
			'capability' => 'manage_options',
			'order'      => 42,
			'script'     => $handle,
		) );

		$payload = desktop_mode_build_desktop_settings_tabs_payload();

		$found = null;
		foreach ( $payload as $entry ) {
			if ( $entry['id'] === $id ) {
				$found = $entry;
				break;
			}
		}
		$this->assertNotNull( $found );
		$this->assertSame( 'G', $found['label'] );
		$this->assertSame( 'manage_options', $found['capability'] );
		$this->assertSame( 42, $found['order'] );
		$this->assertSame( $handle, $found['scriptHandle'] );
		$this->assertStringContainsString( 'g.js', $found['scriptUrl'] );
	}

	/**
	 * @covers ::desktop_mode_register_settings_tab_script
	 */
	public function test_registered_action_fires_per_call() {
		$calls = array();
		add_action( 'desktop_mode_settings_tab_script_registered', function ( $handle ) use ( &$calls ) {
			$calls[] = $handle;
		} );
		$h1 = 'settings-tab-h-' . uniqid();
		$h2 = 'settings-tab-i-' . uniqid();
		desktop_mode_register_settings_tab_script( $h1 );
		desktop_mode_register_settings_tab_script( $h2 );
		$this->assertContains( $h1, $calls );
		$this->assertContains( $h2, $calls );
	}

	/**
	 * @covers ::desktop_mode_register_settings_tab
	 */
	public function test_tab_registered_action_fires() {
		$calls = array();
		add_action( 'desktop_mode_settings_tab_registered', function ( $id, $entry ) use ( &$calls ) {
			$calls[] = array( $id, $entry );
		}, 10, 2 );
		$id = 'settings-tab-j-' . uniqid();
		desktop_mode_register_settings_tab( array(
			'id'    => $id,
			'label' => 'J',
		) );
		$this->assertCount( 1, $calls );
		$this->assertSame( $id, $calls[0][0] );
	}
}
