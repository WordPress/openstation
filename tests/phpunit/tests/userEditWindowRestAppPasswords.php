<?php
/**
 * Tests for the native User Edit window's application-password REST
 * handlers honoring core's availability policy.
 *
 * Regression guard: the list / create / revoke handlers must mirror
 * `WP_REST_Application_Passwords_Controller` and reject every
 * operation when `wp_is_application_passwords_available()` or
 * `wp_is_application_passwords_available_for_user()` says the
 * feature is off — an `edit_user` capability alone must not be
 * enough to bypass a site-wide or per-user disable filter.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-user-edit-window
 */
class Tests_OpenStation_UserEditWindowRestAppPasswords extends WP_UnitTestCase {

	private $admin_id;
	private $target_id;

	public function set_up() {
		parent::set_up();
		$this->admin_id  = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->target_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $this->admin_id );
	}

	/**
	 * Build a request carrying the target user id (and optional extras).
	 *
	 * @param int   $id     Target user id.
	 * @param array $params Extra request params.
	 * @return WP_REST_Request
	 */
	private function build_request( $id, array $params = array() ) {
		$req = new WP_REST_Request(
			'POST',
			'/desktop-mode/v1/users/' . $id . '/application-passwords'
		);
		$req->set_param( 'id', $id );
		foreach ( $params as $key => $value ) {
			$req->set_param( $key, $value );
		}
		return $req;
	}

	/**
	 * Site-wide disable must reject creation with a 501.
	 *
	 * @covers ::openstation_user_edit_window_rest_app_pw_create
	 * @covers ::openstation_user_edit_window_app_pw_unavailable
	 */
	public function test_create_rejected_when_application_passwords_unavailable_sitewide() {
		add_filter( 'wp_is_application_passwords_available', '__return_false' );

		$res = openstation_user_edit_window_rest_app_pw_create(
			$this->build_request( $this->target_id, array( 'name' => 'CLI tool' ) )
		);

		$this->assertWPError( $res );
		$this->assertSame( 'openstation_users_app_pw_unavailable', $res->get_error_code() );
		$data = $res->get_error_data();
		$this->assertSame( 501, $data['status'] );
		$this->assertSame(
			array(),
			WP_Application_Passwords::get_user_application_passwords( $this->target_id ),
			'no password may be created while the feature is disabled'
		);
	}

	/**
	 * Per-user disable must reject listing with a 501.
	 *
	 * @covers ::openstation_user_edit_window_rest_app_pw_list
	 * @covers ::openstation_user_edit_window_app_pw_unavailable
	 */
	public function test_list_rejected_when_unavailable_for_target_user() {
		add_filter( 'wp_is_application_passwords_available', '__return_true' );
		$target_id = $this->target_id;
		add_filter(
			'wp_is_application_passwords_available_for_user',
			static function ( $available, $user ) use ( $target_id ) {
				if ( $user instanceof WP_User && (int) $user->ID === $target_id ) {
					return false;
				}
				return $available;
			},
			10,
			2
		);

		$res = openstation_user_edit_window_rest_app_pw_list(
			$this->build_request( $this->target_id )
		);

		$this->assertWPError( $res );
		$this->assertSame( 'openstation_users_app_pw_unavailable', $res->get_error_code() );
	}

	/**
	 * Site-wide disable must reject revocation with a 501.
	 *
	 * @covers ::openstation_user_edit_window_rest_app_pw_revoke
	 * @covers ::openstation_user_edit_window_app_pw_unavailable
	 */
	public function test_revoke_rejected_when_application_passwords_unavailable_sitewide() {
		add_filter( 'wp_is_application_passwords_available', '__return_false' );

		$req = $this->build_request( $this->target_id );
		$req->set_param( 'uuid', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' );
		$res = openstation_user_edit_window_rest_app_pw_revoke( $req );

		$this->assertWPError( $res );
		$this->assertSame( 'openstation_users_app_pw_unavailable', $res->get_error_code() );
	}

	/**
	 * Each route asks Core's meta capability for its operation, as
	 * `WP_REST_Application_Passwords_Controller` does: a site that
	 * withholds `create_app_password` for another user, while leaving
	 * `edit_user`, is not stepped around by this window.
	 *
	 * @covers ::openstation_user_edit_window_app_pw_permission
	 */
	public function test_routes_ask_the_application_password_meta_caps() {
		add_filter( 'wp_is_application_passwords_available', '__return_true' );
		add_filter( 'wp_is_application_passwords_available_for_user', '__return_true' );
		add_filter(
			'map_meta_cap',
			static function ( $caps, $cap ) {
				return in_array( $cap, array( 'create_app_password', 'list_app_passwords' ), true ) ? array( 'do_not_allow' ) : $caps;
			},
			10,
			2
		);
		if ( is_multisite() ) {
			// Editing another user takes the network's admin there.
			grant_super_admin( $this->admin_id );
		}
		$this->assertTrue( current_user_can( 'edit_user', $this->target_id ) );
		do_action( 'rest_api_init' );

		$create = new WP_REST_Request( 'POST', '/desktop-mode/v1/users/' . $this->target_id . '/application-passwords' );
		$create->set_param( 'name', 'CLI tool' );
		$this->assertSame( 403, rest_get_server()->dispatch( $create )->get_status() );
		$this->assertSame( array(), WP_Application_Passwords::get_user_application_passwords( $this->target_id ) );

		$list = new WP_REST_Request( 'GET', '/desktop-mode/v1/users/' . $this->target_id . '/application-passwords' );
		$this->assertSame( 403, rest_get_server()->dispatch( $list )->get_status() );
	}

	/**
	 * When the policy allows the feature, creation still works.
	 *
	 * @covers ::openstation_user_edit_window_rest_app_pw_create
	 */
	public function test_create_succeeds_when_available() {
		add_filter( 'wp_is_application_passwords_available', '__return_true' );
		add_filter( 'wp_is_application_passwords_available_for_user', '__return_true' );

		$res = openstation_user_edit_window_rest_app_pw_create(
			$this->build_request( $this->target_id, array( 'name' => 'CLI tool' ) )
		);

		$this->assertNotWPError( $res );
		$data = $res->get_data();
		$this->assertTrue( $data['ok'] );
		$this->assertNotEmpty( $data['password'] );
		$this->assertCount(
			1,
			WP_Application_Passwords::get_user_application_passwords( $this->target_id )
		);
	}
}
