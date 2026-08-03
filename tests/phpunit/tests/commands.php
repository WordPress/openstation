<?php
/**
 * Tests for `open_station_register_command_script()` and
 * `open_station_register_command()` — the PHP-side entry points that
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
 * @group openstation
 * @group os-commands
 */
class Tests_OpenStation_Commands extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		// Module-level stores are process-static; flush so a prior
		// test's synthetic handle doesn't trip our payload-builder's
		// `_doing_it_wrong` notice during this test.
		open_station_flush_script_handle_registries();
	}

	public function tear_down() {
		// Symmetric flush. Without it the last test in this class
		// leaves a synthetic handle behind, and the notice surfaces
		// in whichever class next builds the shell config — making
		// the failure depend on suite ordering rather than on code.
		open_station_flush_script_handle_registries();
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_register_command_script
	 */
	public function test_register_command_script_stores_handle() {
		$handle = 'cmd-test-a-' . uniqid();
		$result = open_station_register_command_script( $handle );
		$this->assertTrue( $result );

		$this->assertTrue( open_station_desktop_command_script_registry( $handle ) );
	}

	/**
	 * @covers ::open_station_register_command_script
	 */
	public function test_register_command_script_rejects_empty_handle() {
		$result = open_station_register_command_script( '' );
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'open_station_missing_handle', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_build_desktop_command_scripts_payload
	 */
	public function test_payload_resolves_registered_handle_to_absolute_url() {
		$handle = 'cmd-test-b-' . uniqid();
		wp_register_script( $handle, 'https://example.test/cmd.js', array(), '1.0.0', true );
		open_station_register_command_script( $handle );

		$payload = open_station_build_desktop_command_scripts_payload();

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
	 * @covers ::open_station_build_desktop_command_scripts_payload
	 */
	public function test_payload_omits_unresolvable_handles() {
		$this->setExpectedIncorrectUsage( 'open_station_register_command_script' );

		$handle = 'cmd-test-c-' . uniqid();
		// Registered as a provider but the script handle itself was
		// never enqueued / registered with wp_register_script —
		// payload omits it AND fires a `_doing_it_wrong` notice
		// pointing at the unresolvable handle.
		open_station_register_command_script( $handle );

		$payload = open_station_build_desktop_command_scripts_payload();
		foreach ( $payload as $entry ) {
			$this->assertNotSame( $handle, $entry['handle'] );
		}
	}

	/**
	 * @covers ::open_station_register_command
	 */
	public function test_register_desktop_command_stores_metadata() {
		$slug = 'cmd-test-d-' . uniqid();
		$result = open_station_register_command( array(
			'slug'        => $slug,
			'label'       => 'Home Assistant: Lights',
			'description' => 'Toggle smart lights',
			'icon'        => 'dashicons-lightbulb',
		) );
		$this->assertTrue( $result );

		$entry = open_station_desktop_command_registry( $slug );
		$this->assertIsArray( $entry );
		$this->assertSame( 'Home Assistant: Lights', $entry['label'] );
		$this->assertSame( 'dashicons-lightbulb', $entry['icon'] );
	}

	/**
	 * @covers ::open_station_register_command
	 */
	public function test_register_desktop_command_implicitly_registers_its_script() {
		$slug   = 'cmd-test-e-' . uniqid();
		$handle = 'cmd-script-e-' . uniqid();
		open_station_register_command( array(
			'slug'   => $slug,
			'label'  => 'Lights',
			'script' => $handle,
		) );

		$this->assertTrue( open_station_desktop_command_script_registry( $handle ) );
	}

	/**
	 * @covers ::open_station_register_command
	 */
	public function test_register_desktop_command_requires_slug_and_label() {
		$no_slug = open_station_register_command( array( 'label' => 'x' ) );
		$this->assertInstanceOf( 'WP_Error', $no_slug );
		$this->assertSame( 'open_station_missing_slug', $no_slug->get_error_code() );

		$no_label = open_station_register_command( array( 'slug' => 'cmd-test-f-' . uniqid() ) );
		$this->assertInstanceOf( 'WP_Error', $no_label );
		$this->assertSame( 'open_station_missing_label', $no_label->get_error_code() );
	}

	/**
	 * The documented (Stable) contract for
	 * `open_station_command_script_registered` says it also fires when
	 * `open_station_register_command()` implicitly registers its
	 * `script` argument — not only on direct
	 * `open_station_register_command_script()` calls.
	 *
	 * @covers ::open_station_register_command
	 */
	public function test_registered_action_fires_on_implicit_script_registration() {
		$calls = array();
		add_action( 'open_station_command_script_registered', function ( $handle ) use ( &$calls ) {
			$calls[] = $handle;
		} );
		$slug   = 'cmd-test-i-' . uniqid();
		$handle = 'cmd-script-i-' . uniqid();
		open_station_register_command( array(
			'slug'   => $slug,
			'label'  => 'Lights',
			'script' => $handle,
		) );

		$this->assertContains( $handle, $calls );
	}

	/**
	 * @covers ::open_station_register_command_script
	 */
	public function test_registered_action_fires_per_call() {
		$calls = array();
		add_action( 'open_station_command_script_registered', function ( $handle ) use ( &$calls ) {
			$calls[] = $handle;
		} );
		$h1 = 'cmd-test-g-' . uniqid();
		$h2 = 'cmd-test-h-' . uniqid();
		open_station_register_command_script( $h1 );
		open_station_register_command_script( $h2 );
		$this->assertContains( $h1, $calls );
		$this->assertContains( $h2, $calls );
	}
}
