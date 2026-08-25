<?php
/**
 * Tests for `openstation_pwa_admin_asset_cache_enabled()` and the
 * `self.__OS_SW_CONFIG` preamble that carries the value (plus the
 * plugin URL) into the served service-worker bytes.
 *
 * The preamble is the only channel between per-site PHP state and the
 * SW: a malformed line would break the whole worker at parse time, and
 * a value that stops reflecting the filter would strand operators with
 * a cache they can't turn on or off.
 *
 * @package OpenStation
 *
 * @group openstation
 */
class Tests_OpenStation_PwaAdminAssetCache extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'openstation_pwa_admin_asset_cache' );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_pwa_admin_asset_cache_enabled
	 */
	public function test_defaults_to_false() {
		$this->assertFalse( openstation_pwa_admin_asset_cache_enabled() );
	}

	/**
	 * @covers ::openstation_pwa_admin_asset_cache_enabled
	 */
	public function test_filter_can_opt_in() {
		add_filter( 'openstation_pwa_admin_asset_cache', '__return_true' );
		$this->assertTrue( openstation_pwa_admin_asset_cache_enabled() );
	}

	/**
	 * The per-user OpenStation preference (OpenStation Preferences →
	 * Features → Beta features) is the filter's default — the toggle
	 * is the intended opt-in path, no code required.
	 *
	 * @covers ::openstation_pwa_admin_asset_cache_enabled
	 */
	public function test_user_setting_drives_the_default() {
		$user_id = self::factory()->user->create();
		wp_set_current_user( $user_id );
		$this->assertFalse( openstation_pwa_admin_asset_cache_enabled() );

		openstation_save_os_settings(
			$user_id,
			array( 'adminAssetCacheEnabled' => true )
		);
		$this->assertTrue( openstation_pwa_admin_asset_cache_enabled() );
	}

	/**
	 * The filter can veto a per-user opt-in site-wide — an operator's
	 * kill switch outranks individual preferences.
	 *
	 * @covers ::openstation_pwa_admin_asset_cache_enabled
	 */
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

	/**
	 * Non-boolean filter return is coerced so the SW-side config check
	 * (`adminAssetCache === true` after JSON decode) behaves — a string
	 * `'1'` would JSON-encode as `"1"` and silently read as disabled.
	 *
	 * @covers ::openstation_pwa_admin_asset_cache_enabled
	 */
	public function test_non_boolean_return_is_coerced() {
		add_filter(
			'openstation_pwa_admin_asset_cache',
			static function () {
				return 1;
			}
		);
		$this->assertSame( true, openstation_pwa_admin_asset_cache_enabled() );
	}

	/**
	 * @covers ::openstation_pwa_sw_config_preamble
	 */
	public function test_preamble_is_parseable_and_carries_defaults() {
		$preamble = openstation_pwa_sw_config_preamble();

		$this->assertStringStartsWith( 'self.__OS_SW_CONFIG = ', $preamble );
		$this->assertStringEndsWith( ";\n", $preamble );

		$config = $this->decode_preamble( $preamble );
		$this->assertSame( false, $config['adminAssetCache'] );
		$this->assertSame( OPENSTATION_URL, $config['pluginUrl'] );
	}

	/**
	 * Flipping the filter must change the served bytes — that byte
	 * difference is what triggers the browser's SW update check, so a
	 * preamble that didn't reflect the filter would leave every
	 * installed SW running the old setting forever.
	 *
	 * @covers ::openstation_pwa_sw_config_preamble
	 */
	public function test_preamble_reflects_the_filter() {
		$before = openstation_pwa_sw_config_preamble();

		add_filter( 'openstation_pwa_admin_asset_cache', '__return_true' );
		$after = openstation_pwa_sw_config_preamble();

		$this->assertNotSame( $before, $after );
		$this->assertSame( true, $this->decode_preamble( $after )['adminAssetCache'] );
	}

	/**
	 * Extracts and decodes the JSON payload from a preamble line.
	 *
	 * @param string $preamble Preamble line from the helper.
	 * @return array Decoded config.
	 */
	private function decode_preamble( $preamble ) {
		$json   = trim( str_replace( 'self.__OS_SW_CONFIG = ', '', rtrim( $preamble, ";\n" ) ) );
		$config = json_decode( $json, true );
		$this->assertIsArray( $config, 'Preamble payload must be valid JSON.' );
		return $config;
	}
}
