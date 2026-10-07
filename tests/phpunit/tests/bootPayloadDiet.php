<?php

class Tests_OpenStation_BootPayloadDiet extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		wp_scripts()->add_data( 'openstation', 'data', '' );
	}

	public function tear_down() {
		openstation_unregister_desktop_theme( 'diet-theme' );
		parent::tear_down();
	}

	private function boot_config_blob() {
		openstation_enqueue_assets();
		return (string) wp_scripts()->get_data( 'openstation', 'data' );
	}

	public function test_boot_config_strips_template_html_the_page_already_prints() {
		$registered = openstation_register_window(
			'diet-window',
			array(
				'title'    => 'Diet',
				'template' => static function () {
					echo '<p>diet-template-marker</p>';
				},
			)
		);
		$this->assertTrue( $registered );

		$blob = $this->boot_config_blob();
		$this->assertStringContainsString( '"diet-window"', $blob );
		$this->assertStringNotContainsString(
			'diet-template-marker',
			$blob,
			'The boot config must not carry template markup — the page prints it as a real <template> tag.'
		);

		ob_start();
		openstation_render_native_window_templates();
		$printed = (string) ob_get_clean();
		$this->assertStringContainsString( 'diet-template-marker', $printed );

		$payload = openstation_build_menu_payload();
		$entry   = null;
		foreach ( $payload['nativeWindows'] as $row ) {
			if ( 'diet-window' === $row['id'] ) {
				$entry = $row;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertStringContainsString( 'diet-template-marker', $entry['templateHtml'] );
	}

	public function test_boot_config_slims_desktop_theme_entries() {
		openstation_register_desktop_theme(
			'diet/theme',
			array(
				'name'   => 'Diet Theme',
				'tokens' => array( '--os-window-bg' => '#123456' ),
			)
		);

		$blob = $this->boot_config_blob();
		$this->assertStringContainsString( '"Diet Theme"', $blob );
		$this->assertStringContainsString( '"cssDeferred":true', $blob );
		$this->assertStringNotContainsString(
			'#123456',
			$blob,
			'Neither the compiled CSS nor the token map belongs in the boot config.'
		);

		$payload = openstation_build_menu_payload();
		$full    = null;
		foreach ( $payload['serverDesktopThemes'] as $row ) {
			if ( 'diet-theme' === $row['slug'] ) {
				$full = $row;
			}
		}
		$this->assertNotNull( $full );
		$this->assertStringContainsString( '#123456', $full['cssText'] );
		$this->assertSame( '#123456', $full['tokens']['--os-window-bg'] );
	}

	public function test_desktop_themes_get_route_serves_the_full_entries() {
		openstation_register_desktop_theme(
			'diet/theme',
			array(
				'name'   => 'Diet Theme',
				'tokens' => array( '--os-window-bg' => '#123456' ),
			)
		);

		do_action( 'rest_api_init' );
		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/desktop-themes' )
		);
		$this->assertSame( 200, $response->get_status() );

		$data  = $response->get_data();
		$found = null;
		foreach ( $data['themes'] as $row ) {
			if ( 'diet-theme' === $row['slug'] ) {
				$found = $row;
			}
		}
		$this->assertNotNull( $found, 'The GET route must serve the registered theme.' );
		$this->assertStringContainsString( '#123456', $found['cssText'] );
		$this->assertArrayNotHasKey( 'cssDeferred', $found, 'The route serves FULL entries — no deferral marker.' );
	}

	public function test_desktop_themes_get_route_requires_the_shell() {
		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );

		do_action( 'rest_api_init' );
		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/desktop-themes' )
		);
		$this->assertNotSame(
			200,
			$response->get_status(),
			'A user without desktop mode enabled must not read the theme library.'
		);
	}
}
