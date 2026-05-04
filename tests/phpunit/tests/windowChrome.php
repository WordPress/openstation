<?php
/**
 * Phase A foundation tests for the four window-chrome registration
 * surfaces: themes, controls, slots, and (Experimental) custom
 * chrome.
 *
 * Each surface mirrors the commands / settings-tabs / title-bar
 * pattern: a `desktop_mode_register_*_script()` opt-in for live JS
 * loading + an optional `desktop_mode_register_*()` for metadata
 * pre-declaration. These tests verify storage, validation, action
 * firings, and payload-build output.
 *
 * Module-level stores behind these APIs are process-global (function-
 * level `static`), so tests use unique handle / id prefixes to avoid
 * cross-test contamination on top of the central flush in `set_up`.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-window-chrome
 */
class Tests_DesktopMode_WindowChrome extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		desktop_mode_flush_script_handle_registries();
	}

	/* ============================================================
	 * Layer 1 — Themes
	 * ============================================================ */

	/**
	 * @covers ::desktop_mode_register_window_theme_script
	 */
	public function test_register_window_theme_script_stores_handle() {
		$handle = 'theme-test-a-' . uniqid();
		$result = desktop_mode_register_window_theme_script( $handle );
		$this->assertTrue( $result );
		$this->assertTrue( desktop_mode_window_theme_script_registry( $handle ) );
	}

	/**
	 * @covers ::desktop_mode_register_window_theme_script
	 */
	public function test_register_window_theme_script_rejects_empty_handle() {
		$result = desktop_mode_register_window_theme_script( '' );
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_missing_handle', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_window_theme
	 */
	public function test_register_window_theme_stores_metadata_with_tokens() {
		$id     = 'plug/midnight-' . uniqid();
		$result = desktop_mode_register_window_theme(
			array(
				'id'       => $id,
				'label'    => 'Midnight',
				'tokens'   => array(
					'--desktop-mode-titlebar-bg' => '#1a1a2e',
				),
				'priority' => 50,
			)
		);
		$this->assertTrue( $result );
		$entry = desktop_mode_window_theme_registry( $id );
		$this->assertIsArray( $entry );
		$this->assertSame( 'Midnight', $entry['label'] );
		$this->assertSame( '#1a1a2e', $entry['tokens']['--desktop-mode-titlebar-bg'] );
		$this->assertSame( 50, $entry['priority'] );
	}

	/**
	 * @covers ::desktop_mode_register_window_theme
	 */
	public function test_register_window_theme_rejects_missing_tokens() {
		$result = desktop_mode_register_window_theme(
			array(
				'id'     => 'plug/empty-' . uniqid(),
				'tokens' => array(),
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_missing_tokens', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_window_theme
	 */
	public function test_register_window_theme_rejects_invalid_token_keys() {
		$result = desktop_mode_register_window_theme(
			array(
				'id'     => 'plug/bad-token-' . uniqid(),
				'tokens' => array(
					// Missing the leading `--` — must be rejected.
					'desktop-mode-titlebar-bg' => '#fa0',
				),
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_invalid_token', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_window_theme
	 */
	public function test_register_window_theme_implicitly_registers_companion_script() {
		$id     = 'plug/with-script-' . uniqid();
		$handle = 'theme-script-' . uniqid();
		desktop_mode_register_window_theme(
			array(
				'id'     => $id,
				'tokens' => array( '--desktop-mode-titlebar-bg' => '#fa0' ),
				'script' => $handle,
			)
		);
		$this->assertTrue( desktop_mode_window_theme_script_registry( $handle ) );
	}

	/**
	 * @covers ::desktop_mode_build_window_theme_scripts_payload
	 */
	public function test_window_theme_scripts_payload_resolves_url() {
		$handle = 'theme-payload-' . uniqid();
		wp_register_script( $handle, 'https://example.test/theme.js', array(), '1.0.0', true );
		desktop_mode_register_window_theme_script( $handle );

		$payload = desktop_mode_build_window_theme_scripts_payload();
		$found   = null;
		foreach ( $payload as $entry ) {
			if ( $entry['handle'] === $handle ) {
				$found = $entry;
			}
		}
		$this->assertNotNull( $found );
		$this->assertStringContainsString( 'theme.js', $found['scriptUrl'] );
	}

	/**
	 * @covers ::desktop_mode_build_window_themes_payload
	 */
	public function test_window_themes_payload_includes_tokens_and_priority() {
		$id = 'plug/payload-' . uniqid();
		desktop_mode_register_window_theme(
			array(
				'id'       => $id,
				'label'    => 'Payload',
				'tokens'   => array( '--desktop-mode-titlebar-bg' => '#0ff' ),
				'priority' => 200,
			)
		);
		$payload = desktop_mode_build_window_themes_payload();
		$found   = null;
		foreach ( $payload as $entry ) {
			if ( $entry['id'] === $id ) {
				$found = $entry;
			}
		}
		$this->assertNotNull( $found );
		$this->assertSame( '#0ff', $found['tokens']['--desktop-mode-titlebar-bg'] );
		$this->assertSame( 200, $found['priority'] );
	}

	/**
	 * @covers ::desktop_mode_register_window_theme_script
	 */
	public function test_window_theme_script_action_fires() {
		$calls = array();
		add_action(
			'desktop_mode_window_theme_script_registered',
			function ( $handle ) use ( &$calls ) {
				$calls[] = $handle;
			}
		);
		$h1 = 'theme-action-a-' . uniqid();
		$h2 = 'theme-action-b-' . uniqid();
		desktop_mode_register_window_theme_script( $h1 );
		desktop_mode_register_window_theme_script( $h2 );
		$this->assertContains( $h1, $calls );
		$this->assertContains( $h2, $calls );
	}

	/* ============================================================
	 * Layer 2 — Controls
	 * ============================================================ */

	/**
	 * @covers ::desktop_mode_register_window_control_script
	 */
	public function test_register_window_control_script_stores_handle() {
		$handle = 'ctrl-test-a-' . uniqid();
		$this->assertTrue( desktop_mode_register_window_control_script( $handle ) );
		$this->assertTrue( desktop_mode_window_control_script_registry( $handle ) );
	}

	/**
	 * @covers ::desktop_mode_register_window_control
	 */
	public function test_register_window_control_stores_metadata() {
		$id = 'plug/star-' . uniqid();
		desktop_mode_register_window_control(
			array(
				'id'        => $id,
				'label'     => 'Star',
				'icon'      => 'dashicons-star-filled',
				'placement' => 'right',
				'order'     => 50,
			)
		);
		$entry = desktop_mode_window_control_registry( $id );
		$this->assertSame( 'right', $entry['placement'] );
		$this->assertSame( 50, $entry['order'] );
	}

	/**
	 * @covers ::desktop_mode_register_window_control
	 */
	public function test_register_window_control_rejects_invalid_placement() {
		$result = desktop_mode_register_window_control(
			array(
				'id'        => 'plug/bad-place-' . uniqid(),
				'label'     => 'X',
				'placement' => 'top',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_invalid_placement', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_window_control
	 */
	public function test_register_window_control_requires_id_and_label() {
		$no_id = desktop_mode_register_window_control( array( 'label' => 'X' ) );
		$this->assertInstanceOf( 'WP_Error', $no_id );
		$this->assertSame( 'desktop_mode_missing_id', $no_id->get_error_code() );

		$no_label = desktop_mode_register_window_control(
			array( 'id' => 'plug/no-label-' . uniqid() )
		);
		$this->assertInstanceOf( 'WP_Error', $no_label );
		$this->assertSame( 'desktop_mode_missing_label', $no_label->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_build_window_control_scripts_payload
	 */
	public function test_window_control_scripts_payload_resolves_url() {
		$handle = 'ctrl-payload-' . uniqid();
		wp_register_script( $handle, 'https://example.test/ctrl.js', array(), '1.0.0', true );
		desktop_mode_register_window_control_script( $handle );

		$payload = desktop_mode_build_window_control_scripts_payload();
		$found   = null;
		foreach ( $payload as $entry ) {
			if ( $entry['handle'] === $handle ) {
				$found = $entry;
			}
		}
		$this->assertNotNull( $found );
		$this->assertStringContainsString( 'ctrl.js', $found['scriptUrl'] );
	}

	/* ============================================================
	 * Layer 3 — Slots
	 * ============================================================ */

	/**
	 * @covers ::desktop_mode_register_window_slot_script
	 */
	public function test_register_window_slot_script_stores_handle() {
		$handle = 'slot-test-a-' . uniqid();
		$this->assertTrue( desktop_mode_register_window_slot_script( $handle ) );
		$this->assertTrue( desktop_mode_window_slot_script_registry( $handle ) );
	}

	/**
	 * @covers ::desktop_mode_register_window_slot
	 */
	public function test_register_window_slot_stores_metadata() {
		$id = 'plug/title-prefix-' . uniqid();
		desktop_mode_register_window_slot(
			array(
				'id'    => $id,
				'slot'  => 'title',
				'order' => 10,
			)
		);
		$entry = desktop_mode_window_slot_registry( $id );
		$this->assertSame( 'title', $entry['slot'] );
		$this->assertSame( 10, $entry['order'] );
	}

	/**
	 * @covers ::desktop_mode_register_window_slot
	 */
	public function test_register_window_slot_rejects_unknown_slot_name() {
		$result = desktop_mode_register_window_slot(
			array(
				'id'   => 'plug/x-' . uniqid(),
				'slot' => 'not-a-slot',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_invalid_slot', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_window_slot_names
	 */
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
		$this->assertSame( $expected, desktop_mode_window_slot_names() );
	}

	/* ============================================================
	 * Layer 4 — Custom chrome (Experimental)
	 * ============================================================ */

	/**
	 * @covers ::desktop_mode_register_window_chrome_script
	 */
	public function test_register_window_chrome_script_stores_handle() {
		$handle = 'chrome-test-a-' . uniqid();
		$this->assertTrue( desktop_mode_register_window_chrome_script( $handle ) );
		$this->assertTrue( desktop_mode_window_chrome_script_registry( $handle ) );
	}

	/**
	 * @covers ::desktop_mode_register_window_chrome
	 */
	public function test_register_window_chrome_stores_metadata() {
		$id = 'plug/macos-' . uniqid();
		desktop_mode_register_window_chrome(
			array(
				'id'    => $id,
				'label' => 'macOS Style',
			)
		);
		$entry = desktop_mode_window_chrome_registry( $id );
		$this->assertSame( 'macOS Style', $entry['label'] );
	}

	/**
	 * @covers ::desktop_mode_register_window_chrome
	 */
	public function test_register_window_chrome_requires_id() {
		$result = desktop_mode_register_window_chrome( array() );
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_missing_id', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_window_chrome_script
	 */
	public function test_window_chrome_action_fires() {
		$calls = array();
		add_action(
			'desktop_mode_window_chrome_script_registered',
			function ( $handle ) use ( &$calls ) {
				$calls[] = $handle;
			}
		);
		$handle = 'chrome-action-' . uniqid();
		desktop_mode_register_window_chrome_script( $handle );
		$this->assertContains( $handle, $calls );
	}

	/* ============================================================
	 * Cross-cutting — flush helper
	 * ============================================================ */

	/**
	 * @covers ::desktop_mode_flush_script_handle_registries
	 */
	public function test_flush_clears_every_window_chrome_registry() {
		desktop_mode_register_window_theme_script( 'theme-flush-' . uniqid() );
		desktop_mode_register_window_control_script( 'ctrl-flush-' . uniqid() );
		desktop_mode_register_window_slot_script( 'slot-flush-' . uniqid() );
		desktop_mode_register_window_chrome_script( 'chrome-flush-' . uniqid() );

		$this->assertNotEmpty( desktop_mode_window_theme_script_registry() );
		$this->assertNotEmpty( desktop_mode_window_control_script_registry() );
		$this->assertNotEmpty( desktop_mode_window_slot_script_registry() );
		$this->assertNotEmpty( desktop_mode_window_chrome_script_registry() );

		desktop_mode_flush_script_handle_registries();

		$this->assertSame( array(), desktop_mode_window_theme_script_registry() );
		$this->assertSame( array(), desktop_mode_window_control_script_registry() );
		$this->assertSame( array(), desktop_mode_window_slot_script_registry() );
		$this->assertSame( array(), desktop_mode_window_chrome_script_registry() );
	}
}
