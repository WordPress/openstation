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
		$this->assertSame( OPENSTATION_URL, $config['pluginUrl'] );
	}

	/**
	 * A release must be a byte change in the served worker, or an
	 * installed app that never navigates never learns about it: the
	 * bundle is content-hashed, so the version rides in the preamble.
	 *
	 * @covers ::openstation_pwa_sw_config_preamble
	 */
	public function test_preamble_carries_the_plugin_version() {
		$config = $this->decode_preamble( openstation_pwa_sw_config_preamble() );

		$this->assertSame( OPENSTATION_VERSION, $config['version'] );
	}

	/**
	 * The served bytes must NOT depend on who is asking.
	 *
	 * A service worker is origin-wide, but `adminAssetCache` and
	 * `windowPrewarm` are per-user preferences. Carrying them in the
	 * script made the body differ between an anonymous and a logged-in
	 * request, so any in-scope logged-out navigation — the interim-login
	 * iframe, logging out — served a different script. The browser
	 * treats different bytes as an update, installs it, activates it,
	 * and the shell's `controllerchange` handler hard-reloads the
	 * desktop. The shell posts both flags to the running worker instead.
	 *
	 * @covers ::openstation_pwa_sw_config_preamble
	 */
	public function test_preamble_carries_nothing_user_specific() {
		$config = $this->decode_preamble( openstation_pwa_sw_config_preamble() );

		$this->assertArrayNotHasKey( 'adminAssetCache', $config );
		$this->assertArrayNotHasKey( 'windowPrewarm', $config );
	}

	/**
	 * The bytes are identical whoever asks — the property the whole
	 * change exists to establish.
	 *
	 * @covers ::openstation_pwa_sw_config_preamble
	 */
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

	/**
	 * The filter still decides — it just reaches the worker through the
	 * shell rather than through the script bytes.
	 *
	 * This is the half that must not be lost by moving the flag out of
	 * the preamble: an operator's site-wide veto has to keep working, so
	 * the value the shell forwards is the FILTERED one, computed here,
	 * not the requesting user's raw preference.
	 *
	 * @covers ::openstation_pwa_admin_asset_cache_enabled
	 */
	public function test_the_filter_still_decides_the_forwarded_value() {
		$this->assertFalse( openstation_pwa_admin_asset_cache_enabled() );

		add_filter( 'openstation_pwa_admin_asset_cache', '__return_true' );
		$this->assertTrue( openstation_pwa_admin_asset_cache_enabled() );

		remove_all_filters( 'openstation_pwa_admin_asset_cache' );
		add_filter( 'openstation_pwa_admin_asset_cache', '__return_false' );
		$this->assertFalse(
			openstation_pwa_admin_asset_cache_enabled(),
			'a site-wide veto must survive a per-user opt-in'
		);
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
