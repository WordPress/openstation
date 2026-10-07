<?php

class Tests_OpenStation_DefaultWindow extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();

		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, OPENSTATION_DEFAULT_WINDOW_META );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		delete_user_meta( self::$admin_id, OPENSTATION_SESSION_META_KEY );
		parent::tear_down();
	}

	public function test_get_returns_sane_defaults_for_unconfigured_user() {
		$pref = openstation_get_default_window( self::$admin_id );

		$this->assertTrue( $pref['enabled'] );
		$this->assertSame( admin_url( 'index.php' ), $pref['url'] );
	}

	public function test_get_falls_back_when_meta_value_is_not_an_array() {
		update_user_meta( self::$admin_id, OPENSTATION_DEFAULT_WINDOW_META, 'garbage' );

		$pref = openstation_get_default_window( self::$admin_id );

		$this->assertTrue( $pref['enabled'] );
		$this->assertSame( admin_url( 'index.php' ), $pref['url'] );
	}

	public function test_set_stores_an_enabled_preference_with_url() {
		$ok = openstation_set_default_window( self::$admin_id, admin_url( 'edit.php' ) );

		$this->assertTrue( $ok );
		$pref = openstation_get_default_window( self::$admin_id );
		$this->assertTrue( $pref['enabled'] );
		$this->assertStringContainsString( 'edit.php', $pref['url'] );
	}

	public function test_set_null_disables_the_preference() {
		openstation_set_default_window( self::$admin_id, admin_url( 'edit.php' ) );
		openstation_set_default_window( self::$admin_id, null );

		$pref = openstation_get_default_window( self::$admin_id );
		$this->assertFalse( $pref['enabled'] );

		$this->assertSame( admin_url( 'index.php' ), $pref['url'] );
	}

	public function test_set_rejects_invalid_user_id() {
		$this->assertFalse( openstation_set_default_window( 0, admin_url( 'edit.php' ) ) );
		$this->assertFalse( openstation_set_default_window( -1, admin_url( 'edit.php' ) ) );
	}

	public function test_validate_accepts_same_origin_admin_url() {
		$clean = openstation_validate_default_window_url( admin_url( 'edit.php?post_type=page' ) );

		$this->assertNotSame( '', $clean );
		$this->assertStringContainsString( 'edit.php', $clean );
	}

	public function test_validate_rejects_cross_origin_url() {
		$this->assertSame(
			'',
			openstation_validate_default_window_url( 'https://evil.example.com/wp-admin/edit.php' )
		);
	}

	public function test_validate_rejects_non_admin_paths() {
		$this->assertSame(
			'',
			openstation_validate_default_window_url( home_url( '/some-front-end-page/' ) )
		);
	}

	public function test_validate_rejects_non_http_schemes() {
		$this->assertSame(
			'',
			openstation_validate_default_window_url( 'javascript:alert(1)' )
		);
		$this->assertSame(
			'',
			openstation_validate_default_window_url( 'file:///etc/passwd' )
		);
	}

	public function test_validate_preserves_query_string() {
		$clean = openstation_validate_default_window_url( admin_url( 'edit.php?post_type=page&orderby=date' ) );

		$this->assertStringContainsString( 'post_type=page', $clean );
		$this->assertStringContainsString( 'orderby=date', $clean );
	}

	public function test_portal_entry_url_honors_disabled_preference() {
		openstation_set_default_window( self::$admin_id, null );

		$url = openstation_portal_entry_url( self::$admin_id );

		$this->assertSame( admin_url( 'index.php' ), $url );
	}

	public function test_portal_entry_url_uses_configured_preference() {
		openstation_set_default_window( self::$admin_id, admin_url( 'plugins.php' ) );

		$url = openstation_portal_entry_url( self::$admin_id );

		$this->assertStringContainsString( 'plugins.php', $url );
	}

	public function test_validate_accepts_native_marker() {
		$clean = openstation_validate_default_window_url( 'native:os-settings' );
		$this->assertSame( 'native:os-settings', $clean );
	}

	public function test_validate_rejects_native_marker_with_unsafe_slug() {

		$this->assertSame( '', openstation_validate_default_window_url( 'native:' ) );
		$this->assertSame( '', openstation_validate_default_window_url( 'native:foo/bar' ) );
		$this->assertSame( '', openstation_validate_default_window_url( 'native:foo bar' ) );
		$this->assertSame( '', openstation_validate_default_window_url( 'native:../etc/passwd' ) );
	}

	public function test_portal_entry_url_falls_back_for_native_marker() {
		openstation_set_default_window( self::$admin_id, 'native:os-settings' );

		$url = openstation_portal_entry_url( self::$admin_id );

		$this->assertSame( admin_url(), $url );
	}

	public function test_rest_set_default_window_with_url() {
		wp_set_current_user( self::$admin_id );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/default-window' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( wp_json_encode( array( 'url' => admin_url( 'tools.php' ) ) ) );

		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertTrue( $data['enabled'] );
		$this->assertStringContainsString( 'tools.php', $data['url'] );
	}

	public function test_rest_set_default_window_with_null() {
		wp_set_current_user( self::$admin_id );
		openstation_set_default_window( self::$admin_id, admin_url( 'edit.php' ) );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/default-window' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( wp_json_encode( array( 'url' => null ) ) );

		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertFalse( $data['enabled'] );
	}

	public function test_rest_set_default_window_with_missing_url() {
		wp_set_current_user( self::$admin_id );
		openstation_set_default_window( self::$admin_id, admin_url( 'edit.php' ) );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/default-window' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( wp_json_encode( new stdClass() ) );

		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertFalse( $data['enabled'] );
	}

	public function test_rest_rejects_cross_origin_url() {
		wp_set_current_user( self::$admin_id );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/default-window' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body(
			wp_json_encode( array( 'url' => 'https://attacker.example/wp-admin/edit.php' ) )
		);

		$response = rest_do_request( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_rest_rejects_anonymous() {
		wp_set_current_user( 0 );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/default-window' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( wp_json_encode( array( 'url' => admin_url( 'index.php' ) ) ) );

		$response = rest_do_request( $request );

		$this->assertGreaterThanOrEqual( 400, $response->get_status() );
	}
}
