<?php

require_once ABSPATH . 'wp-admin/includes/ajax-actions.php';

class Tests_OpenStation_AjaxSave extends WP_Ajax_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'openstation_mode_enabled' );
		parent::tear_down();
	}

	private function dispatch( $enabled, $with_nonce = true, $extra = array() ) {
		$_POST = array_merge( array( 'enabled' => $enabled ), $extra );
		if ( $with_nonce ) {
			$_POST['nonce'] = wp_create_nonce( 'save-openstation' );
		}

		try {
			$this->_handleAjax( 'save-openstation' );
		} catch ( WPAjaxDieContinueException $e ) {

		}

		return json_decode( $this->_last_response, true );
	}

	public function test_enables_openstation_for_user() {
		$this->_setRole( 'administrator' );
		$response = $this->dispatch( '1' );

		$this->assertTrue( $response['success'] );
		$this->assertSame( '1', $response['data']['enabled'] );
		$this->assertSame( '1', get_user_meta( get_current_user_id(), 'desktop_mode_mode', true ) );
	}

	public function test_enable_response_redirects_to_shell_screen_with_dashboard_target() {
		$this->_setRole( 'administrator' );
		$response = $this->dispatch( '1' );

		$expected = openstation_shell_url( admin_url( 'index.php' ) );
		$this->assertSame( $expected, $response['data']['redirect'] );
		$this->assertTrue( openstation_url_is_shell_screen( $response['data']['redirect'] ) );
		$this->assertStringContainsString( 'target=', $response['data']['redirect'] );

		$this->assertNotSame( openstation_portal_url(), $response['data']['redirect'] );
	}

	public function test_disables_openstation_for_user() {
		$this->_setRole( 'administrator' );
		update_user_meta( get_current_user_id(), 'desktop_mode_mode', '1' );

		$response = $this->dispatch( '' );

		$this->assertTrue( $response['success'] );
		$this->assertSame( '', $response['data']['enabled'] );
		$this->assertSame( '', get_user_meta( get_current_user_id(), 'desktop_mode_mode', true ) );
	}

	public function test_network_claim_without_the_capability_is_ignored() {
		$this->_setRole( 'administrator' );
		$response = $this->dispatch( '1', true, array( 'network' => '1' ) );

		$this->assertSame(
			openstation_shell_url( admin_url( 'index.php' ), false, false ),
			$response['data']['redirect']
		);
	}

	public function test_disable_response_redirects_to_plain_admin_not_portal() {
		$this->_setRole( 'administrator' );
		update_user_meta( get_current_user_id(), 'desktop_mode_mode', '1' );

		$response = $this->dispatch( '' );

		$this->assertSame( admin_url(), $response['data']['redirect'] );
		$this->assertNotSame( openstation_portal_url(), $response['data']['redirect'] );
	}

	public function test_non_one_truthy_values_disable_mode() {
		$this->_setRole( 'administrator' );
		update_user_meta( get_current_user_id(), 'desktop_mode_mode', '1' );

		$response = $this->dispatch( 'true' );

		$this->assertTrue( $response['success'] );
		$this->assertSame( '', $response['data']['enabled'] );
		$this->assertSame( '', get_user_meta( get_current_user_id(), 'desktop_mode_mode', true ) );
	}

	public function test_missing_nonce_dies() {
		$this->_setRole( 'administrator' );

		$this->expectException( WPAjaxDieStopException::class );
		$this->_last_response = '';
		$_POST                = array( 'enabled' => '1' );
		$this->_handleAjax( 'save-openstation' );
	}

	public function test_invalid_nonce_dies() {
		$this->_setRole( 'administrator' );

		$this->expectException( WPAjaxDieStopException::class );
		$_POST = array(
			'enabled' => '1',
			'nonce'   => 'not-a-real-nonce',
		);
		$this->_handleAjax( 'save-openstation' );
	}

	public function test_openstation_mode_enabled_filter_blocks_save() {
		$this->_setRole( 'administrator' );
		add_filter( 'openstation_mode_enabled', '__return_false' );

		$response = $this->dispatch( '1' );

		$this->assertFalse( $response['success'] );
		$this->assertSame( 'openstation_disabled', $response['data'] );
		$this->assertSame( '', get_user_meta( get_current_user_id(), 'desktop_mode_mode', true ) );
	}

	public function test_user_without_read_cap_is_forbidden() {

		add_role( 'openstation_test_nonread', 'No Read', array() );
		$uid = self::factory()->user->create( array( 'role' => 'openstation_test_nonread' ) );
		wp_set_current_user( $uid );

		$response = $this->dispatch( '1' );

		$this->assertFalse( $response['success'] );
		$this->assertSame( 'openstation_forbidden', $response['data'] );
		$this->assertSame( '', get_user_meta( $uid, 'desktop_mode_mode', true ) );

		remove_role( 'openstation_test_nonread' );
	}

	public function test_openstation_mode_enabled_filter_receives_user_id() {
		$this->_setRole( 'administrator' );
		$expected_id = get_current_user_id();
		$received_id = null;

		add_filter(
			'openstation_mode_enabled',
			function ( $enabled, $user_id ) use ( &$received_id ) {
				$received_id = $user_id;
				return $enabled;
			},
			10,
			2
		);

		$this->dispatch( '1' );

		$this->assertSame( $expected_id, $received_id );
	}

	public function test_toggle_records_the_first_run_stamps_and_fires_the_actions() {
		$this->_setRole( 'administrator' );
		delete_option( OPENSTATION_FIRST_ENABLED_AT_OPTION );
		$enabled  = 0;
		$disabled = 0;
		add_action(
			'openstation_user_enabled',
			static function () use ( &$enabled ) {
				++$enabled;
			}
		);
		add_action(
			'openstation_user_disabled',
			static function () use ( &$disabled ) {
				++$disabled;
			}
		);

		$this->dispatch( '1' );
		$user_at = openstation_get_user_enabled_at( get_current_user_id() );
		$this->assertGreaterThan( 0, $user_at );
		$this->assertNotNull( openstation_get_first_enabled_stamp() );
		$this->assertSame( 1, $enabled );

		$this->dispatch( '' );
		$this->assertSame( 1, $disabled );
		$this->assertSame( $user_at, openstation_get_user_enabled_at( get_current_user_id() ) );

		remove_all_actions( 'openstation_user_enabled' );
		remove_all_actions( 'openstation_user_disabled' );
		delete_option( OPENSTATION_FIRST_ENABLED_AT_OPTION );
	}
}
