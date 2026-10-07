<?php

class Tests_OpenStation_WindowChrome extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		openstation_flush_script_handle_registries();
	}

	public function test_register_window_theme_script_stores_handle() {
		$handle = 'theme-test-a-' . uniqid();
		$result = openstation_register_window_theme_script( $handle );
		$this->assertTrue( $result );
		$this->assertTrue( openstation_window_theme_script_registry( $handle ) );
	}

	public function test_register_window_theme_script_rejects_empty_handle() {
		$result = openstation_register_window_theme_script( '' );
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'openstation_missing_handle', $result->get_error_code() );
	}

	public function test_register_window_theme_stores_metadata_with_tokens() {
		$id     = 'plug/midnight-' . uniqid();
		$result = openstation_register_window_theme(
			array(
				'id'       => $id,
				'label'    => 'Midnight',
				'tokens'   => array(
					'--os-titlebar-bg' => '#1a1a2e',
				),
				'priority' => 50,
			)
		);
		$this->assertTrue( $result );
		$entry = openstation_window_theme_registry( $id );
		$this->assertIsArray( $entry );
		$this->assertSame( 'Midnight', $entry['label'] );
		$this->assertSame( '#1a1a2e', $entry['tokens']['--os-titlebar-bg'] );
		$this->assertSame( 50, $entry['priority'] );
	}

	public function test_register_window_theme_rejects_missing_tokens() {
		$result = openstation_register_window_theme(
			array(
				'id'     => 'plug/empty-' . uniqid(),
				'tokens' => array(),
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'openstation_missing_tokens', $result->get_error_code() );
	}

	public function test_register_window_theme_rejects_invalid_token_keys() {
		$result = openstation_register_window_theme(
			array(
				'id'     => 'plug/bad-token-' . uniqid(),
				'tokens' => array(

					'os-titlebar-bg' => '#fa0',
				),
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'openstation_invalid_token', $result->get_error_code() );
	}

	public function test_register_window_theme_implicitly_registers_companion_script() {
		$id     = 'plug/with-script-' . uniqid();
		$handle = 'theme-script-' . uniqid();
		openstation_register_window_theme(
			array(
				'id'     => $id,
				'tokens' => array( '--os-titlebar-bg' => '#fa0' ),
				'script' => $handle,
			)
		);
		$this->assertTrue( openstation_window_theme_script_registry( $handle ) );
	}

	public function test_window_theme_scripts_payload_resolves_url() {
		$handle = 'theme-payload-' . uniqid();
		wp_register_script( $handle, 'https://example.test/theme.js', array(), '1.0.0', true );
		openstation_register_window_theme_script( $handle );

		$payload = openstation_build_window_theme_scripts_payload();
		$found   = null;
		foreach ( $payload as $entry ) {
			if ( $entry['handle'] === $handle ) {
				$found = $entry;
			}
		}
		$this->assertNotNull( $found );
		$this->assertStringContainsString( 'theme.js', $found['scriptUrl'] );
	}

	public function test_window_themes_payload_includes_tokens_and_priority() {
		$id = 'plug/payload-' . uniqid();
		openstation_register_window_theme(
			array(
				'id'       => $id,
				'label'    => 'Payload',
				'tokens'   => array( '--os-titlebar-bg' => '#0ff' ),
				'priority' => 200,
			)
		);
		$payload = openstation_build_window_themes_payload();
		$found   = null;
		foreach ( $payload as $entry ) {
			if ( $entry['id'] === $id ) {
				$found = $entry;
			}
		}
		$this->assertNotNull( $found );
		$this->assertSame( '#0ff', $found['tokens']['--os-titlebar-bg'] );
		$this->assertSame( 200, $found['priority'] );
	}

	public function test_window_theme_script_action_fires() {
		$calls = array();
		add_action(
			'openstation_window_theme_script_registered',
			function ( $handle ) use ( &$calls ) {
				$calls[] = $handle;
			}
		);
		$h1 = 'theme-action-a-' . uniqid();
		$h2 = 'theme-action-b-' . uniqid();
		openstation_register_window_theme_script( $h1 );
		openstation_register_window_theme_script( $h2 );
		$this->assertContains( $h1, $calls );
		$this->assertContains( $h2, $calls );
	}

	public function test_register_window_control_script_stores_handle() {
		$handle = 'ctrl-test-a-' . uniqid();
		$this->assertTrue( openstation_register_window_control_script( $handle ) );
		$this->assertTrue( openstation_window_control_script_registry( $handle ) );
	}

	public function test_register_window_control_stores_metadata() {
		$id = 'plug/star-' . uniqid();
		openstation_register_window_control(
			array(
				'id'        => $id,
				'label'     => 'Star',
				'icon'      => 'dashicons-star-filled',
				'placement' => 'right',
				'order'     => 50,
			)
		);
		$entry = openstation_window_control_registry( $id );
		$this->assertSame( 'right', $entry['placement'] );
		$this->assertSame( 50, $entry['order'] );
	}

	public function test_register_window_control_rejects_invalid_placement() {
		$result = openstation_register_window_control(
			array(
				'id'        => 'plug/bad-place-' . uniqid(),
				'label'     => 'X',
				'placement' => 'top',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'openstation_invalid_placement', $result->get_error_code() );
	}

	public function test_register_window_control_requires_id_and_label() {
		$no_id = openstation_register_window_control( array( 'label' => 'X' ) );
		$this->assertInstanceOf( 'WP_Error', $no_id );
		$this->assertSame( 'openstation_missing_id', $no_id->get_error_code() );

		$no_label = openstation_register_window_control(
			array( 'id' => 'plug/no-label-' . uniqid() )
		);
		$this->assertInstanceOf( 'WP_Error', $no_label );
		$this->assertSame( 'openstation_missing_label', $no_label->get_error_code() );
	}

	public function test_window_control_scripts_payload_resolves_url() {
		$handle = 'ctrl-payload-' . uniqid();
		wp_register_script( $handle, 'https://example.test/ctrl.js', array(), '1.0.0', true );
		openstation_register_window_control_script( $handle );

		$payload = openstation_build_window_control_scripts_payload();
		$found   = null;
		foreach ( $payload as $entry ) {
			if ( $entry['handle'] === $handle ) {
				$found = $entry;
			}
		}
		$this->assertNotNull( $found );
		$this->assertStringContainsString( 'ctrl.js', $found['scriptUrl'] );
	}

	public function test_register_window_slot_script_stores_handle() {
		$handle = 'slot-test-a-' . uniqid();
		$this->assertTrue( openstation_register_window_slot_script( $handle ) );
		$this->assertTrue( openstation_window_slot_script_registry( $handle ) );
	}

	public function test_register_window_slot_stores_metadata() {
		$id = 'plug/title-prefix-' . uniqid();
		openstation_register_window_slot(
			array(
				'id'    => $id,
				'slot'  => 'title',
				'order' => 10,
			)
		);
		$entry = openstation_window_slot_registry( $id );
		$this->assertSame( 'title', $entry['slot'] );
		$this->assertSame( 10, $entry['order'] );
	}

	public function test_register_window_slot_rejects_unknown_slot_name() {
		$result = openstation_register_window_slot(
			array(
				'id'   => 'plug/x-' . uniqid(),
				'slot' => 'not-a-slot',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'openstation_invalid_slot', $result->get_error_code() );
	}

	public function test_known_slot_names_match_canonical_list() {
		$expected = array(
			'before-titlebar',
			'before-icon',
			'icon',
			'title',
			'after-title',
			'before-controls',
			'controls',
			'after-controls',
			'after-titlebar',
		);
		$this->assertSame( $expected, openstation_window_slot_names() );
	}

	public function test_register_window_chrome_script_stores_handle() {
		$handle = 'chrome-test-a-' . uniqid();
		$this->assertTrue( openstation_register_window_chrome_script( $handle ) );
		$this->assertTrue( openstation_window_chrome_script_registry( $handle ) );
	}

	public function test_register_window_chrome_stores_metadata() {
		$id = 'plug/macos-' . uniqid();
		openstation_register_window_chrome(
			array(
				'id'    => $id,
				'label' => 'macOS Style',
			)
		);
		$entry = openstation_window_chrome_registry( $id );
		$this->assertSame( 'macOS Style', $entry['label'] );
	}

	public function test_register_window_chrome_requires_id() {
		$result = openstation_register_window_chrome( array() );
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'openstation_missing_id', $result->get_error_code() );
	}

	public function test_window_chrome_action_fires() {
		$calls = array();
		add_action(
			'openstation_window_chrome_script_registered',
			function ( $handle ) use ( &$calls ) {
				$calls[] = $handle;
			}
		);
		$handle = 'chrome-action-' . uniqid();
		openstation_register_window_chrome_script( $handle );
		$this->assertContains( $handle, $calls );
	}

	public function test_flush_clears_every_window_chrome_registry() {
		openstation_register_window_theme_script( 'theme-flush-' . uniqid() );
		openstation_register_window_control_script( 'ctrl-flush-' . uniqid() );
		openstation_register_window_slot_script( 'slot-flush-' . uniqid() );
		openstation_register_window_chrome_script( 'chrome-flush-' . uniqid() );

		$this->assertNotEmpty( openstation_window_theme_script_registry() );
		$this->assertNotEmpty( openstation_window_control_script_registry() );
		$this->assertNotEmpty( openstation_window_slot_script_registry() );
		$this->assertNotEmpty( openstation_window_chrome_script_registry() );

		openstation_flush_script_handle_registries();

		$this->assertSame( array(), openstation_window_theme_script_registry() );
		$this->assertSame( array(), openstation_window_control_script_registry() );
		$this->assertSame( array(), openstation_window_slot_script_registry() );
		$this->assertSame( array(), openstation_window_chrome_script_registry() );
	}
}
