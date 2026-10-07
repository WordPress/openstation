<?php

class Tests_OpenStation_UserEditWindowRestAppPasswords extends WP_UnitTestCase {

	private $admin_id;
	private $target_id;

	public function set_up() {
		parent::set_up();
		$this->admin_id  = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->target_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $this->admin_id );
	}

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

	public function test_revoke_rejected_when_application_passwords_unavailable_sitewide() {
		add_filter( 'wp_is_application_passwords_available', '__return_false' );

		$req = $this->build_request( $this->target_id );
		$req->set_param( 'uuid', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' );
		$res = openstation_user_edit_window_rest_app_pw_revoke( $req );

		$this->assertWPError( $res );
		$this->assertSame( 'openstation_users_app_pw_unavailable', $res->get_error_code() );
	}

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
