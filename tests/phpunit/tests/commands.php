<?php

class Tests_OpenStation_Commands extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();

		openstation_flush_script_handle_registries();
	}

	public function tear_down() {

		openstation_flush_script_handle_registries();
		parent::tear_down();
	}

	public function test_register_command_script_stores_handle() {
		$handle = 'cmd-test-a-' . uniqid();
		$result = openstation_register_command_script( $handle );
		$this->assertTrue( $result );

		$this->assertTrue( openstation_desktop_command_script_registry( $handle ) );
	}

	public function test_register_command_script_rejects_empty_handle() {
		$result = openstation_register_command_script( '' );
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'openstation_missing_handle', $result->get_error_code() );
	}

	public function test_payload_resolves_registered_handle_to_absolute_url() {
		$handle = 'cmd-test-b-' . uniqid();
		wp_register_script( $handle, 'https://example.test/cmd.js', array(), '1.0.0', true );
		openstation_register_command_script( $handle );

		$payload = openstation_build_desktop_command_scripts_payload();

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

	public function test_payload_ships_the_dependency_closure() {
		$alias  = 'cmd-test-config-' . uniqid();
		$handle = 'cmd-test-d-' . uniqid();
		wp_register_script( $alias, false, array(), '1.0.0', true );
		wp_add_inline_script( $alias, 'window.cmdTestConfig={};', 'before' );
		wp_register_script( $handle, 'https://example.test/cmd.js', array( $alias ), '1.0.0', true );
		openstation_register_command_script( $handle );

		$entry = null;
		foreach ( openstation_build_desktop_command_scripts_payload() as $p ) {
			if ( $p['handle'] === $handle ) {
				$entry = $p;
				break;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertCount( 1, $entry['scriptDeps'] );
		$this->assertSame( $alias, $entry['scriptDeps'][0]['handle'] );
		$this->assertSame( '', $entry['scriptDeps'][0]['url'] );
		$this->assertSame( array( 'window.cmdTestConfig={};' ), $entry['scriptDeps'][0]['before'] );
	}

	public function test_payload_omits_unresolvable_handles() {
		$this->setExpectedIncorrectUsage( 'openstation_register_command_script' );

		$handle = 'cmd-test-c-' . uniqid();

		openstation_register_command_script( $handle );

		$payload = openstation_build_desktop_command_scripts_payload();
		foreach ( $payload as $entry ) {
			$this->assertNotSame( $handle, $entry['handle'] );
		}
	}

	public function test_register_desktop_command_stores_metadata() {
		$slug = 'cmd-test-d-' . uniqid();
		$result = openstation_register_command( array(
			'slug'        => $slug,
			'label'       => 'Home Assistant: Lights',
			'description' => 'Toggle smart lights',
			'icon'        => 'dashicons-lightbulb',
		) );
		$this->assertTrue( $result );

		$entry = openstation_desktop_command_registry( $slug );
		$this->assertIsArray( $entry );
		$this->assertSame( 'Home Assistant: Lights', $entry['label'] );
		$this->assertSame( 'dashicons-lightbulb', $entry['icon'] );
	}

	public function test_register_desktop_command_implicitly_registers_its_script() {
		$slug   = 'cmd-test-e-' . uniqid();
		$handle = 'cmd-script-e-' . uniqid();
		openstation_register_command( array(
			'slug'   => $slug,
			'label'  => 'Lights',
			'script' => $handle,
		) );

		$this->assertTrue( openstation_desktop_command_script_registry( $handle ) );
	}

	public function test_register_desktop_command_requires_slug_and_label() {
		$no_slug = openstation_register_command( array( 'label' => 'x' ) );
		$this->assertInstanceOf( 'WP_Error', $no_slug );
		$this->assertSame( 'openstation_missing_slug', $no_slug->get_error_code() );

		$no_label = openstation_register_command( array( 'slug' => 'cmd-test-f-' . uniqid() ) );
		$this->assertInstanceOf( 'WP_Error', $no_label );
		$this->assertSame( 'openstation_missing_label', $no_label->get_error_code() );
	}

	public function test_registered_action_fires_on_implicit_script_registration() {
		$calls = array();
		add_action( 'openstation_command_script_registered', function ( $handle ) use ( &$calls ) {
			$calls[] = $handle;
		} );
		$slug   = 'cmd-test-i-' . uniqid();
		$handle = 'cmd-script-i-' . uniqid();
		openstation_register_command( array(
			'slug'   => $slug,
			'label'  => 'Lights',
			'script' => $handle,
		) );

		$this->assertContains( $handle, $calls );
	}

	public function test_registered_action_fires_per_call() {
		$calls = array();
		add_action( 'openstation_command_script_registered', function ( $handle ) use ( &$calls ) {
			$calls[] = $handle;
		} );
		$h1 = 'cmd-test-g-' . uniqid();
		$h2 = 'cmd-test-h-' . uniqid();
		openstation_register_command_script( $h1 );
		openstation_register_command_script( $h2 );
		$this->assertContains( $h1, $calls );
		$this->assertContains( $h2, $calls );
	}
}
