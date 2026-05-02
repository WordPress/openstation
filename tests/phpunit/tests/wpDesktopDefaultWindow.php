
<?php
/**
 * Tests for the default-window preference module.
 *
 * Covers the user-meta helpers (get/set), URL validation
 * ({@see desktop_mode_validate_default_window_url}), portal integration
 * (entry URL honors preference), and the REST endpoint.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-default-window
 */
class Tests_DesktopMode_WpDefaultWindow extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, DESKTOP_MODE_DEFAULT_WINDOW_META );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		delete_user_meta( self::$admin_id, DESKTOP_MODE_SESSION_META_KEY );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_get_default_window
	 */
	public function test_get_returns_sane_defaults_for_unconfigured_user() {
		$pref = desktop_mode_get_default_window( self::$admin_id );

		$this->assertTrue( $pref['enabled'] );
		$this->assertSame( admin_url( 'index.php' ), $pref['url'] );
	}

	/**
	 * @covers ::desktop_mode_get_default_window
	 */
	public function test_get_falls_back_when_meta_value_is_not_an_array() {
		update_user_meta( self::$admin_id, DESKTOP_MODE_DEFAULT_WINDOW_META, 'garbage' );

		$pref = desktop_mode_get_default_window( self::$admin_id );

		$this->assertTrue( $pref['enabled'] );
		$this->assertSame( admin_url( 'index.php' ), $pref['url'] );
	}

	/**
	 * @covers ::desktop_mode_set_default_window
	 */
	public function test_set_stores_an_enabled_preference_with_url() {
		$ok = desktop_mode_set_default_window( self::$admin_id, admin_url( 'edit.php' ) );

		$this->assertTrue( $ok );
		$pref = desktop_mode_get_default_window( self::$admin_id );
		$this->assertTrue( $pref['enabled'] );
		$this->assertStringContainsString( 'edit.php', $pref['url'] );
	}

	/**
	 * @covers ::desktop_mode_set_default_window
	 */
	public function test_set_null_disables_the_preference() {
		desktop_mode_set_default_window( self::$admin_id, admin_url( 'edit.php' ) );
		desktop_mode_set_default_window( self::$admin_id, null );

		$pref = desktop_mode_get_default_window( self::$admin_id );
		$this->assertFalse( $pref['enabled'] );
		// URL stays at the dashboard fallback for the portal's
		// http-level forward target — only the shell honors the
		// `enabled` flag for auto-open.
		$this->assertSame( admin_url( 'index.php' ), $pref['url'] );
	}

	/**
	 * @covers ::desktop_mode_set_default_window
	 */
	public function test_set_rejects_invalid_user_id() {
		$this->assertFalse( desktop_mode_set_default_window( 0, admin_url( 'edit.php' ) ) );
		$this->assertFalse( desktop_mode_set_default_window( -1, admin_url( 'edit.php' ) ) );
	}

	/**
	 * @covers ::desktop_mode_validate_default_window_url
	 */
	public function test_validate_accepts_same_origin_admin_url() {
		$clean = desktop_mode_validate_default_window_url( admin_url( 'edit.php?post_type=page' ) );

		$this->assertNotSame( '', $clean );
		$this->assertStringContainsString( 'edit.php', $clean );
	}

	/**
	 * @covers ::desktop_mode_validate_default_window_url
	 */
	public function test_validate_rejects_cross_origin_url() {
		$this->assertSame(
			'',
			desktop_mode_validate_default_window_url( 'https://evil.example.com/wp-admin/edit.php' )
		);
	}

	/**
	 * @covers ::desktop_mode_validate_default_window_url
	 */
	public function test_validate_rejects_non_admin_paths() {
		$this->assertSame(
			'',
			desktop_mode_validate_default_window_url( home_url( '/some-front-end-page/' ) )
		);
	}

	/**
	 * @covers ::desktop_mode_validate_default_window_url
	 */
	public function test_validate_rejects_non_http_schemes() {
		$this->assertSame(
			'',
			desktop_mode_validate_default_window_url( 'javascript:alert(1)' )
		);
		$this->assertSame(
			'',
			desktop_mode_validate_default_window_url( 'file:///etc/passwd' )
		);
	}

	/**
	 * @covers ::desktop_mode_validate_default_window_url
	 */
	public function test_validate_preserves_query_string() {
		$clean = desktop_mode_validate_default_window_url( admin_url( 'edit.php?post_type=page&orderby=date' ) );

		$this->assertStringContainsString( 'post_type=page', $clean );
		$this->assertStringContainsString( 'orderby=date', $clean );
	}

	/**
	 * Portal-integration: when the preference is disabled, the
	 * entry URL falls back to the stored URL (still a real admin
	 * page — the shell respects `enabled=false` and skips
	 * auto-opening at the JS layer).
	 *
	 * @covers ::desktop_mode_portal_entry_url
	 */
	public function test_portal_entry_url_honors_disabled_preference() {
		desktop_mode_set_default_window( self::$admin_id, null );

		$url = desktop_mode_portal_entry_url( self::$admin_id );

		// Portal still needs SOMETHING to forward to — verify it's
		// the Dashboard as the neutral fallback.
		$this->assertSame( admin_url( 'index.php' ), $url );
	}

	/**
	 * @covers ::desktop_mode_portal_entry_url
	 */
	public function test_portal_entry_url_uses_configured_preference() {
		desktop_mode_set_default_window( self::$admin_id, admin_url( 'plugins.php' ) );

		$url = desktop_mode_portal_entry_url( self::$admin_id );

		$this->assertStringContainsString( 'plugins.php', $url );
	}

	/**
	 * Native marker — `native:<slug>` — is accepted by the validator
	 * and round-trips through the user-meta storage. Used for
	 * native windows (OS Settings, Recycle Bin, plugin-registered
	 * native apps) which have no admin URL to forward to.
	 *
	 * @covers ::desktop_mode_validate_default_window_url
	 */
	public function test_validate_accepts_native_marker() {
		$clean = desktop_mode_validate_default_window_url( 'native:wp-desktop-os-settings' );
		$this->assertSame( 'native:wp-desktop-os-settings', $clean );
	}

	/**
	 * @covers ::desktop_mode_validate_default_window_url
	 */
	public function test_validate_rejects_native_marker_with_unsafe_slug() {
		// Slashes / spaces / empty / characters outside [a-z0-9_-]
		// must be rejected so the marker can't smuggle a path
		// traversal or a redirect through the validator.
		$this->assertSame( '', desktop_mode_validate_default_window_url( 'native:' ) );
		$this->assertSame( '', desktop_mode_validate_default_window_url( 'native:foo/bar' ) );
		$this->assertSame( '', desktop_mode_validate_default_window_url( 'native:foo bar' ) );
		$this->assertSame( '', desktop_mode_validate_default_window_url( 'native:../etc/passwd' ) );
	}

	/**
	 * Portal redirects to admin home when the saved preference is a
	 * native marker — the marker isn't a routable URL, but the
	 * redirect must succeed at HTTP level so the shell can pick up
	 * `defaultWindow.url` from the config and call
	 * `nativeWindows.openById( <slug> )` after init.
	 *
	 * @covers ::desktop_mode_portal_entry_url
	 */
	public function test_portal_entry_url_falls_back_for_native_marker() {
		desktop_mode_set_default_window( self::$admin_id, 'native:wp-desktop-os-settings' );

		$url = desktop_mode_portal_entry_url( self::$admin_id );

		$this->assertSame( admin_url(), $url );
	}

	/**
	 * REST endpoint: happy path — string URL sets the preference.
	 *
	 * @covers ::desktop_mode_rest_set_default_window
	 */
	public function test_rest_set_default_window_with_url() {
		wp_set_current_user( self::$admin_id );

		$request = new WP_REST_Request( 'POST', '/wp-desktop/v1/default-window' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( wp_json_encode( array( 'url' => admin_url( 'tools.php' ) ) ) );

		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertTrue( $data['enabled'] );
		$this->assertStringContainsString( 'tools.php', $data['url'] );
	}

	/**
	 * REST endpoint: null url disables the preference (this is the
	 * path that hit an HTTP 400 under the old multi-type schema).
	 *
	 * @covers ::desktop_mode_rest_set_default_window
	 */
	public function test_rest_set_default_window_with_null() {
		wp_set_current_user( self::$admin_id );
		desktop_mode_set_default_window( self::$admin_id, admin_url( 'edit.php' ) );

		$request = new WP_REST_Request( 'POST', '/wp-desktop/v1/default-window' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( wp_json_encode( array( 'url' => null ) ) );

		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertFalse( $data['enabled'] );
	}

	/**
	 * REST endpoint: missing url key is treated the same as null.
	 *
	 * @covers ::desktop_mode_rest_set_default_window
	 */
	public function test_rest_set_default_window_with_missing_url() {
		wp_set_current_user( self::$admin_id );
		desktop_mode_set_default_window( self::$admin_id, admin_url( 'edit.php' ) );

		$request = new WP_REST_Request( 'POST', '/wp-desktop/v1/default-window' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( wp_json_encode( new stdClass() ) );

		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertFalse( $data['enabled'] );
	}

	/**
	 * REST endpoint: a bad URL (cross-origin) returns a 400 error.
	 *
	 * @covers ::desktop_mode_rest_set_default_window
	 */
	public function test_rest_rejects_cross_origin_url() {
		wp_set_current_user( self::$admin_id );

		$request = new WP_REST_Request( 'POST', '/wp-desktop/v1/default-window' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body(
			wp_json_encode( array( 'url' => 'https://attacker.example/wp-admin/edit.php' ) )
		);

		$response = rest_do_request( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * REST endpoint: logged-out request is rejected.
	 *
	 * @covers ::desktop_mode_rest_set_default_window
	 */
	public function test_rest_rejects_anonymous() {
		wp_set_current_user( 0 );

		$request = new WP_REST_Request( 'POST', '/wp-desktop/v1/default-window' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( wp_json_encode( array( 'url' => admin_url( 'index.php' ) ) ) );

		$response = rest_do_request( $request );

		$this->assertGreaterThanOrEqual( 400, $response->get_status() );
	}
}
