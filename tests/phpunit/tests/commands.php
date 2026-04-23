<?php
/**
 * Tests for `wp_desktop_register_command_script()` and
 * `wp_register_desktop_command()` — the PHP-side entry points that
 * hand command-palette providers off to the shell's server-sync so
 * newly-installed plugins appear live in the palette.
 *
 * The module-level stores behind these APIs are process-global
 * (function-level `static`), so tests use unique handle prefixes to
 * avoid cross-test contamination rather than a reset mechanism.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-commands
 */
class Tests_DesktopMode_Commands extends WP_UnitTestCase {

	/**
	 * @covers ::wp_desktop_register_command_script
	 */
	public function test_register_command_script_stores_handle() {
		$handle = 'cmd-test-a-' . uniqid();
		$result = wp_desktop_register_command_script( $handle );
		$this->assertTrue( $result );

		$this->assertTrue( wpdm_desktop_command_script_registry( $handle ) );
	}

	/**
	 * @covers ::wp_desktop_register_command_script
	 */
	public function test_register_command_script_rejects_empty_handle() {
		$result = wp_desktop_register_command_script( '' );
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'wp_desktop_missing_handle', $result->get_error_code() );
	}

	/**
	 * @covers ::wpdm_build_desktop_command_scripts_payload
	 */
	public function test_payload_resolves_registered_handle_to_absolute_url() {
		$handle = 'cmd-test-b-' . uniqid();
		wp_register_script( $handle, 'https://example.test/cmd.js', array(), '1.0.0', true );
		wp_desktop_register_command_script( $handle );

		$payload = wpdm_build_desktop_command_scripts_payload();

		$entry = null;
		foreach ( $payload as $p ) {
			if ( $p['handle'] === $handle ) {
				$entry = $p;
				break;
			}
		}
		$this->assertNotNull( $entry, 'expected handle to appear in payload' );
		$this->assertStringContainsString( 'cmd.js', $entry['scriptUrl'] );
	}

	/**
	 * @covers ::wpdm_build_desktop_command_scripts_payload
	 */
	public function test_payload_omits_unresolvable_handles() {
		$handle = 'cmd-test-c-' . uniqid();
		// Registered as a provider but the script handle itself was
		// never enqueued / registered with wp_register_script.
		wp_desktop_register_command_script( $handle );

		$payload = wpdm_build_desktop_command_scripts_payload();
		foreach ( $payload as $entry ) {
			$this->assertNotSame( $handle, $entry['handle'] );
		}
	}

	/**
	 * @covers ::wp_register_desktop_command
	 */
	public function test_register_desktop_command_stores_metadata() {
		$slug = 'cmd-test-d-' . uniqid();
		$result = wp_register_desktop_command( array(
			'slug'        => $slug,
			'label'       => 'Home Assistant: Lights',
			'description' => 'Toggle smart lights',
			'icon'        => 'dashicons-lightbulb',
		) );
		$this->assertTrue( $result );

		$entry = wpdm_desktop_command_registry( $slug );
		$this->assertIsArray( $entry );
		$this->assertSame( 'Home Assistant: Lights', $entry['label'] );
		$this->assertSame( 'dashicons-lightbulb', $entry['icon'] );
	}

	/**
	 * @covers ::wp_register_desktop_command
	 */
	public function test_register_desktop_command_implicitly_registers_its_script() {
		$slug   = 'cmd-test-e-' . uniqid();
		$handle = 'cmd-script-e-' . uniqid();
		wp_register_desktop_command( array(
			'slug'   => $slug,
			'label'  => 'Lights',
			'script' => $handle,
		) );

		$this->assertTrue( wpdm_desktop_command_script_registry( $handle ) );
	}

	/**
	 * @covers ::wp_register_desktop_command
	 */
	public function test_register_desktop_command_requires_slug_and_label() {
		$no_slug = wp_register_desktop_command( array( 'label' => 'x' ) );
		$this->assertInstanceOf( 'WP_Error', $no_slug );
		$this->assertSame( 'wp_desktop_missing_slug', $no_slug->get_error_code() );

		$no_label = wp_register_desktop_command( array( 'slug' => 'cmd-test-f-' . uniqid() ) );
		$this->assertInstanceOf( 'WP_Error', $no_label );
		$this->assertSame( 'wp_desktop_missing_label', $no_label->get_error_code() );
	}

	/**
	 * @covers ::wp_desktop_register_command_script
	 */
	public function test_registered_action_fires_per_call() {
		$calls = array();
		add_action( 'wp_desktop_command_script_registered', function ( $handle ) use ( &$calls ) {
			$calls[] = $handle;
		} );
		$h1 = 'cmd-test-g-' . uniqid();
		$h2 = 'cmd-test-h-' . uniqid();
		wp_desktop_register_command_script( $h1 );
		wp_desktop_register_command_script( $h2 );
		$this->assertContains( $h1, $calls );
		$this->assertContains( $h2, $calls );
	}
}
