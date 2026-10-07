<?php

class Tests_OpenStation_PwaAdminAssetCache extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'openstation_pwa_admin_asset_cache' );
		parent::tear_down();
	}

	public function test_defaults_to_true() {
		$this->assertTrue( openstation_pwa_admin_asset_cache_enabled() );
	}

	public function test_filter_can_opt_in() {
		add_filter( 'openstation_pwa_admin_asset_cache', '__return_true' );
		$this->assertTrue( openstation_pwa_admin_asset_cache_enabled() );
	}

	public function test_extended_option_drives_the_default() {
		$this->assertTrue( openstation_pwa_admin_asset_cache_enabled() );
		openstation_save_extended_options( array( 'admin_asset_cache' => false ) );
		$this->assertFalse( openstation_pwa_admin_asset_cache_enabled() );
		openstation_save_extended_options( array( 'admin_asset_cache' => true ) );
		$this->assertTrue( openstation_pwa_admin_asset_cache_enabled() );
	}

	public function test_filter_overrides_the_user_setting() {
		$user_id = self::factory()->user->create();
		wp_set_current_user( $user_id );
		openstation_save_os_settings(
			$user_id,
			array( 'adminAssetCacheEnabled' => true )
		);

		add_filter( 'openstation_pwa_admin_asset_cache', '__return_false' );
		$this->assertFalse( openstation_pwa_admin_asset_cache_enabled() );
	}

	public function test_non_boolean_return_is_coerced() {
		add_filter(
			'openstation_pwa_admin_asset_cache',
			static function () {
				return 1;
			}
		);
		$this->assertSame( true, openstation_pwa_admin_asset_cache_enabled() );
	}

	public function test_preamble_is_parseable_and_carries_defaults() {
		$preamble = openstation_pwa_sw_config_preamble();

		$this->assertStringStartsWith( 'self.__OS_SW_CONFIG = ', $preamble );
		$this->assertStringEndsWith( ";\n", $preamble );

		$config = $this->decode_preamble( $preamble );
		$this->assertSame( OPENSTATION_URL, $config['pluginUrl'] );
	}

	public function test_preamble_carries_the_plugin_version() {
		$config = $this->decode_preamble( openstation_pwa_sw_config_preamble() );

		$this->assertSame( OPENSTATION_VERSION, $config['version'] );
	}

	public function test_preamble_carries_the_shell_build_stamp() {
		$config = $this->decode_preamble( openstation_pwa_sw_config_preamble() );

		$this->assertArrayHasKey( 'shellBuild', $config );
		$this->assertSame( openstation_shell_build_stamp(), $config['shellBuild'] );
	}

	public function test_preamble_carries_nothing_user_specific() {
		$config = $this->decode_preamble( openstation_pwa_sw_config_preamble() );

		$this->assertArrayNotHasKey( 'adminAssetCache', $config );
		$this->assertArrayNotHasKey( 'windowPrewarm', $config );
	}

	public function test_preamble_is_identical_logged_in_and_out() {
		$admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		update_user_meta(
			$admin,
			'desktop_mode_os_settings',
			wp_json_encode(
				array(
					'adminAssetCacheEnabled' => true,
					'windowPrewarmEnabled'   => true,
				)
			)
		);
		add_filter( 'openstation_pwa_admin_asset_cache', '__return_true' );

		wp_set_current_user( 0 );
		$anonymous = openstation_pwa_sw_config_preamble();
		wp_set_current_user( $admin );
		$authenticated = openstation_pwa_sw_config_preamble();

		$this->assertSame( $anonymous, $authenticated );
	}

	public function test_the_filter_still_decides_the_forwarded_value() {
		$this->assertTrue( openstation_pwa_admin_asset_cache_enabled() );

		add_filter( 'openstation_pwa_admin_asset_cache', '__return_true' );
		$this->assertTrue( openstation_pwa_admin_asset_cache_enabled() );

		remove_all_filters( 'openstation_pwa_admin_asset_cache' );
		add_filter( 'openstation_pwa_admin_asset_cache', '__return_false' );
		$this->assertFalse(
			openstation_pwa_admin_asset_cache_enabled(),
			'a site-wide veto must survive a per-user opt-in'
		);
	}

	private function decode_preamble( $preamble ) {
		$json   = trim( str_replace( 'self.__OS_SW_CONFIG = ', '', rtrim( $preamble, ";\n" ) ) );
		$config = json_decode( $json, true );
		$this->assertIsArray( $config, 'Preamble payload must be valid JSON.' );
		return $config;
	}
}
