<?php

class Tests_OpenStation_PwaIcons extends WP_UnitTestCase {

	public function tear_down() {
		delete_option( 'site_icon' );
		parent::tear_down();
	}

	private function set_site_icon() {
		$attachment_id = $this->factory->attachment->create_upload_object(
			DIR_TESTDATA . '/images/test-image.jpg'
		);
		update_option( 'site_icon', $attachment_id );
		return $attachment_id;
	}

	public function test_each_purpose_maps_to_its_own_file() {
		$this->assertStringEndsWith(
			'assets/pwa/icon-192.png',
			openstation_pwa_bundled_icon_url( 192 )
		);
		$this->assertStringEndsWith(
			'assets/pwa/icon-maskable-192.png',
			openstation_pwa_bundled_icon_url( 192, 'maskable' )
		);
		$this->assertStringEndsWith(
			'assets/pwa/icon-mono-192.png',
			openstation_pwa_bundled_icon_url( 192, 'monochrome' )
		);
	}

	public function test_an_unknown_purpose_falls_back_to_the_plain_tile() {
		$this->assertStringEndsWith(
			'assets/pwa/icon-512.png',
			openstation_pwa_bundled_icon_url( 512, 'teardrop' )
		);
	}

	public function test_every_bundled_icon_exists_on_disk() {
		foreach ( openstation_pwa_default_icons() as $icon ) {
			$relative = str_replace( OPENSTATION_URL, '', $icon['src'] );
			$this->assertFileExists(
				OPENSTATION_DIR . $relative,
				"manifest names {$icon['src']} but the file is not bundled"
			);
		}
	}

	public function test_the_bundled_set_declares_all_three_purposes() {
		$purposes = array_unique(
			wp_list_pluck( openstation_pwa_default_icons(), 'purpose' )
		);
		sort( $purposes );

		$this->assertSame(
			array( 'any', 'maskable', 'monochrome' ),
			$purposes
		);
	}

	public function test_the_installability_sizes_are_named_explicitly() {
		$any = array_filter(
			openstation_pwa_default_icons(),
			static function ( $icon ) {
				return 'any' === $icon['purpose'];
			}
		);
		$sizes = wp_list_pluck( $any, 'sizes' );

		$this->assertContains( '192x192', $sizes );
		$this->assertContains( '512x512', $sizes );
	}

	public function test_a_site_icon_is_declared_any_and_only_any() {
		$this->set_site_icon();

		$icons = openstation_pwa_default_icons();
		$this->assertNotEmpty( $icons );

		foreach ( $icons as $icon ) {
			$this->assertSame( 'any', $icon['purpose'] );
			$this->assertStringNotContainsString( 'assets/pwa/', $icon['src'] );
		}
	}

	public function test_apple_touch_icon_falls_back_to_the_bundled_tile() {
		$this->assertStringEndsWith(
			'assets/pwa/icon-180.png',
			openstation_pwa_apple_touch_icon_url()
		);
	}

	public function test_apple_touch_icon_prefers_the_site_icon() {
		$this->set_site_icon();

		$this->assertStringNotContainsString(
			'assets/pwa/',
			openstation_pwa_apple_touch_icon_url()
		);
	}

	public function test_the_admin_head_carries_an_apple_touch_icon() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $user_id );

		update_user_meta( $user_id, 'desktop_mode_mode', '1' );
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );

		$this->assertTrue(
			openstation_is_shell_request(),
			'the head tags never run unless this is a shell request'
		);

		ob_start();
		openstation_pwa_render_head_tags();
		$head = ob_get_clean();

		$this->assertStringContainsString( 'rel="apple-touch-icon"', $head );
		$this->assertStringContainsString( 'sizes="180x180"', $head );
		$this->assertStringContainsString( 'assets/pwa/icon-180.png', $head );
	}
}
