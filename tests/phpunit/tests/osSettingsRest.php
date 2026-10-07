<?php

class Tests_OpenStation_OsSettingsRest extends WP_UnitTestCase {

	protected static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		update_user_meta( self::$user_id, 'desktop_mode_mode', '1' );
		wp_set_current_user( self::$user_id );
	}

	private function post( array $settings ) {
		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/os-settings' );
		$req->set_param( 'settings', $settings );
		return openstation_rest_save_os_settings( $req );
	}

	public function test_partial_payload_keeps_fields_it_omits() {
		$this->post(
			array(
				'wallpaper' => 'dark',
				'accent'    => 'pulse',
			)
		);

		$this->post( array( 'accent' => 'nebula' ) );

		$loaded = openstation_get_os_settings( self::$user_id );
		$this->assertSame( 'nebula', $loaded['accent'], 'The field the request sent must win.' );
		$this->assertSame( 'dark', $loaded['wallpaper'], 'A field the request omitted must survive.' );
	}

	public function test_omitted_key_does_not_fall_back_to_the_default() {
		$defaults = openstation_default_os_settings();
		$this->assertNotSame( 'compact', $defaults['dockSize'], 'Fixture assumes a non-default value.' );

		$this->post( array( 'dockSize' => 'compact' ) );
		$this->post( array( 'accent' => 'nebula' ) );

		$loaded = openstation_get_os_settings( self::$user_id );
		$this->assertSame( 'compact', $loaded['dockSize'] );
	}

	public function test_explicit_false_still_turns_a_setting_off() {
		$this->post( array( 'nativePostsEnabled' => true ) );
		$this->assertTrue( openstation_get_os_settings( self::$user_id )['nativePostsEnabled'] );

		$this->post( array( 'nativePostsEnabled' => false ) );
		$this->assertFalse( openstation_get_os_settings( self::$user_id )['nativePostsEnabled'] );
	}

	public function test_full_payload_replaces_every_field() {
		$this->post( array( 'wallpaper' => 'dark' ) );

		$full              = openstation_default_os_settings();
		$full['accent']    = 'nebula';
		$this->post( $full );

		$loaded = openstation_get_os_settings( self::$user_id );
		$this->assertSame( 'nebula', $loaded['accent'] );
		$this->assertSame(
			$full['wallpaper'],
			$loaded['wallpaper'],
			'A full payload still overrides a previously stored value.'
		);
	}

	public function test_response_returns_the_merged_settings() {
		$this->post( array( 'wallpaper' => 'dark' ) );
		$res = $this->post( array( 'accent' => 'nebula' ) );

		$data = $res->get_data();
		$this->assertSame( 'nebula', $data['accent'] );
		$this->assertSame( 'dark', $data['wallpaper'] );
	}

	public function test_the_saver_itself_still_replaces() {
		openstation_save_os_settings( self::$user_id, array( 'dockSize' => 'compact' ) );
		openstation_save_os_settings( self::$user_id, array( 'accent' => 'nebula' ) );

		$loaded   = openstation_get_os_settings( self::$user_id );
		$defaults = openstation_default_os_settings();
		$this->assertSame( 'nebula', $loaded['accent'] );
		$this->assertSame(
			$defaults['dockSize'],
			$loaded['dockSize'],
			'Direct saves must keep resetting omitted keys to the default.'
		);
	}

	public function test_non_array_payload_changes_nothing() {
		$this->post( array( 'wallpaper' => 'dark' ) );

		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/os-settings' );
		$req->set_param( 'settings', 'not-an-array' );
		$res = openstation_rest_save_os_settings( $req );

		$this->assertSame( 'dark', $res->get_data()['wallpaper'] );
		$this->assertSame(
			'dark',
			openstation_get_os_settings( self::$user_id )['wallpaper'],
			'A junk payload must not reset stored settings to the defaults.'
		);
	}
}
