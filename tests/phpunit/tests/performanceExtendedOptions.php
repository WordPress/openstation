<?php

defined( 'ABSPATH' ) || exit;

class Tests_OpenStation_PerformanceExtendedOptions extends WP_UnitTestCase {

	public function test_defaults_and_partial_saves_preserve_opt_outs() {
		$options = openstation_get_extended_options();
		$this->assertTrue( $options['window_prewarm'] );
		$this->assertTrue( $options['admin_asset_cache'] );
		openstation_save_extended_options( array( 'window_prewarm' => false, 'admin_asset_cache' => false ) );
		openstation_save_extended_options( array( 'games' => true ) );
		$options = openstation_get_extended_options();
		$this->assertFalse( $options['window_prewarm'] );
		$this->assertFalse( $options['admin_asset_cache'] );
	}

	public function test_site_options_override_legacy_preferences_for_every_user() {
		$user = self::factory()->user->create();
		update_user_meta( $user, OPENSTATION_OS_SETTINGS_META_KEY, array( 'windowPrewarmEnabled' => false, 'adminAssetCacheEnabled' => false ) );
		$settings = openstation_get_os_settings( $user );
		$this->assertTrue( $settings['windowPrewarmEnabled'] );
		$this->assertTrue( $settings['adminAssetCacheEnabled'] );

		openstation_save_extended_options( array( 'window_prewarm' => false, 'admin_asset_cache' => false ) );
		$fresh = self::factory()->user->create();
		foreach ( array( 0, $fresh, $user ) as $id ) {
			$settings = openstation_get_os_settings( $id );
			$this->assertFalse( $settings['windowPrewarmEnabled'] );
			$this->assertFalse( $settings['adminAssetCacheEnabled'] );
		}
		openstation_save_os_settings( $user, array( 'windowPrewarmEnabled' => true, 'adminAssetCacheEnabled' => true ) );
		$this->assertFalse( openstation_get_os_settings( $user )['windowPrewarmEnabled'] );
		$this->assertFalse( openstation_get_os_settings( $user )['adminAssetCacheEnabled'] );
	}

	public function test_only_administrators_can_change_site_options() {
		foreach ( array( 0, self::factory()->user->create( array( 'role' => 'subscriber' ) ) ) as $id ) {
			wp_set_current_user( $id );
			$this->assertWPError( openstation_rest_extended_options_permission() );
		}
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$this->assertTrue( openstation_rest_extended_options_permission() );
	}
}
